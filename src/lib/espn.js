/* ESPN sync: direct fetch (usually blocked by CORS), the Grab ESPN bookmarklet / iOS Shortcut, and the parser that turns
   ESPN's raw JSON into this app's snapshot format. */
import { etKey, keyAdd, keyLabel, dayDiff, fmtET } from "./calendar.js";
import { validData, SEASON, LEAGUE_ID, P } from "./model.js";

export const ESPN_BASE = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}`;
export const LEAGUE_URL = ESPN_BASE + "?view=mTeam&view=mRoster&view=mMatchupScore&view=mSettings&view=mStatus";
export const ESPN_LEAGUE_PAGE = `https://fantasy.espn.com/hockey/league?leagueId=${LEAGUE_ID}`;
const FA_FILTER = { players: { filterStatus: { value: ["FREEAGENT", "WAIVERS"] }, filterSlotIds: { value: [0, 1, 2, 3, 4, 6] }, limit: 200, sortPercOwned: { sortPriority: 1, sortAsc: false } } };
const FA_FILTER_G = { players: { filterStatus: { value: ["FREEAGENT", "WAIVERS"] }, filterSlotIds: { value: [5] }, limit: 200, sortPercOwned: { sortPriority: 1, sortAsc: false } } };
const PRO = { 1: "BOS", 2: "BUF", 3: "CGY", 4: "CHI", 5: "DET", 6: "EDM", 7: "CAR", 8: "LA", 9: "DAL", 10: "MTL", 11: "NJ", 12: "NYI", 13: "NYR", 14: "OTT", 15: "PHI", 16: "PIT", 17: "COL", 18: "SJ", 19: "STL", 20: "TB", 21: "TOR", 22: "VAN", 23: "WSH", 25: "ANA", 26: "FLA", 27: "NSH", 28: "WPG", 29: "CBJ", 30: "MIN", 37: "VGK", 124292: "SEA", 129764: "UTA", 0: "FA" };
const EPOS = { 1: "C", 2: "LW", 3: "RW", 4: "D", 5: "G" };
const ESLOT = { 0: "C", 1: "LW", 2: "RW", 3: "F", 4: "D", 5: "G", 6: "UTIL", 7: "BN", 8: "IR" };
const SPARE_C = ["#1e5bb8", "#c8102e", "#6b4fa8", "#a4802a", "#4b6a7d", "#127a6a", "#7a5a3a", "#b4501f", "#0f3f73", "#2f7d2a", "#8a3b6b", "#3d6b8f"];
const r1 = (x) => Math.round((+x || 0) * 10) / 10, r2 = (x) => Math.round((+x || 0) * 100) / 100;

function playerRow(pl, team, slot, acq, yr) {
  const S = {}; (pl.stats || []).forEach((x) => (S[x.id] = x));
  const cur = S["00" + yr] || {}, pr = S["10" + yr] || {}, l7 = S["01" + yr] || {}, last = S["00" + (yr - 1)] || {};
  const cs = cur.stats || {}, g = (k) => Math.round(+cs[k] || 0);
  const gp = cur.appliedAverage ? Math.round(cur.appliedTotal / cur.appliedAverage) : 0;
  const gv = Object.values(pl.proGamePlayerDetail || {}), pos = EPOS[pl.defaultPositionId] || "F";
  return [team, pl.fullName || `${pl.firstName || ""} ${pl.lastName || ""}`.trim(), pos, PRO[pl.proTeamId] ?? String(pl.proTeamId), slot, pl.injuryStatus || "ACTIVE",
    r1(cur.appliedTotal), gp, r2(l7.appliedAverage), r1(pr.appliedTotal), r2(pr.appliedAverage), r1(last.appliedTotal), r1(pl.ownership && pl.ownership.percentOwned),
    pos === "G" ? [g("1"), g("6"), g("4"), g("7"), g("9")] : [g("13"), g("14"), g("38"), g("39"), g("29"), g("31"), g("32")],
    acq, pl.id, gv.length ? 1 : 0, gv.length ? gv[0].starterStatus || null : null];
}

const NHL_URL = () => `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl/seasons/${SEASON}?view=proTeamSchedules_wl`;

