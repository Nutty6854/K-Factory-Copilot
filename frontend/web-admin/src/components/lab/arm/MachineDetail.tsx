"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { Act } from "@/data/plantSim";
import { BELT_TOP, LASER_PORT_DX, LASER_RAMP, LASER_SHELF_Y, POSITIONER_DX, laserFractions, laserGeo, pressFraction, pressGeo } from "@/data/machinePaths";
import { surfaceProps, type SurfaceKind } from "./surfaces";

/*
 * Detail geometry for every machine type on the line. The outer size is the profile footprint, untouched.
 * What is inside it (panels, doors, pallets, ram, stack...) is our simplification from public product
 * photos — shape detail is an assumption, never a measurement. `body` carries the evidence/status colour;
 * details stay neutral. Moving parts read the live activity of the machine from `act()` every frame.
 *
 * Local frame: x = machine width, z = depth (front = +z, towards the default camera), y up, origin on the floor.
 */

export type DetailProps = { w: number; d: number; h: number; body: string; opacity: number; emissive: string; ei: number; act: () => Act; /** how full a stock looks (0..1); undefined = static default */ level?: () => number | undefined; /** draw the surface textures (painted panels, brushed steel, speckled dark paint) */ tex?: boolean; /** realistic shading: clear-coated paint, polished metal that picks up the environment */ real?: boolean };

/** Which texture a neutral part gets from its colour: steel parts are brushed, dark parts are speckled paint. */
const surfOf = (color: string): SurfaceKind | null => (color === STEEL ? "steel" : color === DARK ? "dark" : null);
const surf = (p: DetailProps, kind: SurfaceKind | null) => (p.tex && kind ? surfaceProps(kind) : {});

const DARK = "#38464a";
const STEEL = "#aab4b7";
const GLASS = "#1d2c31";
const LINE = "#d9b74a";
const CARTON = "#c9b27c";

type Vec = [number, number, number];

function Part({ at, size, color, p, round = 0.02, metal = 0.15, rough = 0.6, glow = false }: { at: Vec; size: Vec; color: string; p: DetailProps; round?: number; metal?: number; rough?: number; glow?: boolean }) {
  const kind = surfOf(color);
  // with realistic shading brushed steel is polished metal, dark parts are satin black metal, the rest keeps its own values
  const m = p.real && kind === "steel" ? Math.max(metal, 0.85) : p.real && kind === "dark" ? Math.max(metal, 0.6) : metal;
  const r = p.real && kind === "steel" ? Math.min(rough, 0.4) : p.real && kind === "dark" ? Math.min(rough, 0.5) : rough;
  return (
    <RoundedBox args={size} radius={Math.min(round, size[0] / 2, size[1] / 2, size[2] / 2)} smoothness={p.real ? 3 : 2} position={at}>
      <meshPhysicalMaterial key={(p.tex ? "tex" : "plain") + (p.real ? "R" : "")} color={color} roughness={r} metalness={m} transparent opacity={p.opacity} emissive={glow ? color : "#000000"} emissiveIntensity={glow ? 0.9 : 0} envMapIntensity={p.real ? 1.3 : 1} {...surf(p, glow ? null : kind)} />
    </RoundedBox>
  );
}

/** Body panel: carries the colour code, plus the selection / status glow. Realistic shading adds a clear coat over the paint. */
function Body({ at, size, p, round = 0.03 }: { at: Vec; size: Vec; p: DetailProps; round?: number }) {
  // bigger edge radius under realistic shading: the rounded edges catch the light and show where one panel ends
  const rr = p.real ? Math.max(round, 0.07) : round;
  return (
    <RoundedBox args={size} radius={Math.min(rr, size[0] / 2, size[1] / 2, size[2] / 2)} smoothness={p.real ? 4 : 2} position={at}>
      <meshPhysicalMaterial key={(p.tex ? "tex" : "plain") + (p.real ? "R" : "")} color={p.body} roughness={p.real ? 0.46 : 0.6} metalness={p.real ? 0.3 : 0.15} clearcoat={p.real ? 0.75 : 0} clearcoatRoughness={0.22} envMapIntensity={p.real ? 1.2 : 1} transparent opacity={p.opacity} emissive={p.emissive} emissiveIntensity={p.ei} {...surf(p, "paint")} />
    </RoundedBox>
  );
}

function Cyl({ at, r, len, color, p, axis = "y", seg = 20 }: { at: Vec; r: number; len: number; color: string; p: DetailProps; axis?: "x" | "y" | "z"; seg?: number }) {
  const rot: Vec = axis === "x" ? [0, 0, Math.PI / 2] : axis === "z" ? [Math.PI / 2, 0, 0] : [0, 0, 0];
  const kind = surfOf(color);
  return (
    <mesh position={at} rotation={rot}>
      <cylinderGeometry args={[r, r, len, p.real ? Math.max(seg, 28) : seg]} />
      <meshPhysicalMaterial key={(p.tex ? "tex" : "plain") + (p.real ? "R" : "")} color={color} roughness={p.real && kind === "steel" ? 0.36 : 0.5} metalness={p.real && kind === "steel" ? 0.85 : 0.3} transparent opacity={p.opacity} envMapIntensity={p.real ? 1.3 : 1} {...surf(p, kind)} />
    </mesh>
  );
}

/** Stack light: green = working, amber = idle or slowed, red blinking = fault. */
function Lamp({ at, p, size = 0.1 }: { at: Vec; p: DetailProps; size?: number }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const a = p.act();
    let c = "#e8b04a";
    let i = 0.25;
    if (a.state === "fault") {
      c = "#e0463a";
      i = Math.sin(clock.elapsedTime * 8) > 0 ? 1.5 : 0.15;
    } else if (a.state === "slow") {
      c = "#e8b04a";
      i = 1;
    } else if (a.busy) {
      c = "#35c27a";
      i = 1.1;
    }
    m.color.set(c);
    m.emissive.set(c);
    m.emissiveIntensity = i;
  });
  return (
    <RoundedBox args={[size, size, size]} radius={size / 4} smoothness={2} position={at}>
      <meshStandardMaterial ref={ref} color="#e8b04a" emissive="#e8b04a" emissiveIntensity={0.25} transparent opacity={p.opacity} />
    </RoundedBox>
  );
}

/** A see-through pane (machine windows): the inside shows through, the frame and panels around it stay solid. */
function Glass({ at, size, p }: { at: Vec; size: Vec; p: DetailProps }) {
  return (
    <mesh position={at}>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#9fc4cc" roughness={0.08} metalness={0.2} transparent opacity={0.16 * p.opacity} depthWrite={false} />
    </mesh>
  );
}

/*
 * Openings for the machines the line runs through (deburring, washer, inspection, marking). The belt reaches them
 * along x at z = 0, so each end wall gets a doorway the carrier can pass: AP_W wide, from AP_Y0 to AP_Y1 above the floor.
 */
const AP_W = 0.84;
const AP_Y0 = 0.58;
const AP_Y1 = 1.2;

/** One end wall (thickness t, spanning z-length zl around z = cz) with or without a doorway; `ap` overrides the standard doorway (z relative to cz). */
function EndWall({ x, y0, y1, zl, t, open, p, cz = 0, ap }: { x: number; y0: number; y1: number; zl: number; t: number; open: boolean; p: DetailProps; cz?: number; ap?: { w: number; y0: number; y1: number; z: number } }) {
  if (!open) return <Body at={[x, (y0 + y1) / 2, cz]} size={[t, y1 - y0, zl]} p={p} round={0.01} />;
  const aw = ap?.w ?? AP_W;
  const ay0 = ap?.y0 ?? AP_Y0;
  const ay1 = ap?.y1 ?? AP_Y1;
  const az = ap?.z ?? 0;
  const lo = -zl / 2; // strip edges relative to cz
  const hi = zl / 2;
  const left = az - aw / 2 - lo;
  const right = hi - (az + aw / 2);
  return (
    <>
      <Body at={[x, (y0 + y1) / 2, cz + lo + left / 2]} size={[t, y1 - y0, left]} p={p} round={0.01} />
      <Body at={[x, (y0 + y1) / 2, cz + hi - right / 2]} size={[t, y1 - y0, right]} p={p} round={0.01} />
      <Body at={[x, (y0 + ay0) / 2, cz + az]} size={[t, ay0 - y0, aw]} p={p} round={0.01} />
      <Body at={[x, (ay1 + y1) / 2, cz + az]} size={[t, y1 - ay1, aw]} p={p} round={0.01} />
    </>
  );
}

/** A hollow cabin along x: front, back, roof and floor, with doorways in the end walls (`ends`: [west, east]) and a belt running through. */
function Tunnel({ cx, w, d, y0, y1, t = 0.05, ends = [true, true], p }: { cx: number; w: number; d: number; y0: number; y1: number; t?: number; ends?: [boolean, boolean]; p: DetailProps }) {
  return (
    <>
      {[-1, 1].map((sz) => (
        <Body key={sz} at={[cx, (y0 + y1) / 2, sz * (d / 2 - t / 2)]} size={[w, y1 - y0, t]} p={p} round={0.01} />
      ))}
      <Body at={[cx, y1 - t / 2, 0]} size={[w, t, d - 2 * t]} p={p} round={0.01} />
      <Part at={[cx, y0 + 0.02, 0]} size={[w - 2 * t, 0.04, d - 2 * t]} color={DARK} p={p} round={0.005} />
      <EndWall x={cx - w / 2 + t / 2} y0={y0} y1={y1} zl={d - 2 * t} t={t} open={ends[0]} p={p} />
      <EndWall x={cx + w / 2 - t / 2} y0={y0} y1={y1} zl={d - 2 * t} t={t} open={ends[1]} p={p} />
      <Part at={[cx, BELT_TOP - 0.03, 0]} size={[w, 0.06, 0.58]} color={STEEL} p={p} round={0.005} />
    </>
  );
}

/** A short belt outside a doorway: the infeed or outfeed belt the carrier rolls over. Rails on both sides, a roller at the outer end, and no legs so a parked transfer cart can stand under it. */
function BeltStub({ x, len, p }: { x: number; len: number; p: DetailProps }) {
  const out = x > 0 ? 1 : -1;
  const top = BELT_TOP;
  return (
    <>
      <Part at={[x, top - 0.017, 0]} size={[len, 0.034, 0.56]} color={DARK} p={p} round={0.006} rough={0.85} metal={0.1} />
      {[-1, 1].map((sz) => (
        <Part key={sz} at={[x, top + 0.02, sz * 0.3]} size={[len, 0.075, 0.035]} color={STEEL} p={p} round={0.005} />
      ))}
      <Cyl at={[x + out * (len / 2), top - 0.04, 0]} r={0.045} len={0.58} color={STEEL} p={p} axis="z" seg={20} />
      {[-0.2, -0.07, 0.07, 0.2].map((o) => (
        <Part key={`bc${o}`} at={[x + o * out, top + 0.003, 0]} size={[0.014, 0.006, 0.5]} color={STEEL} p={p} round={0.002} />
      ))}
      {/* drive motor under the belt at the wall end, and a bracket back to the machine */}
      <Part at={[x - out * (len / 2 - 0.1), top - 0.1, 0.1]} size={[0.16, 0.1, 0.2]} color={DARK} p={p} round={0.012} />
      <Cyl at={[x - out * (len / 2 - 0.1), top - 0.1, 0.24]} r={0.045} len={0.07} color={STEEL} p={p} axis="z" seg={16} />
      <Part at={[x - out * (len / 2 + 0.03), top - 0.18, 0]} size={[0.05, 0.2, 0.5]} color={DARK} p={p} round={0.006} />
      {/* two legs at the outer end: the belt is a table in its own right, level with the cart deck beside it */}
      {[-1, 1].map((sz) => (
        <Part key={`bl${sz}`} at={[x + out * (len / 2 - 0.06), (top - 0.05) / 2, sz * 0.27]} size={[0.05, top - 0.05, 0.05]} color={DARK} p={p} round={0.006} />
      ))}
    </>
  );
}

