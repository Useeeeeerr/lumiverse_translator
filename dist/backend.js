// @bun
// src/backend.ts
var EXT_ID = "llm_context_translator_plus";
var SETTINGS_PATH = "settings.json";
var DEFAULT_SETTINGS = {
  enabled: true,
  includeChatHistory: true,
  historyCount: 10,
  temperature: 0.3,
  maxTokens: 1000,
  systemPrompt: "You are a professional translator. Translate naturally and accurately while preserving tone, style, meaning, roleplay nuance, names, and formatting. Use the provided conversation context only to improve translation quality.",
  translatePrompt: "Translate the following text to Korean:",
  inputTranslatePrompt: "Translate the following text to English:",
  displayMode: "replace"
};
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function normalizeSettings(input) {
  const src = isRecord(input) ? input : {};
  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : DEFAULT_SETTINGS.enabled,
    includeChatHistory: typeof src.includeChatHistory === "boolean" ? src.includeChatHistory : DEFAULT_SETTINGS.includeChatHistory,
    historyCount: clampInt(src.historyCount, 0, 30, DEFAULT_SETTINGS.historyCount),
    temperature: clampNumber(src.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    maxTokens: clampInt(src.maxTokens, 128, 8000, DEFAULT_SETTINGS.maxTokens),
    systemPrompt: typeof src.systemPrompt === "string" && src.systemPrompt.trim() ? src.systemPrompt : DEFAULT_SETTINGS.systemPrompt,
    translatePrompt: typeof src.translatePrompt === "string" && src.translatePrompt.trim() ? src.translatePrompt : DEFAULT_SETTINGS.translatePrompt,
    inputTranslatePrompt: typeof src.inputTranslatePrompt === "string" && src.inputTranslatePrompt.trim() ? src.inputTranslatePrompt : DEFAULT_SETTINGS.inputTranslatePrompt,
    displayMode: src.displayMode === "both" || src.displayMode === "folded" ? src.displayMode : "replace"
  };
}
async function loadSettings(userId) {
  return normalizeSettings(await spindle.userStorage.getJson(SETTINGS_PATH, { fallback: DEFAULT_SETTINGS, userId }));
}
async function saveSettings(settings, userId) {
  const next = normalizeSettings({ ...await loadSettings(userId), ...settings });
  await spindle.userStorage.setJson(SETTINGS_PATH, next, { indent: 2, userId });
  return next;
}
function getContent(message) {
  return isRecord(message) && typeof message.content === "string" ? message.content : "";
}
function getId(message) {
  if (!isRecord(message))
    return "";
  const id = message.id ?? message.messageId;
  return typeof id === "string" ? id : String(id ?? "");
}
function getRole(message) {
  if (!isRecord(message))
    return "assistant";
  return message.role === "user" || message.role === "system" ? message.role : "assistant";
}
function buildHistory(messages, targetId, settings) {
  if (!settings.includeChatHistory || settings.historyCount <= 0)
    return "";
  const targetIndex = messages.findIndex((m) => getId(m) === targetId);
  const beforeTarget = targetIndex >= 0 ? messages.slice(0, targetIndex) : messages;
  return beforeTarget.slice(-settings.historyCount).map((m) => `${getRole(m).toUpperCase()}: ${getContent(m)}`.trim()).filter(Boolean).join(`

`);
}
function extractGeneratedContent(result) {
  if (typeof result === "string")
    return result.trim();
  if (!isRecord(result))
    return "";
  const direct = result.content ?? result.text ?? result.output;
  if (typeof direct === "string")
    return direct.trim();
  const choices = result.choices;
  if (Array.isArray(choices) && choices[0] && isRecord(choices[0])) {
    const msg = choices[0].message;
    if (isRecord(msg) && typeof msg.content === "string")
      return msg.content.trim();
    if (typeof choices[0].text === "string")
      return choices[0].text.trim();
  }
  return "";
}
async function generateTranslation(text, settings, contextText = "", inputMode = false, userId) {
  const prompt = inputMode ? settings.inputTranslatePrompt : settings.translatePrompt;
  const userParts = [];
  if (contextText)
    userParts.push(`Conversation context:
${contextText}`);
  userParts.push(`${prompt}

${text}`);
  const result = await spindle.generate.quiet({
    type: "quiet",
    messages: [
      { role: "system", content: settings.systemPrompt },
      { role: "user", content: userParts.join(`

---

`) }
    ],
    parameters: {
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      maxTokens: settings.maxTokens
    },
    userId
  });
  const translation = extractGeneratedContent(result);
  if (!translation)
    throw new Error("LLM \uC751\uB2F5\uC5D0\uC11C \uBC88\uC5ED\uBB38\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
  return translation;
}
function formatContent(original, translation, mode) {
  if (mode === "both")
    return `${translation}

---
\uC6D0\uBB38:
${original}`;
  if (mode === "folded")
    return `${translation}

<details><summary>\uC6D0\uBB38</summary>

${original}

</details>`;
  return translation;
}
function send(type, requestId, payload, userId) {
  spindle.sendToFrontend({ type, requestId, ...payload }, userId);
}
spindle.onFrontendMessage((rawPayload, userId) => {
  (async () => {
    const payload = rawPayload;
    const requestId = isRecord(rawPayload) && typeof rawPayload.requestId === "string" ? rawPayload.requestId : undefined;
    try {
      if (!isRecord(payload) || typeof payload.type !== "string")
        return;
      if (payload.type === "get_settings") {
        send("settings", requestId, { settings: await loadSettings(userId) }, userId);
        return;
      }
      if (payload.type === "save_settings") {
        send("settings", requestId, { settings: await saveSettings(payload.settings ?? {}, userId), saved: true }, userId);
        return;
      }
      const settings = await loadSettings(userId);
      if (!settings.enabled)
        throw new Error("\uD655\uC7A5\uC774 \uBE44\uD65C\uC131\uD654\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
      if (payload.type === "translate_input") {
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text)
          throw new Error("\uBC88\uC5ED\uD560 \uC785\uB825 \uD14D\uC2A4\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
        const translation = await generateTranslation(text, settings, "", true, userId);
        send("input_translation", requestId, { original: text, translation }, userId);
        return;
      }
      if (payload.type === "translate_last" || payload.type === "translate_message") {
        const chatId = typeof payload.chatId === "string" ? payload.chatId : "";
        if (!chatId)
          throw new Error("\uD65C\uC131 \uCC44\uD305\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
        const messages = await spindle.chat.getMessages(chatId);
        const target = payload.type === "translate_message" && typeof payload.messageId === "string" ? messages.find((m) => getId(m) === payload.messageId) : [...messages].reverse().find((m) => getContent(m).trim());
        if (!target)
          throw new Error("\uBC88\uC5ED\uD560 \uBA54\uC2DC\uC9C0\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
        const messageId = getId(target);
        const original = getContent(target).trim();
        if (!messageId || !original)
          throw new Error("\uBC88\uC5ED\uD560 \uBA54\uC2DC\uC9C0 \uB0B4\uC6A9\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
        const translation = await generateTranslation(original, settings, buildHistory(messages, messageId, settings), false, userId);
        await spindle.chat.updateMessage(chatId, messageId, {
          content: formatContent(original, translation, settings.displayMode),
          metadata: {
            [EXT_ID]: {
              original,
              translation,
              translatedAt: new Date().toISOString(),
              displayMode: settings.displayMode
            }
          }
        });
        send("message_translated", requestId, { chatId, messageId, original, translation }, userId);
      }
    } catch (err) {
      send("error", requestId, { error: err instanceof Error ? err.message : String(err) }, userId);
    }
  })();
});
spindle.log.info("LLM \uBC88\uC5ED\uAE30 Plus Spindle backend loaded.");
