/* Monte Carlo playoff simulation. Runs inside sim.worker.js. */
import { randn } from "./format.js";

export function runSims(M, SIMS) {
  const { ids, st, mean, DATA, CW, futureWeeks, SD } = M;
  const n = ids.length, idx = new Map(ids.map((id, k) => [id, k]));
  /* Typed arrays and index-based teams keep the inner loop allocation-free. */
  const baseW = Float64Array.from(ids, (i) => st[i].w), basePF = Float64Array.from(ids, (i) => st[i].pf), mu = Float64Array.from(ids, (i) => mean[i]);
  const live = DATA.results[CW].map(([h, a, hp, ap]) => [idx.get(h), idx.get(a), hp - ap]);
  const fut = futureWeeks.map((g) => g.map(([h, a]) => [idx.get(h), idx.get(a)]));
  const make = new Float64Array(n), wins = new Float64Array(n), seed = Array.from({ length: n }, () => new Float64Array(11));
  const w = new Float64Array(n), pf = new Float64Array(n), order = new Int32Array(n);
  const playoff = DATA.playoffTeams;
  for (let s = 0; s < SIMS; s++) {
    w.set(baseW); pf.set(basePF);
    for (const [h, a, m0] of live) { const m = m0 + randn() * 18, add = Math.max(0, randn() * 8 + 12); pf[h] += add; pf[a] += add; m > 0 ? w[h]++ : w[a]++; }
    for (const games of fut) for (const [h, a] of games) { const hs = mu[h] + randn() * SD, as = mu[a] + randn() * SD; pf[h] += hs; pf[a] += as; hs > as ? w[h]++ : w[a]++; }
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => w[b] - w[a] || pf[b] - pf[a]);
    for (let k = 0; k < n; k++) { const t = order[k]; seed[t][k + 1]++; if (k < playoff) make[t]++; wins[t] += w[t]; }
  }
  const odds = {};
  ids.forEach((id, k) => { odds[id] = { make: make[k] / SIMS, wins: wins[k] / SIMS, seeds: Array.from(seed[k], (x) => x / SIMS) }; });
  return odds;
}
