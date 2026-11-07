/* Points cheat sheet: what each event is worth in this league, and where your points come from. */
import { useApp } from "../ctx.js";
import { P, avail } from "../lib/model.js";
import { f1, ptSign } from "../lib/format.js";
import { InjPill, Pill, slotCls } from "../components/ui.jsx";

const PT_COL = { g: "--c-g", a: "--c-a", pp: "--c-pp", sog: "--c-sog", hit: "--c-hit", blk: "--c-blk", gk: "--c-gk" };
const Sw = ({ k }) => <i className="ptsw" style={{ background: `var(${PT_COL[k]})` }} />;
const CAT_OF = { Goal: "g", Assist: "a", "PP point": "pp", "SH point": "pp", Shot: "sog", Hit: "hit", Block: "blk" };
const PT_SK = [["Sniper night", "1 goal, 4 shots", { G: 1, SOG: 4 }], ["Power-play playmaker", "1 PP assist, 2 shots, 1 block", { A: 1, PP: 1, SOG: 2, BLK: 1 }], ["Shutdown defenseman", "3 blocks, 2 hits, 2 shots", { BLK: 3, HIT: 2, SOG: 2 }], ["Grinder", "5 hits, 3 shots, 1 block", { HIT: 5, SOG: 3, BLK: 1 }], ["Quiet night", "2 shots, 1 hit", { SOG: 2, HIT: 1 }]];
const PT_GK = [["Solid win", "30 saves, 2 GA", { W: 1, SV: 30, GA: 2 }], ["Shutout", "25 saves, 0 GA", { W: 1, SO: 1, SV: 25 }], ["OT loss", "30 saves, 3 GA", { OTL: 1, SV: 30, GA: 3 }], ["Regulation loss", "28 saves, 3 GA", { SV: 28, GA: 3 }], ["Blow-up", "20 saves, 4 GA", { SV: 20, GA: 4 }]];
const KEYS = ["g", "a", "pp", "sog", "hit", "blk"];
const grp = (r) => (r[P.pos] === "G" ? "G" : r[P.pos] === "D" ? "D" : "F");
const N = ({ children }) => <span className="num">{children}</span>;

function Nights({ title, rows, ptLine }) {
  return (
    <table className="pt-tbl">
      <thead><tr><th className="l">{title}</th><th className="l">Line</th><th>Pts</th></tr></thead>
      <tbody>{rows.map(([a, b, o]) => { const v = ptLine(o); return <tr key={a}><td className="l">{a}</td><td className="l">{b}</td><td className={`num${v < 0 ? " neg" : ""}`}>{ptSign(v).replace("+", "")}</td></tr>; })}</tbody>
    </table>
  );
}

