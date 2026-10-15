"use client";

import { Suspense, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Html, Lightformer, OrbitControls, RoundedBox } from "@react-three/drei";
import { Bloom, DepthOfField, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode, type DepthOfFieldEffect } from "postprocessing";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { NET_STYLE, strokeGeometry } from "@/components/map/plantGeometry";
import { ARM, IndustrialArm, solveIK, type ArmGeo, type ArmHandle, type ArmMats, type ToolKind } from "./IndustrialArm";
import { readTokens, useMats, type Tokens } from "./shared";
import { FactoryShell } from "./FactoryShell";
import { AssumedTag, EVID_COLOR, EvidenceBadge, SensorPanel, StatusPill } from "@/components/SensorPanel";
import { AgvDetail, ConveyorDetail, DETAIL_TYPES, FumeHoodDetail, HOOD_OUTLET, HOOD_Y, MachineDetail } from "./MachineDetail";
import { BELT_TOP, CONVEYOR_H, beltGap } from "@/data/machinePaths";
import { PlantSim, RACK_CAP, fixtureFor, type Act } from "@/data/plantSim";
import { GlbArm, ROBOT_MODEL, robotConnector } from "./GlbArm";
import { STAGES, cartonGeometry, stageGeometries, stageOf, trayGeometry } from "./workpieces";
import { readSensors, workActFor, type Reading } from "@/data/plantSensors";
import { useSharedInjected } from "@/data/plantState";
import type { TrainScene } from "@/lib/training";
import {
  EVIDENCE_KO,
  cycleOf,
  equipmentById,
  footprintEvidence,
  footprintOf,
  profile,
  sourceById,
  takt,
  typeOf,
  type Confidence,
  type Instance,
  type Net,
} from "@/data/factoryProfile";
import { STATUS_KO, nameOf, resolveStatus, scenariosOf, type Resolved, type Status } from "@/data/plantStatus";

/*
 * Whole line, straight from the factory profile: every machine at its real footprint and height,
 * every connection as a line, and for each selection the evidence behind its numbers.
 * Nothing about the layout is typed in here. Plan x → scene x, plan y → scene z.
 */

const CATEGORY_COLOR: Record<string, string> = {
  process: "#c9d6dc",
  robot: "#8daa96",
  utility: "#d3dcd9",
  logistics: "#d9d3c2",
  storage: "#d9d3c2",
  control: "#c6ced0",
};
const TYPE_COLOR: Record<string, string> = {
  chiller: "#a9cde0",
  reject_bin: "#e6c4b8",
  gas_manifold: "#c8d6c8",
  dust_collector: "#cfd1c4",
};

/**
 * Background equipment (the two conveyors): no label, no click, not counted in the status chips.
 * Every other machine (34) gets a name label; see LabelLayout for how the labels avoid each other.
 */
const isBackground = (e: Instance) => e.type === "conveyor";
const titleOf = (e: Instance) => e.label?.title || typeOf(e).name_ko;
/** Shown only on hover or selection (cooling line, power, process ...). */
const subOf = (e: Instance) => e.label?.sub ?? (e.label?.title ? typeOf(e).name_ko : null);
const isAssumedConn = (c: { provenance: { confidence: Confidence } }) => c.provenance.confidence === "assumed";

const NEUTRAL_COLOR = "#d3dbd8";
const STATUS_COLOR: Record<Exclude<Status, "normal">, string> = { warning: "#e8b04a", abnormal: "#d4584a" };

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Level of detail: 0 = plain box, 1 = detailed model, 2 = detailed model plus the example-shape badge. `on` is the
 * distance from the machine up to which the detailed model is drawn (Infinity = always) and `tag` the distance for the
 * badge. Each level lets go 6 m / 3 m later, so nothing flickers at the edge. The component only re-renders when the
 * level changes.
 */
function useNear(cx: number, cy: number, cz: number, on: number, tag: number) {
  const [level, setLevel] = useState(on === Infinity ? 1 : 0);
  const ref = useRef(on === Infinity ? 1 : 0);
  useFrame(({ camera }) => {
    const d = Math.hypot(camera.position.x - cx, camera.position.y - cy, camera.position.z - cz);
    const near = ref.current >= 1 ? d < on + 6 : d < on;
    const close = ref.current >= 2 ? d < tag + 3 : d < tag;
    const want = near ? (close ? 2 : 1) : 0;
    if (want !== ref.current) {
      ref.current = want;
      setLevel(want);
    }
  });
  return level;
}

const TAG_TONE: Record<Status, string> = { normal: "text-primary", warning: "text-warn-text", abnormal: "text-danger-strong" };

/** Sits on a detailed model: says the shape is an example and always shows the model's current state. */
function ModelTag({ at, status, masked }: { at: [number, number, number]; status: Status; masked: boolean }) {
  return (
    <Html position={at} center zIndexRange={[0, 0]} style={{ pointerEvents: "none" }}>
      <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-surface/95 px-2 py-[2px] text-[10.5px] shadow-sm ring-1 ring-line">
        <span className="text-ink-2">예시 모양 · 가정</span>
        <b className={`font-semibold ${TAG_TONE[status]}`}>{masked && status !== "normal" ? "점검 필요" : STATUS_KO[status]}</b>
      </span>
    </Html>
  );
}

/**
 * The detailed shape is the normal look at every zoom. Plain boxes only take over far away, and only once the plant has
 * grown large (many machines) so the scene stays light; with today's 36 machines it never happens.
 */
const DETAIL_ALWAYS = profile.equipment.length <= 80;
const detailRange = (w: number, d: number) => (DETAIL_ALWAYS ? Infinity : 45 + Math.max(w, d));
/** the example-shape badge only shows on a machine the camera is close to (or that is selected or hovered) */
const tagRange = (w: number, d: number) => 10 + Math.max(w, d) / 2;
/** camera distance of the opening view, the 100% of the zoom readout */
const HOME_DIST = (() => {
  const B = profile.factory.building_m;
  return Math.hypot(6, 42, B.d + 56 - (B.d / 2 - 3));
})();
const box = (e: Instance) => {
  const f = footprintOf(e);
  return { cx: e.position_m.x, cy: e.position_m.y, w: f.w, d: f.d, h: f.h, x0: e.position_m.x - f.w / 2, x1: e.position_m.x + f.w / 2, y0: e.position_m.y - f.d / 2, y1: e.position_m.y + f.d / 2 };
};

/* ── connection geometry (plan metres → 3D paths) ─────────────────── */

/** `assumed`: drawn dashed (the profile marks the connection as an assumption). `conn`: the profile connection id, for the 가정 tag. */
type Line = { key: string; net: Net; from: string; to: string; pending: boolean; assumed: boolean; conn?: string; points: THREE.Vector3[] };

/**
 * A robot's lines end at the connectors on its base panel (rear, -Z), one line per connector: the controller's cable bundle in the middle,
 * the welding bundle on the +X side, cooling on the -X side, and compressed air on the +X side, or on the -X side when the robot has a
 * welding bundle (three connectors, so a robot with four lines would need a fifth: none has). Each route runs behind the robot, then rises or drops
 * to the connector height and ends at the connector's tip. Returns null for a line that is not a robot's.
 */
function robotLinePoints(c: { net: string; from: string; to: string; waypoints_m?: [number, number][]; drop_offset_m?: number }, st: { height: number }, busZ: number): THREE.Vector3[] | null {
  const a = equipmentById(c.from);
  const b = equipmentById(c.to);
  const robot = b?.type === "robot_arm" ? b : a?.type === "robot_arm" ? a : null;
  const other = robot === b ? a : b;
  if (!robot || !other) return null;
  const weld = profile.connections.some((x) => x.to === robot.id && equipmentById(x.from)?.type === "weld_power_source");
  const slot: 0 | 1 | 2 = other.type === "robot_controller" ? 1 : other.type === "weld_power_source" ? 0 : c.net === "cooling" ? 2 : weld ? 2 : 0;
  const k = robotConnector(slot);
  if (!k) return null;
  const rx = robot.position_m.x;
  const rz = robot.position_m.y;
  const end = v3(rx + k.dx, k.y, rz + k.dz);
  const behind = rz + k.dz - 0.25; // the lane behind the robot where the lines come in (z of the run)
  const w0 = c.waypoints_m?.[0]; // where the profile starts the line at the other machine
  const start = w0 ? v3(w0[0], k.y, w0[1]) : v3(other.position_m.x, k.y, other.position_m.y);
  if (other.type === "robot_controller") return [start, end];
  if (other.type === "weld_power_source") return [start, v3(start.x - 0.5, k.y, behind), v3(end.x, k.y, behind), end];
  if (c.net === "air") {
    const dropX = rx + (c.drop_offset_m ?? 0);
    return [v3(dropX, st.height, busZ), v3(dropX, st.height, behind - 0.2), v3(end.x, st.height, behind - 0.2), v3(end.x, 0.7, behind - 0.2), v3(end.x, k.y + 0.05, behind), end];
  }
  if (c.net === "cooling") {
    const dropX = rx + (c.drop_offset_m ?? 0);
    return [v3(dropX, 0.035, busZ), v3(dropX, 0.035, behind - 0.1), v3(end.x, 0.035, behind - 0.1), v3(end.x, 0.3, behind - 0.1), v3(end.x, k.y - 0.03, behind), end];
  }
  return null;
}

function buildLines(): Line[] {
  const lines: Line[] = [];
  const routeById = Object.fromEntries(profile.routes.map((r) => [r.id, r]));
  for (const c of profile.connections) {
    const a = equipmentById(c.from);
    const b = equipmentById(c.to);
    if (!a || !b) continue;
    const st = NET_STYLE[c.net];
    const pending = c.status === "needs_confirmation";
    const assumed = isAssumedConn(c);
    const atRobot = robotLinePoints(c, st, c.route ? routeById[c.route]?.polyline_m[0][1] ?? 0 : 0);
    if (atRobot) {
      lines.push({ key: c.id, net: c.net, from: c.from, to: c.to, pending, assumed, conn: c.id, points: atRobot });
      continue;
    }
    if (c.waypoints_m) {
      const pts = c.waypoints_m.map(([x, y]) => v3(x, st.height, y));
      // a duct that ends at the fume hood ends at the hood's round outlet, at the height the outlet really is
      if (b.type === "fume_hood" && pts.length > 1) {
        const last = pts[pts.length - 1];
        last.y = HOOD_Y + HOOD_OUTLET.dy;
        pts.splice(pts.length - 1, 0, v3(last.x + 0.5, (st.height + last.y) / 2, last.z));
      }
      lines.push({ key: c.id, net: c.net, from: c.from, to: c.to, pending, assumed, conn: c.id, points: pts });
      continue;
    }
    const r = c.route ? routeById[c.route] : null;
    if (!r) continue;
    const busY = r.polyline_m[0][1];
    const bb = box(b);
    const dropX = bb.cx + (c.drop_offset_m ?? 0);
    const endY = bb.cy > busY ? bb.y0 : bb.y1;
    const topH = bb.h;
    const hBus = st.height;
    if (r.kind === "trench") {
      // below the floor: stub from the source, trench line, drop up to the consumer
      lines.push({ key: c.id, net: c.net, from: c.from, to: c.to, pending, assumed, conn: c.id, points: [v3(dropX, hBus, busY), v3(dropX, hBus, endY), v3(dropX, Math.min(0.2, topH), endY)] });
    } else {
      lines.push({ key: c.id, net: c.net, from: c.from, to: c.to, pending, assumed, conn: c.id, points: [v3(dropX, hBus, busY), v3(dropX, hBus, endY), v3(dropX, Math.min(hBus, topH), endY)] });
    }
  }
  // buses and the trench itself (one pipe per route, source stub included)
  for (const r of profile.routes) {
    const st = NET_STYLE[r.net];
    const cs = profile.connections.filter((c) => c.route === r.id);
    if (!cs.length) continue;
    const y = r.polyline_m[0][1];
    const srcs = [...new Set(cs.map((c) => c.from))];
    const xs = [...cs.map((c) => (equipmentById(c.to) ? box(equipmentById(c.to)!).cx + (c.drop_offset_m ?? 0) : 0)), ...srcs.map((s) => box(equipmentById(s)!).cx)];
    const x0 = r.kind === "bus" ? r.polyline_m[0][0] : Math.min(...xs);
    const x1 = r.kind === "bus" ? r.polyline_m[r.polyline_m.length - 1][0] : Math.max(...xs);
    // a shared bus or trench only reads as solid when every connection it carries is backed by a source
    lines.push({ key: `bus-${r.id}`, net: r.net, from: srcs[0], to: srcs[0], pending: false, assumed: cs.some(isAssumedConn), points: [v3(x0, st.height, y), v3(x1, st.height, y)] });
    for (const s of srcs) {
      const b = box(equipmentById(s)!);
      lines.push({ key: `stub-${r.id}-${s}`, net: r.net, from: s, to: s, pending: false, assumed: cs.filter((c) => c.from === s).some(isAssumedConn), points: [v3(b.cx, Math.min(st.height, b.h), b.cy), v3(b.cx, st.height, y)] });
    }
  }
  return lines;
}
const LINES = buildLines();

