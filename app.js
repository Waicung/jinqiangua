/* ======================================================
   周易起卦 — app.js
   ====================================================== */

// ── 1. Data ───────────────────────────────────────────
let DATA = null;

async function loadData() {
  const res = await fetch('data/iching.json');
  DATA = await res.json();
}

// ── 2. DOM shortcuts ──────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── 3. Constants ──────────────────────────────────────
const LINE_INFO = {
  6: { name: '老阴', yang: false, moving: true,  symbol: '⚋' },
  7: { name: '少阳', yang: true,  moving: false, symbol: '⚊' },
  8: { name: '少阴', yang: false, moving: false, symbol: '⚋' },
  9: { name: '老阳', yang: true,  moving: true,  symbol: '⚊' },
};

const POSITION_NAMES = ['初', '二', '三', '四', '五', '上'];

const TRIGRAM_SYMBOLS = {
  '111': '☰', '110': '☱', '101': '☲', '100': '☳',
  '011': '☴', '010': '☵', '001': '☶', '000': '☷',
};

function posLabel(index, isYang) {
  // index 0-5 (bottom to top)
  const yao = isYang ? '九' : '六';
  if (index === 0) return `初${yao}`;
  if (index === 5) return `上${yao}`;
  return `${yao}${POSITION_NAMES[index]}`;
}

// ── 4. State ──────────────────────────────────────────
const state = {
  phase: 'idle',       // 'idle' | 'casting' | 'result'
  throws: [],          // [{num, name, yang, moving, symbol}]
  currentThrow: 0,     // 0-5
  animating: false,
  showAllLines: false,
  // Hexagram data for prompt generation
  primary: null,
  transformed: null,
  movingLines: [],
  numbers: [],
  primaryLineTypes: [],
  transformedLineTypes: [],
};

// ── 5. Core logic ─────────────────────────────────────
function tossCoins() {
  const coin = () => (Math.random() < 0.5 ? 3 : 2);
  return coin() + coin() + coin();
}

function getPrimaryHexagram(binary) {
  const lower = binary.slice(0, 3);
  const upper = binary.slice(3, 6);
  const key = `${upper}:${lower}`;
  const id = DATA.trigramLookup[key];
  return DATA.hexagrams.find((h) => h.id === id);
}

function getTransformedHexagram(numbers) {
  // Flip bits where num is 6 (old yin → yang) or 9 (old yang → yin)
  const binary = numbers
    .map((n) => (n === 7 || n === 9 ? '1' : '0'))
    .join('');

  const transformed = binary.split('').map((bit, i) => {
    if (numbers[i] === 6) return '1';
    if (numbers[i] === 9) return '0';
    return bit;
  }).join('');

  const lower = transformed.slice(0, 3);
  const upper = transformed.slice(3, 6);
  const key = `${upper}:${lower}`;
  const id = DATA.trigramLookup[key];
  return DATA.hexagrams.find((h) => h.id === id);
}

function getMovingLines(primary, numbers) {
  const movingIndices = [];
  numbers.forEach((n, i) => {
    if (n === 6 || n === 9) movingIndices.push(i);
  });
  return movingIndices.map((idx) => ({
    index: idx,
    ...primary.lines[idx],
    position: posLabel(idx, numbers[idx] === 7 || numbers[idx] === 9),
  }));
}

// ── 6. Phase transitions ──────────────────────────────
function showPhase(phaseId) {
  document.querySelectorAll('.phase').forEach((el) => el.classList.remove('active'));
  $(phaseId).classList.add('active');
}

function startDivination() {
  state.throws = [];
  state.currentThrow = 0;
  state.animating = false;
  state.showAllLines = false;

  $('throw-count').textContent = '第 1 / 6 次';
  $('coin-num').textContent = '-';
  $('coin-label').textContent = '';
  // Reset placeholder lines
  const build = $('hexagram-build');
  build.querySelectorAll('.hexagram-line').forEach((el) => {
    el.className = 'hexagram-line placeholder';
    el.innerHTML = '';
  });
  $('btn-throw').disabled = false;
  $('throw-hint').textContent = '点击摇卦，掷三枚硬币';

  showPhase('phase-casting');
  state.phase = 'casting';
}

