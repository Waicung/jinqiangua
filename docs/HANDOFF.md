# Handoff — architecture review & deepening

**Snapshot:** 2026-11-23 · branch `main` · candidate #2 implemented on top of `db31585` (candidate #1)
**Next up:** candidate #3 — one mounted 解卦面板. Candidates #1 and #2 are done and verified.

## How to resume

**Same conversation (exact history):**

```sh
cd /home/waicung/willdev/solo/iching/v2
pi --continue          # most recent session for this directory
# or: pi --resume     # pick a session (or /resume inside Pi)
```

This conversation's Pi session:

```
id:   01a205d8-6531-70ed-8d90-fdb3d8394841
file: /home/waicung/.pi/agent/sessions/--home-waicung-willdev-solo-iching-v2--/2026-11-23T00-39-57-490Z_01a205d8-6531-70ed-8d90-fdb3d8394841.jsonl
```

From any directory: `pi --session 01a205d8-6531-70ed-8d90-fdb3d8394841`.

**New session, another machine, or another agent:** start with:

> Read `docs/HANDOFF.md` and continue with candidate #3.

The full visual review is saved as `docs/architecture-review-2026-11-23.html`. It is a snapshot taken *before* candidates #1 and #2 were implemented, so its header stats describe the old state; the candidate analysis and diagrams are still the reference for #3–#5.

## Done: candidate #2 — one 会话 module

| File | Change |
| --- | --- |
| `session.js` | **new** 会话 store: record, adapters, 交流有效期 gate, 卦历 cap |
| `tests/session.test.js` | **new** 28 tests, 1,919 assertions across both suites |
| `app.js` | 1,831 → 1,738 lines; deleted `loadSessions`, `writeSessions`, `saveSession`, `createSession`, `getSessionById`, `isSessionExpired`, `persistMessage`, `CHAT_VALID_MS`, `SESSIONS_KEY`, `SESSION_MAX` |
| `app.js` | `chatState` is now transient only (`history` / `system` / `busy`); transport handle lives on the 会话 record |
| `sw.js` | pre-caches `/session.js`; `CACHE_NAME` bumped `v8 → v9` |
| `CONTEXT.md` | added the 会话 term |

### Settled decisions — do not re-litigate

1. Module boundary = record + storage adapter. The 卦历 **panel** stays candidate #3.
2. Two adapters behind one `SessionStorage` seam: `localStorageAdapter` (prod) and `memoryAdapter` (tests).
3. Time is explicit: the store takes an optional clock `{ now }`, `create` accepts `{ now }`, and `canContinue(session, now)` / `remainingMs(session, now)` take a timestamp. Fake-clock tests.
4. The `iching_sessions_v1` record shape is unchanged. No migration, no new fields; `ephemeral` is still the only transient extra.
5. `chatState` no longer mirrors `previousInteractionId` / `transport`; those live only on the 会话 record. `history` / `busy` stay transient.
6. One gate: every “continue the 解卦” action calls `canContinue`; UI uses its negation for the expired state.
7. `create(..., { persist: false })` returns an in-memory `ephemeral` record (dev 快捷出结果).
8. Corrupt records are still silently filtered; quota / privacy-mode failures still degrade silently. Both tested.

### Interface contract

```js
import {
  CHAT_VALID_MS,        // 24h
  SESSION_MAX,          // 100
  SESSIONS_KEY,         // 'iching_sessions_v1'
  canContinue,          // (session, now) → boolean; the only 交流有效期 gate
  remainingMs,          // (session, now) → number, clamped at 0
  conversation,         // (session) → [{role:'user'|'model', text}]  (no intro / feedback)
  localStorageAdapter,  // (storage, key?) → SessionStorage
  memoryAdapter,        // (initial?) → SessionStorage
  createSessionStore,   // (storage, { now?, random? }) → SessionStore
} from './session.js';
```

`SessionStore`:

```js
create(numbers, reading, { now?, persist? }) → Session
appendMessage(session, role, text, { kind?, now? }) → SessionMessage | null
appendExchange(session, { question, answer, interactionId?, transport, now? }) → void
resetTransport(session) → void
list() → Session[]              // createdAt desc, corrupt records filtered, ≤ 100
get(id) → Session | null
clear() → void
```

