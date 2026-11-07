/* Tab dock. The selection lens is a single element inside the tab strip, moved with CSS transitions on `translate`
   (compositor-only) whenever the selection or layout changes. No requestAnimationFrame loop runs while idle, and
   because the lens lives inside the scrolling strip it follows horizontal scroll without any script.
   Keyboard: arrow keys / Home / End move between tabs (roving tabindex). */
import { useLayoutEffect, useRef, useEffect } from "react";
import { useApp } from "../ctx.js";

export const TABS = [
  { id: "week", label: "Home", ic: <><rect x="2.5" y="5" width="19" height="14" rx="6" /><path d="M12 5v14" /><circle cx="12" cy="12" r="2.4" /></> },
  { id: "roster", label: "Lineup", ic: <path d="M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z" /> },
  { id: "coach", label: "Coach", ic: <><path d="M7 3l7 14.5c.4.9 1.3 1.5 2.3 1.5H21" /><path d="M3 21h6" /></> },
  { id: "wire", label: "Wire", ic: <><circle cx="10" cy="8" r="4" /><path d="M3 20c0-3.5 3-6 7-6s7 2.5 7 6M19 8v6M16 11h6" /></> },
  { id: "deals", label: "Trades", ic: <path d="M4 8h14l-3-3M20 16H6l3 3" /> },
  { id: "board", label: "League", sec: 1, ic: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /> },
  { id: "plan", label: "Schedule", sec: 1, ic: <><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></> },
  { id: "alerts", label: "Alerts", sec: 1, ic: <><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 21h4" /></> },
  { id: "pts", label: "Points", sec: 1, ic: <path d="M5 20V11M12 20V4M19 20v-6" /> },
  { id: "set", label: "Settings", sec: 1, ic: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" /></> },
];
export const MORE_IDS = TABS.filter((t) => t.sec).map((t) => t.id);
const MORE_IC = <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>;
export const Icon = ({ children }) => <svg className="ti" viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;

const visible = (el) => el && el.offsetWidth > 0;

export function Dock({ tab, onSelect, onMore, dots }) {
  const { S } = useApp();
  const dock = useRef(null), nav = useRef(null), lens = useRef(null);

  /* Position the lens on the selected (or More) tab. Runs on selection change and on any size change. */
  useLayoutEffect(() => {
    const n = nav.current, l = lens.current; if (!n || !l) return;
    const place = () => {
      let t = n.querySelector('[aria-selected="true"]:not(#t-more)');
      if (!visible(t)) t = n.querySelector('#t-more[aria-selected="true"]');
      if (!visible(t)) { l.style.opacity = "0"; return; }
      l.style.setProperty("--lx", t.offsetLeft + "px"); l.style.setProperty("--ly", t.offsetTop + "px");
      l.style.setProperty("--lw", t.offsetWidth + "px"); l.style.setProperty("--lh", t.offsetHeight + "px");
      l.style.opacity = "1";
      const a = t.offsetLeft, b = a + t.offsetWidth, v0 = n.scrollLeft, v1 = v0 + n.clientWidth;
      if (a < v0 + 8) n.scrollTo({ left: Math.max(0, a - 12) }); else if (b > v1 - 8) n.scrollTo({ left: b - n.clientWidth + 12 });
    };
    place();
    /* Turn transitions on only after the first placement, so the lens doesn't fly in from the corner. */
    const id = requestAnimationFrame(() => dock.current && dock.current.classList.add("lens-ready"));
    const ro = new ResizeObserver(place);
    ro.observe(n); n.querySelectorAll(".tab").forEach((t) => ro.observe(t));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    return () => { cancelAnimationFrame(id); ro.disconnect(); };
  }, [tab, S.nav, S.side, S.dock, S.dsize, S.dlabel, S.font, S.size, S.skin]);

  /* Shrink on scroll down, restore on scroll up or near the ends. One passive listener, class toggled only on change. */
  useEffect(() => {
    if (!S.dockShrink || S.motion || matchMedia("(prefers-reduced-motion: reduce)").matches) { dock.current?.classList.remove("mini"); return; }
    let ly = scrollY, queued = false, mini = false;
    const tick = () => {
      queued = false;
      const y = scrollY, d = y - ly; ly = y;
      const want = y < 40 || d < -6 || innerHeight + y >= document.documentElement.scrollHeight - 4 ? false : d > 10 ? true : mini;
      if (want !== mini) { mini = want; dock.current?.classList.toggle("mini", mini); }
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(tick); } };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, [S.dockShrink, S.motion]);

  const onKey = (e) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const vis = [...nav.current.querySelectorAll(".tab")].filter(visible);
    const i = vis.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault();
    const j = e.key === "Home" ? 0 : e.key === "End" ? vis.length - 1 : (i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + vis.length) % vis.length;
    vis[j].focus();
  };

  const moreSel = MORE_IDS.includes(tab);
  return (
    <div className="dock" ref={dock} onPointerDown={() => dock.current?.classList.remove("mini")}>
      <nav className="tabs" role="tablist" aria-label="Sections" ref={nav} onKeyDown={onKey}>
        <i className="lens" ref={lens} aria-hidden="true" />
        {TABS.map((t) => (
          <button key={t.id} className={`tab${t.sec ? " sec-tab" : ""}`} role="tab" id={"t-" + t.id} aria-controls={"p-" + t.id}
            aria-selected={tab === t.id} tabIndex={tab === t.id || (moreSel && t.id === "more") ? 0 : -1}
            onClick={() => onSelect(t.id)}>
            <Icon>{t.ic}</Icon><span>{t.label}</span>
            {dots[t.id] && <span className="dot" aria-label={dots[t.id]} />}
          </button>
        ))}
        <button className="tab" role="tab" id="t-more" aria-haspopup="dialog" aria-selected={moreSel} tabIndex={moreSel ? 0 : -1} onClick={onMore}>
          <Icon>{MORE_IC}</Icon><span>More</span>{dots.more && <span className="dot" aria-label={dots.more} />}
        </button>
      </nav>
    </div>
  );
}
