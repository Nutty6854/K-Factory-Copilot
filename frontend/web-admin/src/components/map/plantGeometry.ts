import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Net } from "@/data/factoryProfile";

/*
 * Drawing helpers shared by the main map (FactoryMap) and the /lab/plant overview.
 * Solid stroke = backed by a source, dashed stroke = assumption (the profile's provenance says so).
 */

/** Line colour, tube radius and run height (m) per utility net. */
export const NET_STYLE: Record<Net, { color: string; radius: number; height: number; label: string }> = {
  power: { color: "#e0a030", radius: 0.03, height: 3.0, label: "전원" },
  air: { color: "#8a7fbf", radius: 0.025, height: 2.7, label: "압축공기" },
  gas: { color: "#6d8e7d", radius: 0.025, height: 2.45, label: "보호가스" },
  exhaust: { color: "#8a8f7e", radius: 0.1, height: 2.2, label: "집진 덕트" },
  signal: { color: "#94a3a8", radius: 0.02, height: 0.4, label: "신호" },
  bundle: { color: "#4c6266", radius: 0.035, height: 0.45, label: "케이블 묶음" },
  // runs below the floor in reality; drawn on the trench cover (just above the floor) so dashed vs solid can be seen
  cooling: { color: "#3f8fbd", radius: 0.06, height: 0.035, label: "냉각수 (바닥 아래)" },
};

const DASH = 0.34;
const GAP = 0.22;
const UP = new THREE.Vector3(0, 1, 0);

/** Straight polyline as merged cylinders, either continuous or dashed (same dash rhythm everywhere). */
export function strokeGeometry(points: THREE.Vector3[], radius: number, dashed: boolean, sides = 8): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const q = new THREE.Quaternion();
  let phase = 0; // distance into the current dash+gap cycle
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = a.distanceTo(b);
    if (len < 1e-6) continue;
    const dir = b.clone().sub(a).divideScalar(len);
    q.setFromUnitVectors(UP, dir);
    const piece = (t0: number, t1: number) => {
      const g = new THREE.CylinderGeometry(radius, radius, t1 - t0, sides, 1, true);
      g.applyQuaternion(q);
      const m = a.clone().addScaledVector(dir, (t0 + t1) / 2);
      g.translate(m.x, m.y, m.z);
      parts.push(g);
    };
    if (!dashed) {
      piece(0, len);
      continue;
    }
    let t = 0;
    while (t < len - 1e-6) {
      if (phase < DASH) {
        const step = Math.min(DASH - phase, len - t);
        piece(t, t + step);
        t += step;
        phase += step;
      } else {
        const step = Math.min(DASH + GAP - phase, len - t);
        t += step;
        phase += step;
      }
      if (phase >= DASH + GAP - 1e-6) phase = 0;
    }
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}
