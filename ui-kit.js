// @ts-check
/* ======================================================
   ui-kit — the small shared UI helpers
   ------------------------------------------------------
   Two panels (解卦面板, 卦历) need the same escaping,
   formatting, and toast. Keeping them here means neither
   panel depends on the other, and both are testable
   without a DOM.

   Interface:
   - escapeHtml(s)            → s, HTML-escaped
   - formatChatText(t)        → 极简 Markdown（标题/加粗/列表）
   - formatClock(ts)          → '09:05'
   - formatDateTime(ts)       → '11月24日 09:05'
   - formatRemaining(ms)      → '3 小时 12 分' | '12 分 05 秒'
   - autoGrow(el)             → textarea 随内容长高（DOM，容错）
   - showToast(message)       → 页面底部提示（body 级，自建元素）
   ====================================================== */

/**
 * @param {unknown} str
 * @returns {string}
 */
export function escapeHtml(str) {
  /** @type {Record<string, string>} */
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(str).replace(/[&<>"']/g, (c) => entities[c] || c);
}

/** 极简 Markdown：先转义，再只识别标题 / 加粗 / 列表 */
/**
 * @param {unknown} text
 * @returns {string}
 */
export function formatChatText(text) {
  return escapeHtml(text)
    .replace(/^#{1,6}\s*(.+)$/gm, '<strong>$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s+/gm, '· ');
}

/**
 * @param {number} ts
 * @returns {string}
 */
export function formatClock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * @param {number} ts
 * @returns {string}
 */
export function formatDateTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${formatClock(ts)}`;
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 小时 ${String(m).padStart(2, '0')} 分`;
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`;
}

/** @type {{ timer: ReturnType<typeof setTimeout> | null }} */
const toast = { timer: null };

/**
 * @param {{ id?: string }} [options]
 * @returns {HTMLElement | null}
 */
export function toastElement(options = {}) {
  const id = options.id || 'chat-toast';
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'chat-toast';
    document.body.appendChild(el);
  }
  return el;
}

/**
 * @param {string} message
 * @param {{ element?: HTMLElement | null }} [options]
 */
export function showToast(message, options = {}) {
  const el = options.element || toastElement();
  if (!el) return;
  el.textContent = message;
  void el.offsetWidth; // 重置动画
  el.classList.add('show');
  if (toast.timer) clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

/**
 * 输入框随内容自动长高（最多 120px）。
 * @param {HTMLTextAreaElement | null | undefined} el
 */
export function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