/* ESPN lists each game under both clubs; keep one copy as [startMs, homeAbbr, awayAbbr]. */
function scheduleFrom(o) {
  let raw = [];
  if (Array.isArray(o.nhlGames)) raw = o.nhlGames;
  else { const seen = new Set(); ((o.settings && o.settings.proTeams) || []).forEach((t) => Object.values(t.proGamesByScoringPeriod || {}).forEach((a) => a.forEach((g) => { if (!seen.has(g.id)) { seen.add(g.id); raw.push([g.date, g.homeProTeamId, g.awayProTeamId, g.scoringPeriodId]); } }))); }
  const ab = (id) => PRO[id] ?? String(id);
  const games = raw.filter((g) => g && +g[0] > 0).map((g) => [+g[0], ab(g[1]), ab(g[2])]).sort((a, b) => a[0] - b[0]);
  const startsKey = o.espnPeriod ? keyForPeriod(raw, +o.espnPeriod) : null;
  return { games, startsKey, raw };
}

/* ESPN's fantasy day (scoringPeriodId) rolls over hours after midnight Eastern. Anchor each period on its earliest game
   and count days from the nearest one. */
function periodAnchors(raw) { const f = {}; (raw || []).forEach((g) => { const p = +g[3], t = +g[0]; if (p > 0 && t > 0 && (!(p in f) || t < f[p])) f[p] = t; }); return f; }
function periodFor(raw, key) { const f = periodAnchors(raw); let best = null; for (const p in f) { const d = dayDiff(key, etKey(f[p])); if (best === null || Math.abs(d) < Math.abs(best.d)) best = { p: +p, d }; } return best ? best.p + best.d : null; }
function keyForPeriod(raw, sp) { const f = periodAnchors(raw); let best = null; for (const p in f) { const d = sp - p; if (best === null || Math.abs(d) < Math.abs(best.d)) best = { k: etKey(f[p]), d }; } return best ? keyAdd(best.k, best.d) : null; }

