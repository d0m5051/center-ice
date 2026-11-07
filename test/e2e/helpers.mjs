/* Browser regression tests: serve the production build with `vite preview` and drive it with Playwright.
   Run with `npm run test:e2e` (builds first). Playwright resolves from the project or a global install. */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const { chromium } = require("playwright");

export async function startServer(port = 4300 + Math.floor(Math.random() * 500)) {
  const proc = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { cwd: new URL("../..", import.meta.url).pathname, stdio: "ignore", detached: true });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return { url, stop: () => { try { process.kill(-proc.pid); } catch {} } }; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  try { process.kill(-proc.pid); } catch {}
  throw new Error("vite preview did not start");
}

/* Wait until a page shows the panel content we need (worker jobs finished). */
export const settle = (page, ms = 600) => page.waitForTimeout(ms);
