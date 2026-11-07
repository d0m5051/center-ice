import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppCtx, useApp } from "./ctx.js";
import { buildModel, SEASON, validData } from "./lib/model.js";
import { applyLook, watchSystemTheme } from "./lib/look.js";
import { saveSettings, loadSettings, MODEL_KEYS, coerce } from "./lib/settings.js";
import { lsGet, lsSet, ssGet, ssSet, ssDel, idbGet, idbSet, idbDel, announce, subscribe } from "./lib/storage.js";
import { effectiveTmode, pruneIds, sameIds, createGate, persistSync, syncMessage } from "./lib/state.js";
import { simClient, lineupClient } from "./lib/workerClient.js";
import { unpackWire, unpackTrades } from "./lib/lineup.js";
import { etKey, whenET, fmtET } from "./lib/calendar.js";
import { fetchSchedule } from "./lib/espn.js";
import { remoteGet, remoteSet, remoteDel } from "./lib/remote.js";
import { useGlass, installRefraction } from "./hooks/useGlass.js";
import { useModalHost } from "./components/Modal.jsx";
import { Dock, TABS } from "./components/Dock.jsx";
import { Header } from "./components/Header.jsx";
import { Week } from "./panels/Week.jsx";
import { League } from "./panels/League.jsx";
import { Roster } from "./panels/Roster.jsx";
import { Plan } from "./panels/Plan.jsx";
import { Alerts } from "./panels/Alerts.jsx";
import { Points } from "./panels/Points.jsx";
import { Wire } from "./panels/Wire.jsx";
import { Trades } from "./panels/Trades.jsx";
import { Coach } from "./panels/Coach.jsx";
import { Settings } from "./panels/Settings.jsx";
import { Overlays } from "./overlays/Overlays.jsx";
import EMBED from "./data/snapshot.json";

const TAB_IDS = TABS.map((t) => t.id);
const TABMAP = { odds: "board", sched: "board" };
const PANELS = { week: Week, board: League, roster: Roster, plan: Plan, alerts: Alerts, pts: Points, wire: Wire, deals: Trades, coach: Coach, set: Settings };

function startTab(S) {
  let t = (location.hash || "").slice(1); t = TABMAP[t] || t;
  const back = ssGet("ci-return"); ssDel("ci-return"); if (back) t = back;
  if (!TAB_IDS.includes(t)) { t = S.startTab === "last" ? lsGet("ci-tab") : S.startTab; t = TABMAP[t] || t; }
  return TAB_IDS.includes(t) ? t : "week";
}

/* Clock that ticks every `ms`; components that show countdowns read it. */
function useNow(ms) { const [n, setN] = useState(Date.now); useEffect(() => { const i = setInterval(() => setN(Date.now()), ms); return () => clearInterval(i); }, [ms]); return n; }

