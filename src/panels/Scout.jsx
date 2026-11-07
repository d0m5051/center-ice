import { useApp } from "../ctx.js";
import { P, pv, OUTS } from "../lib/model.js";
import { pct } from "../lib/format.js";
import { InjPill } from "../components/ui.jsx";

const NM = { F: "Forwards", D: "Defense", G: "Goalies" };
const INJ_SHORT2 = (r) => (r[P.inj] === "DAY_TO_DAY" ? "DTD" : r[P.inj] === "SUSPENSION" ? "susp." : r[P.inj] === "INJURY_RESERVE" ? "IR" : "out");

export function Scout({ t }) {
  const { M, odds, plProps } = useApp();
  const { ids, strength, ME, GPW, T, st } = M;
  const rk = (g) => ids.filter((i) => strength[i][g] > strength[t][g] + 1e-9).length + 1;
  const ranks = ["F", "D", "G"].map((g) => [g, rk(g)]);
  const worst = ranks.slice().sort((a, b) => b[1] - a[1])[0], best = ranks.slice().sort((a, b) => a[1] - b[1])[0];
  const top = strength[t].starters.slice().sort((a, b) => pv(b) - pv(a)).slice(0, 6);
  const inj = M.teamRows[t].filter((r) => OUTS.includes(r[P.inj]) || r[P.inj] === "DAY_TO_DAY");
  return (
    <div className="card scout">
      <div className="sec-head"><h3>{T[t].name}</h3><span className="note">{T[t].owner} · {st[t].w}-{st[t].l} · {odds ? pct(odds[t].make) : "…"} playoff odds</span></div>
      <div className="scroll"><table>
        <thead><tr><th className="l">Group</th><th>You</th><th>Them</th><th>Their rank</th></tr></thead>
        <tbody>{["F", "D", "G"].map((g) => <tr key={g}><td className="l">{NM[g]}</td><td className="num">{(strength[ME][g] * GPW).toFixed(1)}</td><td className="num">{(strength[t][g] * GPW).toFixed(1)}</td><td className="num">{rk(g)} of {ids.length}</td></tr>)}</tbody>
      </table></div>
      <p className="note wide">Weakest: <b>{NM[worst[0]]}</b>, ranked {worst[1]} of {ids.length}. Strongest: <b>{NM[best[0]]}</b>, ranked {best[1]}. Projected points a week from ESPN per-game projections.</p>
      <div><span className="eyebrow">Projected lineup, top six by projection</span>
        <div className="plist scout-list">{top.map((r) => (
          <div className="pl pl-3 clickable" key={r[P.id]} {...plProps(r[P.id])}><span className="pos">{r[P.pos]}</span><span className="nm">{r[P.nm]}<InjPill r={r} /><small>{r[P.pro]}{M.SCHED_OK ? ` · ${M.gLeft(r)} games in 7 days` : ""}</small></span><span className="num">{pv(r).toFixed(2)}</span></div>
        ))}</div>
      </div>
      {inj.length > 0 && <p className="note wide">Injuries: {inj.map((r) => `${r[P.nm]} (${INJ_SHORT2(r)})`).join(", ")}.</p>}
    </div>
  );
}
