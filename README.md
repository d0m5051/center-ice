# Center Ice

Fantasy hockey dashboard for ESPN league 1454450537: standings and playoff odds, lineup optimizer, waiver wire,
trade finder, points cheat sheet and a bench coach. Vite + React 19, deployed on Netlify.

```sh
npm ci
npm run dev       # local dev server
npm run build     # production build into dist/
npx vite preview  # serve dist/
```

The coach calls `/api/coach`, a Netlify function (`netlify/functions/coach.mts`) that streams answers from Claude
(`claude-opus-5-5`, medium effort) with the Anthropic SDK. Set `ANTHROPIC_API_KEY` in Netlify under Site configuration >
Environment variables. If a safety classifier declines a question, the API retries it on Anthropic's recommended fallback
model (`fallbacks: "default"`). The function only runs on Netlify or under `netlify dev`.

## Architecture

```
index.html              shell: pre-paint theme script, #app, #modal-root
src/main.jsx            boot: settings + look applied synchronously, league data read from IndexedDB, then render
src/App.jsx             state, persistence, worker jobs, navigation, context provider
src/ctx.js              React context (useApp)
src/lib/                pure modules, no DOM unless noted
  model.js              buildModel(): every derived value (standings, strength, week plan, optimizer, alerts, points)
  sim.js, lineup.js     the heavy jobs: Monte Carlo playoff sim, wire scoring, trade search
  settings.js, look.js  settings (localStorage) and applying them to <html> (DOM)
  storage.js            IndexedDB key-value store, localStorage migration
  espn.js               ESPN sync: direct fetch, bookmarklet / Shortcut / userscript, parser
  coach.js, refs.js     coach prompt, context, trade harvesting; coach reference file readers (lazy pdf.js / JSZip)
  workerClient.js       promise client for the workers; a newer call supersedes an older one
src/workers/            sim.worker.js, lineup.worker.js (rebuild the model from the same inputs)
src/components/         Dock (tab bar and lens), Header, Modal (focus trap), shared UI pieces
src/panels/             one component per tab
src/overlays/           every popup (player, compare, optimize, upgrades, goalie starters, More)
src/hooks/              useGlass (pointer glint, rim light), useMedia
src/styles/app.css      the stylesheet, in cascade layers
original/               the single-file version this was migrated from (reference only, not built)
```

## What changed from the single-file version

- **Modules instead of string templates.** All markup is React; nothing goes through `innerHTML`.
- **Web workers.** The playoff simulation and the lineup-heavy work (wire scoring, trade search) run off the main
  thread. Panels show a loading line until a result arrives.
- **No reloads.** Recalculate (model settings), Sync, reverting to the built-in snapshot and loading the NHL schedule
  all update in place. Only "Reset everything" reloads.
- **IndexedDB.** League data, the NHL schedule cache, coach references and coach-made trades live in IndexedDB
  (no 5 MB quota, async). Older copies in localStorage are moved over on first load. Settings stay in localStorage
  because they're tiny and needed before first paint.
- **Tab lens.** The spring-physics lens (rAF loop, per-frame SVG displacement) is now one element moved with CSS
  transitions on `translate`, and the tab strip uses scroll-snap. The drag-to-switch gesture is gone: tap a tab,
  or use the arrow keys. The pointer glint is mouse-only, throttled to ~30 fps, and reads layout before writing.
  The rim light eases through a registered `@property --rim` transition.
- **Cascade layers.** `reset, tokens, base, glass, components, responsive, prefs, skin, toggles, utilities`. The
  `:root:not(#_)` specificity hacks and duplicated dark-mode blocks are gone: the theme is resolved in JS, so the
  CSS only knows `[data-theme="dark"]`.
- **Accessible dialogs.** Every popup traps Tab and Shift+Tab, closes on Escape or a backdrop click, makes the app
  behind it `inert`, and returns focus to whatever opened it, including when one popup opens another
  (player, then compare).
- **Keyboard.** Tabs, Settings sections and segmented controls use roving focus with arrow keys. Player rows open
  with Enter or Space. Standings headers are buttons with `aria-sort`.
- **Schedule tab.** When the NHL schedule isn't loaded, the empty grid, goalie and streaming sections are hidden
  instead of rendering as blank headings.
- **Sync additions from the GitHub copy of the page.** The iPhone Userscripts-extension option, and the bookmarklet's
  pull of the last week's transactions, which the parser applies to rosters ESPN hasn't caught up on (last 48 hours).
