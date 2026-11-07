/* Storage.
   - Small, synchronous values (settings, last tab, last roster) stay in localStorage: they are read before first paint.
   - Large payloads (league data, NHL schedule, coach references, coach trades) live in IndexedDB: async, structured-clone,
     no 5 MB string quota, and no JSON.parse on the main thread at boot.
   The first run moves any old localStorage/sessionStorage copies into IndexedDB and deletes them. */

export const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
export const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };
export const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
export const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch {} };
export const ssDel = (k) => { try { sessionStorage.removeItem(k); } catch {} };

const DB_NAME = "center-ice", STORE = "kv", VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
    let out;
    Promise.resolve(fn(s)).then((r) => { out = r; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("aborted"));
  }));
}
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const idbGet = (k) => tx("readonly", (s) => req2p(s.get(k))).catch(() => undefined);
export const idbSet = (k, v) => tx("readwrite", (s) => { s.put(v, k); }).then(() => true, () => false);
export const idbDel = (k) => tx("readwrite", (s) => { s.delete(k); }).then(() => true, () => false);
export const idbGetMany = (keys) => tx("readonly", (s) => Promise.all(keys.map((k) => req2p(s.get(k))))).catch(() => keys.map(() => undefined));

/* Keys that used to be JSON strings in localStorage. */
const MIGRATE = ["ci-data", "ci-games", "ci-refs", "ci-coach-trades"];

export async function migrateFromLocalStorage() {
  if (lsGet("ci-idb-migrated") === "1") return;
  try {
    for (const k of MIGRATE) {
      const raw = lsGet(k) ?? (k === "ci-data" ? ssGet(k) : null);
      if (raw == null) continue;
      let val; try { val = JSON.parse(raw); } catch { continue; }
      const existing = await idbGet(k);
      if (existing === undefined && !(await idbSet(k, val))) return; /* IDB not writable: leave localStorage alone */
      lsDel(k); if (k === "ci-data") ssDel(k);
    }
    lsSet("ci-idb-migrated", "1");
  } catch {}
}

/* Rough check the browser will keep our data; asks for persistence once, quietly. */
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}

/* Cross-tab change notices for IndexedDB keys. A tab that writes a key announces it; other open tabs re-read it, so a
   tab never keeps editing a stale copy and overwrites another tab's change (docs/STATE_MACHINES.md, "Persistence"). */
let bc;
const channel = () => (bc !== undefined ? bc : (bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("center-ice") : null));
export const announce = (key) => { try { const c = channel(); c && c.postMessage({ key }); } catch {} };
export function subscribe(fn) {
  const c = channel(); if (!c) return () => {};
  const h = (e) => { if (e.data && typeof e.data.key === "string") fn(e.data.key); };
  c.addEventListener("message", h);
  return () => c.removeEventListener("message", h);
}
