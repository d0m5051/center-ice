/* Every popup in the app. Each one is a <Modal>: focus is trapped inside it, the app behind is inert, and focus
   returns to the element that opened it when it closes. */
import { useState } from "react";
import { useApp } from "../ctx.js";
import { P, pv, healthy, INJ_LONG } from "../lib/model.js";
import { f1 } from "../lib/format.js";
import { etKey, keyLabel, shortDay, timeET } from "../lib/calendar.js";
import { Modal, ModalHead } from "../components/Modal.jsx";
import { TABS, Icon } from "../components/Dock.jsx";
import { InjPill, Pill, ConfPill, Tags, RecBlock, Side, Loading } from "../components/ui.jsx";
import { GainLine } from "../panels/Wire.jsx";
import { startsInfo } from "../panels/Roster.jsx";

const GsPill = ({ r }) => <Pill kind={r[P.gs] === "CONFIRMED" ? "good" : r[P.gs] === "NOTSTARTING" ? "bad" : "warn"}>{r[P.gs] === "CONFIRMED" ? "Starting" : r[P.gs] === "NOTSTARTING" ? "Not starting" : "Start TBD"}</Pill>;
const T2 = ({ label, big, sub }) => <div className="tile"><span className="eyebrow">{label}</span><span className="big num big-28">{big}</span><span className="sub">{sub}</span></div>;