// ── 7. Coin throw animation ──────────────────────────
function doThrow() {
  if (state.animating || state.phase !== 'casting') return;

  const btn = $('btn-throw');
  const numEl = $('coin-num');
  const labelEl = $('coin-label');
  const coinEl = $('coin-result');

  btn.disabled = true;
  state.animating = true;
  coinEl.classList.add('flicker');

  // Flicker: rapidly change numbers
  const interval = setInterval(() => {
    const r = Math.floor(Math.random() * 4) + 6;
    numEl.textContent = r;
    labelEl.textContent = LINE_INFO[r].name;
  }, 50);

  // Settle after 0.8s
  setTimeout(() => {
    clearInterval(interval);
    coinEl.classList.remove('flicker');

    const result = tossCoins();
    const info = LINE_INFO[result];

    numEl.textContent = result;
    labelEl.textContent = info.name;

    state.throws.push({ num: result, ...info });
    state.currentThrow++;

    // Add line to building hexagram
    addBuildLine(state.currentThrow - 1, info);

    if (state.currentThrow >= 6) {
      $('throw-hint').textContent = '起卦完成';
      setTimeout(() => showResult(), 600);
    } else {
      $('throw-count').textContent = `第 ${state.currentThrow + 1} / 6 次`;
      btn.disabled = false;
      $('throw-hint').textContent = '继续摇卦';
    }

    state.animating = false;
  }, 800);
}

// ── 8. Build hexagram line rendering ─────────────────
function addBuildLine(index, info) {
  const container = $('hexagram-build');
  const slot = container.querySelector(`[data-index="${index}"]`);
  slot.className = `hexagram-line ${info.yang ? 'yang' : 'yin'} reveal`;
  slot.innerHTML = `<span class="line-visual"></span><span class="line-label">${posLabel(index, info.yang)}</span>`;
  setTimeout(() => slot.classList.remove('reveal'), 300);
}

// ── 9. Result rendering ──────────────────────────────
function showResult() {
  const numbers = state.throws.map((t) => t.num);
  const binary = numbers.map((n) => (n === 7 || n === 9 ? '1' : '0')).join('');

  const primary = getPrimaryHexagram(binary);
  const transformed = getTransformedHexagram(numbers);
  const movingLines = getMovingLines(primary, numbers);

  // Compute line types for both hexagrams
  const primaryLineTypes = numbers.map((n) => (n === 7 || n === 9 ? 'yang' : 'yin'));
  const transformedBits = binary.split('').map((bit, i) => {
    if (numbers[i] === 6) return '1';
    if (numbers[i] === 9) return '0';
    return bit;
  });
  const transformedLineTypes = transformedBits.map((b) => (b === '1' ? 'yang' : 'yin'));

  // Store hexagram data in state for prompt generation
  state.primary = primary;
  state.transformed = transformed;
  state.movingLines = movingLines;
  state.numbers = numbers;
  state.primaryLineTypes = primaryLineTypes;
  state.transformedLineTypes = transformedLineTypes;

  // Build result HTML
  const container = $('result-content');
  container.innerHTML = '';

  // ── Primary hexagram ──
  container.appendChild(renderHexagramSection(primary, '本卦', primaryLineTypes, movingLines.map(m => m.index)));

  if (movingLines.length > 0) {
    // ── Moving lines ──
    container.appendChild(renderDivider());
    container.appendChild(renderMovingLinesSection(movingLines, primaryLineTypes));

    // ── Toggle ──
    container.appendChild(renderToggle());

    // ── All lines (initially hidden) ──
    const allLinesEl = renderAllLinesSection(primary, primaryLineTypes);
    allLinesEl.id = 'all-lines-section';
    allLinesEl.style.display = 'none';
    container.appendChild(allLinesEl);

    // Arrow
    container.appendChild(renderArrow());

    // ── Transformed hexagram ──
    container.appendChild(renderHexagramSection(transformed, '变卦', transformedLineTypes, []));
  } else {
    // No moving lines → no transformation
    container.appendChild(renderNoChangeNote());
  }

  // ── AI prompt section ──
  container.appendChild(renderPromptSection());

  showPhase('phase-result');
  state.phase = 'result';
}

