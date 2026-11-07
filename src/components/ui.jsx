/* Small presentational pieces shared across panels. All text goes through React, so nothing is HTML-injected. */
import { P, pv, healthy, INJ_SHORT } from "../lib/model.js";
import { useApp } from "../ctx.js";

export const Chip = ({ id }) => { const { M } = useApp(); return <span className="chip" style={{ background: M.T[id].c }}>{M.T[id].ab}</span>; };

export const Pill = ({ kind = "", children, title, className = "" }) => <span className={`pill ${kind} ${className}`.trim()} title={title}>{children}</span>;

export const InjPill = ({ r }) => healthy(r) ? null : <Pill kind={r[P.inj] === "DAY_TO_DAY" ? "warn" : "bad"} className="inj">{INJ_SHORT[r[P.inj]] || r[P.inj]}</Pill>;

export const ConfPill = ({ c }) => (
  <Pill kind={c === "High" ? "good" : c === "Low" ? "bad" : "warn"} title="A rule-of-thumb label from gain size, games left, form, goalie start share and injury status. It is not a probability.">{c} confidence</Pill>
);

export const GameDot = ({ r }) => (r[P.game] ? <i className="gm" title="Game today" /> : null);

export const slotCls = (s) => (s === "BN" ? "bn" : s === "IR" ? "ir" : "");
export const Slot = ({ s }) => <span className={`slot ${slotCls(s)}`.trim()}>{s}</span>;

/* Goalie start status pill, shown only when the status is for today. */
export function StartPill({ r, labels = "short" }) {
  const { M } = useApp();
  if (r[P.pos] !== "G" || !r[P.game] || !M.STARTS_OK || !r[P.gs]) return null;
  const g = r[P.gs];
  if (labels === "starting-only") return g === "CONFIRMED" ? <> <Pill kind="good">Starting</Pill></> : null;
  return <> <Pill kind={g === "CONFIRMED" ? "good" : g === "NOTSTARTING" ? "bad" : "warn"}>{g === "CONFIRMED" ? "Starting" : g === "NOTSTARTING" ? "Not starting" : "Start TBD"}</Pill></>;
}

export const Tile = ({ label, big, sub, bigStyle, onClick, children }) => {
  const inner = <><span className="eyebrow">{label}</span><span className="big num" style={bigStyle}>{big}</span>{sub != null && <span className="sub">{sub}</span>}{children}</>;
  return onClick ? <button type="button" className="tile tile-btn" onClick={onClick}>{inner}</button> : <div className="tile">{inner}</div>;
};

export const Tags = ({ w }) => { const { M } = useApp(); return M.wireTags(w).map(([x, c]) => <span key={x}> <Pill kind={c}>{x}</Pill></span>); };

export function RecBlock({ w }) {
  const { M } = useApp();
  if (!(w.gain > 0.05)) return null;
  const r = M.recInfo(w);
  return (
    <div className="rec"><ConfPill c={r.conf} />
      <p className="why"><b>Why:</b> {r.why.join("; ")}.{r.risk.length > 0 && <> <span className="risk">Watch: {r.risk.join("; ")}.</span></>}</p>
    </div>
  );
}

export function RosLine({ w }) {
  const { M } = useApp();
  const a = M.rosPts(w.f), b = M.rosPts(w.drop);
  if (a == null || b == null) return null;
  return <span>Rest of season <b className="num">{Math.round(a)}</b> pts vs <b className="num">{Math.round(b)}</b> for {String(w.drop[P.nm]).split(" ").slice(1).join(" ") || w.drop[P.nm]}</span>;
}

/* Add/drop side used by the upgrade cards. */
export const Side = ({ r, label, cls }) => (
  <div className={`side ${cls}`}>
    <span className="eyebrow">{label}</span>
    <b>{r[P.nm]}<GameDot r={r} /><InjPill r={r} /></b>
    <small>{r[P.pos]} · {r[P.pro]}</small>
    <span className="statline">{r[P.pa] > 0 ? r[P.pa].toFixed(2) : "–"}/gm proj · L7 {r[P.l7].toFixed(2)} · {(+r[P.std]).toFixed(1)} in {r[P.gp]} GP</span>
  </div>
);

export const Loading = ({ children = "Crunching numbers…" }) => <p className="note loading" role="status">{children}</p>;

export const BOLT = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>;

export const pvf = (r) => pv(r).toFixed(2);
