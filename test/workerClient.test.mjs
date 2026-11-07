import { test } from "node:test";
import assert from "node:assert/strict";
import { makeClient } from "../src/lib/workerClient.js";

/* A fake worker whose replies the test releases by hand. */
function fakeFactory() {
  const made = [];
  const factory = () => {
    const w = { posted: [], onmessage: null, onerror: null, terminated: false,
      postMessage(m) { this.posted.push(m); }, terminate() { this.terminated = true; },
      reply(i, data) { this.onmessage({ data: { id: this.posted[i].id, ...data } }); } };
    made.push(w); return w;
  };
  return { factory, made };
}

test("a newer call supersedes an older one that later succeeds", async () => {
  const { factory, made } = fakeFactory(); const c = makeClient(factory);
  const a = c.run({ n: 1 }), b = c.run({ n: 2 });
  made[0].reply(0, { ok: true, v: "A" }); made[0].reply(1, { ok: true, v: "B" });
  await assert.rejects(a, (e) => e.superseded === true);
  assert.equal((await b).v, "B");
});

test("a stale call that fails is reported as superseded, not as an error", async () => {
  const { factory, made } = fakeFactory(); const c = makeClient(factory);
  const a = c.run({}), b = c.run({});
  made[0].reply(0, { ok: false, error: "boom" });
  await assert.rejects(a, (e) => e.superseded === true && e.message === "superseded");
  made[0].reply(1, { ok: true });
  await b;
});

test("the current call's failure is surfaced", async () => {
  const { factory, made } = fakeFactory(); const c = makeClient(factory);
  const a = c.run({}); made[0].reply(0, { ok: false, error: "bad data" });
  await assert.rejects(a, (e) => !e.superseded && e.message === "bad data");
});

test("a worker crash rejects the pending call and the next call starts a new worker", async () => {
  const { factory, made } = fakeFactory(); const c = makeClient(factory);
  const a = c.run({}); made[0].onerror({ message: "Failed to load worker script", preventDefault() {} });
  await assert.rejects(a, /Failed to load/);
  assert.equal(made[0].terminated, true);
  const b = c.run({}); assert.equal(made.length, 2);
  made[1].reply(0, { ok: true, v: 1 }); assert.equal((await b).v, 1);
});

test("a factory that throws rejects the call instead of hanging", async () => {
  const c = makeClient(() => { throw new Error("no workers here"); });
  await assert.rejects(c.run({}), /no workers here/);
});
