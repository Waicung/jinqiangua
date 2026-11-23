import { describe, expect, test } from 'bun:test';
import table from '../data/iching.json';
import { deriveReading } from '../hexagram.js';
import {
  chipsHtml,
  geminiSettings,
  introText,
  panelState,
  quickChips,
} from '../chat-panel.js';
import { formatChatText, formatRemaining, escapeHtml } from '../ui-kit.js';

const NUMBERS = [7, 8, 9, 7, 6, 8];
const reading = deriveReading(NUMBERS, table);
const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

/** 与 session.js 同形状的会话记录（不经过 store，只测纯函数） */
function session(overrides = {}) {
  return {
    id: 's_test',
    createdAt: T0,
    expiresAt: T0 + 24 * HOUR,
    numbers: NUMBERS,
    primaryId: reading.primary.id,
    transformedId: reading.transformed.id,
    movingIndices: reading.movingLines.map((m) => m.index),
    messages: [],
    previousInteractionId: '',
    transport: 'interactions',
    ...overrides,
  };
}

describe('panelState — 交流有效期门', () => {
  test('有效期内：开输入框、显示剩余时间、可用快捷回复', () => {
    const view = panelState(session(), T0 + HOUR);
    expect(view.expired).toBe(false);
    expect(view.showComposer).toBe(true);
    expect(view.showChips).toBe(true);
    expect(view.remaining).toBe(23 * HOUR);
    expect(view.statusHtml).toContain('解卦交流有效期');
    expect(view.statusHtml).toContain('剩余');
  });

  test('截止后：输入框 / 快捷回复 / 页脚全关，只剩反馈', () => {
    const view = panelState(session(), T0 + 25 * HOUR);
    expect(view.expired).toBe(true);
    expect(view.showComposer).toBe(false);
    expect(view.showChips).toBe(false);
    expect(view.showKeyRow).toBe(false);
    expect(view.remaining).toBe(0);
    expect(view.statusHtml).toContain('已于');
    expect(view.statusHtml).toContain('截止');
  });

  test('恰好到截止时刻即视为截止（与 canContinue 同一门）', () => {
    const s = session();
    expect(panelState(s, s.expiresAt - 1).expired).toBe(false);
    expect(panelState(s, s.expiresAt).expired).toBe(true);
  });

  test('没有会话就不开任何解卦入口', () => {
    const view = panelState(null, T0);
    expect(view.expired).toBe(true);
    expect(view.showComposer).toBe(false);
    expect(view.showChips).toBe(false);
    expect(view.showKeyRow).toBe(false);
  });

  test('缺少 expiresAt 的坏记录按截止处理', () => {
    const view = panelState(session({ expiresAt: undefined }), T0);
    expect(view.expired).toBe(true);
    expect(view.remaining).toBe(0);
  });
});

describe('panelState — Key 行', () => {
  test('没有 Key：设置行展开，状态行引导去 AI Studio', () => {
    const view = panelState(session(), T0, { keySaved: false });
    expect(view.showKeyRow).toBe(true);
    expect(view.keyStatusHtml).toContain('尚未保存 Key');
  });

  test('已存 Key：设置行收起，状态行显示后四位与模型', () => {
    const view = panelState(session(), T0, {
      keySaved: true,
      keyLast4: 'abcd',
      model: 'gemini-3.8-flash',
    });
    expect(view.showKeyRow).toBe(false);
    expect(view.keyStatusHtml).toContain('…abcd');
    expect(view.keyStatusHtml).toContain('gemini-3.8-flash');
    expect(view.keyStatusHtml).toContain('btn-change-key');
  });

  test('用户点「更换 / 清除」时设置行重新展开', () => {
    const view = panelState(session(), T0, {
      keySaved: true,
      editingKey: true,
    });
    expect(view.showKeyRow).toBe(true);
  });

  test('截止后即使有 Key 也不显示设置行', () => {
    const view = panelState(session(), T0 + 25 * HOUR, { keySaved: true });
    expect(view.showKeyRow).toBe(false);
    expect(view.keyStatusHtml).toBe('');
  });
});

