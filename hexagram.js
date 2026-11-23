// @ts-check
/* ======================================================
   卦象 — hexagram identity, line vocabulary, derivation
   ------------------------------------------------------
   Interface contract:
   - binary is six bits, bottom line first; '1' = 阳, '0' = 阴
   - numbers is exactly six integers in 6..9 (三枚硬币的和)
   - a HexagramTable is the shape of data/iching.json
   - hexagramFor throws on an unknown binary: every 6-bit string
     must name one of the 64 hexagrams
   - hexagramById is total (undefined when the stored id is gone)
   ====================================================== */

/** @typedef {'yang'|'yin'} LineType */

/**
 * @typedef {object} HexagramLine
 * @property {string} position
 * @property {string} text
 * @property {LineType} type
 */

/**
 * @typedef {object} Hexagram
 * @property {number} id
 * @property {string} symbol
 * @property {string} name
 * @property {string} judgment
 * @property {string} binary
 * @property {string} lowerTrigram
 * @property {string} upperTrigram
 * @property {HexagramLine[]} lines
 */

/**
 * @typedef {object} HexagramTable
 * @property {Record<string, string>} trigramNames
 * @property {Record<string, number>} trigramLookup
 * @property {Hexagram[]} hexagrams
 */

/**
 * @typedef {object} LineInfo
 * @property {string} name
 * @property {boolean} yang
 * @property {boolean} moving
 * @property {string} symbol
 */

/**
 * @typedef {object} MovingLine
 * @property {number} index
 * @property {string} position
 * @property {string} text
 */

/**
 * @typedef {object} Reading
 * @property {number[]} numbers
 * @property {string} binary
 * @property {Hexagram} primary
 * @property {Hexagram} transformed
 * @property {MovingLine[]} movingLines
 * @property {LineType[]} primaryLineTypes
 * @property {LineType[]} transformedLineTypes
 */

/**
 * @typedef {object} TrigramInfo
 * @property {string} lowerBin
 * @property {string} upperBin
 * @property {string} lowerName
 * @property {string} upperName
 * @property {string} lowerSymbol
 * @property {string} upperSymbol
 */

/** 6 = 老阴（变）, 7 = 少阳, 8 = 少阴, 9 = 老阳（变） */
export const LINE_INFO = /** @type {Record<number, LineInfo>} */ ({
  6: { name: '老阴', yang: false, moving: true,  symbol: '⚋' },
  7: { name: '少阳', yang: true,  moving: false, symbol: '⚊' },
  8: { name: '少阴', yang: false, moving: false, symbol: '⚋' },
  9: { name: '老阳', yang: true,  moving: true,  symbol: '⚊' },
});

const POSITION_NAMES = ['初', '二', '三', '四', '五', '上'];

export const TRIGRAM_SYMBOLS = /** @type {Record<string, string>} */ ({
  '111': '☰', '110': '☱', '101': '☲', '100': '☳',
  '011': '☴', '010': '☵', '001': '☶', '000': '☷',
});

/**
 * 初九 / 六二 / 上六 …（index 0 为初爻，自下而上）
 * @param {number} index
 * @param {boolean} isYang
 * @returns {string}
 */
export function posLabel(index, isYang) {
  const yao = isYang ? '九' : '六';
  if (index === 0) return `初${yao}`;
  if (index === 5) return `上${yao}`;
  return `${yao}${POSITION_NAMES[index] ?? ''}`;
}

/** @type {WeakMap<HexagramTable, Map<string, Hexagram>>} */
const hexagramMaps = new WeakMap();

/**
 * @param {HexagramTable} table
 * @returns {Map<string, Hexagram>}
 */
function hexagramMap(table) {
  let map = hexagramMaps.get(table);
  if (!map) {
    map = new Map(
      /** @type {[string, Hexagram][]} */ (
        table.hexagrams.map((h) => [h.binary, h])
      )
    );
    hexagramMaps.set(table, map);
  }
  return map;
}

/**
 * The 本卦 / 变卦 for a six-bit binary, bottom line first.
 * @param {string} binary
 * @param {HexagramTable} table
 * @returns {Hexagram}
 */
export function hexagramFor(binary, table) {
  const hexagram = hexagramMap(table).get(binary);
  if (!hexagram) throw new RangeError(`未知卦象：binary=${binary}`);
  return hexagram;
}

/**
 * Total lookup for stored ids (a deleted or corrupt 卦历 entry is not a crash).
 * @param {number} id
 * @param {HexagramTable} table
 * @returns {Hexagram | undefined}
 */
export function hexagramById(id, table) {
  return table.hexagrams.find((h) => h.id === id);
}

/**
 * @param {string} binary
 * @param {HexagramTable} table
 * @returns {TrigramInfo}
 */
export function trigramInfo(binary, table) {
  const lowerBin = binary.slice(0, 3);
  const upperBin = binary.slice(3, 6);
  const names = table.trigramNames;
  return {
    lowerBin,
    upperBin,
    lowerName: names[lowerBin] ?? '',
    upperName: names[upperBin] ?? '',
    lowerSymbol: TRIGRAM_SYMBOLS[lowerBin] ?? '',
    upperSymbol: TRIGRAM_SYMBOLS[upperBin] ?? '',
  };
}

/**
 * @param {number[]} numbers
 * @returns {void}
 */
function assertNumbers(numbers) {
  if (!Array.isArray(numbers)) {
    throw new TypeError('numbers 必须是六个 6–9 的整数');
  }
  const valid =
    numbers.length === 6 &&
    numbers.every((n) => Number.isInteger(n) && n >= 6 && n <= 9);
  if (!valid) throw new RangeError('numbers 必须是六个 6–9 的整数');
}

/**
 * 从六次投掷的和值推出完整卦象：本卦、变卦、动爻、爻性。
 * @param {number[]} numbers
 * @param {HexagramTable} table
 * @returns {Reading}
 */
export function deriveReading(numbers, table) {
  assertNumbers(numbers);

  const binary = numbers.map((n) => (n === 7 || n === 9 ? '1' : '0')).join('');
  const primary = hexagramFor(binary, table);

  const transformedBits = binary.split('');
  /** @type {number[]} */
  const movingIndices = [];
  for (const [index, num] of numbers.entries()) {
    if (num === 6) {
      transformedBits[index] = '1';
      movingIndices.push(index);
    } else if (num === 9) {
      transformedBits[index] = '0';
      movingIndices.push(index);
    }
  }
  const transformed = hexagramFor(transformedBits.join(''), table);

  const primaryLineTypes = binary
    .split('')
    .map((bit) => /** @type {LineType} */ (bit === '1' ? 'yang' : 'yin'));
  const transformedLineTypes = transformedBits
    .map((bit) => /** @type {LineType} */ (bit === '1' ? 'yang' : 'yin'));

  const movingLines = movingIndices.map((index) => {
    const line = primary.lines[index];
    const type = primaryLineTypes[index];
    if (!line || !type) throw new RangeError(`爻位不存在：${index}`);
    return {
      index,
      position: posLabel(index, type === 'yang'),
      text: line.text,
    };
  });

  return {
    numbers: numbers.slice(),
    binary,
    primary,
    transformed,
    movingLines,
    primaryLineTypes,
    transformedLineTypes,
  };
}