/** The pieces of a through conveyor: it is cut wherever a machine has its own belt or turntable in the line (a positioner, the inspection cell, the marker), so two belts never lie on top of each other. */
function conveyorPieces(b: { cx: number; cy: number; x0: number; x1: number; d: number }): [number, number][] {
  const gaps: [number, number][] = [];
  for (const m of profile.equipment) {
    const f = footprintOf(m);
    const g = beltGap(m.type, f.w);
    if (!g || Math.abs(m.position_m.y - b.cy) > b.d) continue;
    const a = m.position_m.x + g[0];
    const z = m.position_m.x + g[1];
    if (z > b.x0 && a < b.x1) gaps.push([Math.max(a, b.x0), Math.min(z, b.x1)]);
  }
  gaps.sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let at = b.x0;
  for (const [a, z] of gaps) {
    if (a - at > 0.05) out.push([at, a]);
    at = Math.max(at, z);
  }
  if (b.x1 - at > 0.05) out.push([at, b.x1]);
  return out;
}

/** Point halfway along a polyline (where a connection's 가정 tag sits). */
function midOf(points: THREE.Vector3[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += points[i].distanceTo(points[i - 1]);
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].distanceTo(points[i - 1]);
    if (left <= d && d > 0) return points[i - 1].clone().lerp(points[i], left / d);
    left -= d;
  }
  return points[points.length - 1].clone();
}

/* ── strokes: solid = backed by a source, dashed = assumption ─────── */

/* ── scene pieces ─────────────────────────────────────────────────── */

function Tube({ points, color, radius, dim, dashed }: { points: THREE.Vector3[]; color: string; radius: number; dim: boolean; dashed: boolean }) {
  const geo = useMemo(() => {
    if (dashed) return strokeGeometry(points, radius, true);
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.05);
    return new THREE.TubeGeometry(curve, Math.max(8, points.length * 10), radius, 8, false);
  }, [points, radius, dashed]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <mesh geometry={geo} userData={{ noCast: true }}>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim ? 0.1 : 0.6} transparent opacity={dim ? 0.25 : 1} roughness={0.5} />
    </mesh>
  );
}

/** Floor outline around every machine: solid when the footprint has a source, dashed when the footprint is assumed. */
const OUTLINE_PAD = 0.14;
function FootprintOutlines() {
  const geos = useMemo(() => {
    const solid: THREE.BufferGeometry[] = [];
    const dashed: THREE.BufferGeometry[] = [];
    for (const e of profile.equipment) {
      if (isBackground(e) || e.type === "agv") continue; // AGVs drive around; their footprint is not a floor area
      const b = box(e);
      const [x0, x1, z0, z1, y] = [b.x0 - OUTLINE_PAD, b.x1 + OUTLINE_PAD, b.y0 - OUTLINE_PAD, b.y1 + OUTLINE_PAD, 0.03];
      const assumed = footprintEvidence(e) === "assumed";
      const g = strokeGeometry([v3(x0, y, z0), v3(x1, y, z0), v3(x1, y, z1), v3(x0, y, z1), v3(x0, y, z0)], 0.03, assumed, 6);
      if (g) (assumed ? dashed : solid).push(g);
    }
    return { solid: solid.length ? mergeGeometries(solid) : null, dashed: dashed.length ? mergeGeometries(dashed) : null };
  }, []);
  return (
    <>
      {geos.solid ? (
        <mesh geometry={geos.solid} userData={{ noCast: true }}>
          <meshBasicMaterial color="#6f8582" />
        </mesh>
      ) : null}
      {geos.dashed ? (
        <mesh geometry={geos.dashed} userData={{ noCast: true }}>
          <meshBasicMaterial color="#6f8582" />
        </mesh>
      ) : null}
    </>
  );
}

