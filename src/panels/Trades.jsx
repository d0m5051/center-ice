/* Lineup strength table, trade finder (from the lineup worker) and trades the coach proposed. */
import { useApp } from "../ctx.js";
import { P, pv } from "../lib/model.js";
import { tradeQ } from "../lib/coach.js";
import { Chip, ConfPill, Loading } from "../components/ui.jsx";

const RkChip = ({ v, arr }) => { const r = arr.filter((x) => x > v + 1e-9).length + 1; return <span className={`rk ${r <= 3 ? "t" : r >= 8 ? "b" : "m"}`}>{r}</span>; };
const sg = (n) => (n >= 0 ? "+" : "") + n.toFixed(1);

export function FairMeter({ me, them }) {
  const tot = Math.abs(me) + Math.abs(them) || 1, v = (me - them) / tot, pos = Math.max(4, Math.min(96, 50 + v * 50));
  const lab = Math.abs(v) < 0.25 ? "Even" : v > 0 ? "Favors you" : "Favors them";
  return (
    <div className="fair" title="Your lineup gain against theirs. Deals that favor you heavily are less likely to be accepted.">
      <div className="fair-bar"><i style={{ left: pos + "%" }} /></div>
      <div className="fair-l"><span>Favors them</span><b>{lab}</b><span>Favors you</span></div>
    </div>
  );
}

