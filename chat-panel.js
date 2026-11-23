// @ts-check
/* ======================================================
   chat-panel — the 解卦面板 as one mounted module
   ------------------------------------------------------
   Interface:

     mountChatPanel({ container, session, reading, store, brief, gemini })
       → { refresh(session?, reading?), destroy() }

     panelState(session, now, flags) → PanelState   (pure)
     introText({ primary, transformed, movingLines, expiresAt }) → string (pure)
     quickChips(movingIndices) → string[]           (pure)
     geminiSettings(storage) → { key, saveKey, model, saveModel }

   The module owns:
   - its root element (created inside `container`)
   - three delegated listeners on that root (click / keydown / input)
   - one 1 s 交流有效期 ticker

   and the panel-local transient state: history / system / busy /
   feedbackOpen / editingKey. The 会话 record stays the one home for
   messages and the transport handle; canContinue is the one gate.

   Selectors are class-based so two panels can coexist and `destroy()`
   leaves nothing global behind.

   `brief` is the seam to 卦象 wording:
     { fullPrompt(question) → string, systemPrompt() → string }
   Candidate #4 replaces its implementation, not this interface.
   ====================================================== */

import { CHAT_VALID_MS, canContinue, conversation, remainingMs } from './session.js';
import {
  autoGrow,
  escapeHtml,
  formatChatText,
  formatDateTime,
  formatRemaining,
  showToast,
} from './ui-kit.js';

/** @typedef {import('./session.js').Session} Session */
/** @typedef {import('./session.js').SessionStore} SessionStore */
/** @typedef {import('./session.js').SessionMessage} SessionMessage */
/** @typedef {import('./session.js').MessageRole} MessageRole */
/** @typedef {import('./hexagram.js').Hexagram} Hexagram */
/** @typedef {import('./hexagram.js').MovingLine} MovingLine */
/** @typedef {import('./hexagram.js').Reading} Reading */
/** @typedef {import('./gemini.js').GeminiRequest} GeminiRequest */
/** @typedef {import('./gemini.js').GeminiReply} GeminiReply */

/** 气泡角色：问答与反馈会落盘，error / pending 只是当下的界面状态 */
/** @typedef {'user'|'model'|'feedback'|'error'|'pending'} BubbleRole */

/**
 * @typedef {object} InterpretationBrief
 * @property {(question: string) => string} fullPrompt 解卦提示（含一次性解卦指令）
 * @property {() => string} systemPrompt 本机对话的系统提示词
 */

/**
 * @typedef {object} GeminiPort
 * @property {(request: GeminiRequest) => Promise<GeminiReply>} request
 * @property {boolean} [available] 连通性检测结果，决定「在 Gemini 中打开」还是「复制到豆包」
 */

/**
 * @typedef {object} ChatPanelOptions
 * @property {HTMLElement} container
 * @property {Session} session
 * @property {Reading} reading 卦象资料，用于开场摘要
 * @property {SessionStore} store
 * @property {InterpretationBrief} brief
 * @property {GeminiPort} gemini
 * @property {() => number} [now] 注入时钟，ticker 与测试共用
 */

/**
 * @typedef {object} ChatPanelHandle
 * @property {(session?: Session, reading?: Reading) => void} refresh
 * @property {() => void} destroy
 */

/**
 * @typedef {object} PanelFlags
 * @property {boolean} [busy]
 * @property {boolean} [feedbackOpen]
 * @property {boolean} [editingKey]
 * @property {boolean} [keySaved]
 * @property {string} [keyLast4]
 * @property {string} [model]
 * @property {boolean} [hasTalked]
 */

/**
 * @typedef {object} PanelState
 * @property {boolean} expired
 * @property {number} remaining
 * @property {string} statusHtml 有效期条
 * @property {string} keyStatusHtml Key 状态行（含「更换 / 清除」按钮）
 * @property {string} feedbackLabel 反馈按钮文案
 * @property {boolean} showKeyRow
 * @property {boolean} showChips
 * @property {string[]} chips
 * @property {boolean} showComposer
 */

const HOURS = Math.round(CHAT_VALID_MS / 3600000);