function Machine({
  e,
  selected,
  dimmed,
  colorBy,
  status,
  masked,
  tex,
  real,
  act,
  level,
  onSelect,
  onFocus,
  onHover,
}: {
  e: Instance;
  selected: boolean;
  dimmed: boolean;
  colorBy: "category" | "evidence" | "neutral";
  status: Status;
  /** a drill is running and the level of a fault must not show */
  masked: boolean;
  /** draw surface textures on the machine types that have them */
  tex: boolean;
  /** realistic shading (clear coat, polished metal) */
  real: boolean;
  act: () => Act;
  /** how full a stock looks (0..1), undefined when the machine shows no fill */
  level: () => number | undefined;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const t = typeOf(e);
  const b = box(e);
  const lod = useNear(b.cx, b.h / 2, b.cy, detailRange(b.w, b.d), tagRange(b.w, b.d));
  const near = lod >= 1;
  const [hover, setHover] = useState(false);
  if (t.shape === "robot" || e.type === "conveyor" || e.type === "fume_hood") return null;
  const evid = footprintEvidence(e);
  const plain = colorBy === "neutral" ? NEUTRAL_COLOR : colorBy === "evidence" ? EVID_COLOR[evid] : (TYPE_COLOR[e.type] ?? CATEGORY_COLOR[t.category]);
  const base = status === "normal" ? plain : STATUS_COLOR[status];
  const low = e.type === "fixture" || e.type === "positioner_2station";
  // far away every machine is a plain box (the colour and status are what matters); the detailed shape opens up close
  if (DETAIL_TYPES.has(e.type) && near) {
    const glow = selected ? "#176c5b" : status === "normal" ? "#000000" : STATUS_COLOR[status];
    return (
      <group position={[b.cx, 0, b.cy]} onClick={(ev) => (ev.stopPropagation(), onSelect(e.id))} onDoubleClick={(ev) => (ev.stopPropagation(), onFocus(e.id))} onPointerOver={(ev) => (ev.stopPropagation(), setHover(true), onHover(e.id))} onPointerOut={() => (setHover(false), onHover(null))}>
        <MachineDetail type={e.type} act={act} w={b.w} d={b.d} h={b.h} body={base} opacity={dimmed ? 0.3 : 1} emissive={glow} ei={selected ? 0.35 : status === "normal" ? 0 : 0.25} tex={tex} real={real} level={level} />
        {lod >= 2 || selected || hover ? <ModelTag at={[0, b.h + 0.55, 0]} status={status} masked={masked} /> : null}
        {/* invisible floor pad so the open parts of the footprint stay clickable */}
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} userData={{ noCast: true }}>
          <planeGeometry args={[b.w, b.d]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    );
  }
  return (
    <group position={[b.cx, 0, b.cy]} onClick={(ev) => (ev.stopPropagation(), onSelect(e.id))} onDoubleClick={(ev) => (ev.stopPropagation(), onFocus(e.id))} onPointerOver={(ev) => (ev.stopPropagation(), setHover(true), onHover(e.id))} onPointerOut={() => (setHover(false), onHover(null))}>
      {t.shape === "ellipse" ? (
        <mesh position={[0, b.h / 2, 0]} scale={[b.w / 2, 1, b.d / 2]}>
          <cylinderGeometry args={[1, 1, b.h, 32]} />
          <meshStandardMaterial color={base} roughness={0.6} metalness={0.15} transparent opacity={dimmed ? 0.3 : 1} emissive={selected ? "#176c5b" : status === "normal" ? "#000000" : STATUS_COLOR[status]} emissiveIntensity={selected ? 0.35 : status === "normal" ? 0 : 0.25} />
        </mesh>
      ) : (
        <>
        {DETAIL_TYPES.has(e.type) && !low ? (
          <>
            {/* plinth and lid inset: a hint of structure for the far-away box */}
            <mesh position={[0, 0.06, 0]}>
              <boxGeometry args={[b.w * 1.02, 0.12, b.d * 1.02]} />
              <meshStandardMaterial color="#4a5658" roughness={0.8} transparent opacity={dimmed ? 0.3 : 1} />
            </mesh>
            <mesh position={[0, b.h + 0.01, 0]}>
              <boxGeometry args={[b.w * 0.86, 0.03, b.d * 0.86]} />
              <meshStandardMaterial color="#5f6c6e" roughness={0.7} transparent opacity={dimmed ? 0.3 : 1} />
            </mesh>
          </>
        ) : null}
        <RoundedBox args={[b.w, low ? 0.3 : b.h, b.d]} radius={0.03} smoothness={2} position={[0, (low ? 0.3 : b.h) / 2, 0]}>
          <meshStandardMaterial color={base} roughness={0.6} metalness={0.15} transparent opacity={dimmed ? 0.3 : 1} emissive={selected ? "#176c5b" : status === "normal" ? "#000000" : STATUS_COLOR[status]} emissiveIntensity={selected ? 0.35 : status === "normal" ? 0 : 0.25} />
        </RoundedBox>
        </>
      )}
    </group>
  );
}

const TOOL: Record<string, ToolKind> = { spindle: "spindle", scanner: "scanner", torch: "torch" };
const ROLE_TOOL: Record<string, ToolKind> = { machining: "spindle", inspection_inprocess: "scanner", welding: "torch" };

/*
 * What the three cell robots do on the part. They hold tools, not parts: the part sits in its tray on the fixture and
 * the tool goes to the real work points on it. Coordinates are in the tray's own frame (metres, see workpieces.ts):
 * the four brackets lie at x = -0.1 / 0.1 and z = -0.02 / 0.1.
 */
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
/** one hole per bracket (machining) */
const HOLES: [number, number][] = [[-0.06, 0.0], [0.14, 0.0], [-0.06, 0.12], [0.14, 0.12]];
/** where the tool is for a given phase of the cycle: tray-frame x and z, height above the part, and whether the tool is working */
function workPoint(tool: ToolKind, p: number): { lx: number; lz: number; lift: number; on: boolean } {
  if (tool === "spindle") {
    const n = HOLES.length;
    const seg = Math.min(n - 1, Math.floor(p * n));
    const u = p * n - seg;
    const prev = seg > 0 ? HOLES[seg - 1] : [0, 0.04];
    const cur = HOLES[seg];
    const go = smooth(u / 0.3);
    const down = smooth((u - 0.3) / 0.15) - smooth((u - 0.75) / 0.2);
    return { lx: prev[0] + (cur[0] - prev[0]) * go, lz: prev[1] + (cur[1] - prev[1]) * go, lift: 0.17 * (1 - down), on: down > 0.4 };
  }
  if (tool === "scanner") {
    // a raster over the whole tray, the beam on all the time
    const tri = Math.abs(((p * 3) % 2) - 1);
    return { lx: (tri - 0.5) * 0.4, lz: -0.07 + p * 0.26, lift: 0.2, on: true };
  }
  // torch: the seam between the two brackets of each column, one after the other
  const first = p < 0.5;
  const u = first ? p / 0.5 : (p - 0.5) / 0.5;
  const x0 = first ? -0.18 : 0.02;
  const lead = smooth(u / 0.12);
  const along = smooth((u - 0.12) / 0.76);
  const out = 1 - smooth((u - 0.9) / 0.1);
  return { lx: x0 + 0.16 * along, lz: 0.04, lift: 0.14 * (1 - lead * out) + 0.02, on: lead * out > 0.9 && along > 0.01 };
}
const SPARKS = 64;

type JointSpan = { min: number[]; max: number[]; far: number; over: number; n: number };

/** Debug only (?debug): the axis angles the arm actually uses, in ABB's own convention, to compare with the datasheet ranges. */
function recordJoints(all: Record<string, JointSpan>, id: string, q: number[], tip: [number, number, number], g: ArmGeo = ARM) {
  const deg = [q[0], q[1], q[2] - Math.PI / 2, q[3], q[4], q[5]].map((r) => (r * 180) / Math.PI);
  const sp = (all[id] ??= { min: deg.slice(), max: deg.slice(), far: 0, over: 0, n: 0 });
  deg.forEach((d, i) => ((sp.min[i] = Math.min(sp.min[i], d)), (sp.max[i] = Math.max(sp.max[i], d))));
  const r = Math.hypot(tip[0], tip[2]) - g.OFF;
  const h = tip[1] + g.T - g.SH;
  const miss = Math.hypot(r, h) - (g.A + g.B - 0.02);
  if (miss > 0) {
    sp.far++;
    sp.over = Math.max(sp.over, miss);
  }
  sp.n++;
}

function Robot({ e, mats, selected, dimmed, status, masked, sim, onSelect, onFocus, onHover }: { e: Instance; mats: ArmMats; selected: boolean; dimmed: boolean; status: Status; masked: boolean; sim: React.MutableRefObject<PlantSim>; onSelect: (id: string) => void; onFocus: (id: string) => void; onHover: (id: string | null) => void }) {
  const handle = useRef<ArmHandle | null>(null);
  const lod = useNear(e.position_m.x, 1, e.position_m.y, Infinity, 11);
  const [hover, setHover] = useState(false);
  const tool = ROLE_TOOL[e.process_step ?? ""] ?? TOOL.spindle;
  // every robot is drawn from the GLB model (GlbArm.tsx); the primitive arm only stands in while the file loads
  const geo: ArmGeo = ROBOT_MODEL.arm;
  const q = useRef([0, 0, 0, 0, 0, 0]);
  const blend = useRef(0);
  const spin = useRef(0);
  const cell = useMemo(() => fixtureFor(e), [e]);
  const tip = useRef<[number, number, number]>([0, 1.3, 0.95]);
  const sparks = useRef<THREE.InstancedMesh>(null);
  /** the weld seams on the tray: the two seams grow behind the torch and a glowing tip follows it */
  const bead = useRef<THREE.Group>(null);
  const seams = useRef<(THREE.Mesh | null)[]>([null, null]);
  const tipGlow = useRef<THREE.Mesh>(null);
  const spark = useRef(Array.from({ length: SPARKS }, () => ({ x: 0, y: -9, z: 0, vx: 0, vy: 0, vz: 0, life: 0 })));
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useLayoutEffect(() => {
    solveIK(0, 1.3, 0.95, 0, q.current, geo); // home pose above the belt side
    handle.current?.apply(q.current, 1);
  }, [geo]);
  useFrame((st, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const a = sim.current.robotAct(e);
    if (a?.status === "abnormal") return; // a stopped robot freezes where it is
    const busy = a?.busy ?? false;
    blend.current += ((busy ? 1 : 0) - blend.current) * Math.min(1, dt * 2.5);
    const k = blend.current;
    // the tray that stopped at this robot's fixture: the work points are on it, wherever it came to rest
    const tray = cell ? sim.current.tokens.find((t) => t.phase === "proc" && t.node === cell.id) : undefined;
    const cx = (tray ? tray.px : e.position_m.x) - e.position_m.x;
    const cz = (tray ? tray.pz : e.position_m.y + 1.8) - e.position_m.y;
    const rot = tray ? (tray.r0 ?? tray.rot) : Math.PI / 2; // the heading it arrived with: the positioner turns the tray only after the work
    const topY = (tray ? tray.y : 0.73) + 0.01; // upper face of the part: its plates lie on the tray floor, level with the carrier
    // the positioner turns its table from 0.85 on, so the weld must be finished by then
    const span = cell?.type === "positioner_2station" ? 0.79 : 0.88;
    const w = workPoint(tool, clamp01(((a?.progress ?? 0) - 0.06) / span));
    const wx = cx + w.lx * Math.cos(rot) + w.lz * Math.sin(rot);
    const wz = cz - w.lx * Math.sin(rot) + w.lz * Math.cos(rot);
    const wy = topY + w.lift;
    // follow the work point smoothly, and fall back to the home pose when the machine is idle
    const goal: [number, number, number] = [wx * k, 1.3 + (wy - 1.3) * k, 0.95 + (wz - 0.95) * k];
    const f = Math.min(1, dt * 9);
    tip.current = [tip.current[0] + (goal[0] - tip.current[0]) * f, tip.current[1] + (goal[1] - tip.current[1]) * f, tip.current[2] + (goal[2] - tip.current[2]) * f];
    solveIK(tip.current[0], tip.current[1], tip.current[2], 0, q.current, geo);
    const dbg = (window as unknown as { __kfc?: { joints?: Record<string, JointSpan> } }).__kfc;
    if (dbg) recordJoints((dbg.joints ??= {}), e.id, q.current, tip.current, geo);
    const working = busy && w.on && k > 0.6;
    if (bead.current) {
      const pp = clamp01(((a?.progress ?? 0) - 0.06) / span);
      const show = tool === "torch" && !!tray && busy && k > 0.3;
      bead.current.visible = show;
      if (show && tray) {
        bead.current.position.set(tray.x, tray.y + 0.012, tray.z); // rides with the tray when the table turns
        bead.current.rotation.y = tray.rot;
        const l1 = pp < 0.5 ? clamp01((w.lx + 0.18) / 0.16) : 1;
        const l2 = pp < 0.5 ? 0 : clamp01((w.lx - 0.02) / 0.16);
        [l1, l2].forEach((l, i) => {
          const m = seams.current[i];
          if (!m) return;
          m.visible = l > 0.02;
          m.scale.x = Math.max(0.001, l);
          m.position.x = (i === 0 ? -0.18 : 0.02) + 0.08 * l;
        });
        if (tipGlow.current) {
          tipGlow.current.visible = working;
          tipGlow.current.position.set(w.lx, 0.004, 0.04);
        }
      }
    }
    spin.current += dt * 40 * (working ? 1 : 0.15) * k;
    const fx = tool === "spindle" ? { spin: spin.current } : tool === "torch" ? { glow: working ? 0.6 + Math.random() * 0.4 : 0 } : tool === "scanner" ? { beam: working || (busy && k > 0.6) ? 1 : 0 } : undefined;
    handle.current?.apply(q.current, 1, fx);

    // sparks from the torch tip, chips from the spindle
    const m = sparks.current;
    if (m) {
      const list = spark.current;
      const emit = working && tool !== "scanner";
      for (let i = 0; i < SPARKS; i++) {
        const sp = list[i];
        if (sp.life <= 0 && emit && Math.random() < dt * 22) {
          sp.life = 0.25 + Math.random() * 0.3;
          sp.x = e.position_m.x + tip.current[0];
          sp.y = tip.current[1] - 0.04;
          sp.z = e.position_m.y + tip.current[2];
          const ang = Math.random() * Math.PI * 2;
          const v = tool === "torch" ? 0.9 : 0.5;
          sp.vx = Math.cos(ang) * v * Math.random();
          sp.vz = Math.sin(ang) * v * Math.random();
          sp.vy = 0.7 + Math.random() * 0.9;
        }
        if (sp.life > 0) {
          sp.life -= dt;
          sp.vy -= 3.2 * dt;
          sp.x += sp.vx * dt;
          sp.y += sp.vy * dt;
          sp.z += sp.vz * dt;
          dummy.position.set(sp.x, Math.max(sp.y, topY), sp.z);
          dummy.scale.setScalar(sp.life > 0 ? 1 : 0);
        } else {
          dummy.position.set(0, -9, 0);
          dummy.scale.setScalar(0);
        }
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <group position={[0, 0, 0]} visible onPointerOver={(ev) => (ev.stopPropagation(), setHover(true), onHover(e.id))} onPointerOut={() => (setHover(false), onHover(null))}>
      <Suspense fallback={<IndustrialArm mats={mats} handle={handle} tool={tool} position={[e.position_m.x, 0, e.position_m.y]} onClick={() => onSelect(e.id)} onDoubleClick={() => onFocus(e.id)} status={status} />}>
        <GlbArm mats={mats} handle={handle} tool={tool} position={[e.position_m.x, 0, e.position_m.y]} onClick={() => onSelect(e.id)} onDoubleClick={() => onFocus(e.id)} status={status} />
      </Suspense>
      {tool === "torch" ? (
        <group ref={bead} visible={false} userData={{ noCast: true }}>
          {[0, 1].map((i) => (
            <mesh key={i} ref={(el) => void (seams.current[i] = el)} position={[i === 0 ? -0.1 : 0.1, 0, 0.04]}>
              <boxGeometry args={[0.16, 0.009, 0.016]} />
              <meshStandardMaterial color="#6f7d89" roughness={0.35} metalness={0.8} emissive="#ff7a2a" emissiveIntensity={0.25} />
            </mesh>
          ))}
          <mesh ref={tipGlow} visible={false}>
            <boxGeometry args={[0.035, 0.014, 0.024]} />
            <meshStandardMaterial color="#fff2cf" emissive="#ff9a3c" emissiveIntensity={4} toneMapped={false} />
          </mesh>
        </group>
      ) : null}
      {tool !== "scanner" ? (
        <instancedMesh ref={sparks} args={[undefined, undefined, SPARKS]} frustumCulled={false} userData={{ noCast: true }}>
          <boxGeometry args={[0.011, 0.011, 0.011]} />
          <meshBasicMaterial color={tool === "torch" ? "#ffd27a" : "#cfd6d8"} />
        </instancedMesh>
      ) : null}
      {lod >= 2 || selected || hover ? <ModelTag at={[e.position_m.x, 2.6, e.position_m.y]} status={status} masked={masked} /> : null}
      {selected ? (
        <mesh rotation-x={-Math.PI / 2} position={[e.position_m.x, 0.01, e.position_m.y]}>
          <ringGeometry args={[0.7, 0.78, 48]} />
          <meshBasicMaterial color="#176c5b" transparent opacity={dimmed ? 0.3 : 0.9} />
        </mesh>
      ) : null}
    </group>
  );
}

/** Carriers moving through the line, straight from the simulation. Off the belt a carrier rides on an autonomous transfer cart. */
const POOL = 48;
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const QY = new THREE.Quaternion();
const GHOSTS = 6;
/** The transfer carts and stock AGVs are drawn this much larger than the MiR250 footprint so they read in the overview. Display only: the profile size is unchanged. */
const CART_SCALE = 1.35;
/** The transfer carts raise their roller deck on a lift column to the line's belt height, so a tray rolls over from cart to belt level. */
const CART_LIFT = BELT_TOP / CART_SCALE - 0.306;
function Carriers({ sim }: { sim: React.MutableRefObject<PlantSim> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const carts = useRef<(THREE.Group | null)[]>([]);
  const ghostCarts = useRef<(THREE.Group | null)[]>([]);
  const parts = useRef<(THREE.Mesh | null)[]>([]);
  const trays = useRef<(THREE.Mesh | null)[]>([]);
  const cartons = useRef<(THREE.Mesh | null)[]>([]);
  const last = useRef<number[]>(Array.from({ length: POOL }, () => -1));
  // what a carrier holds depends on the last machine that worked on it (see workpieces.ts)
  const geos = useMemo(() => ({ stages: stageGeometries(), tray: trayGeometry(), carton: cartonGeometry() }), []);
  const partMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 }), []);
  const plasticMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }), []);
  useFrame(() => {
    const ks = sim.current.tokens;
    for (let i = 0; i < POOL; i++) {
      const g = refs.current[i];
      if (!g) continue;
      const k = ks[i];
      g.visible = !!k && !k.hidden;
      const cart0 = carts.current[i];
      if (!k) {
        if (cart0) cart0.visible = false;
        continue;
      }
      g.position.set(k.x, k.y, k.z);
      if (k.pitch) {
        // yaw first, then tip about the world x axis: the tray lies on the inclined belt
        g.quaternion.setFromAxisAngle(AXIS_X, k.pitch).multiply(QY.setFromAxisAngle(AXIS_Y, k.rot));
      } else {
        g.rotation.set(0, k.rot, 0);
      }
      // the cart stands on the floor by itself: it follows the carrier on a cart leg and waits at the dock while the carrier is inside
      const c = cart0;
      if (c) {
        c.visible = k.cart;
        c.position.set(k.cx, 0, k.cz);
        c.rotation.y = k.cr;
      }
      const stage = stageOf(k);
      if (stage !== last.current[i]) {
        last.current[i] = stage;
        const packed = stage >= STAGES - 1;
        const p = parts.current[i];
        if (p) {
          p.visible = !packed;
          if (!packed) p.geometry = geos.stages[stage];
        }
        const t = trays.current[i];
        if (t) t.visible = !packed;
        const b = cartons.current[i];
        if (b) b.visible = packed;
      }
    }
    const gs = sim.current.ghosts;
    for (let i = 0; i < GHOSTS; i++) {
      const c = ghostCarts.current[i];
      if (!c) continue;
      const g = gs[i];
      c.visible = !!g;
      if (g) {
        c.position.set(g.x, 0, g.z);
        c.rotation.y = g.rot;
        c.scale.setScalar(CART_SCALE * Math.max(0.001, g.fade));
      }
    }
  });
  return (
    <>
      {Array.from({ length: GHOSTS }, (_, i) => (
        <group key={`gh${i}`} ref={(el) => void (ghostCarts.current[i] = el)} scale={CART_SCALE} visible={false}>
          <AgvDetail opacity={1} lift={CART_LIFT} />
        </group>
      ))}
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i} ref={(el) => void (refs.current[i] = el)} visible={false}>
          {/* grey tray with the part on it; the brown carton only exists once the part is packed */}
          <mesh ref={(el) => void (trays.current[i] = el)} geometry={geos.tray} material={plasticMat} position={[0, -0.05, 0]} />
          <mesh ref={(el) => void (parts.current[i] = el)} geometry={geos.stages[0]} material={partMat} position={[0, -0.05, 0]} />
          <mesh ref={(el) => void (cartons.current[i] = el)} geometry={geos.carton} material={plasticMat} position={[0, -0.05, 0]} visible={false} />
        </group>
      ))}
      {Array.from({ length: POOL }, (_, i) => (
        <group key={`ct${i}`} ref={(el) => void (carts.current[i] = el)} scale={CART_SCALE} visible={false}>
          <AgvDetail opacity={1} lift={CART_LIFT} />
        </group>
      ))}
    </>
  );
}

/** The stock-lane cart: drives errands (see AgvRunner) and carries a pallet on its way back and forth. */
function Agv({ sim, id, opacity }: { sim: React.MutableRefObject<PlantSim>; id: string; opacity: number }) {
  const g = useRef<THREE.Group>(null);
  const full = useRef<THREE.Mesh>(null);
  const empty = useRef<THREE.Mesh>(null);
  const fullMat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    const a = sim.current.agvs.find((v) => v.id === id);
    if (!g.current || !a) return;
    fullMat.current?.color.set(a.role === "in" ? "#aab4b7" : "#c9b27c"); // blanks from the receiving stock, or cartons from packing
    g.current.position.set(a.x, 0, a.z);
    g.current.rotation.y = a.rot;
    if (full.current) full.current.visible = a.payload === "full";
    if (empty.current) empty.current.visible = a.payload === "empty";
  });
  return (
    <group ref={g} scale={CART_SCALE}>
      <AgvDetail opacity={opacity} />
      <mesh ref={full} position={[0, 0.43, 0]} visible={false}>
        <boxGeometry args={[0.7, 0.24, 0.5]} />
        <meshStandardMaterial ref={fullMat} color="#c9b27c" roughness={0.8} />
      </mesh>
      <mesh ref={empty} position={[0, 0.35, 0]} visible={false}>
        <boxGeometry args={[0.7, 0.07, 0.5]} />
        <meshStandardMaterial color="#8a6f45" roughness={0.8} />
      </mesh>
    </group>
  );
}

