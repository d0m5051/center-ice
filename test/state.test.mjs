import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectiveTmode, pruneIds, sameIds, createGate, persistSync, syncMessage } from "../src/lib/state.js";
import { buildModel } from "../src/lib/model.js";
import { findTrades } from "../src/lib/lineup.js";
import { DEF } from "../src/lib/settings.js";

const EMBED = JSON.parse(readFileSync(new URL("../src/data/snapshot.json", import.meta.url)));

test("rest-of-season horizon falls back to 'now' when the schedule can't support it", () => {
  assert.equal(effectiveTmode("ros", false), "now");
  assert.equal(effectiveTmode("ros", true), "ros");
  assert.equal(effectiveTmode("now", true), "now");
  assert.equal(effectiveTmode(undefined, true), "now");
});

test("regression: a stored 'ros' horizon without a schedule used to produce zero trades", () => {
  const M = buildModel(EMBED, DEF, null, Date.parse("2026-11-07T15:00:00Z"));
  assert.equal(M.ROS_OK, false);
  assert.equal(findTrades(M, "ros").length, 0, "raw ros mode finds nothing without the schedule");
  assert.ok(findTrades(M, effectiveTmode("ros", M.ROS_OK)).length > 0, "the effective horizon still finds trades");
});

test("compare ids are pruned to rows that still exist, deduped, max 3", () => {
  const has = (id) => ["1", "2", "3", "4"].includes(id);
  assert.deepEqual(pruneIds(["1", "999", "2"], has), ["1", "2"]);
  assert.deepEqual(pruneIds(["1", "1", 2, "3", "4"], has), ["1", "2", "3"]);
  assert.deepEqual(pruneIds(null, has), []);
  assert.ok(sameIds(["1"], ["1"]) && !sameIds(["1"], ["2"]));
});

test("sync gate runs one task at a time and refuses overlap", async () => {
  const seen = []; const g = createGate((b) => seen.push(b));
  let release; const first = g.run(() => new Promise((r) => (release = r)));
  assert.equal(g.busy, true);
  assert.deepEqual(await g.run(async () => "second"), { skipped: true });
  release("first");
  assert.deepEqual(await first, { value: "first" });
  assert.equal(g.busy, false);
  assert.deepEqual(seen, [true, false]);
});

test("sync gate releases after a failing task", async () => {
  const g = createGate();
  await assert.rejects(g.run(async () => { throw new Error("parse failed"); }), /parse failed/);
  assert.equal(g.busy, false);
  assert.deepEqual(await g.run(async () => 1), { value: 1 });
});

test("regression: synced data is applied even when the browser won't save it", async () => {
  const saved = await persistSync({ snapshot: "s" }, { idbSet: async () => false, remoteSet: async () => { throw new Error("x"); } });
  assert.deepEqual(saved, { local: false, remote: false });
  const m = syncMessage({ summary: "10 teams", notes: [] }, saved);
  assert.equal(m.cls, "err");
  assert.match(m.text, /in use now but will be gone after a reload/);
  assert.equal(syncMessage({ summary: "x", notes: [] }, { local: true, remote: false }).cls, "ok");
});
