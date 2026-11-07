/* Pointer-driven glass effects, rewritten to avoid layout thrashing.
   Before: every pointermove read getBoundingClientRect() right after writing styles, and a separate rAF loop eased the
   rim light toward the pointer every frame.
   Now:
   - Mouse only (touch never ran it usefully), and nothing at all when glint and highlights are both off or motion is reduced.
   - At most one update per ~33 ms, batched into a frame.
   - The hovered card's rect is read once when the pointer enters it and reused; scroll or resize just marks it stale.
     Reads always happen before writes in the frame, so the browser never has to lay out mid-frame.
   - The rim angle is written once per update; the easing is a CSS transition on a registered @property, not a JS loop.
   - The refraction filter is a static SVG filter (Chromium only), not re-scaled per frame. */
import { useEffect } from "react";

const GL = ".board,.card,.faceoff,.game,.tile,.trade,.grab,.wk,.msg.a,.set-group,.scroll,.act,.alert";
const INTERVAL = 33;

export function useGlass(S) {
  const glint = S.glass && S.glassGlint && !S.motion;
  const rim = S.glass && S.glassSpec && !S.motion;

  useEffect(() => {
    if (!glint && !rim) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const dock = document.querySelector(".dock");
    let el = null, rect = null, stale = true, last = 0, queued = false, ev = null, dockC = null;

    const clear = () => { if (el) { el.style.removeProperty("--mx"); el.style.removeProperty("--my"); } el = null; rect = null; };
    const measureDock = () => { if (!dock) return; const r = dock.getBoundingClientRect(); dockC = [r.left + r.width / 2, r.top + r.height / 2]; };

    const frame = () => {
      queued = false; last = performance.now();
      const e = ev; if (!e) return;
      /* reads */
      let target = null, box = null;
      if (glint) {
        target = e.target && e.target.closest ? e.target.closest(GL) : null;
        if (target && (target !== el || stale || !rect)) box = target.getBoundingClientRect(); else box = rect;
      }
      if (rim && !dockC) measureDock();
      /* writes */
      if (glint) {
        if (target !== el) clear();
        if (target) { el = target; rect = box; stale = false; el.style.setProperty("--mx", (e.clientX - rect.left).toFixed(0) + "px"); el.style.setProperty("--my", (e.clientY - rect.top).toFixed(0) + "px"); }
      }
      if (rim && dock && dockC) dock.style.setProperty("--rim", ((Math.atan2(e.clientX - dockC[0], -(e.clientY - dockC[1])) * 180) / Math.PI).toFixed(0) + "deg");
    };
    const onMove = (e) => {
      if (e.pointerType !== "mouse") return;
      ev = e;
      if (queued) return;
      queued = true;
      const wait = INTERVAL - (performance.now() - last);
      if (wait > 0) setTimeout(() => requestAnimationFrame(frame), wait); else requestAnimationFrame(frame);
    };
    const onScroll = () => { stale = true; };
    const onResize = () => { stale = true; dockC = null; };
    const onLeave = () => { ev = null; clear(); };

    document.addEventListener("pointermove", onMove, { passive: true });
    addEventListener("scroll", onScroll, { passive: true, capture: true });
    addEventListener("resize", onResize, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      removeEventListener("scroll", onScroll, { capture: true });
      removeEventListener("resize", onResize);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      clear();
    };
  }, [glint, rim]);
}

/* SVG displacement inside backdrop-filter only renders in Chromium. Injected once; CSS decides whether the lens uses it. */
export function installRefraction() {
  if (!navigator.userAgentData || document.getElementById("lg-refract")) return;
  const enc = (s) => "data:image/svg+xml," + encodeURIComponent(s);
  const ramp = (vert, c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="${vert ? 0 : 1}" y2="${vert ? 1 : 0}"><stop offset="0" stop-color="${c(255)}"/><stop offset=".22" stop-color="${c(128)}"/><stop offset=".78" stop-color="${c(128)}"/><stop offset="1" stop-color="${c(0)}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/></svg>`;
  const mx = ramp(0, (v) => `rgb(${v},0,0)`), my = ramp(1, (v) => `rgb(0,${v},0)`);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.setAttribute("aria-hidden", "true"); svg.style.position = "absolute";
  const f = document.createElementNS(ns, "filter");
  Object.entries({ id: "lg-refract", x: "0", y: "0", width: "1", height: "1", "color-interpolation-filters": "sRGB" }).forEach(([k, v]) => f.setAttribute(k, v));
  const im = (href, res) => { const e = document.createElementNS(ns, "feImage"); e.setAttribute("href", enc(href)); e.setAttribute("preserveAspectRatio", "none"); e.setAttribute("result", res); return e; };
  const comp = document.createElementNS(ns, "feComposite");
  Object.entries({ in: "a", in2: "b", operator: "arithmetic", k1: "0", k2: "1", k3: "1", k4: "0", result: "m" }).forEach(([k, v]) => comp.setAttribute(k, v));
  const dm = document.createElementNS(ns, "feDisplacementMap");
  Object.entries({ in: "SourceGraphic", in2: "m", scale: "14", xChannelSelector: "R", yChannelSelector: "G" }).forEach(([k, v]) => dm.setAttribute(k, v));
  f.append(im(mx, "a"), im(my, "b"), comp, dm); svg.append(f); document.body.append(svg);
  document.documentElement.classList.add("refract");
}
