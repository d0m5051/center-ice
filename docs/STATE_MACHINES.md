# Center Ice state machines

Every piece of state in the app that changes over time, written as a state machine: its states, the invariants that
must hold, and the transitions that move it. The second half lists the invalid states and transitions the code could
actually reach, with evidence, and how each was fixed.

Keep this file in step with the code. When a transition changes, update its table, and add a finding below if you
find a way to reach an invalid state.

Conventions: `S` is the settings object, `M` the model built by `buildModel()`, `pend` the unsaved model settings.
"Tab" means a browser tab, and "panel" means one of the app's sections (Home, Wire and so on).

## Contents

1. [Data source](#1-data-source)
2. [Model](#2-model)
3. [Heavy jobs (odds, wire, trades)](#3-heavy-jobs-odds-wire-trades)
4. [Worker client (per call)](#4-worker-client-per-call)
5. [Trade horizon](#5-trade-horizon)
6. [ESPN sync](#6-espn-sync)
7. [NHL schedule cache](#7-nhl-schedule-cache)
8. [Settings and pending model settings](#8-settings-and-pending-model-settings)
9. [Persistence and other open tabs](#9-persistence-and-other-open-tabs)
10. [Navigation](#10-navigation)
11. [Popups (modal host)](#11-popups-modal-host)
12. [Coach session](#12-coach-session)
13. [Coach-made trades and the Trades dot](#13-coach-made-trades-and-the-trades-dot)
14. [Compare list](#14-compare-list)
15. [Coach references editor](#15-coach-references-editor)
16. [Dock (lens and shrink)](#16-dock-lens-and-shrink)
17. [Small UI machines](#17-small-ui-machines)
18. [Findings](#findings)

---

## 1. Data source

Implicit. Lives in `App` (`data`), seeded by `main.jsx`.

| State | Meaning |
|---|---|
| `embedded` | The snapshot bundled in `src/data/snapshot.json` (`source` is not `"sync"`). |
| `synced` | Data parsed from ESPN and committed (`source: "sync"`). |

Invariants
- `validData(data)` is always true. Boot only accepts a stored copy that passes `validData` and is newer than the
  bundled snapshot.
- `data` and the IndexedDB key `ci-data` agree, unless the browser refused the write; then the sync message says the
  data is in use but won't survive a reload (F4).

| From | Event | To | Side effects |
|---|---|---|---|
| boot | `ci-data` valid and newer than the bundle | `synced` | none |
| boot | otherwise | `embedded` | none |
| any | sync committed (`commitData`) | `synced` | write `ci-data`, announce to other tabs, maybe write `ci-games`, set the sync message |
| any | "Use built-in snapshot" (`revertData`) | `embedded` | delete `ci-data`, announce, set the sync message |
| any | another tab announced `ci-data` | `synced` or `embedded` | re-read and validate the key |
| any | a newer copy in the remote store (`window.claude.use("db")`, absent on Netlify) | `synced` | write `ci-data` |

## 2. Model

`M = buildModel(data, S, gcache, modelNow)`, a pure value.

- **Rebuilt when** `data`, `gcache`, `S.gpw`, `S.sd` or `S.projW` changes, or the Eastern-time day rolls over
  (`dayKey`, from a 30-second clock).
- **Invariant:** row objects belong to one `M`. Every wire or trade result is unpacked against the same `M` that
  produced its worker input, so identity checks such as `w.drop === r` stay valid.
- **Derived flags:**
  - `SCHED_OK`: an NHL schedule is loaded.
  - `ROS_OK`: the schedule reaches at least 150 days ahead.
  - `STARTS_OK`: ESPN's goalie starter status is for today.

## 3. Heavy jobs (odds, wire, trades)

Explicit in `App.jsx`. There are two jobs: `odds` (the sim worker) and `lineup` (the lineup worker, which produces
`wire` and `trades`).

| State | `odds` / `wire` / `trades` | `jobErr[job]` | UI |
|---|---|---|---|
| `loading` | `null` | `null` | `<Loading>` line |
| `ready` | value | `null` | content |
| `error` | `null` | message | error line with Retry |

Inputs: `workerIn = {data, S model keys, sims, gcache, modelNow}`, plus `tmode` for trades and a retry counter
(`jobNonce`).

| From | Event | To |
|---|---|---|
| any | `workerIn` or `jobNonce` changes | `loading` (both jobs restart; the previous calls are superseded) |
| `loading` | current call resolves | `ready` |
| `loading` | current call rejects (not superseded) | `error` |
| `loading` | call superseded | stays `loading` (the newer call owns the state) |
| `error` | Retry (`retryJobs`) | `loading` |
| `ready` (lineup) | effective `tmode` changes | trades `loading`; wire kept if present, recomputed if still missing |

Invariants
- A result or an error reaches state only from the newest call (worker client, §4).
- `error` is never silent: every `<Loading job=…>` site renders the error and a Retry button. The sites are Week (top
  moves), Wire, Trades, League odds and the seed chart, the Roster detail pane, the player and upgrades popups, and
  Coach.
- The coach can only ask while all three values are present (`ready`); otherwise its loading line shows the job
  error and Retry.

## 4. Worker client (per call)

Explicit in `src/lib/workerClient.js`. Each `run()` gets a sequence id; `seq` is the newest id.

| State | Meaning |
|---|---|
| `pending` | Posted to the worker and waiting. |
| `resolved` | The worker replied `ok` and the id is still the newest. |
| `rejected` | The worker replied with an error, or crashed, and the id is still the newest. |
| `superseded` | A newer call exists. The promise rejects with `superseded: true` whatever the worker replied. |

Worker lifecycle: `none -> running` on first use. `running -> none` on an `error` event (for example, the script
failed to load): every pending call is rejected, the dead worker is terminated, and the next `run()` starts a new
worker. If `postMessage` or the factory throws, the call rejects instead of hanging.

## 5. Trade horizon

| | |
|---|---|
| Preference | `tmodePref` in `"now" \| "ros"`, persisted in localStorage as `ci-tmode`. |
| Effective | `tmode = effectiveTmode(tmodePref, M.ROS_OK)` (`src/lib/state.js`). |

Invariants
- The effective horizon is `"ros"` only when `M.ROS_OK` is true. Otherwise every rest-of-season lineup value is 0
  and the trade search returns nothing (F3).
- The radio group shows the effective horizon. The stored preference is kept, so `"ros"` comes back once the schedule
  supports it.

| Event | Effect |
|---|---|
| Click "Win now" or "Rest of season" (the latter only enabled when `ROS_OK`) | `tmodePref` set and persisted |
| `ROS_OK` flips (schedule loaded or lost) | effective `tmode` changes and trades re-run |

## 6. ESPN sync

Explicit in `App` (`runSync`, `syncGate`, `syncBusy`). The UI is the Settings › Data section.

| State | Meaning |
|---|---|
| `idle` | No sync running. Buttons enabled. |
| `running` | One sync in flight (`syncBusy`). Every sync button is disabled, in every mount of the Data section. |
| `panel` (UI only) | A direct sync failed, so the bookmark and paste instructions are shown. Local to the Data section. |

| From | Event | To | Notes |
|---|---|---|---|
| `idle` | Sync now, Paste & import, or Import | `running` | `syncGate.run` |
| `running` | another start | `running` | refused (`{skipped: true}`), no second request |
| `running` | parsed and committed | `idle` | data becomes `synced` (§1), panel closes |
| `running` | direct fetch or parse fails | `idle` | Sync now: panel opens with the reason. Paste or Import: error message. |
| `running` | Data section unmounted | `running` | the sync lives in `App`, so it finishes and commits |

Invariants
- At most one sync runs at a time (F4).
- A parsed sync is always applied, whether or not it was saved (F4).

## 7. NHL schedule cache

`gcache = {t, season, g}` or `null`, stored as IndexedDB `ci-games`.

| Event | Effect |
|---|---|
| boot | read `ci-games` (accepted if `g` is a non-empty array; the model also checks `season`) |
| mount, cache missing or older than 6 h | `fetchSchedule()`; on success write, announce and set |
| sync carried games | write, announce and set |
| another tab announced `ci-games` | re-read and set |

## 8. Settings and pending model settings

| Value | Kind | Where |
|---|---|---|
| `S` | Committed settings, applied to `<html>` by `applyLook` | localStorage `ci-settings` |
| `pend` | Unsaved changes to model keys (`projW`, `sd`, `gpw`, `sims`) | memory only |

| Event | Effect |
|---|---|
| change a look, coach or view key (`setKey`) | `S` updated, applied and saved |
| change a model key | `pend[k] = v`; the model is unchanged |
| Recalculate | `S = {...S, ...pend}`, `pend = {}`; the model and jobs re-run in place |
| Restore defaults | `pend = DEF` for the model keys |
| Reset appearance | look keys set back to `DEF` |
| Reset everything | clears `ci-settings`, `ci-tab`, `ci-roster` and `ci-setcat`, then reloads |
| another tab saved `ci-settings` (`storage` event) | `S = loadSettings()` (F2) |

Invariants
- "Unsaved changes" is shown, and Recalculate enabled, exactly when some `pend[k] !== S[k]`.
- `S` matches what is stored, and a tab never writes back an older copy over another tab's change (F2).

## 9. Persistence and other open tabs

| Key | Store | Writer | Cross-tab |
|---|---|---|---|
| `ci-settings`, `ci-tab`, `ci-roster`, `ci-setcat`, `ci-tmode` | localStorage | `App`, Settings, Roster | `ci-settings` via the `storage` event; the others are per-tab preferences |
| `ci-cmp`, `ci-return`, `ci-sync-msg` | sessionStorage | `App` | per tab by design |
| `ci-data`, `ci-games`, `ci-refs`, `ci-coach-trades` | IndexedDB `center-ice/kv` | `App` | `announce(key)` on a BroadcastChannel; other tabs re-read the key |

One-time migration: on first boot the old localStorage copies of the IndexedDB keys move over, and
`ci-idb-migrated = 1` is set once every key that could be moved was moved.

Invariants
- List values (`ci-refs`, `ci-coach-trades`) are updated from the latest value in a ref, never from a render-time copy,
  so an async step such as reading a PDF can't drop a concurrent change (F2).
- After a write is announced, every open tab holds the same list before its next write.
- Residual: two tabs writing within the same few milliseconds is still last-writer-wins. There are no locks.

## 10. Navigation

| Value | Meaning |
|---|---|
| `tab` | One of `TABS`. |
| `visited` | Set of panels that have been mounted. A panel stays mounted (hidden) once visited, so its local state survives tab switches. |

Start tab: a valid `#hash` wins, then `ci-return` (one shot, from the Reset reload), then `S.startTab` (or `ci-tab`
when it is "last"), then `week`. `odds` and `sched` map to `board`.

| Event | Effect |
|---|---|
| `show(t)` | `tab = t`, add `t` to `visited`, save `ci-tab`, scroll to top. Showing `deals` clears the Trades dot. |
| More sheet item | close the sheet, then `show(item)` |
| `goSync()` | close any popup, open Settings › Data, click Sync now |
| `coachAsk(q)` | `show("coach")`, then set `coachReq` (§12) |

## 11. Popups (modal host)

`modal = null | {type: player|compare|opt|up|starts|more, id?}`.

| From | Event | To | Effect |
|---|---|---|---|
| `null` | open X | X | `#app` made inert, scroll locked, opener recorded (the last element focused outside the dialogs) |
| X | open Y (player → compare) | Y | opener kept |
| X | Escape, backdrop click, Close, or an action | `null` | inert removed, focus returned to the opener (or to the selected tab if the opener is gone) |

Invariants
- While `modal` is not null, exactly one dialog is rendered, focus is inside it, and Tab is trapped in it.
- The opener is never an element inside a dialog.
- Latent, not reachable today: if a player popup were opened for an id missing from `M`, `PlayerOv` would render
  nothing while `#app` stayed inert. Every id passed to `openPlayer` comes from rows of the current `M`, and while a
  popup is open the app is inert, so nothing can swap the data underneath it.

## 12. Coach session

Explicit in `src/lib/coachSession.js`, driven by `panels/Coach.jsx`.

| State | Meaning |
|---|---|
| `idle` | Can ask, if odds, wire and trades are ready. |
| `asking(ac)` | One request streaming, owned by AbortController `ac` (`ctrl === ac`). |

Data: `log` (visible), `hist` (API history; empty means the next turn carries the full league context), `ctxGen`.

| From | Event | To | Effect |
|---|---|---|---|
| `idle` | ask | `asking(ac)` | log gets the question and "Thinking…" |
| `asking` | ask | `asking` | refused |
| `asking(ac)` | chunk, `ctrl === ac` | `asking(ac)` | last log entry updated |
| `asking(ac)` | done, `ctrl === ac` | `idle` | final text and harvested trades; `hist` stored only if `ctxGen` is unchanged |
| `asking(ac)` | error, `ctrl === ac` | `idle` | error entry |
| any | Clear | `idle` | abort `ac`, `ctrl = null`, `hist = []`, `log = []` |
| any | data changed (`M` rebuilt) | same | `ctxGen++`, `hist = []` |
| `asking(ac)` | chunk, done or error after Clear (`ctrl !== ac`) | unchanged | ignored (F5) |

`coachReq` (from "Ask the coach" buttons elsewhere): focus switches to your team. If the coach is ready and idle the
question is asked; otherwise it is put in the input box. The request is then cleared.

## 13. Coach-made trades and the Trades dot

- `ctrades`: list of `{key, o, send[], get[], at}`, at most 12, newest first, stored as IndexedDB `ci-coach-trades`.
- A trade is added when an answer about your own team contains `TRADE:` lines that resolve to current players; a
  duplicate `key` is skipped.
- A trade is shown only while every player is still on the named team; the others stay stored but hidden.
- `dealsDot` turns on when a trade is added and off on `show("deals")`.

## 14. Compare list

`cmp` holds up to 3 player ids, stored in sessionStorage as `ci-cmp`.

Invariant: every id in `cmp` exists in the current `M` (F6).

| Event | Effect |
|---|---|
| Add to compare / Remove from compare (player popup) | add or remove one id |
| Clear (compare popup) | `[]` |
| `M` changes | `cmp = pruneIds(cmp, M.rowById)` |

## 15. Coach references editor

- **Mode:** `link | file | text`.
- **Edit:** `null | id`.
- **Saved list:** `refs` (IndexedDB `ci-refs`, §9).

Each row's Remove button arms on the first tap and fires on the second within 4 s. Saving an edit, removing a row or
toggling a row updates by `id` through `setRefs(fn)`.

## 16. Dock (lens and shrink)

- **Lens:**
  - `unplaced -> placed` on first layout.
  - `.lens-ready` is added in the next frame, so the lens doesn't fly in from the corner.
  - It is re-placed on selection changes and resizes.
- **Shrink:**
  - `full <-> mini` on scroll down or up, phone only.
  - Disabled by Settings (`dockShrink`), reduce motion, or the OS preference.
  - Classes are toggled on the DOM node; React never rewrites the dock's `className`, so they survive renders.

## 17. Small UI machines

| Machine | States | Notes |
|---|---|---|
| Settings category | `look \| layout \| coach \| model \| data` | `ci-setcat`; `goSync` forces `data` |
| Wire filter / search / limit | filter, query, limit | the limit resets to 100 on filter or search; the filter resets when `S.wireDefault` changes |
| Wire / Roster selection (wide screens) | selected id or none | falls back to the first row if the id is gone |
| Arm buttons (Remove, Reset everything) | `idle -> armed (4 s) -> fire \| idle` | |
| Flash buttons (Copy …) | `label -> message (2.5 s) -> label` | |

---

## Findings

Confirmed invalid states and transitions, highest impact first. Each was reproduced on the pre-fix build. Each has a
regression test that fails on the old code and passes now (except where noted). The GitHub issue numbers group the
related fixes.

| # | Impact | Issue | Invalid state or transition | Status |
|---|---|---|---|---|
| F1 | High | #2 | job `error` rendered as endless `loading`; no way out | fixed |
| F2 | Medium | #3 | another tab's (or an async step's) change overwritten by a stale copy | fixed |
| F3 | Medium | #4 | effective horizon `ros` while `ROS_OK` is false: zero trades | fixed |
| F6 | Low | #4 | `cmp` holds ids that aren't in `M` | fixed |
| F4 | Low–Medium | #5 | parsed sync refused because the save failed; two syncs in flight | fixed |
| F5 | Low | #6 | late chunk or answer from an aborted coach request; stale history restored | fixed |

### F1. A failed worker job leaves the app loading forever

**What was wrong:**
- `App` stored worker failures in `jobErr`, but nothing rendered it or cleared it, and there was no retry.
- The Wire, Trades, Top moves, odds and Coach views waited forever on `null`, and the coach stayed disabled.
- The worker client also passed errors from superseded calls through as real errors. That was harmless only because
  nobody displayed them.
- A crashed worker was dropped without being terminated.

**How it's reached:**
- The worker script fails to load. For example, a tab is still open across a Netlify deploy, so the old hashed
  chunk is gone when the worker restarts.
- `buildModel()` throws on unusual synced data.
- The worker runs out of memory.

**Evidence:**
- Pre-fix, `grep jobErr src` showed it only being set, never rendered.
- With the lineup worker returning 404, the Wire tab still showed "Scoring free agents…" after 6 s, with no error.

**Fix:**
- Per-job error state, rendered by `<Loading job>` with a Retry button that re-runs both jobs.
- The worker client reports stale results and stale errors only as `superseded`, terminates a crashed worker, and
  rejects instead of hanging when the worker can't be created.

**Tests:**
- `test/workerClient.test.mjs` (stale failure, crash and restart, factory throw).
- `test/e2e/state.e2e.mjs`: "worker failure shows an error with Retry…" (404 on the worker chunk, error shown,
  Retry recovers).

### F2. Lost updates to saved settings, references and coach trades

**What was wrong:**
- Each tab kept its own copy of settings, references and coach trades, and wrote the whole value back on every
  change. A second open tab silently overwrote the first tab's changes.
- Within one tab, adding reference files saved `[...newFiles, ...refs]` using the `refs` captured before the
  (possibly slow) PDF or Word read. A toggle or removal made while the file was being read was lost.

**Evidence:**
- Two tabs: tab A set Light theme, then tab B set Compact density. Stored settings ended as `mode: "dark",
  density: "compact"`, and tab B still showed dark.
- Two tabs each adding a reference: only tab B's reference survived. The e2e test fails on the old build.

**Fix:**
- `storage` event → `setS(loadSettings())`.
- A BroadcastChannel announces each IndexedDB write, and other tabs re-read the key.
- `setRefs` and `setCtrades` take updater functions applied to the latest value. The references editor updates by
  id.

**Tests:**
- e2e "settings changed in two tabs don't overwrite each other".
- e2e "coach references added in two tabs are both kept".
- The in-tab file-read race has no automated test. It is closed by construction: every write now goes through an
  updater.

**Residual:** two tabs writing at nearly the same instant is still last-writer-wins (§9).

### F3. A stored "Rest of season" horizon produces no trades when the schedule can't support it

**What was wrong:**
- `ci-tmode = "ros"` is restored on load, but rest-of-season values need `M.ROS_OK`.
- Without the schedule, `ROS_G = 0`, so every lineup scores 0 and `findTrades` returns `[]`.
- The Trades tab said no swap helps, Top moves dropped its trade, and the coach was told the finder found nothing.
  The "Rest of season" button was disabled yet still checked, so the user couldn't see why.

**How it's reached:**
- The first visit after choosing "Rest of season" on a day the schedule was cached, when ESPN blocks the direct
  schedule fetch (common outside ESPN's own pages) and no bookmark sync has run yet.
- Reverting or clearing the schedule cache.

**Evidence:** pre-fix, with `ci-tmode = ros` and no schedule, the "ros" radio showed `aria-checked=true` and was
disabled, with 0 trade cards.

**Fix:** `effectiveTmode(pref, ROS_OK)` drives the search, the UI and the coach context. The stored preference is
kept.

**Tests:**
- `test/state.test.mjs` "regression: a stored 'ros' horizon…" (raw `ros` gives 0 trades; the effective horizon finds
  trades).
- e2e "a stored rest-of-season horizon…".

### F6. The compare list keeps players that no longer exist

**What was wrong:** after a revert to the built-in snapshot, or a sync that drops a free agent, `ci-cmp` still held
their id. The player popup counted it, offering "Compare 2" that opened a single-player compare, or showing "Compare
is full (3)" while fewer than 3 players could be compared.

**Fix:** when `M` changes, `cmp` is pruned to ids `M` still has.

**Tests:** `test/state.test.mjs` (`pruneIds`) and e2e "compare ids that no longer exist are dropped".

### F4. A sync could be refused after parsing, and two syncs could overlap

**What was wrong:**
- `commitData` threw "Parsed fine, but this browser blocked saving it, so it can't be applied" whenever IndexedDB
  refused the write. That rule came from the single-file version, which reloaded the page to apply data. Data is now
  applied in memory, so refusing to apply was a leftover.
- The sync-in-flight flag lived in the Data section's local state. Leaving the section and coming back reset it, so a
  second sync could start while the first was still running. Whichever finished last won, even if it was the older
  one.

**Evidence:**
- The `throw` in `App.commitData` (pre-fix).
- Settings renders only the active category, so `Data` unmounts on a category switch, dropping `busy`.

**Fix:**
- `persistSync` and `syncMessage`: always apply, and warn when the data won't survive a reload.
- The sync moved into `App` behind a one-at-a-time gate, with `syncBusy` shared by every mount.

**Tests:** `test/state.test.mjs` "sync gate runs one task at a time…", "…releases after a failing task", and
"regression: synced data is applied even when the browser won't save it".

### F5. Coach conversation races

**What was wrong:**
- The streaming callback and the completion handler wrote to "the last log entry" without checking that they still
  owned the conversation. Clear followed by a new question could get a late chunk, or a late answer, from the
  cleared request written into the new question's slot.
- When new data arrived mid-answer, the history was reset, but the finishing request then put back a history built
  on the old context, so the next question reused stale data.

**Fix:** `createCoachSession`. Only the request that owns `ctrl` may write, and history is stored only if the context
generation is unchanged.

**Tests:** `test/coachSession.test.mjs` (the three "regression:" cases). The old logic lived inside the component,
so these tests pin the new machine; they can't run against the old code.

### Checked and not bugs

- `workerIn` and `tmode` effects running in the same render: the second call supersedes the first and computes what
  is missing (`needWire`).
- The modal opener when one popup replaces another: kept, and verified (player → compare → close returns focus to the
  row).
- Dock classes toggled outside React: the dock's `className` prop is constant, so React never rewrites it.
- `goSync()` clicking `#syncBtn` after 60 ms: the state updates run in a discrete event and are committed before the
  timer fires.
- Known inefficiency, not a correctness bug: superseded worker calls still run to completion inside the worker before
  the newer one starts.

## Tests

| Command | Covers |
|---|---|
| `npm test` | Unit tests: worker client, state rules, sync gate, coach session (`test/*.test.mjs`). |
| `npm run test:e2e` | Builds, serves `dist` with `vite preview`, and drives Chromium with Playwright (`test/e2e/*.e2e.mjs`). |
