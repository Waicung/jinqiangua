// @ts-check
/* ======================================================
   客观象意字典 — 八卦属性、核心意象、爻位关系
   ------------------------------------------------------
   Boundary contract:
   - only objective, source-based imagery: trigram nature / attribute /
     keywords, and positional relations (当位、得中、应与、承乘)
   - no industry / relationship / finance tailoring, no 吉凶断语
   - names stay close to 说卦传, so downstream AI can do the personal part
   ====================================================== */

import { posLabel } from './hexagram.js';

/** @typedef {import('./hexagram.js').Hexagram} Hexagram */
/** @typedef {import('./hexagram.js').LineType} LineType */
/** @typedef {import('./hexagram.js').Reading} Reading */

/**
 * @typedef {object} TrigramMeaning
 * @property {string} name
 * @property {string} symbol
 * @property {string} nature
 * @property {string} attribute
 * @property {string} direction
 * @property {string} family
 * @property {string} animal
 * @property {string} body
 * @property {string[]} keywords
 */

/**
 * 《说卦传》的八卦取象，只保留自然属性与核心意象。
 * @type {Record<string, TrigramMeaning>}
 */
export const TRIGRAMS = {
  '111': {
    name: '乾',
    symbol: '☰',
    nature: '天',
    attribute: '健',
    direction: '西北',
    family: '父',
    animal: '马',
    body: '首',
    keywords: ['刚健', '天', '创始'],
  },
  '110': {
    name: '兑',
    symbol: '☱',
    nature: '泽',
    attribute: '说（悦）',
    direction: '西',
    family: '少女',
    animal: '羊',
    body: '口',
    keywords: ['喜悦', '泽', '口舌'],
  },
  '101': {
    name: '离',
    symbol: '☲',
    nature: '火',
    attribute: '丽（附丽）',
    direction: '南',
    family: '中女',
    animal: '雉',
    body: '目',
    keywords: ['光明', '附丽', '火'],
  },
  '100': {
    name: '震',
    symbol: '☳',
    nature: '雷',
    attribute: '动',
    direction: '东',
    family: '长男',
    animal: '龙',
    body: '足',
    keywords: ['震动', '奋起', '雷'],
  },
  '011': {
    name: '巽',
    symbol: '☴',
    nature: '风',
    attribute: '入',
    direction: '东南',
    family: '长女',
    animal: '鸡',
    body: '股',
    keywords: ['顺入', '风行', '木'],
  },
  '010': {
    name: '坎',
    symbol: '☵',
    nature: '水',
    attribute: '陷',
    direction: '北',
    family: '中男',
    animal: '豕',
    body: '耳',
    keywords: ['险陷', '水', '劳'],
  },
  '001': {
    name: '艮',
    symbol: '☶',
    nature: '山',
    attribute: '止',
    direction: '东北',
    family: '少男',
    animal: '狗',
    body: '手',
    keywords: ['止', '山', '阻'],
  },
  '000': {
    name: '坤',
    symbol: '☷',
    nature: '地',
    attribute: '顺',
    direction: '西南',
    family: '母',
    animal: '牛',
    body: '腹',
    keywords: ['顺从', '承载', '地'],
  },
};

/**
 * @param {string} binary
 * @returns {TrigramMeaning & { binary: string }}
 */
export function trigramMeaning(binary) {
  const meaning = TRIGRAMS[binary];
  if (!meaning) throw new RangeError(`未知三爻卦：${binary}`);
  return { ...meaning, binary };
}

/**
 * @param {LineType[]} lineTypes
 * @returns {{ index: number, position: string, yang: boolean, type: LineType, correct: boolean, center: boolean, threeTalents: '地'|'人'|'天', response: { index: number, position: string, mutual: boolean, label: '有应'|'无应' }, over: { index: number, position: string, relation: string } | null, under: { index: number, position: string, relation: string } | null }[]}
 */
export function lineRelations(lineTypes) {
  const isYang = (/** @type {number} */ index) => lineTypes[index] === 'yang';
  const nameOf = (/** @type {number} */ index) =>
    posLabel(index, isYang(index));

  return lineTypes.map((type, index) => {
    const yang = type === 'yang';
    const partnerIndex = (index + 3) % 6;
    const mutual = isYang(partnerIndex) !== yang;

    /** @param {number} otherIndex */
    function overRelation(otherIndex) {
      const otherYang = isYang(otherIndex);
      let relation = '同类';
      if (yang && !otherYang) relation = '阳乘阴（刚乘柔）';
      if (!yang && otherYang) relation = '阴乘阳（柔乘刚）';
      return {
        index: otherIndex,
        position: nameOf(otherIndex),
        relation,
      };
    }

    /** @param {number} otherIndex */
    function underRelation(otherIndex) {
      const otherYang = isYang(otherIndex);
      let relation = '同类';
      if (yang && !otherYang) relation = '阳承阴（刚承柔）';
      if (!yang && otherYang) relation = '阴承阳（柔承刚）';
      return {
        index: otherIndex,
        position: nameOf(otherIndex),
        relation,
      };
    }

    return {
      index,
      position: nameOf(index),
      yang,
      type,
      // 初、三、五为阳位；二、四、上为阴位
      correct: (index % 2 === 0) === yang,
      // 二、五为上下卦之中
      center: index === 1 || index === 4,
      threeTalents: index < 2 ? '地' : index < 4 ? '人' : '天',
      response: {
        index: partnerIndex,
        position: nameOf(partnerIndex),
        mutual,
        label: mutual ? '有应' : '无应',
      },
      over: index > 0 ? overRelation(index - 1) : null,
      under: index < 5 ? underRelation(index + 1) : null,
    };
  });
}

/**
 * @param {Hexagram} hexagram
 */
export function hexagramImagery(hexagram) {
  const upper = trigramMeaning(hexagram.upperTrigram);
  const lower = trigramMeaning(hexagram.lowerTrigram);
  const lineTypes = /** @type {LineType[]} */ (
    hexagram.binary.split('').map((bit) => (bit === '1' ? 'yang' : 'yin'))
  );

  return {
    id: hexagram.id,
    name: hexagram.name,
    symbol: hexagram.symbol,
    binary: hexagram.binary,
    trigrams: { upper, lower },
    naturalImage: `${upper.nature}${lower.nature}`,
    formation: `上${upper.name}下${lower.name}`,
    attributes: [upper.attribute, lower.attribute],
    keywords: [...new Set([...upper.keywords, ...lower.keywords])],
    lines: lineRelations(lineTypes),
  };
}

/**
 * 本卦 / 变卦 / 互卦三份象意。互卦由上层传入，避免这里重算骨架。
 * @param {Reading} reading
 * @param {Hexagram} nuclear
 */
export function buildImagery(reading, nuclear) {
  return {
    primary: hexagramImagery(reading.primary),
    transformed: hexagramImagery(reading.transformed),
    nuclear: hexagramImagery(nuclear),
  };
}
