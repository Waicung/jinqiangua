# Handoff — architecture review & 卦象 deepening

**Snapshot:** 2026-11-23 · branch `main` · candidate #1 committed as `2cdfaf8` (base `a72b84b`)
**Next up:** candidate #2 — one 会话 module. Candidate #1 is done and verified.
The `docs/` files, `.assetsignore` and `CLAUDE.md` pointer are not committed yet.

## How to resume

**Same conversation (exact history):**

```sh
cd /home/waicung/willdev/solo/iching/v2
pi --continue          # most recent session for this directory
# or: pi --resume     # pick a session (or /resume inside Pi)
```

This conversation's Pi session:

```
id:   01a205c6-87a9-70ed-8d90-fdb09b5d61f2
file: /home/waicung/.pi/agent/sessions/--home-waicung-willdev-solo-iching-v2--/2026-11-23T00-20-26-666Z_01a205c6-87a9-70ed-8d90-fdb09b5d61f2.jsonl
```

From any directory: `pi --session 01a205c6-87a9-70ed-8d90-fdb09b5d61f2`.

**New session, another machine, or another agent:** start with:

> Read `docs/HANDOFF.md` and continue with candidate #2.

The full visual review is saved as `docs/architecture-review-2026-11-23.html`. It is a snapshot taken *before* candidate #1 was implemented, so its header stats describe the old state; the candidate analysis and diagrams are still the reference for #2–#5.

## Done: candidate #1 — 卦象 derivation

| File | Change |
| --- | --- |
| `hexagram.js` | **new** 卦象 module: derivation, hexagram lookups, 爻 vocabulary |
| `tests/hexagram.test.js` | **new** 19 tests, 1,834 assertions |
| `app.js` | 1,918 → 1,831 lines; deleted `getPrimaryHexagram`, `getTransformedHexagram`, `getMovingLines`, `computeReading`, local `trigramInfo`, constants, `posLabel` |
| `index.html` | `app.js` loaded as `<script type="module">` |
| `sw.js` | pre-caches `/hexagram.js`; `CACHE_NAME` bumped `v7 → v8` |
| `package.json` | `"test": "bun test"` |
| `.assetsignore` | excludes `tests/` (and now `docs/`) from deployed assets |
| `CONTEXT.md` | added the 卦象 term |

### Settled decisions — do not re-litigate

1. Module scope = the whole 卦象 vocabulary. `tossCoins` stays in `app.js` (摇卦 is not 卦象).
2. ES modules, no bundler. `app.js` is a module; the SW stays a classic worker.
3. The hexagram table is passed explicitly; no `configure()` global, no self-fetching.
4. `Reading` keys are unchanged: `numbers`, `binary`, `primary`, `transformed`, `movingLines`, `primaryLineTypes`, `transformedLineTypes`. No `movingIndices` field.
5. `deriveReading` validates and throws: `TypeError` for non-arrays, `RangeError` for anything not exactly six integers in 6–9.
6. Tests are `tests/hexagram.test.js` against the real `data/iching.json`, excluded from deployment.
7. JSDoc typedefs + `// @ts-check` on `hexagram.js` only.
8. Old functions were deleted outright; the `state` bag remains for now.

### Interface contract

```js
import {
  LINE_INFO,        // 6/7/8/9 → { name, yang, moving, symbol }
  posLabel,         // (index, isYang) → 初九 / 六二 / 上六
  trigramInfo,      // (binary, table) → 上下卦名与符号
  hexagramFor,      // (binary, table) → Hexagram; throws RangeError on unknown binary
  hexagramById,     // (id, table) → Hexagram | undefined  (total, for 卦历)
  deriveReading,    // (numbers, table) → Reading; validates 6 × 6..9
} from './hexagram.js';
```

- `binary` is six bits, **bottom line first**; `'1'` = 阳, `'0'` = 阴.
- A table is the shape of `data/iching.json`.
- Lookups use `hexagrams[].binary` (verified equal to `lowerTrigram + upperTrigram`), not `trigramLookup`.

### Verified

```sh
bun run test          # 19 pass, 0 fail, 1834 expect() calls
bunx tsc --noEmit     # clean
```

Browser smoke test (`python3 -m http.server` + headless Chrome + CDP) at `?cast=789678`:
既济 → 随 rendered, 解卦提示 generated (本卦 / 上卦 / 动爻 / 解卦要求 present), chat intro rendered, no runtime exceptions.

## Not done / deliberately untouched

- The `state` bag: `showResult` still writes `primary` / `transformed` / `movingLines` / numbers / line types; prompt and chat still read them. Retiring it belongs with candidates #4/#5.
- Candidates #2–#5 below.
- SW cache bump means deployed clients pick up the new module on their next load; `force-refresh` remains the escape hatch.
- Candidate #1 is commit `2cdfaf8`. The docs added after it (`docs/`, plus this file's `.assetsignore`/`CLAUDE.md` pointers) are still uncommitted.

## Next: candidate #2 — one 会话 module

**Files now:** `app.js:697–845` (chatState + 卦历 storage), `app.js:791` (`persistMessage`), `app.js:847–897` (`restoreChatLog`), `app.js:1116–1190` (`updateChatValidityUI`), `app.js:1350–1428` (`sendChatMessage`), `app.js:1574–1675` (卦历 panel).

**Problem:** one 会话 has three homes — `chatState` (`history` / `transport` / `previousInteractionId`), `state.session` (same fields + `messages` + `expiresAt`), and `localStorage` (`iching_sessions_v1`). Every mutation writes two or three. 交流有效期 is re-decided at 12 call sites (`isSessionExpired` / `blockedByExpiry`), including two bespoke copies in `sendChatMessage` and `toggleFeedbackComposer`.

**Known facts:**
- `SESSION_MAX = 100`; `CHAT_VALID_MS = 24h`; records are sorted by `createdAt` descending.
- Dev casts use `ephemeral: true`: no localStorage write, but `state.session` exists in memory.
- `restoreChatLog` rebuilds `chatState.history` from the record, skipping `kind: 'intro'` and `kind: 'feedback'`.
- `loadSessions` silently filters corrupt records; `writeSessions` silently ignores quota/privacy-mode failures.
- `saveKeyFromInput` / `clearGeminiKey` reset `previousInteractionId` and `transport` in *both* `chatState` and the stored session.

**Suggested grilling round 1** (if the next session wants to move immediately):

1. **Module boundary** — record + storage adapter only, or also the panel's validity UI? → record + adapter; the panel stays candidate #3.
2. **Storage seam** — direct localStorage, or two adapters (localStorage in prod, in-memory in tests)? → two adapters, a real seam.
3. **Time** — pass `now` into `createSession` / `isExpired`, or read `Date.now()` internally? → explicit `now`, fake-clock tests.
4. **Schema** — keep the `iching_sessions_v1` record shape unchanged? → yes, no migration.
5. **`chatState` mirror** — remove the duplicated `previousInteractionId` / `transport` now, or wait for #3? → remove them; keep `history` / `busy` transient.
6. **One gate** — `canContinue(session, now)` used by prompt/chat/feedback, or keep per-action checks? → one gate.
7. **Ephemeral** — `createSession(..., { persist: false })` returning an unsaved record? → yes.
8. **Corrupt storage** — keep silent filtering? → yes, and test it.

Then candidates #3–#5 in the report.

## Constraints worth remembering

- No bundler. New runtime files must be added to `sw.js` `STATIC_ASSETS` **and** `CACHE_NAME` bumped.
- Anything that should not be served publicly goes in `.assetsignore`.
- UI copy is Chinese; comments mix Chinese and English.
