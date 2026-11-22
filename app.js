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
  // Hexagram data for prompt generation
  primary: null,
  transformed: null,
  movingLines: [],
  numbers: [],
  primaryLineTypes: [],
  transformedLineTypes: [],
  geminiAvailable: true,
};

// ── 4.5. Gemini connectivity check ────────────────────
async function checkGeminiConnectivity() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    // Try a simple GET and inspect the response where possible. Some hosts
    // return an opaque response with status 0 when mode: 'no-cors' is used,
    // so treat status 0 as a possible success rather than a hard failure.
    const res = await fetch('https://gemini.google.com/', {
      mode: 'no-cors',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res && (res.status === 0 || (res.status >= 200 && res.status < 300))) {
      console.log('Gemini connectivity check passed.');
      state.geminiAvailable = true;
    } else if (res && res.status === 403) {
      console.warn('Gemini reachable but returned 403 Forbidden. Access denied.');
      state.geminiAvailable = false;
    } else {
      console.warn('Gemini connectivity check returned unexpected status:', res && res.status);
      state.geminiAvailable = false;
    }
  } catch {
    state.geminiAvailable = false;
    console.warn('Gemini connectivity check failed. Falling back to Doubao.');
  }
  // 检测完成后更新 UI（如果按钮已渲染）
  updateShareButtonUI();
}

// ── 5. Core logic ─────────────────────────────────────
function tossCoins() {
  const coin = () => (Math.random() < 0.5 ? 3 : 2);
  const values = [coin(), coin(), coin()];
  return { values, sum: values[0] + values[1] + values[2] };
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

  $('throw-count').textContent = '第 1 / 6 次';
  // Reset coins
  const coinEls = $('coin-result').querySelectorAll('.coin');
  coinEls.forEach((c) => {
    c.className = 'coin';
    c.querySelector('.coin-face').textContent = '—';
  });
  $('coin-num').textContent = '—';
  $('coin-num').className = 'coin-num';
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

  // 用户首次点击「摇卦」时后台检测 Gemini 连通性
  if (state.currentThrow === 0) {
    checkGeminiConnectivity();
  }

  const btn = $('btn-throw');
  const coinResultEl = $('coin-result');
  const coinEls = coinResultEl.querySelectorAll('.coin');
  const numEl = $('coin-num');

  btn.disabled = true;
  state.animating = true;
  coinResultEl.classList.add('flicker');

  // ── Reset coins for fresh flicker ──
  coinEls.forEach((c) => {
    c.className = 'coin';
    c.querySelector('.coin-face').textContent = '—';
  });
  numEl.className = 'coin-num';
  numEl.textContent = '—';

  // ── Flicker: each coin flips 2↔3 independently ──
  const coinIntervals = [];
  coinEls.forEach((coin, i) => {
    const face = coin.querySelector('.coin-face');
    const interval = setInterval(() => {
      face.textContent = Math.random() < 0.5 ? '2' : '3';
    }, 40 + i * 12); // slightly staggered for organic feel
    coinIntervals.push(interval);
  });

  // ── Flicker: sum dances between 6–9 ──
  const sumInterval = setInterval(() => {
    numEl.textContent = String(Math.floor(Math.random() * 4) + 6);
  }, 50);

  // ── Settle after 1.2s (slower = more deliberate) ──
  const settleDelay = 1200;
  setTimeout(() => {
    coinIntervals.forEach(clearInterval);
    clearInterval(sumInterval);
    coinResultEl.classList.remove('flicker');

    const result = tossCoins();
    const info = LINE_INFO[result.sum];

    // ── Settle individual coins ──
    coinEls.forEach((coin, i) => {
      const val = result.values[i];
      const face = coin.querySelector('.coin-face');
      face.textContent = val;
      coin.classList.add('settling');
      coin.classList.add(val === 3 ? 'heads' : 'tails');
    });

    // ── Settle sum ──
    numEl.textContent = result.sum;
    numEl.classList.add('settled');

    state.throws.push({ num: result.sum, ...info });
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
  }, settleDelay);
}

