// Headless smoke test for candidate #3 (解卦面板 / 卦历 modules).
// Drives Chrome over CDP. Not part of the app; run manually:
//   bun run scripts/smoke-chat-panel.mjs

const CDP = 'http://127.0.0.1:9333';
const APP = 'http://127.0.0.1:8099/';

const targets = await (await fetch(`${CDP}/json/list`)).json();
let page = targets.find((t) => t.type === 'page');
if (!page) {
  await fetch(`${CDP}/json/new?about:blank`);
  page = (await (await fetch(`${CDP}/json/list`)).json()).find((t) => t.type === 'page');
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
/** @type {{method:string,params:any}[]} */
const events = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
};

function send(method, params = {}) {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }));
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      'evaluate failed: ' +
        (res.exceptionDetails.exception?.description || res.exceptionDetails.text)
    );
  }
  return res.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const consoleErrors = [];
const exceptions = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
});

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

// The SW caches app files cache-first, which would silently serve a stale
// chat-panel.js between runs. Disable HTTP cache and drop registrations so
// every run exercises the files on disk.
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: APP });
await sleep(800);
await evaluate('navigator.serviceWorker && navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))').catch(() => {});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── 1. clean start ────────────────────────────────────
await send('Page.navigate', { url: APP });
await sleep(1200);
await evaluate(`localStorage.clear(); sessionStorage.clear();`);
await send('Page.navigate', { url: APP + '?dev=1&cast=7,8,9,7,6,8' });
await sleep(1800);

check('app loaded, result phase active', await evaluate(`document.querySelector('#phase-result').classList.contains('active')`));

// ── 2. one mounted panel, class-based selectors ───────
check('exactly one chat panel', (await evaluate(`document.querySelectorAll('.chat-section').length`)) === 1);
check('panel has no leaked global ids', (await evaluate(`['chat-input','chat-log','btn-chat-send','gemini-key','chat-validity'].filter(id => document.getElementById(id)).length`)) === 0);
check('class selectors present', await evaluate(`!!document.querySelector('.chat-input') && !!document.querySelector('.btn-chat-send') && !!document.querySelector('.chat-log')`));

// ── 3. intro + chips + validity strip ─────────────────
const introBubbles = await evaluate(`document.querySelectorAll('.chat-log .chat-msg.model').length`);
check('one intro bubble rendered', introBubbles === 1, `got ${introBubbles}`);
check('intro names 本卦 and 变卦', await evaluate(`(() => { const t = document.querySelector('.chat-log').textContent; return t.includes('本次得到') && t.includes('动爻在'); })()`));
check('4 quick chips', (await evaluate(`document.querySelectorAll('.chat-chip').length`)) === 4);
check('validity strip shows 剩余', await evaluate(`document.querySelector('.chat-validity').textContent.includes('剩余')`));
check('composer visible', await evaluate(`document.querySelector('.chat-composer').hidden === false`));
check('key row visible (no key saved)', await evaluate(`getComputedStyle(document.querySelector('.chat-settings')).display !== 'none'`));

// ── 4. only one session record, one intro message ─────
const store = await evaluate(`JSON.parse(localStorage.getItem('iching_sessions_v1'))`);
check('dev cast is ephemeral (no 卦历 record)', !store || store.length === 0, `records=${store ? store.length : 0}`);

// ‑- real cast so 卦历 has something -----
await evaluate(`document.querySelector('#btn-reset').click()`);
await sleep(300);
await send('Page.navigate', { url: APP + '?dev=1&cast=6,8,7,9,7,8' });
await sleep(1800);

// ── 5. typing a message without a key ─────────────────
await evaluate(`
  const input = document.querySelector('.chat-input');
  input.value = '测试一问';
  document.querySelector('.btn-chat-send').click();
`);
await sleep(300);
check('no-key send shows error bubble', (await evaluate(`document.querySelectorAll('.chat-log .chat-msg.error').length`)) >= 1);

// ── 6. 解卦提示 block lives in the panel ──────────────
await evaluate(`document.querySelector('.btn-toggle-prompt').click()`);
await sleep(200);
check('prompt output expands inside panel', await evaluate(`(() => { const o = document.querySelector('.prompt-output'); return o && o.hidden === false && o.closest('.chat-section') !== null; })()`));
check('prompt text has 本卦 section', await evaluate(`document.querySelector('.prompt-text').textContent.includes('## 本卦')`));
await evaluate(`document.querySelector('.btn-toggle-prompt').click()`);
await sleep(150);
check('prompt output collapses', await evaluate(`document.querySelector('.prompt-output').hidden === true`));