const GEMINI_MODEL_DEFAULT = 'gemini-3.8-flash';
const GEMINI_KEY_STORAGE = 'gemini_api_key';
const GEMINI_MODEL_STORAGE = 'gemini_model';

/**
 * @typedef {object} KeyValueStorage
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 */

/**
 * The pure view state. Every DOM write in the panel is a function of this,
 * so expiry / key / chips rules are testable without a DOM.
 * @param {Session | null | undefined} session
 * @param {number} now
 * @param {PanelFlags} [flags]
 * @returns {PanelState}
 */
export function panelState(session, now, flags = {}) {
  const expired = !canContinue(session, now);
  const expiresAt = (session && session.expiresAt) || 0;
  const remaining = remainingMs(session, now);

  const keySaved = !!flags.keySaved;
  const hasTalked = !!flags.hasTalked;

  const statusHtml = expired
    ? `<span class="validity-dot"></span>本次解卦交流已于 ${escapeHtml(formatDateTime(expiresAt))} 截止`
    : `<span class="validity-dot"></span>解卦交流有效期 · 剩余 ${escapeHtml(formatRemaining(remaining))}（至 ${escapeHtml(formatDateTime(expiresAt))}）`;

  const keyStatusHtml = expired
    ? ''
    : keySaved
      ? `🔑 已保存本机 Key（…${escapeHtml(flags.keyLast4 || '')}） · 模型 ${escapeHtml(flags.model || '')} ` +
        `<button class="chat-link btn-change-key">更换 / 清除</button>`
      : '尚未保存 Key：应用内对话不可用，可点「生成解卦提示」复制到外部 AI。';

  // 开始对话后收起快捷回复，避免干扰
  const chips =
    !expired && !hasTalked ? quickChips((session && session.movingIndices) || []) : [];

  return {
    expired,
    remaining,
    statusHtml,
    keyStatusHtml,
    feedbackLabel: flags.feedbackOpen ? '收起反馈' : '记录反馈',
    // 有 Key 时设置行默认收起，点「更换 / 清除」才展开
    showKeyRow: !expired && (!keySaved || !!flags.editingKey),
    showChips: chips.length > 0,
    chips,
    showComposer: !expired,
  };
}

/**
 * 首次进入的模型摘要气泡。
 * @param {{ primary: Hexagram, transformed: Hexagram, movingLines: MovingLine[], expiresAt?: number }} input
 * @returns {string}
 */
export function introText(input) {
  const p = input.primary;
  const t = input.transformed;
  const mls = input.movingLines || [];

  let text = `本次得到「${p.symbol} ${p.name}」。\n${p.judgment}`;
  if (mls.length) {
    text += `\n\n动爻在${mls.map((m) => m.position).join('、')}，会转为「${t.symbol} ${t.name}」。`;
  } else {
    text += '\n\n六爻皆静，以本卦卦辞为占。';
  }
  if (input.expiresAt) {
    text += `\n\n解卦交流 ${HOURS} 小时内有效，至 ${formatDateTime(input.expiresAt)}。`;
  }
  text += '\n\n想从哪里聊起？可以直接问我。';
  return text;
}

/**
 * @param {number[]} movingIndices
 * @returns {string[]}
 */
export function quickChips(movingIndices) {
  const hasMoving = Array.isArray(movingIndices) && movingIndices.length > 0;
  return [
    '这次卦象的核心提示是什么？',
    hasMoving ? '动爻在提醒我什么？' : '静卦该怎么理解？',
    hasMoving ? '变卦的趋势如何？' : '我该注意什么？',
    '用三点帮我总结',
  ];
}

/**
 * @param {string[]} chips
 * @returns {string}
 */
export function chipsHtml(chips) {
  return chips
    .map(
      (q) =>
        `<button type="button" class="chat-chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`
    )
    .join('');
}

/**
 * Key / 模型设置：只碰本机存储，与 session.js 的 adapter 同形状（可注入测试）。
 * @param {KeyValueStorage | null} storage
 */
