/* Waiver wire: free agents scored against your roster (scores come from the lineup worker). */
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../ctx.js";
import { P, pv, isF, OUTS, statline, lineupStrength } from "../lib/model.js";
import { f1 } from "../lib/format.js";
import { fmtET } from "../lib/calendar.js";
import { useWide } from "../hooks/useMedia.js";
import { InjPill, GameDot, Pill, Tags, RecBlock, RosLine, Side, Loading, StartPill } from "../components/ui.jsx";

const FILTERS = [["all", "All players"], ["F", "Forwards"], ["D", "Defense"], ["G", "Goalies"], ["game", "Playing today"]];
const match = (flt, f) => flt === "all" || (flt === "F" && isF(f)) || (flt === "D" && f[P.pos] === "D") || (flt === "G" && f[P.pos] === "G") || (flt === "game" && !!f[P.game]);

/* Best drops for a given add, scored on the main thread (one add, ~20 drops: cheap). */
function dropOptions(M, f) {
  const mine = M.mine, cand = mine.filter((r) => r[P.slot] !== "IR");
  if (!M.SCHED_OK) {
    const base = lineupStrength(mine).total;
    return cand.map((d) => ({ d, g: (lineupStrength([...mine.filter((r) => r !== d), f]).total - base) * M.GPW })).sort((a, b) => b.g - a.g).slice(0, 4);
  }
  const base = M.weekPlan(mine).total;
  return cand.map((d) => ({ d, g: M.weekPlan([...mine.filter((r) => r !== d), f]).total - base })).sort((a, b) => b.g - a.g).slice(0, 4);
}

export function GainLine({ w, lineup }) {
  const dp = pv(w.f) - pv(w.drop);
  return (
    <div className="gain">
      {lineup && <span>Lineup <b className="num gain-good">+{w.gain.toFixed(1)}</b> pts/wk</span>}
      <span>Proj <b className="num">{dp >= 0 ? "+" : ""}{dp.toFixed(2)}</b>/gm vs drop</span>
      <span>Owned <b className="num">{w.f[P.own]}%</b></span>
      {w.f[P.slot] === "WV" && <Pill kind="blue">Waivers</Pill>}
      <Tags w={w} /><RosLine w={w} />
    </div>
  );
}

function Detail({ w }) {
  const { M, openPlayer } = useApp();
  const opts = useMemo(() => (w ? dropOptions(M, w.f) : []), [M, w]);
  if (!w) return null;
  const up = w.gain > 0.05;
  return (
    <div className="card">
      <div className="sec-head"><h3>{w.f[P.nm]}</h3>{up ? <Pill kind="good">+{w.gain.toFixed(1)} pts/wk</Pill> : <Pill kind="warn">no upgrade</Pill>}</div>
      <div className="up-row"><Side r={w.f} label="Add" cls="add" /><span className="swap">⇄</span><Side r={w.drop} label="Drop" cls="drp r" /></div>
      <GainLine w={w} />
      <RecBlock w={w} />
      <p className="eyebrow sub-head">Drop options for this add</p>
      <div className="plist">{opts.map((o) => (
        <div className="pl" key={o.d[P.id]}><span className="pos">{o.d[P.pos]}</span><span className="nm">{o.d[P.nm]}<small>{o.d[P.pro]} · {pv(o.d).toFixed(2)}/gm</small></span>
          <span className={`num ${o.g > 0.05 ? "gain-good" : "blk"}`}>{o.g > 0.05 ? "+" + o.g.toFixed(1) : "–"}</span><span /></div>
      ))}</div>
      <button className="btn ghost open-pl" type="button" onClick={() => openPlayer(w.f[P.id])}>Full detail and compare</button>
    </div>
  );
}

