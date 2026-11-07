/* Small pure state rules shared by App and the panels. Kept free of React and the DOM so they can be unit-tested.
   docs/STATE_MACHINES.md describes the machines these rules belong to. */

/* Trade horizon. The stored preference can be "ros" from an earlier session, but rest-of-season values need the NHL
   schedule to reach 150 days ahead (M.ROS_OK). Without it every rest-of-season lineup value is 0 and the trade search
   returns nothing, so the effective horizon falls back to "now". */
export const effectiveTmode = (pref, rosOk) => (pref === "ros" && rosOk ? "ros" : "now");

/* Compare list: keep only player ids the current data still has, at most 3, no duplicates. */
export function pruneIds(ids, has, max = 3) {
  const out = [];
  for (const id of ids || []) { const k = String(id); if (has(k) && !out.includes(k)) out.push(k); if (out.length >= max) break; }
  return out;
}
export const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/* One-at-a-time gate for an async task (ESPN sync). A second start while one is running is refused rather than
   raced, so an older sync can never land after a newer one. */
export function createGate(onChange = () => {}) {
  let busy = false;
  return {
    get busy() { return busy; },
    async run(task) {
      if (busy) return { skipped: true };
      busy = true; onChange(true);
      try { return { value: await task() }; } finally { busy = false; onChange(false); }
    },
  };
}

/* Saving synced data. Applying it no longer needs a reload, so a failed save must not block applying it:
   the caller applies the data either way and tells the user when it won't survive a reload. */
export async function persistSync(D, { idbSet, remoteSet }) {
  const local = await idbSet("ci-data", D).catch(() => false);
  const remote = await remoteSet("snapshots/latest", { snapshot: D.snapshot, faSnapshot: D.faSnapshot || null, savedAt: new Date().toISOString(), json: JSON.stringify(D) }).catch(() => false);
  return { local: !!local, remote: !!remote };
}
export function syncMessage(res, saved) {
  const base = `Synced: ${res.summary}.${res.notes.length ? " " + res.notes.join(" ") : ""}`;
  if (!saved.local && !saved.remote) return { cls: "err", text: base + " This browser wouldn't save it, so it's in use now but will be gone after a reload." };
  return { cls: "ok", text: base + (saved.remote ? "" : " Saved on this device only.") };
}
