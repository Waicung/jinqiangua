import { describe, expect, test } from 'bun:test';
import table from '../data/iching.json';
import canonicalData from '../data/canonical.json';
import { UnknownEditionError, canonicalHexagram, listEditions } from '../canonical.js';
import { changeRule, deriveReading, nuclearHexagram } from '../hexagram.js';
import {
  buildHexagram,
  buildReading,
  buildSkeleton,
  castNumbers,
  describeService,
  listHexagrams,
} from '../service.js';

const context = { table, canonicalData };
const staticNumbers = (binary) => binary.split('').map((bit) => (bit === '1' ? 7 : 8));
const movingNumbers = (binary) => binary.split('').map((bit) => (bit === '1' ? 9 : 6));

const deepKeys = (value, keys = []) => {
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    deepKeys(child, keys);
  }
  return keys;
};

describe('原典数据 data/canonical.json', () => {
  test('64 卦都有卦辞、六爻、彖传、大象与小象', () => {
    const edition = canonicalData.editions['通行本'];
    expect(Object.keys(edition.hexagrams)).toHaveLength(64);

    for (const hexagram of table.hexagrams) {
      const text = edition.hexagrams[String(hexagram.id)];
      expect(text).toBeTruthy();
      expect(text.name).toBe(hexagram.name);
      expect(text.judgment.length).toBeGreaterThan(0);
      expect(text.lines).toHaveLength(6);
      expect(text.tuan.length).toBeGreaterThan(10);
      expect(text.image.great.length).toBeGreaterThan(5);
      expect(
        text.image.lines.filter((line) => !line.position.startsWith('用'))
      ).toHaveLength(6);
    }
  });

  test('可按底本寻址；未知底本明确报错', () => {
    expect(listEditions(canonicalData)).toEqual(['通行本']);
    expect(canonicalHexagram(1, canonicalData).name).toBe('乾');
    expect(() => canonicalHexagram(1, canonicalData, '帛书')).toThrow(
      UnknownEditionError
    );
  });
});

describe('象数骨架：互卦与变爻规则', () => {
  test('互卦取二三四爻为下卦、三四五爻为上卦', () => {
    const reading = deriveReading(staticNumbers('100010'), table); // 屯
    expect(nuclearHexagram(reading.binary, table).name).toBe('剥');

    const qian = deriveReading(staticNumbers('111111'), table);
    expect(nuclearHexagram(qian.binary, table).name).toBe('乾');

    const kun = deriveReading(staticNumbers('000000'), table);
    expect(nuclearHexagram(kun.binary, table).name).toBe('坤');
  });

  test('0–6 个动爻分别指向朱熹规则的目标原文', () => {
    const cases = [
      {
        numbers: [7, 8, 7, 8, 7, 8],
        id: 'no-moving',
        title: '静卦',
        targetKinds: ['judgment'],
      },
      {
        numbers: [9, 8, 7, 8, 7, 8],
        id: 'one-moving',
        title: '一爻动',
        targetKinds: ['line'],
      },
      {
        numbers: [6, 9, 8, 8, 7, 8],
        id: 'two-moving',
        title: '二爻动',
        targetKinds: ['line', 'line'],
      },
      {
        numbers: [6, 7, 6, 9, 7, 8],
        id: 'three-moving',
        title: '三爻动',
        targetKinds: ['judgment', 'judgment'],
      },
      {
        numbers: [6, 7, 6, 9, 9, 8],
        id: 'four-moving',
        title: '四爻动',
        targetKinds: ['line', 'line'],
      },
      {
        numbers: [6, 7, 6, 9, 9, 6],
        id: 'five-moving',
        title: '五爻动',
        targetKinds: ['line'],
      },
      {
        numbers: [9, 9, 9, 9, 9, 9],
        id: 'six-moving',
        title: '六爻动',
        targetKinds: ['special'],
      },
    ];

    for (const item of cases) {
      const reading = deriveReading(item.numbers, table);
      const rule = changeRule(reading);
      expect(rule.id).toBe(item.id);
      expect(rule.title).toBe(item.title);
      expect(rule.movingCount).toBe(item.numbers.filter((n) => n === 6 || n === 9).length);
      expect(rule.targets.map((target) => target.kind)).toEqual(item.targetKinds);
    }
  });

  test('二爻动以上爻为主，四爻动以下爻为主', () => {
    const two = changeRule(deriveReading([6, 9, 8, 8, 7, 8], table));
    expect(two.targets[0]).toMatchObject({ hexagram: 'primary', index: 1, role: 'main' });
    expect(two.targets[1]).toMatchObject({ hexagram: 'primary', index: 0, role: 'secondary' });

    const four = changeRule(deriveReading([6, 7, 6, 9, 9, 8], table));
    expect(four.targets[0]).toMatchObject({
      hexagram: 'transformed',
      index: 1,
      role: 'main',
    });
    expect(four.targets[1]).toMatchObject({
      hexagram: 'transformed',
      index: 5,
      role: 'secondary',
    });
  });

  test('六爻皆动时乾用九、坤用六，其余取变卦卦辞', () => {
    const qian = changeRule(deriveReading([9, 9, 9, 9, 9, 9], table));
    expect(qian.targets).toEqual([
      { kind: 'special', hexagram: 'primary', position: '用九' },
    ]);

    const kun = changeRule(deriveReading([6, 6, 6, 6, 6, 6], table));
    expect(kun.targets).toEqual([
      { kind: 'special', hexagram: 'primary', position: '用六' },
    ]);

    const tun = changeRule(deriveReading(movingNumbers('100010'), table));
    expect(tun.targets).toEqual([{ kind: 'judgment', hexagram: 'transformed' }]);
  });
});

