// src/frontend.ts
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
var seq = 0;
var pending = new Map;
function request(ctx, payload, timeoutMs = 120000) {
  const requestId = `lctp_${Date.now()}_${++seq}`;
  ctx.sendToBackend({ ...payload, requestId });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("요청 시간이 초과되었습니다."));
    }, timeoutMs);
    pending.set(requestId, (response) => {
      clearTimeout(timer);
      pending.delete(requestId);
      if (response?.type === "error")
        reject(new Error(response.error || "알 수 없는 오류"));
      else
        resolve(response);
    });
  });
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return `&${"amp"};`;
      case "<":
        return `&${"lt"};`;
      case ">":
        return `&${"gt"};`;
      case '"':
        return `&${"quot"};`;
      case "'":
        return `&${"#39"};`;
      default:
        return ch;
    }
  });
}
function setStatus(root, message, kind = "idle") {
  const el = root.querySelector("[data-status]");
  if (!el)
    return;
  el.textContent = message;
  el.dataset.kind = kind;
}
function q(root, selector) {
  const el = root.querySelector(selector);
  if (!el)
    throw new Error(`요소를 찾지 못했습니다: ${selector}`);
  return el;
}
function readSettings(root) {
  return {
    enabled: q(root, "[name=enabled]").checked,
    includeChatHistory: q(root, "[name=includeChatHistory]").checked,
    historyCount: Number(q(root, "[name=historyCount]").value || DEFAULT_SETTINGS.historyCount),
    temperature: Number(q(root, "[name=temperature]").value || DEFAULT_SETTINGS.temperature),
    maxTokens: Number(q(root, "[name=maxTokens]").value || DEFAULT_SETTINGS.maxTokens),
    systemPrompt: q(root, "[name=systemPrompt]").value,
    translatePrompt: q(root, "[name=translatePrompt]").value,
    inputTranslatePrompt: q(root, "[name=inputTranslatePrompt]").value,
    displayMode: q(root, "[name=displayMode]").value
  };
}
function renderSettings(root, settings) {
  root.innerHTML = `
    <div class="lctp-panel">
      <div class="lctp-hero">
        <strong>LLM 번역기 Plus</strong>
        <span>활성 채팅의 최근 대화를 참고해 Lumiverse LLM으로 번역합니다.</span>
      </div>

      <div data-status class="lctp-status" data-kind="idle">준비됨</div>

      <label class="lctp-check"><input name="enabled" type="checkbox" ${settings.enabled ? "checked" : ""}> 확장 활성화</label>
      <label class="lctp-check"><input name="includeChatHistory" type="checkbox" ${settings.includeChatHistory ? "checked" : ""}> 최근 대화 히스토리 포함</label>

      <div class="lctp-grid">
        <label>히스토리 수 <input name="historyCount" type="number" min="0" max="30" value="${settings.historyCount}"></label>
        <label>Temperature <input name="temperature" type="number" min="0" max="2" step="0.1" value="${settings.temperature}"></label>
        <label>Max Tokens <input name="maxTokens" type="number" min="128" max="8000" step="128" value="${settings.maxTokens}"></label>
        <label>표시 방식
          <select name="displayMode">
            <option value="replace" ${settings.displayMode === "replace" ? "selected" : ""}>번역문으로 교체</option>
            <option value="both" ${settings.displayMode === "both" ? "selected" : ""}>번역문 + 원문</option>
            <option value="folded" ${settings.displayMode === "folded" ? "selected" : ""}>번역문 + 접힌 원문</option>
          </select>
        </label>
      </div>

      <label>시스템 프롬프트 <textarea name="systemPrompt" rows="5">${escapeHtml(settings.systemPrompt)}</textarea></label>
      <label>메시지 번역 프롬프트 <textarea name="translatePrompt" rows="2">${escapeHtml(settings.translatePrompt)}</textarea></label>
      <label>입력문 번역 프롬프트 <textarea name="inputTranslatePrompt" rows="2">${escapeHtml(settings.inputTranslatePrompt)}</textarea></label>

      <div class="lctp-actions">
        <button data-action="save">설정 저장</button>
        <button data-action="translate-last">마지막 메시지 번역</button>
        <button data-action="translate-input">텍스트 번역</button>
      </div>
    </div>
  `;
}
function openInputModal(ctx) {
  const modal = ctx.ui.showModal({ title: "입력 텍스트 번역", width: 560, maxHeight: 620 });
  modal.root.innerHTML = `
    <div class="lctp-panel">
      <div data-status class="lctp-status" data-kind="idle">영어로 번역할 텍스트를 입력하세요.</div>
      <textarea data-input rows="8" placeholder="번역할 텍스트"></textarea>
      <div class="lctp-actions"><button data-run>번역</button></div>
      <textarea data-output rows="8" readonly placeholder="번역 결과"></textarea>
    </div>
  `;
  modal.root.querySelector("[data-run]")?.addEventListener("click", async () => {
    try {
      setStatus(modal.root, "번역 중...", "idle");
      const text = modal.root.querySelector("[data-input]")?.value || "";
      const response = await request(ctx, { type: "translate_input", text });
      const output = modal.root.querySelector("[data-output]");
      if (output)
        output.value = response.translation || "";
      setStatus(modal.root, "번역 완료", "ok");
    } catch (err) {
      setStatus(modal.root, err instanceof Error ? err.message : String(err), "error");
    }
  });
}
function openActionModal(ctx) {
  const modal = ctx.ui.showModal({ title: "LLM 번역기 Plus", width: 440, maxHeight: 420 });
  const active = ctx.getActiveChat();
  modal.root.innerHTML = `
    <div class="lctp-panel">
      <div data-status class="lctp-status" data-kind="idle">${active.chatId ? "활성 채팅 감지됨" : "활성 채팅이 없습니다."}</div>
      <div class="lctp-actions vertical">
        <button data-last>마지막 메시지 번역</button>
        <button data-input>텍스트 번역</button>
        <button data-settings>설정 열기</button>
      </div>
    </div>
  `;
  modal.root.querySelector("[data-last]")?.addEventListener("click", async () => {
    try {
      const { chatId } = ctx.getActiveChat();
      setStatus(modal.root, "번역 중...", "idle");
      await request(ctx, { type: "translate_last", chatId });
      setStatus(modal.root, "마지막 메시지를 번역했습니다.", "ok");
    } catch (err) {
      setStatus(modal.root, err instanceof Error ? err.message : String(err), "error");
    }
  });
  modal.root.querySelector("[data-input]")?.addEventListener("click", () => openInputModal(ctx));
  modal.root.querySelector("[data-settings]")?.addEventListener("click", () => modal.dismiss());
}
function setup(ctx) {
  const removeStyle = ctx.dom.addStyle(`
    .lctp-panel { display: flex; flex-direction: column; gap: 12px; padding: 12px; color: var(--lumiverse-text, inherit); }
    .lctp-hero { display: flex; flex-direction: column; gap: 4px; padding: 12px; border-radius: 12px; background: var(--lumiverse-fill-subtle, rgba(127,127,127,.12)); }
    .lctp-hero strong { font-size: 16px; }
    .lctp-hero span, .lctp-status { font-size: 12px; color: var(--lumiverse-text-muted, #888); }
    .lctp-status { padding: 8px 10px; border-radius: 8px; background: var(--lumiverse-fill-subtle, rgba(127,127,127,.1)); white-space: pre-wrap; }
    .lctp-status[data-kind="ok"] { color: #22c55e; }
    .lctp-status[data-kind="error"] { color: #ef4444; }
    .lctp-check { display: flex; align-items: center; gap: 8px; }
    .lctp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .lctp-panel label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; }
    .lctp-panel input, .lctp-panel select, .lctp-panel textarea {
      width: 100%; box-sizing: border-box; border: 1px solid var(--lumiverse-border, #444);
      border-radius: 8px; padding: 8px; background: var(--lumiverse-fill, transparent); color: var(--lumiverse-text, inherit);
    }
    .lctp-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .lctp-actions.vertical { flex-direction: column; }
    .lctp-actions button {
      border: 1px solid var(--lumiverse-border, #444); border-radius: 8px; padding: 8px 10px;
      background: var(--lumiverse-accent, #7c3aed); color: white; cursor: pointer;
    }
  `);
  const drawer = ctx.ui.registerDrawerTab({
    id: "llm-context-translator-plus",
    title: "LLM 번역기 Plus",
    shortName: "번역+",
    description: "컨텍스트 기반 LLM 번역기 설정",
    keywords: ["translation", "translator", "llm", "korean"],
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>'
  });
  const inputAction = ctx.ui.registerInputBarAction({
    id: "llm-context-translator-plus-action",
    label: "LLM 번역",
    subtitle: "마지막 메시지/텍스트 번역",
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="m22 22-5-10-5 10"/></svg>',
    enabled: true
  });
  const unsubBackend = ctx.onBackendMessage((payload) => {
    if (payload?.requestId && pending.has(payload.requestId))
      pending.get(payload.requestId)?.(payload);
  });
  const wireSettings = async () => {
    try {
      renderSettings(drawer.root, DEFAULT_SETTINGS);
      setStatus(drawer.root, "설정을 불러오는 중...", "idle");
      const response = await request(ctx, { type: "get_settings" }, 30000);
      renderSettings(drawer.root, response.settings || DEFAULT_SETTINGS);
      setStatus(drawer.root, "준비됨", "ok");
      drawer.root.querySelector("[data-action=save]")?.addEventListener("click", async () => {
        try {
          setStatus(drawer.root, "저장 중...", "idle");
          await request(ctx, { type: "save_settings", settings: readSettings(drawer.root) }, 30000);
          setStatus(drawer.root, "설정을 저장했습니다.", "ok");
        } catch (err) {
          setStatus(drawer.root, err instanceof Error ? err.message : String(err), "error");
        }
      });
      drawer.root.querySelector("[data-action=translate-last]")?.addEventListener("click", async () => {
        try {
          const { chatId } = ctx.getActiveChat();
          setStatus(drawer.root, "번역 중...", "idle");
          await request(ctx, { type: "translate_last", chatId });
          setStatus(drawer.root, "마지막 메시지를 번역했습니다.", "ok");
        } catch (err) {
          setStatus(drawer.root, err instanceof Error ? err.message : String(err), "error");
        }
      });
      drawer.root.querySelector("[data-action=translate-input]")?.addEventListener("click", () => openInputModal(ctx));
    } catch (err) {
      setStatus(drawer.root, err instanceof Error ? err.message : String(err), "error");
    }
  };
  wireSettings();
  const unclick = inputAction.onClick(() => openActionModal(ctx));
  return () => {
    unclick();
    unsubBackend();
    inputAction.destroy();
    drawer.destroy();
    removeStyle();
    ctx.dom.cleanup();
  };
}
export {
  setup
};
