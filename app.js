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
import { createSessionStore, localStorageAdapter } from './session.js';
import { mountChatPanel } from './chat-panel.js';
import { mountHistoryPanel } from './history-panel.js';
import { showToast } from './ui-kit.js';
import { requestGemini } from './gemini.js';
import { buildReading } from './service.js';
import { initVersionBadge } from './version-badge.js';

// 会话记录、卦历、交流有效期与两个面板都在各自模块里。
// app.js 只负责起卦流程、结果页编排与把模块接起来。
const sessionStore = createSessionStore(localStorageAdapter(localStorage));

/** @type {ReturnType<typeof mountChatPanel> | null} 当前结果页上的解卦面板 */
let chatPanel = null;
/** @type {ReturnType<typeof mountHistoryPanel> | null} 卦历，一次挂载、长期存在 */
let historyPanel = null;

// 本机对话的传输层在 gemini.js；这里只负责把它接到面板上。
const geminiPort = {
  get available() {
    return state.geminiAvailable;
  },
  /** @param {import('./gemini.js').GeminiRequest} request */
  request: (request) => requestGemini(request),
};

// ── 1. Data ───────────────────────────────────────────
let DATA = null;
let CANONICAL = null;

async function loadData() {
  const [ichingRes, canonicalRes] = await Promise.all([
    fetch('data/iching.json'),
    fetch('data/canonical.json'),
  ]);
  DATA = await ichingRes.json();
  CANONICAL = await canonicalRes.json();
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
  serviceReading: null,
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
  // 检测完成后面板下一次渲染会读到新的 available（解卦面板每秒刷新）
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
  // 服务层的三层读卦：UI 只做展示，不重新解释卦象。
  const serviceReading = buildReading(numbers, {
    table: DATA,
    canonicalData: CANONICAL,
  });

  // Store hexagram data in state for prompt generation
  state.throws = numbers.map((n) => ({ num: n, ...LINE_INFO[n] }));
  state.primary = reading.primary;
  state.transformed = reading.transformed;
  state.movingLines = reading.movingLines;
  state.numbers = numbers;
  state.primaryLineTypes = reading.primaryLineTypes;
  state.transformedLineTypes = reading.transformedLineTypes;
  state.serviceReading = serviceReading;

  // 每次起卦都落成本地会话记录；回看旧记录时沿用原记录
  const session = existing || sessionStore.create(numbers, reading, {
    persist: !options.ephemeral,
  });

  // 旧的解卦面板先拆掉（清 ticker 与监听），再清空结果容器
  if (chatPanel) {
    chatPanel.destroy();
    chatPanel = null;
  }

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

  // ── 服务数据（试用 / 演示）：象数骨架、原典、客观象意 ──
  container.appendChild(renderServiceDetails(serviceReading));

  // ── AI 解卦：应用内对话（自带 Key）+ 复制提示到外部 AI，同一个面板 ──
  chatPanel = mountChatPanel({
    container,
    session,
    reading,
    store: sessionStore,
    brief: interpretationBrief(reading),
    gemini: geminiPort,
  });

  // 卦历里的记录可能刚变过（新起卦）
  if (historyPanel && historyPanel.isOpen()) historyPanel.refresh();

  showPhase('phase-result');
  state.phase = 'result';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * 解卦面板的「卦象措辞」接缝：解卦提示 + 对话系统提示。
 * 候选 #4 会替换这里的实现，面板接口不变。
 * @param {import('./hexagram.js').Reading} reading
 */
function interpretationBrief(reading) {
  // buildPromptText 目前读 state 上的卦象字段；起卦结果刚写进 state。
  void reading;
  return {
    fullPrompt: (question) => buildPromptText(question),
    systemPrompt: () => buildChatSystemPrompt(),
  };
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

/**
 * 试用 / 演示 UI：把服务层三层数据摊开给人看。
 * 这里只陈列，不做个人化推演。
 * @param {{ skeleton: any, text: any, imagery: any }} service
 */
function renderServiceDetails(service) {
  const { skeleton, text, imagery } = service;
  const primaryText = text.primary;
  const primaryImage = imagery.primary;
  const upper = primaryImage.trigrams.upper;
  const lower = primaryImage.trigrams.lower;
  const rule = skeleton.rule;

  const targets = rule.targets
    .map((target) => {
      if (target.kind === 'judgment') {
        return target.hexagram === 'primary' ? '本卦卦辞' : '变卦卦辞';
      }
      if (target.kind === 'special') return target.position;
      const where = target.hexagram === 'primary' ? '本卦' : '变卦';
      const role =
        target.role === 'main' ? '（主）' : target.role === 'secondary' ? '（次）' : '';
      return `${where}${target.position}${role}`;
    })
    .join('、');

  const relationItems = primaryImage.lines
    .map((line) => {
      const tokens = [
        line.position,
        line.correct ? '当位' : '失位',
        line.center ? '得中' : null,
        `${line.response.label}${line.response.mutual ? `（${line.response.position}）` : ''}`,
      ].filter(Boolean);
      if (line.over && line.over.relation !== '同类') {
        tokens.push(`下：${line.over.position} ${line.over.relation}`);
      }
      if (line.under && line.under.relation !== '同类') {
        tokens.push(`上：${line.under.position} ${line.under.relation}`);
      }
      return `<li>${tokens.join(' · ')}</li>`;
    })
    .join('');

  const details = document.createElement('details');
  details.className = 'result-section service-details';
  details.innerHTML = `
    <summary>服务数据：象数 / 原典 / 象意</summary>
    <div class="service-body">
      <div class="service-row"><span class="service-key">互卦</span><span>${skeleton.nuclear.symbol} ${skeleton.nuclear.name}（第${skeleton.nuclear.id}卦）</span></div>
      <div class="service-row"><span class="service-key">变爻规则</span><span>${rule.title} · ${rule.method}${targets ? ` 取象：${targets}` : ''}</span></div>
      <div class="service-block">
        <h3>彖传</h3>
        <p>${primaryText.tuan}</p>
      </div>
      <div class="service-block">
        <h3>大象</h3>
        <p>${primaryText.image.great}</p>
      </div>
      <div class="service-block">
        <h3>象意</h3>
        <p>${primaryImage.formation} · ${primaryImage.naturalImage}；上卦 ${upper.name}（${upper.nature}/${upper.attribute}），下卦 ${lower.name}（${lower.nature}/${lower.attribute}）</p>
        <p class="service-keywords">${primaryImage.keywords.join(' · ')}</p>
      </div>
      <div class="service-block">
        <h3>爻位关系</h3>
        <ul class="service-relations">${relationItems}</ul>
      </div>
    </div>
  `;
  return details;
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

  // ── 互卦、变爻规则、原典、象意（服务层） ──
  const service = state.serviceReading;
  if (service) {
    const { skeleton, text, imagery } = service;
    prompt += `
## 互卦：${skeleton.nuclear.symbol} ${skeleton.nuclear.name}（第${skeleton.nuclear.id}卦）
`;
    prompt += `
### 变爻取象规则（${skeleton.rule.school}）
${skeleton.rule.title}：${skeleton.rule.method}
`;
    prompt += `
### 彖传（本卦）
${text.primary.tuan}
`;
    prompt += `
### 大象（本卦）
${text.primary.image.great}
`;
    prompt += `
### 客观象意（本卦）
`;
    prompt += `上卦：${imagery.primary.trigrams.upper.name}（${imagery.primary.trigrams.upper.nature}/${imagery.primary.trigrams.upper.attribute}）
`;
    prompt += `下卦：${imagery.primary.trigrams.lower.name}（${imagery.primary.trigrams.lower.nature}/${imagery.primary.trigrams.lower.attribute}）
`;
    prompt += `自然取象：${imagery.primary.naturalImage}；关键词：${imagery.primary.keywords.join('、')}
`;
    prompt += `
### 爻位关系（本卦）
`;
    for (const line of imagery.primary.lines) {
      const bits = [
        line.position,
        line.correct ? '当位' : '失位',
        line.center ? '得中' : null,
        line.response.label,
      ].filter(Boolean);
      prompt += `- ${bits.join(' · ')}
`;
    }
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

// 本机对话的系统提示词：复用解卦提示的卦象资料，省略一次性解卦指令
function buildChatSystemPrompt() {
  return `你是一位精通《周易》的占卜解卦师。以下是用户本次起卦的完整资料：

${buildPromptText('（用户会在对话中提出具体问题）', { instructions: false })}
---

请依据以上资料与用户多轮对话：回答追问时简洁、具体、有针对性，不要重复粘贴整段卦象原文。`;
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

// ── 11. Event handlers ────────────────────────────────
// 面板内部的事件绑定在各自模块里（delegated on their own root）。
// 这里只剩全局的几条：起卦按钮、变卦爻辞 toggle、卦历开关、刷新。
function setupEvents() {
  $('btn-start').addEventListener('click', startDivination);
  $('btn-throw').addEventListener('click', doThrow);
  $('btn-reset').addEventListener('click', startDivination);
  $('btn-history').addEventListener('click', () => historyPanel && historyPanel.open());
  $('btn-refresh').addEventListener('click', forceRefresh);

  // Toggle: 变卦全部爻辞的展开 / 收起
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const toggleBtn = target.closest('#toggle-lines-btn');
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

  // 卦历一次挂载、长期存在；会话选择仍由这里决定
  historyPanel = mountHistoryPanel({
    store: sessionStore,
    hexagramById: (id) => hexagramById(id, DATA),
    onOpenSession: (id) => openSessionById(id),
  });

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
  initVersionBadge(undefined, '周易起卦');
}

// 打开卦历里的一条记录：记录不在了就只提示，并重画列表
function openSessionById(id) {
  const session = sessionStore.get(id);
  if (!session) {
    showToast('这条记录已不在本机');
    if (historyPanel) historyPanel.refresh();
    return;
  }
  showResult({ session });
}

// 版本徽标在 version-badge.js（首页与演示页共用）。

init();

$('btn-start').disabled = true;
$('btn-start').textContent = '加载中…';
