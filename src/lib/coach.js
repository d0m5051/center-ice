/* Bench coach: builds the league-data context and streams answers from /api/coach (Netlify function -> AI Gateway). */
import { P, pv, statline } from "./model.js";
import { etKey, keyAdd, keyLabel, timeET, nowStr, fmtET } from "./calendar.js";
import { f1, pct } from "./format.js";

export const REF_BUDGET = 40000;
export const REF_KIND = { video: "Video", article: "Article", file: "File", text: "Notes" };

/* The coach gets the best adds by gain plus the top goalies, not the whole pool. */
export function coachWire(wire) {
  const a = wire.slice(0, 70), s = new Set(a.map((w) => w.f[P.id]));
  return [...a, ...wire.filter((w) => w.f[P.pos] === "G" && !s.has(w.f[P.id])).slice(0, 10)];
}

export function refsBlock(refs) {
  const on = refs.filter((r) => r.on && (r.text || "").trim()); if (!on.length) return "";
  let left = REF_BUDGET;
  const parts = on.map((r, i) => {
    const share = Math.max(1500, Math.floor(left / (on.length - i))), t = r.text.trim().slice(0, share); left -= t.length;
    return `[R${i + 1}] ${REF_KIND[r.kind] || "Reference"}: ${r.title}${r.url ? " <" + r.url + ">" : ""}${t.length < r.text.trim().length ? " (excerpt)" : ""}\n${t}`;
  });
  return "\n\nCOACH REFERENCES (videos, articles and files Dom added as background. Use them for strategy, player context and reasoning. They are not league data: if one conflicts with the league data or today's date, the data wins, and anything they say about injuries, lineups or schedules may be out of date. When an answer leans on one, name it by its title):\n" + parts.join("\n\n");
}

function schedTag(M, ab) {
  if (!M.GAMES.length) return "";
  const n = M.gamesInDays(ab, M.TODAY_KEY, 7).length, nx = M.nextGame(ab);
  return `g7:${n}${nx ? " next:" + keyLabel(etKey(nx[0])) + (nx[1] === "@" ? " @" : " vs ") + nx[2] : ""} `;
}

function calLines(M) {
  const { DATA, TODAY_KEY, SNAP_KEY, GAMES, STARTS_OK, STARTS_KEY, T } = M;
  const L = [], age = Math.round((Date.parse(TODAY_KEY) - Date.parse(SNAP_KEY)) / 864e5);
  L.push(`CURRENT DATE AND TIME: ${nowStr()}. "Today" means ${keyLabel(TODAY_KEY)} (${TODAY_KEY}) and nothing else. Any game dated before ${TODAY_KEY} is finished. Rosters, scores and free agents were pulled ${fmtET(DATA.snapshot)}${age > 0 ? `, which is ${age} day${age > 1 ? "s" : ""} before today, so lineup slots and live scores may have changed` : ", the same day"}.`);
  if (GAMES.length) {
    L.push("NHL SCHEDULE from ESPN (Eastern time; dates are exact; use only this for who plays when):");
    for (let k = -1; k <= 7; k++) {
      const key = keyAdd(TODAY_KEY, k), g = GAMES.filter((x) => etKey(x[0]) === key).sort((a, b) => a[0] - b[0]);
      const tag = k === -1 ? "YESTERDAY, FINISHED" : k === 0 ? "TODAY" : k === 1 ? "TOMORROW" : "";
      L.push(`${keyLabel(key)}${tag ? " (" + tag + ")" : ""}: ${g.length ? g.map((x) => `${x[2]} @ ${x[1]} ${timeET(x[0])}`).join("; ") : "no games"}`);
    }
  } else L.push(`NHL SCHEDULE: not loaded. Do not state which NHL teams play on any date. The game flags below are for ${keyLabel(SNAP_KEY)} (the snapshot day), not necessarily today.`);
  const gl = [...DATA.players, ...DATA.fa].filter((r) => r[P.pos] === "G" && r[P.game] && r[P.gs]);
  if (STARTS_OK && gl.length) L.push(`GOALIE STARTER STATUS from ESPN for today (${TODAY_KEY}): ` + gl.map((r) => `${r[P.nm]} ${r[P.pro]} ${r[P.gs]} (${r[P.tm] ? T[r[P.tm]].ab : "free agent"})`).join("; "));
  else L.push(`GOALIE STARTER STATUS: none for today. Statuses from the last sync were for ${keyLabel(STARTS_KEY)}. Say starters are unconfirmed and to sync closer to puck drop.`);
  return L;
}

