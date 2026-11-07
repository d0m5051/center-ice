/* Promise wrapper around a worker. Each call gets an id; a newer call supersedes older ones.
   A superseded call always rejects with `superseded: true`, whether it later succeeds or fails, so a stale job can
   never deliver a result or an error to the UI. A worker crash rejects everything pending and the next call starts a
   fresh worker. */
export function makeClient(factory) {
  let w = null, seq = 0;
  const pending = new Map();
  const ensure = () => {
    if (w) return w;
    w = factory();
    w.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error)); };
    w.onerror = (e) => {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      const dead = w; w = null;
      pending.forEach((p) => p.rej(new Error((e && e.message) || "The background worker stopped.")));
      pending.clear();
      try { dead && dead.terminate && dead.terminate(); } catch {}
    };
    return w;
  };
  const superseded = () => Promise.reject(Object.assign(new Error("superseded"), { superseded: true }));
  return {
    run(msg) {
      const id = ++seq;
      return new Promise((res, rej) => {
        pending.set(id, { res, rej });
        try { ensure().postMessage({ ...msg, id }); } catch (e) { pending.delete(id); rej(e); }
      }).then((r) => (id === seq ? r : superseded()), (e) => (id === seq ? Promise.reject(e) : superseded()));
    },
  };
}

export const simClient = makeClient(() => new Worker(new URL("../workers/sim.worker.js", import.meta.url), { type: "module" }));
export const lineupClient = makeClient(() => new Worker(new URL("../workers/lineup.worker.js", import.meta.url), { type: "module" }));
