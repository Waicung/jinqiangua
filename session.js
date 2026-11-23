// @ts-check
/* ======================================================
   会话 — one 起卦 record, its 交流有效期, and 卦历 storage
   ------------------------------------------------------
   Interface contract:
   - one Session record is the single home for one 起卦:
     numbers, 本卦/变卦 ids, 动爻, messages, transport handle
   - canContinue(session, now) is the only 交流有效期 gate
   - the store is the only writer; every mutation goes through
     create / appendMessage / appendExchange / resetTransport
   - storage adapters touch bytes only (read / write / clear);
     validation and the 100-record cap live in this module
   - ephemeral sessions (dev 快捷出结果) never touch storage
   - records keep the iching_sessions_v1 shape; no migration
   ====================================================== */

/** @typedef {import('./hexagram.js').Reading} Reading */

/** @typedef {'user'|'model'|'feedback'} MessageRole */
/** @typedef {'interactions'|'generateContent'} Transport */

/**
 * @typedef {object} SessionMessage
 * @property {MessageRole} role
 * @property {string} text
 * @property {number} at
 * @property {'intro'} [kind] intro 只是开场摘要，不属于 API 上下文
 */

/**
 * @typedef {object} Session
 * @property {string} id
 * @property {number} createdAt
 * @property {number} expiresAt
 * @property {number[]} numbers
 * @property {number} primaryId
 * @property {number} transformedId
 * @property {number[]} movingIndices
 * @property {SessionMessage[]} messages
 * @property {string} previousInteractionId
 * @property {Transport} transport
 * @property {boolean} [ephemeral]
 */

/**
 * Byte-level storage: read returns parsed JSON (or [] when unavailable),
 * write / clear are best-effort and never throw.
 * @typedef {object} SessionStorage
 * @property {() => unknown[]} read
 * @property {(list: Session[]) => void} write
 * @property {() => void} clear
 */

/**
 * @typedef {object} KeyValueStorage
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 */

/**
 * @typedef {object} Exchange
 * @property {string} question
 * @property {string} answer
 * @property {string} [interactionId]
 * @property {Transport} transport
 * @property {number} [now]
 */

/**
 * @typedef {object} SessionStore
 * @property {(numbers: number[], reading: Reading, options?: { now?: number, persist?: boolean }) => Session} create
 * @property {(session: Session | null, role: MessageRole, text: string, options?: { kind?: 'intro', now?: number }) => SessionMessage | null} appendMessage
 * @property {(session: Session | null, exchange: Exchange) => void} appendExchange
 * @property {(session: Session | null) => void} resetTransport
 * @property {() => Session[]} list
 * @property {(id: string) => Session | null} get
 * @property {() => void} clear
 */

/** 交流有效期：占卦为一时之像，24 小时后只留反馈 */
export const CHAT_VALID_MS = 24 * 60 * 60 * 1000;
export const SESSION_MAX = 100;
export const SESSIONS_KEY = 'iching_sessions_v1';
/** @type {Transport} */
export const DEFAULT_TRANSPORT = 'interactions';

/**
 * The one 交流有效期 gate: a session can continue only before its deadline.
 * A record without a deadline (corrupt or pre-expiry schema) cannot continue.
 * @param {Session | null | undefined} session
 * @param {number} now
 * @returns {boolean}
 */
export function canContinue(session, now) {
  if (!session) return false;
  return Number.isFinite(session.expiresAt) && now < session.expiresAt;
}

/**
 * Milliseconds left in the 交流有效期, clamped at zero.
 * @param {Session | null | undefined} session
 * @param {number} now
 * @returns {number}
 */
export function remainingMs(session, now) {
  if (!session || !Number.isFinite(session.expiresAt)) return 0;
  return Math.max(0, session.expiresAt - now);
}

/**
 * The API context: 问答 only. intro 摘要 and 反馈 are stored but not replayed.
 * @param {Session | null | undefined} session
 * @returns {{ role: 'user' | 'model', text: string }[]}
 */
export function conversation(session) {
  const messages = (session && session.messages) || [];
  /** @type {{ role: 'user' | 'model', text: string }[]} */
  const turns = [];
  for (const message of messages) {
    if (message.kind) continue;
    if (message.role !== 'user' && message.role !== 'model') continue;
    turns.push({ role: message.role, text: message.text });
  }
  return turns;
}

/**
 * Production adapter. Missing / corrupt / non-array JSON reads as no records,
 * and a full or blocked localStorage silently degrades.
 * @param {KeyValueStorage} storage
 * @param {string} [key]
 * @returns {SessionStorage}
 */
