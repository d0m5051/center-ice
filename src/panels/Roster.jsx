import { useMemo, useState } from "react";
import { useApp } from "../ctx.js";
import { P, pv, isF, avail, OUTS, statline } from "../lib/model.js";
import { f1 } from "../lib/format.js";
import { keyLabel } from "../lib/calendar.js";
import { lsGet, lsSet } from "../lib/storage.js";
import { useWide } from "../hooks/useMedia.js";
import { InjPill, GameDot, Slot, Pill, Tile, StartPill } from "../components/ui.jsx";
import { OptBar } from "./Week.jsx";

const ORDER = { F: 0, C: 0, LW: 0, RW: 0, D: 1, G: 2, UTIL: 3, BN: 4, IR: 5 };
const GROUPS = [["Forwards", isF], ["Defense", (r) => r[P.pos] === "D"], ["Goalies", (r) => r[P.pos] === "G"]];

export function startsInfo(M) {
  const gl = [...M.DATA.players, ...M.DATA.fa].filter((r) => r[P.pos] === "G" && r[P.game]);
  const known = gl.filter((r) => r[P.gs]).sort((a, b) => (a[P.tm] === M.ME ? 0 : 1) - (b[P.tm] === M.ME ? 0 : 1) || (a[P.gs] === "CONFIRMED" ? 0 : 1) - (b[P.gs] === "CONFIRMED" ? 0 : 1) || a[P.pro].localeCompare(b[P.pro]));
  return { gl, known, none: gl.length - known.length, conf: known.filter((r) => r[P.gs] === "CONFIRMED").length };
}

function Detail({ r }) {
  const { M, wire, openPlayer } = useApp();
  if (!r) return <div className="card"><p className="note">Select a player to see his stats and replacement options.</p></div>;
  const mine = r[P.tm] === M.ME, reps = mine && wire ? wire.filter((w) => w.drop === r && w.gain > 0.05).slice(0, 5) : [];
  const gs = r[P.pos] === "G" && r[P.game] && r[P.gs];
  return (
    <div className="card">
      <div className="sec-head"><h3>{r[P.nm]}</h3><Slot s={r[P.slot]} /></div>
      <p className="note detail-sub">{r[P.pos]} · {r[P.pro]} · {M.T[r[P.tm]].name}{r[P.game] ? " · game today" : ""} <InjPill r={r} />{gs && <> <Pill kind={r[P.gs] === "CONFIRMED" ? "good" : r[P.gs] === "NOTSTARTING" ? "bad" : "warn"}>{r[P.gs] === "CONFIRMED" ? "Starting" : r[P.gs] === "NOTSTARTING" ? "Not starting" : "Start TBD"}</Pill></>}</p>
      <div className="tiles two">
        <Tile label="Proj / game" big={pv(r).toFixed(2)} sub={r[P.pa] > 0 ? "ESPN projection" : "estimated"} />
        <Tile label="To date" big={f1(r[P.std])} sub={`${r[P.gp]} GP`} />
        <Tile label="Last 7 avg" big={r[P.l7].toFixed(2)} sub="pts per game" />
        <Tile label="Owned" big={r[P.own] + "%"} sub="of ESPN leagues" />
      </div>
      <p className="statline">{statline(r)}</p>
      {mine && <>
        <p className="eyebrow sub-head">Free-agent replacements</p>
        {!wire ? <p className="note">Scoring free agents…</p> : reps.length ? <div className="plist">{reps.map((w) => <div className="pl" key={w.f[P.id]}><span className="pos">{w.f[P.pos]}</span><span className="nm">{w.f[P.nm]}<small>{w.f[P.pro]} · {pv(w.f).toFixed(2)}/gm</small></span><span className="num gain-good">+{w.gain.toFixed(1)}</span><span /></div>)}</div> : <p className="note">No free agent improves your lineup over him right now.</p>}
      </>}
      <button className="btn ghost open-pl" type="button" onClick={() => openPlayer(r[P.id])}>Full detail and compare</button>
    </div>
  );
}

