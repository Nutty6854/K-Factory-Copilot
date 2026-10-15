import profileJson from "../../../../contracts/examples/factory_profile.line_a.json";
import { evaluateCycle } from "../../../../contracts/lib/cycle.mjs";

/*
 * Typed view of contracts/examples/factory_profile.line_a.json — the single source of truth for
 * what equipment exists, where it stands, what feeds what, and how sure we are about each number.
 * The schema lives in contracts/schemas/factory_profile.schema.json (validated by
 * `node scripts/check-factory-profile.mjs`), so this file only types what the UI reads.
 */

export type Confidence = "sourced" | "secondary" | "assumed";
export type Net = "power" | "cooling" | "air" | "gas" | "exhaust" | "signal" | "bundle";

export type Provenance = { confidence: Confidence; source_ids?: string[]; note?: string };
export type Source = { id: string; title: string; url: string; accessed: string; note?: string };
export type Param = { value: number; unit: string; provenance: Provenance };
export type CycleModel = { kind: string; params: Record<string, Param> };

export type Part = {
  id: string;
  name_ko: string;
  thickness_mm: number;
  blank_mm: { l: number; w: number };
  cut_length_m: number;
  pierces: number;
  holes: number;
  hole_depth_mm: number;
  bends: number;
  length_m: number;
  seam_length_m: number;
  seams: number;
  parts_per_box: number;
};

export type EquipmentType = {
  name_ko: string;
  model?: string;
  spec_notes?: string[];
  category: "process" | "robot" | "utility" | "logistics" | "storage" | "control";
  footprint_m: { w: number; d: number; h: number };
  shape?: "box" | "ellipse" | "robot";
  reach_m?: number;
  cycle_model?: CycleModel;
  cycle_time_s?: number;
  consumes?: Net[];
  provides?: Net[];
  provenance: { footprint_m: Provenance; cycle_time_s?: Provenance; consumes?: Provenance };
};

export type Instance = {
  id: string;
  type: string;
  name?: string;
  name_ko?: string;
  role?: string;
  role_short?: string;
  label?: { title?: string; sub?: string; below?: string; side?: "right" | "below" | "left" };
  position_m: { x: number; y: number };
  footprint_m?: { w?: number; d?: number };
  process_step?: string;
  cycle_model?: CycleModel;
  shared_systems?: { cooling_line?: string; power_zone?: string };
  demo_id?: string;
};

export type Connection = {
  id: string;
  net: Net;
  from: string;
  to: string;
  route?: string;
  drop_offset_m?: number;
  waypoints_m?: [number, number][];
  status: "confirmed" | "needs_confirmation";
  provenance: Provenance;
  note?: string;
};

export type Route = { id: string; net: Net; kind: "bus" | "trench"; polyline_m: [number, number][]; label?: string };

export type FactoryProfile = {
  schema_version: string;
  reference_part: string;
  parts: Part[];
  shared_systems: Record<string, { name_ko: string; kind: "cooling_line" | "power_zone" }>;
  factory: {
    id: string;
    name: string;
    line_id: string;
    line_name_ko: string;
    industry: string;
    building_m: { w: number; d: number };
    utility_strip_depth_m?: number;
  };
  assumptions: {
    annual_volume_units: number;
    working_days_per_year: number;
    shifts_per_day: number;
    productive_hours_per_shift: number;
    oee: number;
    max_utilization: number;
  };
  sources: Source[];
  catalog: Record<string, EquipmentType>;
  equipment: Instance[];
  routes: Route[];
  connections: Connection[];
  flow: { from: string; to: string; mode: string; waypoints_m?: [number, number][]; route_m?: [number, number][] }[];
};

export const profile = profileJson as unknown as FactoryProfile;

export const equipmentById = (id: string) => profile.equipment.find((e) => e.id === id) ?? null;
export const typeOf = (e: Instance) => profile.catalog[e.type];
export const sourceById = (id: string) => profile.sources.find((s) => s.id === id) ?? null;

/** Footprint on the floor plan (an instance may override width/depth). */
export function footprintOf(e: Instance) {
  const t = typeOf(e);
  return { w: e.footprint_m?.w ?? t.footprint_m.w, d: e.footprint_m?.d ?? t.footprint_m.d, h: t.footprint_m.h };
}

/** How much we trust the footprint. An instance-level override is our own choice, hence assumed. */
export const footprintEvidence = (e: Instance): Confidence =>
  e.footprint_m ? "assumed" : typeOf(e).provenance.footprint_m.confidence;

export const EVIDENCE_KO: Record<Confidence, string> = { sourced: "직접 확인", secondary: "보조 출처", assumed: "가정" };

export function takt() {
  const a = profile.assumptions;
  return (a.working_days_per_year * a.shifts_per_day * a.productive_hours_per_shift * 3600 * a.oee) / a.annual_volume_units;
}

/** Derived cycle time of one machine for the reference part (null if it has no model). */
export function cycleOf(e: Instance) {
  const model = e.cycle_model ?? typeOf(e).cycle_model;
  const part = profile.parts.find((p) => p.id === profile.reference_part);
  if (!model || !part) return null;
  return evaluateCycle(model, part) as {
    seconds: number;
    evidence: Confidence;
    terms: { label: string; seconds: number; evidence: Confidence }[];
    factor: number;
  };
}

/**
 * Dependency edges "A supplies net N to B". A cable bundle (controller → robot, weld source → robot)
 * carries whatever its source receives, so e.g. power_a → ctrl_01 → robot_01 also means power_a → robot_01.
 */
export function effectiveEdges(nets: Net[] = ["cooling", "power"]) {
  const direct = profile.connections.filter((c) => nets.includes(c.net));
  const bundles = profile.connections.filter((c) => c.net === "bundle");
  const out: { net: Net; from: string; to: string; status: Connection["status"]; confidence: Confidence }[] = direct.map((c) => ({
    net: c.net,
    from: c.from,
    to: c.to,
    status: c.status,
    confidence: c.provenance.confidence,
  }));
  for (const b of bundles) {
    for (const c of direct.filter((d) => d.to === b.from)) {
      if (!out.some((o) => o.net === c.net && o.from === c.from && o.to === b.to))
        out.push({ net: c.net, from: c.from, to: b.to, status: c.status, confidence: c.provenance.confidence });
    }
  }
  return out;
}
