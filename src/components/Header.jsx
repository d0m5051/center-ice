import { useApp } from "../ctx.js";
import { whenET, weeksAhead } from "../lib/calendar.js";

const ICONS = {
  system: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></svg>,
  light: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  dark: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>,
};
const NEXT = { system: "light", light: "dark", dark: "system" };

export function Header() {
  const { M, S, setKey } = useApp();
  const d = M.DATA, when = whenET(d.snapshot), ahead = weeksAhead(new Date(d.snapshot));
  const stamp = ahead > 0 && d.currentWeek < d.regWeeks
    ? `${d.season} · data: week ${d.currentWeek} · now week ${Math.min(d.regWeeks, d.currentWeek + ahead)}`
    : `${d.season} · week ${d.currentWeek} · ${when}`;
  return (
    <header className="board">
      <div className="marquee">
        <h1>Center <span>Ice</span></h1>
        <div className="mq-r">
          <div className="eyebrow">{stamp}</div>
          <button className="icon-btn" type="button" aria-label={`Theme: ${S.mode}. Click to change.`} title={`Theme: ${S.mode}`} onClick={() => setKey("mode", NEXT[S.mode])}>{ICONS[S.mode]}</button>
        </div>
      </div>
    </header>
  );
}
