/**
 * parse-zhouyi.js
 *
 * Parses zhouyi/易传上.md and zhouyi/易传下.md into structured JSON.
 * Run: node scripts/parse-zhouyi.js
 * Output: data/iching.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── 1. Read source files ────────────────────────────────────────────
const source1 = fs.readFileSync(path.join(ROOT, 'zhouyi/易传上.md'), 'utf-8');
const source2 = fs.readFileSync(path.join(ROOT, 'zhouyi/易传下.md'), 'utf-8');
const source = source1 + '\n' + source2;

// ── 2. Parse hexagrams ──────────────────────────────────────────────
const blocks = source.split(/(?=^## )/m).filter(b => b.trim());

// Position → line index (0-based, bottom to top)
const POS_TO_LINE = {
  '初九': 0, '初六': 0,
  '九二': 1, '六二': 1,
  '九三': 2, '六三': 2,
  '九四': 3, '六四': 3,
  '九五': 4, '六五': 4,
  '上九': 5, '上六': 5,
};

// Line item regex: - 初九：text  or  - 初六，text
// Matches both fullwidth colon ： fullwidth comma ， and halfwidth comma ,
const LINE_RE = /^-\s*((?:初九|初六|九二|六二|九三|六三|九四|六四|九五|六五|上九|上六|用九|用六))\s*[：，,]\s*(.+)$/;

const hexagrams = [];

for (const block of blocks) {
  const lines = block.trim().split('\n');
  if (lines.length < 2) continue;

  // Parse header: ## ䷀乾
  const headerMatch = lines[0].match(/^##\s*(.)(.+)$/);
  if (!headerMatch) continue;

  const symbol = headerMatch[1];
  const name = headerMatch[2].trim();

  // Separate judgment (first text block before - items) and line items
  let judgmentRaw = '';
  const lineItems = [];
  let inLinesSection = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('- ')) {
      inLinesSection = true;
    }

    if (!inLinesSection) {
      judgmentRaw = line;
    } else {
      const m = line.match(LINE_RE);
      if (m) {
        lineItems.push({ position: m[1], text: m[2].trim() });
      }
    }
  }

  // Clean judgment: strip leading "卦名：" or "卦名，" if present
  let judgment = judgmentRaw;
  const namePrefixRe = new RegExp('^' + escapeRegex(name) + '\\s*[：，,]\\s*');
  if (namePrefixRe.test(judgmentRaw)) {
    judgment = judgmentRaw.replace(namePrefixRe, '');
  }

  // Build binary from line positions
  const binary = [null, null, null, null, null, null];

  for (const item of lineItems) {
    if (item.position.startsWith('用')) continue; // skip 用九/用六
    const lineIdx = POS_TO_LINE[item.position];
    // 九 = yang, 六 = yin — check if the position CONTAINS 九 (e.g., 九二, 初九)
    const isYang = item.position.includes('九');
    binary[lineIdx] = isYang ? 1 : 0;
  }

  const binaryStr = binary.join('');
  const lowerBinary = binaryStr.slice(0, 3);  // lines 1-3 (初→三)
  const upperBinary = binaryStr.slice(3, 6);  // lines 4-6 (四→上)

  // Separate regular lines (1-6) from special lines (用九/用六)
  const regularLines = lineItems.filter(item => !item.position.startsWith('用'));
  const specialLines = lineItems.filter(item => item.position.startsWith('用'));

  hexagrams.push({
    id: hexagrams.length + 1,
    symbol,
    name,
    judgment,
    binary: binaryStr,
    lowerTrigram: lowerBinary,
    upperTrigram: upperBinary,
    lines: regularLines.map(item => ({
      position: item.position,
      text: item.text,
      type: item.position.includes('九') ? 'yang' : 'yin',
    })),
    ...(specialLines.length > 0 ? { specialLines: specialLines.map(item => ({
      position: item.position,
      text: item.text,
    })) } : {}),
  });
}

// ── 3. Build trigram lookup (方案C) ──────────────────────────────────
const TRIGRAM_NAMES = {
  '111': '乾', '110': '兑', '101': '离', '100': '震',
  '011': '巽', '010': '坎', '001': '艮', '000': '坤',
};

const trigramLookup = {};
for (const h of hexagrams) {
  const key = `${h.upperTrigram}:${h.lowerTrigram}`;
  trigramLookup[key] = h.id;
}

// ── 4. Write output ────────────────────────────────────────────────
const output = {
  trigramNames: TRIGRAM_NAMES,
  trigramLookup,
  hexagrams,
};

const outPath = path.join(ROOT, 'data/iching.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

console.log(`✅ Parsed ${hexagrams.length} hexagrams → data/iching.json`);

// ── Helper ──────────────────────────────────────────────────────────
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