- Adapters only touch bytes (`read` / `write` / `clear`); validation and the 100-record cap live in the store.
- `appendMessage` returns `null` for ephemeral sessions (no storage, no message list mutation).
- `appendExchange` is the only success path for 问答: two messages + `transport` + `previousInteractionId` in **one** write. For ephemeral sessions it updates transport in memory without writing.
- `resetTransport` clears the server-side handle on Key / model change and persists; conversation survives.
- `canContinue` is false for `null`, missing `expiresAt`, or `now >= expiresAt`.
- `conversation` is the API context rule (intro and feedback are stored but not replayed).

## Done earlier: candidate #1 — 卦象 derivation

| File | Change |
| --- | --- |
| `hexagram.js` | 卦象 module: derivation, lookups, 爻 vocabulary |
| `tests/hexagram.test.js` | 19 tests |
| `app.js` | deleted `getPrimaryHexagram`, `getTransformedHexagram`, `getMovingLines`, `computeReading`, local `trigramInfo`, constants, `posLabel` |
| `index.html` | `app.js` loaded as `<script type="module">` |

- Interface: `LINE_INFO`, `posLabel`, `trigramInfo`, `hexagramFor`, `hexagramById`, `deriveReading`.
- `binary` is six bits, **bottom line first**; `'1'` = 阳, `'0'` = 阴.
- `deriveReading` validates and throws; `hexagramFor` throws on unknown binary; `hexagramById` is total.
- `state` still carries `primary` / `transformed` / `movingLines` / numbers / line types for prompt building. Retiring it belongs with candidates #4/#5.

### Verified

```sh
bun run test          # 47 pass, 0 fail, 1919 expect() calls
bunx tsc --noEmit     # clean
```

Browser smoke test (headless Chrome over CDP, clean profile + `localStorage.clear()`) against a real six-throw 起卦:

- exactly one `iching_sessions_v1` record, keys unchanged, `expiresAt − createdAt = 86 400 000`, one `intro` message;
- intro + 4 chips + 有效期 strip rendered, Key row shown;
- 卦历 shows 1 item, reopening restores the same record and intro without duplicating it;
- after backdating `expiresAt`: composer / foot hidden, 截止 notice and feedback shown, 生成解卦提示 stays closed, status 已截止;
- 清空全部记录 empties storage and shows the empty state;
- 0 runtime exceptions, 0 console errors.

## Not done / deliberately untouched

- 卦历 panel and 解卦面板 stay in `app.js`; the panel is candidate #3.
- `state.primary` / `transformed` / `movingLines` / numbers / line types bag: candidates #4/#5.
- `formatClock` / `formatDateTime` / `formatRemaining` remain UI helpers in `app.js`.
- Ephemeral 会话 still store no messages (same as before); only transport is remembered in memory.

## Next: candidate #3 — collapse the 解卦面板 into one mounted module

**Files now:** `app.js:828–1015` (panel HTML + key UI), `app.js:1018–1122` (validity / feedback), `app.js:1125–1340` (API + send), `app.js:1380–1490` (dev bar), `app.js:1495–1590` (卦历 panel).

**Problem:** the panel's interface is ~41 element ids, four `document` listeners and `setInterval(updateChatValidityUI, 1000)`; real logic is hidden behind a re-rendered template string and `setTimeout(0)` init ordering.

**Suggested grilling round 1** (if the next session wants to move immediately):

1. **Module shape** — `mount(container, { session, store })` + `refresh()` / `destroy()`, or keep the panel as a renderer?
2. **Session dependency** — does the panel own `state.session` selection, or receive the current 会话 and call `canContinue` itself?
3. **Chat transport** — keep `history` / `system` / `busy` in the panel module, or move the Gemini client to its own module first?
4. **Ticker** — one `setInterval` inside the panel, or a shared clock the result page drives?
5. **Event wiring** — delegated listeners inside the panel root (so `destroy()` can remove them), or the existing global handlers?
6. **卦历** — same module, or a separate 卦历 panel module in the same pass?
7. **Prompt block** — part of the panel module, or a sibling?
8. **Tests** — pure helpers only (no DOM), or add a DOM harness?

Then candidates #4–#5 in the report.

## Constraints worth remembering

- No bundler. New runtime files must be added to `sw.js` `STATIC_ASSETS` **and** `CACHE_NAME` bumped.
- Anything that should not be served publicly goes in `.assetsignore`.
- UI copy is Chinese; comments mix Chinese and English.
- `app.js` is not `// @ts-check`; `hexagram.js` and `session.js` are. `bunx tsc --noEmit` covers both.
- Tests live in `tests/` and are excluded from deployment.
