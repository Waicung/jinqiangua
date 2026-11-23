// @ts-check
/* ======================================================
   原典文本层 — 卦辞、爻辞、彖传、象传
   ------------------------------------------------------
   Boundary contract:
   - only accurate source text, addressable by edition (底本)
   - no vernacular paraphrase, no psychological comfort, no 吉凶断言
   - unknown editions are rejected; this layer never invents text
   ====================================================== */

/** @typedef {import('./hexagram.js').Reading} Reading */
/** @typedef {import('./hexagram.js').Hexagram} Hexagram */

/**
 * @typedef {object} CanonicalLine
 * @property {string} position
 * @property {string} text
 * @property {string} [type]
 */

/**
 * @typedef {object} CanonicalHexagramText
 * @property {number} id
 * @property {string} name
 * @property {string} symbol
 * @property {string} judgment
 * @property {CanonicalLine[]} lines
 * @property {{ position: string, text: string }[]} [specialLines]
 * @property {string} tuan
 * @property {{ great: string, lines: { position: string, text: string }[] }} image
 */

/**
 * @typedef {object} CanonicalEdition
 * @property {string} label
 * @property {string[]} source
 * @property {Record<string, CanonicalHexagramText>} hexagrams
 */

/**
 * @typedef {object} CanonicalData
 * @property {string} schema
 * @property {string} defaultEdition
 * @property {Record<string, CanonicalEdition>} editions
 */

export class UnknownEditionError extends RangeError {
  /**
   * @param {string} edition
   * @param {string[]} available
   */
  constructor(edition, available) {
    super(`未知底本：${edition}（可用：${available.join('、')}）`);
    this.name = 'UnknownEditionError';
    this.code = 'unknown_edition';
    this.available = available;
  }
}

/**
 * @param {CanonicalData} data
 * @returns {string[]}
 */
export function listEditions(data) {
  return Object.keys(data.editions || {});
}

/**
 * @param {CanonicalData} data
 * @param {string} [edition]
 * @returns {{ name: string, edition: CanonicalEdition }}
 */
export function resolveEdition(data, edition = data.defaultEdition) {
  const name = edition || data.defaultEdition;
  const found = data.editions?.[name];
  if (!found) throw new UnknownEditionError(name, listEditions(data));
  return { name, edition: found };
}

/**
 * @param {number} id
 * @param {CanonicalData} data
 * @param {string} [edition]
 * @returns {CanonicalHexagramText}
 */
export function canonicalHexagram(id, data, edition) {
  const resolved = resolveEdition(data, edition);
  const text = resolved.edition.hexagrams[String(id)];
  if (!text) throw new RangeError(`底本 ${resolved.name} 缺少第 ${id} 卦`);
  return text;
}

/**
 * 只摘出原典层字段，不把结构字段（binary / 上下卦）混进文本层。
 * @param {CanonicalHexagramText} text
 * @returns {CanonicalHexagramText}
 */
function textOnly(text) {
  return {
    id: text.id,
    name: text.name,
    symbol: text.symbol,
    judgment: text.judgment,
    lines: text.lines.map(({ position, text: lineText, type }) => ({
      position,
      text: lineText,
      ...(type ? { type } : {}),
    })),
    ...(text.specialLines ? { specialLines: text.specialLines } : {}),
    tuan: text.tuan,
    image: {
      great: text.image.great,
      lines: text.image.lines.map(({ position, text: lineText }) => ({
        position,
        text: lineText,
      })),
    },
  };
}

/**
 * 本卦 / 变卦 / 互卦三份原文。
 * @param {Reading} reading
 * @param {Hexagram} nuclear
 * @param {CanonicalData} data
 * @param {string} [edition]
 */
export function buildText(reading, nuclear, data, edition) {
  const resolved = resolveEdition(data, edition);
  return {
    edition: {
      name: resolved.name,
      label: resolved.edition.label,
      source: resolved.edition.source.slice(),
    },
    primary: textOnly(canonicalHexagram(reading.primary.id, data, resolved.name)),
    transformed: textOnly(
      canonicalHexagram(reading.transformed.id, data, resolved.name)
    ),
    nuclear: textOnly(canonicalHexagram(nuclear.id, data, resolved.name)),
  };
}
