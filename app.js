/* ======================================================
   周易起卦 — app.js
   ====================================================== */

import {
  LINE_INFO,
  deriveReading,
  hexagramById,
  hexagramFor,
  posLabel,
  trigramInfo,
} from './hexagram.js';

// ── 1. Data ───────────────────────────────────────────
let DATA = null;

async function loadData() {
  const res = await fetch('data/iching.json');
  DATA = await res.json();
}

// ── 2. DOM shortcuts ──────────────────────────────────
const $ = (id) => document.getElementById(id);

// 卦象常量、查卦与 deriveReading 在 hexagram.js。

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
  // 当前这次起卦的本地记录（会话）
  session: null,
  feedbackOpen: false,
  // 用户主动点「更换 / 清除」时展开设置行；否则每秒刷新的有效期检查会把它又收起
  keyEditing: false,
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
// options.session：回看一条本地记录；不传则新建一次起卦记录
function showResult(options = {}) {
  const existing = options.session || null;
  const numbers = existing ? existing.numbers.slice() : state.throws.map((t) => t.num);
  const reading = deriveReading(numbers, DATA);

  // Store hexagram data in state for prompt generation
  state.throws = numbers.map((n) => ({ num: n, ...LINE_INFO[n] }));
  state.primary = reading.primary;
  state.transformed = reading.transformed;
  state.movingLines = reading.movingLines;
  state.numbers = numbers;
  state.primaryLineTypes = reading.primaryLineTypes;
  state.transformedLineTypes = reading.transformedLineTypes;

  // 每次起卦都落成本地会话记录；回看旧记录时沿用原记录
  const session = existing || createSession(numbers, reading, !options.ephemeral);
  state.session = session;
  state.feedbackOpen = false;
  state.keyEditing = false;

  // 新结果从会话恢复对话
  resetChat();
  chatState.previousInteractionId = session.previousInteractionId || '';
  chatState.transport = session.transport || 'interactions';

  // Build result HTML
  const container = $('result-content');
  container.innerHTML = '';
  const movingIndices = reading.movingLines.map((m) => m.index);

  // ── 本卦 ──
  container.appendChild(renderHexagramSection(reading.primary, '本卦', reading.primaryLineTypes, movingIndices));
  // 本卦爻辞：六爻爻辞全部显示，动爻高亮标出
  container.appendChild(renderYaoCiSection(reading.primary, reading.primaryLineTypes, movingIndices));

  if (reading.movingLines.length > 0) {
    // ── 动爻 ──
    container.appendChild(renderDivider());
    container.appendChild(renderMovingLinesSection(reading.movingLines, reading.primaryLineTypes, numbers, reading.transformed, reading.transformedLineTypes));

    // 箭头
    container.appendChild(renderArrow());

    // ── 变卦 ──
    container.appendChild(renderHexagramSection(reading.transformed, '变卦', reading.transformedLineTypes, []));

    // ── 变卦爻辞：默认收起，可展开全部 ──
    container.appendChild(renderToggle());
    const allLinesEl = renderAllLinesSection(reading.transformed, reading.transformedLineTypes);
    allLinesEl.id = 'all-lines-section';
    allLinesEl.style.display = 'none';
    container.appendChild(allLinesEl);
  } else {
    container.appendChild(renderNoChangeNote());
  }

  // ── AI 解卦：应用内对话（自带 Key）+ 复制提示到外部 AI，同一个面板 ──
  container.appendChild(renderChatSection());

  // 新结果：收起上一次的复制提示 toast
  const oldToast = $('chat-toast');
  if (oldToast) oldToast.classList.remove('show');

  showPhase('phase-result');
  state.phase = 'result';
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

function renderYaoCiSection(hexagram, lineTypes, movingIndices) {
  const section = document.createElement('div');
  section.className = 'result-section';
  section.innerHTML = '<h2>📜 本卦爻辞</h2>';

  const list = document.createElement('div');
  list.className = 'lines-section';

  for (let i = 0; i < 6; i++) {
    const isYang = lineTypes[i] === 'yang';
    const symbol = isYang ? '⚊' : '⚋';
    const pos = posLabel(i, isYang);
    const text = hexagram.lines[i].text;
    const isMoving = movingIndices.includes(i);
    const item = document.createElement('div');
    item.className = 'line-item' + (isMoving ? ' moving' : '');
    item.innerHTML = `
      <span class="line-symbol">${symbol}</span>
      <span class="line-position">${pos}</span>
      <span class="line-text">${text}</span>
      ${isMoving ? '<span class="moving-badge">⚡ 动</span>' : ''}
    `;
    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

function renderMovingLinesSection(movingLines, lineTypes, numbers, transformed, transformedLineTypes) {
  const section = document.createElement('div');
  section.className = 'result-section';
  section.innerHTML = '<h2>⚡ 动爻</h2>';

  const list = document.createElement('div');
  list.className = 'lines-section';

  movingLines.forEach((ml) => {
    const idx = ml.index;
    const num = numbers[idx];
    const isYang = lineTypes[idx] === 'yang';
    const symbol = isYang ? '⚊' : '⚋';
    const change = num === 6 ? '老阴 ⚋→⚊' : '老阳 ⚊→⚋';

    // 变卦中对应的爻
    const tIsYang = transformedLineTypes[idx] === 'yang';
    const tSymbol = tIsYang ? '⚊' : '⚋';
    const tPos = posLabel(idx, tIsYang);
    const tText = transformed.lines[idx].text;

    const item = document.createElement('div');
    item.className = 'line-item moving';
    item.innerHTML = `
      <span class="line-symbol">${symbol}</span>
      <span class="line-position">${ml.position}</span>
      <span class="line-text">${ml.text}</span>
      <span class="line-change">${change}</span>
      <span class="line-arrow">→</span>
      <span class="line-symbol">${tSymbol}</span>
      <span class="line-position">${tPos}</span>
      <span class="line-text">${tText}</span>
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
    <span style="font-size:0.75rem;color:var(--text-secondary)">变卦爻辞</span>
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
function updateShareButtonUI() {
  const btn = document.getElementById('btn-share-ai');
  if (!btn) return; // 还未渲染，跳过

  btn.textContent = state.geminiAvailable ? '🚀 在 Gemini 中打开' : '📋 复制到豆包';
}

// 解卦提示与对话共用同一个输入框：先看当前输入，再退回最后一条提问
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

// 有效期截止后，所有“继续解卦”的入口都走这里拦下
function blockedByExpiry() {
  if (!isSessionExpired(state.session)) return false;
  updateChatValidityUI();
  showToast('本次交流已截止，只能记录反馈');
  return true;
}

// 外部 AI 提示：对话面板里的次要出口（没 Key / 想换模型时用）
function promptOutputHtml() {
  return `
    <div id="prompt-output" class="prompt-output" hidden>
      <div class="prompt-head">
        <span class="prompt-label">📋 解卦提示（复制到外部 AI）</span>
      </div>
      <pre id="prompt-text" class="prompt-text"></pre>
      <div class="prompt-actions">
        <button id="btn-copy-prompt" class="btn-secondary prompt-btn" type="button">📋 复制</button>
        <button id="btn-share-ai" class="btn-primary prompt-btn" type="button">🚀 在 Gemini 中打开</button>
      </div>
      <span id="copy-feedback" class="copy-feedback"></span>
    </div>
  `;
}

function updatePromptToggleUI() {
  const out = $('prompt-output');
  const btn = $('btn-toggle-prompt');
  if (!btn) return;
  const open = !!out && !out.hidden;
  btn.textContent = open ? '收起解卦提示' : '📋 生成解卦提示';
  btn.classList.toggle('active', open);
}

function buildPromptText(questionRaw, options = {}) {
  const question = (questionRaw || '').trim() || '（未提供具体问题，请从卦象角度进行一般性解读）';
  const p = state.primary;
  const t = state.transformed;
  const mls = state.movingLines;
  const nums = state.numbers;
  const lineTypes = state.primaryLineTypes;

  const pTri = trigramInfo(p.binary, DATA);

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
    const tTri = trigramInfo(t.binary, DATA);
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
  if (blockedByExpiry()) return '';
  const out = $('prompt-output');
  const pre = $('prompt-text');
  if (!out || !pre) return '';
  const text = buildPromptText(currentQuestion());
  pre.textContent = text;
  out.hidden = false;
  const feedback = $('copy-feedback');
  if (feedback) feedback.textContent = '';
  updatePromptToggleUI();
  return text;
}

// 同一个入口：没展开就生成，已展开就收起
function togglePromptOutput() {
  const out = $('prompt-output');
  if (!out) return;
  if (out.hidden) {
    generatePrompt();
  } else {
    out.hidden = true;
    updatePromptToggleUI();
  }
}

async function copyPrompt() {
  if (blockedByExpiry()) return;
  const text = $('prompt-text').textContent;
  if (!text) return;
  await copyText(text);
  const feedback = $('copy-feedback');
  if (feedback) {
    feedback.textContent = '✅ 已复制！';
    setTimeout(() => { feedback.textContent = ''; }, 2000);
  }
}

async function shareToGemini() {
  if (blockedByExpiry()) return;
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

// 占卦为一时之像：每次起卦只保留一段固定的解卦交流窗口。
// 窗口结束后只能补记「反馈」，不再继续解卦问答，也不再发送到模型。
const CHAT_VALID_MS = 24 * 60 * 60 * 1000; // 24 小时
const SESSIONS_KEY = 'iching_sessions_v1';
const SESSION_MAX = 100;

const chatState = {
  history: [],        // [{ role: 'user' | 'model', text }]，回退到 generateContent 时重放
  system: '',
  busy: false,
  transport: 'interactions', // 记住当前可用的传输层
  previousInteractionId: '',  // Interactions API 的会话句柄
};

// ── 10.6.1 本地会话记录 ─────────────────────────────
// 每条记录 = 一次起卦 + 该次解卦对话 + 反馈。全部存 localStorage，
// 不上传服务器（对话内容除外：调用 Gemini 时本就会发出）。
function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((s) =>
      s && typeof s.id === 'string' &&
      Number.isFinite(s.createdAt) &&
      Array.isArray(s.numbers) && s.numbers.length === 6 &&
      s.numbers.every((n) => n >= 6 && n <= 9) &&
      Array.isArray(s.messages)
    );
  } catch {
    return [];
  }
}

function writeSessions(list) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(list));
  } catch {
    // 隐私模式 / 配额满：记录功能静默降级，不影响起卦
  }
}

function saveSession(session) {
  if (!session || !session.id) return;
  const list = loadSessions();
  const idx = list.findIndex((s) => s.id === session.id);
  if (idx >= 0) list[idx] = session;
  else list.push(session);
  list.sort((a, b) => b.createdAt - a.createdAt);
  writeSessions(list.slice(0, SESSION_MAX));
}

function createSession(numbers, reading, persist = true) {
  const createdAt = Date.now();
  const session = {
    id: `s_${createdAt.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt,
    expiresAt: createdAt + CHAT_VALID_MS,
    numbers: numbers.slice(),
    primaryId: reading.primary.id,
    transformedId: reading.transformed.id,
    movingIndices: reading.movingLines.map((m) => m.index),
    messages: [],
    previousInteractionId: '',
    transport: 'interactions',
  };
  if (persist) saveSession(session);
  else session.ephemeral = true;
  return session;
}

function getSessionById(id) {
  return loadSessions().find((s) => s.id === id) || null;
}

function isSessionExpired(session) {
  return !!session && Date.now() >= (session.expiresAt || 0);
}

function formatClock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${formatClock(ts)}`;
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 小时 ${String(m).padStart(2, '0')} 分`;
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`;
}

// 把一条消息追加进当前本地记录（intro / 问答 / 反馈）
function persistMessage(role, text, kind) {
  const session = state.session;
  if (!session || session.ephemeral) return;
  session.messages.push({ role, text, at: Date.now(), ...(kind ? { kind } : {}) });
  saveSession(session);
}


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
  chatState.transport = 'interactions';
}

// 从本地记录恢复对话气泡（不再重新写入 localStorage）
function restoreChatLog() {
  const log = $('chat-log');
  if (!log) return;

  const session = state.session;
  log.innerHTML = '';
  chatState.history = [];

  const messages = (session && session.messages) || [];
  if (!messages.length) {
    renderChatIntro();
    return;
  }

  for (const m of messages) {
    appendChatMessage(m.role, m.text, { persist: false, kind: m.kind });
    // intro 只是开场摘要，不属于 API 上下文
    if (!m.kind && (m.role === 'user' || m.role === 'model')) {
      chatState.history.push({ role: m.role, text: m.text });
    }
  }

  const wrap = $('chat-chips');
  if (wrap) {
    const hasTalked = chatState.history.some((m) => m.role === 'user');
    if (hasTalked || isSessionExpired(session)) {
      wrap.style.display = 'none';
    } else {
      wrap.style.display = '';
      wrap.innerHTML = buildQuickChips()
        .map((q) => `<button type="button" class="chat-chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
        .join('');
    }
  }

  updateChatValidityUI();
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
  const section = document.createElement('div');
  section.className = 'result-section chat-section';
  section.id = 'chat-panel';
  section.innerHTML = `
    <h2>🤖 AI 解卦</h2>
    <p class="chat-desc">用自己的 Gemini API Key 在这里多轮追问；不想配 Key 时，也可一键生成解卦提示，复制到任意 AI 助手。Key 仅保存在本机浏览器，不会上传到任何服务器。可在 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> 免费获取。</p>

    <div id="chat-validity" class="chat-validity"></div>

    <div id="chat-expired" class="chat-expired" hidden>
      <div class="ce-title">解卦交流已截止</div>
      <p class="ce-text">占卦为一时之像，本次卦象的解读到 <span id="chat-expired-at"></span> 为止。此后只能记录反馈，不再解卦。</p>
    </div>

    <div id="chat-key-row" class="chat-settings">
      <label class="chat-field">
        <span class="chat-field-label">API Key</span>
        <input id="gemini-key" type="password" class="prompt-input" placeholder="粘贴 Gemini API Key（留空则保留已存 Key）" autocomplete="off" spellcheck="false">
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

    <p id="chat-key-status" class="chat-status"></p>
    <div id="chat-log" class="chat-log"></div>
    <div id="chat-chips" class="chat-chips"></div>
    <div id="chat-composer" class="chat-composer">
      <textarea id="chat-input" rows="1" placeholder="请解读本次卦象，或追问你想知道的…" enterkeyhint="send"></textarea>
      <button id="btn-chat-send" class="chat-send" type="button" aria-label="发送">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>

    <div id="chat-foot" class="chat-foot-row">
      <button id="btn-toggle-prompt" class="chat-foot-link" type="button">📋 生成解卦提示</button>
      <button id="btn-add-feedback" class="chat-foot-link" type="button">记录反馈</button>
    </div>

    ${promptOutputHtml()}

    <div id="chat-feedback" class="chat-feedback" hidden>
      <div class="feedback-head">
        <span class="feedback-title">反馈</span>
        <span class="feedback-sub">只存档，不再解卦</span>
      </div>
      <textarea id="feedback-input" class="prompt-input feedback-input" rows="2" placeholder="事情后来如何？记下来，日后回看…" enterkeyhint="done"></textarea>
      <div class="feedback-actions">
        <button id="btn-feedback-save" class="btn-secondary chat-mini-btn" type="button">记录反馈</button>
      </div>
    </div>
  `;
  setTimeout(() => {
    updateChatKeyUI();
    restoreChatLog();
    updateChatValidityUI();
    updateShareButtonUI();
    updatePromptToggleUI();
  }, 0);
  return section;
}

function updateChatKeyUI() {
  const row = $('chat-key-row');
  if (!row) return;

  const modelInput = $('gemini-model');
  // 每次重建都回填当前设置（不渲染 Key 本身）
  if (modelInput && !modelInput.matches(':focus')) modelInput.value = getGeminiModel();

  const status = $('chat-key-status');
  const key = getGeminiKey();

  if (isSessionExpired(state.session)) {
    row.style.display = 'none';
    if (status) status.textContent = '';
    return;
  }

  if (key) {
    row.style.display = state.keyEditing ? 'flex' : 'none';
    if (status) {
      status.innerHTML =
        `🔑 已保存本机 Key（…${escapeHtml(key.slice(-4))}） · 模型 ${escapeHtml(getGeminiModel())} ` +
        `<button id="btn-change-key" class="chat-link">更换 / 清除</button>`;
    }
  } else {
    row.style.display = 'flex';
    if (status) status.textContent = '尚未保存 Key：应用内对话不可用，可点「生成解卦提示」复制到外部 AI。';
  }
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
  state.keyEditing = false;

  // Key / 模型变更后只重置服务端会话句柄，本地记录与对话保留
  chatState.previousInteractionId = '';
  chatState.transport = 'interactions';
  if (state.session && !state.session.ephemeral) {
    state.session.previousInteractionId = '';
    state.session.transport = 'interactions';
    saveSession(state.session);
  }
  updateChatKeyUI();
  restoreChatLog();
  showToast('Gemini 设置已保存');
}

function clearGeminiKey() {
  setGeminiKey('');
  const keyInput = $('gemini-key');
  if (keyInput) keyInput.value = '';
  state.keyEditing = false;
  chatState.previousInteractionId = '';
  chatState.transport = 'interactions';
  if (state.session && !state.session.ephemeral) {
    state.session.previousInteractionId = '';
    state.session.transport = 'interactions';
    saveSession(state.session);
  }
  updateChatKeyUI();
  restoreChatLog();
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
  if (state.session) {
    text += `\n\n解卦交流 ${Math.round(CHAT_VALID_MS / 3600000)} 小时内有效，至 ${formatDateTime(state.session.expiresAt)}。`;
  }
  text += '\n\n想从哪里聊起？可以直接问我。';
  appendChatMessage('model', text, { persist: true, kind: 'intro' });

  const wrap = $('chat-chips');
  if (wrap) {
    if (isSessionExpired(state.session)) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    wrap.innerHTML = buildQuickChips()
      .map((q) => `<button type="button" class="chat-chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
      .join('');
  }
}

function appendChatMessage(role, text, options = {}) {
  const log = $('chat-log');
  if (!log) return null;
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;

  if (role === 'feedback') {
    el.innerHTML = `<span class="feedback-tag">反馈</span>${formatChatText(text)}`;
  } else {
    el.innerHTML = formatChatText(text);
  }

  log.appendChild(el);
  log.scrollTop = log.scrollHeight;

  // 只在真正产生内容时落盘；重建历史时传 persist:false
  if (options.persist) persistMessage(role, text, options.kind);
  return el;
}

function appendTyping() {
  const el = appendChatMessage('pending', '');
  if (el) el.innerHTML = '<span class="typing-dots" aria-label="解卦中"><i></i><i></i><i></i></span>';
  return el;
}

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// 有效期状态：剩余时间、截止后的锁屏与反馈入口
function updateChatValidityUI() {
  const session = state.session;
  if (!session || !$('chat-panel')) return;

  const expired = isSessionExpired(session);

  const strip = $('chat-validity');
  if (strip) {
    strip.classList.toggle('is-expired', expired);
    strip.innerHTML = expired
      ? `<span class="validity-dot"></span>本次解卦交流已于 ${escapeHtml(formatDateTime(session.expiresAt))} 截止`
      : `<span class="validity-dot"></span>解卦交流有效期 · 剩余 ${escapeHtml(formatRemaining(session.expiresAt - Date.now()))}（至 ${escapeHtml(formatDateTime(session.expiresAt))}）`;
  }

  const notice = $('chat-expired');
  if (notice) notice.hidden = !expired;
  const expiredAt = $('chat-expired-at');
  if (expiredAt) expiredAt.textContent = formatDateTime(session.expiresAt);

  // 截止后：只能记录反馈，问答、提示、外部 AI 入口全部关闭
  const chatInput = $('chat-input');
  if (chatInput) chatInput.hidden = expired;
  const sendBtn = $('btn-chat-send');
  if (sendBtn) {
    sendBtn.hidden = expired;
    sendBtn.disabled = expired || chatState.busy;
  }
  const composer = $('chat-composer');
  if (composer) composer.hidden = expired;

  const foot = $('chat-foot');
  if (foot) foot.hidden = expired;

  const addFeedbackBtn = $('btn-add-feedback');
  if (addFeedbackBtn) {
    addFeedbackBtn.hidden = expired;
    addFeedbackBtn.textContent = state.feedbackOpen ? '收起反馈' : '记录反馈';
  }

  const promptOut = $('prompt-output');
  if (promptOut && expired) {
    promptOut.hidden = true;
    updatePromptToggleUI();
  }

  const feedback = $('chat-feedback');
  if (feedback) feedback.hidden = !(expired || state.feedbackOpen);

  const keyRow = $('chat-key-row');
  if (keyRow && expired) keyRow.style.display = 'none';

  const chips = $('chat-chips');
  if (chips && expired) chips.style.display = 'none';

  updateChatKeyUI();
}

function toggleFeedbackComposer() {
  if (isSessionExpired(state.session)) return;
  state.feedbackOpen = !state.feedbackOpen;
  updateChatValidityUI();
  if (state.feedbackOpen) {
    const input = $('feedback-input');
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 60);
  }
}

function saveFeedback() {
  const session = state.session;
  if (!session) return;
  const input = $('feedback-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  appendChatMessage('feedback', text, { persist: true });
  input.value = '';
  autoGrow(input);
  showToast('反馈已记录在本机');

  // 记录反馈后把面板留在原位，方便继续补记
  if (!isSessionExpired(session)) {
    state.feedbackOpen = true;
    updateChatValidityUI();
  }
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

  // 占卦为一时之像：有效期过后不再解卦，只留反馈
  if (isSessionExpired(state.session)) {
    updateChatValidityUI();
    showToast('本次交流已截止，只能记录反馈');
    return;
  }

  const input = $('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  if (!getGeminiKey()) {
    const keyRow = $('chat-key-row');
    if (keyRow) keyRow.style.display = 'flex';
    appendChatMessage('error', '请先在上方保存你的 Gemini API Key。');
    return;
  }
  if (!navigator.onLine) {
    appendChatMessage('error', '当前处于离线状态，无法调用 Gemini。卦象与解卦提示仍可正常使用。');
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
    btn.classList.add('is-busy');
    btn.setAttribute('aria-label', '解卦中');
  }
  const typing = appendTyping();

  try {
    const reply = await requestGemini(getGeminiKey(), text);
    if (typing) typing.remove();
    appendChatMessage('model', reply.text);
    chatState.history.push({ role: 'model', text: reply.text });
    // Interactions API 的服务端会话句柄
    if (reply.id) chatState.previousInteractionId = reply.id;

    // 成功的一问一答才写入本地记录
    persistMessage('user', text);
    persistMessage('model', reply.text);
    if (state.session && !state.session.ephemeral) {
      if (reply.id) state.session.previousInteractionId = reply.id;
      state.session.transport = chatState.transport;
      saveSession(state.session);
    }
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
      btn.classList.remove('is-busy', 'loading');
      btn.setAttribute('aria-label', '发送');
    }
    autoGrow(input);
    updateChatValidityUI();
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
  // dev 快捷出结果不写入卦历，避免调试记录淹没真实起卦
  showResult({ ephemeral: true });
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
  return hexagramFor(binary, DATA);
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

// ── 12.5 卦历（本地记录浏览器） ──────────────────────
function ensureHistoryPanel() {
  if ($('history-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'history-overlay';
  overlay.className = 'history-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="history-sheet" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div class="history-head">
        <div>
          <div id="history-title" class="history-title">卦历</div>
          <div class="history-sub">本机保存 · 解卦交流 ${Math.round(CHAT_VALID_MS / 3600000)} 小时</div>
        </div>
        <button id="btn-history-close" class="history-close" aria-label="关闭卦历">×</button>
      </div>
      <div id="history-list" class="history-list"></div>
      <div class="history-foot">
        <button id="btn-history-clear" class="chat-text-btn">清空全部记录</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function renderHistoryList() {
  const listEl = $('history-list');
  if (!listEl) return;

  const sessions = loadSessions();
  if (!sessions.length) {
    listEl.innerHTML = '<p class="history-empty">还没有记录。起一卦，解卦对话会自动存在本机。</p>';
    return;
  }

  listEl.innerHTML = sessions.map((session) => {
    const p = hexagramById(session.primaryId, DATA);
    const t = hexagramById(session.transformedId, DATA);
    const moving = (session.movingIndices || []).length;
    const expired = isSessionExpired(session);
    const rounds = (session.messages || []).filter((m) => !m.kind && m.role === 'user').length;
    const feedbacks = (session.messages || []).filter((m) => m.role === 'feedback').length;

    const title = p ? `${p.symbol} ${p.name}` : '未知卦';
    const change = moving > 0 && t
      ? `变 ${t.symbol} ${t.name} · ${moving} 爻动`
      : '六爻皆静';

    const meta = [
      formatDateTime(session.createdAt),
      rounds ? `${rounds} 问` : '未解卦',
      feedbacks ? `${feedbacks} 条反馈` : null,
    ].filter(Boolean).join(' · ');

    return `
      <button type="button" class="history-item" data-session="${escapeHtml(session.id)}">
        <span class="hi-top">
          <span class="hi-gan">${escapeHtml(title)}</span>
          <span class="hi-status ${expired ? 'expired' : 'open'}">${expired ? '已截止' : '交流中'}</span>
        </span>
        <span class="hi-change">${escapeHtml(change)}</span>
        <span class="hi-meta">${escapeHtml(meta)}</span>
      </button>`;
  }).join('');
}

function openHistory() {
  ensureHistoryPanel();
  renderHistoryList();
  const overlay = $('history-overlay');
  if (overlay) overlay.hidden = false;
  document.body.classList.add('history-open');
}

function closeHistory() {
  const overlay = $('history-overlay');
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('history-open');
}

function openSessionById(id) {
  const session = getSessionById(id);
  if (!session) {
    showToast('这条记录已不在本机');
    renderHistoryList();
    return;
  }
  closeHistory();
  showResult({ session });
}

function clearHistory() {
  if (!loadSessions().length) return;
  if (!window.confirm('清空本机所有起卦记录？此操作不可撤销。')) return;
  try {
    localStorage.removeItem(SESSIONS_KEY);
  } catch {
    // 忽略隐私模式下的失败
  }
  renderHistoryList();
  showToast('本机记录已清空');
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
    toggleBtn.textContent = isHidden ? '收起爻辞' : '显示全部爻辞';
    toggleBtn.classList.toggle('active', isHidden);
  });

  // Prompt、分享、chat 设置、快捷回复
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-toggle-prompt')) togglePromptOutput();
    if (e.target.closest('#btn-copy-prompt')) copyPrompt();
    if (e.target.closest('#btn-share-ai')) shareToGemini();

    if (e.target.closest('#btn-save-key')) saveKeyFromInput();
    if (e.target.closest('#btn-clear-key')) clearGeminiKey();
    if (e.target.closest('#btn-change-key')) {
      state.keyEditing = true;
      const row = $('chat-key-row');
      if (row) row.style.display = 'flex';
      const input = $('gemini-key');
      if (input) input.focus();
    }
    if (e.target.closest('#btn-add-feedback')) toggleFeedbackComposer();
    if (e.target.closest('#btn-feedback-save')) saveFeedback();
    if (e.target.closest('#btn-chat-send')) sendChatMessage();

    // 卦历：打开 / 关闭 / 清空 / 回看某条记录
    if (e.target.closest('#btn-history')) openHistory();
    if (e.target.closest('#btn-history-close')) closeHistory();
    if (e.target.closest('#btn-history-clear')) clearHistory();
    if (e.target.id === 'history-overlay') closeHistory();
    const historyItem = e.target.closest('.history-item');
    if (historyItem) {
      openSessionById(historyItem.dataset.session || '');
      return;
    }

    // 快捷回复 chip
    const chip = e.target.closest('.chat-chip');
    if (chip) {
      const q = chip.dataset.q || '';
      const input = $('chat-input');
      if (input) input.value = q;
      if (!getGeminiKey()) {
        const keyRow = $('chat-key-row');
        if (keyRow) keyRow.style.display = 'flex';
        showToast('配置 Key 后即可对话；也可点「生成解卦提示」复制到外部 AI');
      } else {
        sendChatMessage();
      }
      return;
    }
  });

  // Cmd/Ctrl + Enter 发送；保留普通 Enter 作为发送（输入法组合时忽略）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeHistory();
      return;
    }
    // 反馈框：Cmd/Ctrl + Enter 保存（普通 Enter 用于换行）
    if (e.target && e.target.id === 'feedback-input') {
      autoGrow(e.target);
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
        e.preventDefault();
        saveFeedback();
      }
      return;
    }
    if (!e.target || e.target.id !== 'chat-input') return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey) && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // 输入框随内容自动长高
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'chat-input') autoGrow(e.target);
    if (e.target && e.target.id === 'feedback-input') autoGrow(e.target);
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
  ensureHistoryPanel();
  setupEvents();

  // 每秒刷新有效期倒计时；无结果页时函数自身会跳过
  setInterval(updateChatValidityUI, 1000);

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
