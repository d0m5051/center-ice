/* Turns appearance settings into attributes, classes and custom properties on <html>.
   The theme is resolved here (system -> light/dark), so the stylesheet only ever needs [data-theme="dark"]. */

const dq = () => matchMedia("(prefers-color-scheme: dark)");
export const resolvedDark = (S) => S.mode === "dark" || (S.mode === "system" && dq().matches);

const hx = (h) => { h = /^#?([0-9a-f]{6})$/i.exec(h || ""); return h ? [0, 2, 4].map((i) => parseInt(h[1].substr(i, 2), 16)) : null; };
const mix = (a, b, k) => "#" + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, "0")).join("");
const lum = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const cl = (v, a, b, d) => { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };

export function applyLook(S, r = document.documentElement) {
  const dark = resolvedDark(S);
  const attrs = {
    "data-theme": dark ? "dark" : "light",
    "data-skin": S.skin === "classic" ? "classic" : "ice",
    "data-nav": S.nav === "text" ? "text" : "icons",
    "data-palette": S.palette || "rink",
    "data-font": S.font || "default",
    "data-size": S.size, "data-density": S.density, "data-corners": S.corners, "data-width": S.width,
    "data-dock": S.dock, "data-side": S.side, "data-dsize": S.dsize, "data-dlabel": S.dlabel,
    "data-menu": S.menu, "data-dim": S.dim, "data-shadow": S.shadow,
  };
  for (const [k, v] of Object.entries(attrs)) if (r.getAttribute(k) !== String(v)) r.setAttribute(k, v);
  r.style.colorScheme = dark ? "dark" : "light";

  const flags = { calm: S.motion, "no-glass": !S.glass, "no-spec": !S.glassSpec, "no-glint": !S.glassGlint, "no-refract": !S.glassRefract, "no-shrink": !S.dockShrink, "hi-contrast": !!S.contrast };
  for (const [c, on] of Object.entries(flags)) r.classList.toggle(c, !!on);

  const set = (k, v) => r.style.setProperty(k, v);
  const t = { none: [0, 0], subtle: [4, 5], rich: [10, 13] }[S.tint] || [0, 0];
  set("--t-bg", t[0] + "%");
  set("--t-surf", t[1] + (S.glassTint === "accent" ? 10 : 0) + "%");
  const g = cl(S.glow, 0, 200, 100) / 100;
  set("--amb1", (30 * g).toFixed(1) + "%"); set("--amb2", (17 * g).toFixed(1) + "%"); set("--amb3", (22 * g).toFixed(1) + "%");
  const op = S.glass ? cl(S.glassOp, 15, 100, 58) : 100;
  set("--g-op", op + "%"); set("--g-op2", Math.round(S.glass ? op * 0.52 : 100) + "%");
  set("--g-blur-px", (S.glass ? cl(S.glassBlur, 0, 40, 22) : 0) + "px");
  set("--g-sat", (S.glass ? cl(S.glassSat, 100, 240, 180) : 100) + "%");

  const B = hx(S.cBlue) || [23, 71, 166], G = hx(S.cGoal) || [200, 16, 46], W = [255, 255, 255], base = dark ? [14, 31, 45] : W;
  set("--c1", mix(B, B, 0)); set("--c2", mix(G, G, 0)); set("--c3", mix(B, W, 0.88));
  const ck = ["--blue", "--goal", "--blue-soft", "--goal-soft", "--on-goal"];
  if (S.palette === "custom") {
    const b = dark ? mix(B, W, 0.35) : mix(B, B, 0), gg = dark ? mix(G, W, 0.3) : mix(G, G, 0);
    set("--blue", b); set("--goal", gg);
    set("--blue-soft", mix(hx(b), base, dark ? 0.78 : 0.86)); set("--goal-soft", mix(hx(gg), base, dark ? 0.78 : 0.88));
    set("--on-goal", lum(hx(gg)) > 0.4 ? "#111111" : "#ffffff");
  } else ck.forEach((k) => r.style.removeProperty(k));
}

/* Re-resolve when the OS theme flips and the user is on "system". */
export function watchSystemTheme(getS) {
  const m = dq();
  const fn = () => { const S = getS(); if (S.mode === "system") applyLook(S); };
  try { m.addEventListener("change", fn); } catch {}
  return () => { try { m.removeEventListener("change", fn); } catch {} };
}
