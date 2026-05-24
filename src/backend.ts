declare const spindle: import("lumiverse-spindle-types").SpindleAPI;

type Role = "system" | "user" | "assistant";

interface Settings {
  enabled: boolean;
  includeChatHistory: boolean;
  historyCount: number;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  translatePrompt: string;
  inputTranslatePrompt: string;
  displayMode: "replace" | "both" | "folded";
}

const EXT_ID = "llm_context_translator_plus";
const SETTINGS_PATH = "settings.json";

const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  includeChatHistory: true,
  historyCount: 10,
  temperature: 0.3,
  maxTokens: 1000,
  systemPrompt:
    "You are a professional translator. Translate naturally and accurately while preserving tone, style, meaning, roleplay nuance, names, and formatting. Use the provided conversation context only to improve translation quality.",
  translatePrompt: "Translate the following text to Korean:",
  inputTranslatePrompt: "Translate the following text to English:",
  displayMode: "replace",
};

type BackendPayload =
  | { type: "get_settings"; requestId?: string }
  | { type: "save_settings"; requestId?: string; settings?: Partial<Settings> }
  | { type: "translate_last"; requestId?: string; chatId?: string | null }
  | { type: "translate_input"; requestId?: string; text?: string }
  | { type: "translate_message"; requestId?: string; chatId?: string | null; messageId?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalizeSettings(input: unknown): Settings {
  const src = isRecord(input) ? input : {};
  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : DEFAULT_SETTINGS.enabled,
    includeChatHistory: typeof src.includeChatHistory === "boolean" ? src.includeChatHistory : DEFAULT_SETTINGS.includeChatHistory,
    historyCount: clampInt(src.historyCount, 0, 30, DEFAULT_SETTINGS.historyCount),
    temperature: clampNumber(src.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    maxTokens: clampInt(src.maxTokens, 128, 8000, DEFAULT_SETTINGS.maxTokens),
    systemPrompt: typeof src.systemPrompt === "string" && src.systemPrompt.trim() ? src.systemPrompt : DEFAULT_SETTINGS.systemPrompt,
    translatePrompt: typeof src.translatePrompt === "string" && src.translatePrompt.trim() ? src.translatePrompt : DEFAULT_SETTINGS.translatePrompt,
    inputTranslatePrompt:
      typeof src.inputTranslatePrompt === "string" && src.inputTranslatePrompt.trim()
        ? src.inputTranslatePrompt
        : DEFAULT_SETTINGS.inputTranslatePrompt,
    displayMode: src.displayMode === "both" || src.displayMode === "folded" ? src.displayMode : "replace",
  };
}

async function loadSettings(userId?: string): Promise<Settings> {
  return normalizeSettings(await spindle.userStorage.getJson(SETTINGS_PATH, { fallback: DEFAULT_SETTINGS, userId }));
}

async function saveSettings(settings: Partial<Settings>, userId?: string): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings(userId)), ...settings });
  await spindle.userStorage.setJson(SETTINGS_PATH, next, { indent: 2, userId });
  return next;
}

function getContent(message: unknown): string {
  return isRecord(message) && typeof message.content === "string" ? message.content : "";
}

function getId(message: unknown): string {
  if (!isRecord(message)) return "";
  const id = message.id ?? message.messageId;
  return typeof id === "string" ? id : String(id ?? "");
}

function getRole(message: unknown): Role {
  if (!isRecord(message)) return "assistant";
  return message.role === "user" || message.role === "system" ? message.role : "assistant";
}

function buildHistory(messages: unknown[], targetId: string, settings: Settings): string {
  if (!settings.includeChatHistory || settings.historyCount <= 0) return "";
  const targetIndex = messages.findIndex((m) => getId(m) === targetId);
  const beforeTarget = targetIndex >= 0 ? messages.slice(0, targetIndex) : messages;
  return beforeTarget
    .slice(-settings.historyCount)
    .map((m) => `${getRole(m).toUpperCase()}: ${getContent(m)}`.trim())
    .filter(Boolean)
    .join("\n\n");
}