/** Hanging strip curtain in a doorway. */
function Curtain({ x, p }: { x: number; p: DetailProps }) {
  return (
    <>
      {[-0.35, -0.25, -0.15, -0.05, 0.05, 0.15, 0.25, 0.35].map((z) => (
        <Part key={z} at={[x, 0.93, z]} size={[0.02, 0.5, 0.085]} color="#4a5a5e" p={p} round={0.004} />
      ))}
    </>
  );
}

/** A pneumatic toggle clamp: base block, upright, and an arm with a rubber pad that swings down onto the carrier while the machine works. `side` is -1 or +1 (which side of the belt it stands on). */
function Clamp({ at, side, p, closed }: { at: Vec; side: 1 | -1; p: DetailProps; closed: React.RefObject<number> }) {
  const arm = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!arm.current) return;
    const k = closed.current ?? 0;
    // open: arm raised 65 degrees away from the carrier; closed: horizontal over the carrier's edge
    arm.current.rotation.x = side * (1 - k) * 1.15;
  });
  return (
    <group position={at}>
      <Part at={[0, 0.03, 0]} size={[0.14, 0.06, 0.12]} color={DARK} p={p} round={0.008} />
      <Part at={[0, 0.11, side * -0.02]} size={[0.1, 0.1, 0.05]} color={STEEL} p={p} round={0.006} />
      <Cyl at={[0.07, 0.1, side * -0.02]} r={0.022} len={0.02} color={DARK} p={p} axis="x" seg={14} />
      <Cyl at={[-0.07, 0.1, side * -0.02]} r={0.022} len={0.02} color={DARK} p={p} axis="x" seg={14} />
      <group ref={arm} position={[0, 0.1, side * -0.02]}>
        <Part at={[0, 0.0, side * -0.1]} size={[0.06, 0.035, 0.22]} color={STEEL} p={p} round={0.006} />
        <Part at={[0, -0.026, side * -0.19]} size={[0.06, 0.02, 0.05]} color="#2a2a2c" p={p} round={0.006} rough={0.8} metal={0} />
      </group>
    </group>
  );
}

/** Painted floor zone around the machine, as on a real shop floor. */
function ZoneMarking({ w, d, p }: { w: number; d: number; p: DetailProps }) {
  const t = 0.07;
  const y = 0.012;
  const mat = <meshBasicMaterial color={LINE} transparent opacity={p.opacity * 0.9} />;
  return (
    <group userData={{ noCast: true }}>
      {[d / 2 + 0.25, -d / 2 - 0.25].map((z, i) => (
        <mesh key={`h${i}`} position={[0, y, z]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[w + 0.5, t]} />
          {mat}
        </mesh>
      ))}
      {[w / 2 + 0.25, -w / 2 - 0.25].map((x, i) => (
        <mesh key={`v${i}`} position={[x, y, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[t, d + 0.5]} />
          {mat}
        </mesh>
      ))}
    </group>
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/*
 * ── laser cutter: a closed cutting cell with a doorway on the pallet side, a two-level pallet shelf with a loading ramp in front,
 * and an operator stand. The tray rolls up the ramp onto the sheet, the sheet slides through the doorway into the cell, is cut
 * and comes back (the timeline is in machinePaths.ts, shared with the simulation so the tray rides on the sheet).
 */
function Laser(p: DetailProps) {
  const { w, d, h } = p;
  const g = laserGeo(w, d);
  const { cellW, cellD, x0, z0, cellCx, cellCz, chW, chCx, shelfZ, shelfFront } = g;
  const sheetRef = useRef<THREE.Group>(null);
  const spotRef = useRef<THREE.Mesh>(null);
  const headRef = useRef<THREE.Group>(null);
  const tray = LASER_RAMP;
  const rampTop = LASER_SHELF_Y - 0.104; // belt surface level where it meets the sheet (the sheet top)
  const rampBase = BELT_TOP; // and where it meets the transfer cart's deck: the line's belt height
  const rise = rampTop - rampBase;
  const slope = Math.atan2(rise, tray);
  const rampLen = Math.hypot(tray, rise);
  const beamRef = useRef<THREE.Mesh>(null);
  const cleats = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    const a = p.act();
    const pn = a.busy || a.progress > 0 ? a.progress : 0;
    const { slide, load } = laserFractions(pn);
    // the infeed belt turns while the carrier is loaded and unloaded: the cleats travel towards the shelf and back
    const run = load * 3.07;
    cleats.current.forEach((m, i) => {
      if (m) m.position.z = rampLen / 2 - 0.05 - ((((i * 0.28 + run) % (rampLen - 0.1)) + (rampLen - 0.1)) % (rampLen - 0.1));
    });
    if (sheetRef.current) sheetRef.current.position.x = -g.slide * slide;
    const cutting = a.busy && pn > 0.34 && pn < 0.66;
    const hx = cutting ? cellCx - 0.4 + Math.sin(clock.elapsedTime * 3.1) * 0.9 : cellCx;
    if (headRef.current) headRef.current.position.x = hx;
    if (beamRef.current) beamRef.current.visible = cutting;
    if (spotRef.current) {
      spotRef.current.visible = cutting;
      if (cutting) spotRef.current.position.x = hx;
    }
  });
  // the cell: hollow, with a doorway at sheet height on the side towards the shelf
  const t = 0.05;
  const ox = cellW - 0.1;
  const oz = cellD - 0.1;
  const y1 = h - 0.18;
  return (
    <>
      <ZoneMarking w={w} d={d} p={p} />
      <Part at={[cellCx, 0.16, cellCz]} size={[cellW, 0.32, cellD]} color={DARK} p={p} />
      {[-1, 1].map((sz) => (
        <Body key={sz} at={[cellCx, (0.32 + y1) / 2, cellCz + sz * (oz / 2 - t / 2)]} size={[ox, y1 - 0.32, t]} p={p} round={0.01} />
      ))}
      <EndWall x={cellCx - ox / 2 + t / 2} y0={0.32} y1={y1} zl={oz - 2 * t} t={t} open={false} cz={cellCz} p={p} />
      <EndWall x={cellCx + ox / 2 - t / 2} y0={0.32} y1={y1} zl={oz - 2 * t} t={t} open cz={cellCz} ap={{ w: 1.75, y0: 0.95, y1: 1.4, z: shelfZ - cellCz }} p={p} />
      <Body at={[cellCx, y1 - t / 2, cellCz]} size={[ox, t, oz - 2 * t]} p={p} round={0.01} />
      <Part at={[cellCx, 0.34, cellCz]} size={[ox - 2 * t, 0.04, oz - 2 * t]} color={DARK} p={p} round={0.005} />
      <Part at={[cellCx, 1.0, shelfZ]} size={[ox - 0.6, 0.06, 1.7]} color={STEEL} p={p} round={0.005} />
      <Part at={[cellCx - 0.4, h - 0.12, cellCz]} size={[cellW - 1.4, 0.24, cellD - 0.4]} color={STEEL} p={p} />
      {/* gantry with the cutting head over the sheet; the head follows the cut */}
      <group ref={headRef} position={[cellCx, 0, shelfZ]}>
        <Part at={[0, 1.95, 0]} size={[0.16, 0.16, oz - 0.3]} color={DARK} p={p} />
        <Part at={[0, 1.78, 0]} size={[0.24, 0.3, 0.24]} color={STEEL} p={p} metal={0.4} />
        <Cyl at={[0, 1.58, 0]} r={0.03} len={0.14} color={DARK} p={p} />
        <mesh ref={beamRef} position={[0, 1.31, 0]} visible={false}>
          <cylinderGeometry args={[0.006, 0.006, 0.56, 6]} />
          <meshBasicMaterial color="#9fe3ff" />
        </mesh>
      </group>
      <Part at={[cellCx - 0.6, 1.3, cellCz + cellD / 2 + 0.005]} size={[2.2, 0.7, 0.02]} color={GLASS} p={p} metal={0.4} rough={0.2} />
      <mesh ref={spotRef} position={[cellCx - 0.6, 1.3, cellCz + cellD / 2 + 0.02]} visible={false}>
        <planeGeometry args={[0.35, 0.03]} />
        <meshBasicMaterial color="#ffb766" />
      </mesh>
      <Part at={[cellCx + 0.6, 0.85, cellCz + cellD / 2 + 0.005]} size={[0.03, 1.05, 0.02]} color={DARK} p={p} />
      <Part at={[cellCx + cellW / 2 - 0.55, 0.85, cellCz + cellD / 2 + 0.01]} size={[0.5, 0.06, 0.03]} color={DARK} p={p} />
      <Cyl at={[cellCx - cellW / 2 + 0.35, h + 0.12, cellCz + cellD / 2 - 0.35]} r={0.035} len={0.5} color={DARK} p={p} />
      <Lamp at={[cellCx - cellW / 2 + 0.35, h + 0.4, cellCz + cellD / 2 - 0.35]} p={p} />
      <Part at={[cellCx + 1.4, h - 0.12 + 0.28, cellCz - 0.6]} size={[1.2, 0.5, 0.9]} color={DARK} p={p} />

      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <Part key={i} at={[chCx + (sx * (chW - 0.5)) / 2, 0.7, z0 + 1.7 + (sz * 2.9) / 2]} size={[0.14, 1.4, 0.14]} color={DARK} p={p} />
      ))}
      <Part at={[chCx, 0.48, z0 + 1.7]} size={[chW - 0.4, 0.07, 3.0]} color={STEEL} p={p} />
      <Part at={[chCx, 1.0, z0 + 1.7]} size={[chW - 0.4, 0.07, 3.0]} color={STEEL} p={p} />
      {Array.from({ length: 9 }, (_, i) => (
        <Part key={`sl${i}`} at={[chCx, 1.05, z0 + 0.45 + i * 0.32]} size={[chW - 0.5, 0.04, 0.05]} color={DARK} p={p} round={0.005} />
      ))}
      <group ref={sheetRef}>
        <Part at={[chCx, 1.075, shelfZ]} size={[chW - 1.0, 0.012, 1.55]} color="#cfd6d8" p={p} metal={0.5} rough={0.35} round={0.004} />
      </group>
      {/* infeed belt in front of the shelf: the carrier from the cart rides it up onto the sheet and back down */}
      <group position={[chCx + LASER_PORT_DX, (rampTop + rampBase) / 2 - 0.017 / Math.cos(slope), shelfFront + tray / 2]} rotation={[slope, 0, 0]}>
        <Part at={[0, 0, 0]} size={[0.56, 0.034, rampLen]} color={DARK} p={p} round={0.006} rough={0.85} metal={0.1} />
        {Array.from({ length: 5 }, (_, i) => (
          <mesh key={`cl${i}`} ref={(m) => void (cleats.current[i] = m)} position={[0, 0.022, 0]}>
            <boxGeometry args={[0.5, 0.012, 0.03]} />
            <meshStandardMaterial color="#9aa5a9" roughness={0.6} metalness={0.4} transparent opacity={p.opacity} />
          </mesh>
        ))}
        {[-1, 1].map((q) => (
          <group key={`rl${q}`}>
            <Part at={[q * 0.31, 0.03, 0]} size={[0.04, 0.09, rampLen + 0.04]} color={STEEL} p={p} round={0.006} />
            <Cyl at={[0, 0, q * (rampLen / 2)]} r={0.05} len={0.6} color={STEEL} p={p} axis="x" seg={20} />
          </group>
        ))}
        <Part at={[0.4, -0.05, rampLen / 2 - 0.12]} size={[0.16, 0.14, 0.22]} color={DARK} p={p} round={0.015} />
        <Cyl at={[0.5, -0.05, rampLen / 2 - 0.12]} r={0.05} len={0.06} color={STEEL} p={p} axis="x" seg={16} />
        <Part at={[-0.37, 0.12, -rampLen / 2 + 0.08]} size={[0.05, 0.14, 0.05]} color={DARK} p={p} round={0.006} />
        <Part at={[0.37, 0.12, -rampLen / 2 + 0.08]} size={[0.05, 0.14, 0.05]} color={DARK} p={p} round={0.006} />
      </group>
      {/* the belt hangs from the shelf on two legs at its upper end */}
      {[-1, 1].map((q) => (
        <Part key={`bl${q}`} at={[chCx + LASER_PORT_DX + q * 0.31, 0.5, shelfFront + 0.1]} size={[0.06, 1.0, 0.06]} color={DARK} p={p} round={0.006} />
      ))}
      {/* and on two legs at the lower end, where the cart's deck meets the belt */}
      {[-1, 1].map((q) => (
        <Part key={`bf${q}`} at={[chCx + LASER_PORT_DX + q * 0.31, (BELT_TOP - 0.06) / 2, shelfFront + tray - 0.14]} size={[0.06, BELT_TOP - 0.06, 0.06]} color={DARK} p={p} round={0.006} />
      ))}

      <Part at={[x0 + 1.5, 0.55, z0 + cellD + 0.55]} size={[0.45, 1.1, 0.45]} color={DARK} p={p} />
      <Part at={[x0 + 1.5, 1.28, z0 + cellD + 0.5]} size={[0.7, 0.45, 0.06]} color={GLASS} p={p} metal={0.3} rough={0.25} />
    </>
  );
}

