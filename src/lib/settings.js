/* Per-browser settings. Small and needed synchronously before first paint, so they stay in localStorage. */
import { lsGet, lsSet } from "./storage.js";

export const DEF = {
  alInj: true, alGoalie: true, alLock: true, alFA: true, alLead: 60, lookV: 2,
  skin: "ice", nav: "icons", mode: "dark", palette: "rink", font: "clean", size: "m", density: "comfy", motion: false,
  startTab: "last", rosterDefault: "me", wireDefault: "all", hideInjFA: false,
  projW: 70, sd: 20, gpw: 3.5, sims: 20000,
  coachTeam: "me", coachLen: "std", coachMath: false, starters: true, coachNotes: "",
  tint: "subtle", glow: 100, contrast: false, cBlue: "#1747a6", cGoal: "#c8102e", corners: "round", width: "default",
  dock: "bottom", side: "left", dsize: "m", dlabel: "caps", dockShrink: true,
  glass: true, glassOp: 58, glassBlur: 22, glassSat: 180, glassTint: "neutral", glassSpec: true, glassGlint: true, glassRefract: true,
  shadow: "soft", menu: "solid", dim: "medium",
};

export const LOOK_KEYS = ["skin", "nav", "mode", "palette", "font", "size", "density", "motion", "tint", "glow", "contrast", "cBlue", "cGoal", "corners", "width", "dock", "side", "dsize", "dlabel", "dockShrink", "glass", "glassOp", "glassBlur", "glassSat", "glassTint", "glassSpec", "glassGlint", "glassRefract", "shadow", "menu", "dim"];
export const MODEL_KEYS = ["projW", "sd", "gpw", "sims"];
const LIM = { projW: [0, 100], sd: [10, 35], gpw: [2.5, 4.5] };

export function loadSettings() {
  const S = { ...DEF };
  try {
    const raw = JSON.parse(lsGet("ci-settings") || "{}");
    if (raw.lookV !== 2) ["mode", "palette", "font"].forEach((k) => delete raw[k]);
    Object.keys(DEF).forEach((k) => { if (raw[k] !== undefined && typeof raw[k] === typeof DEF[k]) S[k] = raw[k]; });
  } catch {}
  Object.entries(LIM).forEach(([k, [a, b]]) => { S[k] = Math.min(b, Math.max(a, +S[k] || DEF[k])); });
  if (![5000, 20000, 50000].includes(S.sims)) S.sims = 20000;
  return S;
}

export const saveSettings = (S) => lsSet("ci-settings", JSON.stringify(S));

/* Coerce a raw control value to the type of its default. */
export const coerce = (k, raw) => (typeof DEF[k] === "number" ? +raw : typeof DEF[k] === "boolean" ? !!raw : raw);