export async function fetchSchedule(sig) {
  const r = await fetch(NHL_URL() + "&_=" + Date.now(), { signal: sig, credentials: "omit", cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return scheduleFrom(await r.json());
}

/* Recent adds, drops and trades (last 48h) that ESPN's roster view may not show yet. Applied after the roster parse. */
function applyTxns(D, txns, now) {
  const cut = now - 1728e5, last = {}, moved = [];
  (txns || []).filter((x) => x && x.date >= cut).sort((a, b) => a.date - b.date).forEach((x) => (x.items || []).forEach((i) => { last[i.p] = { to: i.t === "DROP" ? 0 : +i.to || 0 }; }));
  Object.keys(last).forEach((k) => {
    const id = +k, to = last[k].to; let row = D.players.find((r) => +r[P.id] === id); const cur = row ? row[P.tm] : 0;
    if (cur === to || (to && !D.teams[to])) return;
    if (row) D.players.splice(D.players.indexOf(row), 1);
    else { if (!to) return; const fi = D.fa.findIndex((r) => +r[P.id] === id); if (fi < 0) return; row = D.fa.splice(fi, 1)[0]; }
    row[P.tm] = to; row[P.slot] = to ? "BN" : "FA"; if (to) row[P.acq] = "ADD"; (to ? D.players : D.fa).push(row);
    moved.push(`${row[P.nm]} ${to ? "to " + D.teams[to].ab : "to free agency"}`);
  });
  return moved;
}

export function parseEspn(objs, DATA) {
  const ngRaw = objs.find((o) => o && (Array.isArray(o.nhlGames) || (o.settings && Array.isArray(o.settings.proTeams))));
  const lg = objs.find((o) => o && Array.isArray(o.teams));
  const faObjs = objs.filter((o) => o && Array.isArray(o.players) && o.players.length && o.players[0].player);
  const fa = faObjs.length ? { players: faObjs.flatMap((o) => o.players).filter((e, i, a) => a.findIndex((x) => x.player.id === e.player.id) === i) } : null;
  if (!lg && !fa && !ngRaw) throw new Error("That doesn't look like ESPN league data. It should be the raw JSON from the league link.");
  let season = SEASON;
  const base = structuredClone(DATA), notes = [];
  const D = { ...base, source: "sync" };
  const ngl = ngRaw ? scheduleFrom(ngRaw) : null;
  if (ngl && ngl.games.length) { D.games = ngl.games; notes.push(`NHL schedule: ${ngl.games.length} games, ${keyLabel(etKey(ngl.games[0][0]))} to ${keyLabel(etKey(ngl.games[ngl.games.length - 1][0]))}.`); }
  else if (!(D.games && D.games.length)) notes.push("No NHL schedule came with that data. Run the sync again after updating the bookmark so the coach knows game dates.");
  const lgPeriod = lg && (+lg.scoringPeriodId || (lg.status && +lg.status.latestScoringPeriod));
  if (lg || fa) D.startsKey = (ngl && ngl.startsKey) || (ngl && lgPeriod && keyForPeriod(ngl.raw, lgPeriod)) || etKey(Date.now());
  if (lg) {
    if (lg.id && +lg.id !== LEAGUE_ID) throw new Error(`That's league ${lg.id}, not ${LEAGUE_ID}.`);
    if (lg.seasonId) season = +lg.seasonId;
    const rostered = lg.teams.filter((t) => t.roster && Array.isArray(t.roster.entries));
    if (rostered.length < lg.teams.length) throw new Error("Rosters are missing. Use the league link from this page, which includes them.");
    const mem = {}; (lg.members || []).forEach((m) => (mem[m.id] = `${m.firstName || ""} ${m.lastName || ""}`.trim() || m.displayName));
    const teams = {};
    lg.teams.forEach((t, k) => {
      const old = base.teams[t.id] || {}, tc = t.transactionCounter || {};
      teams[t.id] = {
        ab: t.abbrev || old.ab || "T" + t.id,
        name: (t.name || [t.location, t.nickname].filter(Boolean).join(" ") || old.name || "Team " + t.id).trim(),
        owner: (t.owners && mem[t.owners[0]]) || old.owner || "", waiver: t.waiverRank ?? old.waiver ?? 0, projRank: t.currentProjectedRank ?? old.projRank ?? 0,
        draftRank: t.draftDayProjectedRank ?? old.draftRank ?? 0, adds: tc.acquisitions ?? old.adds ?? 0, trades: tc.trades ?? old.trades ?? 0, c: old.c || SPARE_C[k % SPARE_C.length],
      };
    });
    D.teams = teams;
    if (!teams[D.myId]) throw new Error("Your team id isn't in this data.");
    const set = lg.settings || {}, sch = set.scheduleSettings || {};
    if (set.name) D.league = set.name;
    if (sch.matchupPeriodCount) D.regWeeks = sch.matchupPeriodCount;
    if (sch.playoffTeamCount) D.playoffTeams = sch.playoffTeamCount;
    D.season = `${season - 1}–${String(season).slice(2)}`;
    if (Array.isArray(lg.schedule) && lg.schedule.length) {
      const cw = Math.max(1, Math.min(D.regWeeks, (lg.status && lg.status.currentMatchupPeriod) || base.currentWeek));
      const results = {}, schedule = {};
      lg.schedule.forEach((m) => {
        const w = m.matchupPeriodId; if (!m.home || !m.away || w > D.regWeeks) return;
        const pts = (x) => r1(x.totalPointsLive ?? x.totalPoints ?? 0);
        if (w <= cw) (results[w] = results[w] || []).push([m.home.teamId, m.away.teamId, pts(m.home), pts(m.away)]);
        else (schedule[w] = schedule[w] || []).push(`${m.home.teamId}-${m.away.teamId}`);
      });
      Object.keys(schedule).forEach((w) => (schedule[w] = schedule[w].join(",")));
      D.results = results; D.schedule = schedule; D.currentWeek = cw;
      for (let w = 1; w <= D.regWeeks; w++) if (!results[w] && !schedule[w]) throw new Error(`Week ${w} is missing from the schedule. Use the league link from this page.`);
    } else notes.push("No schedule in that data, so scores and the schedule were kept from before.");
    D.players = [];
    rostered.forEach((t) => t.roster.entries.forEach((e) => { const pl = e.playerPoolEntry && e.playerPoolEntry.player; if (pl) D.players.push(playerRow(pl, t.id, ESLOT[e.lineupSlotId] || "BN", e.acquisitionType || "ADD", season)); }));
    D.snapshot = new Date().toISOString();
  }
  if (fa) {
    const av = fa.players.filter((e) => !e.onTeamId);
    D.fa = [...av.filter((e) => e.player.defaultPositionId !== 5), ...av.filter((e) => e.player.defaultPositionId === 5)].map((e) => playerRow(e.player, 0, e.status === "WAIVERS" ? "WV" : "FA", "FA", season));
    D.faSnapshot = new Date().toISOString();
    if (!lg) D.snapshot = base.snapshot;
  }
  const txo = objs.find((o) => o && Array.isArray(o.txns));
  if (lg && txo) { const mv = applyTxns(D, txo.txns, Date.now()); if (mv.length) notes.push(`Applied ${mv.length} recent move${mv.length > 1 ? "s" : ""} the roster feed hadn't caught up with: ${mv.slice(0, 8).join("; ")}${mv.length > 8 ? "..." : ""}.`); }
  if (lg) {
    const idsOf = (r) => new Set(r.filter((x) => x[0] === D.myId).map((x) => x[15])), a = idsOf(base.players), b = idsOf(D.players);
    const nm = (id) => (D.players.find((x) => x[15] === id) || base.players.find((x) => x[15] === id))[1];
    const add = [...b].filter((i) => !a.has(i)).map(nm), drop = [...a].filter((i) => !b.has(i)).map(nm);
    notes.push(add.length || drop.length ? `Your roster changed since the last sync: added ${add.join(", ") || "nobody"}; dropped ${drop.join(", ") || "nobody"}.` : "ESPN shows no roster changes for you since the last sync. If you made a move after that, ESPN may still be serving a cached copy: wait a minute and sync again.");
  }
  const owned = new Set(D.players.map((r) => r[15])), before = D.fa.length;
  D.fa = D.fa.filter((r) => !owned.has(r[15]));
  if (!fa && before > D.fa.length) notes.push(`${before - D.fa.length} free agents dropped because they're now rostered.`);
  if (!validData(D)) throw new Error("The data came through incomplete, so nothing was changed.");
  const summary = [lg ? `${Object.keys(D.teams).length} teams, ${D.players.length} rostered players, week ${D.currentWeek}` : null, fa ? `${D.fa.length} free agents` : "free agents kept from " + fmtET(D.faSnapshot || base.snapshot)].filter(Boolean).join(" · ");
  return { D, summary, notes };
}

export function splitJson(text) {
  text = text.trim(); if (!text) return [];
  try { return [JSON.parse(text)]; } catch {}
  const out = []; let depth = 0, start = -1, inS = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inS) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inS = false; continue; }
    if (c === '"') inS = true;
    else if (c === "{") { if (!depth) start = i; depth++; }
    else if (c === "}") { depth--; if (!depth && start >= 0) { try { out.push(JSON.parse(text.slice(start, i + 1))); } catch {} start = -1; } }
  }
  if (!out.length) throw new Error("Couldn't read that as JSON. Make sure you copied the whole page, from the first { to the last }.");
  return out;
}