function modelNotes(M, S, tmode) {
  const { SCHED_OK, GPW } = M;
  return [
    "HOW THIS PAGE'S NUMBERS ARE BUILT (use this to explain any number on the page; do not say you don't know how they are computed):",
    `- proj/gm: ESPN's own projected fantasy points per game for this season (its "projected" stat split, appliedAverage), already scored with THIS league's settings by ESPN. The page doesn't build it from linemates, form or schedule. If ESPN has no projection, the page estimates one by shrinking the player's to-date points per game (x0.8) halfway toward 1.5. L7avg is ESPN's actual points per game over the last 7 days; todate is actual season points.`,
    `- Goalies: proj/gm is ESPN's projection per game played, already scored for this league. For wire gains and Optimize the page multiplies it by start share: the goalie's GP divided by his NHL team's games before the snapshot (unknown when the team has fewer than 4 games on file, then counted as 1). For today only, ESPN's starter status overrides it (CONFIRMED 1, EXPECTED 0.85, NOTSTARTING 0). Playoff odds and lineup strength still count every goalie in full.`,
    `- Games in the next 7 days: when the NHL schedule is loaded (${SCHED_OK ? "it is" : "it is NOT loaded right now"}), wire gains and Optimize use the real games in the next 7 days, today included. This is a rolling window, not the matchup week, so it does not know which of those games count toward the current matchup. Each of the 7 days gets its own best legal lineup from players whose team plays that day, and the week is the sum, so off days and bench players covering for rested starters are counted. DAY_TO_DAY players are scaled by 0.85. Without the schedule the page falls back to ${GPW.toFixed(1)} flat games for every player. The g7 tag on each player line is the count of that team's games in the next 7 days.`,
    `- Lineup strength: each club's best legal lineup (9 F, 5 D, 2 G, 1 UTIL from the best leftover F or D) ranked by proj/gm, times ${GPW.toFixed(1)}. Players marked OUT, IR or SUSPENSION, or sitting in an IR slot, are excluded. DAY_TO_DAY players count in full.`,
    `- Wire gain: for each free agent, the page tries dropping each of the user's non-IR players and keeps the drop that raises the 7-day total the most (ties go to the lower-projected drop). gain = projected points added over the next 7 days, ${SCHED_OK ? "from the schedule-aware week model above" : "on the flat " + GPW.toFixed(1) + "-game model because the schedule is not loaded"}. It assumes the user sets a fresh lineup every day, and it does not model injury return dates or the 1-add-per-matchup limit. A free agent who is OUT counts as zero. Each upgrade shows a High, Medium or Low confidence label and a Why line; that label is a rule of thumb from gain size, games left, last-7 form, goalie start share and injury status, not a probability.`,
    `- Trade finder: one-for-one swaps where the two players' proj/gm are within 0.3 and both teams' lineups improve. Mode "Win now" (${tmode === "now" ? "selected" : "not selected"}) scores each lineup over the next 7 days from the schedule${SCHED_OK ? "" : " (schedule not loaded, so a flat " + GPW.toFixed(1) + " games)"}. Mode "Rest of season" (${tmode === "ros" ? "selected" : "not selected"}) multiplies per-game lineup strength by the average team's remaining games; the page has no ages, contracts or keeper rules. The fairness meter compares your gain with theirs; a deal that favors you heavily is less likely to be accepted. Confidence is a rule-of-thumb label, not a probability.`,
    `- Playoff odds and win chances: each team's weekly mean blends lineup strength (${S.projW}%) with points scored so far (${100 - S.projW}%), scaled to a league average of 100. Every remaining matchup on the real schedule is simulated ${S.sims.toLocaleString()} times with a ${S.sd}-point weekly standard deviation. The current week is finished from its live margin. A single-week win chance is a normal-curve comparison of the two means. Injuries count only through lineup strength.`,
  ];
}

