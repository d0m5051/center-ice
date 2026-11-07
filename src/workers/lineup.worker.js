/* Wire gains and trade search off the main thread. The model is rebuilt from the same inputs as the main thread's,
   so row indexes line up on both sides. The model is kept between messages: a trade-horizon switch reuses it. */
import { buildModel } from "../lib/model.js";
import { scoreWire, findTrades, packWire, packTrades } from "../lib/lineup.js";

let cacheKey = null, M = null;

self.onmessage = (e) => {
  const { id, raw, S, gcache, now, key, tmode, wire, trades } = e.data;
  try {
    const t0 = performance.now();
    if (key !== cacheKey || !M) { M = buildModel(raw, S, gcache, now); cacheKey = key; }
    const out = { id, ok: true };
    if (wire) out.wire = packWire(M, scoreWire(M));
    if (trades) out.trades = packTrades(M, findTrades(M, tmode));
    out.ms = Math.round(performance.now() - t0);
    self.postMessage(out);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
