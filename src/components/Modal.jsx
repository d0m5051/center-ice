/* Accessible modal dialog.
   - Rendered into #modal-root, outside #app, so the whole app can be made `inert` while a dialog is open:
     background content can't be tabbed to, clicked, or read by screen readers.
   - Tab and Shift+Tab are also trapped inside the dialog (covers browsers without `inert`).
   - Escape and a backdrop click close it.
   - Focus moves into the dialog on open and returns to the element that opened it on close (the host remembers it,
     so switching from one dialog straight to another, e.g. player -> compare, still returns to the original trigger). */
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.hidden && el.getClientRects().length > 0 && !el.closest("[inert]"));

export function Modal({ label, onClose, className = "", children, initialFocus }) {
  const ov = useRef(null), box = useRef(null);

  useLayoutEffect(() => {
    const b = box.current; if (!b) return;
    const target = (initialFocus && b.querySelector(initialFocus)) || b.querySelector("[data-autofocus]") || focusables(b)[0] || b;
    target.focus({ preventScroll: true });
  }, [initialFocus]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const f = focusables(box.current);
      if (!f.length) { e.preventDefault(); box.current.focus(); return; }
      const first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || !box.current.contains(a))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !box.current.contains(a))) { e.preventDefault(); first.focus(); }
    };
    /* Catch focus that escapes by other means (e.g. a click on browser chrome then Tab back in). */
    const onFocusIn = (e) => { if (box.current && !box.current.contains(e.target)) { const f = focusables(box.current); (f[0] || box.current).focus(); } };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("focusin", onFocusIn); };
  }, [onClose]);

  return createPortal(
    <div className="ov" ref={ov} onMouseDown={(e) => { if (e.target === ov.current) onClose(); }}>
      <div className={`ov-box ${className}`.trim()} ref={box} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.getElementById("modal-root"),
  );
}

/* Host-level effects: inert background, scroll lock, focus restore. `open` is whether any dialog is showing. */
export function useModalHost(open) {
  const opener = useRef(null), lastOutside = useRef(null);
  /* The dialog focuses itself in its own layout effect, which runs before this host's, so document.activeElement is
     already inside the dialog by then. Track the last element focused outside the dialogs instead. */
  useEffect(() => {
    const f = (e) => { if (!e.target.closest || !e.target.closest("#modal-root")) lastOutside.current = e.target; };
    document.addEventListener("focusin", f, true);
    return () => document.removeEventListener("focusin", f, true);
  }, []);
  useLayoutEffect(() => {
    const app = document.getElementById("app");
    if (open) {
      if (!opener.current) { const a = document.activeElement; opener.current = a && !a.closest("#modal-root") ? a : lastOutside.current; }
      app.inert = true; app.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "hidden";
      return;
    }
    app.inert = false; app.removeAttribute("aria-hidden");
    document.body.style.overflow = "";
    const el = opener.current; opener.current = null;
    if (el && el.isConnected && typeof el.focus === "function") el.focus({ preventScroll: true });
    else if (el) document.querySelector('.tab[aria-selected="true"]')?.focus({ preventScroll: true });
  }, [open]);
}

export const ModalHead = ({ title, sub, onClose, extra }) => (
  <div className="ov-head">
    <div><h2 className="ov-title">{title}</h2>{sub && <p className="note ov-sub">{sub}</p>}</div>
    <div className="ov-btns">{extra}<button className="btn ghost" type="button" onClick={onClose}>Close</button></div>
  </div>
);
