import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, startServer, settle } from "./helpers.mjs";

let server, browser;
before(async () => { server = await startServer(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); server?.stop(); });

test("worker failure shows an error with Retry instead of loading forever, and Retry recovers", async () => {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  const block = (r) => r.fulfill({ status: 404, body: "gone" });
  await p.route(/lineup\.worker-.*\.js/, block);
  await p.goto(server.url + "#wire");
  const err = p.locator("#p-wire .job-err");
  await err.waitFor({ timeout: 10000 });
  assert.match(await err.innerText(), /Lineup scoring failed/);
  assert.equal(await p.locator("#p-wire .loading").count(), 0);
  await p.unroute(/lineup\.worker-.*\.js/, block);
  await err.getByRole("button", { name: "Retry" }).click();
  await p.locator("#wire tbody tr").first().waitFor({ timeout: 10000 });
  assert.equal(await p.locator("#p-wire .job-err").count(), 0);
  await ctx.close();
});

test("a stored rest-of-season horizon without a schedule falls back to Win now and still finds trades", async () => {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await p.route(/lm-api-reads\.fantasy\.espn\.com/, (r) => r.abort());
  await p.addInitScript(() => { try { localStorage.setItem("ci-tmode", "ros"); } catch {} });
  await p.goto(server.url + "#deals");
  await p.locator("#p-deals .trade").first().waitFor({ timeout: 10000 });
  assert.equal(await p.locator('#p-deals [role=radio][data-v="now"]').getAttribute("aria-checked"), "true");
  assert.equal(await p.locator('#p-deals [role=radio][data-v="ros"]').getAttribute("aria-checked"), "false");
  assert.ok((await p.locator("#p-deals .trade:not(.coach-made)").count()) > 0);
  assert.equal(await p.evaluate(() => localStorage.getItem("ci-tmode")), "ros", "the stored preference is kept for when the schedule loads");
  await ctx.close();
});

test("settings changed in two tabs don't overwrite each other", async () => {
  const ctx = await browser.newContext(); const a = await ctx.newPage(), b = await ctx.newPage();
  await a.goto(server.url + "#set"); await b.goto(server.url + "#set"); await settle(a);
  await a.click('.seg[aria-label="Theme"] button:has-text("Light")');
  await settle(b, 300);
  assert.equal(await b.evaluate(() => document.documentElement.dataset.theme), "light", "tab B picks up tab A's change");
  await b.click('.set-nav button:has-text("Layout")');
  await b.click('.seg[aria-label="Density"] button:has-text("Compact")');
  await settle(a, 300);
  const s = JSON.parse(await a.evaluate(() => localStorage.getItem("ci-settings")));
  assert.equal(s.mode, "light"); assert.equal(s.density, "compact");
  await ctx.close();
});

test("coach references added in two tabs are both kept", async () => {
  const ctx = await browser.newContext(); const a = await ctx.newPage(), b = await ctx.newPage();
  const addRef = async (p, title) => {
    await p.click('.set-nav button:has-text("Coach")');
    await p.click('.ref-modes button:has-text("Paste text")');
    await p.fill('input[aria-label="Title"]', title);
    await p.fill('textarea[aria-label="Reference text"]', "Rule from " + title);
    await p.click('.ref-btns button:has-text("Add reference")');
    await settle(p, 400);
  };
  await a.goto(server.url + "#set"); await b.goto(server.url + "#set"); await settle(a);
  await addRef(a, "Tab A notes");
  await addRef(b, "Tab B notes");
  const c = await ctx.newPage(); await c.goto(server.url + "#set"); await settle(c);
  await c.click('.set-nav button:has-text("Coach")');
  const titles = await c.locator(".ref-top b").allInnerTexts();
  assert.ok(titles.includes("Tab A notes") && titles.includes("Tab B notes"), "both references survive: " + titles.join(", "));
  await ctx.close();
});

test("compare ids that no longer exist are dropped", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  await p.goto(server.url + "#roster"); await settle(p);
  const real = await p.evaluate(() => document.querySelector("#p-roster .pl.clickable .nm")?.textContent);
  assert.ok(real);
  /* One real id from the page plus one that isn't in the data (as after reverting to the built-in snapshot). */
  await p.locator("#p-roster .pl.clickable").first().click();
  await p.click("text=Add to compare"); await p.keyboard.press("Escape");
  await p.evaluate(() => { const c = JSON.parse(sessionStorage.getItem("ci-cmp")); sessionStorage.setItem("ci-cmp", JSON.stringify([...c, "999999999"])); });
  await p.reload(); await settle(p);
  assert.deepEqual((await p.evaluate(() => JSON.parse(sessionStorage.getItem("ci-cmp")))).length, 1);
  await p.locator("#p-roster .pl.clickable").nth(1).click();
  assert.equal(await p.locator("button:has-text('Add to compare')").isEnabled(), true);
  assert.equal(await p.locator("button:has-text('Compare 2')").count(), 0, "no 'Compare 2' button with only one real player");
  await ctx.close();
});
