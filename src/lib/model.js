/* League model. Pure functions only (no DOM), so the same code runs on the main thread and inside the web workers.
   buildModel() takes the raw league snapshot plus settings and returns every derived value the views need, except
   the three heavy jobs (playoff simulation, wire scoring, trade search), which run in workers. */
import { etKey, keyAdd, keyLabel, timeET } from "./calendar.js";
import { ncdf, fmtLeft } from "./format.js";

/* Player row layout (positional arrays keep the snapshot small). */
export const P = { tm: 0, nm: 1, pos: 2, pro: 3, slot: 4, inj: 5, std: 6, gp: 7, l7: 8, pt: 9, pa: 10, last: 11, own: 12, sl: 13, acq: 14, id: 15, game: 16, gs: 17 };
export const OUTS = ["INJURY_RESERVE", "OUT", "SUSPENSION"];
export const SEASON = 2027, LEAGUE_ID = 1454450537;
export const INJ_SHORT = { DAY_TO_DAY: "DTD", OUT: "OUT", INJURY_RESERVE: "IR", SUSPENSION: "SUSP" };
export const INJ_LONG = { DAY_TO_DAY: "Day-to-day", OUT: "Out", INJURY_RESERVE: "IR", SUSPENSION: "Suspended" };

export const isF = (r) => r[P.pos] === "C" || r[P.pos] === "LW" || r[P.pos] === "RW";
/* No ESPN projection: shrink the to-date rate toward a typical 1.5 a game. */
export const pv = (r) => (r[P.pa] > 0 ? r[P.pa] : r[P.gp] > 0 ? 0.5 * ((r[P.std] / r[P.gp]) * 0.8) + 0.75 : 1.2);
export const avail = (r) => !OUTS.includes(r[P.inj]) && r[P.slot] !== "IR";
export const healthy = (r) => r[P.inj] === "ACTIVE" || r[P.inj] === "NORMAL";
export const lastName = (r) => String(r[P.nm]).split(" ").slice(1).join(" ") || r[P.nm];
export const statline = (r) => { const s = r[P.sl]; return r[P.pos] === "G" ? `${s[0]}W · ${s[1]} SV · ${s[2]} GA · ${s[3]} SO` : `${s[0]}-${s[1]} · ${s[2]} PPP · ${s[4]} SOG · ${s[5]} HIT · ${s[6]} BLK`; };
export const normNm = (n) => String(n || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

export function lineupStrength(list) {
  const a = list.filter(avail).sort((x, y) => pv(y) - pv(x));
  const F = a.filter(isF), D = a.filter((r) => r[P.pos] === "D"), G = a.filter((r) => r[P.pos] === "G");
  const f = F.slice(0, 9), d = D.slice(0, 5), g = G.slice(0, 2);
  const rest = [...F.slice(9), ...D.slice(5)].sort((x, y) => pv(y) - pv(x)), u = rest.slice(0, 1);
  const sum = (l) => l.reduce((t, r) => t + pv(r), 0);
  return { F: sum(f), D: sum(d), G: sum(g), U: sum(u), total: sum(f) + sum(d) + sum(g) + sum(u), starters: [...f, ...d, ...g, ...u] };
}

export const validData = (d) => !!(d && d.teams && Object.keys(d.teams).length >= 4 && Array.isArray(d.players) && d.players.length > 40 && d.results && d.results[d.currentWeek] && d.schedule && d.teams[d.myId]);

/**
 * @param raw     league snapshot
 * @param S       settings (gpw, projW, sd are read here)
 * @param gcache  {t, season, g} NHL schedule cache, or null
 * @param now     clock in ms, fixed for the life of this model
 */
export function buildModel(raw, S, gcache, now = Date.now()) {
  /* Rows are cloned because game and starter flags are rewritten for today below. */
  const DATA = { ...raw, players: raw.players.map((r) => r.slice()), fa: (raw.fa || []).map((r) => r.slice()) };
  const T = DATA.teams, ME = DATA.myId, ids = Object.keys(T).map(Number);
  const CW = DATA.currentWeek;

  /* ---- standings ---- */
  const st = {};
  ids.forEach((i) => (st[i] = { id: i, w: 0, l: 0, pf: 0, pa: 0, wk: {}, streak: [], ap: [0, 0], apLive: [0, 0] }));
  Object.entries(DATA.results).forEach(([wk, games]) => {
    wk = +wk; const live = wk === CW;
    games.forEach(([h, a, hp, ap]) => {
      st[h].pf += hp; st[h].pa += ap; st[a].pf += ap; st[a].pa += hp; st[h].wk[wk] = hp; st[a].wk[wk] = ap;
      if (!live) { if (hp > ap) { st[h].w++; st[a].l++; st[h].streak.push("W"); st[a].streak.push("L"); } else { st[a].w++; st[h].l++; st[a].streak.push("W"); st[h].streak.push("L"); } }
    });
    if (!live) { const sc = ids.map((i) => st[i].wk[wk]); ids.forEach((i) => { const me = st[i].wk[wk]; sc.forEach((o) => { if (o !== me) o < me ? st[i].ap[0]++ : st[i].ap[1]++; }); }); }
  });
  ids.forEach((i) => { const me = st[i].wk[CW]; ids.forEach((j) => { if (j !== i) st[j].wk[CW] < me ? st[i].apLive[0]++ : st[i].apLive[1]++; }); });
  const ranked = Object.values(st).sort((a, b) => b.w - a.w || b.pf - a.pf);

  const liveGame = (wk, id) => DATA.results[wk].find((g) => g[0] === id || g[1] === id);
  function oppOf(wk, id) {
    if (DATA.results[wk]) { const g = liveGame(wk, id); return g[0] === id ? { opp: g[1], home: true, me: g[2], them: g[3] } : { opp: g[0], home: false, me: g[3], them: g[2] }; }
    const p = DATA.schedule[wk].split(",").map((s) => s.split("-").map(Number)).find((p) => p.includes(id));
    return { opp: p[0] === id ? p[1] : p[0], home: p[0] === id };
  }

  /* ---- NHL calendar ---- */
  const TODAY_KEY = etKey(now), SNAP_KEY = etKey(Date.parse(DATA.snapshot));
  const GC = gcache && Array.isArray(gcache.g) && gcache.g.length && gcache.season === SEASON ? gcache : null;
  const GAMES = GC ? GC.g : Array.isArray(DATA.games) ? DATA.games : []; /* [startMs, homeAbbr, awayAbbr] */
  const GAMES_SRC = GC ? GC.t : DATA.games && DATA.games.length ? Date.parse(DATA.snapshot) : 0;
  const TG = {};
  GAMES.forEach(([ms, h, a]) => { (TG[h] = TG[h] || []).push([ms, "vs", a]); (TG[a] = TG[a] || []).push([ms, "@", h]); });
  Object.values(TG).forEach((a) => a.sort((x, y) => x[0] - y[0]));
  const TD = {};
  Object.keys(TG).forEach((ab) => { TD[ab] = new Set(TG[ab].map((g) => etKey(g[0]))); });
  const playsOn = (ab, key) => !!(TD[ab] && TD[ab].has(key));
  const gamesInDays = (ab, from, n) => { const to = keyAdd(from, n); return (TG[ab] || []).filter((g) => { const k = etKey(g[0]); return k >= from && k < to; }); };
  const nextGame = (ab) => (TG[ab] || []).find((g) => etKey(g[0]) > TODAY_KEY);
  const gameOn = (ab, key) => (TG[ab] || []).find((g) => etKey(g[0]) === key);
  const STARTS_KEY = DATA.startsKey || SNAP_KEY, STARTS_OK = STARTS_KEY === TODAY_KEY;
  /* Game flags come from the schedule when it's loaded, so "today" is the real today, not the snapshot's day. */
  if (GAMES.length) [...DATA.players, ...DATA.fa].forEach((r) => { r[P.game] = playsOn(r[P.pro], TODAY_KEY) ? 1 : 0; });
  /* Starter status only applies to the day ESPN reported it for. */
  if (!STARTS_OK) [...DATA.players, ...DATA.fa].forEach((r) => { if (r[P.pos] === "G") r[P.gs] = null; });
  const GT = GAMES.length || SNAP_KEY === TODAY_KEY ? "GAME-TODAY" : "GAME-ON-" + SNAP_KEY + "(a past day, not today)";
  const SCHED_OK = GAMES.length > 0;

  /* ---- strength and weekly means ---- */
  const GPW = S.gpw, SD = S.sd, PW = S.projW / 100, BASE = 100;
  const teamRows = {}; ids.forEach((i) => (teamRows[i] = DATA.players.filter((r) => r[P.tm] === i)));
  const mine = teamRows[ME];
  const leagueAvgPF = ids.reduce((s, i) => s + st[i].pf, 0) / ids.length;
  const strength = {}; ids.forEach((i) => (strength[i] = lineupStrength(teamRows[i])));
  const avgStr = ids.reduce((a, i) => a + strength[i].total, 0) / ids.length;
  const mean = {};
  ids.forEach((i) => { const prior = strength[i].total / avgStr, obs = st[i].pf / leagueAvgPF; mean[i] = BASE * (PW * prior + (1 - PW) * obs); });
  const winProb = (a, b) => ncdf((mean[a] - mean[b]) / (SD * Math.SQRT2));
  const futureWeeks = [];
  for (let w = CW + 1; w <= DATA.regWeeks; w++) futureWeeks.push(DATA.schedule[w].split(",").map((s) => s.split("-").map(Number)));

  /* ---- schedule-aware week model ----
     Each of the next 7 days (today included) gets its own best legal lineup (9 F, 5 D, 2 G, 1 UTIL) from players whose
     team plays that day; the week is the sum. Goalies are scaled by start share, or ESPN's starter status for today.
     Day-to-day players are scaled by 0.85. Without the schedule, the flat model runs instead. */
  const PERIOD_LEFT = 7;
  const PERIOD_DAYS = Array.from({ length: PERIOD_LEFT }, (_, i) => keyAdd(TODAY_KEY, i));
  const _tgp = {};
  const teamGP = (ab) => _tgp[ab] ?? (_tgp[ab] = (TG[ab] || []).filter((g) => etKey(g[0]) < SNAP_KEY).length);
  function startShare(r) { if (r[P.pos] !== "G") return 1; const tg = teamGP(r[P.pro]); return tg < 4 ? null : Math.min(1, r[P.gp] / tg); }
  const gsShare = (g, fb) => (g === "CONFIRMED" ? 1 : g === "NOTSTARTING" ? 0 : g === "EXPECTED" ? 0.85 : fb);
  function dayVal(r, key, k) {
    if (!avail(r) || !(SCHED_OK ? playsOn(r[P.pro], key) : k === 0 && r[P.game])) return 0;
    let v = pv(r); if (r[P.inj] === "DAY_TO_DAY") v *= 0.85;
    if (r[P.pos] === "G") { let sh = startShare(r); if (k === 0 && STARTS_OK && r[P.gs]) sh = gsShare(r[P.gs], sh); v *= sh == null ? 1 : sh; }
    return v;
  }
  const DVC = new Map();
  const dayVals = (r) => { let a = DVC.get(r); if (!a) { a = PERIOD_DAYS.map((key, k) => dayVal(r, key, k)); DVC.set(r, a); } return a; };
  const gLeft = (r) => gamesInDays(r[P.pro], TODAY_KEY, PERIOD_LEFT).length;
  function weekPlan(list) {
    let total = 0; const ex = new Map(); const c = (a, b) => b[0] - a[0];
    for (let k = 0; k < PERIOD_LEFT; k++) {
      const F = [], D = [], G = [];
      for (const r of list) { const v = dayVals(r)[k]; if (v <= 0) continue; (r[P.pos] === "G" ? G : r[P.pos] === "D" ? D : F).push([v, r]); }
      F.sort(c); D.sort(c); G.sort(c);
      const sel = [...F.slice(0, 9), ...D.slice(0, 5), ...G.slice(0, 2)];
      const rest = [...F.slice(9), ...D.slice(5)].sort(c); if (rest[0]) sel.push(rest[0]);
      for (const [v, r] of sel) { total += v; ex.set(r, (ex.get(r) || 0) + v); }
    }
    return { total, ex };
  }
  const exp7 = (r) => (SCHED_OK ? dayVals(r).reduce((a, b) => a + b, 0) : null);

  /* ---- recommendation labels (rules of thumb, not probabilities) ---- */
  function recInfo(w) {
    const f = w.f, d = w.drop, why = [], risk = []; let sc = 0.5;
    if (w.gain >= 2) sc += 0.2; else if (w.gain >= 1) sc += 0.1; else if (w.gain < 0.5) sc -= 0.1;
    if (SCHED_OK) { const gf = gLeft(f), gd = gLeft(d); why.push(`${lastName(f)} has ${gf} game${gf === 1 ? "" : "s"} in the next 7 days, ${lastName(d)} has ${gd}`); if (gf > gd) sc += 0.05; }
    else { risk.push("NHL schedule not loaded, so games left are assumed equal"); sc -= 0.2; }
    why.push(`${pv(f).toFixed(2)}/gm projected vs ${pv(d).toFixed(2)} for ${lastName(d)}`);
    if (f[P.gp] > 0 && f[P.l7] > pv(f) * 1.2) { why.push(`hot, ${f[P.l7].toFixed(2)}/gm over the last 7 days`); sc += 0.1; }
    else if (f[P.gp] > 0 && f[P.l7] < pv(f) * 0.6) { risk.push(`cold, ${f[P.l7].toFixed(2)}/gm over the last 7 days`); sc -= 0.1; }
    if (f[P.pos] === "G") {
      const sh = startShare(f);
      if (sh == null) { risk.push("start share unknown"); sc -= 0.15; }
      else { why.push(`has played ${Math.round(sh * 100)}% of his team's games`); if (sh < 0.5) { risk.push("timeshare goalie"); sc -= 0.15; } }
      if (STARTS_OK && f[P.game] && f[P.gs]) why.push(`today: ${({ CONFIRMED: "confirmed starter", EXPECTED: "expected starter", NOTSTARTING: "not starting" })[f[P.gs]] || f[P.gs].toLowerCase()}`);
    }
    if (f[P.inj] === "DAY_TO_DAY") { risk.push("day-to-day"); sc -= 0.15; }
    return { conf: sc >= 0.7 ? "High" : sc >= 0.45 ? "Medium" : "Low", why, risk };
  }

  /* ---- rest-of-season value and wire tags ---- */
  const LAST_KEY = GAMES.length ? etKey(GAMES[GAMES.length - 1][0]) : "";
  const ROS_OK = SCHED_OK && LAST_KEY >= keyAdd(TODAY_KEY, 150);
  const rosGames = (r) => (TG[r[P.pro]] || []).filter((g) => etKey(g[0]) >= TODAY_KEY).length;
  const ROS_G = (() => { const t = Object.keys(TG); return t.length ? t.reduce((a, k) => a + (TG[k] || []).filter((g) => etKey(g[0]) >= TODAY_KEY).length, 0) / t.length : 0; })();
  function rosPts(r) { if (!ROS_OK || OUTS.includes(r[P.inj]) || r[P.slot] === "IR") return null; const sh = startShare(r); return pv(r) * rosGames(r) * (r[P.pos] === "G" && sh != null ? sh : 1); }
  function wireTags(w) {
    const f = w.f, t = []; if (!(w.gain > 0.05)) return t;
    const ra = rosPts(f), rb = rosPts(w.drop), shortOnly = ra != null && rb != null && ra < rb;
    if (w.gain >= 2 && recInfo(w).conf === "High" && !shortOnly) t.push(["Must-add", "good"]);
    if (shortOnly) t.push(["Short-term only", "warn"]);
    if (SCHED_OK && gLeft(f) >= 5) t.push([`Stream, ${gLeft(f)} games`, "blue"]);
    if (f[P.own] < 10) t.push(["Deep league", "warn"]);
    return t;
  }

  /* ---- trade valuation ---- */
  const tUnit = (tmode) => (tmode === "ros" ? Math.max(ROS_G / GPW, 1) : 1);
  const tVal = (l, tmode) => (tmode === "ros" ? lineupStrength(l).total * ROS_G : SCHED_OK ? weekPlan(l).total : lineupStrength(l).total * GPW);
  function tradeRec(t, tmode) {
    const u = tUnit(tmode), m = t.me / u, h = t.them / u, risk = []; let sc = 0.5;
    if (m >= 2) sc += 0.2; else if (m >= 1) sc += 0.1;
    if (h >= 1) sc += 0.15; else if (h < 0.3) sc -= 0.15;
    if (!SCHED_OK && tmode === "now") { risk.push("NHL schedule not loaded, so this uses a flat games-per-week model"); sc -= 0.2; }
    [t.x, t.y].forEach((r) => {
      if (r[P.inj] === "DAY_TO_DAY") { risk.push(`${r[P.nm]} is day-to-day`); sc -= 0.1; }
      if (OUTS.includes(r[P.inj])) { risk.push(`${r[P.nm]} is ${r[P.inj] === "SUSPENSION" ? "suspended" : "out"}`); sc -= 0.15; }
    });
    if (t.x[P.pos] === "G" || t.y[P.pos] === "G") {
      const g = t.x[P.pos] === "G" ? t.x : t.y, sh = startShare(g);
      if (sh == null) { risk.push("goalie start share unknown"); sc -= 0.1; } else if (sh < 0.5) { risk.push(`${g[P.nm]} has played ${Math.round(sh * 100)}% of his team's games`); sc -= 0.1; }
    }
    return { conf: sc >= 0.7 ? "High" : sc >= 0.45 ? "Medium" : "Low", risk };
  }
  function scoreDeal(send, get, o) {
    const theirs = teamRows[o];
    const me = (lineupStrength([...mine.filter((r) => !send.includes(r)), ...get]).total - strength[ME].total) * GPW;
    const them = (lineupStrength([...theirs.filter((r) => !get.includes(r)), ...send]).total - strength[o].total) * GPW;
    return { me, them };
  }

  /* ---- today, locks, optimize ---- */
  function liveWin() { try { const o = oppOf(CW, ME); return ncdf((o.me - o.them) / 18); } catch { return null; } }
  function lockInfo(at = Date.now()) {
    const g = [];
    mine.filter((r) => r[P.slot] !== "IR").forEach((r) => (TG[r[P.pro]] || []).forEach((x) => { if (etKey(x[0]) === TODAY_KEY) g.push(x[0]); }));
    g.sort((a, b) => a - b);
    return { n: g.length, next: g.find((t) => t > at) || 0, locked: g.filter((t) => t <= at).length };
  }
  function lockText(at = Date.now()) {
    if (!SCHED_OK) return "NHL schedule not loaded";
    const l = lockInfo(at);
    if (!l.n) return "None of your players have a game today";
    if (!l.next) return "Every lineup spot is locked for today";
    return `Next lock in ${fmtLeft(l.next - at)} at ${timeET(l.next)}` + (l.locked ? `, ${l.locked} already locked` : "");
  }
  const isActive = (r) => r[P.slot] !== "BN" && r[P.slot] !== "IR";
  function optPlan(at = Date.now()) {
    const list = mine;
    const started = (r) => { const g = gameOn(r[P.pro], TODAY_KEY); return !!g && g[0] <= at; };
    const val = (r) => dayVal(r, TODAY_KEY, 0);
    const cand = list.filter((r) => val(r) > 0 && !(started(r) && !isActive(r)));
    const forced = new Set(cand.filter((r) => isActive(r) && started(r)));
    const key = (r) => (forced.has(r) ? 1e6 : 0) + val(r);
    cand.sort((a, b) => key(b) - key(a));
    const F = cand.filter(isF), D = cand.filter((r) => r[P.pos] === "D"), G = cand.filter((r) => r[P.pos] === "G");
    const best = [...F.slice(0, 9), ...D.slice(0, 5), ...G.slice(0, 2)], rest = [...F.slice(9), ...D.slice(5)];
    if (rest[0]) best.push(rest[0]);
    const ins = best.filter((r) => !isActive(r)), outs = list.filter((r) => isActive(r) && !best.includes(r) && !started(r)).sort((a, b) => val(a) - val(b));
    const cur = list.filter(isActive).reduce((t, r) => t + val(r), 0), total = best.reduce((t, r) => t + val(r), 0);
    const pool = [...outs];
    const fg = (x) => (x[P.pos] === "G" ? "G" : x[P.pos] === "D" ? "D" : "F"), sk = (x) => x[P.pos] !== "G";
    const moves = ins.sort((a, b) => val(b) - val(a)).map((r) => {
      let i = pool.findIndex((x) => fg(x) === fg(r)); if (i < 0 && sk(r)) i = pool.findIndex(sk);
      return { r, o: i >= 0 ? pool.splice(i, 1)[0] : null };
    });
    return { moves, leftover: pool, cur, total, gain: total - cur };
  }
  const gameStr = (r) => { const g = gameOn(r[P.pro], TODAY_KEY); return g ? `${r[P.pro]} ${g[1]} ${g[2]} at ${timeET(g[0])}` : `${r[P.pro]} has no game today`; };
  function todayRec(r) {
    const why = [gameStr(r), `${pv(r).toFixed(2)}/gm projected`], risk = []; let c = "High";
    if (r[P.pos] === "G") {
      const sh = startShare(r);
      if (STARTS_OK && r[P.gs] === "CONFIRMED") why.push("confirmed starter");
      else if (STARTS_OK && r[P.gs] === "EXPECTED") { why.push("expected starter"); c = "Medium"; }
      else { c = "Low"; risk.push(sh == null ? "starter not confirmed, start share unknown" : `starter not confirmed, he has played ${Math.round(sh * 100)}% of his team's games`); }
    }
    if (r[P.inj] === "DAY_TO_DAY") { risk.push("day-to-day"); if (c === "High") c = "Medium"; }
    if (r[P.gp] > 0 && r[P.l7] > pv(r) * 1.2) why.push(`hot, ${r[P.l7].toFixed(2)}/gm over the last 7 days`);
    if (SNAP_KEY !== TODAY_KEY) { risk.push(`your slots are from ${keyLabel(SNAP_KEY)}`); if (c === "High") c = "Medium"; }
    return { c, why, risk };
  }
  function todayPlan(team) {
    const list = teamRows[team];
    const scoresToday = (r) => r[P.game] && avail(r) && (r[P.pos] !== "G" || r[P.gs] === "CONFIRMED" || r[P.gs] === "EXPECTED");
    const cand = list.filter(scoresToday).sort((a, b) => pv(b) - pv(a));
    const F = cand.filter(isF), D = cand.filter((r) => r[P.pos] === "D"), G = cand.filter((r) => r[P.pos] === "G");
    const best = [...F.slice(0, 9), ...D.slice(0, 5), ...G.slice(0, 2)];
    const rest = [...F.slice(9), ...D.slice(5)].sort((a, b) => pv(b) - pv(a)); if (rest[0]) best.push(rest[0]);
    const start = best.filter((r) => !isActive(r)), idle = list.filter((r) => isActive(r) && !scoresToday(r));
    return { start, idle, best, gain: start.reduce((t, r) => t + pv(r), 0), irGame: list.filter((r) => r[P.slot] === "IR" && r[P.game]), wasted: list.filter((r) => isActive(r) && r[P.pos] === "G" && r[P.game] && !scoresToday(r)) };
  }

  /* ---- roster feed ---- */
  function tickerItems() {
    const L = [];
    mine.forEach((r) => {
      const n = r[P.nm];
      if (r[P.inj] === "DAY_TO_DAY") L.push([1, "warn", "Injury", `${n} is day-to-day`]);
      else if (OUTS.includes(r[P.inj]) && r[P.slot] !== "IR") L.push([0, "bad", "Injury", `${n} is ${r[P.inj] === "SUSPENSION" ? "suspended" : "out"} and not in an IR slot`]);
      else if (r[P.slot] === "IR" && r[P.game] && !OUTS.includes(r[P.inj])) L.push([1, "warn", "IR", `${n} is on IR and ${r[P.pro]} plays today, check his status`]);
      if (r[P.pos] === "G" && r[P.game] && STARTS_OK && r[P.gs]) { const g = r[P.gs]; L.push([g === "NOTSTARTING" ? 0 : g === "CONFIRMED" ? 3 : 2, g === "CONFIRMED" ? "good" : g === "NOTSTARTING" ? "bad" : "warn", "Goalie", `${n} is ${g === "CONFIRMED" ? "the confirmed starter" : g === "NOTSTARTING" ? "not starting" : "expected to start"} today`]); }
      if (r[P.gp] >= 3 && pv(r) > 0 && r[P.l7] >= pv(r) * 1.4 && r[P.slot] !== "IR") L.push([3, "good", "Form", `${n} is hot: ${r[P.l7].toFixed(2)}/gm over the last 7 days vs ${pv(r).toFixed(2)} projected`]);
      else if (r[P.gp] >= 3 && pv(r) > 1 && r[P.l7] <= pv(r) * 0.5 && r[P.slot] !== "IR") L.push([2, "warn", "Form", `${n} is cold: ${r[P.l7].toFixed(2)}/gm over the last 7 days vs ${pv(r).toFixed(2)} projected`]);
    });
    return L.sort((a, b) => a[0] - b[0]).slice(0, 12);
  }

  /* ---- alerts (wire comes from the worker; pass [] until it arrives) ---- */
  function computeAlerts(S, wire, at = Date.now()) {
    const A = [], age = (at - Date.parse(DATA.snapshot)) / 36e5;
    if (age > 24) A.push({ lv: 1, t: `Data is ${Math.round(age / 24)} day${Math.round(age / 24) === 1 ? "" : "s"} old`, d: "Sync to pull current lineups, injuries and starters. Everything below is only as fresh as the last sync.", go: "set", b: "Open Settings" });
    if (S.alInj) mine.forEach((r) => {
      if (OUTS.includes(r[P.inj]) && r[P.slot] !== "IR") A.push({ lv: 0, t: `${r[P.nm]} is ${r[P.inj] === "SUSPENSION" ? "suspended" : "out"} and not in an IR slot`, d: "He scores nothing in an active slot. Bench him or move him to IR.", go: "pl:" + r[P.id], b: "Details" });
      else if (r[P.inj] === "DAY_TO_DAY") A.push({ lv: 1, t: `${r[P.nm]} is day-to-day`, d: `${r[P.slot] === "BN" ? "On your bench." : "In an active slot."} Check status before his game locks.`, go: "pl:" + r[P.id], b: "Details" });
    });
    if (S.alGoalie && SCHED_OK) mine.filter((r) => r[P.pos] === "G" && avail(r) && playsOn(r[P.pro], TODAY_KEY) && r[P.slot] !== "BN").forEach((r) => {
      const g = STARTS_OK ? r[P.gs] : null;
      if (g !== "CONFIRMED" && g !== "NOTSTARTING") A.push({ lv: 1, t: `${r[P.nm]} plays today, start not confirmed`, d: g === "EXPECTED" ? "ESPN lists him as the expected starter." : STARTS_OK ? "No starter status from ESPN yet." : "ESPN's starter status is not for today.", go: "pl:" + r[P.id], b: "Details" });
      else if (g === "NOTSTARTING") A.push({ lv: 0, t: `${r[P.nm]} is not starting today`, d: "He scores nothing from your G slot today.", go: "opt", b: "Optimize" });
    });
    if (S.alLock) {
      try {
        const pl = optPlan(at), l = lockInfo(at);
        if (pl.moves.length) { const close = SCHED_OK && l.next && l.next - at <= S.alLead * 60000; A.push({ lv: close ? 0 : 2, t: `${pl.moves.length} lineup change${pl.moves.length > 1 ? "s" : ""} ready, about +${pl.gain.toFixed(1)} pts`, d: SCHED_OK && l.next ? `First lock in ${fmtLeft(l.next - at)}.` : "No lock time available.", go: "opt", b: "Optimize" }); }
      } catch {}
    }
    if (S.alFA && wire) { const w = wire[0]; if (w && w.gain >= 2 && recInfo(w).conf === "High" && wireTags(w).some((t) => t[0] === "Must-add")) A.push({ lv: 2, t: `Must-add: ${w.f[P.nm]}`, d: `Add him and drop ${w.drop[P.nm]} for about +${w.gain.toFixed(1)} projected pts over the next 7 days.`, go: "up", b: "See upgrades" }); }
    return A.sort((a, b) => a.lv - b.lv);
  }

  /* ---- points cheat sheet ---- */
  const PT_SC = Object.fromEntries(DATA.scoring || []);
  const ptv = (k) => +PT_SC[k] || 0;
  const ptComps = (r) => {
    const s = r[P.sl] || [], n = (i) => +s[i] || 0;
    if (r[P.pos] === "G") { const w = n(0) * ptv("Win"), sv = n(1) * ptv("Save"), ga = n(2) * ptv("Goal against"), so = n(3) * ptv("Shutout"), otl = n(4) * ptv("OT loss"); return { g: 0, a: 0, pp: 0, sog: 0, hit: 0, blk: 0, gk: w + sv + ga + so + otl, w, sv, ga, so, otl, nw: n(0), nsv: n(1), nga: n(2), nso: n(3), notl: n(4) }; }
    return { g: n(0) * ptv("Goal"), a: n(1) * ptv("Assist"), pp: n(2) * ptv("PP point") + n(3) * ptv("SH point"), sog: n(4) * ptv("Shot"), hit: n(5) * ptv("Hit"), blk: n(6) * ptv("Block"), gk: 0 };
  };
  const PT_CATS = [["g", "Goals"], ["a", "Assists"], ["pp", "PP/SH bonus"], ["sog", "Shots"], ["hit", "Hits"], ["blk", "Blocks"], ["gk", "Goalie net"]];
  const ptTot = (c) => PT_CATS.reduce((s, [k]) => s + c[k], 0);
  const ptLine = (o) => (o.G || 0) * ptv("Goal") + (o.A || 0) * ptv("Assist") + (o.PP || 0) * ptv("PP point") + (o.SH || 0) * ptv("SH point") + (o.SOG || 0) * ptv("Shot") + (o.HIT || 0) * ptv("Hit") + (o.BLK || 0) * ptv("Block") + (o.W || 0) * ptv("Win") + (o.SV || 0) * ptv("Save") + (o.GA || 0) * ptv("Goal against") + (o.SO || 0) * ptv("Shutout") + (o.OTL || 0) * ptv("OT loss");
  const ptTeam = {};
  ids.forEach((i) => { ptTeam[i] = { g: 0, a: 0, pp: 0, sog: 0, hit: 0, blk: 0, gk: 0, tot: 0, skP: 0, skG: 0, gkP: 0, gkG: 0 }; });
  DATA.players.forEach((r) => {
    const t = ptTeam[r[P.tm]]; if (!t) return;
    const c = ptComps(r), tot = ptTot(c);
    PT_CATS.forEach(([k]) => { t[k] += c[k]; }); t.tot += tot;
    if (r[P.pos] === "G") { t.gkP += tot; t.gkG += +r[P.gp] || 0; } else { t.skP += tot; t.skG += +r[P.gp] || 0; }
  });

  /* ---- lookups ---- */
  const byIdMap = new Map();
  DATA.fa.forEach((r) => byIdMap.set(String(r[P.id]), r));
  DATA.players.forEach((r) => byIdMap.set(String(r[P.id]), r));
  const rowById = (id) => byIdMap.get(String(id));
  const ownerOf = (r) => (T[r[P.tm]] ? T[r[P.tm]].name : "Free agent");
  function findPlayer(name, team) {
    const n = normNm(name); if (!n) return null;
    const pool = teamRows[team] || [];
    return pool.find((r) => normNm(r[P.nm]) === n) || pool.find((r) => { const m = normNm(r[P.nm]); return m.endsWith(" " + n.split(" ").pop()) && m[0] === n[0]; }) || pool.find((r) => normNm(r[P.nm]).includes(n)) || null;
  }
  const teamByAb = (ab) => { const a = String(ab || "").trim().toUpperCase(); return ids.find((i) => T[i].ab.toUpperCase() === a) ?? ids.find((i) => normNm(T[i].name) === normNm(ab)); };

  return {
    DATA, T, ME, ids, CW, st, ranked, liveGame, oppOf, teamRows, mine,
    TODAY_KEY, SNAP_KEY, GAMES, GAMES_SRC, TG, playsOn, gamesInDays, nextGame, gameOn, STARTS_KEY, STARTS_OK, GT, SCHED_OK,
    GPW, SD, strength, mean, winProb, futureWeeks, leagueAvgPF,
    PERIOD_LEFT, PERIOD_DAYS, startShare, dayVal, dayVals, gLeft, weekPlan, exp7,
    recInfo, ROS_OK, ROS_G, rosGames, rosPts, wireTags, tUnit, tVal, tradeRec, scoreDeal,
    liveWin, lockInfo, lockText, optPlan, todayRec, todayPlan, tickerItems, computeAlerts,
    ptv, ptComps, ptTot, ptLine, ptTeam, PT_CATS,
    rowById, ownerOf, findPlayer, teamByAb,
  };
}

export const expSeed = (odds, id) => (odds ? odds[id].seeds.reduce((a, p, i) => a + i * p, 0) : null);