function Strength() {
  const { M } = useApp();
  const { ids, strength, T, ME, GPW } = M;
  const groups = ["F", "D", "G", "total"], vals = Object.fromEntries(groups.map((g) => [g, ids.map((i) => strength[i][g])]));
  const rows = ids.slice().sort((a, b) => strength[b].total - strength[a].total);
  return (
    <div className="scroll"><table id="strength">
      <thead><tr><th className="l">Team</th><th>Forwards</th><th>Defense</th><th>Goalies</th><th>Total</th><th>ESPN rk</th></tr></thead>
      <tbody>{rows.map((i) => (
        <tr key={i} className={i === ME ? "me" : ""}>
          <td className="l"><div className="tm"><Chip id={i} /><div>{T[i].name}<small>{T[i].owner}</small></div></div></td>
          {groups.map((g) => <td key={g} className="num">{(strength[i][g] * GPW).toFixed(1)}<RkChip v={strength[i][g]} arr={vals[g]} /></td>)}
          <td className="num">{T[i].projRank}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

const Mini = ({ r }) => <>{r[P.nm]} <small>{r[P.pos]} · {pv(r).toFixed(2)}/gm</small></>;

export function Trades() {
  const { M, trades, tmode, setTmode, coachAsk, ctrades, setCtrades } = useApp();
  const { T, ME, ROS_OK, SCHED_OK, GPW } = M;
  const byId = (id) => M.DATA.players.find((r) => r[P.id] === id);
  const note = `One-for-one swaps where both players project within 0.3 points per game of each other (an easy sell) and both lineups improve. ${tmode === "ros" ? "Rest of season scores each lineup's per-game strength over the average team's remaining games. The sync has no ages or contracts, so this is a longer horizon, not a keeper model." : SCHED_OK ? "Win now scores the next 7 days from the real schedule." : "Win now scores a flat " + GPW.toFixed(1) + " games a week because the schedule is not loaded."} At most two ideas per club.`;
  const live = ctrades.map((t) => ({ ...t, s: t.send.map(byId), g: t.get.map(byId) })).filter((t) => T[t.o] && t.s.every((r) => r && r[P.tm] === ME) && t.g.every((r) => r && r[P.tm] === t.o));
  const seg = [["now", "Win now"], ["ros", "Rest of season"]];

  return (
    <>
      <div className="sec">
        <div className="sec-head"><h2>Lineup strength</h2><span className="note">Best legal lineup for each club (9 F, 5 D, 2 G, 1 UTIL, injured players out) scored with ESPN per-game projections, in projected points per week. Rank chips: green top 3, red bottom 3.</span></div>
        <Strength />
      </div>
      <div className="sec">
        <div className="sec-head"><h2>Trade finder</h2>
          <div className="seg" role="radiogroup" aria-label="Trade horizon">
            {seg.map(([v, l]) => {
              const off = v === "ros" && !ROS_OK;
              return <button key={v} type="button" role="radio" aria-checked={tmode === v} disabled={off} title={off ? "Needs the NHL schedule to reach at least 150 days ahead" : undefined}
                onClick={() => setTmode(v)}
                onKeyDown={(e) => { if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && ROS_OK) { e.preventDefault(); const n = tmode === "now" ? "ros" : "now"; setTmode(n); e.currentTarget.parentElement.querySelector(`[data-v="${n}"]`)?.focus(); } }}
                data-v={v} tabIndex={tmode === v ? 0 : -1}>{l}</button>;
            })}
          </div>
          <button className="btn ghost" type="button" onClick={() => coachAsk("Rank the trade finder's ideas for me. Which one would you actually send, which would the other manager most likely accept, and what tweak would make the best one better?")}>Ask the coach about these</button>
        </div>
        <p className="note">{note}</p>
        <div className="trades">
          {!trades ? <Loading job="lineup">Searching trades…</Loading> : trades.length ? trades.map((t) => {
            const r = M.tradeRec(t, tmode);
            return (
              <div className="trade" key={`${t.x[P.id]}-${t.y[P.id]}`}>
                <div className="trade-row">
                  <div className="side"><span className="eyebrow">You send</span><b>{t.x[P.nm]}</b><small>{t.x[P.pos]} · {t.x[P.pro]} · {pv(t.x).toFixed(2)}/gm</small></div>
                  <span className="swap">⇄</span>
                  <div className="side r"><span className="eyebrow">{T[t.o].name} sends</span><b>{t.y[P.nm]}</b><small>{t.y[P.pos]} · {t.y[P.pro]} · {pv(t.y).toFixed(2)}/gm</small></div>
                </div>
                <FairMeter me={t.me} them={t.them} />
                <div className="gain">
                  <span>You <b className="num gain-good">+{t.me.toFixed(1)}</b></span>
                  <span>Them <b className={`num ${t.them >= 0 ? "gain-good" : "muted"}`}>{sg(t.them)}</b></span>
                  <span>Why: {t.y[P.pos] === t.x[P.pos] ? "same position, better fit for your lineup" : `you turn ${t.x[P.pos]} depth into ${t.y[P.pos] === "G" ? "goaltending" : t.y[P.pos] === "D" ? "defense" : "forward"} help`}</span>
                </div>
                <div className="rec"><ConfPill c={r.conf} />{r.risk.length > 0 && <p className="why"><span className="risk">Watch: {r.risk.join("; ")}.</span></p>}</div>
                <div className="trade-act"><button className="btn ghost" type="button" onClick={() => coachAsk(tradeQ(M, [t.x], [t.y], t.o))}>Ask the coach</button></div>
              </div>
            );
          }) : <p className="note">No one-for-one swap improves both lineups right now.</p>}
        </div>
      </div>
      <div className="sec">
        <div className="sec-head"><h2>From the coach</h2><button className="btn ghost" type="button" onClick={() => coachAsk("Build me the best realistic trade you can find that the trade finder missed, including 2-for-1s. Target my weakest position.")}>Have the coach build one</button></div>
        <p className="note">Trades the coach proposes land here, scored with the same lineup model as the finder above. Ask the coach about any card to stress-test it.</p>
        <div className="trades">
          {live.length ? live.map((t) => {
            const sc = M.scoreDeal(t.s, t.g, t.o);
            return (
              <div className="trade coach-made" key={t.key}>
                <div className="trade-row">
                  <div className="side"><span className="eyebrow">You send</span><b>{t.s.map((r, i) => <span key={r[P.id]}>{i > 0 && <br />}<Mini r={r} /></span>)}</b></div>
                  <span className="swap">⇄</span>
                  <div className="side r"><span className="eyebrow">{T[t.o].name} sends</span><b>{t.g.map((r, i) => <span key={r[P.id]}>{i > 0 && <br />}<Mini r={r} /></span>)}</b></div>
                </div>
                <div className="gain">
                  <span>You <b className={`num ${sc.me >= 0 ? "gain-good" : "gain-bad"}`}>{sg(sc.me)}</b></span>
                  <span>Them <b className={`num ${sc.them >= 0 ? "gain-good" : "gain-bad"}`}>{sg(sc.them)}</b></span>
                  <span>{t.s.length}-for-{t.g.length} · proj pts/week</span>
                </div>
                <div className="trade-act">
                  <button className="btn ghost" type="button" onClick={() => setCtrades((cur) => cur.filter((x) => x.key !== t.key))}>Remove</button>
                  <button className="btn ghost" type="button" onClick={() => coachAsk(tradeQ(M, t.s, t.g, t.o))}>Ask the coach</button>
                </div>
              </div>
            );
          }) : <p className="note">Nothing yet. Ask the coach for a trade and it shows up here.</p>}
        </div>
      </div>
    </>
  );
}
