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
 * @property {{ position: string, text: string }[]} [specialLines]
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
 * @typedef {object} RuleTarget
 * @property {'judgment'|'line'|'special'} kind
 * @property {'primary'|'transformed'} hexagram
 * @property {number} [index]
 * @property {string} [position]
 * @property {'main'|'secondary'} [role]
 */

/**
 * @typedef {object} ChangeRule
 * @property {string} id
 * @property {string} title
 * @property {number} movingCount
 * @property {string} method
 * @property {string} school
 * @property {RuleTarget[]} targets
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
 * 互卦：取本卦二、三、四爻为下卦，三、四、五爻为上卦。
 * @param {string} binary
 * @param {HexagramTable} table
 * @returns {Hexagram}
 */
export function nuclearHexagram(binary, table) {
  if (!/^[01]{6}$/.test(binary)) {
    throw new RangeError(`binary 必须是六位 0/1：${binary}`);
  }
  const nuclearBinary = binary.charAt(1) + binary.charAt(2) + binary.charAt(3) +
    binary.charAt(2) + binary.charAt(3) + binary.charAt(4);
  return hexagramFor(nuclearBinary, table);
}

/**
 * 变爻取象规则（朱熹《易学启蒙·考变占》）。
 * 只给出“读哪一条原文”的规则与目标位置，不给吉凶判断。
 * @param {Reading} reading
 * @returns {ChangeRule}
 */
export function changeRule(reading) {
  const movingIndices = reading.movingLines.map((line) => line.index);
  const movingCount = movingIndices.length;
  const stillIndices = [0, 1, 2, 3, 4, 5].filter(
    (index) => !movingIndices.includes(index)
  );

  /**
   * @param {'primary'|'transformed'} hexagram
   * @param {number} index
   * @param {'main'|'secondary'|undefined} [role]
   * @returns {RuleTarget}
   */
  const lineTarget = (hexagram, index, role) => {
    const types =
      hexagram === 'primary'
        ? reading.primaryLineTypes
        : reading.transformedLineTypes;
    return {
      kind: 'line',
      hexagram,
      index,
      position: posLabel(index, types[index] === 'yang'),
      ...(role ? { role } : {}),
    };
  };

  /** @type {ChangeRule} */
  const base = {
    id: 'no-moving',
    title: '静卦',
    movingCount,
    method: '以本卦卦辞占。',
    school: '朱熹《易学启蒙·考变占》',
    targets: [{ kind: 'judgment', hexagram: 'primary' }],
  };

  if (movingCount === 1) {
    const index = movingIndices[0];
    if (index === undefined) return base;
    return {
      ...base,
      id: 'one-moving',
      title: '一爻动',
      method: '以本卦动爻爻辞占。',
      targets: [lineTarget('primary', index)],
    };
  }

  if (movingCount === 2) {
    const lower = movingIndices[0];
    const upper = movingIndices[1];
    if (lower === undefined || upper === undefined) return base;
    return {
      ...base,
      id: 'two-moving',
      title: '二爻动',
      method: '以本卦两动爻爻辞占，以上爻为主。',
      targets: [
        lineTarget('primary', upper, 'main'),
        lineTarget('primary', lower, 'secondary'),
      ],
    };
  }

  if (movingCount === 3) {
    return {
      ...base,
      id: 'three-moving',
      title: '三爻动',
      method: '以本卦与变卦卦辞占，本卦为主。',
      targets: [
        { kind: 'judgment', hexagram: 'primary', role: 'main' },
        { kind: 'judgment', hexagram: 'transformed', role: 'secondary' },
      ],
    };
  }

  if (movingCount === 4) {
    const lower = stillIndices[0];
    const upper = stillIndices[1];
    if (lower === undefined || upper === undefined) return base;
    return {
      ...base,
      id: 'four-moving',
      title: '四爻动',
      method: '以变卦两不变爻爻辞占，以下爻为主。',
      targets: [
        lineTarget('transformed', lower, 'main'),
        lineTarget('transformed', upper, 'secondary'),
      ],
    };
  }

  if (movingCount === 5) {
    const index = stillIndices[0];
    if (index === undefined) return base;
    return {
      ...base,
      id: 'five-moving',
      title: '五爻动',
      method: '以变卦不变爻爻辞占。',
      targets: [lineTarget('transformed', index)],
    };
  }

  if (movingCount === 6) {
    const special = reading.primary.specialLines?.[0];
    if (special) {
      return {
        ...base,
        id: 'six-moving',
        title: '六爻动',
        method: `六爻皆动，以${special.position}爻辞占。`,
        targets: [
          {
            kind: 'special',
            hexagram: 'primary',
            position: special.position,
          },
        ],
      };
    }
    return {
      ...base,
      id: 'six-moving',
      title: '六爻动',
      method: '六爻皆动，以变卦卦辞占。',
      targets: [{ kind: 'judgment', hexagram: 'transformed' }],
    };
  }

  return base;
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