const pline = (M, r) => `${r[P.nm]} ${r[P.pos]} ${r[P.pro]} slot:${r[P.slot]} ${r[P.inj] !== "ACTIVE" ? r[P.inj] + " " : ""}${r[P.game] ? M.GT + (r[P.pos] === "G" && r[P.gs] ? "(" + r[P.gs] + ")" : "") + " " : ""}${schedTag(M, r[P.pro])}todate:${r[P.std]}/${r[P.gp]}gp L7avg:${r[P.l7]} proj/gm:${r[P.pa] || "n/a"} [${statline(r)}]`;

export function context(M, { odds, wire, trades, S, tmode }) {
  const { DATA, T, ME, ids, ranked, st, mean, strength, GPW, oppOf, winProb, CW } = M;
  const lines = [...calLines(M), ...modelNotes(M, S, tmode)];
  lines.push(`League: ${DATA.league} (ESPN fantasy hockey, H2H points, 10 teams, ${DATA.regWeeks} regular-season weeks, top ${DATA.playoffTeams} make playoffs, ties in standings broken by total points). Snapshot taken ${DATA.snapshot}. Current week ${CW} is in progress. Free-agent list from ${DATA.faSnapshot || DATA.snapshot}.`);
  lines.push("Scoring: " + DATA.scoring.map(([n, p]) => `${n} ${p > 0 ? "+" : ""}${p}`).join(", ") + ". Lineup 9F 5D 2G 1UTIL, 5 bench, 2 IR. 1 add per matchup, waivers Sunday 8:00 with 24h hold.");
  lines.push("Standings (rank. team [abbr] owner: W-L, PF, PA, week2 live, all-play, model playoff odds, ESPN projected rank, waiver priority):");
  ranked.forEach((t, k) => lines.push(`${k + 1}. ${T[t.id].name} [${T[t.id].ab}] ${T[t.id].owner}${t.id === ME ? " (USER)" : ""}: ${t.w}-${t.l}, PF ${f1(t.pf)}, PA ${f1(t.pa)}, wk${CW} live ${f1(t.wk[CW] || 0)}, all-play ${t.ap[0] + t.apLive[0]}-${t.ap[1] + t.apLive[1]}, playoff ${pct(odds[t.id].make)}, ESPN rank ${T[t.id].projRank}, waiver ${T[t.id].waiver}, model weekly mean ${mean[t.id].toFixed(0)}`));
  for (let w = 1; w < CW; w++) if (DATA.results[w]) lines.push(`Week ${w} finals: ` + DATA.results[w].map(([h, a, hp, ap]) => `${T[h].ab} ${hp}-${ap} ${T[a].ab}`).join("; "));
  lines.push(`Week ${CW} live: ` + DATA.results[CW].map(([h, a, hp, ap]) => `${T[h].ab} ${hp}-${ap} ${T[a].ab}`).join("; "));
  const sched = [];
  for (let w = CW + 1; w <= DATA.regWeeks; w++) { const o = oppOf(w, ME); sched.push(`W${w} ${o.home ? "vs" : "@"} ${T[o.opp].ab} (${pct(winProb(ME, o.opp))})`); }
  lines.push("User's remaining schedule with model win chance: " + sched.join(", "));
  lines.push(`User's projected record ${odds[ME].wins.toFixed(1)} wins; seed distribution ${odds[ME].seeds.slice(1).map((x, k) => `${k + 1}:${Math.round(x * 100)}%`).join(" ")}.`);
  lines.push("USER ROSTER (today's lineup slots; GAME-TODAY = NHL game today; goalie CONFIRMED = confirmed starter):");
  M.mine.forEach((r) => lines.push("- " + pline(M, r)));
  const tp = M.todayPlan(ME);
  lines.push(`Today's optimizer: start ${tp.start.map((r) => r[P.nm]).join(", ") || "nobody new"}; active-slot players with no game today: ${tp.idle.map((r) => r[P.nm]).join(", ")}.`);
  lines.push("Lineup strength in projected pts/week (F/D/G/total): " + ids.map((i) => `${T[i].ab} ${(strength[i].F * GPW).toFixed(0)}/${(strength[i].D * GPW).toFixed(0)}/${(strength[i].G * GPW).toFixed(0)}/${(strength[i].total * GPW).toFixed(0)}`).join("; "));
  lines.push("Trade finder results (1-for-1, both lineups improve): " + trades.map((t) => `send ${t.x[P.nm]} for ${t.y[P.nm]} (${T[t.o].ab}) you +${t.me.toFixed(1)}/wk them ${t.them.toFixed(1)}/wk`).join("; "));
  lines.push("OTHER ROSTERS (name pos NHL slot injury proj/gm todate):");
  ids.filter((i) => i !== ME).forEach((i) => lines.push(`${T[i].ab}: ` + M.teamRows[i].slice().sort((a, b) => pv(b) - pv(a)).map((r) => `${r[P.nm]} ${r[P.pos]} ${r[P.pro]} ${r[P.slot]}${r[P.inj] !== "ACTIVE" ? " " + r[P.inj] : ""} ${r[P.pa] || "-"} ${r[P.std]}`).join("; ")));
  const cw = coachWire(wire), hasG = DATA.fa.some((r) => r[P.pos] === "G");
  lines.push(`FREE AGENTS (${wire.length} available players are loaded${hasG ? "" : ", no goalies"}; these are the ${cw.length} best by gain plus the top goalies; gain = user's lineup improvement in proj pts/week if added with the listed drop):`);
  cw.forEach((w) => lines.push(`- ${w.f[P.nm]} ${w.f[P.pos]} ${w.f[P.pro]} ${w.f[P.slot] === "WV" ? "ON WAIVERS " : ""}${w.f[P.inj] !== "ACTIVE" ? w.f[P.inj] + " " : ""}${w.f[P.game] ? M.GT + " " : ""}${schedTag(M, w.f[P.pro])}proj/gm:${w.f[P.pa] || "n/a"} todate:${w.f[P.std]}/${w.f[P.gp]} gain:${w.gain.toFixed(1)} drop:${w.drop[P.nm]}`));
  lines.push(`Not available: ${hasG ? "" : "free-agent goalies, "}news after the snapshot${M.GAMES.length ? "" : ", the NHL schedule (not loaded)"}.`);
  void st;
  return lines.join("\n");
}

