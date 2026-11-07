/* Bench coach: streams answers from /api/coach with the full league context on the first turn. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../ctx.js";
import { nowStr, whenET } from "../lib/calendar.js";
import { context, systemPrompt, focusBlock, harvestTrades, stripTrades, streamCoach } from "../lib/coach.js";

export function Coach() {
  const app = useApp();
  const { M, S, odds, wire, trades, tmode, refs, coachReq, setCoachReq, setCtrades, ctrades, setDealsDot, show, goSync } = app;
  const { T, ME, ranked, DATA, CW } = M;
  const [focus, setFocus] = useState(() => (S.coachTeam !== "me" && T[S.coachTeam] ? +S.coachTeam : ME));
  const [log, setLog] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const hist = useRef([]), ctrl = useRef(null), logEl = useRef(null), ctRef = useRef(ctrades);
  ctRef.current = ctrades;
  const ready = !!(odds && wire && trades);

  useEffect(() => { setFocus(S.coachTeam !== "me" && T[S.coachTeam] ? +S.coachTeam : ME); }, [S.coachTeam]); // eslint-disable-line react-hooks/exhaustive-deps
  /* A new snapshot means the context the coach saw on turn one is stale: start over. */
  useEffect(() => { hist.current = []; }, [M]);
  useEffect(() => () => ctrl.current && ctrl.current.abort(), []);
  useEffect(() => { const el = logEl.current; if (el && log.length) el.lastElementChild?.scrollIntoView({ block: "nearest" }); }, [log.length]);

  const patchLast = (p) => setLog((l) => { const c = l.slice(); c[c.length - 1] = { ...c[c.length - 1], ...p }; return c; });

  const ask = useCallback(async (question, fid = focus) => {
    if (busy || !question.trim() || !ready) return false;
    setBusy(true);
    setLog((l) => [...l, { cls: "u", text: (fid !== ME ? "[" + T[fid].ab + "] " : "") + question }, { cls: "a", text: "Thinking…" }]);
    const first = hist.current.length ? "" : systemPrompt(M, S, refs) + context(M, { odds, wire, trades, S, tmode }) + "\n\n";
    const msgs = [...hist.current, { role: "user", content: first + `Right now it is ${nowStr()}.\n` + focusBlock(M, fid, odds) + "\n\nQUESTION: " + question }];
    const ac = new AbortController(); ctrl.current = ac;
    try {
      const text = await streamCoach(msgs, { signal: ac.signal, onText: (t) => patchLast({ text: stripTrades(t) }) });
      hist.current = [...msgs, { role: "assistant", content: text }];
      let n = 0;
      if (fid === ME) {
        const found = harvestTrades(M, text, ctRef.current);
        n = found.length;
        if (n) { setCtrades((cur) => [...found, ...cur].slice(0, 12)); setDealsDot(true); }
      }
      patchLast({ text: stripTrades(text), trades: n });
    } catch (e) {
      if (ac.signal.aborted && ctrl.current !== ac) return true; /* cleared: the log is already gone */
      patchLast({ cls: "err", text: e && e.code === "rate_limited" ? "Too many questions in a row. Wait a minute and ask again." : e && e.name === "AbortError" ? "Stopped." : "The coach couldn't answer that. Try again." });
    } finally {
      if (ctrl.current === ac) { ctrl.current = null; setBusy(false); }
    }
    return true;
  }, [busy, ready, focus, M, S, refs, odds, wire, trades, tmode, T, ME, setCtrades, setDealsDot]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Requests from other tabs ("Ask the coach" on a trade card): switch focus to the user's team, then ask. */
  useEffect(() => {
    if (!coachReq) return;
    setFocus(ME);
    if (!ready || busy) { setQ(coachReq.q); setCoachReq(null); return; }
    ask(coachReq.q, ME).then(() => setCoachReq(null));
  }, [coachReq, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => { const c = ctrl.current; ctrl.current = null; if (c) c.abort(); setBusy(false); hist.current = []; setLog([]); };
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
      {!ready && <p className="note loading" role="status">Loading odds, wire and trades for the coach…</p>}
      <form className="ask" onSubmit={submit}>
        <label htmlFor="q" className="eyebrow" hidden>Question</label>
        <textarea id="q" rows={2} placeholder="Ask the coach" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} />
        <button className="btn" type="submit" disabled={busy || !ready}>Ask</button>
      </form>
    </div>
  );
}