/** Advances the simulation with the render clock. */
function SimDriver({ sim, ctl, statuses }: { sim: React.MutableRefObject<PlantSim>; ctl: React.MutableRefObject<{ running: boolean; scale: number }>; statuses: React.MutableRefObject<Record<string, Resolved>> }) {
  useFrame((_, rawDt) => {
    if (!ctl.current.running) return;
    const dt = Math.min(rawDt, 0.05);
    sim.current.advance(dt * ctl.current.scale, statuses.current);
    sim.current.stepAgvs(dt, ctl.current.scale); // the carts are part of the plant: they keep up with the stocks at any speed
  });
  return null;
}

const Scene = memo(function Scene({
  tokens,
  selectedId,
  colorBy,
  show,
  statuses,
  sim,
  simCtl,
  statusRef,
  env,
  onSelect,
  onFocus,
  camApi,
  onHover,
  masked,
  zoomRef,
  tex,
  real,
  cine,
  nav,
  onNav,
}: {
  tokens: Tokens;
  selectedId: string | null;
  colorBy: "category" | "evidence" | "neutral";
  statuses: Record<string, Resolved>;
  sim: React.MutableRefObject<PlantSim>;
  simCtl: React.MutableRefObject<{ running: boolean; scale: number }>;
  statusRef: React.MutableRefObject<Record<string, Resolved>>;
  env: boolean;
  show: Record<"cooling" | "power" | "air" | "gas" | "exhaust" | "bundle", boolean>;
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
  camApi: React.MutableRefObject<CamApi | null>;
  onHover: (id: string | null) => void;
  /** a drill is running and the level of a fault must not show (stack lights included) */
  masked: boolean;
  /** the HUD element that shows how far in or out the camera is */
  zoomRef: React.RefObject<HTMLSpanElement | null>;
  /** surface textures on the machines that have them */
  tex: boolean;
  /** realistic shading: softbox reflections, clear coat, ambient occlusion, bloom */
  real: boolean;
  /** the dark machine-shop look on top of the realistic shading */
  cine: boolean;
  /** how the camera is moved */
  nav: NavMode;
  /** the scene asks for another mode (leaving the walk when a HUD button needs the orbit camera) */
  onNav: (m: NavMode) => void;
}) {
  const mats = useMats(tokens, real);
  const maskRef = useRef(masked);
  maskRef.current = masked;
  const scene = useThree((s) => s.scene);
  const lines = LINES;
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const B = profile.factory.building_m;

  // equipment touching the selection through a connection
  const related = useMemo(() => {
    const set = new Set<string>();
    if (!selectedId) return set;
    set.add(selectedId);
    for (const c of profile.connections) {
      if (c.from === selectedId) set.add(c.to);
      if (c.to === selectedId) set.add(c.from);
    }
    return set;
  }, [selectedId]);

  // deep link: /lab/plant?focus=<equipment id> starts the camera on that machine
  const camera = useThree((st) => st.camera);
  useLayoutEffect(() => {
    const id = new URLSearchParams(window.location.search).get("focus");
    const e = id ? equipmentById(id) : null;
    if (!e) return;
    let tries = 0;
    let timer = 0;
    const apply = () => {
      const c = controls.current;
      if (!c) {
        if (tries++ < 50) timer = window.setTimeout(apply, 100);
        return;
      }
      const b = box(e);
      const dist = Math.max(b.w, b.d) * 1.1 + 13;
      c.target.set(b.cx, b.h / 2, b.cy);
      camera.position.set(b.cx + dist * 0.35, b.h + dist * 0.55, b.cy + dist);
      c.update();
    };
    apply();
    return () => window.clearTimeout(timer);
  }, [camera]);

  // camera moves for the HUD buttons and double-click: fly to a machine, back to the whole line, step in or out
  const anim = useRef<{ t: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3 } | null>(null);
  useLayoutEffect(() => {
    const flyTo = (toT: THREE.Vector3, toP: THREE.Vector3) => {
      const c = controls.current;
      if (c) anim.current = { t: 0, fromT: c.target.clone(), toT, fromP: camera.position.clone(), toP };
    };
    // the HUD moves and zooms the orbit camera: in the walk it first hands the camera back to the orbit mode
    const guard = () => {
      if (navRef.current !== "walk") return false;
      onNavRef.current("orbit");
      return true;
    };
    camApi.current = {
      focus(id) {
        if (guard()) return;
        const e = equipmentById(id);
        const c = controls.current;
        if (!e || !c) return;
        const b = box(e);
        const toT = new THREE.Vector3(b.cx, b.h / 2, b.cy);
        // keep the angle the user is looking from, but never closer to flat than 0.4 of the way up
        const dir = camera.position.clone().sub(c.target).normalize();
        dir.y = Math.max(dir.y, 0.4);
        dir.normalize();
        flyTo(toT, toT.clone().addScaledVector(dir, Math.max(4.5, Math.max(b.w, b.d) * 1.4 + b.h * 1.2 + 3)));
      },
      home() {
        if (guard()) return;
        flyTo(new THREE.Vector3(B.w / 2, 0, B.d / 2 - 3), new THREE.Vector3(B.w / 2 + 6, 42, B.d + 56));
      },
      pose(px, py, pz, tx, ty, tz) {
        if (guard()) return;
        flyTo(new THREE.Vector3(tx, ty, tz), new THREE.Vector3(px, py, pz));
      },
      at(x, y, z, dist) {
        if (guard()) return;
        const c = controls.current;
        if (!c) return;
        const toT = new THREE.Vector3(x, y, z);
        const dir = camera.position.clone().sub(c.target).normalize();
        dir.y = Math.max(dir.y, 0.4);
        dir.normalize();
        flyTo(toT, toT.clone().addScaledVector(dir, dist));
      },
      zoom(f) {
        if (guard()) return;
        const c = controls.current;
        if (!c) return;
        const off = camera.position.clone().sub(c.target);
        const len = THREE.MathUtils.clamp(off.length() * f, c.minDistance, c.maxDistance);
        flyTo(c.target.clone(), c.target.clone().addScaledVector(off.normalize(), len));
      },
    };
    return () => {
      camApi.current = null;
    };
  }, [camApi, camera, B.w, B.d]);
  // ── how the camera is moved ──
  const navRef = useRef(nav);
  navRef.current = nav;
  const onNavRef = useRef(onNav);
  onNavRef.current = onNav;
  const gl = useThree((st) => st.gl);
  const keys = useRef(new Set<string>());
  const look = useRef({ x: B.w / 2, y: 1.6, z: B.d / 2, yaw: 0, pitch: -0.06 });
  const orbitAt = useRef(new THREE.Vector3(B.w / 2, 0, B.d / 2 - 3));
  const prevNav = useRef<NavMode>(nav);
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || navRef.current === "orbit") return;
      const k = e.key.toLowerCase();
      if (k === "escape" && navRef.current === "walk") {
        onNavRef.current("orbit");
        return;
      }
      if (["w", "a", "s", "d", "q", "e", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        keys.current.add(k);
        if (k.startsWith("arrow")) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);
  // walk: drag to look around, wheel to step forward and back
  useEffect(() => {
    if (nav !== "walk") return;
    const el = gl.domElement;
    let drag: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const pm = (e: PointerEvent) => {
      if (!drag) return;
      look.current.yaw -= (e.clientX - drag.x) * 0.0045;
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - (e.clientY - drag.y) * 0.0045, -1.3, 1.3);
      drag = { x: e.clientX, y: e.clientY };
    };
    const pu = () => (drag = null);
    const wh = (e: WheelEvent) => {
      e.preventDefault();
      const l = look.current;
      const step = -e.deltaY * 0.01;
      l.x += -Math.sin(l.yaw) * step;
      l.z += -Math.cos(l.yaw) * step;
    };
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    el.addEventListener("pointercancel", pu);
    el.addEventListener("wheel", wh, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerup", pu);
      el.removeEventListener("pointercancel", pu);
      el.removeEventListener("wheel", wh);
    };
  }, [nav, gl]);
  // depth precision: a very near plane makes far surfaces that lie almost in one plane flicker (and the ambient-occlusion pass paint black).
  // Only the walk needs to get close to things; the orbit and slide views never come nearer than 1 m.
  useLayoutEffect(() => {
    const near = nav === "walk" ? 0.05 : 0.3;
    if (camera.near !== near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }, [nav, camera]);
  // switching in and out of the walk
  useLayoutEffect(() => {
    const was = prevNav.current;
    prevNav.current = nav;
    if (nav === "walk" && was !== "walk") {
      // stand where the orbit camera was looking, facing the way it faced
      const dir = orbitAt.current.clone().sub(camera.position);
      const l = look.current;
      l.x = THREE.MathUtils.clamp(orbitAt.current.x, 0, B.w);
      l.z = THREE.MathUtils.clamp(orbitAt.current.z, 0, B.d);
      l.y = 1.6;
      l.yaw = Math.atan2(-dir.x, -dir.z);
      l.pitch = -0.06;
      camera.rotation.order = "YXZ";
    } else if (nav !== "walk" && was === "walk") {
      // back to the orbit: look at the floor ten metres ahead from where we stand
      const l = look.current;
      const ahead = new THREE.Vector3(l.x - Math.sin(l.yaw) * 10, 0.5, l.z - Math.cos(l.yaw) * 10);
      let tries = 0;
      const apply = () => {
        const c = controls.current;
        if (!c) {
          if (tries++ < 20) requestAnimationFrame(apply);
          return;
        }
        c.target.copy(ahead);
        c.update();
      };
      camera.rotation.order = "XYZ";
      apply();
    }
  }, [nav, camera, B.w, B.d]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.25); // real time, so walking speed does not depend on the frame rate
    const k = keys.current;
    const l = look.current;
    if (navRef.current === "walk") {
      const sp = (k.has("shift") ? 7 : 2.6) * dt;
      const fwd = (k.has("w") ? 1 : 0) - (k.has("s") ? 1 : 0) + (k.has("arrowup") ? 1 : 0) - (k.has("arrowdown") ? 1 : 0);
      const side = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);
      l.yaw += ((k.has("arrowleft") ? 1 : 0) - (k.has("arrowright") ? 1 : 0)) * 1.6 * dt;
      const fx = -Math.sin(l.yaw);
      const fz = -Math.cos(l.yaw);
      l.x = THREE.MathUtils.clamp(l.x + (fx * fwd + -fz * side) * sp, -2, B.w + 2);
      l.z = THREE.MathUtils.clamp(l.z + (fz * fwd + fx * side) * sp, -2, B.d + 2);
      l.y = THREE.MathUtils.clamp(l.y + ((k.has("e") ? 1 : 0) - (k.has("q") ? 1 : 0)) * sp, 0.5, 6);
      camera.position.set(l.x, l.y, l.z);
      camera.rotation.set(l.pitch, l.yaw, 0, "YXZ");
      return;
    }
    const c = controls.current;
    if (!c) return;
    orbitAt.current.copy(c.target);
    if (navRef.current === "pan" && k.size) {
      // slide along the floor in the direction the camera faces
      const dir = c.target.clone().sub(camera.position);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) return;
      dir.normalize();
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      const fwd = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
      const side = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      if (!fwd && !side) return;
      const dist = camera.position.distanceTo(c.target);
      const mv = dir.multiplyScalar(fwd).addScaledVector(right, side).multiplyScalar(Math.max(2, dist * 0.7) * dt * (k.has("shift") ? 2.5 : 1));
      camera.position.add(mv);
      c.target.add(mv);
      c.update();
    }
  });
  // cinematic look: the blur is focused on what the orbit camera looks at, and only comes in when the camera is close to it
  const dof = useRef<DepthOfFieldEffect>(null);
  useFrame(() => {
    const e = dof.current;
    const c = controls.current;
    if (!e || !c) return;
    const dist = camera.position.distanceTo(c.target);
    const want = cine && selectedId && dist < 30 ? 2.4 * (1 - dist / 30) + 0.6 : 0;
    e.bokehScale += (want - e.bokehScale) * 0.1;
    e.circleOfConfusionMaterial.worldFocusDistance = dist;
    e.circleOfConfusionMaterial.worldFocusRange = Math.max(2, dist * 0.6);
  });
  // zoom readout: camera distance against the opening view (100%), and the same as a magnification
  useFrame(() => {
    const c = controls.current;
    const el = zoomRef.current;
    if (!c || !el) return;
    const r = camera.position.distanceTo(c.target) / HOME_DIST;
    const text = `${Math.round(r * 100)}% · ×${(1 / r).toFixed(1)}`;
    if (el.textContent !== text) el.textContent = text;
  });
  useFrame((_, dt) => {
    const a = anim.current;
    const c = controls.current;
    if (!a || !c) return;
    a.t = Math.min(1, a.t + dt / 0.7);
    const k = 1 - Math.pow(1 - a.t, 3);
    c.target.lerpVectors(a.fromT, a.toT, k);
    camera.position.lerpVectors(a.fromP, a.toP, k);
    c.update();
    if (a.t >= 1) anim.current = null;
  });

  useLayoutEffect(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.noCast) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }, [scene]);

  return (
    <>
      <color attach="background" args={[cine ? "#07090b" : tokens.bg]} />
      <hemisphereLight args={cine ? ["#9db4cc", "#05070a", 0.1] : ["#ffffff", tokens.floor, real ? 0.3 : 0.7]} />
      <directionalLight castShadow color={cine ? "#e6eeff" : "#ffffff"} position={[18, 24, 26]} intensity={cine ? 0.9 : real ? 1.25 : 1.7} shadow-mapSize={real ? [4096, 4096] : [2048, 2048]} shadow-bias={-0.0005} shadow-normalBias={0.03}>
        <orthographicCamera attach="shadow-camera" args={[-34, 34, 18, -18, 1, 90]} />
      </directionalLight>
      {cine ? (
        /* machine-shop product shot: a nearly black room, one big overhead softbox, long strip lights at different angles that run down the metal, a cool fill, and flags to keep the contrast */
        <Environment resolution={512} frames={1}>
          <mesh scale={90}>
            <sphereGeometry args={[1, 32, 16]} />
            <meshBasicMaterial color="#0b0f13" side={THREE.BackSide} toneMapped={false} />
          </mesh>
          <mesh position={[0, -8, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[200, 200]} />
            <meshBasicMaterial color="#12171c" toneMapped={false} />
          </mesh>
          <Lightformer form="rect" intensity={5} position={[0, 14, 0]} rotation-x={Math.PI / 2} scale={[34, 14, 1]} />
          <Lightformer form="rect" color="#a8c4ff" intensity={2.6} position={[-22, 5, 4]} rotation-y={Math.PI / 2.2} scale={[14, 5, 1]} />
          <Lightformer form="rect" color="#fff1de" intensity={3.2} position={[22, 7, -4]} rotation-y={-Math.PI / 2.2} scale={[10, 4, 1]} />
          <Lightformer form="rect" intensity={7} position={[0, 3, -22]} scale={[44, 0.6, 1]} />
          {[-16, -7, 3, 12].map((x) => (
            <Lightformer key={x} form="rect" intensity={9} position={[x, 10, 12]} rotation-x={Math.PI / 2.2} scale={[0.7, 20, 1]} />
          ))}
          {[-9, 9].map((x) => (
            <mesh key={x} position={[x, 7, 0]} rotation-x={Math.PI / 2}>
              <planeGeometry args={[7, 40]} />
              <meshBasicMaterial color="#000000" />
            </mesh>
          ))}
        </Environment>
      ) : real ? (
        /* a photo-studio style environment: a big overhead softbox, long strip lights that leave streaks on metal, and dark flags for contrast */
        <Environment resolution={512} frames={1}>
          {/* a mid-grey room around everything, so metal reflects a gradient and not a black sky */}
          <mesh scale={90}>
            <sphereGeometry args={[1, 32, 16]} />
            <meshBasicMaterial color="#9aa3a8" side={THREE.BackSide} toneMapped={false} />
          </mesh>
          <mesh position={[0, -8, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[200, 200]} />
            <meshBasicMaterial color="#59616a" toneMapped={false} />
          </mesh>
          <Lightformer form="rect" intensity={3.4} position={[0, 14, 0]} rotation-x={Math.PI / 2} scale={[40, 16, 1]} />
          <Lightformer form="rect" intensity={2.4} position={[-20, 6, 6]} rotation-y={Math.PI / 2.3} scale={[16, 6, 1]} />
          <Lightformer form="rect" intensity={2.4} position={[20, 6, -6]} rotation-y={-Math.PI / 2.3} scale={[16, 6, 1]} />
          <Lightformer form="rect" intensity={4.5} position={[0, 3, -22]} scale={[44, 0.9, 1]} />
          {[-14, -4, 6, 16].map((x) => (
            <Lightformer key={x} form="rect" intensity={5.5} position={[x, 10, 12]} rotation-x={Math.PI / 2.2} scale={[1.1, 20, 1]} />
          ))}
          {[-9, 9].map((x) => (
            <mesh key={x} position={[x, 7, 0]} rotation-x={Math.PI / 2}>
              <planeGeometry args={[7, 40]} />
              <meshBasicMaterial color="#000000" />
            </mesh>
          ))}
        </Environment>
      ) : (
        <Environment resolution={128} frames={1}>
          <Lightformer intensity={1.8} position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[40, 20, 1]} />
          <Lightformer intensity={0.7} position={[-20, 4, 10]} rotation-y={Math.PI / 3} scale={[20, 6, 1]} />
        </Environment>
      )}
      {real ? (
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={cine ? 0.8 : 1.1} distanceFalloff={1.3} intensity={cine ? 5 : 3.6} quality="medium" halfRes />
          <Bloom mipmapBlur luminanceThreshold={cine ? 0.8 : 0.95} intensity={cine ? 0.6 : 0.35} radius={0.6} />
          {cine ? <DepthOfField ref={dof} bokehScale={0} focalLength={0.05} height={480} /> : <></>}
          <SMAA />
          <ToneMapping mode={cine ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC} />
          {cine ? <Vignette offset={0.25} darkness={0.7} /> : <></>}
        </EffectComposer>
      ) : null}

      {/* floor + building footprint + utility strip */}
      <mesh rotation-x={-Math.PI / 2} position={[B.w / 2, -0.002, B.d / 2]} receiveShadow userData={{ noCast: true }} onClick={() => onSelect(null)}>
        <planeGeometry args={[B.w + 12, B.d + 12]} />
        <meshStandardMaterial color={cine ? "#101519" : tokens.floor} roughness={cine ? 0.32 : real ? 0.65 : 0.9} envMapIntensity={cine ? 0.9 : real ? 0.35 : 1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[B.w / 2, 0.004, B.d / 2]} userData={{ noCast: true }}>
        <planeGeometry args={[B.w, B.d]} />
        <meshStandardMaterial color={cine ? "#1a2127" : "#f4f7f6"} roughness={cine ? 0.38 : real ? 0.6 : 0.95} envMapIntensity={cine ? 0.8 : real ? 0.35 : 1} transparent opacity={cine ? 0.95 : 0.82} />
      </mesh>
      {profile.factory.utility_strip_depth_m ? (
        <mesh rotation-x={-Math.PI / 2} position={[B.w / 2, 0.006, profile.factory.utility_strip_depth_m / 2]} userData={{ noCast: true }}>
          <planeGeometry args={[B.w, profile.factory.utility_strip_depth_m]} />
          <meshStandardMaterial color="#e6eeea" roughness={0.95} transparent opacity={0.82} />
        </mesh>
      ) : null}
      {/* trench strips (the lines run below the floor) */}
      {profile.routes
        .filter((r) => r.kind === "trench")
        .map((r) => {
          const cs = profile.connections.filter((c) => c.route === r.id);
          const xs = [...cs.map((c) => box(equipmentById(c.to)!).cx + (c.drop_offset_m ?? 0)), ...cs.map((c) => box(equipmentById(c.from)!).cx)];
          const x0 = Math.min(...xs);
          const x1 = Math.max(...xs);
          return (
            <mesh key={r.id} rotation-x={-Math.PI / 2} position={[(x0 + x1) / 2, 0.012, r.polyline_m[0][1]]} userData={{ noCast: true }}>
              <planeGeometry args={[x1 - x0, 0.6]} />
              <meshBasicMaterial color="#8a9a96" transparent opacity={0.45} />
            </mesh>
          );
        })}
      {env ? <FactoryShell w={B.w} d={B.d} /> : null}
      <FootprintOutlines />

      {/* building outline */}
      {[
        [B.w / 2, 0, B.w, 0.08],
        [B.w / 2, B.d, B.w, 0.08],
      ].map(([x, z, w, d], i) => (
        <mesh key={`wx${i}`} position={[x, 0.04, z]} userData={{ noCast: true }}>
          <boxGeometry args={[w, 0.08, d]} />
          <meshStandardMaterial color="#9bafa1" />
        </mesh>
      ))}
      {[0, B.w].map((x) => (
        <mesh key={`wz${x}`} position={[x, 0.04, B.d / 2]} userData={{ noCast: true }}>
          <boxGeometry args={[0.08, 0.08, B.d]} />
          <meshStandardMaterial color="#9bafa1" />
        </mesh>
      ))}

      {/* conveyor, hood and robots get dedicated treatment */}
      {profile.equipment.map((e) => {
        const dimmed = selectedId !== null && !related.has(e.id);
        const selected = selectedId === e.id;
        const t = typeOf(e);
        if (e.type === "conveyor") {
          const b = box(e);
          const st = statuses[e.id].status;
          return (
            <group key={e.id}>
              {conveyorPieces(b).map(([x0, x1], i) => (
                <group key={i} position={[(x0 + x1) / 2, 0, b.cy]}>
                  <ConveyorDetail w={x1 - x0} d={b.d} h={CONVEYOR_H} opacity={dimmed ? 0.3 : 1} color={st === "normal" ? "#8d979d" : STATUS_COLOR[st]} glow={STATUS_COLOR[st === "normal" ? "warning" : st]} />
                </group>
              ))}
            </group>
          );
        }
        if (e.type === "fume_hood") {
          const b = box(e);
          return (
            <group key={e.id} position={[b.cx, 1.9, b.cy]} onClick={(ev) => (ev.stopPropagation(), onSelect(e.id))} onDoubleClick={(ev) => (ev.stopPropagation(), onFocus(e.id))} onPointerOver={(ev) => (ev.stopPropagation(), onHover(e.id))} onPointerOut={() => onHover(null)}>
              <FumeHoodDetail w={b.w} d={b.d} opacity={dimmed ? 0.3 : 1} tex={tex} real={real} />
            </group>
          );
        }
        if (e.type === "agv") {
          return (
            <group key={e.id} onClick={(ev) => (ev.stopPropagation(), onSelect(e.id))} onDoubleClick={(ev) => (ev.stopPropagation(), onFocus(e.id))} onPointerOver={(ev) => (ev.stopPropagation(), onHover(e.id))} onPointerOut={() => onHover(null)}>
              <Agv sim={sim} id={e.id} opacity={dimmed ? 0.3 : 1} />
            </group>
          );
        }
        if (t.shape === "robot") return <Robot key={e.id} e={e} mats={mats as ArmMats} selected={selected} dimmed={dimmed} status={statuses[e.id].status} masked={masked} sim={sim} onSelect={onSelect} onFocus={onFocus} onHover={onHover} />;
        return <Machine key={e.id} e={e} selected={selected} dimmed={dimmed} colorBy={colorBy} status={statuses[e.id].status} masked={masked} tex={tex} real={real} act={() => {
          // a stopped machine and a slowed one both show the same amber stack light while a drill hides the level
          const a = sim.current.acts[e.id];
          return maskRef.current && a.state === "fault" ? { ...a, state: "slow" as const } : a;
        }} level={() => sim.current.levelOf(e.id)} onSelect={onSelect} onFocus={onFocus} onHover={onHover} />;
      })}

      {/* connections */}
      {lines
        .filter((l) => show[l.net as keyof typeof show] ?? true)
        .map((l) => {
          const st = NET_STYLE[l.net];
          const active = selectedId === null || l.from === selectedId || l.to === selectedId;
          return <Tube key={l.key} points={l.points} color={st.color} radius={st.radius} dim={!active} dashed={l.assumed} />;
        })}

      <Carriers sim={sim} />
      <SimDriver sim={sim} ctl={simCtl} statuses={statusRef} />

      {nav !== "walk" ? (
        <OrbitControls
          ref={controls}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          zoomToCursor
          onStart={() => (anim.current = null)}
          target={[B.w / 2, 0, B.d / 2 - 3]}
          minDistance={1}
          maxDistance={140}
          maxPolarAngle={Math.PI / 2.05}
          screenSpacePanning={nav !== "pan"}
          mouseButtons={nav === "pan" ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE } : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
          touches={nav === "pan" ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE } : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      ) : null}
    </>
  );
});