/*
 * ── press brake: two side frames, crown, ram + punch, table + die, back gauge, pendant. The tray comes in on the infeed table
 * and stops on the die under the punch; the ram comes down onto the part for each bend (see pressFraction in machinePaths.ts).
 * Dimensions from the TRUMPF TruBend 5130 datasheet: 2690 mm between the columns, 3230 mm bending length.
 */
function PressBrake(p: DetailProps) {
  const { w, d, h } = p;
  const GAP = 2.69;
  const BEND = 3.23;
  const sideX = GAP / 2 + 0.22;
  const fz = -0.335; // columns are a shallow C: the table and ram sit on their front faces
  const { tableZ } = pressGeo(d);
  const ramRef = useRef<THREE.Group>(null);
  const cleatsP = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    const a = p.act();
    const run = pressFraction(a.busy || a.progress > 0 ? a.progress : 0) * 1.0;
    cleatsP.current.forEach((m, i) => {
      if (m) m.position.z = tableZ + 0.65 + 0.5 - ((((i * 0.22 + run) % 1.0) + 1.0) % 1.0);
    });
    let stroke = 0;
    if (a.busy && a.progress > 0.2 && a.progress < 0.8) {
      const pn = (a.progress - 0.2) / 0.6;
      stroke = 0.5 * (1 - Math.cos(4 * Math.PI * pn)); // two bends per part
    }
    if (ramRef.current) ramRef.current.position.y = -0.372 * stroke;
  });
  return (
    <>
      <ZoneMarking w={w} d={d} p={p} />
      <Part at={[0, 0.12, 0]} size={[w - 0.2, 0.24, d - 0.3]} color={DARK} p={p} />
      {[-1, 1].map((s) => (
        <Body key={s} at={[s * sideX, h / 2, fz]} size={[0.44, h, 0.92]} p={p} />
      ))}
      <Body at={[0, h - 0.32, fz + 0.1]} size={[GAP + 0.88, 0.64, 1.12]} p={p} />
      <group ref={ramRef}>
        {[-1, 1].map((s) => (
          <Cyl key={s} at={[s * 1.2, h - 0.95, tableZ - 0.05]} r={0.1} len={0.7} color={STEEL} p={p} />
        ))}
        <Part at={[0, 1.9, tableZ - 0.05]} size={[BEND, 0.4, 0.34]} color={STEEL} p={p} metal={0.4} />
        {/* punch: its tip is at the top of the part at the bottom of the stroke */}
        <Part at={[0, 1.43, tableZ - 0.05]} size={[BEND - 0.2, 0.54, 0.07]} color={DARK} p={p} metal={0.5} rough={0.3} round={0.01} />
      </group>
      {/* bed at working height with the die on it; the tray rests on the die line */}
      <Part at={[0, 0.49, tableZ - 0.02]} size={[BEND, 0.32, 0.5]} color={STEEL} p={p} metal={0.4} />
      <Part at={[0, BELT_TOP - 0.015, tableZ - 0.02]} size={[BEND - 0.2, 0.03, 0.16]} color={DARK} p={p} metal={0.5} rough={0.3} round={0.005} />
      {/* infeed belt from the front of the machine to the bed; its cleats run while the tray is fed in and out */}
      <Part at={[0, BELT_TOP - 0.017, tableZ + 0.65]} size={[0.56, 0.034, 1.05]} color={DARK} p={p} round={0.006} rough={0.85} metal={0.1} />
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={`pc${i}`} ref={(m) => void (cleatsP.current[i] = m)} position={[0, BELT_TOP + 0.005, 0]}>
          <boxGeometry args={[0.5, 0.012, 0.03]} />
          <meshStandardMaterial color="#9aa5a9" roughness={0.6} metalness={0.4} transparent opacity={p.opacity} />
        </mesh>
      ))}
      {[-1, 1].map((sx) => (
        <Part key={`pr${sx}`} at={[sx * 0.31, BELT_TOP + 0.02, tableZ + 0.65]} size={[0.04, 0.09, 1.09]} color={STEEL} p={p} round={0.006} />
      ))}
      <Cyl at={[0, BELT_TOP - 0.045, tableZ + 1.17]} r={0.05} len={0.6} color={STEEL} p={p} axis="x" seg={20} />
      <Part at={[0.4, BELT_TOP - 0.11, tableZ + 1.05]} size={[0.16, 0.14, 0.22]} color={DARK} p={p} round={0.015} />
      {[-1, 1].map((sx) => (
        <Part key={`pl${sx}`} at={[sx * 0.27, (BELT_TOP - 0.06) / 2, tableZ + 1.12]} size={[0.05, BELT_TOP - 0.06, 0.05]} color={DARK} p={p} round={0.006} />
      ))}
      <Part at={[0, 0.8, -0.2]} size={[GAP - 0.2, 0.07, 0.07]} color={DARK} p={p} />
      {[-0.9, 0.9].map((x) => (
        <Part key={x} at={[x, 0.76, -0.04]} size={[0.07, 0.07, 0.32]} color={DARK} p={p} />
      ))}
      <Cyl at={[w / 2 - 0.35, 0.7, d / 2 - 0.12]} r={0.035} len={1.4} color={DARK} p={p} />
      <Part at={[w / 2 - 0.35, 1.5, d / 2 - 0.12]} size={[0.5, 0.65, 0.1]} color={GLASS} p={p} metal={0.3} rough={0.25} />
      <Lamp at={[w / 2 - 0.35, 1.95, d / 2 - 0.12]} p={p} size={0.09} />
      <Part at={[0.4, 0.05, d / 2 + 0.05]} size={[0.5, 0.1, 0.3]} color={DARK} p={p} />
    </>
  );
}

/* ── deburring: wide-belt machine with infeed and outfeed tables ── */
function Deburring(p: DetailProps) {
  const { w, d, h } = p;
  const bw = w - 0.9; // the cabin; the rest of the footprint is the infeed and outfeed table
  return (
    <>
      <ZoneMarking w={w} d={d} p={p} />
      <Part at={[0, 0.15, 0]} size={[w - 0.5, 0.3, d - 0.3]} color={DARK} p={p} />
      <Tunnel cx={0} w={bw} d={d - 0.7} y0={0.3} y1={h - 0.3} p={p} />
      <Part at={[0, h - 0.15, 0]} size={[w - 1.1, 0.18, d - 0.9]} color={STEEL} p={p} />
      {[-1, 1].map((s) => (
        <group key={s}>
          {/* the entry side is long enough for the transfer cart to stand beside it; the exit side hands over to the conveyor that starts 0.45 m out */}
          <BeltStub x={s * (bw / 2 + (s < 0 ? 0.3 : 0.225))} len={s < 0 ? 0.6 : 0.45} p={p} />
          <Curtain x={s * (bw / 2 - 0.02)} p={p} />
        </group>
      ))}
      <Part at={[0, 1.2, d / 2 - 0.34]} size={[1.0, 0.5, 0.02]} color={GLASS} p={p} metal={0.4} rough={0.2} />
      <Part at={[w / 2 - 0.9, 1.35, d / 2 - 0.3]} size={[0.3, 0.4, 0.1]} color={GLASS} p={p} metal={0.3} rough={0.25} />
      <Cyl at={[-0.3, h + 0.1, -0.2]} r={0.14} len={0.4} color={STEEL} p={p} />
      <Lamp at={[w / 2 - 0.9, h + 0.05, d / 2 - 0.4]} p={p} size={0.09} />
    </>
  );
}

/* ── tunnel washer + dryer: entry hood, wash module, dry module, stack, cabinet ── */
function Washer(p: DetailProps) {
  const { w, d, h } = p;
  const x0 = -w / 2;
  const segs = [
    { name: "entry", w: 0.85, h: h - 0.45 },
    { name: "wash", w: 2.1, h },
    { name: "dry", w: w - 0.85 - 2.1, h: h - 0.2 },
  ];
  let cx = x0;
  const placed = segs.map((s) => {
    const c = cx + s.w / 2;
    cx += s.w;
    return { ...s, c };
  });
  const [entry, wash, dry] = placed;
  return (
    <>
      <ZoneMarking w={w} d={d} p={p} />
      <Part at={[0, 0.14, 0]} size={[w, 0.28, d]} color={DARK} p={p} />
      {/* one tunnel through the three modules; the belt runs the whole way and the ends carry strip curtains */}
      {placed.map((s) => (
        <Tunnel key={s.name} cx={s.c} w={s.w - 0.03} d={d - 0.04} y0={0.28} y1={s.h} p={p} />
      ))}
      <Part at={[wash.c, h + 0.01, 0]} size={[wash.w - 0.2, 0.04, d - 0.2]} color={STEEL} p={p} />
      <Curtain x={x0 + 0.04} p={p} />
      <Curtain x={w / 2 - 0.04} p={p} />
      {[-0.55, 0.55].map((dx) => (
        <group key={dx}>
          <Part at={[wash.c + dx, 0.95, d / 2 + 0.005]} size={[0.7, 0.45, 0.02]} color={GLASS} p={p} metal={0.4} rough={0.2} />
          <Part at={[wash.c + dx + 0.25, 0.7, d / 2 + 0.015]} size={[0.14, 0.03, 0.03]} color={DARK} p={p} />
        </group>
      ))}
      <Cyl at={[wash.c - 0.5, h + 0.28, -0.2]} r={0.13} len={0.56} color={STEEL} p={p} />
      <Part at={[dry.c, dry.h + 0.18, -0.15]} size={[0.8, 0.32, 0.5]} color={DARK} p={p} />
      <Cyl at={[dry.c + 0.55, dry.h + 0.25, -0.15]} r={0.09} len={0.46} color={STEEL} p={p} />
      <Part at={[dry.c + 0.2, 0.28 + 0.65, d / 2 + 0.18]} size={[0.5, 1.3, 0.34]} color={DARK} p={p} />
      <Part at={[dry.c + 0.2, 1.1, d / 2 + 0.36]} size={[0.3, 0.22, 0.02]} color={GLASS} p={p} metal={0.3} rough={0.25} />
      <Lamp at={[dry.c + 0.2, 1.5, d / 2 + 0.2]} p={p} size={0.07} />
      <Part at={[entry.c, 0.2, d / 2 + 0.02]} size={[entry.w - 0.1, 0.18, 0.02]} color="#4a5a5e" p={p} />
    </>
  );
}

/*
 * Optical measuring cell (ZEISS ScanBox 5110 as the reference): a closed cabin with a window on the front, a turntable of
 * the published maximum part size (diameter 1000 mm) and a sensor on a stand. The turntable and sensor are our example shape;
 * the datasheet gives the part envelope, not the layout. The part is only inside while the cell works on it.
 */
