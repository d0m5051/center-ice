export const f1 = (n) => (n == null ? "–" : (+n).toFixed(1));
export const pct = (x) => (x * 100 >= 99.5 && x < 1 ? ">99%" : x * 100 < 0.5 && x > 0 ? "<1%" : Math.round(x * 100) + "%");
export const sgn = (n, d = 1) => (n >= 0 ? "+" : "") + n.toFixed(d);
export const ptSign = (n) => (n > 0.005 ? "+" : n < -0.005 ? "−" : "") + Math.abs(n).toFixed(1);

export function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
export const ncdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

export function randn() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const fmtLeft = (ms) => { const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4); return h ? `${h}h ${m}m` : `${Math.max(m, 1)}m`; };
