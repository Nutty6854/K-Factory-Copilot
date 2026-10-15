#!/usr/bin/env node
// Validate a factory profile and report capacity.
//   node scripts/check-factory-profile.mjs [contracts/examples/factory_profile.line_a.json]
// Uses ajv from frontend/web-admin/node_modules (no extra install).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateCycle, LEVEL_KO } from "../contracts/lib/cycle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "frontend/web-admin/package.json"));
const Ajv = require("ajv");

const args = process.argv.slice(2);
const showCycles = args.includes("--cycles");
const profilePath = resolve(root, args.find((x) => !x.startsWith("--")) ?? "contracts/examples/factory_profile.line_a.json");
const schema = JSON.parse(readFileSync(resolve(root, "contracts/schemas/factory_profile.schema.json"), "utf8"));
const p = JSON.parse(readFileSync(profilePath, "utf8"));

const errors = [];
const warnings = [];

/* 1. schema */
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);
if (!validate(p)) for (const e of validate.errors) errors.push(`schema ${e.dataPath || "/"} ${e.message}`);

/* 2. references */
const ids = new Set();
for (const e of p.equipment) {
  if (ids.has(e.id)) errors.push(`duplicate equipment id: ${e.id}`);
  ids.add(e.id);
  if (!p.catalog[e.type]) errors.push(`${e.id}: unknown type "${e.type}"`);
}
const srcIds = new Set(p.sources.map((s) => s.id));
const routeIds = new Set(p.routes.map((r) => r.id));
const checkProv = (where, pv) => {
  for (const s of pv?.source_ids ?? []) if (!srcIds.has(s)) errors.push(`${where}: unknown source "${s}"`);
};
for (const [k, t] of Object.entries(p.catalog)) for (const [f, pv] of Object.entries(t.provenance ?? {})) checkProv(`catalog.${k}.${f}`, pv);
for (const e of p.equipment) checkProv(`${e.id}.cycle_time`, e.cycle_time_provenance);
for (const c of p.connections) {
  for (const end of [c.from, c.to]) if (!ids.has(end)) errors.push(`${c.id}: unknown equipment "${end}"`);
  if (c.route && !routeIds.has(c.route)) errors.push(`${c.id}: unknown route "${c.route}"`);
  if (!c.route && !c.waypoints_m) errors.push(`${c.id}: needs a route or waypoints_m to be drawable`);
  checkProv(c.id, c.provenance);
}
for (const f of p.flow) for (const end of [f.from, f.to]) if (!ids.has(end)) errors.push(`flow: unknown equipment "${end}"`);

/* 3. supply/demand consistency per equipment */
const byId = Object.fromEntries(p.equipment.map((e) => [e.id, e]));
for (const e of p.equipment) {
  const t = p.catalog[e.type];
  if (!t) continue;
  for (const net of t.consumes ?? []) {
    if (net === "signal") continue;
    const fed = p.connections.some((c) => c.to === e.id && (c.net === net || c.net === "bundle"));
    if (!fed) warnings.push(`${e.id} (${t.name_ko}) consumes ${net} but nothing is connected to supply it`);
  }
  for (const c of p.connections.filter((c) => c.to === e.id)) {
    const consumed = (t.consumes ?? []).includes(c.net) || c.net === "bundle" || c.net === "signal";
    if (!consumed) warnings.push(`${e.id} (${t.name_ko}) receives ${c.net} via ${c.id}, but its type does not declare it${c.status === "needs_confirmation" ? " (needs confirmation)" : ""}`);
  }
}
for (const c of p.connections) {
  const src = p.catalog[byId[c.from]?.type];
  if (src && !(src.provides ?? []).includes(c.net) && !(c.net === "air" && src.consumes?.includes("power")))
    warnings.push(`${c.id}: ${c.from} supplies ${c.net} but its type does not declare it as provided`);
}

/* 3b. footprints must not overlap and must fit in the building */
const SKIP_OVERLAP = new Set(["conveyor", "fume_hood", "fixture", "agv"]); // these sit over/under other things on purpose
const boxOf = (e) => {
  const t = p.catalog[e.type];
  const w = e.footprint_m?.w ?? t.footprint_m.w;
  const d = e.footprint_m?.d ?? t.footprint_m.d;
  return { id: e.id, x0: e.position_m.x - w / 2, x1: e.position_m.x + w / 2, y0: e.position_m.y - d / 2, y1: e.position_m.y + d / 2 };
};
const boxes = p.equipment.filter((e) => p.catalog[e.type]).map((e) => ({ e, b: boxOf(e) }));
for (const { e, b } of boxes) {
  if (b.x0 < 0 || b.y0 < 0 || b.x1 > p.factory.building_m.w || b.y1 > p.factory.building_m.d)
    errors.push(`${e.id}: footprint leaves the building (${b.x0.toFixed(2)},${b.y0.toFixed(2)})–(${b.x1.toFixed(2)},${b.y1.toFixed(2)})`);
}
for (let i = 0; i < boxes.length; i++)
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], c = boxes[j];
    if (SKIP_OVERLAP.has(a.e.type) || SKIP_OVERLAP.has(c.e.type)) continue;
    const ox = Math.min(a.b.x1, c.b.x1) - Math.max(a.b.x0, c.b.x0);
    const oy = Math.min(a.b.y1, c.b.y1) - Math.max(a.b.y0, c.b.y0);
    if (ox > 1e-6 && oy > 1e-6) errors.push(`footprints overlap: ${a.e.id} and ${c.e.id} (${ox.toFixed(2)} × ${oy.toFixed(2)} m)`);
  }

