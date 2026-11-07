/* Settings: look, layout, coach, playoff model and data. Look and coach keys apply at once; model keys wait in
   `pend` until Recalculate (which now re-runs the model and workers in place instead of reloading the page). */
import { Fragment, useEffect, useRef, useState } from "react";
import { useApp } from "../ctx.js";
import { DEF, LOOK_KEYS, MODEL_KEYS } from "../lib/settings.js";
import { lsGet, lsSet, lsDel, ssSet, idbGet } from "../lib/storage.js";
import { etKey, keyLabel, whenET, fmtET } from "../lib/calendar.js";
import { tryDirect, parseEspn, splitJson, bookmarklet, LEAGUE_URL, ESPN_LEAGUE_PAGE } from "../lib/espn.js";
import { REF_ITEM_MAX, refId, isVideo, readRefFile } from "../lib/refs.js";
import { REF_BUDGET, REF_KIND } from "../lib/coach.js";
import { Pill } from "../components/ui.jsx";

const CATS = [["look", "Look", "Theme, color schemes and the liquid glass effect."], ["layout", "Layout", "Text, spacing, the toolbar, popups and which views open first."], ["coach", "Coach", "How the coach answers, your own rules, and the references it reads."], ["model", "Playoff model", "Inputs to the playoff simulation. Changes need a recalculation."], ["data", "Data", "Sync from ESPN, what's stored, and reset."]];
const FMT = { glassOp: (v) => v + "%", glassBlur: (v) => v + "px", glassSat: (v) => v + "%", glow: (v) => v + "%", projW: (v) => `${v}% / ${100 - v}%`, sd: (v) => `±${v} pts`, gpw: (v) => (+v).toFixed(1) };
const PALS = [["rink", "#1747a6", "#c8102e", "#e9f0f5", "Rink", "Blue line, goal light"], ["coast", "#0b7a85", "#d9472b", "#e2f2f2", "Coast", "Teal and coral"], ["amber", "#3b4a5c", "#a86200", "#eceae4", "Penalty box", "Slate and amber"], ["royal", "#5a3fa0", "#9a6d00", "#ece7f5", "Royal", "Purple and gold"], ["forest", "#1f6b45", "#b5651d", "#e3efe7", "Evergreen", "Pine and copper"], ["sunset", "#b8336a", "#e06c00", "#f7e6ea", "Sunset", "Rose and orange"], ["glacier", "#2a6f97", "#0096c7", "#e1eef5", "Glacier", "Ice blues"], ["graphite", "#3d4650", "#d0021b", "#e8eaed", "Graphite", "Grey with a red pop"], ["neon", "#6b2bd9", "#00a58e", "#ece6f8", "Night game", "Violet and mint"], ["custom", "var(--c1)", "var(--c2)", "var(--c3)", "Custom", "Your two colors below"]];

/* ---- controls ---- */
function useCur() { const { S, pend } = useApp(); return (k) => (k in pend ? pend[k] : S[k]); }

