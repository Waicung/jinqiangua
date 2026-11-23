import { describe, expect, test } from 'bun:test';
import table from '../data/iching.json';
import {
  LINE_INFO,
  deriveReading,
  hexagramById,
  hexagramFor,
  posLabel,
  trigramInfo,
} from '../hexagram.js';

/** 阳爻用 7（少阳），阴爻用 8（少阴）：静卦 */
const staticNumbers = (binary) => binary.split('').map((bit) => (bit === '1' ? 7 : 8));

/** 阳爻用 9（老阳），阴爻用 6（老阴）：六爻皆动 */
const movingNumbers = (binary) => binary.split('').map((bit) => (bit === '1' ? 9 : 6));

const flip = (binary) => binary.split('').map((bit) => (bit === '1' ? '0' : '1')).join('');

describe('卦象表 data/iching.json', () => {
  test('64 卦，binary 唯一且等于 lowerTrigram + upperTrigram', () => {
    expect(table.hexagrams).toHaveLength(64);
    const binaries = new Set(table.hexagrams.map((h) => h.binary));
    expect(binaries.size).toBe(64);
    for (const h of table.hexagrams) {
      expect(h.binary).toBe(h.lowerTrigram + h.upperTrigram);
      expect(h.binary).toHaveLength(6);
    }
  });

  test('trigramLookup 与 binary 一致', () => {
    for (const h of table.hexagrams) {
      expect(table.trigramLookup[`${h.upperTrigram}:${h.lowerTrigram}`]).toBe(h.id);
    }
  });

  test('爻性与爻位和 binary 一致', () => {
    for (const h of table.hexagrams) {
      h.lines.forEach((line, index) => {
        const isYang = h.binary[index] === '1';
        expect(line.type).toBe(isYang ? 'yang' : 'yin');
        expect(line.position).toBe(posLabel(index, isYang));
      });
    }
  });

  test('每一卦的上下卦都有名字', () => {
    for (const h of table.hexagrams) {
      expect(table.trigramNames[h.lowerTrigram]).toBeTruthy();
      expect(table.trigramNames[h.upperTrigram]).toBeTruthy();
    }
  });
});