function Inspection(p: DetailProps) {
  const { w, d, h } = p;
  const table = useRef<THREE.Group>(null);
  const part = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const tx = -0.35;
  const tz = 0; // on the belt line
  useFrame(({ clock }) => {
    const a = p.act();
    const on = a.busy;
    if (part.current) part.current.visible = on;
    if (table.current) table.current.rotation.y = on ? a.progress * Math.PI * 4 : 0;
    if (head.current) {
      head.current.position.y = on ? 1.3 + 0.28 * Math.sin(clock.elapsedTime * 1.1) : 1.3;
      head.current.rotation.x = on ? 0.12 * Math.sin(clock.elapsedTime * 1.1) : 0;
    }
  });
  const fz = d / 2 - 0.14;
  return (
    <>
      <ZoneMarking w={w} d={d} p={p} />
      <Part at={[0, 0.12, 0]} size={[w - 0.2, 0.24, d - 0.2]} color={DARK} p={p} />
      {/* cabin: back, sides, roof and the solid parts of the front; the window below lets the inside show */}
      <Body at={[0, 0.24 + (h - 0.24) / 2, -d / 2 + 0.2]} size={[w - 0.3, h - 0.24, 0.08]} p={p} />
      {[-1, 1].map((s) => (
        <EndWall key={s} x={s * (w / 2 - 0.19)} y0={0.24} y1={h} zl={d - 0.3} t={0.08} open p={p} />
      ))}
      <Body at={[0, h - 0.08, 0]} size={[w - 0.3, 0.16, d - 0.3]} p={p} />
      {/* belt in through the west doorway to the turntable and out through the east one */}
      {/* from where the west belt table ends to the turntable's edge; the two must only touch, or their coplanar tops flicker */}
      <Part at={[(tx - 0.5 - (w / 2 - 0.14)) / 2, BELT_TOP - 0.03, 0]} size={[tx - 0.5 + (w / 2 - 0.14), 0.06, 0.58]} color={STEEL} p={p} round={0.005} />
      <Part at={[0.55, BELT_TOP - 0.03, 0]} size={[0.8, 0.06, 0.58]} color={STEEL} p={p} round={0.005} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <BeltStub x={s * (w / 2 - 0.19 + 0.35)} len={0.6} p={p} />
          <Curtain x={s * (w / 2 - 0.19 - 0.02)} p={p} />
        </group>
      ))}
      <Body at={[0, 0.57, fz]} size={[w - 0.3, 0.66, 0.08]} p={p} />
      <Body at={[0.575, 1.7, fz]} size={[0.75, 1.6, 0.08]} p={p} />
      <Body at={[0, (2.5 + h - 0.16) / 2, fz]} size={[w - 0.3, h - 0.16 - 2.5, 0.08]} p={p} />
      <Part at={[0, h - 0.05, 0]} size={[w - 0.5, 0.1, d - 0.5]} color={STEEL} p={p} />
      <Glass at={[-0.35, 1.7, fz]} size={[1.1, 1.6, 0.02]} p={p} />
      <Part at={[0.2, 1.7, fz]} size={[0.04, 1.6, 0.06]} color={DARK} p={p} />
      {/* turntable of the published maximum part size, diameter 1000 mm, on its pedestal */}
      <Cyl at={[tx, 0.42, tz]} r={0.42} len={0.38} color={DARK} p={p} seg={32} />
      <group ref={table} position={[tx, BELT_TOP - 0.03, tz]}>
        <Cyl at={[0, 0, 0]} r={0.5} len={0.06} color={STEEL} p={p} seg={40} />
        <Part at={[0.12, 0.03, 0.05]} size={[0.12, 0.012, 0.012]} color={DARK} p={p} round={0.002} />
        <group ref={part}>
          <Part at={[0, 0.14, 0]} size={[0.34, 0.22, 0.26]} color="#cfd6d8" p={p} metal={0.5} rough={0.35} round={0.01} />
          <Part at={[0.06, 0.29, 0]} size={[0.14, 0.08, 0.14]} color="#cfd6d8" p={p} metal={0.5} rough={0.35} round={0.01} />
        </group>
      </group>
      {/* sensor on a stand behind the table */}
      <Part at={[tx, 1.2, -d / 2 + 0.45]} size={[0.14, 1.9, 0.14]} color={DARK} p={p} />
      <group ref={head} position={[tx, 1.3, tz - 0.6]}>
        <Part at={[0, 0, -0.35]} size={[0.1, 0.1, 0.7]} color={STEEL} p={p} />
        <Part at={[0, 0, 0]} size={[0.34, 0.14, 0.16]} color={DARK} p={p} metal={0.4} />
        {[-1, 1].map((q) => (
          <Cyl key={q} at={[q * 0.1, 0, 0.1]} r={0.035} len={0.1} color={GLASS} p={p} axis="z" />
        ))}
      </group>
      <Part at={[w / 2 - 0.45, 1.3, fz - 0.0]} size={[0.5, 0.9, 0.06]} color={DARK} p={p} />
      <Part at={[w / 2 - 0.45, 1.5, fz + 0.04]} size={[0.36, 0.3, 0.02]} color={GLASS} p={p} metal={0.3} rough={0.25} />
      <Lamp at={[w / 2 - 0.4, h + 0.08, d / 2 - 0.4]} p={p} size={0.1} />
    </>
  );
}

/*
 * Laser marking station (TRUMPF TruMark Station 5000 as the reference): the enclosure is open to view. The work area outline is the
 * published maximum part size (680 x 500 x 700 mm); the stage moves in X/Y inside it while the head scans (the datasheet gives the
 * axis travels, not how they are built, so the layout is our example shape). The part is only inside while the station works on it.
 */
function Marker(p: DetailProps) {
  const { w, d, h } = p;
  const stage = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const part = useRef<THREE.Group>(null);
  const spot = useRef<THREE.Mesh>(null);
  const yB = BELT_TOP - 0.13; // the stage deck is at belt height so the carrier rolls straight onto it
  const cz = 0;
  const env = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.68, 0.7, 0.5)), []);
  useFrame(({ clock }) => {
    const a = p.act();
    const on = a.busy;
    const t = clock.elapsedTime;
    if (part.current) part.current.visible = on;
    if (stage.current) stage.current.position.z = on ? Math.cos(t * 1.3) * 0.06 : 0;
    const hx = on ? Math.sin(t * 5.1) * 0.1 : 0;
    if (head.current) head.current.position.x = hx;
    if (spot.current) {
      spot.current.visible = on && a.progress > 0.1 && a.progress < 0.9;
      spot.current.position.x = hx;
    }
  });
  const fz = d / 2 - 0.04;
  return (
    <>
      <Part at={[0, 0.1, 0]} size={[w, 0.2, d]} color={DARK} p={p} />
      <Body at={[0, 0.39, 0]} size={[w - 0.06, 0.38, d - 0.06]} p={p} />
      {/* the enclosure above the base: back, sides with doorways, roof and a window in front */}
      <Body at={[0, 0.58 + (h - 0.58) / 2, -d / 2 + 0.04]} size={[w - 0.06, h - 0.58, 0.04]} p={p} />
      {[-1, 1].map((sx) => (
        <EndWall key={sx} x={sx * (w / 2 - 0.05)} y0={0.58} y1={h} zl={d - 0.06} t={0.04} open p={p} />
      ))}
      <Body at={[0, h - 0.03, 0]} size={[w - 0.06, 0.06, d - 0.06]} p={p} />
      <Body at={[0, h - 0.17, fz]} size={[w - 0.06, 0.22, 0.04]} p={p} />
      <Glass at={[0, 0.58 + (h - 0.58 - 0.28) / 2, fz]} size={[w - 0.16, h - 0.58 - 0.28, 0.012]} p={p} />
      {[-1, 1].map((sx) => (
        <Part key={sx} at={[sx * (w / 2 - 0.08), 0.58 + (h - 0.58 - 0.28) / 2, fz]} size={[0.04, h - 0.58 - 0.28, 0.05]} color={DARK} p={p} />
      ))}
      <Part at={[0, 0.3, d / 2 - 0.02]} size={[0.3, 0.18, 0.03]} color={GLASS} p={p} metal={0.4} rough={0.2} />
      {/* belt through both doorways, with a short table outside each */}
      {[-1, 1].map((sx) => (
        <Part key={`mb${sx}`} at={[sx * (0.25 + (w / 2 - 0.25) / 2), BELT_TOP - 0.03, 0]} size={[w / 2 - 0.25, 0.06, 0.58]} color={STEEL} p={p} round={0.005} />
      ))}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <BeltStub x={sx * (w / 2 + 0.3)} len={0.6} p={p} />
          <Curtain x={sx * (w / 2 - 0.05 - 0.02)} p={p} />
        </group>
      ))}
      {/* work area outline: the published maximum part, 680 x 500 x 700 mm */}
      <lineSegments geometry={env} position={[0, yB + 0.37, cz]}>
        <lineBasicMaterial color="#6fd3c2" transparent opacity={0.4 * p.opacity} />
      </lineSegments>
      <group ref={stage} position={[0, yB, cz]}>
        <Part at={[0, 0.05, 0]} size={[0.5, 0.1, 0.4]} color={DARK} p={p} />
        <Part at={[0, 0.115, 0]} size={[0.4, 0.03, 0.3]} color={STEEL} p={p} metal={0.5} rough={0.3} round={0.005} />
        <group ref={part}>
          <Part at={[0, 0.145, 0]} size={[0.22, 0.03, 0.15]} color="#cfd6d8" p={p} metal={0.5} rough={0.35} round={0.004} />
        </group>
      </group>
      {/* scan head under a bridge from the back wall */}
      <Part at={[0, h - 0.3, -0.3]} size={[0.14, 0.12, 0.7]} color={STEEL} p={p} />
      <group ref={head} position={[0, h - 0.5, cz]}>
        <Part at={[0, 0.1, 0]} size={[0.16, 0.22, 0.16]} color={DARK} p={p} metal={0.4} />
        <Cyl at={[0, -0.06, 0]} r={0.035} len={0.12} color={GLASS} p={p} />
      </group>
      <mesh ref={spot} position={[0, yB + 0.17, cz]} visible={false}>
        <sphereGeometry args={[0.012, 10, 10]} />
        <meshBasicMaterial color="#ff5a3c" />
      </mesh>
      <Lamp at={[w / 2 - 0.15, h + 0.06, d / 2 - 0.2]} p={p} size={0.08} />
    </>
  );
}

function Chiller(p: DetailProps) {
  const { w, d, h } = p;
  return (
    <>
      <Part at={[0, 0.05, 0]} size={[w, 0.1, d]} color={DARK} p={p} />
      <Body at={[0, 0.1 + (h - 0.1) / 2, 0]} size={[w - 0.02, h - 0.1, d - 0.02]} p={p} />
      <Cyl at={[0, h + 0.01, 0]} r={Math.min(w, d) / 2 - 0.06} len={0.03} color={DARK} p={p} seg={28} />
      <Part at={[0, h - 0.25, d / 2 + 0.005]} size={[w - 0.1, 0.22, 0.01]} color={GLASS} p={p} />
      {[0.3, 0.45, 0.6].map((y) => (
        <Part key={y} at={[0, y, d / 2 + 0.005]} size={[w - 0.12, 0.02, 0.01]} color={DARK} p={p} round={0.004} />
      ))}
      <Lamp at={[w / 2 - 0.05, h - 0.1, d / 2 + 0.01]} p={p} size={0.04} />
    </>
  );
}

function Compressor(p: DetailProps) {
  const { w, d, h } = p;
  const deck = h - 0.12; // body stops below the top so the fan cowl and the terminal box can reach h
  return (
    <>
      <Part at={[0, 0.1, 0]} size={[w, 0.2, d]} color={DARK} p={p} />
      <Body at={[0, 0.2 + (deck - 0.2) / 2, 0]} size={[w - 0.05, deck - 0.2, d - 0.05]} p={p} />
      {Array.from({ length: 7 }, (_, i) => (
        <Part key={i} at={[-w / 2 + 0.5 + i * 0.17, 0.75, d / 2 + 0.005]} size={[0.1, 0.9, 0.01]} color={DARK} p={p} round={0.004} />
      ))}
      <Part at={[w / 2 - 0.4, 1.35, d / 2 + 0.01]} size={[0.4, 0.28, 0.02]} color={GLASS} p={p} metal={0.3} rough={0.25} />
      {/* power feed drops onto this terminal box (profile drop offset -0.3 m); fan cowl beside it */}
      <Part at={[-0.3, h - 0.06, 0]} size={[0.32, 0.12, 0.32]} color={DARK} p={p} />
      <Cyl at={[0.4, h - 0.06, 0]} r={0.4} len={0.12} color={DARK} p={p} seg={28} />
      <Cyl at={[0.4, h - 0.01, 0]} r={0.3} len={0.02} color={STEEL} p={p} seg={28} />
      <Lamp at={[w / 2 - 0.4, 1.65, d / 2 + 0.02]} p={p} size={0.06} />
    </>
  );
}

