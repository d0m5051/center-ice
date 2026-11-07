import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppCtx, useApp } from "./ctx.js";
import { buildModel, SEASON } from "./lib/model.js";
import { applyLook, watchSystemTheme } from "./lib/look.js";
import { saveSettings, MODEL_KEYS, coerce } from "./lib/settings.js";
import { lsGet, lsSet, ssGet, ssSet, ssDel, idbSet, idbDel } from "./lib/storage.js";
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
  const [tmode, setTmodeState] = useState(() => { const m = lsGet("ci-tmode"); return m === "ros" ? "ros" : "now"; });
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

  /* ---- heavy jobs (workers) ---- */
  const [odds, setOdds] = useState(null);
  const [wire, setWire] = useState(null);
  const [trades, setTrades] = useState(null);
  const [jobErr, setJobErr] = useState(null);
  const workerIn = useMemo(() => ({ raw: data, S: { gpw: S.gpw, sd: S.sd, projW: S.projW, sims: S.sims }, gcache, now: modelNow }), [M, S.sims]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = `${data.snapshot}|${data.faSnapshot}|${data.source}|${gcache && gcache.t}|${S.gpw}|${S.sd}|${S.projW}|${modelNow}`;

  useEffect(() => {
    setOdds(null);
    simClient.run(workerIn).then((r) => setOdds(r.odds), (e) => { if (!e.superseded) setJobErr("Playoff odds failed: " + e.message); });
  }, [workerIn]);

  const wireRef = useRef(null);
  useEffect(() => {
    setWire(null); wireRef.current = null; setTrades(null);
    lineupClient.run({ ...workerIn, key, tmode, wire: true, trades: true }).then((r) => {
      const w = unpackWire(M, r.wire); wireRef.current = w; setWire(w); setTrades(unpackTrades(M, r.trades));
    }, (e) => { if (!e.superseded) setJobErr("Lineup scoring failed: " + e.message); });
  }, [workerIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstTmode = useRef(true);
  useEffect(() => {
    if (firstTmode.current) { firstTmode.current = false; return; }
    setTrades(null);
    const needWire = !wireRef.current;
    lineupClient.run({ ...workerIn, key, tmode, wire: needWire, trades: true }).then((r) => {
      if (needWire) { const w = unpackWire(M, r.wire); wireRef.current = w; setWire(w); }
      setTrades(unpackTrades(M, r.trades));
    }, (e) => { if (!e.superseded) setJobErr("Trade search failed: " + e.message); });
  }, [tmode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- persistence helpers ---- */
  const setTmode = useCallback((m) => { lsSet("ci-tmode", m); setTmodeState(m); }, []);
  const setCtrades = useCallback((fn) => setCtradesState((cur) => { const next = typeof fn === "function" ? fn(cur) : fn; idbSet("ci-coach-trades", next); return next; }), []);
  const setCmp = useCallback((next) => { ssSet("ci-cmp", JSON.stringify(next)); setCmpState(next); }, []);
  const refsAt = useRef(boot.refsAt || "");
  const setRefs = useCallback(async (next) => {
    const savedAt = new Date().toISOString(); refsAt.current = savedAt;
    setRefsState(next);
    const ok = await idbSet("ci-refs", { savedAt, refs: next });
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

  /* ---- data ---- */
  const commitData = useCallback(async (res) => {
    const ok = await idbSet("ci-data", res.D);
    const rok = await remoteSet("snapshots/latest", { snapshot: res.D.snapshot, faSnapshot: res.D.faSnapshot || null, savedAt: new Date().toISOString(), json: JSON.stringify(res.D) });
    if (!ok && !rok) throw new Error("Parsed fine, but this browser blocked saving it, so it can't be applied.");
    if (res.D.games && res.D.games.length) { const gc = { t: Date.now(), season: SEASON, g: res.D.games }; idbSet("ci-games", gc); setGcache(gc); }
    setData(res.D);
    setSyncMsg({ cls: "ok", text: `Synced: ${res.summary}.${res.notes.length ? " " + res.notes.join(" ") : ""}${rok ? "" : " Saved on this device only."}` });
  }, []);
  const revertData = useCallback(async () => {
    await idbDel("ci-data"); await remoteDel("snapshots/latest");
    setData(EMBED); setSyncMsg({ cls: "ok", text: "Using the snapshot this page shipped with." });
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
    fetchSchedule().then((sc) => { if (!sc.games.length) return; const gc = { t: Date.now(), season: SEASON, g: sc.games }; idbSet("ci-games", gc); setGcache(gc); }).catch(() => {});
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
    M, S, setKey, setMany, pend, setPend, recalc, odds, wire, trades, jobErr, tmode, setTmode, now,
    show, go, goSync, openModal, closeModal, openPlayer, plProps, coachAsk, coachReq, setCoachReq,
    ctrades, setCtrades, setDealsDot, refs, setRefs, cmp, setCmp, alerts, commitData, revertData, syncMsg, setSyncMsg, EMBED, gcache,
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
