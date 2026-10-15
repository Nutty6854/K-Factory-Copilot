import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { equipmentById } from "@/data/factoryProfile";
import type { Token } from "@/data/plantSim";

/*
 * What a carrier holds on its way down the line. The product is assumed to be a stamped steel bracket (the profile's
 * industry line says brackets; the shapes are an example, not a drawing). Each stage is one merged mesh with vertex
 * colours, so a carrier costs one draw call for its part, one for the tray and one for the carton.
 *
 * Stages: 0 raw sheets, 1 laser-cut blanks, 2 bent brackets, 3 deburred and washed (bright), 4 machined (holes),
 * 5 welded pair (weld seam), 6 inspected (green tag), 7 marked (tag and etched mark), 8 packed (carton).
 */

export const STAGES = 9;

const C = {
  raw: "#8e979a",
  cut: "#9aa3a6",
  bent: "#a6aeb0",
  bright: "#dfe3e4",
  hole: "#2b3236",
  weld: "#4a3f38",
  tagOk: "#2fa36b",
  etch: "#3a4144",
  tray: "#7d8789",
  trayDark: "#4d5658",
  carton: "#c9b27c",
  tape: "#b69f66",
};

type Piece = { w: number; h: number; d: number; x: number; y: number; z: number; color: string; ry?: number };

function build(pieces: Piece[]): THREE.BufferGeometry {
  const parts = pieces.map((p) => {
    const g = new THREE.BoxGeometry(p.w, p.h, p.d);
    if (p.ry) g.rotateY(p.ry);
    g.translate(p.x, p.y, p.z);
    const col = new THREE.Color(p.color);
    const n = g.getAttribute("position").count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  });
  return mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
}

// the tray is 0.46 x 0.10 x 0.32; everything below sits on its floor at y = 0.05 (local, tray centre at 0)
const Y0 = 0.052;

/** one L bracket lying on the tray: base plate and an upright flange */
const bracket = (x: number, z: number, color: string, holes = false): Piece[] => [
  { w: 0.17, h: 0.008, d: 0.12, x, y: Y0, z, color },
  { w: 0.17, h: 0.07, d: 0.008, x, y: Y0 + 0.035, z: z - 0.056, color },
  ...(holes
    ? [
        { w: 0.016, h: 0.0095, d: 0.016, x: x - 0.04, y: Y0 + 0.0005, z: z + 0.02, color: C.hole },
        { w: 0.016, h: 0.0095, d: 0.016, x: x + 0.04, y: Y0 + 0.0005, z: z + 0.02, color: C.hole },
      ]
    : []),
];

const sheet = (x: number, z: number, y: number, color: string, cutouts = false): Piece[] => [
  { w: 0.19, h: 0.008, d: 0.13, x, y, z, color },
  ...(cutouts
    ? [
        { w: 0.03, h: 0.0095, d: 0.03, x: x - 0.04, y, z: z + 0.015, color: C.hole },
        { w: 0.03, h: 0.0095, d: 0.03, x: x + 0.04, y, z: z + 0.015, color: C.hole },
        { w: 0.05, h: 0.0095, d: 0.012, x, y, z: z - 0.04, color: C.hole },
      ]
    : []),
];

let cached: THREE.BufferGeometry[] | null = null;

