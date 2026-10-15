import { footprintOf, type Instance } from "./factoryProfile";

/*
 * Where the carrier is while the laser cutter and the press brake work on it. The simulation puts the carrier here and
 * the 3D shapes (MachineDetail.tsx) draw the machine around the same numbers, so the part and the machine always agree.
 * All of it is our example layout: the datasheets give sizes and capacities, not how the loading is built.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smooth = (a: number, b: number, v: number) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};

export type Pose = { x: number; z: number; y: number; /** tilt of the carrier about the x axis (radians, + tips the +z end down): it lies flat on the laser's inclined belt */ pitch?: number };

/**
 * One belt height for the whole line: the top of every belt, roller bed, turntable plate and transfer-cart deck. The tray is
 * 0.10 m deep below its own origin, so the carrier's origin rides TRAY_DROP above this and the tray floor rests on the belt.
 * Our example value (the datasheets give machine sizes, not the belt height).
 */
export const BELT_TOP = 0.68;
export const TRAY_DROP = 0.104;
export const ON_BELT = BELT_TOP + TRAY_DROP;
/** The conveyor's own height: the top of its belt is 0.035 below it. */
export const CONVEYOR_H = BELT_TOP + 0.035;
/** Carrier height on the laser's loading shelf: the sheet top (1.081) plus the tray's depth. */
export const LASER_SHELF_Y = 1.081 + TRAY_DROP;
/** Run of the loading ramp in front of the laser's pallet shelf (gentle enough for a tray), and how far its centre sits from the chamber centre. */
export const LASER_RAMP = 1.1;
export const LASER_PORT_DX = 0.185;

/** Laser cell: a closed cutting cell on the left, a pallet shelf on the right with a ramp in front. */
export function laserGeo(w: number, d: number) {
  const cellW = 5.2;
  const cellD = 3.6;
  const x0 = -w / 2;
  const z0 = -d / 2;
  const cellCx = x0 + cellW / 2;
  const cellCz = z0 + cellD / 2;
  const chW = w - cellW;
  const chCx = x0 + cellW + chW / 2;
  const shelfZ = z0 + 1.7;
  return { cellW, cellD, x0, z0, cellCx, cellCz, chW, chCx, shelfZ, shelfFront: shelfZ + 1.5, slide: chCx - cellCx };
}

/** Laser timeline: load onto the shelf (0 to 0.18), slide into the cell, cut, slide out, unload (to 1). */
export function laserFractions(p: number) {
  return { load: smooth(0, 0.18, p) - smooth(0.82, 1, p), slide: smooth(0.18, 0.32, p) - smooth(0.68, 0.82, p) };
}

/** Press brake: the tray rolls in from the infeed table to the bend line and out again. */
export function pressGeo(d: number) {
  const tableZ = d / 2 - 0.5;
  return { tableZ, dieZ: tableZ - 0.02 };
}
export const pressFraction = (p: number) => smooth(0, 0.15, p) - smooth(0.85, 1, p);

/** Pose of the carrier in the machine's local frame, given where it was handed over (the entry port) and the work progress 0..1. */
export function localPose(type: string, w: number, d: number, lx: number, lz: number, p: number): Pose | null {
  if (type === "laser_cutter") {
    const g = laserGeo(w, d);
    const { load, slide } = laserFractions(p);
    const zb = g.shelfFront + LASER_RAMP;
    const way: [number, number][] = [[lz, ON_BELT], [zb, ON_BELT], [g.shelfFront, LASER_SHELF_Y], [g.shelfZ, LASER_SHELF_Y]];
    const total = way[0][0] - way[3][0];
    let at = load * total;
    let z = way[0][0];
    let y = way[0][1];
    for (let i = 1; i < way.length; i++) {
      const run = way[i - 1][0] - way[i][0];
      const k = run > 0 ? Math.min(1, at / run) : 1;
      z = way[i - 1][0] - run * k;
      y = way[i - 1][1] + (way[i][1] - way[i - 1][1]) * k;
      at -= run;
      if (at <= 0) break;
    }
    // on the ramp the tray lies on the inclined belt; it eases into and out of the slope over 12 cm at each end
    const slope = Math.atan2(LASER_SHELF_Y - ON_BELT, LASER_RAMP);
    const onRamp = Math.min(smooth(0, 0.12, zb - z), smooth(0, 0.12, z - g.shelfFront));
    return { x: lx - g.slide * slide, z, y, pitch: z < zb && z > g.shelfFront ? slope * onRamp : 0 };
  }
  if (type === "press_brake") {
    const g = pressGeo(d);
    const a = pressFraction(p);
    return { x: lx, z: lz + (g.dieZ - lz) * a, y: ON_BELT };
  }
  return null;
}

/** World pose of the carrier of `e` while it is worked on, or null when this machine does not move the carrier. */
export function pathOf(e: Instance, px: number, pz: number, p: number): Pose | null {
  if (e.type !== "laser_cutter" && e.type !== "press_brake") return null;
  const f = footprintOf(e);
  const lp = localPose(e.type, f.w, f.d, px - e.position_m.x, pz - e.position_m.y, p);
  return lp ? { x: e.position_m.x + lp.x, z: e.position_m.y + lp.z, y: lp.y, pitch: lp.pitch } : null;
}

/**
 * 2-station positioner: two roller-bed plates sit left and right of the turntable's centre, level with the belt. The tray rolls
 * onto the entry plate, the robot works on it, and then the table turns half a revolution so the tray ends up on the exit plate.
 */
export const POSITIONER_DX = 0.65;
/** Where the turntable's conveyor line is cut: the plates sweep this far from the centre. */
export const POSITIONER_CLEAR = 1.25;
export const positionerTurn = (p: number) => Math.PI * smooth(0.85, 1, p);

/** Rotate a tray's offset from the table centre about the vertical axis (same convention as a three.js object's rotation.y). */
export function turnAbout(dx: number, dz: number, a: number) {
  return { x: dx * Math.cos(a) + dz * Math.sin(a), z: -dx * Math.sin(a) + dz * Math.cos(a) };
}

/** Stretches of a through conveyor that a machine's own belt or table takes over (a belt is cut where the machine has its own, so two belts never overlap). Local x offsets from the machine centre. */
export function beltGap(type: string, w: number): [number, number] | null {
  if (type === "positioner_2station") return [-POSITIONER_CLEAR, POSITIONER_CLEAR];
  if (type === "inspection_station") return [-(w / 2 + 0.46), w / 2 + 0.46];
  if (type === "laser_marker") return [-(w / 2 + 0.6), w / 2 + 0.6];
  return null;
}