describe('panelState — 快捷回复', () => {
  test('有动爻：chips 提到动爻与变卦', () => {
    const view = panelState(session(), T0);
    expect(view.chips).toHaveLength(4);
    expect(view.chips.join()).toContain('动爻');
    expect(view.chips.join()).toContain('变卦');
  });

  test('静卦：chips 换成静卦问题', () => {
    const s = session({ movingIndices: [] });
    const chips = quickChips(s.movingIndices);
    expect(chips.join()).toContain('静卦');
    expect(chips.join()).not.toContain('变卦');
  });

  test('已经开始对话就收起 chips', () => {
    const view = panelState(session(), T0, { hasTalked: true });
    expect(view.showChips).toBe(false);
    expect(view.chips).toHaveLength(0);
  });

  test('chips 文案会被转义后写进 data-q', () => {
    const html = chipsHtml(['<b>问题</b>']);
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('data-q="&lt;b&gt;问题&lt;/b&gt;"');
  });
});

describe('panelState — 反馈文案', () => {
  test('默认是「记录反馈」，展开后是「收起反馈」', () => {
    expect(panelState(session(), T0).feedbackLabel).toBe('记录反馈');
    expect(panelState(session(), T0, { feedbackOpen: true }).feedbackLabel).toBe('收起反馈');
  });
});

describe('introText — 开场摘要', () => {
  test('有动爻：写出本卦、动爻位置与变卦，并给出截止时间', () => {
    const text = introText({
      primary: reading.primary,
      transformed: reading.transformed,
      movingLines: reading.movingLines,
      expiresAt: T0 + 24 * HOUR,
    });
    expect(text).toContain(reading.primary.name);
    expect(text).toContain(reading.transformed.name);
    expect(text).toContain('动爻在');
    expect(text).toContain('24 小时');
    expect(text).toContain('想从哪里聊起');
  });

  test('静卦：以本卦卦辞为占', () => {
    const still = deriveReading([7, 8, 7, 8, 7, 8], table);
    const text = introText({
      primary: still.primary,
      transformed: still.transformed,
      movingLines: still.movingLines,
      expiresAt: T0,
    });
    expect(text).toContain('六爻皆静');
    expect(text).not.toContain('动爻在');
  });

  test('没有截止时间就不写有效期那句', () => {
    const text = introText({
      primary: reading.primary,
      transformed: reading.transformed,
      movingLines: [],
      expiresAt: 0,
    });
    expect(text).not.toContain('小时内有效');
  });
});

describe('geminiSettings — 本机 Key 与模型', () => {
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

  test('默认模型，没有 Key', () => {
    const settings = geminiSettings(fakeStorage());
    expect(settings.model()).toBe('gemini-3.8-flash');
    expect(settings.key()).toBe('');
  });

  test('允许带 models/ 前缀，保存时去掉', () => {
    const storage = fakeStorage();
    const settings = geminiSettings(storage);
    settings.saveModel('models/gemini-flash-latest');
    expect(settings.model()).toBe('gemini-flash-latest');
  });

  test('存默认模型名等于不存', () => {
    const storage = fakeStorage();
    const settings = geminiSettings(storage);
    settings.saveModel('gemini-3.8-flash');
    expect(storage.items.has('gemini_model')).toBe(false);
    expect(settings.model()).toBe('gemini-3.8-flash');
  });

  test('Key 可存可清', () => {
    const settings = geminiSettings(fakeStorage());
    settings.saveKey('AIza-secret');
    expect(settings.key()).toBe('AIza-secret');
    settings.saveKey('');
    expect(settings.key()).toBe('');
  });

  test('存储不可用（隐私模式）时静默降级', () => {
    const settings = geminiSettings(null);
    expect(settings.key()).toBe('');
    expect(settings.model()).toBe('gemini-3.8-flash');
    expect(() => settings.saveKey('x')).not.toThrow();
  });
});

describe('ui-kit — 格式化', () => {
  test('formatRemaining 超过一小时只到分钟', () => {
    expect(formatRemaining(3 * HOUR + 12 * 60 * 1000)).toBe('3 小时 12 分');
  });

  test('formatRemaining 不足一小时给到秒', () => {
    expect(formatRemaining(65 * 1000)).toBe('1 分 05 秒');
  });

  test('formatRemaining 负数夹到 0', () => {
    expect(formatRemaining(-5000)).toBe('0 分 00 秒');
  });

  test('formatChatText 先转义再识别标题与加粗', () => {
    expect(formatChatText('# 标题')).toBe('<strong>标题</strong>');
    expect(formatChatText('**粗**')).toBe('<strong>粗</strong>');
    expect(formatChatText('- 项目')).toBe('· 项目');
    expect(formatChatText('<script>')).toBe('&lt;script&gt;');
  });

  test('escapeHtml 覆盖五个字符', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
