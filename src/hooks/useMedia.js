import { useSyncExternalStore } from "react";
export function useMedia(q) {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(q).matches,
  );
}
export const useWide = () => useMedia("(min-width:1000px)");