export function Roster() {
  const { M, S, openPlayer, openModal } = useApp();
  const { ids, T, ME, strength, GPW } = M;
  const wide = useWide();
  const [team, setTeam] = useState(() => { const l = lsGet("ci-roster"); return S.rosterDefault === "last" && l && T[l] ? +l : ME; });
  const t = T[team] ? team : ME;
  const list = M.teamRows[t];
  const [sel, setSel] = useState(null);
  const rk = ids.slice().sort((a, b) => strength[b].total - strength[a].total).indexOf(t) + 1;
  const games = list.filter((r) => r[P.game] && avail(r)).length, inj = list.filter((r) => OUTS.includes(r[P.inj]) || r[P.inj] === "DAY_TO_DAY").length;
  const std = list.reduce((s, r) => s + r[P.std], 0);
  const mx = useMemo(() => Math.max(...M.DATA.players.map(pv)), [M]);
  const groups = GROUPS.map(([g, fn]) => [g, list.filter(fn).sort((a, b) => ORDER[a[P.slot]] - ORDER[b[P.slot]] || pv(b) - pv(a))]);
  const flat = groups.flatMap((g) => g[1]);
  const selRow = flat.find((r) => String(r[P.id]) === sel) || flat[0] || null;
  const I = startsInfo(M);
  const pick = (r) => { if (!wide) { openPlayer(r[P.id]); return; } setSel(String(r[P.id])); };

  return (
    <div className="sec">
      <div className="sec-head"><h2>{T[t].name}</h2><label className="eyebrow inline-ctl" htmlFor="teamSel">Team <select id="teamSel" value={t} onChange={(e) => { lsSet("ci-roster", e.target.value); setTeam(+e.target.value); setSel(null); }}>
        {ids.slice().sort((a, b) => (a === ME ? -1 : b === ME ? 1 : T[a].name.localeCompare(T[b].name))).map((i) => <option key={i} value={i}>{T[i].name}{i === ME ? " (you)" : ""}</option>)}
      </select></label></div>
      {t === ME && <div className="card"><OptBar /></div>}
      <div className="tiles">
        <Tile label="Lineup strength" big={(strength[t].total * GPW).toFixed(0)} sub={`proj pts/week · rank ${rk} of 10`} />
        <Tile label="Playing today" big={games} sub="healthy players with a game" />
        <Tile label="Injured or DTD" big={inj} bigStyle={{ color: inj ? "var(--bad)" : "var(--ink)" }} sub={`of ${list.length} rostered`} />
        <Tile label="Roster pts to date" big={f1(std)} sub="every player, bench included" />
      </div>
      <div className="tiles">
        <Tile label="Goalie starters" onClick={() => openModal("starts")} big={M.STARTS_OK ? I.conf : "–"}
          sub={M.STARTS_OK ? `confirmed of ${I.gl.length} goalies with a game today` : `status is from ${keyLabel(M.STARTS_KEY)}; sync to refresh`} />
      </div>
      <div className="roster">
        {groups.map(([g, l]) => (
          <div className="sec" key={g}>
            <div className="pos-head"><h3>{g}</h3><span className="eyebrow">{l.length} rostered</span></div>
            <div className="plist">{l.map((r) => (
              <div key={r[P.id]} className={`pl clickable${wide && selRow === r ? " sel" : ""}`} tabIndex={0} aria-pressed={wide ? selRow === r : undefined}
                onClick={() => pick(r)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(r); } }}>
                <Slot s={r[P.slot]} />
                <span className="nm">{r[P.nm]}<GameDot r={r} /><InjPill r={r} /><StartPill r={r} labels="starting-only" /><small>{r[P.pos]} · {r[P.pro]} · {r[P.own]}% owned</small><span className="statline">{statline(r)}</span></span>
                <span className="num stdt">{f1(r[P.std])} in {r[P.gp]}<br />L7 {r[P.l7].toFixed(2)}</span>
                <span className="proj"><span className="num">{r[P.pa] > 0 ? r[P.pa].toFixed(2) : "–"}</span><span className="mini-bar" style={{ width: (pv(r) / mx) * 100 + "%", opacity: r[P.pa] > 0 ? undefined : 0.35 }} /></span>
              </div>
            ))}</div>
          </div>
        ))}
      </div>
      {wide && <aside className="detail" aria-live="polite"><Detail r={selRow} /></aside>}
      <p className="note">Slot is today's ESPN lineup. Green dot: NHL game today. Right column is ESPN's projected points per game, with points to date and last-7 average beside it. Stat line for skaters is G-A, power-play points, shots, hits, blocks; for goalies W, saves, goals against, shutouts.</p>
    </div>
  );
}