function renderHexagramSection(hexagram, label, lineTypes, movingIndices) {
  const section = document.createElement('div');
  section.className = 'result-section';

  let linesHtml = '';
  for (let i = 0; i < 6; i++) {
    const isMoving = movingIndices.includes(i);
    const isYang = lineTypes[i] === 'yang';
    const pos = posLabel(i, isYang);
    const yangClass = isYang ? 'yang' : 'yin';
    const movingClass = isMoving ? 'moving' : '';
    linesHtml +=
      `<div class="hexagram-line ${yangClass} ${movingClass}">
        <span class="line-visual"></span>
        <span class="line-label">${pos}</span>
      </div>`;
  }

  section.innerHTML = `
    <div class="hexagram-name">${hexagram.symbol} ${hexagram.name}</div>
    <div class="hexagram-display">${linesHtml}</div>
    <div class="judgment">${hexagram.judgment}</div>
  `;

  return section;
}

function renderDivider() {
  const div = document.createElement('div');
  div.className = 'divider';
  return div;
}

function renderArrow() {
  const div = document.createElement('div');
  div.className = 'arrow-down';
  div.textContent = '↓';
  return div;
}

function renderMovingLinesSection(movingLines, lineTypes) {
  const section = document.createElement('div');
  section.className = 'result-section';
  section.innerHTML = '<h2>⚡ 动爻</h2>';

  const list = document.createElement('div');
  list.className = 'lines-section';

  movingLines.forEach((ml) => {
    const isYang = lineTypes[ml.index] === 'yang';
    const symbol = isYang ? '⚊' : '⚋';
    const item = document.createElement('div');
    item.className = 'line-item moving';
    item.innerHTML = `
      <span class="line-symbol">${symbol}</span>
      <span class="line-position">${ml.position}</span>
      <span class="line-text">${ml.text}</span>
    `;
    list.appendChild(item);
  });

  section.appendChild(list);
  return section;
}