export function systemPrompt(M, S, refs) {
  const len = ({ short: "Keep it under 120 words", std: "Keep it under 220 words", long: "Up to 400 words is fine when the question warrants it" })[S.coachLen] || "Keep it under 220 words";
  const notes = (S.coachNotes || "").trim();
  return `You are a sharp fantasy hockey bench coach advising the USER (Dom, team "${M.T[M.ME].name}"). Talk like a competent colleague. Lead with the answer in one line, then specifics. Plain text only: no markdown bold, no headers, no emojis; short dash lists are fine. Use only the league data provided. The USER ROSTER list is the user's complete roster as of the snapshot time: never call anyone else the user's player, and never suggest dropping, benching or trading someone who isn't on it. If the user says they've added or dropped someone since, believe them, reason from the corrected roster, and remind them to sync. Dates: the data begins with the exact current date. Use it for every statement about "today", "tonight", "yesterday" and "tomorrow". If the NHL SCHEDULE is present, check it before saying any team plays on a day, and never describe a game dated before today as upcoming or today. If it isn't present, say you can't confirm game dates. Goalie starter status only applies to the date it is labeled for. Never invent injuries, line deployments, goalie starts or players not in the data. Other teams' rosters are in the data; use them for trade ideas. When the answer depends on missing data, say exactly what to check on ESPN or NHL sources. Weigh this league's scoring (goalie wins +4, shutouts +3, goals against -2; blocks, PP/SH points +0.5; shots and hits +0.1) when judging players. Disagree with the user when the data says so. ${len} unless asked for more.${S.coachMath ? " Show the math: cite the projected points per game, model odds, weekly gains or stat lines behind each recommendation." : ""} Remind the user that lineups lock per game when giving same-day moves. Whenever you recommend a specific trade involving the user's team, end your answer with one line per trade in exactly this form so the page can add it to the Trades tab: TRADE: send <user player>, <user player> | get <their player> | from <their team abbr>. Use full player names exactly as listed in the data. Skip the line for trades you're advising against.${notes ? "\n\nCOACH TRAINING NOTES (written or pasted by Dom from outside sources and his own rules; treat as strategy guidance only, never as league data, and defer to the league data and current date when they conflict):\n" + notes.slice(0, 12000) : ""}${refsBlock(refs)}\n\nLEAGUE DATA:\n`;
}