/* 4. capacity */
const a = p.assumptions;
const productiveSeconds = a.working_days_per_year * a.shifts_per_day * a.productive_hours_per_shift * 3600 * a.oee;
const takt = productiveSeconds / a.annual_volume_units;
const part = (p.parts ?? []).find((x) => x.id === p.reference_part);
const usesModels = p.equipment.some((e) => e.cycle_model ?? p.catalog[e.type]?.cycle_model);
if (usesModels && !part) errors.push(`cycle models need a reference_part that exists in parts[] (got "${p.reference_part}")`);
const cycleOf = (e) => {
  const t = p.catalog[e.type];
  const model = e.cycle_model ?? t?.cycle_model;
  if (model && part) {
    try {
      const r = evaluateCycle(model, part);
      return { seconds: r.seconds, evidence: r.evidence, terms: r.terms, factor: r.factor, derived: true };
    } catch (err) {
      errors.push(`${e.id}: ${err.message}`);
      return null;
    }
  }
  const sec = e.cycle_time_s ?? t?.cycle_time_s;
  if (!sec) return null;
  const pv = e.cycle_time_provenance ?? t?.provenance?.cycle_time_s;
  return { seconds: sec, evidence: pv?.confidence ?? "assumed", terms: [], derived: false };
};
const steps = new Map();
for (const e of p.equipment) {
  if (!e.process_step) continue;
  const c = cycleOf(e);
  if (!c) continue;
  const s = steps.get(e.process_step) ?? { step: e.process_step, ids: [], cycle: 0, evidence: "sourced", detail: [] };
  s.ids.push(e.id);
  if (c.seconds >= s.cycle) { s.cycle = c.seconds; s.evidence = c.evidence; s.detail = c.terms; s.factor = c.factor; s.derived = c.derived; }
  steps.set(e.process_step, s);
}

console.log(`profile: ${profilePath.replace(root + "/", "")}`);
console.log(`equipment ${p.equipment.length} · types ${Object.keys(p.catalog).length} · connections ${p.connections.length} · sources ${p.sources.length}`);
const conf = { sourced: 0, secondary: 0, assumed: 0 };
for (const c of p.connections) conf[c.provenance.confidence]++;
const pending = p.connections.filter((c) => c.status === "needs_confirmation").length;
console.log(`connections: ${conf.sourced} sourced · ${conf.secondary} secondary · ${conf.assumed} assumed · ${pending} need confirmation`);
console.log("");
console.log(`volume ${a.annual_volume_units.toLocaleString()} /yr · ${a.working_days_per_year} d × ${a.shifts_per_day} shifts × ${a.productive_hours_per_shift} h · OEE ${a.oee}`);
console.log(`takt time = ${takt.toFixed(2)} s/unit`);
console.log("");
if (part) console.log(`reference part: ${part.name_ko} (${part.thickness_mm} mm, cut ${part.cut_length_m} m, ${part.pierces} pierces, ${part.bends} bends, seam ${part.seam_length_m * 1000} mm)`);
console.log("step                    cycle(s)  have  need  util.  evidence");
for (const s of steps.values()) {
  const have = s.ids.length;
  const need = Math.ceil(s.cycle / takt);
  const util = s.cycle / (takt * have);
  const flag = have < need ? "  <-- SHORT" : util > a.max_utilization ? "  <-- bottleneck" : "";
  console.log(`${s.step.padEnd(24)}${s.cycle.toFixed(1).padStart(6)}${String(have).padStart(6)}${String(need).padStart(6)}${(util * 100).toFixed(0).padStart(5)}%  ${LEVEL_KO[s.evidence]}${flag}`);
  if (flag) warnings.push(`step "${s.step}": ${have} unit(s), utilization ${(util * 100).toFixed(0)}%, needs ${need} at 100% (limit ${(a.max_utilization * 100).toFixed(0)}%)`);
  if (showCycles && s.detail.length) {
    for (const t of s.detail) console.log(`      ${t.seconds.toFixed(2).padStart(7)} s  ${t.label}  [${LEVEL_KO[t.evidence]}]`);
    if (s.factor && s.factor !== 1) console.log(`      × ${s.factor} (샘플 비율)`);
  }
}

const LEVEL = { sourced: "직접 확인", secondary: "보조 출처", assumed: "가정" };
console.log("");
console.log("reference models (footprint evidence):");
for (const [k, t] of Object.entries(p.catalog)) {
  if (!t.model) continue;
  const c = t.provenance.footprint_m;
  const fp = t.footprint_m;
  console.log(`  ${t.name_ko.padEnd(10)} ${t.model.padEnd(34)} ${fp.w} × ${fp.d} × ${fp.h} m  [${LEVEL[c.confidence]}]`);
}
const level = { sourced: 0, secondary: 0, assumed: 0 };
for (const t of Object.values(p.catalog)) level[t.provenance.footprint_m.confidence]++;
console.log(`footprints by evidence: ${level.sourced} direct · ${level.secondary} secondary · ${level.assumed} assumed (of ${Object.keys(p.catalog).length} types)`);
const cyc = { secondary: 0, assumed: 0, sourced: 0 };
for (const e of p.equipment) { const c = e.process_step ? cycleOf(e) : null; if (c) cyc[c.evidence]++; }
console.log(`cycle times by evidence: ${cyc.sourced} direct · ${cyc.secondary} secondary · ${cyc.assumed} assumed`);

console.log("");
for (const w of warnings) console.log("warn  " + w);
for (const e of errors) console.log("ERROR " + e);
console.log(errors.length ? `\nFAILED: ${errors.length} error(s), ${warnings.length} warning(s)` : `\nOK: valid, ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