export function geminiSettings(storage) {
  function key() {
    try {
      return (storage && storage.getItem(GEMINI_KEY_STORAGE)) || '';
    } catch {
      return '';
    }
  }

  /** @param {string} next */
  function saveKey(next) {
    try {
      if (!storage) return;
      if (next) storage.setItem(GEMINI_KEY_STORAGE, next);
      else storage.removeItem(GEMINI_KEY_STORAGE);
    } catch {
      // 隐私模式下 localStorage 可能不可用，忽略
    }
  }

  function model() {
    let stored = '';
    try {
      stored = (storage && storage.getItem(GEMINI_MODEL_STORAGE)) || '';
    } catch {
      stored = '';
    }
    return (
      (stored || GEMINI_MODEL_DEFAULT).trim().replace(/^models\//, '') || GEMINI_MODEL_DEFAULT
    );
  }

  /** @param {string} next */
  function saveModel(next) {
    const clean = (next || '').trim().replace(/^models\//, '');
    try {
      if (!storage) return;
      if (clean && clean !== GEMINI_MODEL_DEFAULT) storage.setItem(GEMINI_MODEL_STORAGE, clean);
      else storage.removeItem(GEMINI_MODEL_STORAGE);
    } catch {
      // 同上，忽略
    }
  }

  return { key, saveKey, model, saveModel };
}

/** @param {string} text */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

/** Panel template. Selectors are private to this module. */
function panelHtml() {
  return `
    <h2>🤖 AI 解卦</h2>
    <p class="chat-desc">用自己的 Gemini API Key 在这里多轮追问；不想配 Key 时，也可一键生成解卦提示，复制到任意 AI 助手。Key 仅保存在本机浏览器，不会上传到任何服务器。可在 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> 免费获取。</p>

    <div class="chat-validity"></div>

    <div class="chat-expired" hidden>
      <div class="ce-title">解卦交流已截止</div>
      <p class="ce-text">占卦为一时之像，本次卦象的解读到 <span class="chat-expired-at"></span> 为止。此后只能记录反馈，不再解卦。</p>
    </div>

    <div class="chat-settings">
      <label class="chat-field">
        <span class="chat-field-label">API Key</span>
        <input class="prompt-input gemini-key" type="password" placeholder="粘贴 Gemini API Key（留空则保留已存 Key）" autocomplete="off" spellcheck="false">
      </label>
      <label class="chat-field">
        <span class="chat-field-label">模型</span>
        <input class="prompt-input gemini-model" autocomplete="off" spellcheck="false">
      </label>
      <div class="chat-btn-row">
        <button class="btn-secondary chat-mini-btn btn-save-key">保存</button>
        <button class="btn-secondary chat-mini-btn btn-clear-key">清除 Key</button>
      </div>
      <p class="chat-hint">Key 只保存在本机浏览器 · <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">去 AI Studio 免费获取</a></p>
    </div>

    <p class="chat-status"></p>
    <div class="chat-log"></div>
    <div class="chat-chips"></div>
    <div class="chat-composer">
      <textarea class="chat-input" rows="1" placeholder="请解读本次卦象，或追问你想知道的…" enterkeyhint="send"></textarea>
      <button class="chat-send btn-chat-send" type="button" aria-label="发送">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>

    <div class="chat-foot-row">
      <button class="chat-foot-link btn-toggle-prompt" type="button">📋 生成解卦提示</button>
      <button class="chat-foot-link btn-feedback-toggle" type="button">记录反馈</button>
    </div>

    <div class="prompt-output" hidden>
      <div class="prompt-head">
        <span class="prompt-label">📋 解卦提示（复制到外部 AI）</span>
      </div>
      <pre class="prompt-text"></pre>
      <div class="prompt-actions">
        <button class="btn-secondary prompt-btn btn-copy-prompt" type="button">📋 复制</button>
        <button class="btn-primary prompt-btn btn-share-ai" type="button">🚀 在 Gemini 中打开</button>
      </div>
      <span class="copy-feedback"></span>
    </div>

    <div class="chat-feedback" hidden>
      <div class="feedback-head">
        <span class="feedback-title">反馈</span>
        <span class="feedback-sub">只存档，不再解卦</span>
      </div>
      <textarea class="prompt-input feedback-input" rows="2" placeholder="事情后来如何？记下来，日后回看…" enterkeyhint="done"></textarea>
      <div class="feedback-actions">
        <button class="btn-secondary chat-mini-btn btn-feedback-save" type="button">记录反馈</button>
      </div>
    </div>
  `;
}

/**
 * Mount the 解卦面板 into `container`.
 * @param {ChatPanelOptions} options
 * @returns {ChatPanelHandle}
 */
export function mountChatPanel(options) {
  const now = options.now || Date.now;
  const store = options.store;
  const brief = options.brief;
  const gemini = options.gemini;
  const settings = geminiSettings(
    typeof localStorage === 'undefined' ? null : /** @type {KeyValueStorage} */ (localStorage)
  );

  /** @type {Session} */
  let session = options.session;
  /** @type {Reading} */
  let reading = options.reading;

  const root = document.createElement('div');
  root.className = 'result-section chat-section';
  root.innerHTML = panelHtml();

  /** @template {HTMLElement} T @param {string} selector @param {new () => T} [kind] @returns {T | null} */
  const q = (selector, kind) =>
    /** @type {T | null} */ (/** @type {unknown} */ (root.querySelector(selector)));

  /** @type {{ history: { role: 'user' | 'model', text: string }[], system: string, busy: boolean, feedbackOpen: boolean, editingKey: boolean, hasTalked: boolean, destroyed: boolean }} */
  const ui = {
    history: [],
    system: '',
    busy: false,
    feedbackOpen: false,
    editingKey: false,
    // 临时会话（dev 快捷出结果）不落消息，所以「谈过没」不能只看会话记录
    hasTalked: false,
    destroyed: false,
  };

  const abort = new AbortController();

  // ── pure-ish view state ────────────────────────────
  function currentState() {
    const key = settings.key();
    const messages = (session && session.messages) || [];
    return panelState(session, now(), {
      busy: ui.busy,
      feedbackOpen: ui.feedbackOpen,
      editingKey: ui.editingKey,
      keySaved: !!key,
      keyLast4: key.slice(-4),
      model: settings.model(),
      hasTalked: messages.some((m) => !m.kind && m.role === 'user') || ui.hasTalked,
    });
  }

  function updatePromptToggleUI() {
    const out = q('.prompt-output');
    const btn = q('.btn-toggle-prompt');
    if (!btn) return;
    const open = !!out && !out.hidden;
    btn.textContent = open ? '收起解卦提示' : '📋 生成解卦提示';
    btn.classList.toggle('active', open);
  }

  function updateShareButtonUI() {
    const btn = q('.btn-share-ai');
    if (btn) btn.textContent = gemini.available === false ? '📋 复制到豆包' : '🚀 在 Gemini 中打开';
  }

  /** 把纯视图状态写进 DOM；不做任何决策 */
  function render() {
    if (ui.destroyed) return;
    const view = currentState();

    const strip = q('.chat-validity');
    if (strip) {
      strip.classList.toggle('is-expired', view.expired);
      strip.innerHTML = view.statusHtml;
    }

    const notice = q('.chat-expired');
    if (notice) notice.hidden = !view.expired;
    const expiredAt = q('.chat-expired-at');
    if (expiredAt) expiredAt.textContent = formatDateTime(session.expiresAt);

    const keyRow = q('.chat-settings');
    if (keyRow) keyRow.style.display = view.showKeyRow ? 'flex' : 'none';

    const status = q('.chat-status');
    if (status) status.innerHTML = view.expired ? '' : view.keyStatusHtml;

    const chips = q('.chat-chips');
    if (chips) {
      chips.style.display = view.showChips ? '' : 'none';
      chips.innerHTML = view.showChips ? chipsHtml(view.chips) : '';
    }

    const composer = q('.chat-composer');
    if (composer) composer.hidden = !view.showComposer;

    const input = q('.chat-input');
    if (input) input.hidden = !view.showComposer;

    const send = /** @type {HTMLButtonElement | null} */ (q('.btn-chat-send'));
    if (send) {
      send.hidden = !view.showComposer;
      send.disabled = view.expired || ui.busy;
      send.classList.toggle('is-busy', ui.busy);
      send.setAttribute('aria-label', ui.busy ? '解卦中' : '发送');
    }

    const foot = q('.chat-foot-row');
    if (foot) foot.hidden = view.expired;

    const feedbackToggle = q('.btn-feedback-toggle');
    if (feedbackToggle) {
      feedbackToggle.hidden = view.expired;
      feedbackToggle.textContent = view.feedbackLabel;
    }

    const out = q('.prompt-output');
    if (out && view.expired) out.hidden = true;
    updatePromptToggleUI();

    const feedback = q('.chat-feedback');
    if (feedback) feedback.hidden = !(view.expired || ui.feedbackOpen);

    const modelInput = /** @type {HTMLInputElement | null} */ (q('.gemini-model'));
    if (modelInput && !modelInput.matches(':focus')) modelInput.value = settings.model();

    updateShareButtonUI();
  }

  // ── log ────────────────────────────────────────────
  /**
   * @param {BubbleRole} role
   * @param {string} text
   * @param {{ persist?: boolean, kind?: 'intro' }} [bubbleOptions]
   * @returns {HTMLElement | null}
   */
  function appendBubble(role, text, bubbleOptions = {}) {
    const log = q('.chat-log');
    if (!log) return null;
    const el = document.createElement('div');
    el.className = `chat-msg ${role}`;
    el.innerHTML =
      role === 'feedback'
        ? `<span class="feedback-tag">反馈</span>${formatChatText(text)}`
        : formatChatText(text);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;

    // 只在真正产生内容时落盘；重建历史时传 persist:false
    if (bubbleOptions.persist) {
      if (role === 'user' || role === 'model' || role === 'feedback') {
        store.appendMessage(session, role, text, { kind: bubbleOptions.kind });
      }
    }
    return el;
  }

  function appendTyping() {
    const el = appendBubble('pending', '');
    if (el) el.innerHTML = '<span class="typing-dots" aria-label="解卦中"><i></i><i></i><i></i></span>';
    return el;
  }

  /** 从会话记录重建气泡（不重新写入存储） */
  function renderLog() {
    const log = q('.chat-log');
    if (!log) return;
    log.innerHTML = '';
    ui.history = conversation(session);

    const messages = (session && session.messages) || [];
    if (!messages.length) {
      const text = introText({
        primary: reading.primary,
        transformed: reading.transformed,
        movingLines: reading.movingLines,
        expiresAt: session.expiresAt,
      });
      appendBubble('model', text, { persist: true, kind: 'intro' });
    } else {
      for (const m of messages) {
        appendBubble(/** @type {BubbleRole} */ (m.role), m.text);
      }
    }
    render();
  }

  function resetTransient() {
    ui.history = [];
    ui.system = '';
    ui.busy = false;
    ui.feedbackOpen = false;
    ui.editingKey = false;
    ui.hasTalked = false;
  }

  // ── actions ────────────────────────────────────────
  function blockedByExpiry() {
    if (canContinue(session, now())) return false;
    render();
    showToast('本次交流已截止，只能记录反馈');
    return true;
  }

  function saveKeyFromInput() {
    const keyInput = /** @type {HTMLInputElement | null} */ (q('.gemini-key'));
    const modelInput = /** @type {HTMLInputElement | null} */ (q('.gemini-model'));
    if (!keyInput || !modelInput) return;

    // 留空 = 只改模型，不动已存的 Key（清除 Key 用单独的按钮）
    const key = keyInput.value.trim();
    if (key) settings.saveKey(key);
    settings.saveModel(modelInput.value);
    keyInput.value = '';
    ui.editingKey = false;

    // Key / 模型变更后只重置服务端会话句柄，本地记录与对话保留
    store.resetTransport(session);
    render();
    showToast('Gemini 设置已保存');
  }

  function clearKey() {
    settings.saveKey('');
    const keyInput = /** @type {HTMLInputElement | null} */ (q('.gemini-key'));
    if (keyInput) keyInput.value = '';
    ui.editingKey = false;
    store.resetTransport(session);
    render();
    showToast('已清除本机 Key');
  }

  function toggleFeedbackComposer() {
    if (blockedByExpiry()) return;
    ui.feedbackOpen = !ui.feedbackOpen;
    render();
    if (ui.feedbackOpen) {
      const input = q('.feedback-input');
      if (input) setTimeout(() => input.focus({ preventScroll: true }), 60);
    }
  }

  function saveFeedback() {
    const input = q('.feedback-input');
    if (!(input instanceof HTMLTextAreaElement)) return;
    const text = input.value.trim();
    if (!text) return;

    appendBubble('feedback', text, { persist: true });
    input.value = '';
    autoGrow(input);
    showToast('反馈已记录在本机');

    // 记录反馈后把面板留在原位，方便继续补记
    if (canContinue(session, now())) {
      ui.feedbackOpen = true;
      render();
    }
  }

  /** 解卦提示与对话共用同一个输入框：先看当前输入，再退回最后一条提问 */
  function currentQuestion() {
    const input = q('.chat-input');
    const typed = input instanceof HTMLTextAreaElement ? input.value.trim() : '';
    if (typed) return typed;
    const lastUser = [...ui.history].reverse().find((m) => m.role === 'user');
    return lastUser ? lastUser.text : '';
  }

  function generatePrompt() {
    if (blockedByExpiry()) return '';
    const out = q('.prompt-output');
    const pre = q('.prompt-text');
    if (!out || !pre) return '';
    const text = brief.fullPrompt(currentQuestion());
    pre.textContent = text;
    out.hidden = false;
    const feedback = q('.copy-feedback');
    if (feedback) feedback.textContent = '';
    updatePromptToggleUI();
    return text;
  }

  // 同一个入口：没展开就生成，已展开就收起
  function togglePromptOutput() {
    const out = q('.prompt-output');
    if (!out) return;
    if (out.hidden) generatePrompt();
    else {
      out.hidden = true;
      updatePromptToggleUI();
    }
  }

  async function copyPrompt() {
    if (blockedByExpiry()) return;
    const pre = q('.prompt-text');
    const text = pre ? pre.textContent || '' : '';
    if (!text) return;
    await copyText(text);
    const feedback = q('.copy-feedback');
    if (feedback) {
      feedback.textContent = '✅ 已复制！';
      setTimeout(() => {
        feedback.textContent = '';
      }, 2000);
    }
  }

  async function shareToGemini() {
    if (blockedByExpiry()) return;
    const pre = q('.prompt-text');
    const text = pre ? pre.textContent || '' : '';
    if (!text) return;

    await copyText(text);

    // Try native share — surfaces installed apps (Gemini, Claude, ChatGPT, etc.)
    if (navigator.share) {
      try {
        await navigator.share({ title: '周易起卦 — 解卦请求', text });
        return;
      } catch (err) {
        // User cancelled share sheet — that's fine, do nothing
        if (/** @type {any} */ (err).name !== 'AbortError') {
          console.warn('Share failed:', err);
        }
      }
    }

    window.open(
      gemini.available === false ? 'https://www.doubao.com/' : 'https://gemini.google.com',
      '_blank'
    );
  }

  async function sendMessage() {
    if (ui.busy) return;

    // 占卦为一时之像：有效期过后不再解卦，只留反馈
    if (blockedByExpiry()) return;

    const input = q('.chat-input');
    if (!(input instanceof HTMLTextAreaElement)) return;
    const text = input.value.trim();
    if (!text) return;

    if (!settings.key()) {
      const keyRow = q('.chat-settings');
      if (keyRow) keyRow.style.display = 'flex';
      appendBubble('error', '请先在上方保存你的 Gemini API Key。');
      return;
    }
    if (!navigator.onLine) {
      appendBubble('error', '当前处于离线状态，无法调用 Gemini。卦象与解卦提示仍可正常使用。');
      return;
    }

    if (!ui.system) ui.system = brief.systemPrompt();

    input.value = '';
    input.style.height = 'auto';
    const userEl = appendBubble('user', text);
    ui.history.push({ role: 'user', text });

    // 开始对话后收起快捷回复，避免干扰
    const chips = q('.chat-chips');
    if (chips) chips.style.display = 'none';

    ui.busy = true;
    render();
    const typing = appendTyping();

    try {
      const reply = await gemini.request({
        key: settings.key(),
        model: settings.model(),
        text,
        history: ui.history,
        system: ui.system,
        session,
      });
      if (typing) typing.remove();
      if (ui.destroyed) return;
      appendBubble('model', reply.text);
      ui.history.push({ role: 'model', text: reply.text });

      // 成功的一问一答（连同传输层句柄）一次写入本地记录
      store.appendExchange(session, {
        question: text,
        answer: reply.text,
        interactionId: reply.id,
        transport: reply.transport,
      });
      ui.hasTalked = true;
    } catch (err) {
      if (typing) typing.remove();
      ui.history.pop(); // 回滚失败的用户提问，避免污染上下文
      if (userEl) userEl.remove();
      // 把问题放回输入框，方便修改 Key 后重试
      if (!input.value.trim()) input.value = text;
      if (!ui.destroyed) {
        appendBubble('error', '⚠️ ' + (/** @type {any} */ (err).message || '请求失败'));
      }
    } finally {
      ui.busy = false;
      if (!ui.destroyed) {
        autoGrow(input);
        render();
      }
    }
  }

  // ── events (delegated on the panel root) ───────────
  root.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;

      if (target.closest('.btn-save-key')) return saveKeyFromInput();
      if (target.closest('.btn-clear-key')) return clearKey();
      if (target.closest('.btn-change-key')) {
        ui.editingKey = true;
        render();
        const input = q('.gemini-key');
        if (input) input.focus();
        return;
      }
      if (target.closest('.btn-feedback-toggle')) return toggleFeedbackComposer();
      if (target.closest('.btn-feedback-save')) return saveFeedback();
      if (target.closest('.btn-chat-send')) {
        void sendMessage();
        return;
      }
      if (target.closest('.btn-toggle-prompt')) return togglePromptOutput();
      if (target.closest('.btn-copy-prompt')) {
        void copyPrompt();
        return;
      }
      if (target.closest('.btn-share-ai')) {
        void shareToGemini();
        return;
      }

      // 快捷回复 chip
      const chip = target.closest('.chat-chip');
      if (chip) {
        const question = chip instanceof HTMLElement ? chip.dataset.q || '' : '';
        const input = q('.chat-input');
        if (input instanceof HTMLTextAreaElement) input.value = question;
        if (!settings.key()) {
          const keyRow = q('.chat-settings');
          if (keyRow) keyRow.style.display = 'flex';
          showToast('配置 Key 后即可对话；也可点「生成解卦提示」复制到外部 AI');
        } else {
          void sendMessage();
        }
      }
    },
    { signal: abort.signal }
  );

  root.addEventListener(
    'keydown',
    (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;

      // 反馈框：Cmd/Ctrl + Enter 保存（普通 Enter 用于换行）
      if (target.classList.contains('feedback-input')) {
        if (target instanceof HTMLTextAreaElement) autoGrow(target);
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
          event.preventDefault();
          saveFeedback();
        }
        return;
      }

      if (!target.classList.contains('chat-input')) return;
      if (event.key !== 'Enter' || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || !event.shiftKey) {
        event.preventDefault();
        void sendMessage();
      }
    },
    { signal: abort.signal }
  );

  root.addEventListener(
    'input',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.classList.contains('chat-input') || target.classList.contains('feedback-input')) {
        if (target instanceof HTMLTextAreaElement) autoGrow(target);
      }
    },
    { signal: abort.signal }
  );

  // ── 交流有效期 ticker ──────────────────────────────
  const ticker = setInterval(() => {
    if (!ui.destroyed) render();
  }, 1000);

  // ── mount ──────────────────────────────────────────
  options.container.appendChild(root);
  resetTransient();
  renderLog();

  return {
    refresh(nextSession, nextReading) {
      if (ui.destroyed) return;
      if (nextSession) session = nextSession;
      if (nextReading) reading = nextReading;
      resetTransient();
      renderLog();
    },
    destroy() {
      if (ui.destroyed) return;
      ui.destroyed = true;
      clearInterval(ticker);
      abort.abort();
      root.remove();
    },
  };
}