/** merged geometry per stage (index 0..7; stage 8 is the carton, drawn separately) */
export function stageGeometries(): THREE.BufferGeometry[] {
  if (cached) return cached;
  const raw: Piece[] = [-0.1, 0.1].flatMap((x) => [0, 1, 2, 3].map((i) => ({ w: 0.2, h: 0.008, d: 0.28, x, y: Y0 + i * 0.009, z: 0, color: C.raw })));
  const cut: Piece[] = [-0.1, 0.1].flatMap((x) => [0, 1, 2].flatMap((i) => sheet(x, 0, Y0 + i * 0.012, C.cut, i === 2)));
  const bent: Piece[] = [bracket(-0.1, -0.02, C.bent), bracket(0.1, -0.02, C.bent), bracket(-0.1, 0.1, C.bent), bracket(0.1, 0.1, C.bent)].flat();
  const bright: Piece[] = [bracket(-0.1, -0.02, C.bright), bracket(0.1, -0.02, C.bright), bracket(-0.1, 0.1, C.bright), bracket(0.1, 0.1, C.bright)].flat();
  const machined: Piece[] = [bracket(-0.1, -0.02, C.bright, true), bracket(0.1, -0.02, C.bright, true), bracket(-0.1, 0.1, C.bright, true), bracket(0.1, 0.1, C.bright, true)].flat();
  // welded pair: two brackets joined back to back into a box section, dark seam along the joint
  const welded = (x: number): Piece[] => [
    ...bracket(x, 0.0, C.bright, true),
    { w: 0.17, h: 0.008, d: 0.12, x, y: Y0 + 0.07, z: 0.0, color: C.bright },
    { w: 0.17, h: 0.07, d: 0.008, x, y: Y0 + 0.035, z: 0.056, color: C.bright },
    { w: 0.172, h: 0.012, d: 0.012, x, y: Y0 + 0.07, z: -0.056, color: C.weld },
    { w: 0.172, h: 0.012, d: 0.012, x, y: Y0 + 0.07, z: 0.056, color: C.weld },
  ];
  const weldedBoth = [...welded(-0.1), ...welded(0.1)];
  const tagged = [...weldedBoth, { w: 0.07, h: 0.004, d: 0.045, x: 0, y: Y0 + 0.088, z: 0.02, color: C.tagOk }];
  const marked = [...tagged, { w: 0.05, h: 0.004, d: 0.012, x: -0.1, y: Y0 + 0.082, z: 0.0, color: C.etch }, { w: 0.05, h: 0.004, d: 0.012, x: 0.1, y: Y0 + 0.082, z: 0.0, color: C.etch }];
  cached = [raw, cut, bent, bright, machined, weldedBoth, tagged, marked].map(build);
  return cached;
}

export function trayGeometry(): THREE.BufferGeometry {
  return build([
    { w: 0.46, h: 0.02, d: 0.32, x: 0, y: 0.01 - 0.05, z: 0, color: C.tray },
    { w: 0.46, h: 0.1, d: 0.018, x: 0, y: 0, z: 0.151, color: C.tray },
    { w: 0.46, h: 0.1, d: 0.018, x: 0, y: 0, z: -0.151, color: C.tray },
    { w: 0.018, h: 0.1, d: 0.32, x: 0.221, y: 0, z: 0, color: C.tray },
    { w: 0.018, h: 0.1, d: 0.32, x: -0.221, y: 0, z: 0, color: C.tray },
    { w: 0.46, h: 0.012, d: 0.02, x: 0, y: 0.05, z: 0.151, color: C.trayDark },
    { w: 0.46, h: 0.012, d: 0.02, x: 0, y: 0.05, z: -0.151, color: C.trayDark },
  ]);
}

export function cartonGeometry(): THREE.BufferGeometry {
  return build([
    { w: 0.46, h: 0.2, d: 0.32, x: 0, y: 0.05, z: 0, color: C.carton },
    { w: 0.06, h: 0.002, d: 0.322, x: 0, y: 0.151, z: 0, color: C.tape },
  ]);
}

// --- which stage a carrier is in ---------------------------------------------------------------------------------

/** the stage a carrier has when it leaves a machine of this type */
const AFTER: Record<string, number> = {
  raw_rack: 0,
  laser_cutter: 1,
  press_brake: 2,
  deburring: 3,
  washer_dryer: 3,
  fixture: 4,
  positioner_2station: 5,
  inspection_station: 6,
  laser_marker: 7,
  packing_station: 8,
};

const stageAfter = (nodeId: string | undefined) => {
  const e = nodeId ? equipmentById(nodeId) : null;
  return e ? AFTER[e.type] ?? 0 : 0;
};

/** how far through its cycle a machine is when the part has its new shape: when the work is done, not half way */
const CHANGE_AT: Record<string, number> = {
  laser_cutter: 0.85,
  press_brake: 0.9,
  deburring: 0.5,
  washer_dryer: 0.5,
  fixture: 0.9,
  positioner_2station: 0.86,
  inspection_station: 0.9,
  laser_marker: 0.9,
  packing_station: 0.9,
};

/**
 * Stage of a carrier right now: on its way it carries what its last machine made; inside a machine it changes half way
 * through the cycle (the cut sheet appears when the laser is half done, and so on).
 */
export function stageOf(k: Token): number {
  if (k.phase === "proc" && k.node) {
    // what came in until half way, what the machine makes after that (a washer or a second fixture changes nothing)
    const type = equipmentById(k.node)?.type ?? "";
    return k.progress < (CHANGE_AT[type] ?? 0.5) ? stageAfter(k.src) : stageAfter(k.node);
  }
  return stageAfter(k.leg?.from);
}