// ── 7. 卦历 mounts once and opens ─────────────────────
check('history overlay mounted at init', (await evaluate(`document.querySelectorAll('#history-overlay').length`)) === 1);
await evaluate(`document.querySelector('#btn-history').click()`);
await sleep(250);
check('history overlay opens', await evaluate(`document.querySelector('#history-overlay').hidden === false`));
check('body has history-open', await evaluate(`document.body.classList.contains('history-open')`));

// ── 8. Escape closes (listener owned by 卦历) ─────────
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(200);
check('Escape closes 卦历', await evaluate(`document.querySelector('#history-overlay').hidden === true`));

// ── 9. expiry gate past the deadline ──────────────────
// 先造一条真实记录（起卦 + 一条问答），再把 expiresAt 拨到过去
evaluate(`
  const key = 'iching_sessions_v1';
  const now = Date.now();
  const record = {
    id: 's_smoke_1',
    createdAt: now - 1000,
    expiresAt: now + 86400000,
    numbers: [6, 8, 7, 9, 7, 8],
    primaryId: 3,
    transformedId: 5,
    movingIndices: [0, 3],
    messages: [
      { role: 'model', text: '本次得到卦象。', at: now - 900, kind: 'intro' },
      { role: 'user', text: '先问一句', at: now - 800 },
      { role: 'model', text: '先答一句', at: now - 700 },
    ],
    previousInteractionId: '',
    transport: 'interactions',
  };
  localStorage.setItem(key, JSON.stringify([record]));
`);
await sleep(100);
await send('Page.navigate', { url: APP });
await sleep(1200);
// 再把它拨到过去，然后从卦历回看
await evaluate(`
  const key = 'iching_sessions_v1';
  const s = JSON.parse(localStorage.getItem(key));
  localStorage.setItem(key, JSON.stringify(s.map(r => ({...r, expiresAt: Date.now() - 1000}))));
`);
await send('Page.navigate', { url: APP });
await sleep(1200);
await evaluate(`document.querySelector('#btn-history').click()`);
await sleep(300);
await evaluate(`document.querySelector('.history-item').click()`);
await sleep(1200);

check('expired: composer hidden', await evaluate(`document.querySelector('.chat-composer').hidden === true`));
check('expired: chips hidden', await evaluate(`getComputedStyle(document.querySelector('.chat-chips')).display === 'none'`));
check('expired: foot hidden', await evaluate(`document.querySelector('.chat-foot-row').hidden === true`));
check('expired: notice shown', await evaluate(`document.querySelector('.chat-expired').hidden === false`));
check('expired: strip says 截止', await evaluate(`document.querySelector('.chat-validity').textContent.includes('截止')`));
check('expired: prompt stays closed', await evaluate(`document.querySelector('.prompt-output').hidden === true`));
check('expired: feedback box visible', await evaluate(`document.querySelector('.chat-feedback').hidden === false`));
check('expired: key status blank', await evaluate(`document.querySelector('.chat-status').textContent.trim() === ''`));

// ── 10. reopen a session tears down the old panel ─────
const beforePanels = await evaluate(`document.querySelectorAll('.chat-section').length`);
await evaluate(`document.querySelector('#btn-history').click()`);
await sleep(300);
const itemCount = await evaluate(`document.querySelectorAll('.history-item').length`);
check('卦历 lists the record', itemCount >= 1, `items=${itemCount}`);
await evaluate(`document.querySelector('.history-item').click()`);
await sleep(1200);
check('still exactly one chat panel after reopen', (await evaluate(`document.querySelectorAll('.chat-section').length`)) === 1, `before=${beforePanels}`);
check('no duplicate chat logs', (await evaluate(`document.querySelectorAll('.chat-log').length`)) === 1);
check('one chat log after reopen', (await evaluate(`document.querySelectorAll('.chat-log').length`)) === 1);
// 这条记录是播种的真实问答，不是空会话，所以不应该再生成 intro
check('reopen replays the stored 3 bubbles', (await evaluate(`document.querySelectorAll('.chat-log .chat-msg').length`)) === 3, `got ${await evaluate(`document.querySelectorAll('.chat-log .chat-msg').length`)}`);

// ── 11. feedback can still be recorded ────────────────
const fbBefore = await evaluate(`JSON.parse(localStorage.getItem('iching_sessions_v1'))[0].messages.filter(m => m.role === 'feedback').length`);
await evaluate(`
  const ta = document.querySelector('.feedback-input');
  ta.value = '三天后事情办成了';
  document.querySelector('.btn-feedback-save').click();
`);
await sleep(300);
const fbAfter = await evaluate(`JSON.parse(localStorage.getItem('iching_sessions_v1'))[0].messages.filter(m => m.role === 'feedback').length`);
check('feedback persists after expiry', fbAfter === fbBefore + 1, `${fbBefore} → ${fbAfter}`);

