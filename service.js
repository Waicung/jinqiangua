// @ts-check
/* ======================================================
   周易服务层 — 象数骨架 + 原典文本 + 客观象意
   ------------------------------------------------------
   The public data shape, shared by the HTTP API, WebMCP tools and
   the demo UI. It deliberately contains three layers only:

     1. skeleton  六爻原始值 / 本卦 / 变卦 / 互卦 / 动爻 / 变爻规则
     2. text      卦辞 / 爻辞 / 彖传 / 象传，可按底本寻址
     3. imagery   八卦属性、核心意象、爻位关系

   Explicitly excluded (owned elsewhere):
   - 交流有效期 / 能否重占 —— 会话与日志层（session.js）
   - 个人处境白话解释、行业/感情/财务定制推演、吉凶断言 —— AI 解读层
   ====================================================== */

import {
  LINE_INFO,
  changeRule,
  deriveReading,
  hexagramById,
  nuclearHexagram,
  posLabel,
  trigramInfo,
} from './hexagram.js';
import { buildText, canonicalHexagram, listEditions } from './canonical.js';
import { buildImagery, hexagramImagery, TRIGRAMS } from './imagery.js';

/** @typedef {import('./hexagram.js').Hexagram} Hexagram */
/** @typedef {import('./hexagram.js').HexagramTable} HexagramTable */
/** @typedef {import('./hexagram.js').Reading} Reading */
/** @typedef {import('./canonical.js').CanonicalData} CanonicalData */

export const READING_SCHEMA = 'zhouyi.reading/v1';
export const HEXAGRAM_SCHEMA = 'zhouyi.hexagram/v1';

/**
 * @param {Hexagram} hexagram
 * @param {HexagramTable} table
 */
export function hexagramSummary(hexagram, table) {
  const trigrams = trigramInfo(hexagram.binary, table);
  return {
    id: hexagram.id,
    symbol: hexagram.symbol,
    name: hexagram.name,
    binary: hexagram.binary,
    trigrams: {
      lower: {
        binary: trigrams.lowerBin,
        name: trigrams.lowerName,
        symbol: trigrams.lowerSymbol,
      },
      upper: {
        binary: trigrams.upperBin,
        name: trigrams.upperName,
        symbol: trigrams.upperSymbol,
      },
    },
  };
}

/**
 * 层 1：象数骨架。只描述“是什么”，不判断“能不能继续问”。
 * @param {Reading} reading
 * @param {Hexagram} nuclear
 * @param {HexagramTable} table
 */
export function buildSkeleton(reading, nuclear, table) {
  return {
    numbers: reading.numbers.slice(),
    lines: reading.numbers.map((value, index) => {
      const info = LINE_INFO[value];
      if (!info) throw new RangeError(`未知爻值：${value}`);
      return {
        index,
        position: posLabel(index, info.yang),
        value,
        name: info.name,
        yang: info.yang,
        moving: info.moving,
        symbol: info.symbol,
      };
    }),
    primary: hexagramSummary(reading.primary, table),
    transformed: hexagramSummary(reading.transformed, table),
    nuclear: hexagramSummary(nuclear, table),
    moving: {
      count: reading.movingLines.length,
      indices: reading.movingLines.map((line) => line.index),
      positions: reading.movingLines.map((line) => line.position),
      lines: reading.movingLines.map((line) => {
        const value = reading.numbers[line.index];
        if (value === undefined) throw new RangeError(`爻位不存在：${line.index}`);
        const info = LINE_INFO[value];
        if (!info) throw new RangeError(`未知爻值：${value}`);
        return {
          index: line.index,
          position: line.position,
          value,
          name: info.name,
          from: info.yang ? 'yang' : 'yin',
          to: info.yang ? 'yin' : 'yang',
          label: info.yang ? '老阳 ⚊→⚋' : '老阴 ⚋→⚊',
        };
      }),
    },
    rule: changeRule(reading),
  };
}

/**
 * 一次完整读卦：三层拼装，顺序固定。
 * @param {number[]} numbers
 * @param {{ table: HexagramTable, canonicalData: CanonicalData, edition?: string }} context
 */
export function buildReading(numbers, context) {
  const reading = deriveReading(numbers, context.table);
  const nuclear = nuclearHexagram(reading.binary, context.table);
  return {
    schema: READING_SCHEMA,
    skeleton: buildSkeleton(reading, nuclear, context.table),
    text: buildText(reading, nuclear, context.canonicalData, context.edition),
    imagery: buildImagery(reading, nuclear),
  };
}

/**
 * 单卦资料：没有六爻投掷值时使用。
 * @param {number} id
 * @param {{ table: HexagramTable, canonicalData: CanonicalData, edition?: string }} context
 */
export function buildHexagram(id, context) {
  const hexagram = hexagramById(id, context.table);
  if (!hexagram) return null;
  const text = canonicalHexagram(id, context.canonicalData, context.edition);
  return {
    schema: HEXAGRAM_SCHEMA,
    hexagram: hexagramSummary(hexagram, context.table),
    text: {
      edition: context.edition || context.canonicalData.defaultEdition,
      judgment: text.judgment,
      lines: text.lines,
      ...(text.specialLines ? { specialLines: text.specialLines } : {}),
      tuan: text.tuan,
      image: text.image,
    },
    imagery: hexagramImagery(hexagram),
  };
}

/**
 * @param {HexagramTable} table
 */
export function listHexagrams(table) {
  return table.hexagrams.map((hexagram) => ({
    id: hexagram.id,
    symbol: hexagram.symbol,
    name: hexagram.name,
    binary: hexagram.binary,
    trigrams: {
      lower: table.trigramNames[hexagram.lowerTrigram] || '',
      upper: table.trigramNames[hexagram.upperTrigram] || '',
    },
  }));
}

/**
 * @param {() => number} [random]
 * @returns {number[]}
 */
export function castNumbers(random = Math.random) {
  return Array.from({ length: 6 }, () => {
    let sum = 0;
    for (let coin = 0; coin < 3; coin++) sum += random() < 0.5 ? 3 : 2;
    return sum;
  });
}

/**
 * 随机起卦：仍然只返回三层，不写会话、不带有效期。
 * @param {{ table: HexagramTable, canonicalData: CanonicalData, edition?: string, random?: () => number }} context
 */
export function castReading(context) {
  const numbers = castNumbers(context.random);
  return {
    numbers,
    reading: buildReading(numbers, context),
  };
}

/**
 * 服务自述，供 API 根路径和 WebMCP 发现使用。
 * @param {CanonicalData} canonicalData
 */
export function describeService(canonicalData) {
  return {
    name: '周易象数服务',
    schema: READING_SCHEMA,
    layers: {
      skeleton: '六爻原始值、本卦、变卦、互卦、动爻、变爻规则',
      text: '卦辞、爻辞、彖传、象传原文（可按底本寻址）',
      imagery: '八卦自然属性、核心意象、爻位关系',
    },
    excluded: {
      session: '交流有效期、能否重占等状态判断由调用方的会话/日志层负责',
      interpretation: '个人处境白话、行业/感情/财务推演、吉凶断言由 AI 解读层负责',
    },
    editions: listEditions(canonicalData),
    trigrams: TRIGRAMS,
  };
}
