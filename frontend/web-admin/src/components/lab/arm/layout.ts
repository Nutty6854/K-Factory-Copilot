import type { ToolKind } from "./IndustrialArm";
import { effectiveEdges, equipmentById, profile } from "@/data/factoryProfile";

/* Shared plant layout + connection graph (what feeds what). World units ≈ metres. */

export const BT = 0.62; // belt top
export const BELT_Z = 1.5;
export const BELT_X0 = -6.2;
export const BELT_X1 = 6.2;
export const PITCH = 2.6;
export const PLATE = { w: 0.86, h: 0.07, d: 0.5 };

export const ROBOT_XS = [-PITCH, 0, PITCH];

/* floor equipment (centres) */
export const CHILLER = { x: -4.55, z: -0.75 };
export const PANEL = { x: -5.95, z: -1.0 };
export const WELD = { x: 4.15, z: -0.55 };
export const CAB = { x: -1.3, z: -1.25 };

/* overhead utility rack */
export const RACK = {
  z: -1.5,
  xs: [-5.2, -3.45, -0.6, 1.3, 3.5, 4.9],
  supplyY: 2.5,
  supplyZ: -1.05,
  returnY: 2.33,
  returnZ: -0.9,
  trayY: 2.0,
  trayZ: -1.3,
};

export type Status = "normal" | "warning" | "abnormal";
export type NetKind = "cooling" | "power";
export type NodeKind = "robot" | "chiller" | "panel" | "weld";

export type NodeDef = {
  id: string;
  kind: NodeKind;
  name: string;
  /** short label on the 3D tag */
  tag: string;
  x: number;
  z: number;
  /** selection ring radius */
  ring: number;
  /** tag height */
  labelY: number;
  role?: string;
  tool?: ToolKind;
  unit?: string;
};

/* The closeup keeps its own compressed positions; names, roles and the dependency graph come from the profile. */
const SCENE_ID: Record<string, string> = { chiller_01: "chiller", weldsrc_01: "weld_src" };
const sceneId = (profileId: string) => SCENE_ID[profileId] ?? profileId;
const inst = (id: string) => {
  const e = equipmentById(id);
  if (!e) throw new Error(`factory profile has no equipment "${id}"`);
  return e;
};
const TOOL_BY_STEP: Record<string, { tool: ToolKind; unit: string }> = {
  machining: { tool: "spindle", unit: "스핀들" },
  inspection_inprocess: { tool: "scanner", unit: "판정" },
  welding: { tool: "torch", unit: "용접 전류" },
};
const robotNode = (id: string, x: number): NodeDef => {
  const e = inst(id);
  const t = TOOL_BY_STEP[e.process_step ?? ""];
  return {
    id,
    kind: "robot",
    name: e.label?.title ?? id,
    tag: `${e.label?.title ?? id} · ${e.role_short}`,
    x,
    z: 0,
    ring: 0.66,
    labelY: 2.4,
    role: e.role_short,
    tool: t?.tool,
    unit: t?.unit,
  };
};
const coolingName = profile.shared_systems[inst("chiller_01").shared_systems?.cooling_line ?? ""]?.name_ko ?? "";
const zoneName = profile.shared_systems[inst("power_a").shared_systems?.power_zone ?? ""]?.name_ko ?? "";

export const NODES: NodeDef[] = [
  ...["robot_01", "robot_02", "robot_03"].map((id, i) => robotNode(id, ROBOT_XS[i])),
  { id: "chiller", kind: "chiller", name: inst("chiller_01").label?.title ?? "칠러", tag: `칠러 · ${coolingName}`, x: CHILLER.x, z: CHILLER.z, ring: 1.0, labelY: 1.5 },
  { id: "power_a", kind: "panel", name: inst("power_a").label?.title ?? "전원반 A", tag: `전원반 · ${zoneName}`, x: PANEL.x, z: PANEL.z, ring: 0.8, labelY: 2.15 },
  { id: "weld_src", kind: "weld", name: inst("weldsrc_01").label?.title ?? "용접 전원", tag: inst("weldsrc_01").label?.title ?? "용접 전원", x: WELD.x, z: WELD.z, ring: 0.8, labelY: 1.35 },
];

export const nodeById = (id: string | null) => NODES.find((n) => n.id === id) ?? null;

/** Logical dependency graph (also drives the highlight when something is selected). */
const SCENE_NODES = new Set(NODES.map((n) => n.id));
export const EDGES: { net: NetKind; from: string; to: string }[] = effectiveEdges(["cooling", "power"])
  .map((e) => ({ net: e.net as NetKind, from: sceneId(e.from), to: sceneId(e.to) }))
  .filter((e) => SCENE_NODES.has(e.from) && SCENE_NODES.has(e.to));

export const suppliesOf = (id: string) => EDGES.filter((e) => e.from === id).map((e) => ({ net: e.net, to: e.to }));
export const feedsOf = (id: string) => EDGES.filter((e) => e.to === id).map((e) => ({ net: e.net, from: e.from }));
export const netTouches = (net: NetKind, id: string | null) =>
  id !== null && EDGES.some((e) => e.net === net && (e.from === id || e.to === id));

export type Infra = { chiller: Status; panel: Status; weld: Status; speed: number };
