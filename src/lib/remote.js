/* Optional cross-device storage. When the page runs inside a host that exposes window.claude.use("db"), synced league
   data and coach references are mirrored there too. On a plain web host this is a no-op. */
let dbp = null;
export function remoteDb() {
  if (dbp) return dbp;
  dbp = (async () => { try { return window.claude && window.claude.use ? (await window.claude.use("db")) || null : null; } catch { return null; } })();
  return dbp;
}
export async function remoteGet(path) { const db = await remoteDb(); if (!db) return null; try { const s = await db.doc(path).get(); return s.exists ? s.data() : null; } catch { return null; } }
export async function remoteSet(path, v) { const db = await remoteDb(); if (!db) return false; try { await db.doc(path).set(v); return true; } catch { return false; } }
export async function remoteDel(path) { const db = await remoteDb(); if (!db) return; try { await db.doc(path).delete(); } catch {} }
