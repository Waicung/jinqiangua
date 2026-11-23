// @ts-check
/**
 * build-canonical.mjs
 *
 * 把 data/iching.json（卦辞 / 爻辞）与 zhouyi/ 下的彖传、象传合并成
 * 可按底本寻址的原典数据：data/canonical.json。
 *
 * 原典层只负责“准确的原文”，不写任何白话解释、吉凶断言或个人化建议。
 *
 * Run: bun scripts/build-canonical.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (/** @type {string} */ p) => readFileSync(resolve(ROOT, p), 'utf8');

/** @typedef {{ id: number, symbol: string, name: string, judgment: string, lines: {position:string,text:string,type:string}[], specialLines?: {position:string,text:string}[] }} IChingHexagram */
/** @typedef {{ symbol: string, name: string, body: string }} Chapter */

/**
 * @param {string} source
 * @returns {Chapter[]}
 */
function parseChapters(source) {
  return source
    .split(/^## /m)
    .slice(1)
    .map((chunk) => {
      const nl = chunk.indexOf('\n');
      const header = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
      const body = nl === -1 ? '' : chunk.slice(nl + 1);
      const chars = [...header];
      return {
        symbol: chars[0] || '',
        name: chars.slice(1).join('').trim(),
        body: body
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .join('\n'),
      };
    })
    .filter((chapter) => chapter.symbol && chapter.name);
}

const LINE_RE =
  /^-\s*\*\*(.+?)\*\*\s*(?:—|–|-)\s*(.+)$/u;
const POSITION_RE =
  /^(初九|初六|九二|六二|九三|六三|九四|六四|九五|六五|上九|上六|用九|用六)/u;

/**
 * @param {Chapter} chapter
 * @returns {{ great: string, lines: { position: string, text: string }[] }}
 */
function parseImage(chapter) {
  const greatMatch = chapter.body.match(/\*\*大象\*\*\s*[:：]\s*(.+)/u);
  const great = greatMatch?.[1];
  if (!great) throw new Error(`象传缺少大象：${chapter.name}`);

  const lines = [];
  for (const raw of chapter.body.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('- ')) continue;
    const match = line.match(LINE_RE);
    if (!match) throw new Error(`象传小象格式无法解析：${chapter.name} / ${line}`);
    const head = (match[1] || '').trim();
    const text = match[2];
    const position = head.match(POSITION_RE)?.[1];
    if (!position || !text) {
      throw new Error(`象传小象缺少爻位或正文：${chapter.name} / ${line}`);
    }
    lines.push({ position, text: text.trim() });
  }
  if (lines.length < 6) throw new Error(`象传小象不足六条：${chapter.name}`);
  return { great: great.trim(), lines };
}

/**
 * @param {Map<string, Chapter>} map
 * @param {IChingHexagram} hexagram
 * @param {string} label
 */
function pick(map, hexagram, label) {
  const chapter = map.get(hexagram.symbol);
  if (!chapter) throw new Error(`${label}缺少 ${hexagram.name}（${hexagram.symbol}）`);
  return chapter;
}

const iching = /** @type {{ hexagrams: IChingHexagram[] }} */ (
  JSON.parse(read('data/iching.json'))
);

const tuan = new Map(
  [
    ...parseChapters(read('zhouyi/彖传上.md')),
    ...parseChapters(read('zhouyi/彖传下.md')),
  ].map((chapter) => [chapter.symbol, chapter])
);
const xiang = new Map(
  [
    ...parseChapters(read('zhouyi/象传上.md')),
    ...parseChapters(read('zhouyi/象传下.md')),
  ].map((chapter) => [chapter.symbol, chapter])
);

/** @type {Record<string, any>} */
const hexagrams = {};

for (const hexagram of iching.hexagrams) {
  const tuanChapter = pick(tuan, hexagram, '彖传');
  const image = parseImage(pick(xiang, hexagram, '象传'));

  const expected = hexagram.lines.map((line) => line.position);
  const actual = image.lines
    .filter((line) => !line.position.startsWith('用'))
    .map((line) => line.position);
  if (expected.join('|') !== actual.join('|')) {
    throw new Error(
      `爻位不一致：${hexagram.name}\n  iching: ${expected.join(',')}\n  象传:   ${actual.join(',')}`
    );
  }

  hexagrams[String(hexagram.id)] = {
    id: hexagram.id,
    name: hexagram.name,
    symbol: hexagram.symbol,
    judgment: hexagram.judgment,
    lines: hexagram.lines.map(({ position, text, type }) => ({
      position,
      text,
      type,
    })),
    ...(hexagram.specialLines ? { specialLines: hexagram.specialLines } : {}),
    tuan: tuanChapter.body,
    image,
  };
}

const output = {
  schema: 'zhouyi.canonical/v1',
  defaultEdition: '通行本',
  editions: {
    通行本: {
      label: '通行本',
      source: [
        'data/iching.json（据 zhouyi/易传上.md、易传下.md 整理）',
        'zhouyi/彖传上.md、zhouyi/彖传下.md',
        'zhouyi/象传上.md、zhouyi/象传下.md',
      ],
      hexagrams,
    },
  },
};

writeFileSync(
  resolve(ROOT, 'data/canonical.json'),
  JSON.stringify(output, null, 2) + '\n',
  'utf8'
);

console.log(`✅ Canonical text for ${Object.keys(hexagrams).length} hexagrams → data/canonical.json`);