describe('三层读卦：只给骨架、原典、象意', () => {
  test('一次读卦包含三层，且不混入会话状态或个人化字段', () => {
    const reading = buildReading([6, 7, 8, 9, 7, 8], context);
    expect(reading.schema).toBe('zhouyi.reading/v1');
    expect(Object.keys(reading).sort()).toEqual(['imagery', 'schema', 'skeleton', 'text']);

    expect(reading.skeleton.numbers).toEqual([6, 7, 8, 9, 7, 8]);
    expect(reading.skeleton.moving.count).toBe(2);
    expect(reading.skeleton.moving.positions).toEqual(['初六', '九四']);
    expect(reading.skeleton.primary.name).toBe('困');
    expect(reading.skeleton.transformed.name).toBe('节');
    expect(reading.skeleton.nuclear.name).toBe('家人');

    expect(reading.text.primary.judgment.length).toBeGreaterThan(0);
    expect(reading.text.primary.tuan.length).toBeGreaterThan(0);
    expect(reading.text.primary.image.great.length).toBeGreaterThan(0);
    expect(reading.text.primary.lines).toHaveLength(6);

    expect(reading.imagery.primary.trigrams.upper.name).toBe('兑');
    expect(reading.imagery.primary.trigrams.lower.name).toBe('坎');
    expect(reading.imagery.primary.keywords).toContain('险陷');

    const keys = deepKeys(reading);
    for (const forbidden of [
      'expiresAt',
      'expires',
      'canContinue',
      'remaining',
      'question',
      'advice',
      'fortune',
      'luck',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  test('256 种爻值组合都能组成三层数据', () => {
    for (let mask = 0; mask < 64; mask++) {
      const binary = mask.toString(2).padStart(6, '0');
      for (const numbers of [staticNumbers(binary), movingNumbers(binary)]) {
        const reading = buildReading(numbers, context);
        expect(reading.skeleton.primary.binary).toBe(binary);
        expect(reading.text.primary.id).toBe(reading.skeleton.primary.id);
        expect(reading.imagery.primary.lines).toHaveLength(6);
      }
    }
  });

  test('单卦资料不带六爻投掷值，但原典与象意齐全', () => {
    const data = buildHexagram(1, context);
    expect(data.schema).toBe('zhouyi.hexagram/v1');
    expect(data.hexagram.name).toBe('乾');
    expect(data.text.judgment).toBe('元亨，利贞。');
    expect(data.text.image.great).toContain('天行健');
    expect(data.imagery.keywords).toContain('刚健');
    expect(data.imagery.lines).toHaveLength(6);
    expect(buildHexagram(65, context)).toBeNull();
  });

  test('象意层给出当位、得中、应与、承乘', () => {
    const reading = buildReading([9, 8, 7, 8, 7, 8], context);
    const first = reading.imagery.primary.lines[0];
    expect(first.position).toBe('初九');
    expect(first.correct).toBe(true);
    expect(first.center).toBe(false);
    expect(first.response).toMatchObject({ index: 3, label: '有应' });
    expect(first.over).toBeNull();
    expect(first.under).toMatchObject({ index: 1, relation: '阳承阴（刚承柔）' });

    const two = reading.imagery.primary.lines[1];
    expect(two.center).toBe(true);
  });
});

describe('服务自述与辅助函数', () => {
  test('castNumbers 只产生 6–9 的六个值', () => {
    for (let i = 0; i < 100; i++) {
      const numbers = castNumbers();
      expect(numbers).toHaveLength(6);
      expect(numbers.every((n) => n >= 6 && n <= 9)).toBe(true);
    }
  });

  test('listHexagrams 是 1–64 的完整索引', () => {
    const list = listHexagrams(table);
    expect(list).toHaveLength(64);
    expect(list[0]).toMatchObject({ id: 1, name: '乾', binary: '111111' });
    expect(list[63]).toMatchObject({ id: 64, name: '未济' });
  });

  test('describeService 写明三层与两条排除边界', () => {
    const info = describeService(canonicalData);
    expect(info.layers).toHaveProperty('skeleton');
    expect(info.layers).toHaveProperty('text');
    expect(info.layers).toHaveProperty('imagery');
    expect(info.excluded).toHaveProperty('session');
    expect(info.excluded).toHaveProperty('interpretation');
    expect(info.editions).toEqual(['通行本']);
  });

  test('buildSkeleton 可独立使用', () => {
    const reading = deriveReading([7, 8, 7, 8, 7, 8], table);
    const nuclear = nuclearHexagram(reading.binary, table);
    const skeleton = buildSkeleton(reading, nuclear, table);
    expect(skeleton.rule.id).toBe('no-moving');
    expect(skeleton.lines.map((line) => line.value)).toEqual([7, 8, 7, 8, 7, 8]);
  });
});
