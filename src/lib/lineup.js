/* Wire scoring and the trade finder. Both brute-force the lineup solver, so they run in lineup.worker.js.
   Results are returned as row indexes so the main thread can map them back onto its own row objects. */
import { P, pv, avail, lineupStrength } from "./model.js";

export function scoreWire(M) {
  const { mine, DATA, SCHED_OK, GPW, weekPlan, dayVals } = M;
  const dropC = mine.filter((r) => r[P.slot] !== "IR");
  const worst = dropC.slice().sort((a, b) => pv(a) - pv(b))[0];
  const val = SCHED_OK ? (l) => weekPlan(l).total : (l) => lineupStrength(l).total;
  const scale = SCHED_OK ? 1 : GPW;
  const base = val(mine);
  /* Each candidate roster is "mine minus one plus f"; build the minus-one lists once. */
  const without = new Map(dropC.map((d) => [d, mine.filter((r) => r !== d)]));
  const out = DATA.fa.map((f) => {
    const dead = SCHED_OK ? !dayVals(f).some((v) => v > 0) : pv(f) <= 0;
    if (dead && worst) return { f, gain: 0, drop: worst };
    let best = null;
    for (const d of dropC) {
      const g = val([...without.get(d), f]) - base;
      if (!best || g > best.g + 0.005 || (Math.abs(g - best.g) <= 0.005 && pv(d) < pv(best.d))) best = { g, d };
    }
    return { f, gain: best.g * scale, drop: best.d };
  });
  return out.sort((a, b) => b.gain - a.gain || pv(b.f) - pv(a.f));
}

export function findTrades(M, tmode) {
  const { mine, ids, ME, teamRows, tUnit, tVal } = M;
  const u = tUnit(tmode), baseM = tVal(mine, tmode), out = [];
  ids.filter((i) => i !== ME).forEach((o) => {
    const theirs = teamRows[o], baseT = tVal(theirs, tmode);
    mine.filter(avail).forEach((x) => theirs.filter(avail).forEach((y) => {
      if (Math.abs(pv(x) - pv(y)) > 0.3) return;
      const m2 = tVal([...mine.filter((r) => r !== x), y], tmode) - baseM;
      if (m2 <= 0.15 * u) return;
      const t2 = tVal([...theirs.filter((r) => r !== y), x], tmode) - baseT;
      if (t2 >= 0.3 * u) out.push({ x, y, o, me: m2, them: t2, score: m2 + 0.6 * Math.min(t2, m2) });
    }));
  });
  out.sort((a, b) => b.score - a.score);
  const used = {}, pick = [];
  for (const t of out) {
    const k1 = "x" + t.x[P.id], k2 = "y" + t.y[P.id], k3 = "o" + t.o;
    if ((used[k1] || 0) >= 2 || used[k2] || (used[k3] || 0) >= 2) continue;
    used[k1] = (used[k1] || 0) + 1; used[k2] = 1; used[k3] = (used[k3] || 0) + 1;
    pick.push(t); if (pick.length >= 8) break;
  }
  return pick;
}

/* Serialize to indexes, and back. */
export function packWire(M, wire) {
  const fi = new Map(M.DATA.fa.map((r, i) => [r, i])), pi = new Map(M.DATA.players.map((r, i) => [r, i]));
  return wire.map((w) => [fi.get(w.f), pi.get(w.drop), w.gain]);
}
export const unpackWire = (M, packed) => packed.map(([f, d, gain]) => ({ f: M.DATA.fa[f], drop: M.DATA.players[d], gain }));
export function packTrades(M, trades) {
  const pi = new Map(M.DATA.players.map((r, i) => [r, i]));
  return trades.map((t) => [pi.get(t.x), pi.get(t.y), t.o, t.me, t.them, t.score]);
}
export const unpackTrades = (M, packed) => packed.map(([x, y, o, me, them, score]) => ({ x: M.DATA.players[x], y: M.DATA.players[y], o, me, them, score }));