function AirDryer(p: DetailProps) {
  const { w, d, h } = p;
  return (
    <>
      <Part at={[0, 0.08, 0]} size={[w, 0.16, d]} color={DARK} p={p} />
      <Body at={[0, 0.16 + (h - 0.16) / 2, 0]} size={[w - 0.04, h - 0.16, d - 0.04]} p={p} />
      <Part at={[0, 1.25, d / 2 + 0.005]} size={[0.5, 0.25, 0.02]} color={GLASS} p={p} metal={0.3} rough={0.25} />
      <Cyl at={[w / 2 - 0.25, 0.55, d / 2 + 0.03]} r={0.05} len={0.04} color={STEEL} p={p} axis="z" />
    </>
  );
}

/** Vertical compressed-air receiver: shell, domed top, feet, gauge. */
function AirReceiver(p: DetailProps) {
  const { w, d, h } = p;
  const r = Math.min(w, d) / 2 - 0.08;
  const bodyH = h - r * 0.7;
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Part key={i} at={[Math.cos((i * 2 * Math.PI) / 3 + 0.5) * (r - 0.1), 0.15, Math.sin((i * 2 * Math.PI) / 3 + 0.5) * (r - 0.1)]} size={[0.12, 0.3, 0.12]} color={DARK} p={p} />
      ))}
      <mesh position={[0, 0.3 + bodyH / 2, 0]}>
        <cylinderGeometry args={[r, r, bodyH, 32]} />
        <meshStandardMaterial color={p.body} roughness={0.55} metalness={0.2} transparent opacity={p.opacity} emissive={p.emissive} emissiveIntensity={p.ei} />
      </mesh>
      <mesh position={[0, 0.3 + bodyH, 0]} scale={[1, 0.45, 1]}>
        <sphereGeometry args={[r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={p.body} roughness={0.55} metalness={0.2} transparent opacity={p.opacity} emissive={p.emissive} emissiveIntensity={p.ei} />
      </mesh>
      <Cyl at={[r * 0.6, 1.3, r * 0.75]} r={0.07} len={0.04} color={GLASS} p={p} axis="z" />
      <Cyl at={[0, 0.5, r + 0.08]} r={0.04} len={0.2} color={STEEL} p={p} axis="z" />
    </>
  );
}

function PowerPanel(p: DetailProps) {
  const { w, d, h } = p;
  const n = Math.max(3, Math.round(w / 0.85));
  const cw = w / n;
  return (
    <>
      <Part at={[0, 0.06, 0]} size={[w, 0.12, d]} color={DARK} p={p} />
      <Body at={[0, 0.12 + (h - 0.12) / 2, 0]} size={[w - 0.02, h - 0.12, d - 0.02]} p={p} />
      {Array.from({ length: n }, (_, i) => {
        const x = -w / 2 + cw * (i + 0.5);
        return (
          <group key={i}>
            <Part at={[x - cw / 2, 1.0, d / 2 + 0.003]} size={[0.015, h - 0.4, 0.01]} color={DARK} p={p} round={0.004} />
            <Part at={[x + cw * 0.3, 1.0, d / 2 + 0.015]} size={[0.04, 0.2, 0.025]} color={STEEL} p={p} />
            <Part at={[x, h - 0.35, d / 2 + 0.003]} size={[cw - 0.3, 0.12, 0.01]} color={GLASS} p={p} />
          </group>
        );
      })}
      <Part at={[0, h + 0.04, -d / 2 + 0.25]} size={[w - 0.1, 0.08, 0.3]} color={STEEL} p={p} />
      <Lamp at={[w / 2 - 0.3, h - 0.1, d / 2 + 0.02]} p={p} size={0.05} />
    </>
  );
}

/* Gas cylinder: one lathe body (shoulder and neck) and one valve, shared by every bottle. Origin at the foot, y up. */
const TANK_GEO = new THREE.LatheGeometry(
  [[0, 0], [0.085, 0], [0.112, 0.02], [0.115, 0.05], [0.115, 1.0], [0.108, 1.1], [0.09, 1.18], [0.065, 1.24], [0.04, 1.28], [0.036, 1.3], [0, 1.3]].map(([r, y]) => new THREE.Vector2(r, y)),
  14,
);
const VALVE_GEO = new THREE.LatheGeometry(
  [[0, 0], [0.038, 0], [0.038, 0.07], [0.06, 0.07], [0.06, 0.13], [0.032, 0.14], [0.032, 0.2], [0, 0.2]].map(([r, y]) => new THREE.Vector2(r, y)),
  12,
);

/** Shielding-gas cylinder rack: caged frame (colour code), two rows of bottles with valves, headers, regulator station, chain. */
function GasManifold(p: DetailProps) {
  const { w, d, h } = p;
  const per = 6;
  const pitch = 0.34;
  const rowZ = 0.5;
  const px = w / 2 - 0.06;
  const pz = d / 2 - 0.06;
  const hdrY = 1.6;
  const mat = (c: string) => <meshStandardMaterial color={c} roughness={0.5} metalness={0.3} transparent opacity={p.opacity} />;
  return (
    <>
      <Part at={[0, 0.05, 0]} size={[w, 0.1, d]} color={DARK} p={p} />
      {/* cage: corner posts, top rails, mid side rails (chain anchors), kick plates */}
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Body key={`po${sx}${sz}`} at={[sx * px, 0.1 + (h - 0.1) / 2, sz * pz]} size={[0.08, h - 0.1, 0.08]} p={p} round={0.01} />))}
      {[-1, 1].map((s) => (
        <group key={`fr${s}`}>
          <Body at={[0, h - 0.03, s * pz]} size={[w - 0.2, 0.06, 0.06]} p={p} round={0.01} />
          <Body at={[s * px, h - 0.03, 0]} size={[0.06, 0.06, d - 0.2]} p={p} round={0.01} />
          <Body at={[s * px, 0.85, 0]} size={[0.05, 0.05, d - 0.2]} p={p} round={0.01} />
          <Body at={[0, 0.2, s * (d / 2 - 0.05)]} size={[w - 0.2, 0.2, 0.03]} p={p} round={0.01} />
          <Body at={[s * (w / 2 - 0.05), 0.2, 0]} size={[0.03, 0.2, d - 0.2]} p={p} round={0.01} />
        </group>
      ))}
      {/* bottles: back row argon, front row CO2 */}
      {[-1, 1].map((row) =>
        Array.from({ length: per }, (_, i) => (
          <group key={`${row}-${i}`} position={[(i - (per - 1) / 2) * pitch, 0.1, row * rowZ]}>
            <mesh geometry={TANK_GEO}>{mat(row < 0 ? "#4f6e5e" : "#8b9893")}</mesh>
            <mesh geometry={VALVE_GEO} position-y={1.3}>
              {mat(STEEL)}
            </mesh>
          </group>
        )),
      )}
      {/* chain across each row, anchored on the side rails */}
      {[-1, 1].map((s) => (
        <Part key={`ch${s}`} at={[0, 0.85, s * (rowZ + 0.126)]} size={[w - 0.17, 0.04, 0.02]} color={DARK} p={p} round={0.004} />
      ))}
      {/* headers over the valves, cross pipe, regulator with gauge, outlet line with ball valve */}
      {[-1, 1].map((s) => (
        <Cyl key={`hd${s}`} at={[0, hdrY, s * rowZ]} r={0.03} len={(per - 1) * pitch + 0.2} color={STEEL} p={p} axis="x" />
      ))}
      <Cyl at={[0, hdrY, 0]} r={0.03} len={rowZ * 2} color={STEEL} p={p} axis="z" />
      <Cyl at={[0, 1.48, 0]} r={0.065} len={0.26} color={STEEL} p={p} />
      <Cyl at={[0, 1.66, 0]} r={0.04} len={0.06} color={DARK} p={p} />
      <Cyl at={[0, 1.5, 0.085]} r={0.085} len={0.03} color={STEEL} p={p} axis="z" />
      <Cyl at={[0, 1.5, 0.1]} r={0.068} len={0.02} color="#e3e8e8" p={p} axis="z" />
      <Cyl at={[0, 1.16, 0]} r={0.022} len={0.42} color={STEEL} p={p} />
      <Cyl at={[0, 0.95, 0.4]} r={0.022} len={0.8} color={STEEL} p={p} axis="z" />
      <Part at={[0, 0.95, 0.55]} size={[0.07, 0.07, 0.12]} color={DARK} p={p} />
      <Part at={[0, 1.01, 0.55]} size={[0.12, 0.015, 0.025]} color={DARK} p={p} round={0.004} />
      <Cyl at={[0, 0.95, 0.8]} r={0.045} len={0.02} color={STEEL} p={p} axis="z" />
      <Lamp at={[w / 2 - 0.135, 1.68, pz]} p={p} size={0.08} />
    </>
  );
}