export default function App({ boot }) {
  const [S, setS] = useState(boot.S);
  const [data, setData] = useState(boot.data);
  const [gcache, setGcache] = useState(boot.gcache);
  const [tab, setTab] = useState(() => startTab(boot.S));
  const [visited, setVisited] = useState(() => new Set([tab]));
  const [tmodePref, setTmodePref] = useState(() => { const m = lsGet("ci-tmode"); return m === "ros" ? "ros" : "now"; });
  const [modal, setModal] = useState(null);
  const [ctrades, setCtradesState] = useState(boot.ctrades);
  const [refs, setRefsState] = useState(boot.refs);
  const [cmp, setCmpState] = useState(() => { try { return JSON.parse(ssGet("ci-cmp") || "[]").slice(0, 3); } catch { return []; } });
  const [coachReq, setCoachReq] = useState(null);
  const [dealsDot, setDealsDot] = useState(false);
  const [syncMsg, setSyncMsg] = useState(() => { const m = ssGet("ci-sync-msg"); ssDel("ci-sync-msg"); return m ? { cls: "ok", text: m } : null; });
  const [pend, setPend] = useState({});
  const now = useNow(30000);
  const dayKey = etKey(now);

  /* ---- look ---- */
  const sRef = useRef(S); sRef.current = S;
  useEffect(() => { applyLook(S); saveSettings(S); }, [S]);
  useEffect(() => watchSystemTheme(() => sRef.current), []);
  useEffect(() => { installRefraction(); }, []);
  useGlass(S);

  /* ---- model (cheap, main thread). Rebuilt when data, model inputs or the calendar day change. ---- */
  const modelNow = useMemo(() => Date.now(), [data, gcache, S.gpw, S.sd, S.projW, dayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const M = useMemo(() => buildModel(data, S, gcache, modelNow), [data, gcache, S.gpw, S.sd, S.projW, modelNow]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- heavy jobs (workers) ----
     Each job is idle -> loading -> ready | error (docs/STATE_MACHINES.md, "Heavy jobs"). A failed job shows its error
     with Retry; retryJobs() re-runs both. Superseded results and errors are dropped by the worker client. */
  const [odds, setOdds] = useState(null);
  const [wire, setWire] = useState(null);
  const [trades, setTrades] = useState(null);
  const [jobErr, setJobErr] = useState({ odds: null, lineup: null });
  const [jobNonce, setJobNonce] = useState(0);
  const retryJobs = useCallback(() => setJobNonce((n) => n + 1), []);
  const setErr = (k, v) => setJobErr((j) => (j[k] === v ? j : { ...j, [k]: v }));
  /* The stored horizon can be "ros" when rest-of-season isn't available; the effective one falls back to "now". */
  const tmode = effectiveTmode(tmodePref, M.ROS_OK);
  const workerIn = useMemo(() => ({ raw: data, S: { gpw: S.gpw, sd: S.sd, projW: S.projW, sims: S.sims }, gcache, now: modelNow }), [M, S.sims]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = `${data.snapshot}|${data.faSnapshot}|${data.source}|${gcache && gcache.t}|${S.gpw}|${S.sd}|${S.projW}|${modelNow}`;

  useEffect(() => {
    setOdds(null); setErr("odds", null);
    simClient.run(workerIn).then((r) => setOdds(r.odds), (e) => { if (!e.superseded) setErr("odds", "Playoff odds failed: " + e.message); });
  }, [workerIn, jobNonce]);

  const wireRef = useRef(null);
  useEffect(() => {
    setWire(null); wireRef.current = null; setTrades(null); setErr("lineup", null);
    lineupClient.run({ ...workerIn, key, tmode, wire: true, trades: true }).then((r) => {
      const w = unpackWire(M, r.wire); wireRef.current = w; setWire(w); setTrades(unpackTrades(M, r.trades));
    }, (e) => { if (!e.superseded) setErr("lineup", "Lineup scoring failed: " + e.message); });
  }, [workerIn, jobNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstTmode = useRef(true);
  useEffect(() => {
    if (firstTmode.current) { firstTmode.current = false; return; }
    setTrades(null); setErr("lineup", null);
    const needWire = !wireRef.current;
    lineupClient.run({ ...workerIn, key, tmode, wire: needWire, trades: true }).then((r) => {
      if (needWire) { const w = unpackWire(M, r.wire); wireRef.current = w; setWire(w); }
      setTrades(unpackTrades(M, r.trades));
    }, (e) => { if (!e.superseded) setErr("lineup", "Trade search failed: " + e.message); });
  }, [tmode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- persistence helpers ----
     Lists stored in IndexedDB are updated from the latest value (a ref), never from a render-time copy, and every write
     is announced to other open tabs, which reload the key. That closes the lost-update paths in docs/STATE_MACHINES.md. */
  const setTmode = useCallback((m) => { lsSet("ci-tmode", m); setTmodePref(m); }, []);
  const ctRef = useRef(boot.ctrades); ctRef.current = ctrades;
  const setCtrades = useCallback((fn) => {
    const next = typeof fn === "function" ? fn(ctRef.current) : fn;
    ctRef.current = next; setCtradesState(next);
    idbSet("ci-coach-trades", next).then((ok) => ok && announce("ci-coach-trades"));
  }, []);
  const setCmp = useCallback((next) => { ssSet("ci-cmp", JSON.stringify(next)); setCmpState(next); }, []);
  /* Drop compare ids the current data no longer has (after a sync or a revert). */
  useEffect(() => {
    const kept = pruneIds(cmp, (id) => !!M.rowById(id));
    if (!sameIds(kept, cmp)) setCmp(kept);
  }, [M]); // eslint-disable-line react-hooks/exhaustive-deps
  const refsAt = useRef(boot.refsAt || "");
  const refsRef = useRef(boot.refs); refsRef.current = refs;
  const setRefs = useCallback(async (fn) => {
    const next = typeof fn === "function" ? fn(refsRef.current) : fn;
    refsRef.current = next;
    const savedAt = new Date().toISOString(); refsAt.current = savedAt;
    setRefsState(next);
    const ok = await idbSet("ci-refs", { savedAt, refs: next });
    if (ok) announce("ci-refs");
    const size = next.reduce((n, r) => n + (r.text || "").length, 0);
    const rok = size <= 400000 ? await remoteSet("snapshots/coach-refs", { savedAt, refs: next }) : false;
    return ok || rok;
  }, []);

  /* Settings: look and coach keys apply at once; model keys wait in `pend` for Recalculate. */
  const setKey = useCallback((k, raw) => {
    const v = coerce(k, raw);
    if (MODEL_KEYS.includes(k)) { setPend((p) => ({ ...p, [k]: v })); return; }
    setS((s) => ({ ...s, [k]: v, ...(k === "cBlue" || k === "cGoal" ? { palette: "custom" } : {}) }));
  }, []);
  const setMany = useCallback((obj) => setS((s) => ({ ...s, ...obj })), []);
  const recalc = useCallback(() => { setS((s) => ({ ...s, ...pend })); setPend({}); }, [pend]);

  /* ---- data ----
     Sync is one-at-a-time (syncGate): a second start while one runs is refused, so an older result can't land after a
     newer one. Synced data is applied whether or not the browser saved it; the message says when it won't survive a
     reload. */
  const [syncBusy, setSyncBusy] = useState(false);
  const syncGate = useMemo(() => createGate(setSyncBusy), []);
  const saveGames = (games) => { const gc = { t: Date.now(), season: SEASON, g: games }; idbSet("ci-games", gc).then((ok) => ok && announce("ci-games")); setGcache(gc); };
  const commitData = useCallback(async (res) => {
    const saved = await persistSync(res.D, { idbSet, remoteSet });
    if (saved.local) announce("ci-data");
    if (res.D.games && res.D.games.length) saveGames(res.D.games);
    setData(res.D);
    setSyncMsg(syncMessage(res, saved));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* runSync(getObjs): fetch or read league JSON, parse it against the current data, commit. Returns false if a sync was
     already running. Parse errors propagate to the caller. */
  const dataRef = useRef(data); dataRef.current = data;
  const runSync = useCallback(async (getObjs, parse) => {
    const r = await syncGate.run(async () => { const objs = await getObjs(); await commitData(parse(objs, dataRef.current)); });
    return !r.skipped;
  }, [syncGate, commitData]);
  const revertData = useCallback(async () => {
    if (await idbDel("ci-data")) announce("ci-data");
    await remoteDel("snapshots/latest");
    setData(EMBED); setSyncMsg({ cls: "ok", text: "Using the snapshot this page shipped with." });
  }, []);

  /* Other open tabs: settings arrive through the storage event, IndexedDB keys through the broadcast channel. */
  useEffect(() => {
    const onStorage = (e) => { if (e.key === "ci-settings") setS(loadSettings()); };
    addEventListener("storage", onStorage);
    const off = subscribe(async (k) => {
      const v = await idbGet(k);
      if (k === "ci-data") setData(validData(v) && v.snapshot > EMBED.snapshot ? v : EMBED);
      else if (k === "ci-games") { if (v && Array.isArray(v.g) && v.g.length) setGcache(v); }
      else if (k === "ci-refs") { if (v && Array.isArray(v.refs)) { refsAt.current = v.savedAt || ""; refsRef.current = v.refs; setRefsState(v.refs); } }
      else if (k === "ci-coach-trades") { if (Array.isArray(v)) { ctRef.current = v; setCtradesState(v); } }
    });
    return () => { removeEventListener("storage", onStorage); off(); };
  }, []);

  /* Newer data saved from another device (only when a remote store exists). */
  useEffect(() => {
    (async () => {
      const d = await remoteGet("snapshots/latest");
      if (d && d.snapshot > data.snapshot) { try { const D = JSON.parse(d.json); await idbSet("ci-data", D); setData(D); } catch {} }
      const r = await remoteGet("snapshots/coach-refs");
      if (r && Array.isArray(r.refs) && (r.savedAt || "") > refsAt.current) { refsAt.current = r.savedAt; setRefsState(r.refs); idbSet("ci-refs", r); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Refresh the NHL schedule when ESPN allows a direct read; the bookmark sync carries it otherwise. */
  useEffect(() => {
    if (M.GAMES.length && Date.now() - M.GAMES_SRC < 6 * 36e5) return;
    fetchSchedule().then((sc) => { if (sc.games.length) saveGames(sc.games); }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- navigation ---- */
  const show = useCallback((t, { top = true } = {}) => {
    t = TABMAP[t] || t; if (!TAB_IDS.includes(t)) t = "week";
    if (t === "deals") setDealsDot(false);
    setTab(t); setVisited((v) => (v.has(t) ? v : new Set(v).add(t))); lsSet("ci-tab", t);
    if (top) window.scrollTo({ top: 0 });
  }, []);
  const openModal = useCallback((type, props = {}) => setModal({ type, ...props }), []);
  const closeModal = useCallback(() => setModal(null), []);
  useModalHost(!!modal);
  const openPlayer = useCallback((id) => setModal({ type: "player", id: String(id) }), []);
  const go = useCallback((g) => {
    if (g === "opt") openModal("opt"); else if (g === "up") openModal("up");
    else if (g.startsWith("pl:")) openPlayer(g.slice(3)); else show(g);
  }, [openModal, openPlayer, show]);
  const goSync = useCallback(() => { setModal(null); lsSet("ci-setcat", "data"); window.dispatchEvent(new CustomEvent("ci-setcat", { detail: "data" })); show("set", { top: false }); setCoachReq(null); setTimeout(() => { const b = document.getElementById("syncBtn"); if (b) { b.scrollIntoView({ block: "center" }); b.click(); } }, 60); }, [show]);
  const coachAsk = useCallback((q) => { show("coach"); setCoachReq({ q, n: Date.now() }); }, [show]);

  /* Row props for anything that opens a player: click, Enter or Space. */
  const plProps = useCallback((id) => ({
    tabIndex: 0, "data-pl": id,
    onClick: (e) => { if (e.target.closest("button,a,select,input")) return; openPlayer(id); },
    onKeyDown: (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); openPlayer(id); } },
  }), [openPlayer]);

  const alerts = useMemo(() => M.computeAlerts(S, wire, now), [M, S, wire, now]);
  const urgent = alerts.filter((a) => a.lv <= 1).length;
  const dots = { alerts: urgent ? "alerts need attention" : null, more: urgent ? "alerts need attention" : null, deals: dealsDot ? "new coach trade" : null };

  const ctx = {
    M, S, setKey, setMany, pend, setPend, recalc, odds, wire, trades, tmode, setTmode, now,
    show, go, goSync, openModal, closeModal, openPlayer, plProps, coachAsk, coachReq, setCoachReq,
    ctrades, setCtrades, setDealsDot, refs, setRefs, cmp, setCmp, alerts, commitData, revertData, runSync, syncBusy, syncMsg, setSyncMsg, EMBED, gcache,
    jobErr, retryJobs, tmodePref,
  };

  return (
    <AppCtx.Provider value={ctx}>
      <div className="wrap">
        <Header />
        <Dock tab={tab} onSelect={(t) => show(t)} onMore={() => (modal && modal.type === "more" ? closeModal() : openModal("more"))} dots={dots} />
        <main>
          {TAB_IDS.map((id) => {
            const Panel = PANELS[id];
            return (
              <section key={id} className="panel" id={"p-" + id} role="tabpanel" aria-labelledby={"t-" + id} hidden={tab !== id}>
                {visited.has(id) && <Panel active={tab === id} />}
              </section>
            );
          })}
        </main>
        <Footer />
      </div>
      <Overlays modal={modal} />
    </AppCtx.Provider>
  );
}

function Footer() {
  const { M } = useApp();
  const d = M.DATA, when = whenET(d.snapshot), fa = fmtET(d.faSnapshot || d.snapshot);
  return (
    <footer>
      <div>Data from {when}{d.source === "sync" ? " (synced)" : ""}. Week {d.currentWeek} scores were live at that moment and will have moved.</div>
      <div>Source: ESPN Fantasy API, league 1454450537. Rosters, scores, schedule and today's games as of {when}; free agents as of {fa}. Sync fresh data from Settings › Data. Recommendations only: moves still happen in ESPN. <a href="https://fantasy.espn.com/hockey/league?leagueId=1454450537" target="_blank" rel="noopener">Open the league on ESPN</a></div>
    </footer>
  );
}
