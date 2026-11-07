/* Boot: settings and look are applied synchronously (the inline script in index.html already set the theme), then the
   stored league data is read from IndexedDB before the first render, so the page never flashes stale numbers. */
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import EMBED from "./data/snapshot.json";
import { loadSettings } from "./lib/settings.js";
import { applyLook } from "./lib/look.js";
import { validData } from "./lib/model.js";
import { migrateFromLocalStorage, idbGetMany, requestPersistence } from "./lib/storage.js";
import { REF_SEED } from "./lib/refs.js";
import "./styles/app.css";

const S = loadSettings();
applyLook(S);

(async () => {
  await migrateFromLocalStorage();
  const [d, g, r, ct] = await idbGetMany(["ci-data", "ci-games", "ci-refs", "ci-coach-trades"]);
  const data = validData(d) && d.snapshot > EMBED.snapshot ? d : EMBED;
  const boot = {
    S, data,
    gcache: g && Array.isArray(g.g) && g.g.length ? g : null,
    refs: r && Array.isArray(r.refs) ? r.refs : REF_SEED.slice(),
    refsAt: (r && r.savedAt) || "",
    ctrades: Array.isArray(ct) ? ct : [],
  };
  createRoot(document.getElementById("app")).render(<App boot={boot} />);
  requestPersistence();
})();