function PlayerOv({ id }) {
  const { M, wire, trades, cmp, setCmp, closeModal, openModal } = useApp();
  const r = M.rowById(id); if (!r) return null;
  const { SCHED_OK, ROS_OK, T, ME } = M;
  const sh = r[P.pos] === "G" ? M.startShare(r) : null, mine = r[P.tm] === ME;
  const w = wire && wire.find((x) => x.f === r), tr = trades && trades.find((t) => t.y === r);
  const reps = mine && wire ? wire.filter((x) => x.drop === r && x.gain > 0.05).slice(0, 3) : [];
  const k = String(r[P.id]), inC = cmp.includes(k), ros = M.rosPts(r);
  let fit = null;
  if (w && w.gain > 0.05) fit = <><p><b>Why he fits your team:</b> adding him and dropping {w.drop[P.nm]} is worth about +{w.gain.toFixed(1)} projected pts over the next 7 days.</p><RecBlock w={w} />{M.wireTags(w).length > 0 && <div><Tags w={w} /></div>}</>;
  else if (w) fit = <p className="note">He would not improve your best lineup over the next 7 days.</p>;
  else if (tr) fit = <p><b>Trade target:</b> {T[tr.o].name} would send him for {tr.x[P.nm]}. You {tr.me >= 0 ? "+" : ""}{tr.me.toFixed(1)}, them {tr.them >= 0 ? "+" : ""}{tr.them.toFixed(1)} projected pts.</p>;
  else if (mine) fit = reps.length ? <p><b>Replacement options:</b> {reps.map((x) => `${x.f[P.nm]} (+${x.gain.toFixed(1)})`).join(", ")} would improve your lineup over him.</p> : wire ? <p className="note">No free agent improves your lineup over him right now.</p> : <Loading job="lineup">Scoring free agents…</Loading>;
  const g7 = SCHED_OK ? M.PERIOD_DAYS.filter((d) => M.playsOn(r[P.pro], d)).map((d) => { const g = M.gameOn(r[P.pro], d); return <span className="tchip" key={d}>{shortDay(d)} <b>{g[1] === "@" ? "@" : "vs"} {g[2]}</b></span>; }) : null;

  return (
    <Modal label={`${r[P.nm]} detail`} onClose={closeModal}>
      <ModalHead onClose={closeModal} title={r[P.nm]} sub={<>{r[P.pos]} · {r[P.pro]} · {M.ownerOf(r)}{mine ? " · " + r[P.slot] : ""} <InjPill r={r} />{r[P.pos] === "G" && r[P.game] && M.STARTS_OK && r[P.gs] && <> <GsPill r={r} /></>}</>} />
      <div className="tiles two">
        <T2 label="Proj / game" big={pv(r).toFixed(2)} sub={r[P.pa] > 0 ? "ESPN projection" : "estimated"} />
        <T2 label="Last 7 avg" big={r[P.l7].toFixed(2)} sub={r[P.l7] > pv(r) * 1.2 ? "running hot" : r[P.l7] < pv(r) * 0.6 && r[P.gp] > 0 ? "running cold" : "near projection"} />
        <T2 label="To date" big={f1(r[P.std])} sub={`${r[P.gp]} GP · ${r[P.own]}% owned`} />
        <T2 label="Next 7 days" big={SCHED_OK ? M.exp7(r).toFixed(1) : "–"} sub={SCHED_OK ? `proj pts over ${M.gLeft(r)} games` : "schedule not loaded"} />
      </div>
      {SCHED_OK && <div className="chips">{g7.length ? g7 : <span className="note">No games in the next 7 days.</span>}</div>}
      <div className="gain">
        {sh != null ? <span>Start share <b className="num">{Math.round(sh * 100)}%</b> of his team's games</span> : r[P.pos] === "G" ? <span>Start share unknown</span> : null}
        {ROS_OK && ros != null && <span>Rest of season <b className="num">{Math.round(ros)}</b> pts over {M.rosGames(r)} games</span>}
      </div>
      {fit}
      <p className="note">Line combinations, power-play role and return dates are not in the sync, so they are not shown.</p>
      <div className="pl-act">
        <button className="btn ghost" type="button" disabled={!inC && cmp.length >= 3} onClick={() => setCmp(inC ? cmp.filter((x) => x !== k) : [...cmp, k].slice(0, 3))}>{inC ? "Remove from compare" : cmp.length >= 3 ? "Compare is full (3)" : "Add to compare"}</button>
        {cmp.length >= 2 && <button className="btn" type="button" onClick={() => openModal("compare")}>Compare {cmp.length}</button>}
      </div>
    </Modal>
  );
}

function CompareOv() {
  const { M, cmp, setCmp, closeModal } = useApp();
  const rs = cmp.map(M.rowById).filter(Boolean);
  const { SCHED_OK } = M;
  const best = (f) => { const v = rs.map(f), ok = v.filter((x) => x != null && isFinite(x)); if (ok.length < 2) return v.map(() => false); const t = Math.max(...ok); return v.map((x) => x != null && x === t); };
  const rows = [
    ["Position", (r) => `${r[P.pos]} · ${r[P.pro]}`], ["Team", (r) => M.ownerOf(r)], ["Status", (r) => (healthy(r) ? "Healthy" : INJ_LONG[r[P.inj]] || r[P.inj])],
    ["Proj / game", (r) => pv(r).toFixed(2), pv], ["Last 7 avg", (r) => r[P.l7].toFixed(2), (r) => r[P.l7]], ["Points to date", (r) => `${f1(r[P.std])} in ${r[P.gp]}`, (r) => r[P.std]], ["Owned", (r) => r[P.own] + "%"],
    ["Games, next 7 days", (r) => (SCHED_OK ? M.gLeft(r) : "–"), (r) => (SCHED_OK ? M.gLeft(r) : null)], ["Proj pts, next 7 days", (r) => (SCHED_OK ? M.exp7(r).toFixed(1) : "–"), (r) => (SCHED_OK ? M.exp7(r) : null)],
    ["Rest of season pts", (r) => (M.rosPts(r) == null ? "–" : Math.round(M.rosPts(r))), (r) => M.rosPts(r)],
    ["Goalie start share", (r) => (r[P.pos] !== "G" ? "–" : M.startShare(r) == null ? "?" : Math.round(M.startShare(r) * 100) + "%"), (r) => (r[P.pos] === "G" ? M.startShare(r) : null)],
  ];
  return (
    <Modal label="Compare players" onClose={closeModal} className="wide-box">
      <ModalHead title="Compare" onClose={closeModal} extra={<button className="btn ghost" type="button" onClick={() => { setCmp([]); closeModal(); }}>Clear</button>} />
      {rs.length < 2 ? <p className="note">Add at least two players to compare.</p> : (
        <div className="scroll"><table className="cmp-t">
          <thead><tr><th className="l"><span className="sr-only">Stat</span></th>{rs.map((r) => <th key={r[P.id]} scope="col">{r[P.nm]}</th>)}</tr></thead>
          <tbody>{rows.map(([l, f, b]) => { const bs = b ? best(b) : rs.map(() => false); return <tr key={l}><th scope="row" className="l">{l}</th>{rs.map((r, i) => <td key={r[P.id]} className={`num${bs[i] ? " best" : ""}`}>{f(r)}</td>)}</tr>; })}</tbody>
        </table></div>
      )}
      <p className="note">Green marks the best value in a row. Compare holds up to 3 players for this browser session.</p>
    </Modal>
  );
}

function OptOv() {
  const { M, now, closeModal, goSync } = useApp();
  const [copied, setCopied] = useState(null);
  const pl = M.optPlan(now), stale = M.SNAP_KEY !== M.TODAY_KEY;
  const copy = async () => {
    const txt = `Lineup moves for ${keyLabel(M.TODAY_KEY)}:\n` + pl.moves.map(({ r, o }) => `Start ${r[P.nm]} (${r[P.pos]})${o ? `, bench ${o[P.nm]}` : ""}`).join("\n") + (pl.leftover.length ? "\nAlso bench: " + pl.leftover.map((r) => r[P.nm]).join(", ") : "");
    try { await navigator.clipboard.writeText(txt); setCopied("Copied"); } catch { setCopied("Copy failed"); }
  };
  return (
    <Modal label="Optimize today's lineup" onClose={closeModal}>
      <ModalHead title="Optimize today" sub={<span className="lockline">{M.lockText(now)}</span>} onClose={closeModal} />
      {stale && <div className="stale"><div><b>Slots are from {keyLabel(M.SNAP_KEY)}</b><span>These moves compare against that day's lineup. Sync to pull today's slots.</span></div><button className="btn" type="button" onClick={goSync}>Sync now</button></div>}
      {!M.SCHED_OK && <div className="stale"><div><b>NHL schedule not loaded</b><span>Game flags come from the last snapshot, so who plays today may be wrong.</span></div></div>}
      {pl.moves.length ? <>
        <div className="sec-head"><h3>{pl.moves.length} change{pl.moves.length > 1 ? "s" : ""}</h3><Pill kind="good">about +{pl.gain.toFixed(1)} projected pts today</Pill></div>
        <div className="moves">
          {pl.moves.map(({ r, o }) => { const t = M.todayRec(r); return (
            <div className="move" key={r[P.id]}><span className="arrow">IN</span>
              <span>{r[P.nm]}<InjPill r={r} /><span className="blk-pill"><ConfPill c={t.c} /></span>
                <small>{r[P.pos]} · {o ? `replaces ${o[P.nm]}${o[P.game] ? "" : ", no game today"}` : "takes an open slot"}</small>
                <small className="rec-why"><b>Why:</b> {t.why.join("; ")}.{t.risk.length > 0 && <> <span className="risk">Watch: {t.risk.join("; ")}.</span></>}</small></span>
            </div>
          ); })}
          {pl.leftover.map((r) => (
            <div className="move out" key={r[P.id]}><span className="arrow">OUT</span><span>{r[P.nm]}<small>{r[P.pos]} · {r[P.game] ? "displaced by a better option today" : "no game today, benching costs nothing"}</small></span><span className="slot bn">BN</span></div>
          ))}
        </div>
      </> : <>
        <div className="sec-head"><h3>Nothing to change</h3><Pill kind="good">+0.0</Pill></div>
        <p className="note">Your lineup already holds the highest projected legal lineup among players who can still be moved.</p>
      </>}
      {pl.moves.length > 0 && <div className="btnrow"><button className="btn ghost" type="button" onClick={copy}>{copied || "Copy as checklist"}</button></div>}
      <p className="note">Center Ice can't change your ESPN lineup. Make these moves in ESPN, then Sync.</p>
    </Modal>
  );
}

function UpOv() {
  const { wire, closeModal } = useApp();
  const ups = wire ? wire.filter((w) => w.gain > 0.05) : [];
  return (
    <Modal label="Upgrades available" onClose={closeModal}>
      <ModalHead title="Upgrades available" onClose={closeModal} sub={wire ? `${ups.length} of ${wire.length} free agents improve your best lineup. Each card shows who to add, who to drop, and the projected gain over the next 7 days if you set your lineup every day. You get 1 add per matchup.` : "Scoring free agents…"} />
      {!wire && <Loading job="lineup">Scoring free agents…</Loading>}
      {wire && (ups.length ? ups.map((w) => (
        <div className="up" key={w.f[P.id]}>
          <div className="up-row"><Side r={w.f} label="Add" cls="add" /><span className="swap">⇄</span><Side r={w.drop} label="Drop" cls="drp r" /></div>
          <GainLine w={w} lineup />
          <RecBlock w={w} />
        </div>
      )) : <p className="note">No free agent improves your lineup right now.</p>)}
    </Modal>
  );
}

function StartsOv() {
  const { M, closeModal } = useApp();
  const I = startsInfo(M), { T, ME, STARTS_OK, TODAY_KEY } = M;
  const day = M.GAMES.length ? (() => { const g = M.GAMES.filter((x) => etKey(x[0]) === TODAY_KEY).sort((a, b) => a[0] - b[0]); return g.length ? `${g.length} NHL game${g.length > 1 ? "s" : ""} ${keyLabel(TODAY_KEY)}: ${g.map((x) => `${x[2]} @ ${x[1]} ${timeET(x[0])}`).join(", ")}.` : `No NHL games ${keyLabel(TODAY_KEY)}.`; })() : "";
  return (
    <Modal label="Goalie starters" onClose={closeModal}>
      <ModalHead title="Goalie starters" onClose={closeModal} sub={STARTS_OK ? `ESPN starter status for ${keyLabel(TODAY_KEY)}, all teams. Your goalies are listed first.` : null} />
      {!STARTS_OK ? <p className="note">Starter status on this page is from {keyLabel(M.STARTS_KEY)}, not today, so it's hidden. Sync to pull today's starters from ESPN. They usually post a few hours before puck drop.</p> : <>
        {I.known.length ? <div className="plist">{I.known.map((r) => (
          <div className={`pl${r[P.tm] === ME ? " me" : ""}`} key={r[P.id]}><span className="pos">{r[P.pro]}</span><span className="nm">{r[P.nm]}<small>{r[P.tm] ? T[r[P.tm]].name : "Free agent"}</small></span><Pill kind={r[P.gs] === "CONFIRMED" ? "good" : "warn"}>{String(r[P.gs]).toLowerCase()}</Pill><span /></div>
        ))}</div> : <p className="note">ESPN hasn't posted any goalie starters for today yet.</p>}
        {I.none > 0 && <p className="note">{I.none} more goalie{I.none > 1 ? "s" : ""} with a game today {I.none > 1 ? "have" : "has"} no status yet.</p>}
      </>}
      {day && <p className="note">{day}</p>}
    </Modal>
  );
}

const MORE_DESC = { board: "Standings, odds, strengths and scouting", plan: "Games, goalie starts, streaming and your opponent", pts: "Scoring rules and where points come from", set: "Look, layout, coach and data" };
function MoreOv() {
  const { alerts, closeModal, show } = useApp();
  const items = TABS.filter((t) => t.sec);
  return (
    <Modal label="More sections" onClose={closeModal} className="more-box" initialFocus=".more-item">
      <ModalHead title="More" onClose={closeModal} />
      <div className="more-list">{items.map((t) => (
        <button type="button" className="more-item" key={t.id} onClick={() => { closeModal(); show(t.id); }}>
          <Icon>{t.ic}</Icon><b>{t.label}</b><small>{t.id === "alerts" ? (alerts.length ? `${alerts.length} active` : "Nothing needs attention") : MORE_DESC[t.id]}</small>
        </button>
      ))}</div>
    </Modal>
  );
}

const MAP = { player: PlayerOv, compare: CompareOv, opt: OptOv, up: UpOv, starts: StartsOv, more: MoreOv };
export function Overlays({ modal }) {
  if (!modal) return null;
  const C = MAP[modal.type]; if (!C) return null;
  return <C key={modal.type + (modal.id || "")} {...modal} />;
}