describe('deriveReading：本卦 / 变卦 / 动爻 / 爻性', () => {
  test('64 卦各自静卦往返', () => {
    for (const h of table.hexagrams) {
      const reading = deriveReading(staticNumbers(h.binary), table);
      expect(reading.primary.id).toBe(h.id);
      expect(reading.transformed.id).toBe(h.id);
      expect(reading.binary).toBe(h.binary);
      expect(reading.movingLines).toEqual([]);
      expect(reading.primaryLineTypes).toEqual(h.lines.map((line) => line.type));
      expect(reading.transformedLineTypes).toEqual(reading.primaryLineTypes);
    }
  });

  test('64 卦六爻皆动时变卦为阴阳互易', () => {
    for (const h of table.hexagrams) {
      const transformed = table.hexagrams.find((x) => x.binary === flip(h.binary));
      expect(transformed).toBeTruthy();

      const reading = deriveReading(movingNumbers(h.binary), table);
      const isYang = h.binary.split('').map((bit) => bit === '1');

      expect(reading.primary.id).toBe(h.id);
      expect(reading.transformed.id).toBe(transformed.id);
      expect(reading.movingLines.map((m) => m.index)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(reading.transformedLineTypes).toEqual(
        isYang.map((yang) => (yang ? 'yin' : 'yang'))
      );
    }
  });

  test('混合动爻：老阴翻阳、老阳翻阴，爻辞取自本卦对应爻', () => {
    const reading = deriveReading([6, 7, 8, 9, 7, 8], table);

    expect(reading.binary).toBe('010110');
    expect(reading.primary).toBe(hexagramFor('010110', table));
    expect(reading.transformed).toBe(hexagramFor('110010', table));

    expect(reading.movingLines.map((m) => m.index)).toEqual([0, 3]);
    expect(reading.movingLines[0]).toEqual({
      index: 0,
      position: '初六',
      text: reading.primary.lines[0].text,
    });
    expect(reading.movingLines[1]).toEqual({
      index: 3,
      position: '九四',
      text: reading.primary.lines[3].text,
    });
  });

  test('动爻位置覆盖初爻与上爻', () => {
    const reading = deriveReading([6, 8, 8, 8, 8, 6], table);
    expect(reading.movingLines.map((m) => m.position)).toEqual(['初六', '上六']);
  });

  test('返回的 numbers 是副本，不跟随调用方数组变化', () => {
    const numbers = [7, 8, 7, 8, 7, 8];
    const reading = deriveReading(numbers, table);
    numbers[0] = 9;
    expect(reading.numbers).toEqual([7, 8, 7, 8, 7, 8]);
  });

  test('Reading 的字段就是调用方依赖的那七个', () => {
    const reading = deriveReading([7, 8, 7, 8, 7, 8], table);
    expect(Object.keys(reading).sort()).toEqual([
      'binary',
      'movingLines',
      'numbers',
      'primary',
      'primaryLineTypes',
      'transformed',
      'transformedLineTypes',
    ]);
  });
});

describe('deriveReading：输入契约', () => {
  test('拒绝数量不对的输入', () => {
    expect(() => deriveReading([], table)).toThrow(RangeError);
    expect(() => deriveReading([7, 7, 7, 7, 7], table)).toThrow(RangeError);
    expect(() => deriveReading([7, 7, 7, 7, 7, 7, 7], table)).toThrow(RangeError);
  });

  test('拒绝 6–9 之外的值与非整数', () => {
    for (const bad of [5, 10, 0, 7.5, NaN, -1]) {
      const numbers = [7, 7, 7, 7, 7, bad];
      expect(() => deriveReading(numbers, table)).toThrow(RangeError);
    }
  });

  test('拒绝非数组输入', () => {
    for (const bad of [null, undefined, '777777', {}, 789678]) {
      expect(() => deriveReading(bad, table)).toThrow(TypeError);
    }
  });
});

describe('hexagramFor / hexagramById', () => {
  test('按 binary 取卦', () => {
    expect(hexagramFor('111111', table).name).toBe('乾');
    expect(hexagramFor('000000', table).name).toBe('坤');
    expect(hexagramFor('111000', table).name).toBe('泰');
  });

  test('未知 binary 抛出 RangeError', () => {
    expect(() => hexagramFor('111112', table)).toThrow(RangeError);
    expect(() => hexagramFor('11111', table)).toThrow(RangeError);
  });

  test('按 id 取卦是 total 的（坏记录返回 undefined）', () => {
    expect(hexagramById(1, table).name).toBe('乾');
    expect(hexagramById(999, table)).toBeUndefined();
  });
});

describe('卦象 vocabulary', () => {
  test('posLabel：初 / 二…五 / 上', () => {
    expect(posLabel(0, true)).toBe('初九');
    expect(posLabel(0, false)).toBe('初六');
    expect(posLabel(1, true)).toBe('九二');
    expect(posLabel(4, true)).toBe('九五');
    expect(posLabel(5, false)).toBe('上六');
  });

  test('LINE_INFO：6/9 为动爻，7/8 为静爻', () => {
    expect(LINE_INFO[6]).toMatchObject({ yang: false, moving: true, symbol: '⚋' });
    expect(LINE_INFO[7]).toMatchObject({ yang: true, moving: false, symbol: '⚊' });
    expect(LINE_INFO[8]).toMatchObject({ yang: false, moving: false, symbol: '⚋' });
    expect(LINE_INFO[9]).toMatchObject({ yang: true, moving: true, symbol: '⚊' });
  });

  test('trigramInfo：上下卦与符号', () => {
    expect(trigramInfo('111000', table)).toEqual({
      lowerBin: '111',
      upperBin: '000',
      lowerName: '乾',
      upperName: '坤',
      lowerSymbol: '☰',
      upperSymbol: '☷',
    });
  });
});
