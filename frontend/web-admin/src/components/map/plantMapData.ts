import * as THREE from "three";
import {
  equipmentById,
  footprintEvidence,
  footprintOf,
  profile,
  typeOf,
  type Connection,
  type Instance,
} from "@/data/factoryProfile";
import { fixtureFor } from "@/data/plantSim";
import { NET_STYLE } from "@/components/map/plantGeometry";

/*
 * Everything the main map needs from the factory profile, derived once.
 * Plan x → scene x, plan y → scene z (same as /lab/plant), so both views share one coordinate truth.
 */

export const BUILDING = profile.factory.building_m;
export const MACHINES = profile.equipment;

/** The two conveyors are background: no label, no click, not counted. */
export const isBackground = (e: Instance) => e.type === "conveyor";
/** Only machines with a demo_id are judged by the Rule Engine, so only they can be selected. */
export const isSelectable = (e: Instance) => !!e.demo_id;
export const LABELED = MACHINES.filter((e) => !isBackground(e));
export const SELECTABLE = MACHINES.filter(isSelectable);
export const byDemoId = (demoId: string) => SELECTABLE.find((e) => e.demo_id === demoId) ?? null;

export const titleOf = (e: Instance) => e.label?.title || typeOf(e).name_ko;
/** Shown only on hover or selection (process, cooling line, power ...). */
export function subOf(e: Instance) {
  if (e.shared_systems && isSelectable(e)) {
    const sys = e.shared_systems;
    // the power zone is named after the panel that feeds it (전원반 A), the cooling line by its own Korean name
    const panel = MACHINES.find((m) => m.type === "power_panel" && m.shared_systems?.power_zone === sys.power_zone);
    const parts = [e.label?.sub ?? e.role_short, sys.cooling_line && profile.shared_systems[sys.cooling_line]?.name_ko, panel && titleOf(panel)];
    return parts.filter(Boolean).join(" · ");
  }
  return e.label?.sub ?? (e.label?.title ? typeOf(e).name_ko : null);
}
export const footprintAssumed = (e: Instance) => footprintEvidence(e) === "assumed";

export function boxOf(e: Instance) {
  const f = footprintOf(e);
  return { cx: e.position_m.x, cz: e.position_m.y, w: f.w, d: f.d, h: f.h };
}

/**
 * "Machine side" used for the zoom stages: the median footprint side of the labelled machines (2.2 m in line A).
 * Stage 2 starts when that length is 48 px or more on screen, and ends below 40 px.
 */
export const REF_SIDE_M = (() => {
  const s = LABELED.map((e) => {
    const b = boxOf(e);
    return Math.max(b.w, b.d);
  }).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
})();

/* ── process zones (floor names in stage 1) ───────────────────────────── */

/** Short Korean name per process step. Stations S1–S3 take their name from their fixture's floor label in the profile. */
const STEP_KO: Record<string, string> = {
  blanking: "절단",
  bending: "벤딩",
  inspection_final: "검사",
  packing: "출하",
};

export type Zone = { id: string; name: string; at: THREE.Vector3; x0: number; x1: number; z0: number; z1: number };

export const ZONES: Zone[] = (() => {
  const zones: Zone[] = [];
  const bounds = (es: Instance[]) => {
    let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const e of es) {
      const b = boxOf(e);
      x0 = Math.min(x0, b.cx - b.w / 2);
      x1 = Math.max(x1, b.cx + b.w / 2);
      z0 = Math.min(z0, b.cz - b.d / 2);
      z1 = Math.max(z1, b.cz + b.d / 2);
    }
    return { x0, x1, z0, z1 };
  };
  for (const [step, name] of Object.entries(STEP_KO)) {
    const es = MACHINES.filter((e) => e.process_step === step);
    if (!es.length) continue;
    const b = bounds(es);
    zones.push({ id: step, name, ...b, at: new THREE.Vector3((b.x0 + b.x1) / 2, 0, b.z1 + 0.9) });
  }
  // robot stations: the robot, its fixture and its controller
  for (const r of SELECTABLE) {
    const f = fixtureFor(r);
    const name = f?.label?.below?.split("\n")[0];
    if (!f || !name) continue;
    const b = bounds([r, f]);
    zones.push({ id: `station-${r.id}`, name, ...b, at: new THREE.Vector3(f.position_m.x, 0, b.z1 + 0.9) });
  }
  return zones.sort((a, b) => a.at.x - b.at.x);
})();

/* ── cells: what the camera frames when a robot is selected or turns abnormal ── */

