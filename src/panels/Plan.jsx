import { useApp } from "../ctx.js";
import { P, pv, isF, avail } from "../lib/model.js";
import { shortDay, keyAdd, fmtET } from "../lib/calendar.js";
import { InjPill, Pill, Tags } from "../components/ui.jsx";
import { Scout } from "./Scout.jsx";

function DayCell({ r, k }) {
  const { M } = useApp();
  const g = M.gameOn(r[P.pro], k);
  if (!g) return <td className="d off">–</td>;
  const b2b = M.playsOn(r[P.pro], keyAdd(k, -1));
  return <td className={`d g${b2b ? " b2b" : ""}`} title={b2b ? "Back-to-back, second night" : undefined}>{g[1] === "@" ? "@" : "vs"} {g[2]}</td>;
}

function Grids() {
  const { M, wire, plProps } = useApp();
  const { mine, PERIOD_DAYS, DATA, STARTS_OK, TG } = M;
  const ord = { C: 0, LW: 0, RW: 0, D: 1, G: 2 };
  const hd = PERIOD_DAYS.map((k) => <th key={k}>{shortDay(k)}</th>);
  const rows = mine.slice().sort((a, b) => (a[P.slot] === "IR") - (b[P.slot] === "IR") || ord[a[P.pos]] - ord[b[P.pos]] || pv(b) - pv(a));
  const fill = PERIOD_DAYS.map((k) => {
    const pl = mine.filter((r) => avail(r) && M.playsOn(r[P.pro], k)), F = pl.filter(isF).length, D = pl.filter((r) => r[P.pos] === "D").length, G = pl.filter((r) => r[P.pos] === "G").length;
    return 17 - (Math.min(F, 9) + Math.min(D, 5) + Math.min(G, 2) + Math.min(1, Math.max(F - 9, 0) + Math.max(D - 5, 0)));
  });
  const gl = [...mine.filter((r) => r[P.pos] === "G"), ...DATA.fa.filter((r) => r[P.pos] === "G" && avail(r)).sort((a, b) => pv(b) - pv(a)).slice(0, 6)];
  const fa = DATA.fa.filter(avail).map((r) => ({ r, e: M.dayVals(r).reduce((a, b) => a + b, 0), w: wire ? wire.find((x) => x.f === r) : null })).filter((x) => x.e > 0).sort((a, b) => b.e - a.e).slice(0, 10);
  const cnt = Object.keys(TG).map((ab) => [ab, M.gamesInDays(ab, M.TODAY_KEY, 7).length]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return <>
    <div className="sec">
      <div className="sec-head"><h2>Schedule</h2><span className="note">{shortDay(PERIOD_DAYS[0])} to {shortDay(PERIOD_DAYS[6])}, from the NHL schedule.</span></div>
      <div className="scroll"><table className="plan-t">
        <thead><tr><th className="l">Player</th>{hd}<th>Games</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r[P.id]} className={`clickable ${avail(r) ? "" : "unv"}`} {...plProps(r[P.id])}><td className="l">{r[P.nm]}<InjPill r={r} /><small className="blk">{r[P.pos]} · {r[P.pro]} · {r[P.slot]}</small></td>{PERIOD_DAYS.map((k) => <DayCell key={k} r={r} k={k} />)}<td className="num">{M.gLeft(r)}</td></tr>)}
          <tr><td className="l"><b>Open slots</b></td>{fill.map((n, i) => <td key={i} className="d num" style={{ color: n >= 4 ? "var(--warn)" : "var(--muted)" }}>{n}</td>)}<td /></tr>
        </tbody>
      </table></div>
      <p className="note">Blue cells are games. An amber underline marks the second night of a back-to-back. Open slots counts active spots (9 F, 5 D, 2 G, 1 UTIL) with nobody on your roster playing that day, which is where a streamer adds the most.</p>
    </div>
    <div className="sec">
      <div className="sec-head"><h3>Goalie starts</h3><span className="note">{STARTS_OK ? "Today's cells use ESPN's starter status. Other days use start share." : "ESPN's starter status is not for today, so every day uses start share."}</span></div>
      <div className="scroll"><table className="plan-t">
        <thead><tr><th className="l">Goalie</th><th>Share</th>{hd}<th>Exp. starts</th></tr></thead>
        <tbody>{gl.map((r) => {
          const sh = M.startShare(r); let exp = 0;
          const cells = PERIOD_DAYS.map((k, i) => {
            if (!M.playsOn(r[P.pro], k)) return <td key={k} className="d off">–</td>;
            let pr = sh == null ? null : sh, t = sh == null ? "?" : Math.round(sh * 100) + "%";
            if (i === 0 && STARTS_OK && r[P.gs]) { const g = r[P.gs]; pr = g === "CONFIRMED" ? 1 : g === "NOTSTARTING" ? 0 : g === "EXPECTED" ? 0.85 : pr; t = g === "CONFIRMED" ? "Starting" : g === "NOTSTARTING" ? "Not starting" : g === "EXPECTED" ? "Expected" : t; }
            exp += pr == null ? 0 : pr;
            const b2b = M.playsOn(r[P.pro], keyAdd(k, -1));
            return <td key={k} className={`d g${b2b ? " b2b" : ""}`}>{t}</td>;
          });
          return <tr key={r[P.id]} className="clickable" {...plProps(r[P.id])}><td className="l">{r[P.nm]}{r[P.tm] === M.ME && <> <Pill kind="blue">Yours</Pill></>}<small className="blk">{r[P.pro]} · {pv(r).toFixed(2)}/gm</small></td><td className="num">{sh == null ? "?" : Math.round(sh * 100) + "%"}</td>{cells}<td className="num">{exp.toFixed(1)}</td></tr>;
        })}</tbody>
      </table></div>
    </div>
    <div className="sec">
      <div className="sec-head"><h3>Streaming windows</h3><span className="note">Free agents ranked by projected points over the next 7 days.</span></div>
      <div className="scroll"><table>
        <thead><tr><th className="l">Free agent</th><th>Games</th><th>Exp. 7-day pts</th><th>Lineup gain</th><th>Owned</th></tr></thead>
        <tbody>{fa.map(({ r, e, w }) => <tr key={r[P.id]} className="clickable" {...plProps(r[P.id])}><td className="l">{r[P.nm]}<InjPill r={r} />{w && <Tags w={w} />}<small className="blk">{r[P.pos]} · {r[P.pro]}</small></td><td className="num">{M.gLeft(r)}</td><td className="num">{e.toFixed(1)}</td><td className="num" style={{ color: w && w.gain > 0.05 ? "var(--good)" : "var(--muted)" }}>{w && w.gain > 0.05 ? "+" + w.gain.toFixed(1) : "–"}</td><td className="num">{r[P.own]}%</td></tr>)}</tbody>
      </table></div>
    </div>
    <Opponent />
    <div className="sec">
      <div className="sec-head"><h3>Games by NHL team</h3><span className="note">Next 7 days. Green is 5 or more games, amber is 2 or fewer.</span></div>
      <div className="chips">{cnt.map(([ab, n]) => <span key={ab} className={`tchip ${n >= 5 ? "hi" : n <= 2 ? "lo" : ""}`}>{ab}<b>{n}</b></span>)}</div>
    </div>
  </>;
}

function Opponent() {
  const { M } = useApp();
  return (
    <div className="sec">
      <div className="sec-head"><h3>Your opponent</h3><span className="note">Week {M.CW} opponent, from data synced {fmtET(M.DATA.snapshot)}.</span></div>
      <Scout t={M.oppOf(M.CW, M.ME).opp} />
    </div>
  );
}

export function Plan() {
  const { M } = useApp();
  if (M.SCHED_OK) return <Grids />;
  return <>
    <div className="sec"><div className="sec-head"><h2>Schedule</h2><span className="note">The NHL schedule is not loaded, so there is nothing to show here yet. It loads on the next visit or sync.</span></div></div>
    <Opponent />
  </>;
}
