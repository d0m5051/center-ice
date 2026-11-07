/* Coach references: links, pasted text and files the user adds as background for the coach.
   File readers are loaded on demand (code-split), so PDF and Word support costs nothing until it's used. */

export const REF_ITEM_MAX = 60000, REF_DB_MAX = 400000;
export const REF_SEED = [{ id: "yt-aECMS-LMMTY", kind: "video", title: "Add THESE Players to Win Your Week - Weekend 4 - Fantasy Hockey 2026/27 (Fantasy Tipped)", url: "https://youtu.be/aECMS-LMMTY", text: "", on: true, added: "2026-10-28T03:05:00.000Z" }];

export const refId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const host = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
export const isVideo = (u) => /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|twitch\.tv|instagram\.com)$/i.test(host(u));

async function pdfText(f) {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise, out = [];
  for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out.push(c.items.map((x) => x.str + (x.hasEOL ? "\n" : " ")).join(""));
  }
  return out.join("\n\n");
}

async function docxText(f) {
  const { default: JSZip } = await import("jszip");
  const z = await JSZip.loadAsync(await f.arrayBuffer()), x = z.file("word/document.xml");
  if (!x) throw new Error("no document text found");
  const d = new DOMParser().parseFromString(await x.async("string"), "application/xml"), W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return [...d.getElementsByTagNameNS(W, "p")].map((p) => [...p.getElementsByTagNameNS(W, "t")].map((t) => t.textContent).join("")).join("\n");
}

const TEXT_EXT = ["txt", "md", "markdown", "csv", "tsv", "json", "srt", "vtt", "html", "htm", "xml", "log", "text"];
const MEDIA_EXT = ["mp4", "mov", "m4v", "webm", "mp3", "m4a", "wav", "jpg", "jpeg", "png", "gif", "heic", "webp"];

export async function readRefFile(f) {
  const ext = (f.name.split(".").pop() || "").toLowerCase(), ty = f.type || "";
  if (f.size > 15e6) throw new Error("it's over 15 MB");
  if (/^(video|audio|image)\//.test(ty) || MEDIA_EXT.includes(ext)) throw new Error("video, audio and image files can't be read here. Paste a transcript instead");
  let t;
  if (ext === "pdf" || ty === "application/pdf") t = await pdfText(f);
  else if (ext === "docx") t = await docxText(f);
  else if (TEXT_EXT.includes(ext) || ty.startsWith("text/")) {
    t = await f.text();
    if (["html", "htm"].includes(ext) || ty === "text/html") { const d = new DOMParser().parseFromString(t, "text/html"); d.querySelectorAll("script,style,noscript,nav,footer").forEach((n) => n.remove()); t = (d.body || d.documentElement).textContent; }
    if (ext === "srt" || ext === "vtt") t = t.replace(/^WEBVTT.*$/m, "").replace(/^\d+\s*$/gm, "").replace(/^[\d:.,]+\s*-->\s*[\d:.,]+.*$/gm, "").replace(/<[^>]+>/g, "");
  } else throw new Error("that file type isn't supported. Use PDF, Word (.docx), text or Markdown");
  t = (t || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) throw new Error("no readable text was found (a scanned PDF has none)");
  return t;
}
