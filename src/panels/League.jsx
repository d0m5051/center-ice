import { useMemo, useState } from "react";
import { useApp } from "../ctx.js";
import { expSeed } from "../lib/model.js";
import { DEF } from "../lib/settings.js";
import { f1, pct } from "../lib/format.js";
import { Chip, Tile, Loading } from "../components/ui.jsx";
import { Scout } from "./Scout.jsx";

function Standings() {
  const { M, odds } = useApp();
  const { ranked, T, ME, CW, mean } = M;
  const [sort, setSort] = useState({ k: null, dir: -1 });
  const cols = useMemo(() => [
    { k: "rank", l: "#", v: (t) => ranked.indexOf(t) + 1, f: (x) => x },
    { k: "team", l: "Team", v: (t) => T[t.id].name.toLowerCase(), cls: "l" },
    { k: "wl", l: "W-L", v: (t) => t.w - t.l + t.pf / 1e4, f: (x, t) => `${t.w}-${t.l}` },
    { k: "pf", l: "PF", v: (t) => t.pf, f: f1 },
    { k: "pa", l: "PA", v: (t) => t.pa, f: f1 },
    { k: "live", l: "Wk " + CW, v: (t) => t.wk[CW] || 0, f: f1 },
    { k: "ap", l: "All-play", v: (t) => t.ap[0] + t.apLive[0], f: (x, t) => `${t.ap[0] + t.apLive[0]}-${t.ap[1] + t.apLive[1]}` },
    { k: "odds", l: "Playoff", v: (t) => (odds ? odds[t.id].make : 0), f: (x) => (odds ? pct(x) : "…") },
    { k: "mean", l: "Proj/wk", v: (t) => mean[t.id], f: (x) => x.toFixed(0) },
    { k: "fin", l: "Proj finish", v: (t) => (odds ? -expSeed(odds, t.id) : 0), f: (x, t) => (odds ? expSeed(odds, t.id).toFixed(1) : "…") },
    { k: "proj", l: "ESPN rk", v: (t) => -T[t.id].projRank, f: (x, t) => T[t.id].projRank },
    { k: "wv", l: "Waiver", v: (t) => -T[t.id].waiver, f: (x, t) => T[t.id].waiver },
  ], [ranked, T, CW, mean, odds]);
  const rows = ranked.slice();
  if (sort.k) { const c = cols.find((c) => c.k === sort.k); rows.sort((a, b) => { const x = c.v(a), y = c.v(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; }); }
  const onSort = (k) => setSort((s) => (k === "rank" ? { k: null, dir: -1 } : s.k === k ? { k, dir: -s.dir } : { k, dir: k === "team" ? 1 : -1 }));
  return (
    <div className="scroll"><table id="standings">
      <thead><tr>{cols.map((c) => (
        <th key={c.k} className={`sortable ${c.cls || ""}`} scope="col" aria-sort={sort.k === c.k ? (sort.dir < 0 ? "descending" : "ascending") : undefined}>
          <button type="button" onClick={() => onSort(c.k)}>{c.l}</button>
        </th>
      ))}</tr></thead>
      <tbody>{rows.map((t) => {
        const rk = ranked.indexOf(t) + 1;
        return (
          <tr key={t.id} className={`${t.id === ME ? "me" : ""} ${!sort.k && rk === 4 ? "cut" : ""}`}>
            {cols.map((c) => c.k === "team"
              ? <td key={c.k} className="l"><div className="tm"><Chip id={t.id} /><div>{T[t.id].name}<small>{T[t.id].owner}</small></div></div></td>
              : <td key={c.k} className="num">{c.f(c.v(t), t)}</td>)}
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

function SeedChart({ s }) {
  const W = 600, H = 190, pl = 36, pb = 26, pt = 12, bw = (W - pl - 10) / 10, mxs = Math.max(...s.slice(1), 0.05), top = Math.ceil(mxs * 10) / 10;
  const mono = { fontFamily: "IBM Plex Mono, monospace" };
  return (
    <svg viewBox="0 0 600 190" width="100%" role="img" aria-label={`Seed distribution: ${s.slice(1, 11).map((v, k) => `seed ${k + 1} ${Math.round(v * 100)}%`).join(", ")}`}>
      {[0, 1, 2, 3, 4].map((k) => { const v = (top * k) / 4, y = H - pb - ((H - pb - pt) * k) / 4; return <g key={k}><line x1={pl} x2={W - 6} y1={y} y2={y} stroke="var(--line)" strokeWidth="1" /><text x={pl - 6} y={y + 4} textAnchor="end" fontSize="11" fill="var(--muted)" style={mono}>{Math.round(v * 100)}%</text></g>; })}
      {Array.from({ length: 10 }, (_, i) => i + 1).map((k) => {
        const v = s[k], h = ((H - pb - pt) * v) / top, x = pl + (k - 1) * bw + 4, y = H - pb - h;
        return <g key={k}>
          <rect x={x} y={y} width={bw - 8} height={Math.max(h, 0)} rx="2" fill={k <= 4 ? "var(--good)" : "var(--muted)"} opacity={k <= 4 ? 1 : 0.45} />
          <text x={x + (bw - 8) / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--ink)" style={mono}>{k}</text>
          {v > 0.02 && <text x={x + (bw - 8) / 2} y={y - 4} textAnchor="middle" fontSize="10.5" fill="var(--muted)" style={mono}>{Math.round(v * 100)}</text>}
        </g>;
      })}
      <line x1={pl + 4 * bw} x2={pl + 4 * bw} y1={pt} y2={H - pb} stroke="var(--goal)" strokeWidth="2" strokeDasharray="4 3" />
      <text x={pl + 4 * bw + 5} y={pt + 10} fontSize="11" fill="var(--goal)" style={mono}>cut</text>
    </svg>
  );
}

function Odds() {
  const { M, odds, S } = useApp();
  const { ME, ids, T, DATA } = M;
  const seedHead = <div className="sec-head"><h3>Your final-seed distribution</h3><span className="note">Share of simulated seasons ending at each seed.</span></div>;
  if (!odds) return <>
    <div className="sec"><div className="sec-head"><h2>Playoff odds</h2><span className="note">Simulating {S.sims.toLocaleString()} seasons…</span></div><Loading job="odds">Running the playoff simulation in the background.</Loading></div>
    <div className="sec">{seedHead}<div className="card"><Loading job="odds" /></div></div>
  </>;
  const o = odds[ME], s = o.seeds, best = s.indexOf(Math.max(...s.slice(1)));
  const rivals = ids.filter((i) => i !== ME).sort((a, b) => Math.abs(odds[a].make - o.make) - Math.abs(odds[b].make - o.make)).slice(0, 2);
  return <>
    <div className="sec">
      <div className="sec-head"><h2>Playoff odds</h2><span className="note">{S.sims.toLocaleString()} simulated seasons on the real remaining schedule.</span></div>
      <div className="tiles">
        <Tile label="Your playoff odds" big={pct(o.make)} bigStyle={{ color: "var(--goal)" }} sub="top 4 of 10" />
        <Tile label="Projected record" big={`${o.wins.toFixed(1)}-${(DATA.regWeeks - o.wins).toFixed(1)}`} sub="over 23 weeks" />
        <Tile label="Most likely seed" big={best} sub={`${pct(s[best])} of seasons`} />
        <div className="tile"><span className="eyebrow">Closest rivals</span><span className="big big-text">{rivals.map((r) => T[r].ab).join(" · ")}</span><span className="sub">nearest playoff odds to yours</span></div>
      </div>
    </div>
    <div className="sec">{seedHead}<div className="card"><SeedChart s={s} /></div></div>
  </>;
}

function Strengths() {
  const { M } = useApp();
  const { ids, strength, ME, GPW } = M;
  return (
    <div className="card"><div className="bars">{[["F", "Forwards"], ["D", "Defense"], ["G", "Goalies"], ["total", "Total"]].map(([g, l]) => {
      const vals = ids.map((i) => strength[i][g] * GPW), mx = Math.max(...vals), avg = vals.reduce((a, b) => a + b, 0) / vals.length, me = strength[ME][g] * GPW, rk = vals.filter((v) => v > me + 1e-9).length + 1;
      return <div className="bar me" key={g}><span className="lab">{l} · rank {rk}</span>
        <span className="track"><i style={{ width: (me / mx) * 100 + "%", background: "var(--blue)" }} /><b className="tickm" style={{ left: (avg / mx) * 100 + "%" }} title={`League average ${avg.toFixed(1)}`} /></span>
        <span className="val">{me.toFixed(0)} <small style={{ color: me >= avg ? "var(--good)" : "var(--bad)" }}>{me >= avg ? "+" : ""}{(me - avg).toFixed(0)}</small></span></div>;
    })}</div></div>
  );
}

function Path() {
  const { M } = useApp();
  const { DATA, ME, T, CW, mean } = M;
  let fav = 0, flip = 0, dog = 0, exp = 0;
  const weeks = [];
  for (let w = 1; w <= DATA.regWeeks; w++) {
    const o = M.oppOf(w, ME), done = w < CW, now = w === CW;
    const p = now ? M.liveWin() : done ? (o.me > o.them ? 1 : 0) : M.winProb(ME, o.opp);
    if (!done && !now) { exp += p; p >= 0.55 ? fav++ : p <= 0.45 ? dog++ : flip++; }
    const col = p >= 0.55 ? "var(--good)" : p <= 0.45 ? "var(--bad)" : "var(--warn)";
    const res = done ? `${o.me > o.them ? "W" : "L"} ${f1(o.me)}–${f1(o.them)}` : now ? `Live ${f1(o.me)}–${f1(o.them)}` : `${pct(p)} win`;
    weeks.push(<div key={w} className={`wk ${done ? (o.me > o.them ? "w" : "l") : ""} ${now ? "now" : ""}`} title={T[o.opp].name}><span className="wn">WK {w} · {o.home ? "HOME" : "AWAY"}</span><span className="op">{o.home ? "vs" : "@"} {T[o.opp].ab}</span><span className="res num">{res}</span><span className="wp" style={{ width: p * 100 + "%", background: col }} /></div>);
  }
  const cnt = {}; for (let w = 1; w <= DATA.regWeeks; w++) { const o = M.oppOf(w, ME).opp; cnt[o] = (cnt[o] || 0) + 1; }
  return <>
    <div className="sec">
      <div className="sec-head"><h2>Your 23-week path</h2><span className="note">Bottom stripe is the model's win chance each week: green favored, amber coin flip, red underdog.</span></div>
      <div className="tiles">
        <Tile label="Favored weeks left" big={fav} bigStyle={{ color: "var(--good)" }} sub="model win chance ≥ 55%" />
        <Tile label="Coin flips" big={flip} bigStyle={{ color: "var(--warn)" }} sub="45–55%" />
        <Tile label="Underdog weeks" big={dog} bigStyle={{ color: "var(--bad)" }} sub="≤ 45%" />
        <Tile label={`Expected wins, wk ${CW + 1}+`} big={exp.toFixed(1)} sub={`of ${DATA.regWeeks - CW}`} />
      </div>
      <div className="weeks">{weeks}</div>
    </div>
    <div className="sec">
      <div className="sec-head"><h3>Opponent count</h3><span className="note">How many times you face each club.</span></div>
      <div className="bars">{Object.entries(cnt).sort((a, b) => b[1] - a[1] || mean[b[0]] - mean[a[0]]).map(([id, n]) => (
        <div className="bar" key={id}><span className="lab">{T[id].name}</span><span className="track"><i style={{ width: (n / 3) * 100 + "%", background: T[id].c }} /></span><span className="val">{n}× · {pct(M.winProb(ME, +id))}</span></div>
      ))}</div>
    </div>
  </>;
}

export function League() {
  const { M, S } = useApp();
  const { ids, ME, T, CW, DATA } = M;
  const opp = M.oppOf(CW, ME).opp;
  const [scout, setScout] = useState(opp);
  return <>
    <div className="sec">
      <div className="sec-head"><h2>League</h2><span className="note">Wins first, then total points (the league's playoff tiebreak). Red line is the top-4 cut. Tap a header to sort. All-play is each week's score against all nine others; Proj/wk is the model's weekly mean.</span></div>
      <Standings />
    </div>
    <Odds />
    <div className="sec">
      <div className="sec-head"><h2>League strengths</h2><span className="note">Best lineup by position group in projected points a week. The line is the league average.</span></div>
      <Strengths />
    </div>
    <div className="sec">
      <div className="sec-head"><h2>Scout a club</h2><label className="eyebrow inline-ctl" htmlFor="scoutSel">Club <select id="scoutSel" value={scout} onChange={(e) => setScout(+e.target.value)}>
        {ids.filter((i) => i !== ME).sort((a, b) => T[a].name.localeCompare(T[b].name)).map((i) => <option key={i} value={i}>{T[i].name}{i === opp ? " (this week)" : ""}</option>)}
      </select></label></div>
      <Scout t={scout} />
      <p className="note">The sync has no transaction history, so there is no transaction log here.</p>
    </div>
    <Path />
    <div className="sec">
      <div className="sec-head"><h2>Scoring sheet</h2><span className="note">Head-to-head points, 23 regular-season weeks, top 4 make the playoffs. 1 add per matchup; waivers clear Sunday 8:00, 24h hold.</span></div>
      <div className="rules">{DATA.scoring.map(([n, p]) => <div className="rule" key={n}><span>{n}</span><span className={`num${p < 0 ? " neg" : ""}`}>{p > 0 ? "+" : ""}{p}</span></div>)}</div>
      <div className="note">Active lineup: 9 F, 5 D, 2 G, 1 UTIL. Bench 5, IR 2. Stats worth 0 in this league (plus/minus, PIM, GWG and so on) are left off.</div>
    </div>
    <div className="sec card">
      <h3>How the model works</h3>
      <p className="note">Each team gets a weekly scoring mean that blends roster strength ({S.projW}%: each club's best lineup scored with ESPN per-game projections) with points scored so far ({100 - S.projW}%), then every remaining matchup on the real schedule is played {S.sims.toLocaleString()} times with a {S.sd}-point weekly spread. Week {CW} is finished from the live margin. Two weeks of data is thin, so the projection side should carry most of the weight early; lower it in Settings as weeks accumulate.{["projW", "sd", "gpw", "sims"].some((k) => S[k] !== DEF[k]) ? " You're running custom model settings." : ""}</p>
    </div>
  </>;
}
