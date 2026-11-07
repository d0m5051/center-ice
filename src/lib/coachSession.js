/* Coach conversation state machine (docs/STATE_MACHINES.md, "Coach session").
   States: idle | asking. Data: the visible log, the API history, a context generation.
   - Only the current request (ctrl === ac) may touch the log or the history. A request cut off by Clear can't write a
     late chunk or a late answer into the next conversation.
   - The first turn carries the league context. When the context changes (new data), the history is dropped so the next
     question starts fresh; a request already in flight under the old context doesn't put its answer back into the
     history. */
export function createCoachSession({ stream, onChange = () => {} }) {
  let log = [], hist = [], busy = false, ctrl = null, ctxGen = 0;
  const snap = () => ({ log, busy });
  const emit = () => onChange(snap());
  const patchLast = (p) => { if (!log.length) return; log = log.slice(); log[log.length - 1] = { ...log[log.length - 1], ...p }; emit(); };

  async function ask({ label, build, strip = (t) => t, after, errorText }) {
    if (busy) return false;
    busy = true;
    const myCtx = ctxGen;
    const msgs = build(hist.length === 0, hist);
    log = [...log, { cls: "u", text: label }, { cls: "a", text: "Thinking…" }];
    const ac = new AbortController(); ctrl = ac;
    emit();
    try {
      const text = await stream(msgs, { signal: ac.signal, onText: (t) => { if (ctrl === ac) patchLast({ text: strip(t) }); } });
      if (ctrl !== ac) return true;
      if (myCtx === ctxGen) hist = [...msgs, { role: "assistant", content: text }];
      const extra = after ? after(text) || {} : {};
      patchLast({ text: strip(text), ...extra });
    } catch (e) {
      if (ctrl !== ac) return true;
      patchLast({ cls: "err", text: errorText(e) });
    } finally {
      if (ctrl === ac) { ctrl = null; busy = false; emit(); }
    }
    return true;
  }

  return {
    ask,
    clear() { const c = ctrl; ctrl = null; if (c) c.abort(); busy = false; hist = []; log = []; emit(); },
    contextChanged() { ctxGen++; hist = []; },
    get state() { return snap(); },
    get history() { return hist; },
  };
}