/* ESPN returns free agents a page at a time; keep paging until a page adds nobody new. */
async function pageFA(F, sig, q = "") {
  const all = [], seen = new Set();
  for (let off = 0, n = 0; n < 25; n++, off += 200) {
    const f = { players: { ...F.players, limit: 200, offset: off } };
    const r = await fetch(ESPN_BASE + "?view=kona_player_info" + q, { signal: sig, credentials: "omit", cache: "no-store", headers: { "X-Fantasy-Filter": JSON.stringify(f) } });
    if (!r.ok) break;
    const ps = (await r.json()).players || []; let add = 0;
    ps.forEach((e) => { const id = e.player && e.player.id; if (id != null && !seen.has(id)) { seen.add(id); all.push(e); add++; } });
    if (!add) break;
  }
  return all;
}

export async function tryDirect() {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 60000);
  try {
    let sc = null, sp = null;
    try { sc = await fetchSchedule(ctl.signal); sp = periodFor(sc.raw, etKey(Date.now())); } catch {}
    const q = sp ? `&scoringPeriodId=${sp}&_=${Date.now()}` : "";
    const lr = await fetch(LEAGUE_URL + q, { signal: ctl.signal, credentials: "omit", cache: "no-store" });
    if (!lr.ok) throw new Error("HTTP " + lr.status);
    const objs = [await lr.json()];
    try { const a = await pageFA(FA_FILTER, ctl.signal, q); if (a.length) objs.push({ players: a }); } catch {}
    try { const a = await pageFA(FA_FILTER_G, ctl.signal, q); if (a.length) objs.push({ players: a }); } catch {}
    if (sc && sc.games.length) objs.push({ nhlGames: sc.raw, espnPeriod: sp });
    return objs;
  } finally { clearTimeout(t); }
}

