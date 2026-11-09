import { useSyncExternalStore } from "react";

export const REDUCED_MOTION_QUERY: string = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query: MediaQueryList = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
