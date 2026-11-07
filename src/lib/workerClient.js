/* Promise wrapper around a worker. Each call gets an id; a newer call supersedes older ones, whose results are dropped. */
export function makeClient(factory) {
  let w = null, seq = 0;
  const pending = new Map();
  const ensure = () => {
    if (w) return w;
    w = factory();
    w.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error)); };
    w.onerror = (e) => { pending.forEach((p) => p.rej(new Error(e.message || "worker error"))); pending.clear(); w = null; };
    return w;
  };
  return {
    run(msg) {
      const id = ++seq;
      return new Promise((res, rej) => { pending.set(id, { res, rej }); ensure().postMessage({ ...msg, id }); })
        .then((r) => (id === seq ? r : Promise.reject(Object.assign(new Error("superseded"), { superseded: true }))));
    },
  };
}

export const simClient = makeClient(() => new Worker(new URL("../workers/sim.worker.js", import.meta.url), { type: "module" }));
export const lineupClient = makeClient(() => new Worker(new URL("../workers/lineup.worker.js", import.meta.url), { type: "module" }));