/* ── labels: name only, right of the box, pushed apart in screen space ── */

type Rect = { x0: number; y0: number; x1: number; y1: number };
type ConnTag = { key: string; at: THREE.Vector3; pending: boolean; color: string };
type LabelRefs = {
  host: React.RefObject<HTMLDivElement | null>;
  hud: React.RefObject<(HTMLElement | null)[]>;
  labels: React.RefObject<(HTMLButtonElement | null)[]>;
  leaders: React.RefObject<(SVGLineElement | null)[]>;
  tags: React.RefObject<(HTMLSpanElement | null)[]>;
};
/** Label sits this far right of the box's projected right edge. */
const LABEL_GAP = 8;
/** Labels closer than this (vertically) count as touching. */
const NEAR_Y = 8;
const NEAR_X = 4;
/** First try in place, then 14 px up / down; past that the label keeps a leader line back to its machine. */
const SLOTS = [
  { dy: 0, leader: false },
  { dy: -14, leader: false },
  { dy: 14, leader: false },
  ...[28, 42, 56, 70, 84, 98].flatMap((d) => [
    { dy: -d, leader: true },
    { dy: d, leader: true },
  ]),
];
const hits = (r: Rect, o: Rect, gx: number, gy: number) => r.x0 < o.x1 + gx && r.x1 + gx > o.x0 && r.y0 < o.y1 + gy && r.y1 + gy > o.y0;

