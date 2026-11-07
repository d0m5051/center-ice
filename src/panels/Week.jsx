import { useApp } from "../ctx.js";
import { P, pv } from "../lib/model.js";
import { f1, pct, ncdf } from "../lib/format.js";
import { fmtET, keyLabel, whenET, weeksAhead, thisMondayLabel } from "../lib/calendar.js";
import { Chip, Pill, ConfPill, Loading, BOLT } from "../components/ui.jsx";

export function OptBar() {
  const { M, now, openModal } = useApp();
  return (
    <div className="optbar">
      <div className="optinfo"><span className="eyebrow">Today's lineup</span><span className="lock">{M.lockText(now)}</span></div>
      <button className="btn opt" type="button" onClick={() => openModal("opt")}>{BOLT}Optimize</button>
    </div>
  );
}

function Stale() {
  const { M, goSync } = useApp();
  const d = M.DATA, ahead = weeksAhead(new Date(d.snapshot));
  if (!(ahead > 0 && d.currentWeek < d.regWeeks)) return null;
  const nowWk = Math.min(d.regWeeks, d.currentWeek + ahead), when = whenET(d.snapshot);
  return (
    <div className="stale">
      <div><b>Week {nowWk} is underway. This page still shows week {d.currentWeek}.</b>
        <span> Data is from {when}, so week {d.currentWeek}'s scores below aren't final and week {nowWk}'s matchup, lineups and odds aren't loaded. Week {nowWk} started {thisMondayLabel()}. Sync to pull the current week from ESPN.</span></div>
      <button className="btn" type="button" onClick={goSync}>Sync now</button>
    </div>
  );
}

function TopMoves() {
  const { M, wire, trades, tmode, go, show } = useApp();
  const A = [], worst = (c) => (c === "Low" ? 0 : c === "Medium" ? 1 : 2);
  try {
    const pl = M.optPlan();
    if (pl.moves.length) {
      const recs = pl.moves.map((m) => M.todayRec(m.r)), c = ["Low", "Medium", "High"][Math.min(...recs.map((r) => worst(r.c)))];
      A.push({ tag: "Lineup", t: `Set your lineup: ${pl.moves.length} change${pl.moves.length > 1 ? "s" : ""}`, d: `About +${pl.gain.toFixed(1)} projected pts today. Start ${pl.moves.slice(0, 2).map((m) => m.r[P.nm]).join(", ")}${pl.moves.length > 2 ? " and more" : ""}.`, c, go: "opt" });
    }
  } catch {}
  const w = wire && wire[0];
  if (w && w.gain > 0.5) { const r = M.recInfo(w); A.push({ tag: "Add / drop", t: `Add ${w.f[P.nm]}, drop ${w.drop[P.nm]}`, d: `+${w.gain.toFixed(1)} projected pts over the next 7 days. ${r.why[0]}.`, c: r.conf, go: "up" }); }
  const t = trades && trades[0];
  if (t) { const r = M.tradeRec(t, tmode); A.push({ tag: "Trade", t: `Offer ${t.x[P.nm]} for ${t.y[P.nm]}`, d: `${M.T[t.o].name} · you ${t.me >= 0 ? "+" : ""}${t.me.toFixed(1)}, them ${t.them >= 0 ? "+" : ""}${t.them.toFixed(1)} projected pts.`, c: r.conf, go: "deals" }); }
  const lw = M.liveWin();
  return (
    <div className="sec" id="top-sec">
      <div className="sec-head"><h2>Top moves</h2><span className="note">{lw == null ? "" : `${pct(lw)} to win week ${M.CW} on the live margin`}</span></div>
      <div className="acts">
        {A.length ? A.slice(0, 3).map((a) => (
          <button key={a.tag} type="button" className="act" onClick={() => (a.go === "deals" ? show("deals") : go(a.go))}>
            <span className="eyebrow">{a.tag}</span><b>{a.t}</b><span className="note wide">{a.d}</span><ConfPill c={a.c} />
          </button>
        )) : !wire ? <Loading job="lineup">Scoring free agents and trades…</Loading> : <p className="note">Nothing to do right now. Lineup, wire and trades have no moves worth making.</p>}
      </div>
    </div>
  );
}

function Ticker() {
  const { M } = useApp();
  const L = M.tickerItems();
  return (
    <div className="sec" id="tick-sec">
      <div className="sec-head"><h2>Roster feed</h2><span className="note">Built from your last sync: injury status, goalie starters and last-7 form. It is not a news feed, because this page has no news source.</span></div>
      <div className="tick">
        {L.length ? L.map((x, i) => <span className="tk" key={i}><Pill kind={x[1]}>{x[2]}</Pill>{x[3]}</span>) : <span className="note">No injuries, goalie changes or form swings on your roster.</span>}
      </div>
    </div>
  );
}