/** Cartridge dust collector: legs, collection drum, hopper, housing (colour code) with door, clean-air plenum and exhaust stubs, fan and motor beside it. */
function DustCollector(p: DetailProps) {
  const cx = -0.2; // housing / drum centre line
  const hw = 0.75; // housing half width (x)
  const hd = 0.85; // housing half depth (z)
  const fx = 0.88; // fan station x
  return (
    <>
      {/* legs, drum under the hopper outlet */}
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Part key={`lg${sx}${sz}`} at={[cx + sx * (hw - 0.05), 0.7, sz * (hd - 0.05)]} size={[0.1, 1.4, 0.1]} color={DARK} p={p} round={0.01} />))}
      <Cyl at={[cx, 0.3, 0]} r={0.27} len={0.6} color={STEEL} p={p} seg={24} />
      <Cyl at={[cx, 0.3, 0]} r={0.278} len={0.03} color={DARK} p={p} seg={24} />
      <Cyl at={[cx, 0.58, 0]} r={0.285} len={0.05} color={DARK} p={p} seg={24} />
      <Cyl at={[cx, 0.7, 0]} r={0.11} len={0.2} color={DARK} p={p} />
      {/* four-sided hopper: unit pyramid frustum scaled to the housing */}
      <group position={[cx, 1.1, 0]} scale={[hw, 1, hd]}>
        <mesh rotation-y={Math.PI / 4}>
          <cylinderGeometry args={[Math.SQRT2, 0.2 * Math.SQRT2, 0.6, 4, 1]} />
          <meshStandardMaterial color={STEEL} roughness={0.5} metalness={0.3} transparent opacity={p.opacity} />
        </mesh>
      </group>
      <Body at={[cx, 2.0, 0]} size={[hw * 2, 1.2, hd * 2]} p={p} round={0.02} />
      {/* access door with seal frame and handle, differential-pressure gauge, stack light */}
      <Part at={[-0.5, 1.95, hd + 0.005]} size={[0.74, 0.98, 0.02]} color={DARK} p={p} round={0.005} />
      <Part at={[-0.5, 1.95, hd + 0.025]} size={[0.66, 0.9, 0.025]} color={STEEL} p={p} round={0.008} />
      <Part at={[-0.27, 1.95, hd + 0.055]} size={[0.04, 0.28, 0.04]} color={DARK} p={p} round={0.01} />
      <Cyl at={[0.33, 2.25, hd + 0.01]} r={0.07} len={0.03} color={GLASS} p={p} axis="z" />
      <Lamp at={[0.33, 2.45, hd + 0.03]} p={p} size={0.07} />
      {/* dirty-air inlet on the front face, where the exhaust duct from the hood arrives: flange on the housing, a short stub, a hose clamp over the duct end */}
      <Part at={[0, 2.2, hd + 0.012]} size={[0.3, 0.3, 0.024]} color={DARK} p={p} round={0.01} />
      <Cyl at={[0, 2.2, hd + 0.13]} r={0.092} len={0.24} color={STEEL} p={p} axis="z" seg={28} />
      <Cyl at={[0, 2.2, hd + 0.04]} r={0.125} len={0.03} color={DARK} p={p} axis="z" seg={28} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return <Cyl key={`ib${i}`} at={[Math.cos(a) * 0.115, 2.2 + Math.sin(a) * 0.115, hd + 0.058]} r={0.008} len={0.014} color={STEEL} p={p} axis="z" seg={8} />;
      })}
      <Cyl at={[0, 2.2, hd + 0.21]} r={0.099} len={0.05} color={DARK} p={p} axis="z" seg={28} />
      {/* clean-air plenum, exhaust stubs with rain caps, pulse-jet header */}
      <Part at={[cx, 2.71, 0]} size={[hw * 2 - 0.1, 0.22, hd * 2 - 0.1]} color={STEEL} p={p} />
      {[-1, 1].map((s) => (
        <group key={`ex${s}`}>
          <Cyl at={[-0.55, 2.9, s * 0.4]} r={0.1} len={0.16} color={STEEL} p={p} />
          <Cyl at={[-0.55, 2.985, s * 0.4]} r={0.14} len={0.03} color={DARK} p={p} />
        </group>
      ))}
      <Cyl at={[0.15, 2.9, 0]} r={0.08} len={1.1} color={DARK} p={p} axis="z" />
      {/* clean-air duct to the fan: out of the plenum, elbow, down to the volute */}
      <Cyl at={[0.69, 2.71, 0]} r={0.14} len={0.38} color={STEEL} p={p} axis="x" />
      <mesh position={[fx, 2.71, 0]}>
        <sphereGeometry args={[0.14, 16, 12]} />
        <meshStandardMaterial color={STEEL} roughness={0.5} metalness={0.3} transparent opacity={p.opacity} />
      </mesh>
      <Cyl at={[fx, 1.705, 0]} r={0.14} len={2.01} color={STEEL} p={p} />
      {/* fan station: skid, volute, discharge stub, motor */}
      <Part at={[fx, 0.05, 0.28]} size={[0.64, 0.1, 1.05]} color={DARK} p={p} />
      <Cyl at={[fx, 0.4, 0]} r={0.3} len={0.3} color={STEEL} p={p} axis="z" seg={28} />
      <Cyl at={[fx, 0.4, 0.16]} r={0.12} len={0.04} color={DARK} p={p} axis="z" />
      <Cyl at={[1.15, 0.4, 0]} r={0.1} len={0.1} color={DARK} p={p} axis="x" />
      <Cyl at={[fx, 0.4, 0.42]} r={0.17} len={0.5} color={DARK} p={p} axis="z" />
    </>
  );
}

function ControlRoom(p: DetailProps) {
  const { w, d, h } = p;
  return (
    <>
      <Part at={[0, 0.1, 0]} size={[w, 0.2, d]} color={DARK} p={p} />
      <Body at={[0, 0.2 + (h - 0.35) / 2, 0]} size={[w - 0.05, h - 0.35, d - 0.05]} p={p} />
      <Part at={[0, h - 0.1, 0]} size={[w + 0.1, 0.12, d + 0.1]} color={STEEL} p={p} />
      <Part at={[-0.4, 1.7, d / 2 + 0.005]} size={[w - 1.6, 0.9, 0.02]} color={GLASS} p={p} metal={0.4} rough={0.2} />
      <Part at={[w / 2 - 0.55, 1.1, d / 2 + 0.01]} size={[0.8, 2.0, 0.03]} color={DARK} p={p} />
      <Part at={[w / 2 - 0.55, 0.12, d / 2 + 0.3]} size={[0.9, 0.12, 0.5]} color={STEEL} p={p} />
      <Part at={[-w / 2 + 1.0, h + 0.2, 0]} size={[1.2, 0.35, 0.8]} color={DARK} p={p} />
    </>
  );
}

function Packing(p: DetailProps) {
  const { w, d, h } = p;
  const layers = useRef<(THREE.Group | null)[]>([]);
  // cartons pile up on the pallet next to the dock until a cart takes the full pallet away
  useFrame(() => {
    const f = p.level?.();
    const n = f === undefined ? 3 : Math.ceil(f * 3 - 1e-6);
    layers.current.forEach((g, i) => g && (g.visible = i < n));
  });
  return (
    <>
      <ZoneMarking w={w} d={d} p={p} />
      <Part at={[-w / 2 + 0.7, 0.8, 0]} size={[1.4, 0.07, d - 1.0]} color={STEEL} p={p} />
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => <Part key={`${sx}${sz}`} at={[-w / 2 + 0.7 + sx * 0.6, 0.4, sz * (d / 2 - 0.6)]} size={[0.07, 0.8, 0.07]} color={DARK} p={p} />),
      )}
      <Body at={[-w / 2 + 0.7, 0.9, 0]} size={[0.8, 0.12, 0.6]} p={p} />
      <Part at={[w / 2 - 0.65, 0.07, d / 2 - 0.6]} size={[1.1, 0.14, 1.1]} color="#8a6f45" p={p} />
      {[0, 1, 2].map((i) => (
        <group key={i} ref={(g) => void (layers.current[i] = g)}>
          <Part at={[w / 2 - 0.65 + (i % 2) * 0.03, 0.14 + 0.15 + i * 0.3, d / 2 - 0.6]} size={[1.0, 0.28, 1.0]} color={CARTON} p={p} round={0.01} />
        </group>
      ))}
      <Part at={[0, 1.15, -d / 2 + 0.3]} size={[0.5, 0.3, 0.3]} color={DARK} p={p} />
      <Lamp at={[0, h + 0.05, -d / 2 + 0.3]} p={p} size={0.09} />
    </>
  );
}

function RejectBin(p: DetailProps) {
  const { w, d, h } = p;
  const t = 0.05;
  return (
    <>
      <Part at={[0, 0.06, 0]} size={[w, 0.12, d]} color={DARK} p={p} />
      <Body at={[0, h / 2, d / 2 - t / 2]} size={[w, h - 0.12, t]} p={p} round={0.01} />
      <Body at={[0, h / 2, -d / 2 + t / 2]} size={[w, h - 0.12, t]} p={p} round={0.01} />
      <Body at={[w / 2 - t / 2, h / 2, 0]} size={[t, h - 0.12, d - 2 * t]} p={p} round={0.01} />
      <Body at={[-w / 2 + t / 2, h / 2, 0]} size={[t, h - 0.12, d - 2 * t]} p={p} round={0.01} />
      <Part at={[0, 0.3, 0]} size={[w - 0.3, 0.3, d - 0.3]} color="#c9ced0" p={p} rough={0.8} />
    </>
  );
}

function RawRack(p: DetailProps) {
  const { w, d, h } = p;
  const lower = useRef<THREE.Group>(null);
  const upper = useRef<THREE.Group>(null);
  // the stacks of blanks shrink as the line takes them: the lower shelf is emptied first
  useFrame(() => {
    const f = p.level?.() ?? 1;
    const fill = (g: THREE.Group | null, v: number) => {
      if (!g) return;
      g.visible = v > 0.02;
      g.scale.y = Math.max(0.02, v);
    };
    fill(upper.current, Math.min(1, Math.max(0, f * 2 - 1)));
    fill(lower.current, Math.min(1, f * 2));
  });
  return (
    <>
      <ZoneMarking w={w} d={d} p={p} />
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Part key={`${sx}${sz}`} at={[sx * (w / 2 - 0.1), h / 2, sz * (d / 2 - 0.1)]} size={[0.1, h, 0.1]} color={DARK} p={p} />))}
      {[0.35, 0.95, 1.55].map((y) => (
        <Part key={y} at={[0, y, 0]} size={[w - 0.1, 0.07, d - 0.1]} color={STEEL} p={p} />
      ))}
      {/* each stack grows from its shelf: 0.34 m of blanks when full */}
      {[
        { ref: lower, y: 0.385, x: -0.3 },
        { ref: upper, y: 0.985, x: 0.4 },
      ].map((s) => (
        <group key={s.y} ref={s.ref} position={[s.x, s.y, 0]}>
          <Body at={[0, 0.17, 0]} size={[w - 1.2, 0.34, d - 0.5]} p={p} round={0.01} />
        </group>
      ))}
    </>
  );
}

/** Two pallet places with three layers each. The receiving stock stays full; the shipping stock fills pallet by pallet (see `level`). */
function Stock(p: DetailProps) {
  const { w, d } = p;
  const blocks = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    const f = p.level?.();
    const n = f === undefined ? 6 : Math.round(f * 6);
    blocks.current.forEach((g, k) => g && (g.visible = k < n));
  });
  return (
    <>
      <ZoneMarking w={w} d={d} p={p} />
      {[-1, 1].map((s) => (
        <Part key={s} at={[s * (w / 4), 0.07, 0]} size={[w / 2 - 0.2, 0.14, d - 0.3]} color="#8a6f45" p={p} />
      ))}
      {[0, 1, 2].flatMap((i) =>
        [-1, 1].map((s) => (
          <group key={`${i}${s}`} ref={(g) => void (blocks.current[i * 2 + (s > 0 ? 1 : 0)] = g)}>
            <Part at={[s * (w / 4), 0.14 + 0.18 + i * 0.35, 0]} size={[w / 2 - 0.35, 0.33, d - 0.45]} color={CARTON} p={p} round={0.01} />
          </group>
        )),
      )}
    </>
  );
}

