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

// ── 10. Domain hexagram ────────────────────────────────
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