function extractGeneratedContent(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (!isRecord(result)) return "";
  const direct = result.content ?? result.text ?? result.output;
  if (typeof direct === "string") return direct.trim();
  const choices = result.choices;
  if (Array.isArray(choices) && choices[0] && isRecord(choices[0])) {
    const msg = choices[0].message;
    if (isRecord(msg) && typeof msg.content === "string") return msg.content.trim();
    if (typeof choices[0].text === "string") return choices[0].text.trim();
  }
  return "";
}

async function generateTranslation(text: string, settings: Settings, contextText = "", inputMode = false, userId?: string): Promise<string> {
  const prompt = inputMode ? settings.inputTranslatePrompt : settings.translatePrompt;
  const userParts: string[] = [];
  if (contextText) userParts.push(`Conversation context:\n${contextText}`);
  userParts.push(`${prompt}\n\n${text}`);

  const result = await spindle.generate.quiet({
    type: "quiet",
    messages: [
      { role: "system", content: settings.systemPrompt },
      { role: "user", content: userParts.join("\n\n---\n\n") },
    ],
    parameters: {
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      maxTokens: settings.maxTokens,
    },
    userId,
  });

  const translation = extractGeneratedContent(result);
  if (!translation) throw new Error("LLM 응답에서 번역문을 찾지 못했습니다.");
  return translation;
}

function formatContent(original: string, translation: string, mode: Settings["displayMode"]): string {
  if (mode === "both") return `${translation}\n\n---\n원문:\n${original}`;
  if (mode === "folded") return `${translation}\n\n<details><summary>원문</summary>\n\n${original}\n\n</details>`;
  return translation;
}

function send(type: string, requestId: string | undefined, payload: Record<string, unknown>, userId?: string) {
  spindle.sendToFrontend({ type, requestId, ...payload }, userId);
}

spindle.onFrontendMessage((rawPayload: unknown, userId?: string) => {
  void (async () => {
    const payload = rawPayload as BackendPayload;
    const requestId = isRecord(rawPayload) && typeof rawPayload.requestId === "string" ? rawPayload.requestId : undefined;

    try {
      if (!isRecord(payload) || typeof payload.type !== "string") return;

      if (payload.type === "get_settings") {
        send("settings", requestId, { settings: await loadSettings(userId) }, userId);
        return;
      }

      if (payload.type === "save_settings") {
        send("settings", requestId, { settings: await saveSettings(payload.settings ?? {}, userId), saved: true }, userId);
        return;
      }

      const settings = await loadSettings(userId);
      if (!settings.enabled) throw new Error("확장이 비활성화되어 있습니다.");

      if (payload.type === "translate_input") {
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text) throw new Error("번역할 입력 텍스트가 없습니다.");
        const translation = await generateTranslation(text, settings, "", true, userId);
        send("input_translation", requestId, { original: text, translation }, userId);
        return;
      }

      if (payload.type === "translate_last" || payload.type === "translate_message") {
        const chatId = typeof payload.chatId === "string" ? payload.chatId : "";
        if (!chatId) throw new Error("활성 채팅을 찾지 못했습니다.");

        const messages = await spindle.chat.getMessages(chatId);
        const target =
          payload.type === "translate_message" && typeof payload.messageId === "string"
            ? messages.find((m) => getId(m) === payload.messageId)
            : [...messages].reverse().find((m) => getContent(m).trim());

        if (!target) throw new Error("번역할 메시지를 찾지 못했습니다.");

        const messageId = getId(target);
        const original = getContent(target).trim();
        if (!messageId || !original) throw new Error("번역할 메시지 내용이 비어 있습니다.");

        const translation = await generateTranslation(original, settings, buildHistory(messages, messageId, settings), false, userId);
        await spindle.chat.updateMessage(chatId, messageId, {
          content: formatContent(original, translation, settings.displayMode),
          metadata: {
            [EXT_ID]: {
              original,
              translation,
              translatedAt: new Date().toISOString(),
              displayMode: settings.displayMode,
            },
          },
        });

        send("message_translated", requestId, { chatId, messageId, original, translation }, userId);
      }
    } catch (err) {
      send("error", requestId, { error: err instanceof Error ? err.message : String(err) }, userId);
    }
  })();
});

spindle.log.info("LLM 번역기 Plus Spindle backend loaded.");