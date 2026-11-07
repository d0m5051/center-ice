/* NHL calendar helpers. Every date key is an Eastern-time YYYY-MM-DD string. */
const ETF = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const cache = new Map();
export const etKey = (ms) => { let k = cache.get(ms); if (k === undefined) { k = ETF.format(new Date(ms)); cache.set(ms, k); } return k; };
export const keyLabel = (k) => new Date(Date.parse(k + "T12:00:00Z")).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export const shortDay = (k) => new Date(Date.parse(k + "T12:00:00Z")).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
export const keyAdd = (k, n) => new Date(Date.parse(k + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export const dayDiff = (a, b) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 864e5);
export const timeET = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
export const nowStr = () => new Date().toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
export const fmtET = (iso) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
export const whenET = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";

/* Matchup weeks run Monday to Sunday, Eastern. */
const etDay = (d) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const g = (t) => +p.find((x) => x.type === t).value;
  return Date.UTC(g("year"), g("month") - 1, g("day")) / 864e5;
};
const monday = (x) => x - ((new Date(x * 864e5).getUTCDay() + 6) % 7);
export const weeksAhead = (snap, now = new Date()) => Math.floor((monday(etDay(now)) - monday(etDay(snap))) / 7);
export const thisMondayLabel = (now = new Date()) => new Date(monday(etDay(now)) * 864e5).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