function renderAllLinesSection(hexagram, lineTypes) {
  const section = document.createElement('div');
  section.className = 'result-section';

  const list = document.createElement('div');
  list.className = 'lines-section';

  for (let i = 0; i < 6; i++) {
    const isYang = lineTypes[i] === 'yang';
    const symbol = isYang ? '⚊' : '⚋';
    const pos = posLabel(i, isYang);
    const text = hexagram.lines[i].text;
    const item = document.createElement('div');
    item.className = 'line-item';
    item.innerHTML = `
      <span class="line-symbol">${symbol}</span>
      <span class="line-position">${pos}</span>
      <span class="line-text">${text}</span>
    `;
    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

function renderToggle() {
  const container = document.createElement('div');
  container.className = 'toggle-container';
  container.innerHTML = `
    <span style="font-size:0.75rem;color:var(--text-secondary)">仅动爻</span>
    <button id="toggle-lines-btn" class="toggle-btn">显示全部爻辞</button>
  `;
  return container;
}

function renderNoChangeNote() {
  const div = document.createElement('div');
  div.className = 'result-section';
  div.innerHTML = `
    <div class="judgment" style="text-align:center;border-style:dashed;">
      本次起卦无动爻，静卦以本卦卦辞为占。
    </div>
  `;
  return div;
}

// ── 10. AI Prompt ─────────────────────────────────────
function renderPromptSection() {
  const section = document.createElement('div');
  section.className = 'result-section prompt-section';
  section.innerHTML = `
    <h2>🤖 AI 解卦提示</h2>
    <p class="prompt-desc">输入你的问题，一键生成结构化解卦 prompt。复制后可通过系统分享直接发送到 <strong>Gemini</strong> 或其他 AI 应用。</p>
    <textarea id="prompt-question" class="prompt-input" rows="2" placeholder="输入你想问的问题（选填）…"></textarea>
    <button id="btn-gen-prompt" class="btn-secondary prompt-btn">生成解卦提示</button>
    <div id="prompt-output" class="prompt-output" style="display:none;">
      <div class="prompt-label">📋 解卦 Prompt</div>
      <pre id="prompt-text" class="prompt-text"></pre>
      <div class="prompt-actions">
        <button id="btn-copy-prompt" class="btn-secondary prompt-btn">📋 复制</button>
        <button id="btn-share-gemini" class="btn-primary prompt-btn">🚀 在 Gemini 中打开</button>
      </div>
      <span id="copy-feedback" class="copy-feedback"></span>
    </div>
  `;
  return section;
}

function trigramInfo(binary) {
  const lower = binary.slice(0, 3);
  const upper = binary.slice(3, 6);
  const names = DATA.trigramNames;
  return {
    lowerBin: lower,
    upperBin: upper,
    lowerName: names[lower],
    upperName: names[upper],
    lowerSymbol: TRIGRAM_SYMBOLS[lower],
    upperSymbol: TRIGRAM_SYMBOLS[upper],
  };
}

function generatePrompt() {
  const question = $('prompt-question').value.trim() || '（未提供具体问题，请从卦象角度进行一般性解读）';
  const p = state.primary;
  const t = state.transformed;
  const mls = state.movingLines;
  const nums = state.numbers;
  const lineTypes = state.primaryLineTypes;

  const pTri = trigramInfo(p.binary);

  let prompt = `# 周易起卦 — 解卦请求

## 用户问题
${question}

`;

  // ── 本卦 ──
  prompt += `## 本卦：${p.symbol} ${p.name}（第${p.id}卦）
`;
  prompt += `卦辞：${p.judgment}
`;
  prompt += `上卦：${pTri.upperSymbol} ${pTri.upperName}（${pTri.upperBin}）
`;
  prompt += `下卦：${pTri.lowerSymbol} ${pTri.lowerName}（${pTri.lowerBin}）

`;
  prompt += `### 爻辞
`;
  for (let i = 0; i < 6; i++) {
    const isYang = lineTypes[i] === 'yang';
    const pos = posLabel(i, isYang);
    const symbol = isYang ? '⚊' : '⚋';
    prompt += `- ${pos} ${symbol}：${p.lines[i].text}
`;
  }

  // ── 动爻 ──
  if (mls.length > 0) {
    prompt += `
### 动爻
`;
    mls.forEach((ml) => {
      const isYang = lineTypes[ml.index] === 'yang';
      const symbol = isYang ? '⚊' : '⚋';
      const oldType = nums[ml.index] === 6 ? '老阴（⚋→⚊）' : '老阳（⚊→⚋）';
      prompt += `- ${ml.position} ${symbol}：${ml.text}（${oldType}）
`;
    });

    // ── 变卦 ──
    const tTri = trigramInfo(t.binary);
    prompt += `
## 变卦：${t.symbol} ${t.name}（第${t.id}卦）
`;
    prompt += `卦辞：${t.judgment}
`;
    prompt += `上卦：${tTri.upperSymbol} ${tTri.upperName}（${tTri.upperBin}）
`;
    prompt += `下卦：${tTri.lowerSymbol} ${tTri.lowerName}（${tTri.lowerBin}）
`;
  }

  // ── 解卦指令 ──
  prompt += `
---

## 解卦要求

你是一位精通《周易》的占卜解卦师。请根据以上卦象信息，结合用户的问题，进行专业解卦分析。请从以下角度展开：

1. **本卦解读**：本卦的卦象、卦辞对用户问题的启示是什么？上下卦的组合（${pTri.upperSymbol}${pTri.upperName} + ${pTri.lowerSymbol}${pTri.lowerName}）象征什么情境？
`;

  if (mls.length > 0) {
    prompt += `2. **动爻分析**：动爻的变化揭示了什么转机、警示或关键节点？为什么这些爻位在此时发生变化？
3. **变卦趋势**：从本卦到变卦的转化预示了什么样的发展方向？变卦的卦辞如何补充本卦的信息？
4. **综合建议**：结合用户的具体处境，给出指向性的行动建议或思考方向。
`;
  } else {
    prompt += `2. **静卦解读**：本次无动爻，以本卦卦辞为占。卦辞对用户问题的直接启示是什么？
3. **综合建议**：结合用户的具体处境，给出指向性的行动建议或思考方向。
`;
  }

  $('prompt-text').textContent = prompt;
  $('prompt-output').style.display = 'block';
  $('copy-feedback').textContent = '';
}

function copyPrompt() {
  const text = $('prompt-text').textContent;
  if (!text) return;
  copyText(text);
  $('copy-feedback').textContent = '✅ 已复制！';
  setTimeout(() => { $('copy-feedback').textContent = ''; }, 2000);
}

async function shareToGemini() {
  const text = $('prompt-text').textContent;
  if (!text) return;

  // First ensure clipboard has the text
  await copyText(text);

  // Try native share — surfaces installed apps (Gemini, Claude, ChatGPT, etc.)
  if (navigator.share) {
    try {
      await navigator.share({
        title: '周易起卦 — 解卦请求',
        text: text,
      });
      return;
    } catch (err) {
      // User cancelled share sheet — that's fine, do nothing
      if (err.name !== 'AbortError') {
        console.warn('Share failed:', err);
      }
    }
  }

  // Fallback: open Gemini web with a prompt to paste
  window.open('https://gemini.google.com', '_blank');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

// ── 11. Domain hexagram ────────────────────────────────
const DOMAIN_DIGITS = [1, 6, 4, 8, 3, 9];

function getDomainHexagram() {
  // Even → yin (0), odd → yang (1), from bottom to top
  const binary = DOMAIN_DIGITS.map((d) => (d % 2 === 0 ? '0' : '1')).join('');
  const lower = binary.slice(0, 3);
  const upper = binary.slice(3, 6);
  const key = upper + ':' + lower;
  const id = DATA.trigramLookup[key];
  return DATA.hexagrams.find((h) => h.id === id);
}

function renderDomainHexagram() {
  const h = getDomainHexagram();
  if (!h) return;

  // Build hexagram lines
  const container = $('domain-hexagram');
  const bits = DOMAIN_DIGITS.map((d) => (d % 2 === 0 ? '0' : '1'));
  for (let i = 0; i < 6; i++) {
    const isYang = bits[i] === '1';
    const div = document.createElement('div');
    div.className = 'hexagram-line ' + (isYang ? 'yang' : 'yin');
    div.innerHTML = '<span class="line-visual"></span>';
    container.appendChild(div);
  }

  // Show name
  $('domain-name').innerHTML =
    '<span class="symbol">' + h.symbol + '</span> ' + h.name;
}

// ── 11. Event handlers ────────────────────────────────
function setupEvents() {
  $('btn-start').addEventListener('click', startDivination);
  $('btn-throw').addEventListener('click', doThrow);
  $('btn-reset').addEventListener('click', startDivination);

  // Toggle: use event delegation since the toggle button is created dynamically
  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('#toggle-lines-btn');
    if (!toggleBtn) return;

    const allLines = $('all-lines-section');
    if (!allLines) return;

    const isHidden = allLines.style.display === 'none';
    allLines.style.display = isHidden ? 'block' : 'none';
    toggleBtn.textContent = isHidden ? '收起爻辞' : '显示全部爻辞';
    toggleBtn.classList.toggle('active', isHidden);
  });

  // Prompt generation & sharing
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-gen-prompt')) generatePrompt();
    if (e.target.closest('#btn-copy-prompt')) copyPrompt();
    if (e.target.closest('#btn-share-gemini')) shareToGemini();
  });
}

// ── 11. Init ──────────────────────────────────────────
async function init() {
  await loadData();
  renderDomainHexagram();
  $('btn-start').disabled = false;
  $('btn-start').textContent = '起卦';
  setupEvents();
}

init();

$('btn-start').disabled = true;
$('btn-start').textContent = '加载中…';
