import { test } from "node:test";
import assert from "node:assert/strict";
import { createCoachSession } from "../src/lib/coachSession.js";

/* A stream the test drives: chunks and completion are released by hand. Like fetch, it rejects with AbortError
   when the signal fires. */
function controlledStream() {
  const calls = [];
  const stream = (msgs, { signal, onText }) => new Promise((resolve, reject) => {
    const call = { msgs, onText, resolve, reject, signal };
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    calls.push(call);
  });
  return { stream, calls };
}
const req = (label, extra = {}) => ({ label, build: (first, hist) => [...hist, { role: "user", content: (first ? "CTX " : "") + label }], errorText: () => "failed", ...extra });

test("a normal turn streams into the log and becomes history", async () => {
  const { stream, calls } = controlledStream(); const s = createCoachSession({ stream });
  const p = s.ask(req("q1", { after: (t) => ({ trades: t.includes("TRADE") ? 1 : 0 }) }));
  assert.equal(s.state.busy, true);
  calls[0].onText("Hel"); assert.equal(s.state.log[1].text, "Hel");
  calls[0].resolve("Hello TRADE"); await p;
  assert.equal(s.state.busy, false);
  assert.deepEqual(s.state.log[1], { cls: "a", text: "Hello TRADE", trades: 1 });
  assert.equal(s.history.length, 2);
  assert.equal(s.history[0].content, "CTX q1");
});

test("asks while busy are refused", async () => {
  const { stream, calls } = controlledStream(); const s = createCoachSession({ stream });
  const p = s.ask(req("q1"));
  assert.equal(await s.ask(req("q2")), false);
  calls[0].resolve("a"); await p;
  assert.equal(calls.length, 1);
});

test("regression: after Clear, a late chunk or answer from the old request can't touch the new conversation", async () => {
  const { stream, calls } = controlledStream(); const s = createCoachSession({ stream });
  const old = s.ask(req("old"));
  const lateChunk = calls[0].onText;
  s.clear();
  const fresh = s.ask(req("new"));
  lateChunk("OLD CHUNK");                       /* a chunk that was already being processed when Clear ran */
  assert.equal(s.state.log[1].text, "Thinking…");
  await old;                                     /* old request rejected by the abort */
  calls[1].resolve("new answer"); await fresh;
  assert.deepEqual(s.state.log.map((m) => m.text), ["new", "new answer"]);
  assert.equal(s.history[0].content, "CTX new", "the new conversation starts with fresh context");
});

test("regression: an answer that finishes after Clear is dropped", async () => {
  const stream = (msgs, { onText }) => { onText("x"); return Promise.resolve("old answer"); };
  const s = createCoachSession({ stream });
  const p = s.ask(req("old"));
  s.clear();
  await p;
  assert.deepEqual(s.state.log, []);
  assert.deepEqual(s.history, []);
});

test("regression: new data mid-answer doesn't put the stale-context history back", async () => {
  const { stream, calls } = controlledStream(); const s = createCoachSession({ stream });
  const p = s.ask(req("q1"));
  s.contextChanged();                            /* a sync or day rollover rebuilt the model */
  calls[0].resolve("answer on old data"); await p;
  assert.equal(s.state.log[1].text, "answer on old data", "the answer is still shown");
  assert.deepEqual(s.history, [], "but the next question starts with the new context");
  const p2 = s.ask(req("q2")); assert.equal(calls[1].msgs[0].content, "CTX q2");
  calls[1].resolve("ok"); await p2;
});

test("errors land on the current turn and release busy", async () => {
  const { stream, calls } = controlledStream(); const s = createCoachSession({ stream });
  const p = s.ask(req("q1")); calls[0].reject(new Error("502")); await p;
  assert.equal(s.state.busy, false);
  assert.deepEqual(s.state.log[1], { cls: "err", text: "failed" });
  assert.deepEqual(s.history, []);
});