/* The bookmarklet runs on espn.com with the user's cookies, pulls everything, and copies it to the clipboard. */
export function bookmarklet(tmr, shortcut) {
  const F = JSON.stringify(FA_FILTER), FG = JSON.stringify(FA_FILTER_G), Q = "?view=mTeam&view=mRoster&view=mMatchupScore&view=mSettings&view=mStatus";
  const core = `try{const o={credentials:"include",cache:"no-store"};
let gs=[];try{t.textContent="Grabbing NHL schedule…";const sn=B.split("/seasons/")[1].split("/")[0];const nr=await fetch("https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl/seasons/"+sn+"?view=proTeamSchedules_wl&_="+Date.now(),{cache:"no-store"});const nj=await nr.json();const seen={};((nj.settings&&nj.settings.proTeams)||[]).forEach(tm=>{Object.values(tm.proGamesByScoringPeriod||{}).forEach(a=>{a.forEach(g=>{if(!seen[g.id]){seen[g.id]=1;gs.push([g.date,g.homeProTeamId,g.awayProTeamId,g.scoringPeriodId])}})})})}catch(e){}
const EF=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}),ek=ms=>EF.format(new Date(ms)),dd=(a,b)=>Math.round((Date.parse(a+"T12:00:00Z")-Date.parse(b+"T12:00:00Z"))/864e5);
const fst={};gs.forEach(g=>{const p=+g[3],d=+g[0];if(p>0&&d>0&&(!(p in fst)||d<fst[p]))fst[p]=d});
let sp=null,bd=null;const td=ek(Date.now());for(const p in fst){const d=dd(td,ek(fst[p]));if(bd===null||Math.abs(d)<Math.abs(bd)){bd=d;sp=+p+d}}
${tmr ? "if(sp)sp++;" : ""}
let P=sp?"&_="+Date.now()+"&scoringPeriodId="+sp:"";
${tmr ? `if(!P){try{const s=(await(await fetch(B+"?view=mStatus&_="+Date.now(),o)).json()).status;P="&_="+Date.now()+"&scoringPeriodId="+(s.transactionScoringPeriod||s.latestScoringPeriod+1)}catch(e){}}` : ""}
t.textContent="Grabbing league and free agents…";
const lr=await fetch(B+${JSON.stringify(Q)}+P,o);if(!lr.ok)throw new Error("league "+lr.status);const lg=await lr.text();
const KEEP=["1","6","4","7","9","13","14","38","39","29","31","32"];
const slim=e=>{const p=e.player||{};return{status:e.status,onTeamId:e.onTeamId,player:{id:p.id,fullName:p.fullName,firstName:p.firstName,lastName:p.lastName,defaultPositionId:p.defaultPositionId,proTeamId:p.proTeamId,injuryStatus:p.injuryStatus,ownership:{percentOwned:p.ownership&&p.ownership.percentOwned},proGamePlayerDetail:p.proGamePlayerDetail,stats:(p.stats||[]).filter(s=>/^(00|10|01)20\\d\\d$/.test(s.id)).map(s=>{const k={};KEEP.forEach(i=>{if(s.stats&&s.stats[i]!=null)k[i]=s.stats[i]});return{id:s.id,appliedTotal:s.appliedTotal,appliedAverage:s.appliedAverage,stats:k}})}}};
const FL=[${F},${FG}];let fa="",nfa=0;
for(const FF of FL){const all=[],seen=new Set();
try{for(let off=0,n=0;n<25;n++,off+=200){const f={players:{...FF.players,limit:200,offset:off}};
const r=await fetch(B+"?view=kona_player_info"+P,{...o,headers:{"X-Fantasy-Filter":JSON.stringify(f)}});if(!r.ok)break;
const ps=(await r.json()).players||[];let add=0;
ps.forEach(e=>{const id=e.player&&e.player.id;if(id!=null&&!seen.has(id)){seen.add(id);all.push(slim(e));add++}});
t.textContent="Grabbing free agents… "+(nfa+all.length);if(!add)break}}catch(e){}
if(all.length){fa+=(fa?" ":"")+JSON.stringify({players:all});nfa+=all.length}}
const mm=/scoringPeriodId=(\\d+)/.exec(P);const ngn=gs.length;const ng=gs.length?JSON.stringify({nhlGames:gs,espnPeriod:mm?+mm[1]:null}):"";
let tx="";try{t.textContent="Grabbing recent moves...";const xr=await fetch(B+"?view=mTransactions2"+P,o);if(xr.ok){const xj=await xr.json();const sl=(xj.transactions||[]).filter(x=>x.status==="EXECUTED"&&(x.processDate||x.proposedDate)>Date.now()-6048e5).map(x=>({type:x.type,teamId:x.teamId,date:x.processDate||x.proposedDate,items:(x.items||[]).filter(i=>i.type==="ADD"||i.type==="DROP"||i.type==="TRADE").map(i=>({p:i.playerId,t:i.type,f:i.fromTeamId,to:i.toTeamId}))}));if(sl.length)tx=JSON.stringify({txns:sl})}}catch(e){}
const out=lg+(fa?"\\n"+fa:"")+(ng?"\\n"+ng:"")+(tx?"\\n"+tx:"");`;
  const ui = `(async()=>{const B=${JSON.stringify(ESPN_BASE)};
if(!/(^|\\.)espn\\.com$/.test(location.hostname)){alert("Open an ESPN Fantasy page first, then tap Grab ESPN.");return}
const ov=document.createElement("div");ov.style.cssText="position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.65);display:grid;place-items:center;font:16px system-ui,sans-serif";
const bx=document.createElement("div");bx.style.cssText="background:#fff;color:#111;padding:22px;border-radius:14px;width:min(360px,90vw);display:grid;gap:14px;text-align:center";
const t=document.createElement("div");t.textContent="Grabbing league and free agents…";bx.append(t);ov.append(bx);document.body.append(ov);
const btn=(l,f,p)=>{const b=document.createElement("button");b.textContent=l;b.style.cssText="font:600 16px system-ui;padding:12px;border-radius:10px;border:0;cursor:pointer;"+(p?"background:#c8102e;color:#fff":"background:#eee;color:#111");b.onclick=f;bx.append(b);return b};
${core}
const done=()=>{t.textContent="Copied"+(fa?" league + "+nfa+" free agents":" league (free agents failed)")+(ngn?" + "+ngn+" NHL games.":" (NHL schedule failed).")+" Go back to Center Ice and tap Paste & import.";c.remove();btn("Close",()=>ov.remove())};
const c=btn("Copy to clipboard",async()=>{try{await navigator.clipboard.writeText(out);done()}catch(e){const a=document.createElement("textarea");a.value=out;a.style.cssText="width:100%;height:90px";bx.insertBefore(a,c);a.select();try{document.execCommand("copy");done()}catch(_){t.textContent="Select the text and copy it."}}},1);
t.textContent="Got it ("+Math.round(out.length/1024)+" KB). Tap to copy.";
}catch(e){t.textContent="ESPN refused: "+e.message+". Make sure you're on fantasy.espn.com.";btn("Close",()=>ov.remove())}})()`;
  const shortSrc = `try{let dn=0;const fin=v=>{if(!dn){dn=1;completion(v)}};setTimeout(()=>fin("ERROR: timed out after 45 seconds"),45000);
(async()=>{const B=${JSON.stringify(ESPN_BASE)};const t={};
${core}
fin(out)}catch(e){fin("ERROR: "+e.message)}})().catch(e=>fin("ERROR: "+e.message))}catch(e){completion("ERROR: "+e.message)}`;
  /* iPhone Userscripts extension: a floating "Grab ESPN" button on fantasy.espn.com that runs the same grab. */
  if (shortcut === "user") {
    const one = core.replace(/\n/g, "").replace(/…/g, "...");
    return `// ==UserScript==
// @name Grab ESPN for Center Ice${tmr ? " (tomorrow)" : ""}
// @match https://fantasy.espn.com/*
// @run-at document-end
// @grant none
// ==/UserScript==
(function(){if(document.getElementById("ci-grab"))return;
const B=${JSON.stringify(ESPN_BASE)};
const b=document.createElement("button");b.id="ci-grab";b.textContent="Grab ESPN";
b.style.cssText="position:fixed;right:14px;bottom:90px;z-index:2147483647;padding:12px 16px;border:0;border-radius:24px;background:#c8102e;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4)";
document.body.appendChild(b);
b.onclick=async()=>{const t={set textContent(v){b.textContent=v}};b.disabled=true;
${one}
b.disabled=false;b.textContent="Got it ("+Math.round(out.length/1024)+" KB). Tap to copy";
b.onclick=async()=>{try{await navigator.clipboard.writeText(out);b.textContent="Copied. Go to Center Ice, tap Paste & import"}catch(e){const a=document.createElement("textarea");a.value=out;a.style.cssText="position:fixed;left:5vw;top:20vh;width:90vw;height:40vh;z-index:2147483647";document.body.appendChild(a);a.select();b.textContent="Copy the text in the box, then close this"}};
}catch(e){b.disabled=false;b.textContent="Failed: "+e.message+" (tap to retry)"}};
})();
`;
  }
  if (shortcut) return shortSrc.replace(/\n/g, "").replace(/…/g, "...");
  return "javascript:" + encodeURIComponent(ui.replace(/\n/g, ""));
}