function Today() {
  const { M } = useApp();
  const t = M.todayPlan(M.ME), notes = [];
  t.wasted.forEach((r) => notes.push(`${r[P.nm]} has a game today but isn't the confirmed starter, so he scores nothing from the G slot.`));
  t.irGame.forEach((r) => notes.push(`${r[P.nm]} is on your IR and his team plays today. Check whether he's been activated.`));
  M.mine.filter((r) => r[P.pos] === "G" && r[P.gs] === "CONFIRMED").forEach((r) => notes.push(`${r[P.nm]} is the confirmed starter for ${r[P.pro]} today.`));
  const d = M.DATA;
  const note = `From your ESPN roster as of ${fmtET(d.snapshot)}. ${M.GAMES.length ? `Game days come from the NHL schedule (today is ${keyLabel(M.TODAY_KEY)}).` : M.SNAP_KEY !== M.TODAY_KEY ? `Game flags are for ${keyLabel(M.SNAP_KEY)}. Sync to load the NHL schedule.` : ""} Lineups lock per game, so a swap only counts until that player's game starts.`;
  return (
    <div className="sec" id="today-sec">
      <div className="sec-head"><h2>Today's lineup check</h2><span className="note">{note}</span></div>
      <div className="card today" id="today">
        <OptBar />
        {t.start.length ? <>
          <div className="sec-head"><h3>Start {t.start.length} benched player{t.start.length > 1 ? "s" : ""}</h3><Pill kind="good">about +{t.gain.toFixed(1)} projected pts</Pill></div>
          <div className="moves">
            {t.start.map((r) => <div className="move" key={r[P.id]}><span className="arrow">IN</span><span>{r[P.nm]}<small>{r[P.pos]} · {r[P.pro]} plays today · {r[P.pa] > 0 ? r[P.pa].toFixed(2) + " proj/gm" : "no ESPN projection"}</small></span><span className="slot bn">BN</span></div>)}
          </div>
          <p className="note">Make room by benching any of these starters who have no game today: {t.idle.filter((r) => r[P.pos] !== "G").sort((a, b) => pv(a) - pv(b)).map((r) => r[P.nm]).join(", ")}. Benching them costs nothing today.</p>
        </> : <><h3>Lineup is set</h3><p className="note">Every healthy player with a game today is already in an active slot.</p></>}
        {notes.length > 0 && <div className="statline notes">{notes.map((n, i) => <span key={i}>{n}</span>)}</div>}
      </div>
    </div>
  );
}

function GameCard({ g, live }) {
  const { M } = useApp();
  const [h, a, hp, ap] = g, tot = hp + ap || 1, me = h === M.ME || a === M.ME, hl = hp >= ap;
  return (
    <div className={`game${me ? " me" : ""}`}>
      <div className={`g-row ${hl ? "lead" : "trail"}`}><Chip id={h} /><span className="nm">{M.T[h].name}</span><span className="num">{f1(hp)}</span></div>
      <div className={`g-row ${!hl ? "lead" : "trail"}`}><Chip id={a} /><span className="nm">{M.T[a].name}</span><span className="num">{f1(ap)}</span></div>
      <div className="g-bar"><i style={{ width: (hp / tot) * 100 + "%", background: M.T[h].c }} /><i style={{ width: (ap / tot) * 100 + "%", background: M.T[a].c, opacity: 0.55 }} /></div>
      <div className="eyebrow">{live ? (Math.abs(hp - ap) < 10 ? "Within 10" : "Margin " + f1(Math.abs(hp - ap))) : "Final · margin " + f1(Math.abs(hp - ap))}</div>
    </div>
  );
}

function Faceoff() {
  const { M } = useApp();
  const { CW, ME, T, st, ids, DATA } = M, o = M.oppOf(CW, ME), opp = o.opp, my = o.me, th = o.them, lead = my - th, liveP = ncdf(lead / 18);
  const nx = CW < DATA.regWeeks ? M.oppOf(CW + 1, ME) : null;
  return (
    <div className="sec" id="faceoff-sec">
      <div className="sec-head"><h2>Week {CW} · your faceoff</h2><Pill kind="warn"><i className="live-dot" />In progress</Pill></div>
      <div className="faceoff">
        <div className="fo-grid">
          <div className="fo-team me"><Chip id={ME} /><div className="fo-name">{T[ME].name}</div><div className="fo-score num">{f1(my)}</div><div className="eyebrow">{st[ME].w}-{st[ME].l} · You</div></div>
          <div className="fo-mid">{lead >= 0 ? "UP" : "DOWN"}<br /><b className="num">{f1(Math.abs(lead))}</b></div>
          <div className="fo-team r"><Chip id={opp} /><div className="fo-name">{T[opp].name}</div><div className="fo-score num">{f1(th)}</div><div className="eyebrow">{st[opp].w}-{st[opp].l} · {T[opp].owner}</div></div>
        </div>
        <div className="fo-foot">
          <span>Hold chance <b className="num">{pct(liveP)}</b></span>
          <span>Your week-{CW} rank <b className="num">{ids.filter((i) => st[i].wk[CW] > my).length + 1} of {ids.length}</b></span>
          <span>A win moves you to <b className="num">{st[ME].w + 1}-{st[ME].l}</b></span>
          {nx && <span>Next: <b>week {CW + 1} {nx.home ? "vs" : "at"} {T[nx.opp].name}</b> ({pct(M.winProb(ME, nx.opp))} model)</span>}
        </div>
      </div>
    </div>
  );
}

export function Week() {
  const { M } = useApp();
  const { CW, DATA, ids, st, ME } = M, PW = CW - 1, last = DATA.results[PW];
  const w1 = last ? ids.map((i) => st[i].wk[PW]).sort((a, b) => b - a) : null;
  return <>
    <Stale />
    <TopMoves />
    <Ticker />
    <Today />
    <Faceoff />
    <div className="sec" id="now-sec">
      <div className="sec-head"><h2>Around the league</h2><span className="note">Live week-{CW} totals. Bar shows share of combined points.</span></div>
      <div className="games">{DATA.results[CW].map((g, i) => <GameCard key={i} g={g} live />)}</div>
    </div>
    {last && <div className="sec" id="last-sec">
      <div className="sec-head"><h2>Week {PW} finals</h2><span className="note">League average {f1(w1.reduce((a, b) => a + b) / w1.length)}. Your {f1(st[ME].wk[PW])} ranked {w1.indexOf(st[ME].wk[PW]) + 1} of {w1.length}.</span></div>
      <div className="games">{last.map((g, i) => <GameCard key={i} g={g} />)}</div>
    </div>}
  </>;
}