export function Wire() {
  const { M, S, wire, openModal, openPlayer } = useApp();
  const wide = useWide();
  const [flt, setFlt] = useState(S.wireDefault);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(100);
  const [sel, setSel] = useState(null);
  const tbl = useRef(null);
  useEffect(() => { setFlt(S.wireDefault); setLimit(100); }, [S.wireDefault]);

  const d = M.DATA, nSk = d.fa.filter((r) => r[P.pos] !== "G").length, nG = d.fa.filter((r) => r[P.pos] === "G").length;
  const src = `${nSk} available skaters${nG ? ` and ${nG} goalies` : ""} from ESPN (free agents and waivers), most owned first, as of ${fmtET(d.faSnapshot || d.snapshot)}${(d.faSnapshot || d.snapshot) < d.snapshot ? " (older than the rosters; anyone since rostered is removed)" : ""}.`;
  const ql = q.trim().toLowerCase();
  const list = wire ? wire.filter((w) => (!ql || w.f[P.nm].toLowerCase().includes(ql)) && !(S.hideInjFA && OUTS.includes(w.f[P.inj])) && match(flt, w.f)) : [];
  const selW = wire ? wire.find((x) => String(x.f[P.id]) === sel) || wire.find((x) => x.gain > 0.05) || wire[0] : null;
  const pick = (w) => { if (!wide) { openPlayer(w.f[P.id]); return; } setSel(String(w.f[P.id])); };
  const top = wire && wire[0], ups = wire ? wire.filter((w) => w.gain > 0.05).length : 0;

  return (
    <div className="sec">
      <div className="sec-head"><h2>Waiver wire</h2>
        <label className="eyebrow inline-ctl" htmlFor="wirePos">Show <select id="wirePos" value={flt} onChange={(e) => { setFlt(e.target.value); setLimit(100); }}>{FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <input id="wireQ" type="search" placeholder="Search players" aria-label="Search players" autoComplete="off" value={q} onChange={(e) => { setQ(e.target.value); setLimit(100); }} />
      </div>
      <p className="note">{src} Each one is tested against your roster: the gain is how much your best lineup improves in projected points per week if you add him and drop the player listed. You get 1 add per matchup, so spend it on the biggest number. Waiver players clear Sunday at 8:00.</p>
      {!wire ? <Loading>Scoring free agents against your roster…</Loading> : <>
        <div className="tiles">
          {top && <button type="button" className="tile tile-btn" onClick={() => openModal("up")}><span className="eyebrow">Best add</span><span className="big big-name">{top.f[P.nm]}</span><span className="sub">+{top.gain.toFixed(1)} pts/wk, drop {top.drop[P.nm]}</span></button>}
          <button type="button" className="tile tile-btn" onClick={() => openModal("up")}><span className="eyebrow">Upgrades available</span><span className="big num">{ups}</span><span className="sub">of {wire.length} improve your lineup</span></button>
          <button type="button" className="tile tile-btn" onClick={() => { setFlt("game"); setLimit(100); tbl.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}><span className="eyebrow">Playing today</span><span className="big num">{wire.filter((w) => w.f[P.game]).length}</span><span className="sub">available players with a game</span></button>
        </div>
        <div className="scroll" ref={tbl}><table id="wire">
          <thead><tr><th className="l">Player</th><th>Gain/wk</th><th className="l">Drop</th><th>Proj/gm</th><th>To date</th><th>L7</th><th>Owned</th></tr></thead>
          <tbody>
            {list.slice(0, limit).map((w) => { const f = w.f, on = wide && selW === w; return (
              <tr key={f[P.id]} className={`clickable${on ? " sel" : ""}`} tabIndex={0} aria-selected={wide ? on : undefined}
                onClick={() => pick(w)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(w); } }}>
                <td className="l"><div className="tm"><div>{f[P.nm]}<GameDot r={f} /><InjPill r={f} />{f[P.slot] === "WV" && <> <Pill kind="blue">Waivers</Pill></>}<StartPill r={f} /><Tags w={w} /><small>{f[P.pos]} · {f[P.pro]} · {statline(f)}</small></div></div></td>
                <td className={`num ${w.gain > 0.05 ? "gain-good" : "blk"}`}>{w.gain > 0.05 ? "+" + w.gain.toFixed(1) : "–"}</td>
                <td className="l">{w.gain > 0.05 ? <>{w.drop[P.nm]}<small className="blk">{w.drop[P.pos]} · {pv(w.drop).toFixed(2)}/gm</small></> : <span className="blk">no upgrade</span>}</td>
                <td className="num">{f[P.pa] > 0 ? f[P.pa].toFixed(2) : "–"}</td><td className="num">{f1(f[P.std])} <small className="muted">/{f[P.gp]}</small></td><td className="num">{f[P.l7].toFixed(2)}</td><td className="num">{f[P.own]}%</td>
              </tr>
            ); })}
            {!list.length && <tr><td className="l wrap-cell muted" colSpan={7}>{flt === "G" ? "No goalies loaded yet (see below)." : "Nothing matches this filter."}</td></tr>}
            {list.length > limit && <tr><td className="l" colSpan={7}><button className="btn ghost" type="button" onClick={() => setLimit((n) => n + 150)}>Show more ({list.length - limit} left)</button></td></tr>}
          </tbody>
        </table></div>
        {wide && <aside className="detail" aria-live="polite"><Detail w={selW} /></aside>}
      </>}
      <p className="note">{nG ? "Goalies are scored the same way: a goalie only shows a gain if he'd beat one of your two starting goalies on projection." : "No free-agent goalies loaded yet. The next sync with the Grab ESPN bookmark adds every available goalie."}</p>
    </div>
  );
}
