"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/*
 * Scenarios injected on the plant, shared between the main app and the /lab/plant view (and between
 * browser tabs): equipment id → scenario id (see plantStatus.ts). Both sides read the same record, so a
 * fault injected in one place shows up in the other. Stored in localStorage; nothing leaves the browser.
 */

export type Injected = Record<string, string>;

const KEY = "kfc.plantInjected.v1";
const EVENT = "kfc-plant-injected";
const EMPTY = "{}";

const read = (): string => {
  try {
    return localStorage.getItem(KEY) ?? EMPTY;
  } catch {
    return EMPTY;
  }
};

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function writeInjected(next: Injected) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the change then only lives until reload */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** [injected, setInjected]; setInjected accepts a value or an updater, like useState. */
export function useSharedInjected(): [Injected, (next: Injected | ((prev: Injected) => Injected)) => void] {
  const raw = useSyncExternalStore(subscribe, read, () => EMPTY);
  const injected = useMemo<Injected>(() => {
    try {
      return JSON.parse(raw) as Injected;
    } catch {
      return {};
    }
  }, [raw]);
  const set = useCallback((next: Injected | ((prev: Injected) => Injected)) => {
    let prev: Injected = {};
    try {
      prev = JSON.parse(read()) as Injected;
    } catch {
      /* start from empty */
    }
    writeInjected(typeof next === "function" ? next(prev) : next);
  }, []);
  return [injected, set];
}
