import { useSyncExternalStore } from "react";

const WIDE_LAYOUT_QUERY = "(min-width: 1140px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE_LAYOUT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(WIDE_LAYOUT_QUERY).matches;
}

export function useWideLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