export function Points() {
  const { M } = useApp();
  const { ids, ME, T, ptTeam, PT_CATS, ptComps, ptTot, ptLine, ptv, DATA } = M;
  const n = ids.length, my = ptTeam[ME];
  const avg = (get) => ids.reduce((s, i) => s + get(ptTeam[i]), 0) / n;
  const rank = (get) => 1 + ids.filter((i) => get(ptTeam[i]) > get(my) + 1e-9).length;
  const Rk = ({ r }) => <span className={`rk ${r <= 3 ? "t" : r > n - 3 ? "b" : "m"}`} title={`Rank among ${n} teams`}>#{r}</span>;
  const rate = (p, g) => (t) => (t[g] ? t[p] / t[g] : 0);
  const LAB = Object.fromEntries(PT_CATS);

  const SumTile = ({ label, get }) => (
    <div className="tile"><span className="eyebrow">{label}</span><span className="big">{f1(get(my))}</span><span className="sub">League avg {f1(avg(get))} <Rk r={rank(get)} /></span></div>
  );

  /* ladder */
  const items = (DATA.scoring || []).slice().sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const mx = Math.max(...items.map((x) => Math.abs(x[1])), 1);
  const eq = (a, b) => (ptv(b) ? +(ptv(a) / ptv(b)).toFixed(1) : 0);
  const gaSv = eq("Goal against", "Save");
  const tips = [
    <><N>1 goal</N> = {eq("Goal", "Assist")} assists = {eq("Goal", "Block")} blocks = {eq("Goal", "Hit")} hits = {eq("Goal", "Shot")} shots.</>,
    <><N>1 assist</N> = {eq("Assist", "Block")} blocks = {eq("Assist", "Hit")} hits = {eq("Assist", "Shot")} shots.</>,
    <><N>1 block</N> = {eq("Block", "Hit")} hits. Blocks are the best cheap source of points.</>,
    <>Power-play points add {ptv("PP point")} on top. A PP goal with its shot is <N>{f1(ptv("Goal") + ptv("Shot") + ptv("PP point"))}</N>, a PP assist is <N>{f1(ptv("Assist") + ptv("PP point"))}</N>.</>,
    <>A goalie win pays <N>{ptv("Win")}</N> before saves. Each goal against costs {Math.abs(ptv("Goal against"))}, which cancels <N>{gaSv < 0 ? -gaSv : gaSv} saves</N>.</>,
    <>A shutout adds {ptv("Shutout")} to the win, so a 25-save shutout scores <N>{f1(ptLine({ W: 1, SO: 1, SV: 25 }))}</N>.</>,
    <>An OT loss still pays {ptv("OT loss")}. A goalie needs {Math.round(Math.abs(ptv("Goal against")) / ptv("Save"))} saves per goal allowed just to break even.</>,
  ];

  /* team mix */
  const order = ids.slice().sort((a, b) => ptTeam[b].tot - ptTeam[a].tot), top = Math.max(...order.map((i) => ptTeam[i].tot), 1);
  const diffs = PT_CATS.map(([k, l]) => [l, my[k] - avg((t) => t[k])]).sort((a, b) => b[1] - a[1]);
  const best = diffs[0], worst = diffs[diffs.length - 1];

  /* position-group baselines among all rostered players */
  const minGP = { F: 3, D: 3, G: 2 }, base = {};
  ["F", "D", "G"].forEach((g) => { const l = DATA.players.filter((r) => r[P.tm] && grp(r) === g && r[P.gp] >= minGP[g]); base[g] = l.length ? l.reduce((s, r) => s + ptTot(ptComps(r)) / r[P.gp], 0) / l.length : 0; });
  const Who = ({ r }) => <span className="pl-n">{r[P.nm]}<InjPill r={r} /><small>{r[P.pos]} · {r[P.pro]} · <span className={`slot ${slotCls(r[P.slot])}`.trim()}>{r[P.slot]}</span></small></span>;
  const Chg = ({ r, g }) => { if (!(r[P.gp] > 0)) return "–"; const d = ptTot(ptComps(r)) / r[P.gp] - base[g]; return <Pill kind={d >= 0.15 ? "good" : d <= -0.15 ? "bad" : "blue"}>{ptSign(d)}</Pill>; };
  const perGm = (r, fb) => (r[P.gp] > 0 ? ptTot(ptComps(r)) / r[P.gp] : fb);

  const sk = DATA.players.filter((r) => r[P.tm] === ME && r[P.pos] !== "G").sort((a, b) => perGm(b, -1) - perGm(a, -1));
  const gk = DATA.players.filter((r) => r[P.tm] === ME && r[P.pos] === "G").sort((a, b) => perGm(b, -9) - perGm(a, -9));

  /* cheap points on the wire */
  const per = (r) => { const c = ptComps(r); return c.sog + c.hit + c.blk; };
  const starters = sk.filter((r) => !["BN", "IR"].includes(r[P.slot]) && r[P.gp] >= 3);
  const myPer = starters.length ? starters.reduce((s, r) => s + per(r) / r[P.gp], 0) / starters.length : 0;
  const fas = DATA.fa.filter((r) => r[P.pos] !== "G" && r[P.gp] >= 3 && avail(r)).sort((a, b) => per(b) / b[P.gp] - per(a) / a[P.gp]).slice(0, 8);

  return (
    <>
      <div className="sec">
        <div className="sec-head"><h2>Points cheat sheet</h2><span className="note">Season to date through week {DATA.currentWeek}. Totals count every player on a roster, started or benched.</span></div>
        <div className="tiles">
          <SumTile label="Roster points" get={(t) => t.tot} />
          <SumTile label="Skater pts per game" get={rate("skP", "skG")} />
          <SumTile label="Goalie pts per game" get={rate("gkP", "gkG")} />
        </div>
      </div>
      <div className="sec">
        <div className="sec-head"><h2>What each event is worth</h2><span className="note">Fantasy points per event, from the league's scoring settings. Bar length is to scale.</span></div>
        <div className="pts-two">
          <div className="card"><div className="bars">{items.map(([nm, p]) => {
            const k = CAT_OF[nm] || "gk", col = p < 0 ? "var(--bad)" : `var(${PT_COL[k]})`;
            return <div className="bar" key={nm}><span className="lab">{nm}</span><span className="track"><i style={{ width: Math.max(1.5, (Math.abs(p) / mx) * 100) + "%", background: col }} /></span><span className="val">{p > 0 ? "+" : "−"}{Math.abs(p)}</span></div>;
          })}</div></div>
          <div className="pts-tips">{tips.map((t, i) => <div className="pts-tip" key={i}>{t}</div>)}</div>
        </div>
      </div>
      <div className="sec">
        <div className="sec-head"><h2>Typical nights</h2><span className="note">What a common stat line scores, so you can read a box score at a glance.</span></div>
        <div className="pts-two">
          <div className="scroll"><Nights title="Skater" rows={PT_SK} ptLine={ptLine} /></div>
          <div className="scroll"><Nights title="Goalie" rows={PT_GK} ptLine={ptLine} /></div>
        </div>
      </div>
      <div className="sec">
        <div className="sec-head"><h2>Where your points come from</h2><span className="note">Each bar is a club's season points, split by stat. Goalie net is wins, saves, shutouts and OT losses minus goals against.</span></div>
        <div className="card"><div className="bars">{order.map((i) => { const t = ptTeam[i]; return (
          <div className={`bar${i === ME ? " me" : ""}`} key={i}><span className="lab" title={T[i].name}>{T[i].ab} {i === ME ? "(you)" : ""}</span>
            <span className="track">{PT_CATS.map(([k, l]) => (t[k] > 0 ? <i key={k} style={{ width: (t[k] / top) * 100 + "%", background: `var(${PT_COL[k]})` }} title={`${l} ${f1(t[k])}`} /> : null))}</span>
            <span className="val">{f1(t.tot)}</span></div>
        ); })}</div></div>
        <div className="pts-legend">{PT_CATS.map(([k, l]) => <span key={k}><Sw k={k} />{l}</span>)}</div>
        <div className="pts-tiles">{PT_CATS.map(([k, l]) => {
          const g = (t) => t[k], a = avg(g), share = my.tot ? (my[k] / my.tot) * 100 : 0, at = avg((t) => t.tot), ash = at ? (a / at) * 100 : 0;
          return <div className="tile" key={k}><span className="eyebrow"><Sw k={k} />{l}</span><span className="big">{f1(my[k])}</span><span className="sub">{Math.round(share)}% of yours vs {Math.round(ash)}% avg</span><span className="sub">Avg {f1(a)} <Rk r={rank(g)} /></span></div>;
        })}</div>
        <p className="pts-insight">Biggest edge on the league average: {best[0].toLowerCase()} ({ptSign(best[1])} pts). Biggest gap: {worst[0].toLowerCase()} ({ptSign(worst[1])} pts).</p>
      </div>
      <div className="sec">
        <div className="sec-head"><h2>Your skaters by source</h2><span className="note">Season points split by stat. The bold cell is each player's biggest source. The change column compares points per game with the average rostered skater at the same position group.</span></div>
        <div className="scroll"><table className="pt-tbl">
          <thead><tr><th className="l">Skater</th><th>GP</th><th>Pts</th><th>Per GM</th><th>Vs avg</th>{KEYS.map((k) => <th key={k}><Sw k={k} />{LAB[k]}</th>)}<th className="l">Top source</th></tr></thead>
          <tbody>{sk.map((r) => {
            const c = ptComps(r), tot = ptTot(c), mxv = Math.max(...KEYS.map((k) => c[k])), topK = tot > 0 ? KEYS.find((k) => c[k] === mxv) : null;
            return <tr key={r[P.id]}><td className="l"><Who r={r} /></td><td className="num">{r[P.gp]}</td><td className="num">{f1(tot)}</td><td className="num">{r[P.gp] > 0 ? (tot / r[P.gp]).toFixed(2) : "–"}</td><td><Chg r={r} g={grp(r)} /></td>
              {KEYS.map((k) => <td key={k} className={`num${k === topK ? " top" : ""}`}>{f1(c[k])}</td>)}<td className="l">{topK ? LAB[topK] : "–"}</td></tr>;
          })}</tbody>
          <tfoot>
            <tr className="me"><td className="l">Your skaters</td><td /><td className="num">{f1(my.skP)}</td><td className="num">{my.skG ? (my.skP / my.skG).toFixed(2) : "–"}</td><td />{KEYS.map((k) => <td key={k} className="num">{f1(my[k])}</td>)}<td /></tr>
            <tr><td className="l">League average club</td><td /><td className="num">{f1(avg((t) => t.skP))}</td><td className="num">{f1(avg((t) => (t.skG ? t.skP / t.skG : 0)))}</td><td />{KEYS.map((k) => <td key={k} className="num">{f1(avg((t) => t[k]))}</td>)}<td /></tr>
          </tfoot>
        </table></div>
      </div>
      <div className="sec">
        <div className="sec-head"><h2>Your goalies by source</h2><span className="note">Wins and saves build the total, goals against take it back. Compared with the average rostered goalie.</span></div>
        <div className="scroll"><table className="pt-tbl">
          <thead><tr><th className="l">Goalie</th><th>GP</th><th>Record</th><th>Pts</th><th>Per GM</th><th>Vs avg</th><th>Wins</th><th>Saves</th><th>Shutouts</th><th>OT losses</th><th>Goals against</th></tr></thead>
          <tbody>{gk.length ? gk.map((r) => { const c = ptComps(r), tot = ptTot(c); return (
            <tr key={r[P.id]}><td className="l"><Who r={r} /></td><td className="num">{r[P.gp]}</td><td className="num">{c.nw} W, {c.nso} SO, {c.notl} OTL</td><td className="num">{f1(tot)}</td><td className="num">{r[P.gp] > 0 ? (tot / r[P.gp]).toFixed(2) : "–"}</td><td><Chg r={r} g="G" /></td>
              <td className="num">{f1(c.w)}</td><td className="num">{f1(c.sv)}</td><td className="num">{f1(c.so)}</td><td className="num">{f1(c.otl)}</td><td className="num neg">{f1(c.ga)}</td></tr>
          ); }) : <tr><td className="l" colSpan={11}>No goalies on your roster.</td></tr>}</tbody>
        </table></div>
      </div>
      <div className="sec">
        <div className="sec-head"><h2>Cheap points on the wire</h2><span className="note">Shots, hits and blocks need no goal or assist. Your starting skaters average {myPer.toFixed(2)} of these points per game. Free agents with at least 3 games, healthy only, best first.</span></div>
        <div className="scroll"><table className="pt-tbl">
          <thead><tr><th className="l">Free agent</th><th>GP</th><th>Shots + hits + blocks per GM</th><th>Total per GM</th><th>Vs your starters</th><th>Owned</th></tr></thead>
          <tbody>{fas.length ? fas.map((r) => { const p = per(r) / r[P.gp], d = p - myPer; return (
            <tr key={r[P.id]}><td className="l"><span className="pl-n">{r[P.nm]}{r[P.slot] === "WV" && <> <Pill kind="blue">Waivers</Pill></>}<small>{r[P.pos]} · {r[P.pro]}</small></span></td>
              <td className="num">{r[P.gp]}</td><td className="num">{p.toFixed(2)}</td><td className="num">{(ptTot(ptComps(r)) / r[P.gp]).toFixed(2)}</td><td><Pill kind={d >= 0.1 ? "good" : d <= -0.1 ? "bad" : "blue"}>{ptSign(d)}</Pill></td><td className="num">{r[P.own]}%</td></tr>
          ); }) : <tr><td className="l" colSpan={6}>No free agents meet the games filter yet.</td></tr>}</tbody>
        </table></div>
      </div>
    </>
  );
}