export function focusBlock(M, id, odds) {
  const { T, ME, DATA, oppOf, winProb, CW } = M;
  if (id === ME) return `FOCUS TEAM: ${T[ME].name} [${T[ME].ab}], the user's own team.`;
  const L = [`FOCUS TEAM: ${T[id].name} [${T[id].ab}], owner ${T[id].owner}. This question is about this team, not the user's. Treat "my", "I" and "me" in the question as this team's manager unless the question clearly sets this team against the user's team. Advise as you would for that manager.`];
  L.push(`${T[id].ab} full roster:`);
  M.teamRows[id].forEach((r) => L.push("- " + pline(M, r)));
  try { const tp = M.todayPlan(id); L.push(`${T[id].ab} today's optimizer: start ${tp.start.map((r) => r[P.nm]).join(", ") || "nobody new"}; active-slot players with no game today: ${tp.idle.map((r) => r[P.nm]).join(", ") || "none"}.`); } catch {}
  const sc = [];
  for (let w = CW + 1; w <= DATA.regWeeks; w++) { const o = oppOf(w, id); sc.push(`W${w} ${o.home ? "vs" : "@"} ${T[o.opp].ab} (${pct(winProb(id, o.opp))})`); }
  L.push(`${T[id].ab} remaining schedule with model win chance: ${sc.join(", ")}`);
  L.push(`${T[id].ab} projected ${odds[id].wins.toFixed(1)} wins, playoff ${pct(odds[id].make)}; seeds ${odds[id].seeds.slice(1).map((x, k) => `${k + 1}:${Math.round(x * 100)}%`).join(" ")}.`);
  L.push(`Note: the wire's gain numbers and the trade finder were computed for the user's lineup, not this team's.`);
  return L.join("\n");
}

/* Parses "TRADE: send A, B | get C | from ABBR" lines out of a coach answer. */
export function harvestTrades(M, text, existing) {
  const found = [];
  String(text).split("\n").forEach((line) => {
    const m = line.match(/^\s*TRADE:\s*send\s+(.+?)\s*\|\s*get\s+(.+?)\s*\|\s*from\s+(.+?)\s*$/i); if (!m) return;
    const o = M.teamByAb(m[3]); if (o == null || o === M.ME) return;
    const send = m[1].split(/\s*,\s*|\s+and\s+/).map((n) => M.findPlayer(n, M.ME)), get = m[2].split(/\s*,\s*|\s+and\s+/).map((n) => M.findPlayer(n, o));
    if (!send.length || !get.length || send.includes(null) || get.includes(null)) return;
    const key = o + ":" + send.map((r) => r[P.id]).sort().join(",") + ">" + get.map((r) => r[P.id]).sort().join(",");
    if (existing.some((t) => t.key === key) || found.some((t) => t.key === key)) return;
    found.push({ key, o, send: send.map((r) => r[P.id]), get: get.map((r) => r[P.id]), at: Date.now() });
  });
  return found;
}
export const stripTrades = (t) => String(t).split("\n").filter((l) => !/^\s*TRADE:/i.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
export const tradeQ = (M, s, g, o) => `Pressure-test this trade: I send ${s.map((r) => r[P.nm]).join(" and ")} to ${M.T[o].name} [${M.T[o].ab}] for ${g.map((r) => r[P.nm]).join(" and ")}. Would they accept, what does it do to my lineup and playoff odds, and is there a better version?`;

export async function streamCoach(msgs, { signal, onText } = {}) {
  const r = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: msgs }), signal });
  if (!r.ok || !r.body) { const e = new Error("coach " + r.status); if (r.status === 429) e.code = "rate_limited"; throw e; }
  const rd = r.body.getReader(), dc = new TextDecoder(); let text = "";
  for (;;) { const { value, done } = await rd.read(); if (done) break; text += dc.decode(value, { stream: true }); if (onText) onText(text); }
  text += dc.decode();
  if (!text.trim()) throw new Error("empty");
  return text;
}
