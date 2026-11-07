import { useApp } from "../ctx.js";
import { Pill } from "../components/ui.jsx";

const ROWS = [
  ["alInj", "Injuries", "Day-to-day players, and injured players sitting outside an IR slot."],
  ["alGoalie", "Goalie starters", "A goalie of yours plays today and his start is not confirmed."],
  ["alLock", "Lineup lock", "Optimize has changes ready, flagged as urgent when the first lock is close."],
  ["alLead", "Lock warning window", "How far ahead of the first lock to flag a lineup as urgent.", [[30, "30 minutes"], [60, "1 hour"], [120, "2 hours"], [240, "4 hours"]]],
  ["alFA", "Must-add free agents", "A free agent who clears the Must-add bar on the Wire."],
];

export function Alerts() {
  const { S, setKey, alerts, go } = useApp();
  return <>
    <div className="sec">
      <div className="sec-head"><h2>Alerts</h2><span className="note">Shown here and as a dot on the toolbar while this page is open. A web page can't send push notifications once it's closed.</span></div>
      <div className="alerts" aria-live="polite">
        {alerts.length ? alerts.map((a, i) => (
          <div className="alert" key={i}>
            <div className="alert-top"><Pill kind={a.lv === 0 ? "bad" : a.lv === 1 ? "warn" : "blue"}>{a.lv === 0 ? "Act now" : a.lv === 1 ? "Check" : "Info"}</Pill><b>{a.t}</b></div>
            <span className="note wide">{a.d}</span>
            <button type="button" className="btn ghost" onClick={() => go(a.go)}>{a.b}</button>
          </div>
        )) : <p className="note">Nothing needs attention. Alerts appear here when something on your roster changes.</p>}
      </div>
    </div>
    <div className="sec">
      <div className="sec-head"><h3>What to alert on</h3></div>
      <div className="set-group">
        {ROWS.map(([k, l, d, opts]) => (
          <div className="set-row" key={k}>
            <div><span className="lbl" id={"al-" + k}>{l}</span><span className="desc">{d}</span></div>
            <div className="ctl">{opts
              ? <select aria-labelledby={"al-" + k} value={S[k]} onChange={(e) => setKey(k, e.target.value)}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
              : <input className="sw" type="checkbox" aria-labelledby={"al-" + k} checked={!!S[k]} onChange={(e) => setKey(k, e.target.checked)} />}</div>
          </div>
        ))}
      </div>
    </div>
  </>;
}
