// @ts-check
/* ======================================================
   history-panel — the 卦历 overlay as one mounted module
   ------------------------------------------------------
   Interface:

     mountHistoryPanel({ store, hexagramById, onOpenSession })
       → { open(), close(), refresh(), destroy(), isOpen() }

     historyItems(records, now, hexagramById) → HistoryItem[]  (pure)
     historyItemHtml(item) → string                            (pure)

   The overlay is body-level and long-lived: it is mounted once at
   init, not per result page. It owns the overlay element, the list
   render, the 清空 confirm, backdrop / Escape close, and `body.history-open`.

   Session *selection* stays with the caller: the module reports the
   clicked id through `onOpenSession(id)` and closes itself. That keeps
   卦历 and 解卦面板 from both owning "which 会话 is current".
   ====================================================== */

import { CHAT_VALID_MS, canContinue } from './session.js';
import { escapeHtml, formatDateTime, showToast } from './ui-kit.js';

/** @typedef {import('./session.js').Session} Session */
/** @typedef {import('./session.js').SessionStore} SessionStore */
/** @typedef {import('./hexagram.js').Hexagram} Hexagram */


/**
 * @typedef {object} HistoryItem
 * @property {string} id
 * @property {string} title 本卦
 * @property {string} change 变卦 / 静卦
 * @property {string} meta 时间 · 问答数 · 反馈数
 * @property {boolean} expired
 */

/**
 * @typedef {object} HistoryPanelOptions
 * @property {SessionStore} store
 * @property {(id: number) => Hexagram} hexagramById 表已在上层绑定，这里只要 id → 卦
 * @property {(id: string) => void} onOpenSession
 * @property {() => number} [now]
 */

/**
 * @typedef {object} HistoryPanelHandle
 * @property {() => void} open
 * @property {() => void} close
 * @property {() => void} refresh
 * @property {() => boolean} isOpen
 * @property {() => void} destroy
 */

const HOURS = Math.round(CHAT_VALID_MS / 3600000);

/**
 * The pure list model: one row per record, ordered as the store returns them.
 * @param {Session[]} records
 * @param {number} now
 * @param {(id: number) => Hexagram} hexagramById
 * @returns {HistoryItem[]}
 */
export function historyItems(records, now, hexagramById) {
  return records.map((session) => {
    const p = hexagramById(session.primaryId);
    const t = hexagramById(session.transformedId);
    const moving = (session.movingIndices || []).length;
    const messages = session.messages || [];
    const rounds = messages.filter((m) => !m.kind && m.role === 'user').length;
    const feedbacks = messages.filter((m) => m.role === 'feedback').length;

    const meta = [
      formatDateTime(session.createdAt),
      rounds ? `${rounds} 问` : '未解卦',
      feedbacks ? `${feedbacks} 条反馈` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return {
      id: session.id,
      title: p ? `${p.symbol} ${p.name}` : '未知卦',
      change: moving > 0 && t ? `变 ${t.symbol} ${t.name} · ${moving} 爻动` : '六爻皆静',
      meta,
      expired: !canContinue(session, now),
    };
  });
}

/**
 * @param {HistoryItem} item
 * @returns {string}
 */
export function historyItemHtml(item) {
  const status = item.expired ? '已截止' : '交流中';
  return `
    <button type="button" class="history-item" data-session="${escapeHtml(item.id)}">
      <span class="hi-top">
        <span class="hi-gan">${escapeHtml(item.title)}</span>
        <span class="hi-status ${item.expired ? 'expired' : 'open'}">${status}</span>
      </span>
      <span class="hi-change">${escapeHtml(item.change)}</span>
      <span class="hi-meta">${escapeHtml(item.meta)}</span>
    </button>`;
}

const EMPTY_HTML =
  '<p class="history-empty">还没有记录。起一卦，解卦对话会自动存在本机。</p>';

/**
 * @param {HistoryPanelOptions} options
 * @returns {HistoryPanelHandle}
 */
export function mountHistoryPanel(options) {
  const now = options.now || Date.now;
  const store = options.store;

  const overlay = document.createElement('div');
  overlay.id = 'history-overlay';
  overlay.className = 'history-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="history-sheet" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div class="history-head">
        <div>
          <div id="history-title" class="history-title">卦历</div>
          <div class="history-sub">本机保存 · 解卦交流 ${HOURS} 小时</div>
        </div>
        <button class="history-close" aria-label="关闭卦历">×</button>
      </div>
      <div class="history-list"></div>
      <div class="history-foot">
        <button class="chat-text-btn btn-history-clear">清空全部记录</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  /** @type {HTMLElement | null} */
  const listEl = overlay.querySelector('.history-list');

  function isOpen() {
    return !overlay.hidden;
  }

  function render() {
    if (!listEl) return;
    const records = store.list();
    if (!records.length) {
      listEl.innerHTML = EMPTY_HTML;
      return;
    }
    listEl.innerHTML = historyItems(records, now(), options.hexagramById)
      .map(historyItemHtml)
      .join('');
  }

  function open() {
    render();
    overlay.hidden = false;
    document.body.classList.add('history-open');
  }

  function close() {
    overlay.hidden = true;
    document.body.classList.remove('history-open');
  }

  function clearAll() {
    if (!store.list().length) return;
    if (!window.confirm('清空本机所有起卦记录？此操作不可撤销。')) return;
    store.clear();
    render();
    showToast('本机记录已清空');
  }

  const abort = new AbortController();

  overlay.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;

      if (target.closest('.history-close')) return close();
      if (target.closest('.btn-history-clear')) return clearAll();

      // 点遮罩本身（不是 sheet 内部）关闭
      const item = target.closest('.history-item');
      if (item) {
        const id = item instanceof HTMLElement ? item.dataset.session || '' : '';
        close();
        options.onOpenSession(id);
        return;
      }
      if (event.target === overlay) close();
    },
    { signal: abort.signal }
  );

  // Escape 只在这个覆盖层可见时才有意义，所以监听留在这里
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && isOpen()) close();
    },
    { signal: abort.signal }
  );

  return {
    open,
    close,
    refresh: render,
    isOpen,
    destroy() {
      abort.abort();
      overlay.remove();
      document.body.classList.remove('history-open');
    },
  };
}