/* Radio group with roving tabindex and arrow keys, as the ARIA radiogroup pattern expects. */
function Seg({ k, opts, label, className = "", render }) {
  const { setKey } = useApp(); const cur = useCur(); const v = String(cur(k)); const ref = useRef(null);
  const move = (e) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0; if (!d) return;
    e.preventDefault(); const i = opts.findIndex((o) => String(o[0]) === v), n = opts[(i + d + opts.length) % opts.length];
    setKey(k, n[0]); requestAnimationFrame(() => ref.current?.querySelector(`[data-v="${n[0]}"]`)?.focus());
  };
  return (
    <div className={`seg ${className}`.trim()} role="radiogroup" aria-label={label} ref={ref} onKeyDown={move}>
      {opts.map((o) => { const on = String(o[0]) === v; return (
        <button key={o[0]} type="button" role="radio" data-v={o[0]} aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => setKey(k, o[0])} {...(render ? render.props(o) : {})}>{render ? render.body(o) : o[1]}</button>
      ); })}
    </div>
  );
}
function Sw({ k, label }) { const { setKey } = useApp(); const cur = useCur(); return <input type="checkbox" className="sw" checked={!!cur(k)} aria-label={label} onChange={(e) => setKey(k, e.target.checked)} />; }
function Rng({ k, min, max, step, label }) {
  const { setKey } = useApp(); const cur = useCur(); const v = cur(k);
  return <div className="rng"><input type="range" min={min} max={max} step={step} value={v} aria-label={label} aria-valuetext={FMT[k] ? FMT[k](v) : String(v)} onChange={(e) => setKey(k, e.target.value)} /><output>{FMT[k] ? FMT[k](v) : v}</output></div>;
}
function Sel({ k, opts, label, id }) { const { setKey } = useApp(); const cur = useCur(); return <select id={id} value={String(cur(k))} aria-label={label} onChange={(e) => setKey(k, e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>; }
const Row = ({ l, d, children, className = "" }) => <div className={`set-row ${className}`.trim()}><div><span className="lbl">{l}</span>{d && <span className="desc">{d}</span>}</div><div className="ctl">{children}</div></div>;
const Group = ({ title, extra, className = "", id, children }) => <div className={`set-group ${className}`.trim()} id={id}><header><h3>{title}</h3>{extra}</header>{children}</div>;
const Msg = ({ m }) => (m && m.text ? <div className={"sync-msg " + m.cls} role="status">{m.text}</div> : null);

/* Button that shows a short confirmation in place of its label. */
function FlashBtn({ label, onClick, className = "btn ghost" }) {
  const [t, setT] = useState(null), timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <button className={className} type="button" onClick={async () => { const r = await onClick(); if (r) { setT(r); clearTimeout(timer.current); timer.current = setTimeout(() => setT(null), 2500); } }}>{t || label}</button>;
}

/* "Tap again" confirmation for destructive buttons. */
function ArmBtn({ label, armed: armedLabel = "Tap again to confirm", onConfirm, className = "btn ghost" }) {
  const [armed, setArmed] = useState(false), timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <button className={`${className}${armed ? " armed" : ""}`} type="button" onClick={() => {
    if (!armed) { setArmed(true); timer.current = setTimeout(() => setArmed(false), 4000); return; }
    clearTimeout(timer.current); setArmed(false); onConfirm();
  }}>{armed ? armedLabel : label}</button>;
}

/* ---- sections ---- */
function Look() {
  return <>
    <Group title="Theme & colors">
      <Row l="Look" d="Ice glass is the navy and ice-blue design with red kept for the main action. Classic is the earlier rink-sheet look. Theme, color scheme and glass settings still apply to both."><Seg k="skin" label="Look" opts={[["ice", "Ice glass"], ["classic", "Classic"]]} /></Row>
      <Row l="Toolbar" d="Icons shows Home, Lineup, Coach, Wire and Trades, with Standings, Points and Settings under More on phones. Text shows every tab as a word."><Seg k="nav" label="Toolbar" opts={[["icons", "Icons"], ["text", "Text"]]} /></Row>
      <Row l="Theme" d="System follows your device's light or dark setting."><Seg k="mode" label="Theme" opts={[["system", "System"], ["light", "Light"], ["dark", "Dark"]]} /></Row>
      <Row className="stack" l="Color scheme" d="Sets the structure color (tabs, headers, bars) and your club color (your team, buttons, live markers). Surface tint and glow below control how strongly it washes the page.">
        <Seg k="palette" label="Color scheme" className="pal-grid" opts={PALS} render={{
          props: (o) => ({ className: "pal", style: { "--p1": o[1], "--p2": o[2], "--p3": o[3] } }),
          body: (o) => <><span className="pal-sw"><i /><i /><i /></span><span className="pal-nm">{o[4]}</span><span className="pal-ds">{o[5]}</span></>,
        }} />
      </Row>
      <Row l="Custom colors" d="Pick any two colors. Choosing one switches the scheme to Custom. Dark mode lightens them automatically."><CPicks /></Row>
      <Row l="Surface tint" d="How much the scheme color tints the background and glass."><Seg k="tint" label="Surface tint" opts={[["none", "None"], ["subtle", "Subtle"], ["rich", "Rich"]]} /></Row>
      <Row l="Background glow" d="Strength of the colored light behind the glass."><Rng k="glow" min={0} max={200} step={10} label="Background glow" /></Row>
    </Group>
    <Group title="Liquid glass" id="glass-ctl">
      <Row l="Liquid glass" d="Off makes every surface solid with no blur."><Sw k="glass" label="Liquid glass" /></Row>
      <Row l="Opacity" d="Lower is more see-through."><Rng k="glassOp" min={15} max={100} step={1} label="Glass opacity" /></Row>
      <Row l="Blur" d="How much the glass frosts what's behind it."><Rng k="glassBlur" min={0} max={40} step={1} label="Glass blur" /></Row>
      <Row l="Color saturation" d="How vivid colors look through the glass."><Rng k="glassSat" min={100} max={240} step={5} label="Glass saturation" /></Row>
      <Row l="Glass tint" d="Neutral glass, or glass tinted with the scheme color."><Seg k="glassTint" label="Glass tint" opts={[["neutral", "Neutral"], ["accent", "Scheme color"]]} /></Row>
      <Row l="Highlights and rim light" d="The bright top edge, specular sheen and the moving rim on the toolbar."><Sw k="glassSpec" label="Highlights and rim light" /></Row>
      <Row l="Pointer glint" d="Soft highlight that follows the mouse on cards."><Sw k="glassGlint" label="Pointer glint" /></Row>
      <Row l="Lens refraction" d="The selected tab bends what's behind it. Chrome and Edge only."><Sw k="glassRefract" label="Lens refraction" /></Row>
      <Row l="Shadow depth" d="Drop shadow under cards and the toolbar."><Seg k="shadow" label="Shadow depth" opts={[["none", "None"], ["soft", "Soft"], ["deep", "Deep"]]} /></Row>
    </Group>
  </>;
}

function CPicks() {
  const { S, setKey } = useApp();
  return <div className="cpicks">
    <label className="cpick"><input type="color" value={S.cBlue} aria-label="Structure color" onChange={(e) => setKey("cBlue", e.target.value)} /><span>Structure</span></label>
    <label className="cpick"><input type="color" value={S.cGoal} aria-label="Club color" onChange={(e) => setKey("cGoal", e.target.value)} /><span>Club</span></label>
  </div>;
}

function Layout() {
  const { setMany } = useApp();
  return <>
    <Group title="Text & motion">
      <Row l="Font" d="Typeface for headings and text. Numbers keep their mono face."><Sel k="font" label="Font" opts={[["default", "Rink (condensed)"], ["clean", "Clean (Inter)"], ["system", "System"], ["serif", "Serif (Lora)"], ["rounded", "Rounded (Nunito)"], ["mono", "Mono (Plex)"]]} /></Row>
      <Row l="Text size" d="Scales the page content."><Seg k="size" label="Text size" opts={[["xs", "XS"], ["s", "S"], ["m", "Default"], ["l", "L"], ["xl", "XL"]]} /></Row>
      <Row l="High-contrast text" d="Darker secondary text and stronger outlines."><Sw k="contrast" label="High-contrast text" /></Row>
      <Row l="Reduce motion" d="Stops the live-score pulse and bar animations."><Sw k="motion" label="Reduce motion" /></Row>
    </Group>
    <Group title="Spacing & shape">
      <Row l="Density" d="Compact tightens padding in tables, rosters and cards."><Seg k="density" label="Density" opts={[["comfy", "Comfortable"], ["compact", "Compact"]]} /></Row>
      <Row l="Corners" d="Roundness of cards, buttons and the toolbar."><Seg k="corners" label="Corners" opts={[["sharp", "Sharp"], ["soft", "Soft"], ["round", "Round"]]} /></Row>
      <Row l="Content width" d="Maximum page width on tablets and larger screens."><Seg k="width" label="Content width" opts={[["narrow", "Narrow"], ["default", "Default"], ["wide", "Wide"], ["full", "Full"]]} /></Row>
    </Group>
    <Group title="Toolbar">
      <Row l="Phone position" d="Where the tab bar sits on a phone."><Seg k="dock" label="Phone position" opts={[["bottom", "Bottom"], ["top", "Top"]]} /></Row>
      <Row l="Tablet position" d="Sidebar side, or a bottom bar like the phone."><Seg k="side" label="Tablet position" opts={[["left", "Left"], ["right", "Right"], ["bottom", "Bottom"]]} /></Row>
      <Row l="Toolbar size" d="Tab label size and tap area."><Seg k="dsize" label="Toolbar size" opts={[["s", "Small"], ["m", "Default"], ["l", "Large"]]} /></Row>
      <Row l="Label style" d="All caps or regular case tab names."><Seg k="dlabel" label="Label style" opts={[["caps", "CAPS"], ["title", "Title"]]} /></Row>
      <Row l="Shrink on scroll" d="The phone tab bar shrinks while you scroll down and returns when you scroll up."><Sw k="dockShrink" label="Shrink on scroll" /></Row>
    </Group>
    <Group title="Menus & popups">
      <Row l="Popup style" d="Upgrades, goalie starters and other popups."><Seg k="menu" label="Popup style" opts={[["solid", "Solid"], ["glass", "Glass"]]} /></Row>
      <Row l="Backdrop dim" d="How much the page darkens behind a popup."><Seg k="dim" label="Backdrop dim" opts={[["light", "Light"], ["medium", "Medium"], ["heavy", "Heavy"]]} /></Row>
      <div className="set-actions"><button className="btn ghost" type="button" onClick={() => setMany(Object.fromEntries(LOOK_KEYS.map((k) => [k, DEF[k]])))}>Reset appearance</button><span className="note">Restores every Look and Layout setting to its default.</span></div>
    </Group>
    <Group title="Default views">
      <Row l="Open to" d="Tab shown when the page loads. A link with #tab in it still wins."><Sel k="startTab" label="Open to" opts={[["last", "Last viewed"], ["week", "Home"], ["board", "Standings"], ["roster", "Lineup"], ["pts", "Points"], ["wire", "Wire"], ["deals", "Trades"], ["coach", "Coach"]]} /></Row>
      <Row l="Roster tab shows" d="Which club the Roster tab opens on."><Seg k="rosterDefault" label="Roster tab shows" opts={[["me", "My team"], ["last", "Last viewed"]]} /></Row>
      <Row l="Wire default filter" d="Starting filter on the Wire tab."><Sel k="wireDefault" label="Wire default filter" opts={[["all", "All players"], ["F", "Forwards"], ["D", "Defense"], ["G", "Goalies"], ["game", "Playing today"]]} /></Row>
      <Row l="Hide unavailable free agents" d="Drops IR, OUT and suspended players from the wire list. Day-to-day players stay."><Sw k="hideInjFA" label="Hide unavailable free agents" /></Row>
    </Group>
  </>;
}

function Model() {
  const { S, pend, setPend, recalc } = useApp();
  const dirty = MODEL_KEYS.some((k) => k in pend && pend[k] !== S[k]);
  return (
    <Group title="Playoff model" className="wide" extra={dirty && <span className="note">Unsaved changes</span>}>
      <Row l="Projection vs results" d="How much each team's weekly mean leans on roster projections versus points scored so far. Lower it as the season matures."><Rng k="projW" min={0} max={100} step={5} label="Projection weight" /></Row>
      <Row l="Weekly volatility" d="Standard deviation of a team's weekly score. Higher means more upsets and flatter odds."><Rng k="sd" min={10} max={35} step={1} label="Weekly volatility" /></Row>
      <Row l="Games per week" d="Average NHL games per rostered player per week. Used by lineup strength, playoff odds and the trade finder. Wire gains and Optimize use each team's real NHL schedule when it is loaded, and fall back to this number when it is not."><Rng k="gpw" min={2.5} max={4.5} step={0.1} label="Games per week" /></Row>
      <Row l="Simulations" d="More seasons means steadier odds and a slower load."><Seg k="sims" label="Simulations" opts={[[5000, "5k"], [20000, "20k"], [50000, "50k"]]} /></Row>
      <div className="set-actions">
        <button className="btn" type="button" onClick={recalc} disabled={!dirty}>Recalculate</button>
        <button className="btn ghost" type="button" onClick={() => setPend(Object.fromEntries(MODEL_KEYS.map((k) => [k, DEF[k]])))}>Restore defaults</button>
        <span className="note">Running: {S.projW}% projections, ±{S.sd} weekly, {S.gpw.toFixed(1)} games/wk, {S.sims.toLocaleString()} seasons.</span>
      </div>
    </Group>
  );
}

function CoachSet() {
  const { M, S, setKey } = useApp();
  const { T, ME, ranked } = M;
  const n = (S.coachNotes || "").length;
  return (
    <Group title="Coach answers">
      <Row l="Default team" d="Team the coach's question dropdown starts on."><Sel k="coachTeam" label="Default coach team" opts={[["me", `${T[ME].name} (you)`], ...ranked.map((t) => t.id).filter((i) => i !== ME).map((i) => [String(i), T[i].name])]} /></Row>
      <Row l="Answer length" d="Word budget the coach aims for unless you ask for more."><Seg k="coachLen" label="Answer length" opts={[["short", "Short"], ["std", "Standard"], ["long", "Detailed"]]} /></Row>
      <Row l="Show the math" d="Coach cites the projections, odds and stat lines behind each call."><Sw k="coachMath" label="Show the math" /></Row>
      <Row l="Starter questions" d="Quick-ask buttons above the chat."><Sw k="starters" label="Starter questions" /></Row>
      <div className="set-row notes-row">
        <div><span className="lbl">Your rules</span><span className="desc">Short strategy rules you want the coach to follow. Longer material goes in Coach references. Sent to the coach with every question. League data and today's date still override anything here. Saved in this browser only.</span></div>
        <textarea id="coachNotes" rows={8} maxLength={12000} spellCheck placeholder="Paste a transcript, key takeaways or your own rules here." aria-label="Coach training notes" value={S.coachNotes} onChange={(e) => setKey("coachNotes", e.target.value)} />
        <div className="note" aria-live="polite">{n ? `${n.toLocaleString()} / 12,000 characters saved` : "No notes saved."}</div>
      </div>
    </Group>
  );
}

function Refs() {
  const { refs, setRefs } = useApp();
  const [mode, setMode] = useState("link");
  const [url, setUrl] = useState(""), [title, setTitle] = useState(""), [text, setText] = useState("");
  const [edit, setEdit] = useState(null), [msg, setMsg] = useState(null);
  const top = useRef(null);
  const on = refs.filter((r) => r.on && (r.text || "").trim()), chars = on.reduce((n, r) => n + r.text.trim().length, 0);
  const save = async (next) => { const ok = await setRefs(next); if (!ok) setMsg({ cls: "err", text: "This browser couldn't store the references. Remove a large one and try again." }); return ok; };
  const reset = () => { setEdit(null); setUrl(""); setTitle(""); setText(""); };
  const hint = mode !== "link" ? "" : isVideo(url.trim()) ? "For a YouTube video: open its description, tap Show transcript, select it all and paste it above. Your own takeaways work too." : url.trim() ? "Paste the article text (or the parts that matter) above. The coach can't open the link itself." : "";

  const submit = () => {
    const u = url.trim(), t = text.replace(/\r/g, "").trim(); let ti = title.trim();
    if (mode === "link") {
      if (!/^https?:\/\/\S+$/i.test(u)) { setMsg({ cls: "err", text: "Enter a full link starting with https://" }); return; }
      if (!ti) { try { const x = new URL(u), h = x.hostname.replace(/^www\./, ""); ti = isVideo(u) ? "Video on " + h : h + (x.pathname.length > 1 ? x.pathname : ""); } catch { ti = u; } }
    } else if (!t) { setMsg({ cls: "err", text: "Paste some text first." }); return; }
    if (!ti) ti = t.split("\n")[0].slice(0, 80) || "Notes";
    const cut = t.length > REF_ITEM_MAX;
    const rec = { kind: mode === "link" ? (isVideo(u) ? "video" : "article") : "text", title: ti, url: mode === "link" ? u : "", text: t.slice(0, REF_ITEM_MAX) };
    const old = edit && refs.find((r) => r.id === edit);
    /* Functional updates keyed by id: the list may have changed (another tab, a file still being read) since render. */
    const fresh = { id: refId(), on: true, added: new Date().toISOString(), ...rec };
    save((cur) => (old
      ? cur.map((r) => (r.id !== old.id ? r : { ...r, ...rec, ...(r.kind === "file" ? { kind: "file", url: r.url } : {}), ...(rec.text ? { on: true } : {}) }))
      : [fresh, ...cur]));
    setMsg({ cls: "ok", text: `${old ? "Updated" : "Added"} "${ti}".${cut ? ` Trimmed to ${REF_ITEM_MAX.toLocaleString()} characters.` : ""}${rec.text ? " The coach will use it in your next new chat." : " Add its transcript or text with Edit so the coach can use it."}` });
    reset();
  };
  const files = async (fs) => {
    const done = [], bad = [], add = [];
    setMsg({ cls: "ok", text: `Reading ${fs.length} file${fs.length > 1 ? "s" : ""}…` });
    for (const f of fs) {
      try { const t = await readRefFile(f); add.push({ id: refId(), kind: "file", title: f.name.replace(/\.[^.]+$/, ""), file: f.name, url: "", text: t.slice(0, REF_ITEM_MAX), on: true, added: new Date().toISOString() }); done.push(f.name + (t.length > REF_ITEM_MAX ? " (trimmed)" : "")); }
      catch (e) { bad.push(`${f.name}: ${e.message || "couldn't be read"}`); }
    }
    if (add.length) await save((cur) => [...add.reverse(), ...cur]);
    setMsg({ cls: bad.length ? "err" : "ok", text: [done.length ? `Added ${done.join(", ")}.` : "", bad.length ? `Not added: ${bad.join("; ")}.` : ""].filter(Boolean).join(" ") });
  };
  const startEdit = (r) => {
    setEdit(r.id); setMode(r.kind === "video" || r.kind === "article" ? "link" : "text");
    setUrl(r.url || ""); setTitle(r.title); setText(r.text || ""); setMsg(null);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const show = (f) => f.split(" ").includes(mode);
  const modes = [["link", "Video or article link"], ["file", "Upload files"], ["text", "Paste text"]];

  return (
    <Group title="Coach references" id="refs-group" extra={refs.length > 0 && <span className="note">{on.length} of {refs.length} in use</span>}>
      <div className="set-row stack" ref={top}>
        <div><span className="lbl">Add a reference</span><span className="desc">Videos, articles, files or notes the coach should know. The coach reads the text you give it, not the link, so paste a transcript or the article text with each link. Files are read in this browser. League data and today's date still win over anything here. Changes apply when you start a new coach chat (Clear).</span></div>
        <div className="ref-form">
          <div className="ref-modes" role="radiogroup" aria-label="Reference type">
            {modes.map(([m, l]) => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => { setMode(m); setMsg(null); }}>{l}</button>)}
          </div>
          {show("link") && <input className="ref-in" type="url" inputMode="url" placeholder="https://youtube.com/… or an article link" aria-label="Link" value={url} onChange={(e) => setUrl(e.target.value)} />}
          {show("link text") && <input className="ref-in" type="text" placeholder="Title (optional)" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />}
          {show("link text") && <textarea className="ref-in" rows={6} placeholder="Paste the transcript, article text or your takeaways" aria-label="Reference text" value={text} onChange={(e) => setText(e.target.value)} />}
          {show("link") && hint && <div className="note">{hint}</div>}
          {show("file") && <div className="ref-file"><label className="btn ghost filebtn">Choose files<input type="file" multiple hidden accept=".txt,.md,.markdown,.csv,.tsv,.json,.srt,.vtt,.html,.htm,.xml,.pdf,.docx,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) files(fs); }} /></label><span className="note">PDF, Word (.docx), text, Markdown, CSV, HTML and subtitle files (.srt, .vtt), up to 15 MB each. Video, audio and image files can't be read; paste a transcript instead.</span></div>}
          {mode !== "file" && <div className="ref-btns"><button className="btn" type="button" onClick={submit}>{edit ? "Save changes" : "Add reference"}</button>{edit && <button className="btn ghost" type="button" onClick={() => { reset(); setMsg(null); }}>Cancel edit</button>}</div>}
          <Msg m={msg} />
        </div>
      </div>
      <div className="set-row stack">
        <div><span className="lbl">Saved references</span><span className="desc">{on.length ? `${chars.toLocaleString()} characters in use.${chars > REF_BUDGET ? ` The coach gets ${REF_BUDGET.toLocaleString()} per question, so each reference is trimmed to an even share.` : ""} Saved in this browser.` : "Nothing in use yet. Add a reference above, or turn one on below."}</span></div>
        <div className="refs">{refs.length ? refs.map((r) => {
          const t = (r.text || "").trim(), d = r.added ? new Date(r.added).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
          return (
            <div className={`ref${r.on ? "" : " off"}`} key={r.id}>
              <div className="ref-top"><Pill kind="blue">{REF_KIND[r.kind] || "Reference"}</Pill>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> : <b>{r.title}</b>}</div>
              <div className="ref-meta">{!t ? <Pill kind="warn">No text yet</Pill> : r.on ? <Pill kind="good">In coach</Pill> : <Pill>Off</Pill>}<span>{t ? t.length.toLocaleString() + " characters" : "Paste its transcript or takeaways with Edit"}</span>{r.file && <span>{r.file}</span>}{d && <span>Added {d}</span>}</div>
              {t && <details><summary>Preview</summary><p className="ref-prev">{t.slice(0, 1200)}{t.length > 1200 ? "…" : ""}</p></details>}
              <div className="ref-act">
                <label><input type="checkbox" className="sw" checked={!!r.on} aria-label="Use in coach" onChange={(e) => { const on = e.target.checked; save((cur) => cur.map((x) => (x.id === r.id ? { ...x, on } : x))); }} />Use in coach</label>
                <button className="btn ghost" type="button" onClick={() => startEdit(r)}>Edit</button>
                <ArmBtn label="Remove" armed="Tap again to remove" onConfirm={() => { if (edit === r.id) reset(); save((cur) => cur.filter((x) => x.id !== r.id)); }} />
              </div>
            </div>
          );
        }) : <p className="note">No references yet.</p>}</div>
      </div>
    </Group>
  );
}

/* Copy text to the clipboard, or drop it in the paste box when the browser refuses. */
async function copyOr(text, box, fallback = "Code is in the box below") {
  try { await navigator.clipboard.writeText(text); return "Copied"; }
  catch { box.set(text); requestAnimationFrame(() => box.ref.current?.select()); return fallback; }
}

function Data() {
  const { M, runSync, syncBusy: busy, revertData, syncMsg, setSyncMsg } = useApp();
  const D = M.DATA, when = whenET(D.snapshot), synced = D.source === "sync", G = M.GAMES;
  const [panel, setPanel] = useState(false), [why, setWhy] = useState("");
  const [paste, setPaste] = useState(""), [full, setFull] = useState(null), [stored, setStored] = useState(false);
  const taRef = useRef(null), box = { ref: taRef, set: (t) => { setPaste(t); setFull(null); } };
  const msg = (cls, text) => setSyncMsg(text ? { cls, text } : null);
  useEffect(() => { idbGet("ci-data").then((d) => setStored(!!d)); }, [D]);

  /* The sync itself runs in App (one at a time, survives leaving this section); this only drives the panel. */
  const sync = async (getObjs) => { if (await runSync(getObjs, parseEspn)) setPanel(false); };
  const syncNow = async () => {
    msg();
    try { await sync(tryDirect); }
    catch (err) {
      setPanel(true);
      const blocked = err && (err.name === "TypeError" || err.name === "AbortError");
      setWhy(blocked ? "ESPN doesn't let other sites fetch its data directly, so use the bookmark below. After the one-time setup it's: tap it on ESPN, come back, Paste & import." : `Direct sync failed (${err.message}). Do it in two taps instead:`);
    }
  };
  const pasteImport = async () => {
    msg(); let txt = "";
    try { txt = await navigator.clipboard.readText(); } catch {}
    if (!txt || txt.startsWith("javascript:") || txt.startsWith("// ==UserScript")) { taRef.current?.focus(); msg("err", "Couldn't read the clipboard here. Paste into the box below, then tap Import."); return; }
    try { await sync(async () => splitJson(txt)); } catch (err) { msg("err", err.message || String(err)); }
  };
  const importBox = async () => {
    msg();
    try { await sync(async () => { const objs = splitJson(full || paste); if (!objs.length) throw new Error("Paste the league JSON or choose a file first."); return objs; }); }
    catch (err) { msg("err", err.message || String(err)); }
  };
  const onFiles = async (e) => {
    const fs = [...e.target.files]; if (!fs.length) return;
    const txt = (await Promise.all(fs.map((f) => f.text()))).join("\n");
    setPaste(txt.length > 20000 ? `[${fs.length} file(s), ${(txt.length / 1024).toFixed(0)} KB loaded]` : txt); setFull(txt);
  };
  const resetAll = () => { ["ci-settings", "ci-tab", "ci-roster", "ci-setcat"].forEach(lsDel); ssSet("ci-return", "set"); location.reload(); };
  const bm = bookmarklet(false);
  const info = [
    ["Rosters & scores", when + (synced ? " · synced" : " · built-in")],
    ["Free agents", fmtET(D.faSnapshot || D.snapshot)],
    ["Season", `${D.season} · week ${D.currentWeek} of ${D.regWeeks}`],
    ["League", <>{D.league} · ESPN ID 1454450537 · <a href={ESPN_LEAGUE_PAGE} target="_blank" rel="noopener noreferrer">open on ESPN</a></>],
    ["NHL schedule", G.length ? `${G.length} games, ${keyLabel(etKey(G[0][0]))} to ${keyLabel(etKey(G[G.length - 1][0]))}` : "not loaded"],
    ["Goalie starters", M.STARTS_OK ? "for today" : `from ${keyLabel(M.STARTS_KEY)} (stale)`],
    ["Players", `${D.players.length} rostered · ${D.fa.length} free agents`],
    ["Stored here", "Settings, last tab and last roster in this browser's local storage. Synced league data, the NHL schedule, coach references and coach trades in this browser's IndexedDB. Nothing goes anywhere else."],
  ];

  return (
    <Group title="Data" className="wide">
      <div className="set-row"><dl className="kv">{info.map(([a, b]) => <Fragment key={a}><dt>{a}</dt><dd>{b}</dd></Fragment>)}</dl></div>
      <Row className="sync" l="Sync from ESPN" d={`Pulls rosters, scores, schedule, standings and every available free agent and waiver player for league 1454450537. Also pulls the full NHL game schedule and ESPN's goalie starters. Current data: ${when}${synced ? " (synced)" : " (built-in snapshot)"}. ${G.length ? `NHL schedule loaded: ${keyLabel(etKey(G[0][0]))} to ${keyLabel(etKey(G[G.length - 1][0]))}, ${G.length} games.` : "NHL schedule not loaded yet. Sync to get it."}`}>
        <button className="btn" type="button" id="syncBtn" onClick={syncNow} disabled={busy}>{busy ? "Syncing…" : "Sync now"}</button>
      </Row>
      {syncMsg && <div className="sync-pad"><Msg m={syncMsg} /></div>}
      {panel && <div className="sync-panel">
        <p className="note">{why}</p>
        <div className="grab">
          <h4>One-tap sync: rosters, scores and free agents</h4>
          <ol className="steps">
            <li><span className="lbl">Save the "Grab ESPN" bookmark once.</span> <span className="only-desk">Drag this button to your bookmarks bar:</span> <span className="btnrow">
              {/* A javascript: URL is the point of a bookmarklet; React blocks it in href, so it is set on the DOM node. */}
              <a className="btn ghost bm" ref={(el) => { if (el) el.setAttribute("href", bm); }} onClick={(e) => { e.preventDefault(); copyOr(bm, box); }}>Grab ESPN</a>
              <FlashBtn label="Copy bookmark code" onClick={() => copyOr(bm, box)} />
              <FlashBtn label={'Copy "Grab tomorrow" code'} onClick={() => copyOr(bookmarklet(true), box)} /></span>
              <span className="desc">On a phone: bookmark any page, edit that bookmark, rename it "Grab ESPN" and replace its address with the copied code.</span></li>
            <li><span className="lbl">On any ESPN Fantasy page, tap the bookmark.</span> <span className="btnrow"><a className="btn ghost" href={ESPN_LEAGUE_PAGE} target="_blank" rel="noopener noreferrer">Open ESPN</a></span> <span className="desc">It pulls the whole league plus every available free-agent and waiver player, skaters and goalies, and copies it all. In Chrome on Android, type "Grab ESPN" in the address bar and tap the bookmark there.</span></li>
            <li><span className="lbl">Come back and import.</span> <span className="btnrow"><button className="btn" type="button" onClick={pasteImport} disabled={busy}>Paste &amp; import</button></span> <span className="desc">If your browser won't let the page read the clipboard, long-press the box below, paste, then Import.</span></li>
          </ol>
        </div>
        <textarea ref={taRef} rows={4} placeholder="Paste what the bookmark copied (or league JSON) here" spellCheck={false} aria-label="Pasted sync data" value={paste} onChange={(e) => { setPaste(e.target.value); setFull(null); }} />
        <div className="btnrow"><label className="btn ghost filebtn">Choose file(s)<input type="file" accept=".json,.txt,application/json,text/plain" multiple hidden onChange={onFiles} /></label><button className="btn" type="button" onClick={importBox} disabled={busy}>Import</button></div>
        <details className="note"><summary>iPhone: Userscripts extension (most reliable)</summary>
          <ol className="steps">
            <li><span className="lbl">Install the free Userscripts app from the App Store.</span> <span className="desc">Open it, set its scripts folder, then in Safari tap the aA button, Manage Extensions, and turn Userscripts on. Allow it on fantasy.espn.com.</span></li>
            <li><span className="lbl">Copy the script.</span> <span className="btnrow"><FlashBtn label="Copy userscript" onClick={() => copyOr(bookmarklet(false, "user"), box)} /><FlashBtn label={'Copy "Grab tomorrow" script'} onClick={() => copyOr(bookmarklet(true, "user"), box)} /></span> <span className="desc">In the Userscripts app, add a new script, replace all of its text with this, and save.</span></li>
            <li><span className="lbl">Open your ESPN league in Safari.</span> <span className="desc">A red Grab ESPN button appears at the bottom right. Tap it, wait for the count, tap again to copy, then come back here and tap Paste &amp; import.</span></li>
          </ol>
        </details>
        <details className="note"><summary>iPhone: bookmark does nothing? Use a Shortcut instead</summary>
          <p className="note">If ESPN's page blocks bookmark scripts, the tap does nothing. A Shortcut runs the same grab through Safari's share sheet and isn't blocked that way. Not tested on a device yet.</p>
          <ol className="steps">
            <li><span className="lbl">Copy the code.</span> <span className="btnrow"><FlashBtn label="Copy Shortcut code" onClick={() => copyOr(bookmarklet(false, true), box)} /><FlashBtn label={'Copy "Grab tomorrow" code'} onClick={() => copyOr(bookmarklet(true, true), box)} /></span></li>
            <li><span className="lbl">In the Shortcuts app, make a new shortcut named Grab ESPN.</span> <span className="desc">Add the action Run JavaScript on Web Page and paste the code over its placeholder text. Add Copy to Clipboard after it. Tap the info button, turn on Show in Share Sheet, and set it to accept Safari web pages.</span></li>
            <li><span className="lbl">In Safari, open your ESPN Fantasy league page, tap Share, then Grab ESPN.</span> <span className="desc">Allow the site permission the first time. Use Safari itself, not the ESPN app. Then come back here and tap Paste &amp; import.</span></li>
          </ol>
        </details>
        <details className="note"><summary>No bookmark? League-only fallback</summary>
          <ol className="steps">
            <li><span className="lbl">Open your league data.</span> <span className="btnrow"><a className="btn ghost" href={LEAGUE_URL} target="_blank" rel="noopener noreferrer">Open league data</a><FlashBtn label="Copy link" onClick={() => copyOr(LEAGUE_URL, box, "Link in box below")} /></span></li>
            <li><span className="lbl">Select all, copy, paste above, Import.</span> This updates rosters, scores and the week, not the free-agent list (ESPN only serves that to its own pages, which is why the bookmark exists). Anyone rostered since is still dropped from the old list.</li>
          </ol>
        </details>
      </div>}
      <Row l="Synced data" d={synced ? `Using synced data from ${when}. Switch back to the snapshot this page shipped with.` : "Using the snapshot this page shipped with."}>
        <button className="btn ghost" type="button" disabled={!synced && !stored} onClick={revertData}>Use built-in snapshot</button>
      </Row>
      <Row l="Reset everything" d="Clears all settings, the remembered tab and roster, then reloads."><ArmBtn label="Reset" className="btn danger" onConfirm={resetAll} /></Row>
    </Group>
  );
}

export function Settings() {
  const [cat, setCatState] = useState(() => { const c = lsGet("ci-setcat"); return CATS.some((x) => x[0] === c) ? c : "look"; });
  const setCat = (c) => { lsSet("ci-setcat", c); setCatState(c); };
  /* goSync() from other tabs asks for the Data section. */
  useEffect(() => { const f = (e) => setCatState(e.detail); window.addEventListener("ci-setcat", f); return () => window.removeEventListener("ci-setcat", f); }, []);
  const nav = useRef(null);
  const onKey = (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (!d) return;
    e.preventDefault(); const i = CATS.findIndex((x) => x[0] === cat), n = CATS[(i + d + CATS.length) % CATS.length][0];
    setCat(n); requestAnimationFrame(() => nav.current?.querySelector(`[data-cat="${n}"]`)?.focus());
  };
  return (
    <div className="sec">
      <div className="sec-head"><h2>Settings</h2><span className="note">Saved in this browser only. Look and coach changes apply right away; model changes need a recalculation.</span></div>
      <div className="set-top">
        <div className="set-nav" role="tablist" aria-label="Settings sections" ref={nav} onKeyDown={onKey}>
          {CATS.map(([c, l]) => <button key={c} type="button" role="tab" id={"setcat-" + c} aria-controls="set-body" data-cat={c} aria-selected={cat === c} tabIndex={cat === c ? 0 : -1} onClick={() => setCat(c)}>{l}</button>)}
        </div>
        <p className="note">{CATS.find((x) => x[0] === cat)[2]}</p>
      </div>
      <div className="set" id="set-body" role="tabpanel" aria-labelledby={"setcat-" + cat}>
        {cat === "look" && <Look />}
        {cat === "layout" && <Layout />}
        {cat === "coach" && <><CoachSet /><Refs /></>}
        {cat === "model" && <Model />}
        {cat === "data" && <Data />}
      </div>
    </div>
  );
}