export function cellPoints(e: Instance): THREE.Vector3[] {
  // the robot's station: its own pitch along the line (±3.4 m), from behind its controller to past the fixture
  const members = [e, ...MACHINES.filter((m) => (m.type === "fixture" || m.type === "positioner_2station" || m.type === "robot_controller") && Math.abs(m.position_m.x - e.position_m.x) < 0.5)];
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const m of members) {
    const b = boxOf(m);
    z0 = Math.min(z0, b.cz - b.d / 2);
    z1 = Math.max(z1, b.cz + b.d / 2);
  }
  const x = e.position_m.x;
  const pts: THREE.Vector3[] = [];
  for (const dx of [-3.4, 3.4]) for (const z of [z0 - 0.4, z1 + 0.8]) for (const y of [0, 2.2]) pts.push(new THREE.Vector3(x + dx, y, z));
  return pts;
}

/* ── connections of one machine (stage 3) ─────────────────────────────── */

export type ConnPath = {
  id: string;
  color: string;
  radius: number;
  /** dashed + 가정 when the profile marks the connection as an assumption */
  assumed: boolean;
  /** needs_confirmation: dashed + "? 가정" */
  pending: boolean;
  points: THREE.Vector3[];
  /** where the tag sits: on the path, close to the consumer end */
  tagAt: THREE.Vector3;
};

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const routeById = Object.fromEntries(profile.routes.map((r) => [r.id, r]));

/** One connection as a single polyline: source stub → shared bus or trench → drop to the consumer. */
function pathOf(c: Connection): THREE.Vector3[] | null {
  const a = equipmentById(c.from);
  const b = equipmentById(c.to);
  if (!a || !b) return null;
  const H = NET_STYLE[c.net].height;
  if (c.waypoints_m) {
    const ba = boxOf(a);
    const bb = boxOf(b);
    return [v3(ba.cx, Math.min(H, ba.h), ba.cz), ...c.waypoints_m.map(([x, y]) => v3(x, H, y)), v3(bb.cx, Math.min(H, bb.h), bb.cz)];
  }
  const r = c.route ? routeById[c.route] : null;
  if (!r) return null;
  const busZ = r.polyline_m[0][1];
  const ba = boxOf(a);
  const bb = boxOf(b);
  const dropX = bb.cx + (c.drop_offset_m ?? 0);
  const endZ = bb.cz > busZ ? bb.cz - bb.d / 2 : bb.cz + bb.d / 2;
  return [
    v3(ba.cx, Math.min(H, ba.h), ba.cz),
    v3(ba.cx, H, busZ),
    v3(dropX, H, busZ),
    v3(dropX, H, endZ),
    v3(dropX, Math.min(H, Math.max(bb.h, 0.2)), endZ),
  ];
}

/** Point `d` metres back from the end of a polyline. */
function backFromEnd(points: THREE.Vector3[], d: number) {
  let left = d;
  for (let i = points.length - 1; i > 0; i--) {
    const seg = points[i].distanceTo(points[i - 1]);
    if (left <= seg && seg > 0) return points[i].clone().lerp(points[i - 1], left / seg);
    left -= seg;
  }
  return points[0].clone();
}

/**
 * Connections drawn when a machine is selected: its own, plus what feeds the cable bundles that end at it
 * (e.g. Robot 03 gets its cooling water through the weld power source's torch bundle).
 */
export function connectionsOf(id: string): ConnPath[] {
  const own = profile.connections.filter((c) => c.to === id || c.from === id);
  const bundleSources = own.filter((c) => c.net === "bundle" && c.to === id).map((c) => c.from);
  const upstream = profile.connections.filter((c) => bundleSources.includes(c.to) && c.net !== "bundle" && c.net !== "signal");
  const out: ConnPath[] = [];
  for (const c of [...own, ...upstream]) {
    const points = pathOf(c);
    if (!points) continue;
    const st = NET_STYLE[c.net];
    out.push({
      id: c.id,
      color: st.color,
      radius: st.radius * 1.4,
      assumed: c.provenance.confidence === "assumed",
      pending: c.status === "needs_confirmation",
      points,
      tagAt: backFromEnd(points, 1.1),
    });
  }
  return out;
}

/** Floor rectangle of a machine footprint, for the dashed / solid outline on hover. */
export function outlineOf(e: Instance, pad = 0.14): THREE.Vector3[] {
  const b = boxOf(e);
  const [x0, x1, z0, z1, y] = [b.cx - b.w / 2 - pad, b.cx + b.w / 2 + pad, b.cz - b.d / 2 - pad, b.cz + b.d / 2 + pad, 0.03];
  return [v3(x0, y, z0), v3(x1, y, z0), v3(x1, y, z1), v3(x0, y, z1), v3(x0, y, z0)];
}