/**
 * Runs every frame inside the canvas: projects each machine's box, then a greedy pass places the labels
 * (selected, hovered, abnormal, robots, then the bigger machines first) so no two labels or HUD panels touch.
 */
function LabelLayout({ tagged, tags, sim, selectedId, statuses, els }: { tagged: Instance[]; tags: ConnTag[]; sim: React.MutableRefObject<PlantSim>; selectedId: string | null; statuses: Record<string, Resolved>; els: LabelRefs }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const corners = useMemo(
    () =>
      tagged.map((e) => {
        const b = box(e);
        const y0 = e.type === "fume_hood" ? 1.9 : 0;
        const out: [number, number, number][] = [];
        for (const ox of [-b.w / 2, b.w / 2]) for (const oz of [-b.d / 2, b.d / 2]) for (const oy of [y0, y0 + b.h]) out.push([ox, oy, oz]);
        return out;
      }),
    [tagged],
  );
  useFrame((state) => {
    const host = els.host.current;
    if (!host) return;
    const W = state.size.width;
    const H = state.size.height;
    const hr = host.getBoundingClientRect();
    const obstacles: Rect[] = [];
    // the main app floats its own cards (top bar, nav, detail, events) over the map: keep labels out from under them
    const floating = Array.from(document.querySelectorAll<HTMLElement>("[data-map-obstacle]"));
    for (const el of [...(els.hud.current ?? []), ...floating]) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0) obstacles.push({ x0: r.left - hr.left, y0: r.top - hr.top, x1: r.right - hr.left, y1: r.bottom - hr.top });
    }
    // ax / bx: right / left edge of the projected box
    type Item = { el: HTMLElement; leader: SVGLineElement | null; w: number; h: number; ax: number; bx: number; ay: number; visible: boolean; pri: number; area: number };
    const items: Item[] = [];
    tagged.forEach((e, i) => {
      const el = els.labels.current?.[i];
      if (!el) return;
      let cx = e.position_m.x;
      let cz = e.position_m.y;
      if (e.type === "agv") {
        const a = sim.current.agvs.find((q) => q.id === e.id);
        if (a) [cx, cz] = [a.x, a.z];
      }
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      let behind = false;
      for (const [ox, oy, oz] of corners[i]) {
        v.set(cx + ox, oy, cz + oz).project(state.camera);
        if (v.z > 1) behind = true;
        const sx = ((v.x + 1) / 2) * W;
        const sy = ((1 - v.y) / 2) * H;
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
      }
      const st = statuses[e.id]?.status ?? "normal";
      // hover is deliberately NOT part of the order: it used to jump the hovered label to the front, which pushed the others around
      const pri = e.id === selectedId ? 0 : st === "abnormal" ? 3 : st === "warning" ? 4 : typeOf(e).shape === "robot" ? 5 : 6;
      items.push({ el, leader: els.leaders.current?.[i] ?? null, w: el.offsetWidth, h: el.offsetHeight, ax: x1, bx: x0, ay: (y0 + y1) / 2, visible: !behind && x1 > 0 && x0 < W && y1 > 0 && y0 < H, pri, area: (x1 - x0) * (y1 - y0) });
    });
    tags.forEach((t, j) => {
      const el = els.tags.current?.[j];
      if (!el) return;
      v.copy(t.at).project(state.camera);
      const sx = ((v.x + 1) / 2) * W;
      const sy = ((1 - v.y) / 2) * H;
      items.push({ el, leader: null, w: el.offsetWidth, h: el.offsetHeight, ax: sx - LABEL_GAP + 4, bx: sx, ay: sy, visible: v.z <= 1, pri: 7, area: 0 });
    });
    items.sort((a, b) => a.pri - b.pri || b.area - a.area);
    const placed: Rect[] = [];
    for (const it of items) {
      let at: Rect | null = null;
      let lead = false;
      let left = false;
      if (it.visible) {
        // right of the box first; only when every right slot is taken, the same slots on the left (always with a leader)
        for (const side of [0, 1]) {
          for (const s of SLOTS) {
            const x0 = side ? it.bx - LABEL_GAP - it.w : it.ax + LABEL_GAP;
            const r = { x0, y0: it.ay + s.dy - it.h / 2, x1: x0 + it.w, y1: it.ay + s.dy + it.h / 2 };
            if (r.x0 < 4 || r.y0 < 4 || r.x1 > W - 4 || r.y1 > H - 4) continue;
            if (placed.some((o) => hits(r, o, NEAR_X, NEAR_Y)) || obstacles.some((o) => hits(r, o, 4, 4))) continue;
            at = r;
            lead = s.leader || side === 1;
            left = side === 1;
            break;
          }
          if (at) break;
        }
      }
      if (!at) {
        it.el.style.visibility = "hidden";
        it.leader?.setAttribute("visibility", "hidden");
        continue;
      }
      placed.push(at);
      it.el.style.visibility = "visible";
      it.el.style.transform = `translate(${at.x0.toFixed(1)}px, ${at.y0.toFixed(1)}px)`;
      if (it.leader) {
        if (lead) {
          it.leader.setAttribute("x1", (left ? it.bx - 1 : it.ax + 1).toFixed(1));
          it.leader.setAttribute("y1", it.ay.toFixed(1));
          it.leader.setAttribute("x2", (left ? at.x1 : at.x0).toFixed(1));
          it.leader.setAttribute("y2", ((at.y0 + at.y1) / 2).toFixed(1));
          it.leader.setAttribute("visibility", "visible");
        } else it.leader.setAttribute("visibility", "hidden");
      }
    }
  });
  return null;
}

/* ── HUD ──────────────────────────────────────────────────────────── */