// ── 8. Build hexagram line rendering ─────────────────
function addBuildLine(index, info) {
  const container = $('hexagram-build');
  const slot = container.querySelector(`[data-index="${index}"]`);
  slot.className = `hexagram-line ${info.yang ? 'yang' : 'yin'} reveal`;
  slot.innerHTML = '<span class="line-visual"></span>';
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

  // 新一次起卦重新开始对话
  resetChat();

  // Build result HTML
  const container = $('result-content');
  container.innerHTML = '';
  const movingIndices = movingLines.map((m) => m.index);

  // ── 本卦概览 ──
  container.appendChild(renderHero(primary, '本卦', primaryLineTypes, movingIndices, { jump: true }));

  if (movingLines.length > 0) {
    // ── 动爻：本卦 → 变卦 的对应关系 ──
    container.appendChild(renderMovingCard(movingLines, numbers, transformed, transformedLineTypes));

    // ── 变卦概览 ──
    container.appendChild(renderHero(transformed, '变卦', transformedLineTypes, []));

    // ── 变卦爻辞：默认收起，可展开全部 ──
    container.appendChild(renderToggle());
    const allLinesEl = renderLineFeed(transformed, transformedLineTypes, [], '变卦爻辞');
    allLinesEl.id = 'all-lines-section';
    allLinesEl.style.display = 'none';
    container.appendChild(allLinesEl);
  } else {
    container.appendChild(renderNoChangeNote());
  }

  // ── 本卦爻辞：六爻全部显示，动爻高亮 ──
  container.appendChild(renderLineFeed(primary, primaryLineTypes, movingIndices, '本卦爻辞'));

  // ── 解卦对话 ──
  container.appendChild(renderChatSection());

  // 新结果：收起上一次的复制提示 toast
  const oldToast = $('chat-toast');
  if (oldToast) oldToast.classList.remove('show');

  showPhase('phase-result');
  state.phase = 'result';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 卦象概览卡：符号 + 卦名 + 六爻 + 卦辞
function renderHero(hexagram, label, lineTypes, movingIndices, options = {}) {
  const section = document.createElement('section');
  section.className = 'result-hero' + (label === '变卦' ? ' is-transformed' : '');
  const tri = trigramInfo(hexagram.binary);

  let linesHtml = '';
  // 上爻在上：从 index 5 往下画
  for (let i = 5; i >= 0; i--) {
    const isYang = lineTypes[i] === 'yang';
    const isMoving = movingIndices.includes(i);
    linesHtml += `
      <div class="hero-line ${isYang ? 'yang' : 'yin'}${isMoving ? ' moving' : ''}">
        <span class="hero-pos">${posLabel(i, isYang)}</span>
        <span class="hero-bar"></span>
      </div>`;
  }

  section.innerHTML = `
    <div class="hero-top">
      <span class="hero-badge">${label}</span>
      <span class="hero-id">第 ${hexagram.id} 卦</span>
    </div>
    <div class="hero-main">
      <div class="hero-glyph">${hexagram.symbol}</div>
      <div class="hero-info">
        <div class="hero-name">${hexagram.name}</div>
        <div class="hero-trigrams">${tri.upperSymbol} ${tri.upperName} · ${tri.lowerSymbol} ${tri.lowerName}</div>
      </div>
    </div>
    <div class="hero-lines">${linesHtml}</div>
    <div class="hero-judgment">${hexagram.judgment}</div>
    ${options.jump ? '<button class="hero-jump" data-scroll="chat-panel">带着卦象去解卦 ↓</button>' : ''}
  `;
  return section;
}

// 爻辞列表：每条一个卡片，动爻高亮
function renderLineFeed(hexagram, lineTypes, movingIndices, title) {
  const section = document.createElement('section');
  section.className = 'result-feed';

  let cards = '';
  for (let i = 0; i < 6; i++) {
    const isYang = lineTypes[i] === 'yang';
    const isMoving = movingIndices.includes(i);
    cards += `
      <article class="line-card${isMoving ? ' moving' : ''}">
        <div class="lc-head">
          <span class="lc-bar ${isYang ? 'yang' : 'yin'}"></span>
          <span class="lc-pos">${posLabel(i, isYang)}</span>
          ${isMoving ? '<span class="lc-badge">⚡ 动爻</span>' : ''}
        </div>
        <p class="lc-text">${hexagram.lines[i].text}</p>
      </article>`;
  }

  section.innerHTML = `
    <div class="feed-head">
      <span class="feed-title">${title}</span>
      ${movingIndices.length ? `<span class="feed-sub">${movingIndices.length} 爻动</span>` : ''}
    </div>
    <div class="line-list">${cards}</div>
  `;
  return section;
}

// 动爻卡：本卦爻辞 → 变卦对应爻辞（上下排列，不再挤在一行）
function renderMovingCard(movingLines, numbers, transformed, transformedLineTypes) {
  const section = document.createElement('section');
  section.className = 'moving-card';

  const items = movingLines.map((ml) => {
    const idx = ml.index;
    const num = numbers[idx];
    const tIsYang = transformedLineTypes[idx] === 'yang';
    const change = num === 6
      ? { label: '老阴', arrow: '⚋ → ⚊' }
      : { label: '老阳', arrow: '⚊ → ⚋' };

    return `
      <div class="mc-item">
        <div class="mc-side">
          <span class="mc-tag">本卦</span>
          <span class="mc-pos">${ml.position}</span>
          <p class="mc-text">${ml.text}</p>
        </div>
        <div class="mc-shift">
          <span class="mc-shift-label">${change.label}</span>
          <span class="mc-shift-icon">${change.arrow}</span>
        </div>
        <div class="mc-side">
          <span class="mc-tag alt">变卦</span>
          <span class="mc-pos">${posLabel(idx, tIsYang)}</span>
          <p class="mc-text">${transformed.lines[idx].text}</p>
        </div>
      </div>`;
  }).join('');

  section.innerHTML = `
    <div class="mc-head">
      <span class="mc-title">⚡ 动爻</span>
      <span class="mc-sub">${movingLines.length} 爻变化</span>
    </div>
    ${items}
  `;
  return section;
}

function renderToggle() {
  const container = document.createElement('div');
  container.className = 'toggle-container';
  container.innerHTML = `
    <button id="toggle-lines-btn" class="toggle-btn" aria-expanded="false">
      <span>变卦六爻爻辞</span><span class="toggle-chevron">⌄</span>
    </button>
  `;
  return container;
}

function renderNoChangeNote() {
  const div = document.createElement('div');
  div.className = 'static-note';
  div.innerHTML = '本次起卦无动爻，为<strong>静卦</strong>，以本卦卦辞为占。';
  return div;
}

// ── 10. AI Prompt ─────────────────────────────────────
function updateShareButtonUI() {
  const btn = document.getElementById('btn-share-ai');
  if (!btn) return; // 还未渲染，跳过
  btn.textContent = state.geminiAvailable ? '打开 Gemini ↗' : '打开豆包 ↗';
}

function currentQuestion() {
  const input = $('chat-input');
  const typed = input ? input.value.trim() : '';
  if (typed) return typed;
  const lastUser = [...chatState.history].reverse().find((m) => m.role === 'user');
  return lastUser ? lastUser.text : '';
}

function showToast(message) {
  let toast = document.getElementById('chat-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'chat-toast';
    toast.className = 'chat-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  void toast.offsetWidth; // 重置动画
  toast.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
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

function buildPromptText(questionRaw, options = {}) {
  const question = (questionRaw || '').trim() || '（未提供具体问题，请从卦象角度进行一般性解读）';
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

  // 对话模式只需要卦象资料，不需要一次性的解卦指令
  if (options.instructions === false) return prompt;

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

  return prompt;
}

async function generatePrompt() {
  const text = buildPromptText(currentQuestion());
  $('prompt-text').textContent = text;
  $('prompt-output').hidden = false;
  await copyText(text);
  showToast('解卦提示已复制，粘贴给任意 AI 即可');
  const out = $('prompt-output');
  if (out) out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return text;
}

async function copyPrompt() {
  const text = $('prompt-text').textContent;
  if (!text) return;
  await copyText(text);
  showToast('已复制');
}

async function shareToGemini() {
  const text = await generatePrompt();

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

  // Fallback: open appropriate AI app based on availability
  if (state.geminiAvailable) {
    window.open('https://gemini.google.com', '_blank');
  } else {
    // Try doubao deep link first, then website
    window.open('https://www.doubao.com/', '_blank');
  }
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

// ── 10.6. Local Gemini chat (user-supplied API key) ─────
// 直接在浏览器调用 Gemini REST API，Key 仅存于本机 localStorage，
// 不经过任何服务器。离线时该区块不可用，其余功能不受影响。
//
// 传输层：优先 Interactions API（2026-06 GA，官方推荐给新项目），
// 不可用时（404/405，如老账号或老区域）自动回退到 legacy 的
// generateContent（官方声明仍“fully supported”）。
// 模型名可在 UI 中修改，避免模型迭代时又需改代码。
const GEMINI_MODEL_DEFAULT = 'gemini-3.8-flash';
const GEMINI_KEY_STORAGE = 'gemini_api_key';
const GEMINI_MODEL_STORAGE = 'gemini_model';
const CHAT_TIMEOUT_MS = 60000;

const chatState = {
  history: [],        // [{ role: 'user' | 'model', text }]，回退到 generateContent 时重放
  system: '',
  busy: false,
  transport: 'interactions', // 记住当前可用的传输层
  previousInteractionId: '',  // Interactions API 的会话句柄
};

function getGeminiKey() {
  try {
    return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

function setGeminiKey(key) {
  try {
    if (key) localStorage.setItem(GEMINI_KEY_STORAGE, key);
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略
  }
}

// 允许用户填 `gemini-3.8-flash` 或 `models/gemini-3.8-flash`
function getGeminiModel() {
  let model = '';
  try {
    model = localStorage.getItem(GEMINI_MODEL_STORAGE) || '';
  } catch {
    model = '';
  }
  model = (model || GEMINI_MODEL_DEFAULT).trim().replace(/^models\//, '');
  return model || GEMINI_MODEL_DEFAULT;
}

function setGeminiModel(model) {
  const clean = (model || '').trim().replace(/^models\//, '');
  try {
    if (clean && clean !== GEMINI_MODEL_DEFAULT) localStorage.setItem(GEMINI_MODEL_STORAGE, clean);
    else localStorage.removeItem(GEMINI_MODEL_STORAGE);
  } catch {
    // 同上，忽略
  }
}

function resetChat() {
  chatState.history = [];
  chatState.system = '';
  chatState.busy = false;
  chatState.previousInteractionId = '';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// 极简 Markdown：先转义，再只识别标题/加粗/列表
function formatChatText(text) {
  return escapeHtml(text)
    .replace(/^#{1,6}\s*(.+)$/gm, '<strong>$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s+/gm, '· ');
}

function renderChatSection() {
  const section = document.createElement('section');
  section.className = 'chat-panel';
  section.id = 'chat-panel';
  section.innerHTML = `
    <div class="chat-header">
      <div class="chat-avatar">☯</div>
      <div class="chat-head-text">
        <div class="chat-title">解卦 <span class="chat-live">AI</span></div>
        <div id="chat-key-status" class="chat-sub"></div>
      </div>
      <button id="btn-chat-settings" class="chat-icon-btn" title="Gemini 设置" aria-label="Gemini 设置">⚙</button>
    </div>

    <div id="chat-settings" class="chat-settings" hidden>
      <label class="chat-field">
        <span class="chat-field-label">Gemini API Key</span>
        <input id="gemini-key" type="password" class="prompt-input" placeholder="粘贴 Key（留空则保留已存的）" autocomplete="off" spellcheck="false">
      </label>
      <label class="chat-field">
        <span class="chat-field-label">模型</span>
        <input id="gemini-model" class="prompt-input" autocomplete="off" spellcheck="false">
      </label>
      <div class="chat-btn-row">
        <button id="btn-save-key" class="btn-secondary chat-mini-btn">保存</button>
        <button id="btn-clear-key" class="btn-secondary chat-mini-btn">清除 Key</button>
      </div>
      <p class="chat-hint">Key 只保存在本机浏览器 · <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">去 AI Studio 免费获取</a></p>
    </div>

    <div id="chat-log" class="chat-log"></div>
    <div id="chat-chips" class="chat-chips"></div>

    <form id="chat-composer" class="chat-composer" autocomplete="off">
      <textarea id="chat-input" class="chat-input" rows="1" enterkeyhint="send" placeholder="问问这次卦象…"></textarea>
      <button id="btn-chat-send" class="chat-send" type="submit" title="发送" aria-label="发送">↑</button>
    </form>

    <div class="chat-footer">
      <button id="btn-gen-prompt" class="chat-text-btn">复制解卦提示</button>
      <button id="btn-share-ai" class="chat-text-btn">打开 Gemini ↗</button>
    </div>

    <div id="prompt-output" class="chat-prompt" hidden>
      <pre id="prompt-text" class="prompt-text"></pre>
      <div class="prompt-actions">
        <button id="btn-copy-prompt" class="btn-secondary prompt-btn">📋 再复制一次</button>
      </div>
    </div>
  `;
  setTimeout(() => {
    updateChatKeyUI();
    renderChatIntro();
    updateShareButtonUI();
    syncSendButton();
  }, 0);
  return section;
}

function openChatSettings() {
  const panel = $('chat-settings');
  if (panel) panel.hidden = false;
  const input = $('gemini-key');
  if (input && !getGeminiKey()) setTimeout(() => input.focus(), 60);
}

function updateChatKeyUI() {
  const modelInput = $('gemini-model');
  // 每次重建都回填当前设置（不渲染 Key 本身）
  if (modelInput && !modelInput.matches(':focus')) modelInput.value = getGeminiModel();

  const status = $('chat-key-status');
  const key = getGeminiKey();

  if (status) {
    status.innerHTML = key
      ? `<span class="status-dot online"></span> 已连接 · …${escapeHtml(key.slice(-4))} · ${escapeHtml(getGeminiModel())}`
      : '<span class="status-dot"></span> 未配置 Key · 也能复制提示去外部 AI';
  }

  const clearBtn = $('btn-clear-key');
  if (clearBtn) clearBtn.hidden = !key;
}

function saveKeyFromInput() {
  const keyInput = $('gemini-key');
  const modelInput = $('gemini-model');
  if (!keyInput || !modelInput) return;

  // 留空 = 只改模型，不动已存的 Key（清除 Key 用单独的按钮）
  const key = keyInput.value.trim();
  if (key) setGeminiKey(key);
  setGeminiModel(modelInput.value);
  keyInput.value = '';

  // Key / 模型变更后重新开始对话
  resetChat();
  const log = $('chat-log');
  if (log) log.innerHTML = '';
  updateChatKeyUI();
  renderChatIntro();

  const panel = $('chat-settings');
  if (panel) panel.hidden = true;
  showToast('Gemini 设置已保存');
}

function clearGeminiKey() {
  setGeminiKey('');
  resetChat();
  const log = $('chat-log');
  if (log) log.innerHTML = '';
  updateChatKeyUI();
  renderChatIntro();
  showToast('已清除本机 Key');
}

function buildQuickChips() {
  const hasMoving = state.movingLines.length > 0;
  return [
    '这次卦象的核心提示是什么？',
    hasMoving ? '动爻在提醒我什么？' : '静卦该怎么理解？',
    hasMoving ? '变卦的趋势如何？' : '我该注意什么？',
    '用三点帮我总结',
  ];
}

function renderChatIntro() {
  const log = $('chat-log');
  if (!log || log.childElementCount > 0) return;

  const p = state.primary;
  const t = state.transformed;
  const mls = state.movingLines;

  let text = `本次得到「${p.symbol} ${p.name}」。\n${p.judgment}`;
  if (mls.length) {
    text += `\n\n动爻在${mls.map((m) => m.position).join('、')}，会转为「${t.symbol} ${t.name}」。`;
  } else {
    text += '\n\n六爻皆静，以本卦卦辞为占。';
  }
  text += '\n\n想从哪里聊起？可以直接问我。';
  appendChatMessage('model', text);

  const wrap = $('chat-chips');
  if (wrap) {
    wrap.style.display = '';
    wrap.innerHTML = buildQuickChips()
      .map((q) => `<button type="button" class="chat-chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
      .join('');
  }
}

function scrollChatToEnd() {
  const log = $('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
}

function appendChatMessage(role, text) {
  const log = $('chat-log');
  if (!log) return null;
  const row = document.createElement('div');

  if (role === 'user') {
    row.className = 'chat-row user';
    row.innerHTML = `<div class="chat-bubble">${formatChatText(text)}</div>`;
  } else if (role === 'error') {
    row.className = 'chat-row model';
    row.innerHTML = `<div class="chat-avatar sm warn">!</div><div class="chat-bubble error">${formatChatText(text)}</div>`;
  } else if (role === 'system') {
    row.className = 'chat-system';
    row.innerHTML = `<div class="chat-bubble system">${formatChatText(text)}</div>`;
  } else {
    row.className = 'chat-row model';
    row.innerHTML = `<div class="chat-avatar sm">☯</div><div class="chat-bubble">${formatChatText(text)}</div>`;
  }

  log.appendChild(row);
  scrollChatToEnd();
  return row;
}

function appendTyping() {
  const log = $('chat-log');
  if (!log) return null;
  const row = document.createElement('div');
  row.className = 'chat-row model chat-typing-row';
  row.innerHTML = `<div class="chat-avatar sm">☯</div><div class="chat-bubble typing"><span></span><span></span><span></span></div>`;
  log.appendChild(row);
  scrollChatToEnd();
  return row;
}

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function syncSendButton() {
  const btn = $('btn-chat-send');
  const input = $('chat-input');
  if (!btn || !input) return;
  btn.disabled = chatState.busy || !input.value.trim();
}

function buildChatSystemPrompt() {
  return `你是一位精通《周易》的占卜解卦师。以下是用户本次起卦的完整资料：

${buildPromptText('（用户会在对话中提出具体问题）', { instructions: false })}
---

请依据以上资料与用户多轮对话：回答追问时简洁、具体、有针对性，不要重复粘贴整段卦象原文。`;
}

async function postJson(url, body, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 用 header 传 Key，避免出现在 URL / 日志 / Referer 中
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  } catch (err) {
    throw new Error(
      err.name === 'AbortError' ? '请求超时，请稍后重试' : '网络错误，无法连接 Gemini'
    );
  } finally {
    clearTimeout(timer);
  }
}

// Interactions API：只需发本轮新输入，历史由 previous_interaction_id 维护
function callInteractions(key, text) {
  const body = {
    model: getGeminiModel(),
    input: text,
    // system_instruction 是 interaction 级别的，每轮都要重发
    system_instruction: chatState.system,
  };
  if (chatState.previousInteractionId) {
    body.previous_interaction_id = chatState.previousInteractionId;
  }
  return postJson('https://generativelanguage.googleapis.com/v1beta/interactions', body, key);
}

// 旧接口 generateContent：需重放完整 contents
function callGenerateContent(key) {
  return postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModel()}:generateContent`,
    {
      systemInstruction: { parts: [{ text: chatState.system }] },
      contents: chatState.history.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      })),
    },
    key
  );
}

function parseInteractionReply(data) {
  const steps = (data && data.steps) || [];
  const texts = [];
  for (const step of steps) {
    if (step.type !== 'model_output' || !Array.isArray(step.content)) continue;
    for (const block of step.content) {
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    }
  }
  return { text: texts.join('').trim(), id: (data && data.id) || '' };
}

function parseGenerateContentReply(data) {
  const candidate = data && data.candidates && data.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  const reason =
    (data && data.promptFeedback && data.promptFeedback.blockReason) ||
    (candidate && candidate.finishReason);
  return { text: parts.map((p) => p.text || '').join('').trim(), reason };
}

// 上游文案自带句点时避免出现「.。」这样的双标点
function stripEnd(msg) {
  return String(msg || '').trim().replace(/[.。]$/, '');
}

function apiError(status, data) {
  const msg = (data && data.error && data.error.message) || '';
  if (status === 400 && /api key/i.test(msg)) {
    return new Error('API Key 无效，请检查后重新保存');
  }
  if (status === 401 || status === 403) {
    return new Error(
      `该 Key 无权访问模型「${getGeminiModel()}」：${stripEnd(msg) || '请确认该模型已对你的账号开放'} 可在「更换 / 清除」中换个模型名（如 gemini-flash-latest）。`
    );
  }
  if (status === 404) {
    return new Error(
      `模型「${getGeminiModel()}」不可用：${stripEnd(msg) || '可能已对新用户下线'} 请在「更换 / 清除」中改为 gemini-3.8-flash 或 gemini-flash-latest。`
    );
  }
  if (status === 429) return new Error('调用额度已用尽，请稍后重试或更换 Key');
  return new Error(msg || `请求失败（HTTP ${status}）`);
}

async function requestGemini(key, text) {
  // 记住上次成功的传输层；首次默认 Interactions API
  const attempts =
    chatState.transport === 'generateContent'
      ? ['generateContent']
      : ['interactions', 'generateContent'];

  let result = null;
  for (const transport of attempts) {
    result = transport === 'interactions'
      ? await callInteractions(key, text)
      : await callGenerateContent(key);

    if (result.res.ok) {
      chatState.transport = transport;
      const reply = transport === 'interactions'
        ? parseInteractionReply(result.data)
        : parseGenerateContentReply(result.data);

      if (reply.text) return reply;

      // in_progress / requires_action 等：明确告知而不是空回复
      const status = result.data && result.data.status;
      throw new Error(
        reply.reason
          ? `模型未返回内容（${reply.reason}）`
          : status
            ? `模型未返回内容（${status}）`
            : '模型未返回内容'
      );
    }

    // 只有「接口不存在」才值得换另一条路，其余错误直接抛
    if (result.res.status !== 404 && result.res.status !== 405) break;
  }

  throw apiError(result.res.status, result.data);
}

async function sendChatMessage() {
  if (chatState.busy) return;

  const input = $('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  if (!getGeminiKey()) {
    openChatSettings();
    appendChatMessage('system', '配置 Gemini Key 后就能直接对话。不想用 Key？点下方「复制解卦提示」交给任意 AI 也可以。');
    return;
  }
  if (!navigator.onLine) {
    appendChatMessage('system', '当前离线，无法连接 Gemini。卦象与复制提示仍可正常使用。');
    return;
  }

  if (!chatState.system) chatState.system = buildChatSystemPrompt();

  input.value = '';
  input.style.height = 'auto';
  const userEl = appendChatMessage('user', text);
  chatState.history.push({ role: 'user', text });

  // 开始对话后收起快捷回复，避免干扰
  const chips = $('chat-chips');
  if (chips) chips.style.display = 'none';

  const btn = $('btn-chat-send');
  chatState.busy = true;
  if (btn) {
    btn.disabled = true;
    btn.classList.add('loading');
  }
  const typing = appendTyping();

  try {
    const reply = await requestGemini(getGeminiKey(), text);
    if (typing) typing.remove();
    appendChatMessage('model', reply.text);
    chatState.history.push({ role: 'model', text: reply.text });
    // Interactions API 的服务端会话句柄
    if (reply.id) chatState.previousInteractionId = reply.id;
  } catch (err) {
    if (typing) typing.remove();
    chatState.history.pop(); // 回滚失败的用户提问，避免污染上下文
    if (userEl) userEl.remove();
    // 把问题放回输入框，方便修改 Key 后重试
    if (input && !input.value.trim()) input.value = text;
    appendChatMessage('error', '⚠️ ' + (err.message || '请求失败'));
  } finally {
    chatState.busy = false;
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
    autoGrow(input);
    syncSendButton();
  }
}

// ── 10.7. Dev shortcuts (跳过摇卦) ──────────────────────
// 只在本地开发（localhost / 127.0.0.1）或带 ?dev=1 时生效，
// 生产环境不会出现。两种跳过摇卦的方式：
//   ?cast=7,8,9,7,6,8   直接按给定六爻出结果（便于复现同一个卦）
//   左下角「⚡ 直接出结果」 随机摇六次并立即渲染
const DEV_MODE = (() => {
  try {
    const host = location.hostname;
    const isLocal =
      host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
      host === '::1' || host === '[::1]';
    return isLocal || new URLSearchParams(location.search).has('dev');
  } catch {
    return false;
  }
})();

function parseCast(str) {
  // 允许 7,8,9,7,6,8 / 7 8 9 7 6 8 / 789678
  const raw = String(str || '').trim();
  const nums = /^[6-9]{6}$/.test(raw)
    ? raw.split('').map(Number)
    : raw.split(/[^6-9]+/).filter(Boolean).map(Number);
  if (nums.length !== 6 || nums.some((n) => !LINE_INFO[n])) return null;
  return nums;
}

function devCastFromUrl() {
  try {
    return parseCast(new URLSearchParams(location.search).get('cast'));
  } catch {
    return null;
  }
}

function randomCast() {
  return Array.from({ length: 6 }, () => tossCoins().sum);
}

// 不播动画，直接把这 6 个和值当作摇出的结果
function applyCast(numbers) {
  state.throws = numbers.map((n) => ({ num: n, ...LINE_INFO[n] }));
  state.currentThrow = 6;
  state.animating = false;
  showResult();
}

function renderDevBar() {
  if (!DEV_MODE) return;

  const bar = document.createElement('div');
  bar.id = 'dev-bar';
  bar.innerHTML = `
    <button id="dev-skip" title="随机摇六次并直接出结果">⚡ 直接出结果</button>
    <input id="dev-cast" placeholder="7,8,9,7,6,8" title="输入 6 个 6~9 的数后回车" autocomplete="off" spellcheck="false">
  `;
  document.body.appendChild(bar);

  $('dev-skip').addEventListener('click', () => applyCast(randomCast()));
  $('dev-cast').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const nums = parseCast(e.target.value);
    if (!nums) {
      e.target.value = '';
      e.target.placeholder = '需要 6 个 6~9 的数';
      return;
    }
    applyCast(nums);
    e.target.blur();
  });
}

// ── 10.5. Online status ──────────────────────────────────
function updateOnlineStatus() {
  const btn = $('btn-refresh');
  if (!btn) return;
  if (navigator.onLine) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

// ── 11. Force Refresh ───────────────────────────────────
async function forceRefresh() {
  const btn = $('btn-refresh');
  btn.classList.add('refreshing');
  btn.title = '刷新中…';

  try {
    // 1. If there's a waiting service worker, tell it to skip waiting
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      const registration = await navigator.serviceWorker.ready;
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }

    // 2. Clear all caches
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    // 3. Reload the page with a cache-busting param
    const t = Date.now();
    window.location.href = window.location.pathname + '?v=' + t;
  } catch (err) {
    console.error('Force refresh failed:', err);
    // Fallback: hard reload
    window.location.reload(true);
  }
}

// ── 12. Domain hexagram ────────────────────────────────
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

  // Toggle: 变卦全部爻辞的展开 / 收起
  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('#toggle-lines-btn');
    if (!toggleBtn) return;

    const allLines = $('all-lines-section');
    if (!allLines) return;

    const isHidden = allLines.style.display === 'none';
    allLines.style.display = isHidden ? 'block' : 'none';
    toggleBtn.querySelector('span').textContent = isHidden ? '收起变卦爻辞' : '变卦六爻爻辞';
    toggleBtn.classList.toggle('active', isHidden);
    toggleBtn.setAttribute('aria-expanded', String(isHidden));
  });

  // Prompt、分享、chat 设置、快捷回复、跳转
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-gen-prompt')) generatePrompt();
    if (e.target.closest('#btn-copy-prompt')) copyPrompt();
    if (e.target.closest('#btn-share-ai')) shareToGemini();

    if (e.target.closest('#btn-chat-settings')) {
      const panel = $('chat-settings');
      if (panel) panel.hidden = !panel.hidden;
    }
    if (e.target.closest('#btn-save-key')) saveKeyFromInput();
    if (e.target.closest('#btn-clear-key')) clearGeminiKey();

    // 快捷回复 chip
    const chip = e.target.closest('.chat-chip');
    if (chip) {
      const q = chip.dataset.q || '';
      const input = $('chat-input');
      if (input) {
        input.value = q;
        syncSendButton();
      }
      if (!getGeminiKey()) {
        openChatSettings();
        showToast('配置 Key 后即可对话，或复制提示去外部 AI');
      } else {
        sendChatMessage();
      }
      return;
    }

    // 「带着卦象去解卦」 跳转
    const jump = e.target.closest('[data-scroll]');
    if (jump) {
      const target = $(jump.dataset.scroll);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (jump.dataset.scroll === 'chat-panel') {
          if (!getGeminiKey()) {
            openChatSettings();
          } else {
            const input = $('chat-input');
            if (input) setTimeout(() => input.focus({ preventScroll: true }), 320);
          }
        }
      }
    }
  });

  // 发送表单（回车 / 点击发送钮）
  document.addEventListener('submit', (e) => {
    if (e.target && e.target.id === 'chat-composer') {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // Enter 发送，Shift + Enter 换行；兼容中文输入法
  document.addEventListener('keydown', (e) => {
    if (!e.target || e.target.id !== 'chat-input') return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // 输入框随内容自动长高，并同步发送键状态
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'chat-input') {
      autoGrow(e.target);
      syncSendButton();
    }
  });

  // Force refresh
  $('btn-refresh').addEventListener('click', forceRefresh);
}

// ── 11. Init ──────────────────────────────────────────
async function init() {
  await loadData();
  renderDomainHexagram();
  $('btn-start').disabled = false;
  $('btn-start').textContent = '起卦';
  setupEvents();

  // Online status for refresh button
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  // 开发快捷入口（只在 localhost 或 ?dev=1 时生效，生产环境不可见）
  if (DEV_MODE) {
    renderDevBar();
    const urlCast = devCastFromUrl();
    if (urlCast) applyCast(urlCast);
  }

  // Version badge (bottom-right corner)
  initVersionBadge();
}

// ── 12. Version badge ────────────────────────────────
// Reads version.json (generated at deploy time) and shows
// the version in the bottom-right corner. Hidden when no
// version.json exists (e.g. local dev).
async function initVersionBadge() {
  const el = $('version-badge');
  if (!el) return;
  try {
    const res = await fetch('version.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const v = await res.json();
    el.textContent = `v${v.version} · ${v.commit}`;
    el.title = [
      `周易起卦 v${v.version}`,
      `Git: ${v.describe}`,
      v.branch ? `分支: ${v.branch}` : null,
      `构建时间: ${v.buildTime}`,
    ].filter(Boolean).join('\n');
  } catch {
    el.style.display = 'none';
  }
}

init();

$('btn-start').disabled = true;
$('btn-start').textContent = '加载中…';
