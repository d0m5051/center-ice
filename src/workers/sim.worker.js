/* Playoff odds off the main thread. Input is plain data; output is plain data. */
import { buildModel } from "../lib/model.js";
import { runSims } from "../lib/sim.js";

self.onmessage = (e) => {
  const { id, raw, S, gcache, now } = e.data;
  try {
    const t0 = performance.now();
    const M = buildModel(raw, S, gcache, now);
    const odds = runSims(M, S.sims);
    self.postMessage({ id, ok: true, odds, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