export function localStorageAdapter(storage, key = SESSIONS_KEY) {
  return {
    read() {
      try {
        const raw = storage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    write(list) {
      try {
        storage.setItem(key, JSON.stringify(list));
      } catch {
        // 隐私模式 / 配额满：记录功能静默降级，不影响起卦
      }
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch {
        // 同上
      }
    },
  };
}

/**
 * Test / in-process adapter: same contract, no browser storage.
 * @param {unknown[]} [initial]
 * @returns {SessionStorage}
 */
export function memoryAdapter(initial = []) {
  let items = Array.isArray(initial) ? initial.slice() : [];
  return {
    read: () => items.slice(),
    write: (list) => {
      items = list.slice();
    },
    clear: () => {
      items = [];
    },
  };
}

/**
 * @param {unknown} value
 * @returns {value is Session}
 */
function isSession(value) {
  if (!value || typeof value !== 'object') return false;
  const s = /** @type {Record<string, any>} */ (value);
  return (
    typeof s.id === 'string' &&
    Number.isFinite(s.createdAt) &&
    Array.isArray(s.numbers) &&
    s.numbers.length === 6 &&
    s.numbers.every((/** @type {unknown} */ n) => typeof n === 'number' && n >= 6 && n <= 9) &&
    Array.isArray(s.messages)
  );
}

/**
 * The 会话 store. Inject the adapter (localStorage in prod, memory in tests)
 * and optionally a clock; every write goes through this object.
 * @param {SessionStorage} storage
 * @param {{ now?: () => number, random?: () => number }} [options]
 * @returns {SessionStore}
 */
export function createSessionStore(storage, options = {}) {
  const now = options.now || Date.now;
  const random = options.random || Math.random;

  /** @returns {Session[]} 卦历，按起卦时间倒序 */
  function list() {
    return storage
      .read()
      .filter(isSession)
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** @param {Session} session */
  function put(session) {
    const records = list().filter((s) => s.id !== session.id);
    records.push(session);
    storage.write(
      records.sort((a, b) => b.createdAt - a.createdAt).slice(0, SESSION_MAX)
    );
  }

  /**
   * @param {number} createdAt
   * @returns {string}
   */
  function newId(createdAt) {
    return `s_${createdAt.toString(36)}_${random().toString(36).slice(2, 7)}`;
  }

  return {
    create(numbers, reading, createOptions = {}) {
      const createdAt = createOptions.now ?? now();
      /** @type {Session} */
      const session = {
        id: newId(createdAt),
        createdAt,
        expiresAt: createdAt + CHAT_VALID_MS,
        numbers: numbers.slice(),
        primaryId: reading.primary.id,
        transformedId: reading.transformed.id,
        movingIndices: reading.movingLines.map((m) => m.index),
        messages: [],
        previousInteractionId: '',
        transport: DEFAULT_TRANSPORT,
      };
      if (createOptions.persist === false) session.ephemeral = true;
      else put(session);
      return session;
    },

    appendMessage(session, role, text, appendOptions = {}) {
      if (!session || !session.id || session.ephemeral) return null;
      /** @type {SessionMessage} */
      const message = {
        role,
        text,
        at: appendOptions.now ?? now(),
        ...(appendOptions.kind ? { kind: appendOptions.kind } : {}),
      };
      session.messages.push(message);
      put(session);
      return message;
    },

    // 成功的一问一答才落盘：两个气泡 + 传输层句柄一次写入
    appendExchange(session, exchange) {
      if (!session || !session.id) return;
      // 临时会话（dev 快捷出结果）不落盘，但仍记住本轮传输层
      if (session.ephemeral) {
        if (exchange.interactionId) session.previousInteractionId = exchange.interactionId;
        session.transport = exchange.transport;
        return;
      }
      const at = exchange.now ?? now();
      session.messages.push({ role: 'user', text: exchange.question, at });
      session.messages.push({ role: 'model', text: exchange.answer, at });
      if (exchange.interactionId) session.previousInteractionId = exchange.interactionId;
      session.transport = exchange.transport;
      put(session);
    },

    // Key / 模型变更：服务端会话句柄作废，本地记录与对话保留
    resetTransport(session) {
      if (!session) return;
      session.previousInteractionId = '';
      session.transport = DEFAULT_TRANSPORT;
      if (!session.ephemeral) put(session);
    },

    list,

    get(id) {
      return list().find((s) => s.id === id) || null;
    },

    clear() {
      storage.clear();
    },
  };
}
