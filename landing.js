// @ts-check
/* ======================================================
   服务首页 — landing.js
   ------------------------------------------------------
   只做四件小事：版本徽标、代码块复制、API 在线试用、
   WebMCP 支持状态。起卦本身仍走 /api/v1。
   ====================================================== */

import './webmcp.js';
import { initVersionBadge } from './version-badge.js';

/** @param {string} id @returns {HTMLElement | null} */
const $ = (id) => document.getElementById(id);

initVersionBadge(undefined, '周易象数服务');

// ── 复制代码块 ────────────────────────────────────────
document.addEventListener('click', async (event) => {
  const target = /** @type {HTMLElement | null} */ (
    event.target instanceof Element ? event.target.closest('[data-copy]') : null
  );
  if (!target) return;
  const source = document.getElementById(String(target.dataset.copy));
  if (!source) return;

  const text = source.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    flashCopyButton(target, '已复制');
  } catch {
    // 非安全上下文 / 无剪贴板权限时退回选中文本
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    flashCopyButton(target, '已选中');
  }
});

/** @param {HTMLElement} button @param {string} label */
function flashCopyButton(button, label) {
  if (!button.dataset.label) button.dataset.label = button.textContent || '复制';
  button.textContent = label;
  window.setTimeout(() => {
    if (button.dataset.label) button.textContent = button.dataset.label;
  }, 1400);
}

// ── API 在线试用 ──────────────────────────────────────
const numbersInput = /** @type {HTMLInputElement | null} */ ($('try-numbers'));
const statusEl = $('try-status');
const resultEl = $('try-result');
const summaryEl = $('try-summary');
const outputEl = $('try-output');
const readButton = /** @type {HTMLButtonElement | null} */ ($('try-read'));
const castButton = /** @type {HTMLButtonElement | null} */ ($('try-cast'));

/**
 * 与演示页相同的入参写法：7,8,9,7,6,8 / 7 8 9 7 6 8 / 789678
 * @param {string} value
 * @returns {number[] | null}
 */
function parseNumbers(value) {
  const raw = String(value || '').trim();
  const numbers = /^[6-9]{6}$/.test(raw)
    ? raw.split('').map(Number)
    : raw.split(/[^6-9]+/).filter(Boolean).map(Number);
  if (numbers.length !== 6) return null;
  if (numbers.some((n) => !Number.isInteger(n) || n < 6 || n > 9)) return null;
  return numbers;
}

/** @param {string} message @param {'error' | 'ok' | ''} [tone] */
function setStatus(message, tone = '') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `try-status${tone ? ` is-${tone}` : ''}`;
}

/** @param {boolean} busy */
function setBusy(busy) {
  if (readButton) readButton.disabled = busy;
  if (castButton) castButton.disabled = busy;
  if (numbersInput) numbersInput.disabled = busy;
}

/**
 * @param {'/readings' | '/cast'} path
 * @param {Record<string, unknown>} body
 */
async function requestReading(path, body) {
  setBusy(true);
  setStatus('请求中…');
  try {
    const response = await fetch(`/api/v1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok || !payload || payload.ok !== true) {
      const error = payload && payload.error ? payload.error : {};
      throw new Error(
        `${error.message || `请求失败（HTTP ${response.status}）`}${
          error.code ? ` · ${error.code}` : ''
        }`
      );
    }
    renderReading(payload.data);
    setStatus('');
  } catch (error) {
    if (resultEl) resultEl.hidden = true;
    setStatus(
      `请求失败：${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
  } finally {
    setBusy(false);
  }
}

/** @param {any} data */
function renderReading(data) {
  const skeleton = data.skeleton;
  const moving = skeleton.moving;
  const movingText =
    moving.count > 0
      ? `动爻 ${moving.count}：${moving.positions.join('、')}`
      : '无动爻（静卦）';
  if (summaryEl) {
    summaryEl.textContent =
      `本卦 ${skeleton.primary.symbol} ${skeleton.primary.name}（第 ${skeleton.primary.id} 卦）` +
      ` · 互卦 ${skeleton.nuclear.name}` +
      ` · 变卦 ${skeleton.transformed.name}` +
      ` · ${movingText}`;
  }
  if (outputEl) {
    outputEl.textContent = JSON.stringify(data.skeleton, null, 2);
  }
  if (resultEl) resultEl.hidden = false;
}

if (readButton && numbersInput) {
  readButton.addEventListener('click', () => {
    const numbers = parseNumbers(numbersInput.value);
    if (!numbers) {
      if (resultEl) resultEl.hidden = true;
      setStatus('需要六个 6–9 的整数，例如 6,7,8,9,7,8', 'error');
      numbersInput.focus();
      return;
    }
    requestReading('/readings', { numbers });
  });

  numbersInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') readButton.click();
  });
}

if (castButton) {
  castButton.addEventListener('click', () => {
    requestReading('/cast', {});
  });
}

// ── WebMCP 状态 ───────────────────────────────────────
const mcpStatus = $('webmcp-status');
if (mcpStatus) {
  const supported =
    typeof navigator !== 'undefined' && 'modelContext' in navigator;
  if (supported) {
    mcpStatus.textContent =
      '已注册 4 个工具：zhouyi_cast / zhouyi_read / zhouyi_hexagram / zhouyi_list_hexagrams。当前浏览器支持 WebMCP，可以让页内 agent 直接调用。';
    mcpStatus.classList.add('is-ok');
  } else {
    mcpStatus.textContent =
      '当前浏览器未启用 WebMCP：工具随页面加载注册，但需要支持 navigator.modelContext 的 agent 运行时。API 用法不受影响。';
    mcpStatus.classList.add('is-muted');
  }
}