// ── 12. 清空全部记录 ──────────────────────────────────
await evaluate(`window.confirm = () => true`);
await evaluate(`document.querySelector('#btn-history').click()`);
await sleep(250);
await evaluate(`document.querySelector('.btn-history-clear').click()`);
await sleep(250);
check('clear empties storage', await evaluate(`localStorage.getItem('iching_sessions_v1') === null`));
check('empty state shown', await evaluate(`document.querySelector('.history-empty') !== null`));

// ── 13. back to casting: panel torn down, no ticking ──
// 起卦时不销毁面板（它在隐藏的 result 相里），但从卦历重开时必须只留一份；
// 这里验证「重新起卦」不会留下第二个监听器 / ticker：面板依然只有一个。
await evaluate(`document.querySelector('#btn-reset').click()`);
await sleep(400);
check('重新起卦 keeps exactly one panel', (await evaluate(`document.querySelectorAll('.chat-section').length`)) === 1);
check('casting phase active', await evaluate(`document.querySelector('#phase-casting').classList.contains('active')`));
const before = await evaluate(`document.querySelectorAll('*').length`);
await sleep(2500);
const afterTicks = await evaluate(`document.querySelectorAll('*').length`);
check('ticker causes no DOM churn (hidden panel)', before === afterTicks, `${before} → ${afterTicks}`);

// ── 13b. key + send round-trip (stubbed transport) ────
await evaluate(`localStorage.setItem('gemini_api_key', 'AIza-smoke-1234')`);
await send('Page.navigate', { url: APP + '?dev=1&cast=7,8,9,7,6,8' });
await sleep(1600);
await evaluate(`
  window.__calls = [];
  window.fetch = async (url, init) => {
    window.__calls.push({ url: String(url), body: JSON.parse(init.body), key: init.headers['x-goog-api-key'] });
    return new Response(JSON.stringify({
      id: 'v1_smoke', status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: '**回答**：静观其变。' }] }],
    }), { status: 200 });
  };
`);
check('saved key collapses the settings row', await evaluate(`getComputedStyle(document.querySelector('.chat-settings')).display === 'none'`));
check('key status shows last four', await evaluate(`document.querySelector('.chat-status').textContent.includes('…1234')`));

await evaluate(`(() => { const i = document.querySelector('.chat-input'); i.value = '这卦怎么说？'; document.querySelector('.btn-chat-send').click(); })()`);
await sleep(900);
check('user bubble rendered', await evaluate(`document.querySelectorAll('.chat-log .chat-msg.user').length === 1`));
check('model reply rendered', await evaluate(`document.querySelector('.chat-log').textContent.includes('静观其变')`));
check('reply markdown bolded', await evaluate(`document.querySelector('.chat-log').innerHTML.includes('<strong>回答</strong>')`));
check('sent to the Interactions endpoint', await evaluate(`window.__calls[0].url.includes('/v1beta/interactions')`));
check('key travelled in the header', await evaluate(`window.__calls[0].key === 'AIza-smoke-1234'`));
check('chips collapse after talking (ephemeral too)', await evaluate(`getComputedStyle(document.querySelector('.chat-chips')).display === 'none'`));
check('send button re-enabled', await evaluate(`document.querySelector('.btn-chat-send').disabled === false`));

// failure path: readable error, question back in the composer, context rolled back
await evaluate(`window.fetch = async () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 })`);
await evaluate(`(() => { const i = document.querySelector('.chat-input'); i.value = '第二问'; document.querySelector('.btn-chat-send').click(); })()`);
await sleep(700);
check('429 becomes a readable error bubble', await evaluate(`document.querySelector('.chat-log').textContent.includes('额度已用尽')`));
check('failed question returns to the composer', await evaluate(`document.querySelector('.chat-input').value === '第二问'`));
check('failed turn leaves no user bubble', await evaluate(`document.querySelectorAll('.chat-log .chat-msg.user').length === 1`));
await evaluate(`localStorage.removeItem('gemini_api_key')`);

// ── 14. console hygiene ───────────────────────────────
const realErrors = consoleErrors.filter((m) => !/Gemini connectivity/.test(m));
check('no console errors', realErrors.length === 0, realErrors.join(' | '));
check('no uncaught exceptions', exceptions.length === 0, exceptions.join(' | '));

console.log('\n' + '-'.repeat(60));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILURES:');
  for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
  process.exit(1);
}
ws.close();
process.exit(0);