/** The machine card while a drill runs: sensors and connections only, no status or fault name until the answer is in. */
function TrainCard({ id, res, revealed, readings, hist, onClose, hudRef }: { id: string; res: Resolved; revealed: boolean; readings: Reading[]; hist: Record<string, number[]>; onClose: () => void; hudRef: (el: HTMLDivElement | null) => void }) {
  const e = equipmentById(id)!;
  const conns = profile.connections.filter((c) => c.from === id || c.to === id);
  return (
    <div ref={hudRef} className="absolute left-[112px] top-20 max-h-[50%] w-[300px] overflow-auto rounded-lg border border-line bg-surface/95 p-3 text-xs text-ink-1 shadow-md">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{nameOf(id)}</div>
          <div className="text-[11px] text-ink-2">{typeOf(e).name_ko}</div>
        </div>
        <button onClick={onClose} aria-label="닫기" className="rounded-full px-2 text-ink-2 hover:bg-primary-subtle">✕</button>
      </div>
      {revealed ? (
        <div className="mb-1 flex items-center gap-2">
          <StatusPill status={res.status} />
          <span className="text-[11px] text-ink-2">{res.own ? `이 설비의 고장: ${res.own.label}` : res.cause ? `${nameOf(res.cause.from)}의 ${res.cause.scenario.label} 영향` : "이상 없음"}</span>
        </div>
      ) : null}
      {DETAIL_TYPES.has(e.type) || typeOf(e).shape === "robot" ? (
        <div className="mt-2 rounded-md bg-bg px-2 py-1 text-[11px] text-ink-2">가까이서 보이는 상세 모양은 <b>예시(가정)</b>예요. 크기·위치의 근거는 아래 표시를 따르고, 상태(색·신호등·표시)는 실시간으로 반영돼요.</div>
      ) : null}
      <SensorPanel id={id} readings={readings} hist={hist} hideLevel={!revealed} />
      {conns.length ? (
        <div className="mt-2 border-t border-divider pt-2">
          <div className="mb-1 font-semibold text-ink-2">연결 {conns.length}</div>
          {conns.map((c) => {
            const other = equipmentById(c.from === id ? c.to : c.from)!;
            return (
              <div key={c.id} className="mb-0.5 flex items-center gap-1.5">
                <svg width="14" height="4" className="shrink-0">
                  <line x1="1" y1="2" x2="13" y2="2" stroke={NET_STYLE[c.net].color} strokeWidth="3" strokeLinecap="round" strokeDasharray={isAssumedConn(c) ? "3 3" : undefined} />
                </svg>
                <span className="text-ink-2">{c.from === id ? "→" : "←"} {NET_STYLE[c.net].label}</span>
                <span className="ml-auto truncate">{nameOf(other.id)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Card({ id, res, act, elapsed, readings, hist, onInject, onClose, hudRef, inMain }: { id: string; res: Resolved; act: Act; elapsed: number; readings: Reading[]; hist: Record<string, number[]>; onInject: (scenarioId: string | null) => void; onClose: () => void; hudRef: (el: HTMLDivElement | null) => void; inMain?: boolean }) {
  const e = equipmentById(id)!;
  const t = typeOf(e);
  const f = footprintOf(e);
  const cyc = cycleOf(e);
  const conns = profile.connections.filter((c) => c.from === id || c.to === id);
  const srcIds = new Set<string>([...(t.provenance.footprint_m.source_ids ?? []), ...conns.flatMap((c) => c.provenance.source_ids ?? [])]);
  return (
    <div ref={hudRef} className={`absolute right-4 w-[300px] ${inMain ? "top-20 max-h-[calc(100%-19rem)]" : "top-4 max-h-[calc(100%-2rem)]"} overflow-auto rounded-lg border border-line bg-surface/95 p-3 text-xs text-ink-1 shadow-md`}>
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <b className="text-[13px]">{e.name_ko ?? e.label?.title ?? e.id}</b>
          <div className="text-[11px] text-ink-2">{t.name_ko}{t.model ? ` · ${t.model}` : ""}</div>
        </div>
        <button onClick={onClose} className="rounded px-1.5 text-ink-2 hover:bg-primary-subtle">×</button>
      </div>

      <div className="mt-2 rounded-md border border-line p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold text-ink-2">상태 (데모)</span>
          <StatusPill status={res.status} />
        </div>
        {res.own ? (
          <div className="mb-1 text-[11px]">{res.own.label} · {res.own.effect}</div>
        ) : res.cause ? (
          <div className="mb-1 text-[11px]">
            {nameOf(res.cause.from)}의 {res.cause.scenario.label} → {res.cause.net ? NET_STYLE[res.cause.net].label : ""} 공급 영향
            {res.cause.pending ? " (연결 확인 필요)" : ""}
          </div>
        ) : (
          <div className="mb-1 text-[11px] text-ink-2">이상 없음. 아래 시나리오로 상태를 주입해 볼 수 있음</div>
        )}
        <div className="flex flex-wrap gap-1">
          {scenariosOf(e.type).map((sc) => (
            <button
              key={sc.id}
              onClick={() => onInject(res.own?.id === sc.id ? null : sc.id)}
              className={`rounded-full px-2 py-1 text-[11px] ${res.own?.id === sc.id ? (sc.status === "abnormal" ? "bg-danger text-white" : "bg-warn text-white") : "bg-surface text-ink-2 ring-1 ring-line hover:bg-primary-subtle"}`}
            >
              {sc.label}
            </button>
          ))}
          {res.own ? (
            <button onClick={() => onInject(null)} className="rounded-full px-2 py-1 text-[11px] text-primary underline">복구</button>
          ) : null}
        </div>
      </div>

      {DETAIL_TYPES.has(e.type) || typeOf(e).shape === "robot" ? (
        <div className="mt-2 rounded-md bg-bg px-2 py-1 text-[11px] text-ink-2">가까이서 보이는 상세 모양은 <b>예시(가정)</b>예요. 크기·위치의 근거는 아래 표시를 따르고, 상태(색·신호등·표시)는 실시간으로 반영돼요.</div>
      ) : null}
      <SensorPanel id={id} readings={readings} hist={hist} />

      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md bg-primary-subtle/50 p-2">
        <span className="col-span-2 font-semibold text-ink-2">흐름 시뮬레이션 (가정 속도)</span>
        <span className="text-ink-2">지금</span>
        <b>{act.state === "fault" ? "정지" : act.busy ? `가공 중 ${Math.round(act.progress * 100)}%` : act.state === "slow" ? "느려짐" : "대기·유휴"}</b>
        <span className="text-ink-2">처리 수</span>
        <b className="tabular-nums">{act.processed}</b>
        <span className="text-ink-2">앞에서 대기</span>
        <b className="tabular-nums">{act.waiting}</b>
        <span className="text-ink-2">가동률(시뮬)</span>
        <b className="tabular-nums">{elapsed > 30 ? `${Math.round((act.busySec / elapsed) * 100)}%` : "측정 중"}</b>
      </div>

      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <span className="text-ink-2">풋프린트</span>
        <span className="flex items-center justify-between gap-2">
          <b className="tabular-nums">{f.w} × {f.d} × {f.h} m</b>
          <EvidenceBadge c={footprintEvidence(e)} />
        </span>
        {t.provenance.footprint_m.note && !e.footprint_m ? (
          <>
            <span />
            <span className="text-[11px] text-ink-2">{t.provenance.footprint_m.note}</span>
          </>
        ) : null}
        {cyc ? (
          <>
            <span className="text-ink-2">사이클(대표 부품)</span>
            <span className="flex items-center justify-between gap-2">
              <b className="tabular-nums">{cyc.seconds.toFixed(1)} s</b>
              <EvidenceBadge c={cyc.evidence} />
            </span>
            <span className="text-ink-2">택트 {takt().toFixed(1)} s</span>
            <span className="text-[11px] text-ink-2">
              {cyc.terms.map((x) => `${x.label} ${x.seconds.toFixed(1)}`).join(" + ")}
              {cyc.factor !== 1 ? ` (× ${cyc.factor})` : ""}
            </span>
          </>
        ) : null}
      </div>

      {t.spec_notes?.length ? (
        <div className="mt-2 border-t border-divider pt-2">
          <div className="mb-1 font-semibold text-ink-2">제원 메모</div>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-ink-2">
            {t.spec_notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {conns.length ? (
        <div className="mt-2 border-t border-divider pt-2">
          <div className="mb-1 font-semibold text-ink-2">연결 {conns.length}</div>
          {conns.map((c) => {
            const other = equipmentById(c.from === id ? c.to : c.from)!;
            return (
              <div key={c.id} className="mb-0.5 flex items-center gap-1.5">
                <svg width="14" height="4" className="shrink-0">
                  <line x1="1" y1="2" x2="13" y2="2" stroke={NET_STYLE[c.net].color} strokeWidth="3" strokeLinecap="round" strokeDasharray={isAssumedConn(c) ? "3 3" : undefined} />
                </svg>
                <span className="text-ink-2">{c.from === id ? "→" : "←"} {NET_STYLE[c.net].label}</span>
                <span className="ml-auto truncate">{other.name_ko ?? other.label?.title ?? other.id}</span>
                {c.status === "needs_confirmation" ? <span className="rounded bg-warn-subtle px-1 text-warn-text">?</span> : null}
                {isAssumedConn(c) ? <AssumedTag /> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {srcIds.size ? (
        <div className="mt-2 border-t border-divider pt-2">
          <div className="mb-1 font-semibold text-ink-2">출처</div>
          {[...srcIds].map((sid) => {
            const s = sourceById(sid);
            if (!s) return null;
            return (
              <div key={sid} className="mb-1">
                {s.url.startsWith("http") ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-primary underline">{s.title}</a>
                ) : (
                  <span>{s.title}</span>
                )}
                {s.note ? <div className="text-[11px] text-ink-2">{s.note}</div> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Hooks the scene into the main app: the app owns the selection, the Rule Engine's verdict on the robots shows
 * on the map next to the plant model's status, and the robots keep the app's own detail card (Advisor).
 */
export type MainBinding = {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** demo robot id → Rule Engine status (a manual injection shows up here, not in the plant's fault record) */
  robotStatus: Record<string, Status>;
  /** the map tab is showing (the HUD hides while another tab covers it) */
  active: boolean;
  /** a training drill is running: the map shows its fault on a copy of the plant model instead of the real one */
  training?: TrainScene | null;
};

/** camera moves the HUD can ask the scene for */
/** how the camera is moved: orbit around a point (as before), slide along the floor like a map, or walk through the line in first person */
export type NavMode = "orbit" | "pan" | "walk";

type CamApi = { focus: (id: string) => void; home: () => void; zoom: (factor: number) => void; /** fly to look at a point on the floor plan from `dist` metres */ at: (x: number, y: number, z: number, dist: number) => void; /** place the camera exactly: position, then the point it looks at */ pose: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => void };

const RANK: Record<Status, number> = { normal: 0, warning: 1, abnormal: 2 };

export function PlantOverview({ main }: { main?: MainBinding } = {}) {
  const [tokens] = useState(readTokens);
  const [localSel, setLocalSel] = useState<string | null>(null);
  const selectedId = main ? main.selectedId : localSel;
  // a stable setter: the scene is memoized and must not re-render every time the app does
  const onSelectRef = useRef(main?.onSelect);
  onSelectRef.current = main?.onSelect;
  const camApi = useRef<CamApi | null>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const onFocus = useCallback((id: string) => camApi.current?.focus(id), []);
  const hasMain = !!main;
  const setSelectedId = useCallback((id: string | null) => (hasMain ? onSelectRef.current?.(id) : setLocalSel(id)), [hasMain]);
  const [colorBy, setColorBy] = useState<"category" | "evidence" | "neutral">(() => {
    // the main app remembers the last colour mode picked; the lab page always starts on the dimension evidence
    if (!main) return "evidence";
    try {
      const v = localStorage.getItem("kfc.mapColor.v1");
      return v === "category" || v === "neutral" ? v : "evidence";
    } catch {
      return "evidence";
    }
  });
  const [show, setShow] = useState({ cooling: true, power: true, air: true, gas: true, exhaust: true, bundle: true });
  // shared with the main app: a fault injected here is read by its sensor monitor, and the other way round
  const [injected, setInjected] = useSharedInjected();
  const [env, setEnv] = useState(true);
  // surface textures on the detailed machines: switchable so the plain look can be compared
  const [tex, setTex] = useState(true);
  // realistic shading with ambient occlusion and bloom: heavier, so it can be switched off
  const [real, setReal] = useState(true);
  // a darker, high-contrast machine-shop look (studio strips on metal, depth of field, vignette); needs the realistic shading
  const [cine, setCine] = useState(false);
  // how the camera is moved: orbit (as before), slide over the floor, or walk in first person
  const [nav, setNav] = useState<NavMode>("orbit");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const labelEls = useRef<(HTMLButtonElement | null)[]>([]);
  const leaderEls = useRef<(SVGLineElement | null)[]>([]);
  const tagEls = useRef<(HTMLSpanElement | null)[]>([]);
  const hudEls = useRef<(HTMLElement | null)[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const labelRefs = useMemo<LabelRefs>(() => ({ host: hostRef, hud: hudEls, labels: labelEls, leaders: leaderEls, tags: tagEls }), []);
  const robotStatus = main?.robotStatus;
  const training = main?.training ?? null;
  // what is really going on (drives the flow simulation and the sensor values)
  const trueStatuses = useMemo(() => {
    const res = resolveStatus(training ? training.injected : injected);
    if (!robotStatus || training) return res;
    // the Rule Engine owns the verdict on the robots: never show them calmer than it judged
    const merged = { ...res };
    for (const [id, st] of Object.entries(robotStatus)) {
      if (merged[id] && RANK[st] > RANK[merged[id].status]) merged[id] = { status: st, own: null, cause: null };
    }
    return merged;
  }, [injected, robotStatus, training]);
  // what the map shows: during a drill every machine that is off looks the same until the answer is given
  const statuses = useMemo(() => {
    if (!training || training.revealed) return trueStatuses;
    const masked: Record<string, Resolved> = {};
    for (const [id, r] of Object.entries(trueStatuses)) masked[id] = r.status === "normal" ? r : { status: "warning", own: null, cause: null };
    return masked;
  }, [trueStatuses, training]);
  const sim = useRef<PlantSim>(null as unknown as PlantSim);
  if (!sim.current) sim.current = new PlantSim();
  const simCtl = useRef({ running: true, scale: 10 });
  // development aid: with ?debug in the address the simulation and the camera can be inspected from the console
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("debug")) return;
    // the camera api is filled in by the scene a moment later, so it is read through a getter
    (window as unknown as { __kfc?: unknown }).__kfc = { sim: sim.current, get cam() { return camApi.current; } };
  }, []);
  const statusRef = useRef(trueStatuses);
  statusRef.current = trueStatuses;
  const [ui, setUi] = useState({ running: true, scale: 10 });
  const [, setTick] = useState(0);
  const selRef = useRef<string | null>(null);
  selRef.current = selectedId;
  const hist = useRef<Record<string, number[]>>({});
  const readingsFor = (id: string): Reading[] => {
    const e = equipmentById(id);
    if (!e) return [];
    const acts = sim.current.acts;
    return readSensors(e, {
      act: acts[id],
      work: workActFor(e, acts),
      res: statusRef.current[id],
      t: performance.now() / 1000,
      agvSpeed: sim.current.agvs.find((v) => v.id === id)?.speed,
    });
  };
  useEffect(() => {
    // sample the selected machine's sensors twice a second for the little trend lines
    const timer = window.setInterval(() => {
      const id = selRef.current;
      if (id) {
        for (const r of readingsFor(id)) {
          const a = (hist.current[`${id}:${r.def.id}`] ??= []);
          a.push(r.value);
          if (a.length > 60) a.shift();
        }
      }
      setTick((n) => n + 1);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    hist.current = {}; // a new selection starts a fresh trend
  }, [selectedId]);
  // a new drill starts from a calm, whole-line view with a fresh flow; leaving the drills puts the flow back
  const trainKey = training?.key;
  useEffect(() => {
    if (!trainKey) return;
    sim.current.reset();
    setSelectedId(null);
    camApi.current?.home();
  }, [trainKey, setSelectedId]);
  const inTraining = !!training;
  useEffect(() => {
    if (!inTraining) return;
    const s = sim.current;
    return () => s.reset();
  }, [inTraining]);
  // the answer: show the real statuses (above) and fly to the machine the fault started on
  const revealedRoot = training?.revealed ? training.rootId : null;
  useEffect(() => {
    if (!revealedRoot) return;
    setSelectedId(revealedRoot);
    camApi.current?.focus(revealedRoot);
  }, [revealedRoot, trainKey, setSelectedId]);
  const setCtl = (next: Partial<{ running: boolean; scale: number }>) => {
    simCtl.current = { ...simCtl.current, ...next };
    setUi(simCtl.current);
  };
  const simStats = sim.current.stats();
  const tagged = useMemo(() => profile.equipment.filter((e) => !isBackground(e)), []);
  // 가정 tags on the connections of the machine under the pointer (or the selected one)
  const focusId = hoveredId ?? selectedId;
  const connTags = useMemo<ConnTag[]>(
    () =>
      focusId
        ? LINES.filter((l) => l.conn && l.assumed && (l.from === focusId || l.to === focusId) && (show[l.net as keyof typeof show] ?? true)).map((l) => ({
            key: l.key,
            at: midOf(l.points),
            pending: l.pending,
            color: NET_STYLE[l.net].color,
          }))
        : [],
    [focusId, show],
  );
  const connCounts = useMemo(() => ({ assumed: profile.connections.filter(isAssumedConn).length, pending: profile.connections.filter((c) => c.status === "needs_confirmation").length }), []);
  // the status chips count only the demo_id machines (the 3 robots the Rule Engine judges), same rule as the main map
  const statusCounts = useMemo(() => {
    const c: Record<Status, number> = { normal: 0, warning: 0, abnormal: 0 };
    for (const e of profile.equipment) if (e.demo_id) c[statuses[e.id].status]++;
    return c;
  }, [statuses]);
  const inject = (id: string, scenarioId: string | null) =>
    setInjected((m) => {
      const next = { ...m };
      if (scenarioId) next[id] = scenarioId;
      else delete next[id];
      return next;
    });

  const counts = useMemo(() => {
    const c = { sourced: 0, secondary: 0, assumed: 0 };
    for (const e of profile.equipment) if (e.type !== "conveyor") c[footprintEvidence(e)]++;
    return c;
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && setSelectedId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelectedId]);

  const B = profile.factory.building_m;
  return (
    <div className="absolute inset-0 bg-bg">
      <Canvas shadows dpr={real ? [1, 1.5] : [1, 1.75]} gl={{ antialias: true }} camera={{ position: [B.w / 2 + 6, 42, B.d + 56], fov: 32, near: 0.3, far: 400 }} onPointerMissed={() => setSelectedId(null)}>
        <Scene tokens={tokens} selectedId={selectedId} colorBy={colorBy} show={show} statuses={statuses} sim={sim} simCtl={simCtl} statusRef={statusRef} env={env} onSelect={setSelectedId} onFocus={onFocus} camApi={camApi} onHover={setHoveredId} masked={!!training && !training.revealed} zoomRef={zoomRef} tex={tex} real={real} cine={real && cine} nav={nav} onNav={setNav} />
        <LabelLayout tagged={tagged} tags={connTags} sim={sim} selectedId={selectedId} statuses={statuses} els={labelRefs} />
      </Canvas>

      <div ref={hostRef} className="pointer-events-none absolute inset-0 overflow-hidden">
        <svg className="absolute inset-0 h-full w-full">
          {tagged.map((e, i) => (
            <line
              key={e.id}
              ref={(el) => {
                leaderEls.current[i] = el;
              }}
              stroke="#e1e8e7"
              strokeWidth={2}
              strokeLinecap="round"
              visibility="hidden"
            />
          ))}
        </svg>
        {tagged.map((e, i) => {
          const st = statuses[e.id].status;
          const sel = selectedId === e.id;
          const on = sel || hoveredId === e.id;
          const sub = on ? subOf(e) : null;
          return (
            <button
              key={e.id}
              ref={(el) => {
                labelEls.current[i] = el;
              }}
              onClick={() => setSelectedId(e.id)}
              onDoubleClick={() => onFocus(e.id)}
              onMouseEnter={() => setHoveredId(e.id)}
              onMouseLeave={() => setHoveredId((h) => (h === e.id ? null : h))}
              className={`pointer-events-auto invisible absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-medium leading-[14px] shadow-sm ${on ? "z-10" : ""} ${
                sel ? "bg-surface text-primary ring-[1.5px] ring-primary" : st === "abnormal" ? "bg-danger-subtle text-danger-strong ring-1 ring-danger" : st === "warning" ? "bg-warn-subtle text-warn-text ring-1 ring-warn" : "bg-surface text-[var(--kf-map-label)]"
              }`}
            >
              {st !== "normal" ? <b>!</b> : null}
              <span>{titleOf(e)}</span>
              {sub ? <span className="pointer-events-none absolute left-2 top-full z-10 mt-0.5 whitespace-nowrap rounded bg-surface/95 px-1.5 text-[10px] font-normal leading-[13px] text-ink-2 shadow-sm">{sub}</span> : null}
              {footprintEvidence(e) === "assumed" ? <AssumedTag /> : null}
            </button>
          );
        })}
        {connTags.map((t, j) => (
          <span
            key={t.key}
            ref={(el) => {
              tagEls.current[j] = el;
            }}
            className="invisible absolute left-0 top-0 z-10 flex items-center gap-0.5 rounded-[5px] bg-surface/90 p-[2px] shadow-sm"
          >
            {t.pending ? (
              <b className="px-0.5 text-[11px] leading-[13px]" style={{ color: t.color }}>
                ?
              </b>
            ) : null}
            <AssumedTag />
          </span>
        ))}
      </div>

      {!main ? <div
        ref={(el) => {
          hudEls.current[0] = el;
        }}
        className="pointer-events-none absolute left-5 top-4 text-sm"
      >
        <b className="font-semibold text-ink-1">{profile.factory.line_name_ko} 전체 · 프로파일에서 생성한 3D</b>
        <div className="mt-1 text-xs text-ink-2">
          설비 {profile.equipment.length}개 · 연결 {profile.connections.length}개 · 택트 {takt().toFixed(1)}초 · {profile.factory.industry}
        </div>
      </div> : null}

      {training ? (
        selectedId ? <TrainCard id={selectedId} res={trueStatuses[selectedId]} revealed={training.revealed} readings={readingsFor(selectedId)} hist={hist.current} onClose={() => setSelectedId(null)} hudRef={(el) => void (hudEls.current[1] = el)} /> : null
      ) : main && (!main.active || (selectedId && equipmentById(selectedId)?.demo_id)) ? null : selectedId ? <Card inMain={!!main} id={selectedId} res={statuses[selectedId]} act={sim.current.acts[selectedId]} elapsed={simStats.t} readings={readingsFor(selectedId)} hist={hist.current} onInject={(sc) => inject(selectedId, sc)} onClose={() => setSelectedId(null)} hudRef={(el) => void (hudEls.current[1] = el)} /> : main ? null : (
        <div
          ref={(el) => {
            hudEls.current[1] = el;
          }}
          className="pointer-events-none absolute right-4 top-4 rounded-md bg-surface/90 px-2 py-1 text-xs text-ink-2 shadow-sm">설비를 클릭하면 치수·사이클·연결·출처 표시</div>
      )}

      {/* left-[104px]: the bottom-left corner stays free (the Next dev indicator sits there in dev) */}
      <div
        ref={(el) => {
          hudEls.current[2] = el;
        }}
        className={`absolute bottom-4 left-[104px] flex flex-col items-start gap-2 text-xs ${main && !main.active ? "hidden" : ""}`}
      >
        <div className="flex items-center gap-1 rounded-full bg-surface/95 p-1 shadow-md">
          <button onClick={() => camApi.current?.zoom(0.6)} title="확대" aria-label="확대" className="h-7 w-7 rounded-full text-base leading-none text-primary hover:bg-primary-subtle">+</button>
          <button onClick={() => camApi.current?.zoom(1 / 0.6)} title="축소" aria-label="축소" className="h-7 w-7 rounded-full text-base leading-none text-primary hover:bg-primary-subtle">−</button>
          <span ref={zoomRef} title="처음 화면의 카메라 거리를 100%로 한 값이에요. 확대할수록 작아지고(오른쪽은 배율) 축소할수록 커져요." className="min-w-[78px] px-1 text-center tabular-nums text-ink-2">100% · ×1.0</span>
          <button onClick={() => camApi.current?.home()} className="rounded-full px-2.5 py-1.5 text-primary hover:bg-primary-subtle">전체 보기</button>
          <button
            onClick={() => selectedId && camApi.current?.focus(selectedId)}
            disabled={!selectedId}
            title="선택한 설비로 다가가 자세히 봐요. 설비나 이름표를 더블클릭해도 돼요."
            className="rounded-full px-2.5 py-1.5 text-primary hover:bg-primary-subtle disabled:text-ink-3 disabled:hover:bg-transparent"
          >
            선택 설비 확대
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-surface/95 p-1 shadow-md" title="화면을 움직이는 방식을 고를 수 있어요">
          <span className="px-2 text-ink-2">보기 방식</span>
          {(
            [
              ["orbit", "궤도", "가운데 점을 중심으로 돌려 봐요 (왼쪽 드래그 = 회전, 오른쪽 드래그 = 이동, 휠 = 확대)"],
              ["pan", "이동", "지도처럼 바닥을 따라 이동해요 (왼쪽 드래그 = 이동, 오른쪽 드래그 = 회전, 휠 = 확대, W A S D · 방향키 = 이동, Shift = 빠르게)"],
              ["walk", "걷기", "라인 안을 1인칭으로 걸어요 (W A S D = 이동, 드래그 = 둘러보기, 휠 = 앞뒤, Q E = 높이, Shift = 빠르게, Esc = 돌아가기)"],
            ] as const
          ).map(([m, label, tip]) => (
            <button key={m} onClick={() => setNav(m)} title={tip} className={`rounded-full px-2.5 py-1.5 ${nav === m ? "bg-primary-subtle text-primary ring-1 ring-primary" : "text-ink-2 hover:bg-primary-subtle"}`}>
              {label}
            </button>
          ))}
          {nav === "pan" ? <span className="px-2 text-ink-3">드래그 = 이동 · 오른쪽 드래그 = 회전 · W A S D</span> : null}
          {nav === "walk" ? <span className="px-2 text-ink-3">W A S D 이동 · 드래그 = 둘러보기 · Q E 높이 · Esc 나가기</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-full bg-surface/95 px-2 py-1 shadow-md">
          <button onClick={() => setCtl({ running: !ui.running })} className="rounded-full bg-primary px-3 py-1.5 text-white">
            {ui.running ? "일시정지" : "재생"}
          </button>
          {[1, 10, 30, 60].map((sc) => (
            <button key={sc} onClick={() => setCtl({ scale: sc })} className={`rounded-full px-2.5 py-1.5 ${ui.scale === sc ? "bg-primary-subtle text-primary ring-1 ring-primary" : "text-ink-2 hover:bg-primary-subtle"}`}>
              {sc}×
            </button>
          ))}
          <button onClick={() => sim.current.reset()} className="rounded-full px-2.5 py-1.5 text-primary underline">
            흐름 초기화
          </button>
        </div>
        <div className="flex items-center gap-3 rounded-full bg-surface/95 px-3 py-1.5 shadow-md">
          <span className="text-ink-2">흐름 시뮬</span>
          <span className="tabular-nums">{Math.floor(simStats.t / 60)}분 {String(Math.floor(simStats.t % 60)).padStart(2, "0")}초</span>
          <span>완료 <b className="tabular-nums">{simStats.finished}</b></span>
          <span>진행 중 <b className="tabular-nums">{simStats.wip}</b></span>
          <span title="원자재 랙 / 포장 대기 + 운반 중 / 출하 재고 / 출하 완료 (수치는 가정)">
            원자재 <b className="tabular-nums">{simStats.rack}</b>/{RACK_CAP} · 포장 대기 <b className="tabular-nums">{simStats.packed + simStats.carrying}</b> · 출하 재고 <b className="tabular-nums">{simStats.stockOut}</b> · 출하 <b className="tabular-nums">{simStats.shipped}</b>
            {simStats.starved ? <b className="ml-1 text-warn-text">원자재 대기</b> : null}
          </span>
          <span>최근 10분 기준 시간당 <b className="tabular-nums">{simStats.ready ? Math.round(simStats.uph) : "-"}</b>개 (택트 기준 {Math.round(3600 / takt())})</span>
        </div>
        {!main ? <div className="flex items-center gap-3 rounded-full bg-surface/95 px-3 py-1.5 shadow-md">
          <span className="text-ink-2">상태 (데모)</span>
          <span className="text-primary">정상 {statusCounts.normal}</span>
          <span className="text-warn-text">주의 {statusCounts.warning}</span>
          <span className="text-danger-strong">이상 {statusCounts.abnormal}</span>
          <button
            onClick={() => setInjected({})}
            disabled={Object.keys(injected).length === 0}
            className="rounded-full px-2.5 py-1 text-primary underline disabled:text-ink-2 disabled:no-underline"
          >
            초기화
          </button>
        </div> : null}
        <div className="flex items-center gap-1 rounded-full bg-surface/95 p-1 shadow-md">
          {((main ? ["evidence", "category", "neutral"] : ["evidence", "category"]) as ("category" | "evidence" | "neutral")[]).map((k) => (
            <button
              key={k}
              onClick={() => {
                setColorBy(k);
                if (main) {
                  try {
                    localStorage.setItem("kfc.mapColor.v1", k);
                  } catch {
                    /* storage blocked: the choice then only lasts until reload */
                  }
                }
              }}
              className={`rounded-full px-3 py-1.5 ${colorBy === k ? "bg-primary text-white" : "text-ink-2 hover:bg-primary-subtle"}`}>
              {k === "evidence" ? "치수 근거로 색칠" : k === "category" ? "종류로 색칠" : "단색"}
            </button>
          ))}
        </div>
        {colorBy === "evidence" ? (
          <div className="flex items-center gap-3 rounded-full bg-surface/95 px-3 py-1.5 shadow-md">
            {(["sourced", "secondary", "assumed"] as const).map((c) => (
              <span key={c} className="flex items-center gap-1.5 text-ink-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: EVID_COLOR[c] }} />
                {EVIDENCE_KO[c]} {counts[c]}
              </span>
            ))}
          </div>
        ) : null}
        {!main ? <div className="flex items-center gap-3 rounded-full bg-surface/95 px-3 py-1.5 text-ink-2 shadow-md">
          <span className="flex items-center gap-1.5">
            <svg width="22" height="4">
              <line x1="1" y1="2" x2="21" y2="2" stroke="#6f8582" strokeWidth="2" />
            </svg>
            근거 있음
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="22" height="4">
              <line x1="1" y1="2" x2="21" y2="2" stroke="#6f8582" strokeWidth="2" strokeDasharray="4 3" />
            </svg>
            <AssumedTag />
            치수 {counts.assumed} · 연결 {connCounts.assumed}
          </span>
          <span>
            <b className="text-[#3f8fbd]">?</b> 확인 필요 연결 {connCounts.pending}
          </span>
        </div> : null}
        <div className="flex flex-wrap items-center gap-3 rounded-full bg-surface/95 px-3 py-1.5 shadow-md">
          <label className="flex cursor-pointer items-center gap-1.5 text-ink-2">
            <input type="checkbox" checked={env} onChange={() => setEnv((v) => !v)} className="accent-[var(--kf-primary)]" />
            공장 환경 (벽·기둥·조명)
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-ink-2" title="설비 표면의 질감(도장 패널 이음선, 솔질한 금속, 거친 검정 도장)을 켜고 꺼서 비교해요">
            <input type="checkbox" checked={tex} onChange={() => setTex((v) => !v)} className="accent-[var(--kf-primary)]" />
            질감
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-ink-2" title="부드러운 조명 반사, 도장 광택, 금속 질감, 접촉 그림자(AO), 빛 번짐을 켜고 꺼서 비교해요. 사양이 낮은 기기에서는 끄면 가벼워요">
            <input type="checkbox" checked={real} onChange={() => setReal((v) => !v)} className="accent-[var(--kf-primary)]" />
            사실감
          </label>
          <label className={`flex items-center gap-1.5 ${real ? "cursor-pointer text-ink-2" : "cursor-not-allowed text-ink-3"}`} title="어두운 공장 배경에 금속면을 길게 비추는 조명, 초점 흐림, 비네팅을 더한 제품 영상 같은 룩이에요. 사실감이 켜져 있어야 해요.">
            <input type="checkbox" checked={real && cine} disabled={!real} onChange={() => setCine((v) => !v)} className="accent-[var(--kf-primary)]" />
            시네마틱
          </label>
          {(["cooling", "power", "air", "gas", "exhaust", "bundle"] as const).map((n) => (
            <label key={n} className="flex cursor-pointer items-center gap-1.5 text-ink-2">
              <input type="checkbox" checked={show[n]} onChange={() => setShow((s) => ({ ...s, [n]: !s[n] }))} className="accent-[var(--kf-primary)]" />
              <span className="h-2 w-2 rounded-full" style={{ background: NET_STYLE[n].color }} />
              {NET_STYLE[n].label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
