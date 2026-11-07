/* Bench coach: streams answers from /api/coach with the full league context on the first turn. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCoachSession } from "../lib/coachSession.js";
import { useApp } from "../ctx.js";
import { nowStr, whenET } from "../lib/calendar.js";
import { Loading } from "../components/ui.jsx";
import { context, systemPrompt, focusBlock, harvestTrades, stripTrades, streamCoach } from "../lib/coach.js";

export function Coach() {
  const app = useApp();
  const { M, S, odds, wire, trades, tmode, refs, coachReq, setCoachReq, setCtrades, ctrades, setDealsDot, show, goSync } = app;
  const { T, ME, ranked, DATA, CW } = M;
  const [focus, setFocus] = useState(() => (S.coachTeam !== "me" && T[S.coachTeam] ? +S.coachTeam : ME));
  const [q, setQ] = useState("");
  const [{ log, busy }, setView] = useState({ log: [], busy: false });
  const session = useMemo(() => createCoachSession({ stream: streamCoach, onChange: setView }), []);
  const logEl = useRef(null), ctRef = useRef(ctrades);
  ctRef.current = ctrades;
  const ready = !!(odds && wire && trades);

  useEffect(() => { setFocus(S.coachTeam !== "me" && T[S.coachTeam] ? +S.coachTeam : ME); }, [S.coachTeam]); // eslint-disable-line react-hooks/exhaustive-deps
  /* A new snapshot means the context the coach saw on turn one is stale: the next question starts over. */
  const firstM = useRef(true);
  useEffect(() => { if (firstM.current) { firstM.current = false; return; } session.contextChanged(); }, [M, session]);
  useEffect(() => () => session.clear(), [session]);
  useEffect(() => { const el = logEl.current; if (el && log.length) el.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [log.length]);

  const ask = useCallback((question, fid = focus) => {
    if (busy || !question.trim() || !ready) return Promise.resolve(false);
    return session.ask({
      label: (fid !== ME ? "[" + T[fid].ab + "] " : "") + question,
      build: (first, hist) => [...hist, { role: "user", content: (first ? systemPrompt(M, S, refs) + context(M, { odds, wire, trades, S, tmode }) + "\n\n" : "") + `Right now it is ${nowStr()}.\n` + focusBlock(M, fid, odds) + "\n\nQUESTION: " + question }],
      strip: stripTrades,
      after: (text) => {
        if (fid !== ME) return {};
        const found = harvestTrades(M, text, ctRef.current);
        if (found.length) { setCtrades((cur) => [...found, ...cur].slice(0, 12)); setDealsDot(true); }
        return { trades: found.length };
      },
      errorText: (e) => (e && e.code === "rate_limited" ? "Too many questions in a row. Wait a minute and ask again." : e && e.name === "AbortError" ? "Stopped." : "The coach couldn't answer that. Try again."),
    });
  }, [busy, ready, focus, M, S, refs, odds, wire, trades, tmode, T, ME, setCtrades, setDealsDot, session]);

  /* Requests from other tabs ("Ask the coach" on a trade card): switch focus to the user's team, then ask. */
  useEffect(() => {
    if (!coachReq) return;
    setFocus(ME);
    if (!ready || busy) { setQ(coachReq.q); setCoachReq(null); return; }
    ask(coachReq.q, ME).then(() => setCoachReq(null));
  }, [coachReq, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => session.clear();
  const submit = (e) => { e.preventDefault(); const v = q; setQ(""); ask(v); };

  const opp = M.oppOf(CW, ME).opp, nextOpp = CW < DATA.regWeeks ? M.oppOf(CW + 1, ME).opp : null;
  const starters = [
    "Set my best lineup for today",
    `How do I beat ${T[opp].ab} this week?`,
    "Who should I use my one add on this week?",
    "Who are my realistic playoff rivals?",
    nextOpp != null ? `Preview week ${CW + 1} against ${T[nextOpp].name}` : null,
    "Build me a fair 2-for-1 trade for a goalie",
  ].filter(Boolean);
  const teams = [ME, ...ranked.map((t) => t.id).filter((i) => i !== ME)];

  return (
    <div className="sec coach">
      <div className="sec-head"><h2>Bench coach</h2><button className="btn ghost" type="button" onClick={clear}>Clear</button></div>
      <p className="note">Ask about lineups, the playoff race, trade angles or your schedule. The coach sees everything on this page: standings, live scores, the full schedule, the model's odds, every roster with stats and projections, the NHL game schedule for the past day and the next week, ESPN's confirmed goalie starters, and the trade finder's results. Trades it recommends are sent to the Trades tab. It also sees the top free agents, goalies included once synced. It can't see news after the snapshot.</p>
      <p className="note">Coach is working from rosters as of <b>{whenET(DATA.snapshot)}</b>. Made moves on ESPN since then? <a href="#" onClick={(e) => { e.preventDefault(); goSync(); }}>Sync first</a> so it knows.</p>
      <div className="focus"><label htmlFor="focus" className="eyebrow">Questions about</label>
        <select id="focus" value={focus} onChange={(e) => setFocus(+e.target.value)}>{teams.map((i) => <option key={i} value={i}>{T[i].name} ({T[i].ab}){i === ME ? " · You" : ""}</option>)}</select>
      </div>
      {S.starters && <div className="starters">{starters.map((s) => <button key={s} className="starter" type="button" disabled={busy || !ready} onClick={() => ask(s)}>{s}</button>)}</div>}
      <div className="log" ref={logEl} aria-live="polite">
        {log.map((m, i) => (
          <div key={i} className={"msg " + m.cls}>{m.text}
            {m.trades > 0 && <span className="tlink">{m.trades === 1 ? "Trade" : m.trades + " trades"} added to the Trades tab. <button type="button" onClick={() => show("deals")}>View</button></span>}
          </div>
        ))}
      </div>
      {!ready && <Loading>Loading odds, wire and trades for the coach…</Loading>}
      <form className="ask" onSubmit={submit}>
        <label htmlFor="q" className="eyebrow" hidden>Question</label>
        <textarea id="q" rows={2} placeholder="Ask the coach" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} />
        <button className="btn" type="submit" disabled={busy || !ready}>Ask</button>
      </form>
    </div>
  );
}