function Fixture(p: DetailProps) {
  const { w, d, h } = p;
  const closed = useRef(0);
  useFrame(() => {
    const a = p.act();
    closed.current += ((a.busy ? 1 : 0) - closed.current) * 0.2;
  });
  // the carrier rides on the belt here (0.62 m up), so the jig is an open frame around it: feet, posts, beams, a shelf with the valve block
  return (
    <>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <group key={`fr${sx}${sz}`}>
            <Part at={[sx * (w / 2 - 0.12), 0.008, sz * (d / 2 - 0.1)]} size={[0.16, 0.016, 0.16]} color={STEEL} p={p} round={0.004} />
            <Part at={[sx * (w / 2 - 0.12), 0.3, sz * (d / 2 - 0.1)]} size={[0.07, 0.58, 0.07]} color={DARK} p={p} round={0.008} />
            {[0.012, -0.012].map((o) => (
              <Cyl key={`fb${o}`} at={[sx * (w / 2 - 0.12) + o * 4, 0.02, sz * (d / 2 - 0.1) + o * 4]} r={0.008} len={0.012} color={STEEL} p={p} seg={8} />
            ))}
          </group>
        )),
      )}
      {[-1, 1].map((sz) => (
        <Part key={`lb${sz}`} at={[0, 0.54, sz * (d / 2 - 0.1)]} size={[w - 0.24, 0.06, 0.06]} color={STEEL} p={p} round={0.006} />
      ))}
      {[-1, 1].map((sx) => (
        <Part key={`cb${sx}`} at={[sx * (w / 2 - 0.12), 0.54, 0]} size={[0.06, 0.06, d - 0.2]} color={STEEL} p={p} round={0.006} />
      ))}
      <Part at={[0, 0.32, 0]} size={[w - 0.5, 0.035, d - 0.3]} color={STEEL} p={p} round={0.006} />
      {/* valve block on the shelf (carries the colour code), solenoid valves and the air lines up to the clamps */}
      <Body at={[-0.35, 0.42, 0]} size={[0.5, 0.17, 0.26]} p={p} round={0.015} />
      {[-0.52, -0.43, -0.34, -0.25].map((x) => (
        <Part key={`sv${x}`} at={[x, 0.54, 0]} size={[0.06, 0.1, 0.07]} color={DARK} p={p} round={0.006} />
      ))}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => <Cyl key={`ln${sx}${sz}`} at={[sx * 0.28, 0.58, sz * 0.33]} r={0.007} len={0.34} color={DARK} p={p} seg={8} />),
      )}
      {/* two posts on each side carry guide rails along the belt */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => <Part key={`po${sx}${sz}`} at={[sx * 0.62, 0.5, sz * 0.36]} size={[0.06, 0.4, 0.06]} color={DARK} p={p} round={0.008} />),
      )}
      {[-1, 1].map((sz) => (
        <group key={`gr${sz}`}>
          <Part at={[0, 0.74, sz * 0.31]} size={[1.46, 0.045, 0.03]} color={STEEL} p={p} round={0.005} />
          <Part at={[0, 0.69, sz * 0.36]} size={[1.46, 0.035, 0.1]} color={DARK} p={p} round={0.006} />
        </group>
      ))}
      {/* photo-eye posts at the downstream end: a beam across the belt, nothing in the carrier's way */}
      {[-1, 1].map((sz) => (
        <group key={`pe${sz}`}>
          <Part at={[0.68, 0.84, sz * 0.38]} size={[0.06, 0.2, 0.06]} color={STEEL} p={p} round={0.006} />
          <Part at={[0.68, 0.95, sz * 0.38]} size={[0.05, 0.03, 0.05]} color={DARK} p={p} round={0.006} />
          <mesh position={[0.68, 0.9, sz * 0.343]}>
            <sphereGeometry args={[0.012, 10, 10]} />
            <meshStandardMaterial color="#ff4a3a" emissive="#ff4a3a" emissiveIntensity={2.4} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* clamps on both sides of the carrier, closing while the work is done */}
      {[-1, 1].map((sx) => (
        <group key={`cl${sx}`}>
          <Clamp at={[sx * 0.25, 0.715, -0.31]} side={-1} p={p} closed={closed} />
          <Clamp at={[sx * 0.25, 0.715, 0.31]} side={1} p={p} closed={closed} />
        </group>
      ))}
      <mesh visible={false}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
    </>
  );
}
function Positioner(p: DetailProps) {
  const { w, d } = p;
  const TBL_Y = BELT_TOP - 0.088; // the roller bed's top is 0.088 above the table's origin
  const tbl = useRef<THREE.Group>(null);
  const closed = useRef(0);
  useFrame(() => {
    const a = p.act();
    if (tbl.current) tbl.current.rotation.y = Math.PI * smooth(0.85, 1, a.busy || a.progress >= 1 ? a.progress : 0);
    // the clamps hold the carrier from the start of the work until the table turns
    closed.current += ((a.busy && a.progress < 0.84 ? 1 : 0) - closed.current) * 0.2;
  });
  return (
    <>
      {/* base cabinet: plinth, side doors with louvres, e-stop */}
      <Part at={[0, 0.03, 0]} size={[w + 0.04, 0.06, d + 0.04]} color={DARK} p={p} round={0.01} />
      <Body at={[0, 0.22, 0]} size={[w, 0.32, d]} p={p} round={0.03} />
      {[-1, 1].map((sz) => (
        <group key={`lv${sz}`}>
          {[-0.7, 0.7].map((x) => (
            <group key={x}>
              <Part at={[x, 0.22, sz * (d / 2 + 0.004)]} size={[0.8, 0.24, 0.008]} color={DARK} p={p} round={0.004} />
              {[-0.08, -0.04, 0, 0.04, 0.08].map((y) => (
                <Part key={y} at={[x, 0.22 + y, sz * (d / 2 + 0.011)]} size={[0.7, 0.012, 0.008]} color={STEEL} p={p} round={0.002} />
              ))}
            </group>
          ))}
        </group>
      ))}
      <Cyl at={[w / 2 - 0.18, 0.32, d / 2 + 0.012]} r={0.032} len={0.024} color="#c62d27" p={p} axis="z" seg={20} />
      {/* turntable drive: column, motor and gearbox, slewing ring with bolts */}
      <Cyl at={[0, 0.465, 0]} r={0.3} len={0.17} color={STEEL} p={p} seg={36} />
      <Part at={[0.34, 0.46, 0.18]} size={[0.26, 0.16, 0.2]} color={DARK} p={p} round={0.02} />
      <Cyl at={[0.52, 0.46, 0.18]} r={0.075} len={0.14} color={STEEL} p={p} axis="x" seg={20} />
      <Cyl at={[0, TBL_Y - 0.017, 0]} r={0.46} len={0.05} color={DARK} p={p} seg={44} />
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return <Cyl key={`sb${i}`} at={[Math.cos(a) * 0.4, TBL_Y + 0.011, Math.sin(a) * 0.4]} r={0.011} len={0.012} color={STEEL} p={p} seg={8} />;
      })}
      {/* the table is level with the belt: the tray rolls straight onto the entry plate, and off the exit plate after the half turn */}
      <group ref={tbl} position={[0, TBL_Y, 0]}>
        {[-1, 1].map((s) => (
          <group key={s}>
            {/* table plate with a belt channel through the middle, so the carrier rolls on and off */}
            <Part at={[s * POSITIONER_DX, 0.04, 0]} size={[0.92, 0.06, d - 0.3]} color={STEEL} p={p} round={0.006} />
            <Part at={[s * POSITIONER_DX, 0.075, 0]} size={[0.9, 0.018, 0.54]} color={DARK} p={p} round={0.004} />
            {Array.from({ length: 9 }, (_, i) => (
              <Part key={`ro${i}`} at={[s * POSITIONER_DX - 0.4 + i * 0.1, 0.085, 0]} size={[0.012, 0.006, 0.52]} color={STEEL} p={p} round={0.002} />
            ))}
            {/* guide rails along the belt and the locating pins at the stop end */}
            {[-1, 1].map((q) => (
              <Part key={`gr${q}`} at={[s * POSITIONER_DX, 0.1, q * 0.3]} size={[0.9, 0.05, 0.022]} color={STEEL} p={p} round={0.004} />
            ))}
            {[-1, 1].map((q) => (
              <Cyl key={`lp${q}`} at={[s * POSITIONER_DX + s * 0.3, 0.1, q * 0.12]} r={0.014} len={0.07} color={STEEL} p={p} seg={10} />
            ))}
            {/* clamps */}
            {[-1, 1].map((q) => (
              <group key={`cl${q}`}>
                <Clamp at={[s * POSITIONER_DX - 0.18, 0.07, q * 0.38]} side={q === 1 ? 1 : -1} p={p} closed={closed} />
                <Clamp at={[s * POSITIONER_DX + 0.18, 0.07, q * 0.38]} side={q === 1 ? 1 : -1} p={p} closed={closed} />
              </group>
            ))}
          </group>
        ))}
      </group>
    </>
  );
}

function WeldSource(p: DetailProps) {
  const { w, d, h } = p;
  return (
    <>
      <Body at={[0, h / 2, 0]} size={[w, h, d]} p={p} round={0.02} />
      <Part at={[0, h * 0.7, d / 2 + 0.003]} size={[w - 0.1, 0.12, 0.008]} color={GLASS} p={p} />
      {[-0.15, 0, 0.15].map((x) => (
        <Cyl key={x} at={[x, h * 0.35, d / 2 + 0.015]} r={0.025} len={0.03} color={DARK} p={p} axis="z" />
      ))}
    </>
  );
}

function TorchCleaner(p: DetailProps) {
  const { w, d, h } = p;
  return (
    <>
      <Body at={[0, h * 0.35, 0]} size={[w, h * 0.7, d]} p={p} round={0.02} />
      <Cyl at={[0, h * 0.7 + 0.05, 0]} r={0.06} len={0.1} color={STEEL} p={p} />
      <Cyl at={[0, h * 0.7 + 0.12, 0]} r={0.04} len={0.06} color={DARK} p={p} />
    </>
  );
}

function RobotController(p: DetailProps) {
  const { w, d, h } = p;
  return (
    <>
      <Part at={[0, 0.05, 0]} size={[w, 0.1, d]} color={DARK} p={p} />
      <Body at={[0, 0.1 + (h - 0.1) / 2, 0]} size={[w - 0.02, h - 0.1, d - 0.02]} p={p} />
      <Part at={[0, h / 2 + 0.2, d / 2 + 0.003]} size={[0.02, h - 0.5, 0.01]} color={DARK} p={p} round={0.004} />
      <Part at={[w / 2 - 0.2, h / 2 + 0.2, d / 2 + 0.015]} size={[0.05, 0.2, 0.025]} color={STEEL} p={p} />
      <Part at={[-w / 2 + 0.3, h - 0.3, d / 2 + 0.004]} size={[0.3, 0.16, 0.01]} color={GLASS} p={p} />
      <Lamp at={[w / 2 - 0.15, h + 0.04, 0]} p={p} size={0.07} />
    </>
  );
}

const BY_TYPE: Record<string, (p: DetailProps) => React.ReactElement> = {
  laser_cutter: Laser,
  press_brake: PressBrake,
  deburring: Deburring,
  washer_dryer: Washer,
  inspection_station: Inspection,
  laser_marker: Marker,
  chiller: Chiller,
  compressor: Compressor,
  air_dryer: AirDryer,
  air_receiver: AirReceiver,
  power_panel: PowerPanel,
  gas_manifold: GasManifold,
  dust_collector: DustCollector,
  control_room: ControlRoom,
  packing_station: Packing,
  reject_bin: RejectBin,
  raw_rack: RawRack,
  stock: Stock,
  fixture: Fixture,
  positioner_2station: Positioner,
  weld_power_source: WeldSource,
  torch_cleaner: TorchCleaner,
  robot_controller: RobotController,
};

export const DETAIL_TYPES = new Set(Object.keys(BY_TYPE));

export function MachineDetail({ type, ...p }: DetailProps & { type: string }) {
  const C = BY_TYPE[type];
  return C ? <C {...p} /> : null;
}

/* ── pieces with their own placement in the scene ── */

/** Belt conveyor: side rails, dark belt, legs, drive at the exit end. `w` along x, `d` across. */
export function ConveyorDetail({ w, d, h, opacity, color, glow }: { w: number; d: number; h: number; opacity: number; color: string; glow: string }) {
  const legs = Math.max(2, Math.round(w / 1.6) + 1);
  const mat = (c: string, g = false) => <meshStandardMaterial color={c} roughness={0.6} metalness={0.35} transparent opacity={opacity} emissive={g ? glow : "#000000"} emissiveIntensity={g ? 0.2 : 0} />;
  return (
    <group>
      <mesh position={[0, h - 0.06, 0]}>
        <boxGeometry args={[w, 0.05, d - 0.08]} />
        {mat("#3b4549")}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, h - 0.12, s * (d / 2 - 0.025)]}>
          <boxGeometry args={[w, 0.16, 0.05]} />
          {mat(color, true)}
        </mesh>
      ))}
      {Array.from({ length: legs }, (_, i) =>
        [-1, 1].map((s) => (
          <mesh key={`${i}${s}`} position={[-w / 2 + 0.2 + (i * (w - 0.4)) / (legs - 1), (h - 0.2) / 2, s * (d / 2 - 0.05)]}>
            <boxGeometry args={[0.05, h - 0.2, 0.05]} />
            {mat("#5b6a6e")}
          </mesh>
        )),
      )}
      <mesh position={[w / 2 - 0.15, h - 0.3, d / 2 + 0.08]}>
        <boxGeometry args={[0.3, 0.22, 0.14]} />
        {mat("#38464a")}
      </mesh>
    </group>
  );
}

/** Where the hood's round outlet ends (flange face), relative to the hood's centre at its hanging height: the exhaust duct from the collector is drawn to this point. */
export const HOOD_Y = 1.9;
export const HOOD_DUCT_R = 0.1;
export const HOOD_OUTLET = { dx: 1.11, dy: 0.46, dz: -0.3 };

