"use client";

import { useMemo } from "react";
import * as THREE from "three";

export type Tokens = Record<"bg" | "floor" | "grid" | "primary" | "anom" | "surface", string>;
export const TOKEN_VARS: Record<keyof Tokens, string> = {
  bg: "--kf-bg",
  floor: "--kf-map-floor",
  grid: "--kf-map-grid",
  primary: "--kf-primary",
  anom: "--kf-equip-anom",
  surface: "--kf-surface",
};
export function readTokens(): Tokens {
  const s = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.entries(TOKEN_VARS).map(([k, v]) => [k, s.getPropertyValue(v).trim()]),
  ) as Tokens;
}


export const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;


export function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}


/* ── materials ────────────────────────────────────────────────────── */

export function useMats(t: Tokens, real = false) {
  return useMemo(() => {
    const paint = new THREE.MeshPhysicalMaterial({
      color: "#eceff0",
      roughness: 0.38,
      metalness: 0.05,
      clearcoat: real ? 0.9 : 0.6,
      clearcoatRoughness: real ? 0.18 : 0.25,
      envMapIntensity: real ? 1.3 : 1,
    });
    const accent = new THREE.MeshStandardMaterial({ color: t.primary, roughness: 0.45, metalness: 0.1 });
    const graphite = new THREE.MeshStandardMaterial({ color: "#2b3236", roughness: real ? 0.4 : 0.5, metalness: real ? 0.7 : 0.55, envMapIntensity: real ? 1.3 : 1 });
    const aluminum = new THREE.MeshStandardMaterial({ color: "#b9c0c5", roughness: real ? 0.26 : 0.32, metalness: 0.9, envMapIntensity: real ? 1.4 : 1 });
    const rubber = new THREE.MeshStandardMaterial({ color: "#16191b", roughness: real ? 0.6 : 0.75, metalness: 0 });
    const steel = new THREE.MeshStandardMaterial({ color: "#8d979d", roughness: real ? 0.38 : 0.5, metalness: real ? 0.85 : 0.7, envMapIntensity: real ? 1.3 : 1 });
    const belt = new THREE.MeshStandardMaterial({ color: "#2b3134", roughness: 0.9, metalness: 0 });
    const yellow = new THREE.MeshStandardMaterial({ color: "#e0b020", roughness: 0.55, metalness: 0.1 });
    const zinc = new THREE.MeshStandardMaterial({ color: "#c9d1d6", roughness: 0.3, metalness: 0.85 });
    const cabinet = new THREE.MeshStandardMaterial({ color: "#d8dedd", roughness: 0.5, metalness: 0.3 });
    const crate = new THREE.MeshStandardMaterial({ color: "#6d8e7d", roughness: 0.7, metalness: 0 });
    const wood = new THREE.MeshStandardMaterial({ color: "#b99a6b", roughness: 0.85, metalness: 0 });
    const copper = new THREE.MeshStandardMaterial({ color: "#b87333", roughness: 0.35, metalness: 0.9 });
    return { paint, accent, graphite, aluminum, rubber, steel, belt, yellow, zinc, cabinet, crate, wood, copper };
  }, [t.primary, real]);
}


export type Mats = ReturnType<typeof useMats>;
