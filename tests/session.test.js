import { describe, expect, test } from 'bun:test';
import table from '../data/iching.json';
import { deriveReading } from '../hexagram.js';
import {
  CHAT_VALID_MS,
  SESSION_MAX,
  SESSIONS_KEY,
  canContinue,
  conversation,
  createSessionStore,
  localStorageAdapter,
  memoryAdapter,
  remainingMs,
} from '../session.js';

const NUMBERS = [7, 8, 7, 8, 7, 8];
const reading = deriveReading(NUMBERS, table);
const T0 = 1_700_000_000_000;

/** 固定时钟 + 固定 id 后缀，让断言可复现 */
function newStore(clock = T0) {
  const storage = memoryAdapter();
  const store = createSessionStore(storage, { now: () => clock, random: () => 0.5 });
  return { storage, store };
}

function fakeStorage(seed = {}) {
  const items = new Map(Object.entries(seed));
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => {
      items.set(key, String(value));
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

/** 记录 adapter 被调用的次数，用来断言“一次写入” */
function counting(storage) {
  const counts = { read: 0, write: 0, clear: 0 };
  return {
    counts,
    adapter: {
      read: () => {
        counts.read++;
        return storage.read();
      },
      write: (list) => {
        counts.write++;
        storage.write(list);
      },
      clear: () => {
        counts.clear++;
        storage.clear();
      },
    },
  };
}

const rawSession = (overrides = {}) => ({
  id: 's_raw',
  createdAt: 1,
  expiresAt: 1 + CHAT_VALID_MS,
  numbers: [...NUMBERS],
  primaryId: 1,
  transformedId: 2,
  movingIndices: [],
  messages: [],
  previousInteractionId: '',
  transport: 'interactions',
  ...overrides,
});

describe('createSessionStore.create：一条 会话记录', () => {
  test('记录形状与 iching_sessions_v1 保持一致', () => {
    const { store } = newStore();
    const session = store.create(NUMBERS, reading);

    expect(Object.keys(session).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'id',
      'messages',
      'movingIndices',
      'numbers',
      'previousInteractionId',
      'primaryId',
      'transformedId',
      'transport',
    ]);
    expect(session.id.startsWith('s_')).toBe(true);
    expect(session.createdAt).toBe(T0);
    expect(session.expiresAt).toBe(T0 + CHAT_VALID_MS);
    expect(session.numbers).toEqual(NUMBERS);
    expect(session.primaryId).toBe(reading.primary.id);
    expect(session.transformedId).toBe(reading.transformed.id);
    expect(session.movingIndices).toEqual([]);
    expect(session.messages).toEqual([]);
    expect(session.previousInteractionId).toBe('');
    expect(session.transport).toBe('interactions');
  });

  test('numbers 是副本', () => {
    const { store } = newStore();
    const numbers = [...NUMBERS];
    const session = store.create(numbers, reading);
    numbers[0] = 9;
    expect(session.numbers).toEqual(NUMBERS);
  });

  test('默认落盘，ephemeral 不落盘', () => {
    const { storage, store } = newStore();
    store.create(NUMBERS, reading);
    expect(storage.read()).toHaveLength(1);

    const ephemeral = store.create(NUMBERS, reading, { persist: false });
    expect(ephemeral.ephemeral).toBe(true);
    expect(storage.read()).toHaveLength(1);

    const isolated = newStore();
    isolated.store.create(NUMBERS, reading, { persist: false });
    expect(isolated.storage.read()).toEqual([]);
  });

  test('显式 now 覆盖时钟', () => {
    const { store } = newStore();
    const session = store.create(NUMBERS, reading, { now: T0 + 5_000 });
    expect(session.createdAt).toBe(T0 + 5_000);
    expect(session.expiresAt).toBe(T0 + 5_000 + CHAT_VALID_MS);
  });
});

describe('交流有效期：canContinue / remainingMs', () => {
  const { store } = newStore();
  const session = store.create(NUMBERS, reading);

  test('截止前可继续，整点截止', () => {
    expect(canContinue(session, session.createdAt)).toBe(true);
    expect(canContinue(session, session.expiresAt - 1)).toBe(true);
    expect(canContinue(session, session.expiresAt)).toBe(false);
    expect(canContinue(session, session.expiresAt + 1)).toBe(false);
  });

  test('没有记录或没有截止时间都不能继续', () => {
    expect(canContinue(null, T0)).toBe(false);
    expect(canContinue(undefined, T0)).toBe(false);
    expect(canContinue(rawSession({ expiresAt: undefined }), T0)).toBe(false);
    expect(canContinue(rawSession({ expiresAt: NaN }), T0)).toBe(false);
  });

  test('剩余时间从 24 小时倒数到 0', () => {
    expect(remainingMs(session, session.createdAt)).toBe(CHAT_VALID_MS);
    expect(remainingMs(session, session.expiresAt - 1_000)).toBe(1_000);
    expect(remainingMs(session, session.expiresAt)).toBe(0);
    expect(remainingMs(session, session.expiresAt + 60_000)).toBe(0);
    expect(remainingMs(null, T0)).toBe(0);
  });
});

describe('卦历：list / get / clear', () => {
  test('按 createdAt 倒序', () => {
    const { store } = newStore();
    store.create(NUMBERS, reading, { now: 1 });
    store.create(NUMBERS, reading, { now: 3 });
    store.create(NUMBERS, reading, { now: 2 });
    expect(store.list().map((s) => s.createdAt)).toEqual([3, 2, 1]);
  });

  test('静默过滤坏记录', () => {
    const storage = memoryAdapter([
      rawSession({ id: 'good_old', createdAt: 1 }),
      null,
      'nope',
      {},
      rawSession({ id: 'no_messages', messages: undefined }),
      rawSession({ id: 'five_numbers', numbers: [7, 7, 7, 7, 7] }),
      rawSession({ id: 'bad_numbers', numbers: [7, 7, 7, 7, 7, 5] }),
      rawSession({ id: 42 }),
      rawSession({ id: 'good_new', createdAt: 2 }),
    ]);
    const store = createSessionStore(storage);

    expect(store.list().map((s) => s.id)).toEqual(['good_new', 'good_old']);
  });

  test('最多保留 100 条，丢最旧的', () => {
    const { store } = newStore();
    for (let i = 0; i < SESSION_MAX + 5; i++) {
      store.create(NUMBERS, reading, { now: i + 1 });
    }
    const list = store.list();
    expect(list).toHaveLength(SESSION_MAX);
    expect(list[0].createdAt).toBe(SESSION_MAX + 5);
    expect(list.at(-1).createdAt).toBe(6);
  });

  test('按 id 取一条，坏 id 返回 null', () => {
    const { store } = newStore();
    const session = store.create(NUMBERS, reading);
    expect(store.get(session.id)).toEqual(session);
    expect(store.get('s_missing')).toBeNull();
  });

  test('clear 清空 adapter', () => {
    const { storage, store } = newStore();
    store.create(NUMBERS, reading);
    store.clear();
    expect(store.list()).toEqual([]);
    expect(storage.read()).toEqual([]);
  });
});

describe('appendMessage：intro / 问答 / 反馈', () => {
  test('写入时间与 kind，并立即落盘', () => {
    const { storage, store } = newStore();
    const session = store.create(NUMBERS, reading);

    const message = store.appendMessage(session, 'model', '开场', { kind: 'intro' });
    expect(message).toEqual({ role: 'model', text: '开场', at: T0, kind: 'intro' });
    expect(session.messages).toEqual([message]);

    store.appendMessage(session, 'feedback', '事情后来…', { now: T0 + 1 });
    const persisted = storage.read()[0];
    expect(persisted.messages).toHaveLength(2);
    expect(persisted.messages[1]).toEqual({
      role: 'feedback',
      text: '事情后来…',
      at: T0 + 1,
    });
  });

  test('ephemeral 会话不落盘', () => {
    const { storage, store } = newStore();
    const session = store.create(NUMBERS, reading, { persist: false });

    expect(store.appendMessage(session, 'model', 'hi')).toBeNull();
    expect(session.messages).toEqual([]);
    expect(storage.read()).toEqual([]);
  });

  test('没有会话返回 null', () => {
    const { store } = newStore();
    expect(store.appendMessage(null, 'user', 'hi')).toBeNull();
  });
});

describe('appendExchange：成功的一问一答一次写入', () => {
  test('两个气泡 + 传输层句柄一起写入，只写一次', () => {
    const storage = memoryAdapter();
    const { adapter, counts } = counting(storage);
    const store = createSessionStore(adapter, { now: () => T0, random: () => 0.5 });
    const session = store.create(NUMBERS, reading);
    counts.write = 0;

    store.appendExchange(session, {
      question: '怎么解？',
      answer: '看初爻。',
      interactionId: 'i_123',
      transport: 'interactions',
    });

    expect(counts.write).toBe(1);
    expect(session.messages).toEqual([
      { role: 'user', text: '怎么解？', at: T0 },
      { role: 'model', text: '看初爻。', at: T0 },
    ]);
    expect(session.previousInteractionId).toBe('i_123');
    expect(session.transport).toBe('interactions');

    const persisted = storage.read()[0];
    expect(persisted.messages).toEqual(session.messages);
    expect(persisted.previousInteractionId).toBe('i_123');
  });

  test('回退到 generateContent 时记住传输层', () => {
    const { store } = newStore();
    const session = store.create(NUMBERS, reading);

    store.appendExchange(session, {
      question: 'q',
      answer: 'a',
      transport: 'generateContent',
    });

    expect(session.transport).toBe('generateContent');
    expect(session.previousInteractionId).toBe('');
    const next = createSessionStore(memoryAdapter([session]), { now: () => T0 });
    expect(next.list()[0].transport).toBe('generateContent');
  });

  test('没有 interactionId 时保留原句柄', () => {
    const { store } = newStore();
    const session = store.create(NUMBERS, reading);
    session.previousInteractionId = 'i_old';

    store.appendExchange(session, {
      question: 'q',
      answer: 'a',
      transport: 'interactions',
    });

    expect(session.previousInteractionId).toBe('i_old');
  });

  test('ephemeral 会话不写记录，但记住传输层', () => {
    const { storage, store } = newStore();
    const session = store.create(NUMBERS, reading, { persist: false });

    store.appendExchange(session, {
      question: 'q',
      answer: 'a',
      interactionId: 'i_x',
      transport: 'generateContent',
    });

    expect(session.messages).toEqual([]);
    expect(session.previousInteractionId).toBe('i_x');
    expect(session.transport).toBe('generateContent');
    expect(storage.read()).toEqual([]);
  });
});

describe('resetTransport：Key / 模型变更', () => {
  test('清空服务端句柄并落盘，对话保留', () => {
    const { storage, store } = newStore();
    const session = store.create(NUMBERS, reading);
    store.appendExchange(session, {
      question: 'q',
      answer: 'a',
      interactionId: 'i_1',
      transport: 'generateContent',
    });

    store.resetTransport(session);

    expect(session.previousInteractionId).toBe('');
    expect(session.transport).toBe('interactions');
    expect(session.messages).toHaveLength(2);
    expect(storage.read()[0].previousInteractionId).toBe('');
    expect(storage.read()[0].transport).toBe('interactions');
  });

  test('ephemeral 会话只改内存', () => {
    const { storage, store } = newStore();
    const session = store.create(NUMBERS, reading, { persist: false });
    session.previousInteractionId = 'i_1';

    store.resetTransport(session);
    expect(session.previousInteractionId).toBe('');
    expect(storage.read()).toEqual([]);
  });

  test('null 会话是安全的', () => {
    const { store } = newStore();
    expect(() => store.resetTransport(null)).not.toThrow();
  });
});

describe('conversation：API 上下文只含问答', () => {
  test('跳过 intro、反馈和错误气泡', () => {
    const { store } = newStore();
    const session = store.create(NUMBERS, reading);
    session.messages = [
      { role: 'model', text: '开场摘要', at: 1, kind: 'intro' },
      { role: 'user', text: '问一', at: 2 },
      { role: 'model', text: '答一', at: 3 },
      { role: 'feedback', text: '反馈', at: 4 },
      { role: 'user', text: '问二', at: 5 },
    ];

    expect(conversation(session)).toEqual([
      { role: 'user', text: '问一' },
      { role: 'model', text: '答一' },
      { role: 'user', text: '问二' },
    ]);
  });

  test('空 / 缺失会话得到空数组', () => {
    expect(conversation(null)).toEqual([]);
    expect(conversation({})).toEqual([]);
  });
});

describe('localStorageAdapter：字节层', () => {
  test('缺失、坏 JSON、非数组都读成空', () => {
    const storage = fakeStorage();
    const adapter = localStorageAdapter(storage);
    expect(adapter.read()).toEqual([]);

    storage.items.set(SESSIONS_KEY, '{not json');
    expect(adapter.read()).toEqual([]);

    storage.items.set(SESSIONS_KEY, '{"a":1}');
    expect(adapter.read()).toEqual([]);

    storage.items.set(SESSIONS_KEY, '[{"id":"x"}]');
    expect(adapter.read()).toEqual([{ id: 'x' }]);
  });

  test('write / clear 对应 setItem / removeItem', () => {
    const storage = fakeStorage();
    const adapter = localStorageAdapter(storage);
    adapter.write([rawSession()]);
    expect(JSON.parse(storage.items.get(SESSIONS_KEY))).toHaveLength(1);
    adapter.clear();
    expect(storage.items.has(SESSIONS_KEY)).toBe(false);
  });

  test('隐私模式 / 配额满静默降级', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const adapter = localStorageAdapter(throwing);
    expect(adapter.read()).toEqual([]);
    expect(() => adapter.write([rawSession()])).not.toThrow();
    expect(() => adapter.clear()).not.toThrow();
  });

  test('生产 / 测试两个 adapter 可互换（端到端）', () => {
    const storage = fakeStorage();
    const prod = createSessionStore(localStorageAdapter(storage), {
      now: () => T0,
      random: () => 0.5,
    });
    const session = prod.create(NUMBERS, reading);
    prod.appendExchange(session, {
      question: 'q',
      answer: 'a',
      interactionId: 'i_1',
      transport: 'interactions',
    });

    const reopened = createSessionStore(
      localStorageAdapter(fakeStorage(Object.fromEntries(storage.items))),
      { now: () => T0 }
    );
    const loaded = reopened.get(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded.messages).toEqual(session.messages);
    expect(loaded.previousInteractionId).toBe('i_1');
  });
});