/** Extraction hood over the welding station: four-sided canopy and a duct stub. */
/** A closed sheet-metal shell between two rectangles (flat shaded, with wall thickness `t` and a visible edge at the bottom). The top end sits under a plenum box. */
function frustumShell(w0: number, d0: number, w1: number, d1: number, h: number, t: number) {
  const pos: number[] = [];
  const quad = (a: Vec, b: Vec, c: Vec, d: Vec, out: Vec) => {
    // triangles a-b-c and a-c-d, flipped so the face looks along `out`
    const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const flip = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0;
    const tri = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (const v of tri) pos.push(v[0], v[1], v[2]);
  };
  const rect = (w: number, d: number, y: number): Vec[] => [
    [-w / 2, y, -d / 2],
    [w / 2, y, -d / 2],
    [w / 2, y, d / 2],
    [-w / 2, y, d / 2],
  ];
  const ob = rect(w0, d0, 0);
  const ot = rect(w1, d1, h);
  const ib = rect(w0 - 2 * t, d0 - 2 * t, 0);
  const it = rect(w1 - 2 * t, d1 - 2 * t, h);
  const dirs: Vec[] = [
    [0, 0.3, -1],
    [1, 0.3, 0],
    [0, 0.3, 1],
    [-1, 0.3, 0],
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(ob[i], ob[j], ot[j], ot[i], dirs[i]); // outside
    quad(ib[i], ib[j], it[j], it[i], [-dirs[i][0], -0.3, -dirs[i][2]]); // inside
    quad(ob[i], ob[j], ib[j], ib[i], [0, -1, 0]); // thickness of the lower edge
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/*
 * Welding fume extraction hood over the station: a sheet-metal canopy with a folded skirt, a plenum box and a round outlet to the
 * duct, hung from two rear posts, with a light strip along the front edge. The origin is the centre of the lower edge; the
 * parent lifts it to the hanging height. The shapes are our example (the profile only gives the footprint and that it is a hood).
 */
export function FumeHoodDetail({ w, d, opacity, tex = false, real = false, hang = 1.9 }: { w: number; d: number; opacity: number; tex?: boolean; real?: boolean; hang?: number }) {
  const p: DetailProps = { w, d, h: 0.5, body: "#b8c2c4", opacity, emissive: "#000000", ei: 0, act: () => ({ busy: false, progress: 0, status: "normal", state: "idle", processed: 0, busySec: 0, waiting: 0 }), tex, real };
  const skirt = 0.11;
  const t = 0.014;
  const top = { w: 1.0, d: 0.8, y: 0.4 };
  const shell = useMemo(() => frustumShell(w - 0.06, d - 0.06, top.w, top.d, top.y - skirt, t), [w, d, top.w, top.d, top.y]);
  const sp = surf(p, "steel");
  return (
    <group>
      {/* skirt: a folded rim all round, then the sloped canopy */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Part at={[0, skirt / 2, (s * (d - 0.03)) / 2]} size={[w - 0.03, skirt, 0.03]} color={STEEL} p={p} round={0.006} />
          <Part at={[(s * (w - 0.03)) / 2, skirt / 2, 0]} size={[0.03, skirt, d - 0.06]} color={STEEL} p={p} round={0.006} />
          <Part at={[0, 0.012, (s * (d - 0.1)) / 2]} size={[w - 0.1, 0.024, 0.05]} color={DARK} p={p} round={0.004} />
          <Part at={[(s * (w - 0.1)) / 2, 0.012, 0]} size={[0.05, 0.024, d - 0.1]} color={DARK} p={p} round={0.004} />
        </group>
      ))}
      <mesh geometry={shell} position={[0, skirt, 0]}>
        <meshPhysicalMaterial key={(tex ? "tex" : "plain") + (real ? "R" : "")} color={STEEL} roughness={real ? 0.4 : 0.55} metalness={real ? 0.85 : 0.45} side={THREE.DoubleSide} transparent opacity={opacity} envMapIntensity={real ? 1.3 : 1} {...sp} />
      </mesh>
      {/* trim rods along the four hips where the slopes meet, so the corners close */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => {
          const bx = (sx * (w - 0.06)) / 2;
          const bz = (sz * (d - 0.06)) / 2;
          const tx = (sx * top.w) / 2;
          const tz = (sz * top.d) / 2;
          const a = new THREE.Vector3(bx, skirt, bz);
          const b2 = new THREE.Vector3(tx, top.y, tz);
          const mid = a.clone().add(b2).multiplyScalar(0.5);
          const len = a.distanceTo(b2);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b2.clone().sub(a).normalize());
          return (
            <mesh key={`hip${sx}${sz}`} position={mid} quaternion={q}>
              <cylinderGeometry args={[0.017, 0.017, len + 0.02, 10]} />
              <meshPhysicalMaterial color={STEEL} roughness={real ? 0.36 : 0.5} metalness={real ? 0.9 : 0.4} transparent opacity={opacity} envMapIntensity={real ? 1.3 : 1} />
            </mesh>
          );
        }),
      )}
      {/* plenum box at the top with its bolted cover */}
      <Part at={[0, top.y + 0.05, 0]} size={[top.w, 0.1, top.d]} color={STEEL} p={p} round={0.012} />
      <Part at={[0, top.y + 0.105, 0]} size={[top.w - 0.12, 0.012, top.d - 0.12]} color={DARK} p={p} round={0.004} />
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Cyl key={`bt${sx}${sz}`} at={[sx * (top.w / 2 - 0.08), top.y + 0.112, sz * (top.d / 2 - 0.08)]} r={0.012} len={0.012} color={STEEL} p={p} seg={8} />))}
      {/* round outlet to the exhaust duct: transition collar, damper box and a flange with bolts */}
      <Cyl at={[0.2, top.y + 0.1, -0.3]} r={0.17} len={0.08} color={DARK} p={p} seg={32} />
      <Cyl at={[0.62, top.y + 0.06, -0.3]} r={HOOD_DUCT_R} len={0.9} color={STEEL} p={p} axis="x" seg={32} />
      <Part at={[0.4, top.y + 0.06, -0.3]} size={[0.14, 0.28, 0.28]} color={DARK} p={p} round={0.02} />
      <Cyl at={[1.09, top.y + 0.06, -0.3]} r={HOOD_DUCT_R + 0.05} len={0.035} color={DARK} p={p} axis="x" seg={32} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return <Cyl key={`fb${i}`} at={[1.115, top.y + 0.06 + Math.cos(a) * (HOOD_DUCT_R + 0.025), -0.3 + Math.sin(a) * (HOOD_DUCT_R + 0.025)]} r={0.01} len={0.02} color={STEEL} p={p} axis="x" seg={8} />;
      })}
      {/* light strip inside the front edge */}
      <mesh position={[0, 0.02, d / 2 - 0.08]}>
        <boxGeometry args={[w - 0.7, 0.016, 0.03]} />
        <meshStandardMaterial color="#f6fbff" emissive="#f6fbff" emissiveIntensity={real ? 3 : 1.2} toneMapped={false} />
      </mesh>
      {/* two rear posts with base plates and knee braces carry the hood */}
      {[-1, 1].map((s) => (
        <group key={`ps${s}`}>
          <Part at={[s * (w / 2 - 0.25), -hang / 2 + 0.05, -d / 2 + 0.09]} size={[0.1, hang + 0.1, 0.1]} color={DARK} p={p} round={0.01} />
          <Part at={[s * (w / 2 - 0.25), -hang + 0.01, -d / 2 + 0.09]} size={[0.28, 0.02, 0.28]} color={STEEL} p={p} round={0.004} />
          <Part at={[s * (w / 2 - 0.25), 0.1, -d / 2 + 0.09]} size={[0.14, 0.04, 0.2]} color={STEEL} p={p} round={0.006} />
          {[-1, 1].map((q) => (
            <Cyl key={`bb${q}`} at={[s * (w / 2 - 0.25) + q * 0.09, -hang + 0.04, -d / 2 + 0.09 + q * 0.09]} r={0.012} len={0.03} color={STEEL} p={p} seg={8} />
          ))}
        </group>
      ))}
    </group>
  );
}

/** Autonomous cart: low body with a top plate and a light strip. */
/** `lift`: how far the roller deck is raised on a lift column (the transfer carts raise it to the line's belt height; the stock carts stay low). */
export function AgvDetail({ opacity, lift = 0 }: { opacity: number; lift?: number }) {
  const m = (c: string, r = 0.5, mt = 0.25, e?: string, ei = 0) => <meshStandardMaterial color={c} roughness={r} metalness={mt} transparent opacity={opacity} emissive={e ?? "#000000"} emissiveIntensity={ei} />;
  const nb = Math.max(2, Math.round(lift / 0.03));
  return (
    <group>
      {/* chassis: dark skirt, white cover with rounded edges, dark bumpers at both ends */}
      <mesh position={[0, 0.045, 0]}>
        <boxGeometry args={[0.78, 0.09, 0.56]} />
        {m("#262d31", 0.7, 0.2)}
      </mesh>
      <RoundedBox args={[0.78, 0.17, 0.58]} radius={0.04} smoothness={3} position={[0, 0.17, 0]}>
        {m("#e8ecec", 0.4, 0.15)}
      </RoundedBox>
      {[-1, 1].map((s) => (
        <RoundedBox key={`bp${s}`} args={[0.7, 0.1, 0.03]} radius={0.012} smoothness={2} position={[0, 0.14, s * 0.3]}>
          {m("#1d2326", 0.6, 0.2)}
        </RoundedBox>
      ))}
      {/* light strip all round, visible from every side */}
      {[-1, 1].map((s) => (
        <group key={`ls${s}`}>
          <mesh position={[0, 0.2, s * 0.296]}>
            <boxGeometry args={[0.62, 0.014, 0.008]} />
            <meshStandardMaterial color="#58b6ff" emissive="#58b6ff" emissiveIntensity={1.4} toneMapped={false} />
          </mesh>
          <mesh position={[s * 0.396, 0.2, 0]}>
            <boxGeometry args={[0.008, 0.014, 0.44]} />
            <meshStandardMaterial color="#58b6ff" emissive="#58b6ff" emissiveIntensity={1.4} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* lift column between the chassis and the deck: a pillar with a bellows, so the deck can stand at the belt's height */}
      {lift > 0.01 ? (
        <group>
          <mesh position={[0, 0.255 + lift / 2, 0]}>
            <boxGeometry args={[0.34, lift, 0.3]} />
            {m("#2a3236", 0.7, 0.2)}
          </mesh>
          {Array.from({ length: nb }, (_, i) => (
            <mesh key={`bl${i}`} position={[0, 0.255 + ((i + 0.5) * lift) / nb, 0]}>
              <boxGeometry args={[0.37, (lift / nb) * 0.5, 0.33]} />
              {m("#1b2124", 0.8, 0.1)}
            </mesh>
          ))}
        </group>
      ) : null}
      <group position={[0, lift, 0]}>
      {/* top deck with a roller bed that takes the carrier, side guides */}
      <mesh position={[0, 0.268, 0]}>
        <boxGeometry args={[0.74, 0.03, 0.54]} />
        {m("#7d888c", 0.45, 0.6)}
      </mesh>
      {[-3, -2, -1, 0, 1, 2, 3].map((i) => (
        <mesh key={`rl${i}`} position={[0, 0.292, i * 0.07]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.014, 0.014, 0.68, 12]} />
          {m("#b9c2c6", 0.3, 0.8)}
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`sg${s}`} position={[s * 0.36, 0.3, 0]}>
          <boxGeometry args={[0.02, 0.035, 0.5]} />
          {m("#262d31", 0.6, 0.3)}
        </mesh>
      ))}
      </group>
      {/* safety scanners on two opposite corners and a status lamp */}
      {[[-1, -1], [1, 1]].map(([sx, sz]) => (
        <group key={`sc${sx}`} position={[sx * 0.33, 0.22, sz * 0.25]}>
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.032, 0.036, 0.04, 20]} />
            {m("#1d2326", 0.4, 0.4)}
          </mesh>
          <mesh position={[0, 0.074, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.012, 20]} />
            {m("#35e08a", 0.3, 0.1, "#35e08a", 0.6)}
          </mesh>
        </group>
      ))}
    </group>
  );
}
