#!/usr/bin/env node
// Draw the floor plan (SVG) straight from a factory profile.
//   node scripts/render-layout.mjs [profile.json] [out.svg]
// Nothing about the layout is hard-coded here: move a machine in the JSON and the drawing follows.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = resolve(root, process.argv[2] ?? "contracts/examples/factory_profile.line_a.json");
const outPath = resolve(root, process.argv[3] ?? "docs/plant-layout-draft.svg");
const p = JSON.parse(readFileSync(profilePath, "utf8"));

const S = 26;
const X = (m) => +(40 + S * m).toFixed(1);
const Y = (m) => +(96 + S * m).toFixed(1);
const B = p.factory.building_m;
const W = Math.max(1180, Math.round(80 + S * B.w));
const H = Math.round(96 + S * B.d + 354);

const NET = {
  power: { color: "#e0a030", w: 2.2, label: "전원" },
  air: { color: "#8a7fbf", w: 2.0, label: "압축공기" },
  gas: { color: "#6d8e7d", w: 2.2, label: "보호가스" },
  exhaust: { color: "#8a8f7e", w: 5.0, label: "집진 덕트" },
  signal: { color: "#94a3a8", w: 1.4, label: "신호" },
  bundle: { color: "#4c6266", w: 3.4, label: "케이블 묶음 (전원·신호·냉각수·가스)" },
  cooling: { color: "#3f8fbd", w: 2.6, label: "냉각수 공급" },
};
const RETURN = "#8cc4e0";

const byId = Object.fromEntries(p.equipment.map((e) => [e.id, e]));
const typeOf = (e) => p.catalog[e.type];
const dims = (e) => ({ w: e.footprint_m?.w ?? typeOf(e).footprint_m.w, d: e.footprint_m?.d ?? typeOf(e).footprint_m.d });
const box = (e) => {
  const { w, d } = dims(e);
  const { x, y } = e.position_m;
  return { x0: x - w / 2, x1: x + w / 2, y0: y - d / 2, y1: y + d / 2, cx: x, cy: y, w, d };
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const out = [];
const add = (s) => out.push(s);
const path = (pts, stroke, w, dash) =>
  add(`<path d="${pts.map(([x, y], i) => `${i ? "L" : "M"}${X(x)} ${Y(y)}`).join(" ")}" stroke="${stroke}" stroke-width="${w}" fill="none"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linejoin="round"/>`);
// One dash rhythm for everything that is an assumption (dimensions and connections); solid = backed by a source.
const ASSUMED_DASH = "6 4";
const isAssumed = (c) => c.provenance.confidence === "assumed";
const tags = []; // 가정 tags are drawn last so nothing covers them
const late = []; // machine names: drawn after the lines so no line cuts through a name
const HALO = ' stroke="#f3f6f6" stroke-width="3" paint-order="stroke"';
const textRects = []; // rough boxes of the names, so a 가정 tag never lands on one
const textWidth = (t, size) => [...String(t)].reduce((w, c) => w + (/[\u3131-\uD79D]/.test(c) ? size : size * 0.6), 0);
const noteText = (x, y, t, size, anchor = "start") => {
  const w = textWidth(t, size);
  const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  textRects.push({ x0, x1: x0 + w, y0: y - size, y1: y + 2 });
};
const assumedTag = (px, py, anchor = "start", conn = false) => tags.push({ px, py, anchor, conn });
const text = (x, y, t, size = 11, fill = "#203438", weight = 400, anchor = "middle", raw = false) =>
  add(`<text x="${raw ? x : X(x)}" y="${raw ? y : Y(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(t)}</text>`);

// Korean needs a Korean face: without one the text falls back to tofu boxes outside macOS.
const FONT = "'IBM Plex Sans KR','Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif";
add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`);
add(`<style>text{font-family:${FONT}}</style>`);
add(`<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#b9c3c1" stroke-width="2"/></pattern></defs>`);
add(`<rect width="${W}" height="${H}" fill="#f3f6f6"/>`);
add(`<text x="40" y="36" font-size="20" font-weight="700" fill="#203438">${esc(p.factory.name)} · ${esc(p.factory.line_id)} 배치도 (프로파일에서 생성)</text>`);
add(`<text x="40" y="58" font-size="13" fill="#63767b">${esc(p.factory.industry)} · 평면도 · 1칸 = 1 m · 설비 ${p.equipment.length}개 · 이 그림은 contracts 프로파일 JSON에서 자동으로 그려졌다</text>`);

/* building + utility strip */
add(`<rect x="${X(0)}" y="${Y(0)}" width="${S * B.w}" height="${S * B.d}" fill="#f9fbfa" stroke="#9bafa1" stroke-width="2"/>`);
if (p.factory.utility_strip_depth_m)
  add(`<rect x="${X(0)}" y="${Y(0)}" width="${S * B.w}" height="${S * p.factory.utility_strip_depth_m}" fill="#eaf0ee"/>`);

/* connection geometry on routes */
const connsOn = (rid) => p.connections.filter((c) => c.route === rid);
const dropX = (c) => {
  const b = box(byId[c.to]);
  return b.cx + (c.drop_offset_m ?? 0);
};

/* trench footprint first (it sits under everything) */
const trenches = p.routes.filter((r) => r.kind === "trench").map((r) => {
  const y = r.polyline_m[0][1];
  const cs = connsOn(r.id);
  const xs = [...cs.map(dropX), ...cs.map((c) => box(byId[c.from]).cx)];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  return { r, y, x0, x1, cs };
});
for (const t of trenches) {
  add(`<rect x="${X(t.x0)}" y="${Y(t.y - 0.3)}" width="${S * (t.x1 - t.x0)}" height="${S * 0.6}" fill="url(#hatch)" stroke="#8a9a96" stroke-width="1.2" stroke-dasharray="6 3"/>`);
  text(t.x0 - 0.15, t.y + 0.08, "바닥 아래 트렌치", 9.5, "#6a7a76", 400, "end");
  text(t.x0 - 0.15, t.y + 0.08 + 12 / S, "(덮개 · 하중 등급 필요)", 9, "#6a7a76", 400, "end");
}

/* material flow (only the legs that carry waypoints) */
for (const f of p.flow) if (f.route_m || f.waypoints_m) path(f.route_m ?? f.waypoints_m, "#94a3a8", f.mode === "agv" ? 2 : 1.6, "2 5");

/* equipment */
const FILL = {
  process: ["#e3ebee", "#647f75"], utility: ["#e6ecee", "#647f75"], storage: ["#e6e3da", "#9a8f6e"],
  logistics: ["#e6e3da", "#9a8f6e"], control: ["#d8dedd", "#647f75"], robot: ["#8daa96", "#507362"],
};
const TYPE_FILL = {
  conveyor: ["#dfe6e4", "#647f75"], fixture: ["#c6d5ce", "#647f75"], positioner_2station: ["#c6d5ce", "#647f75"],
  reject_bin: ["#f3e2da", "#b9674f"], chiller: ["#dce8ec", "#3f8fbd"], coolant_tank_pump: ["#e6eef1", "#3f8fbd"],
  gas_manifold: ["#e8ece6", "#6d8e7d"], dust_collector: ["#e4e6e0", "#8a8f7e"], stock: ["#efece3", "#9a8f6e"],
  torch_cleaner: ["#dce8de", "#507362"],
};
const wrap = (t, maxPx, size) => {
  if (t.length * size * 0.95 <= maxPx || !t.includes(" ")) return [t];
  const mid = t.length / 2;
  let best = -1;
  [...t].forEach((c, i) => c === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) && (best = i));
  return [t.slice(0, best), t.slice(best + 1)];
};

const EVID = { sourced: ["#2e9b6a", "직접 확인"], secondary: ["#e0a030", "보조 출처"], assumed: ["#c3ccd0", "가정"] };
const footprintEvidence = (e) => (e.footprint_m ? "assumed" : typeOf(e).provenance.footprint_m.confidence);
const evidenceDot = (x, y, conf) =>
  add(`<circle cx="${x}" cy="${y}" r="3.6" fill="${EVID[conf][0]}" stroke="#ffffff" stroke-width="1"/>`);

const order = (e) => (e.type === "conveyor" ? 0 : typeOf(e).category === "robot" ? 2 : 1);
// every machine's drawn box in px (robots: the base circle), so outside names can avoid them
const boxRects = p.equipment.filter((e) => e.type !== "fume_hood").map((e) => {
  const b = box(e);
  if (typeOf(e).shape === "robot") {
    const r = Math.max(S * b.w * 0.6, 9);
    return { id: e.id, x0: X(b.cx) - r, x1: X(b.cx) + r, y0: Y(b.cy) - r, y1: Y(b.cy) + r };
  }
  return { id: e.id, x0: X(b.x0), x1: X(b.x1), y0: Y(b.y0), y1: Y(b.y1) };
});
for (const e of [...p.equipment].sort((a, b) => order(a) - order(b))) {
  const t = typeOf(e);
  const b = box(e);
  const [fill, stroke] = TYPE_FILL[e.type] ?? FILL[t.category];
  const lab = e.label ?? { title: t.name_ko };
  const wpx = b.w * S;
  const dimAssumed = e.type !== "conveyor" && footprintEvidence(e) === "assumed";
  const dash = dimAssumed ? ` stroke-dasharray="${ASSUMED_DASH}"` : "";

  if (t.shape === "robot") {
    add(`<circle cx="${X(b.cx)}" cy="${Y(b.cy)}" r="${S * (t.reach_m ?? 1.9)}" fill="none" stroke="#9bafa1" stroke-width="1.1" stroke-dasharray="5 4"/>`);
    add(`<circle cx="${X(b.cx)}" cy="${Y(b.cy)}" r="${Math.max(S * b.w * 0.6, 9)}" fill="${fill}" stroke="${stroke}" stroke-width="2"${dash}/>`);
    if (dimAssumed) assumedTag(X(b.cx) + 12, Y(b.cy) - 16);
    evidenceDot(X(b.cx) - 11, Y(b.cy) - 11, footprintEvidence(e));
    late.push(`<text x="${X(b.cx) + 16}" y="${Y(b.cy + 0.4)}" font-size="11.5" font-weight="700" fill="#203438"${HALO}>${esc(lab.title)}</text>`);
    noteText(X(b.cx) + 16, Y(b.cy + 0.4), lab.title, 11.5);
    if (lab.sub) noteText(X(b.cx) + 16, Y(b.cy + 0.4) + 13, lab.sub, 10.5);
    if (lab.sub) late.push(`<text x="${X(b.cx) + 16}" y="${Y(b.cy + 0.4) + 13}" font-size="10.5" fill="#63767b"${HALO}>${esc(lab.sub)}</text>`);
    continue;
  }
  if (t.shape === "ellipse") {
    add(`<ellipse cx="${X(b.cx)}" cy="${Y(b.cy)}" rx="${S * b.w / 2}" ry="${S * b.d / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash}/>`);
  } else if (e.type === "fume_hood") {
    add(`<rect x="${X(b.x0)}" y="${Y(b.y0)}" width="${S * b.w}" height="${S * b.d}" rx="2" fill="none" stroke="#9bafa1" stroke-width="1.3" stroke-dasharray="${ASSUMED_DASH}"/>`);
    if (dimAssumed) assumedTag(X(b.x1) - 2, Y(b.y0) + 2, "end");
    if (lab.sub) text(b.x1 + 0.15, b.y1 - 0.1, lab.sub, 9.5, "#63767b", 400, "start");
    continue;
  } else {
    add(`<rect x="${X(b.x0)}" y="${Y(b.y0)}" width="${S * b.w}" height="${S * b.d}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="${e.type === "conveyor" ? 1.4 : 1.5}"${dash}/>`);
  }
  // small boxes: the tag sits just above the box so it never covers the name
  if (dimAssumed && t.shape !== "robot") assumedTag(X(b.x1) - 2, wpx < 70 || b.d * S < 40 ? Y(b.y0) - 14 : Y(b.y0) + 2, "end");
  if (e.type !== "conveyor") evidenceDot(X(b.x0) + 6, Y(b.y0) + 6, footprintEvidence(e));
  if (e.type === "positioner_2station")
    add(`<line x1="${X(b.cx)}" y1="${Y(b.y0)}" x2="${X(b.cx)}" y2="${Y(b.y1)}" stroke="#647f75" stroke-width="1.2"/>`);

  const size = wpx < 60 ? 9 : wpx < 95 ? 10 : 11;
  // name goes outside to the right whenever it would not fit inside the box (utility-strip machines, etc.)
  const outside = !lab.title || wpx < 20 || textWidth(lab.title, size) > wpx - 8;
  const lines = lab.title ? (outside ? [lab.title] : wrap(lab.title, wpx - 6, size)) : [];
  const sub = outside ? null : lab.sub; // subtitles stay inside; outside shows the name only
  const n = lines.length + (sub ? 1 : 0);
  let lx = outside ? X(b.x1) + 8 : X(b.cx);
  let anchor = outside ? "start" : "middle";
  let ly = Y(b.cy) - ((n - 1) * 13) / 2 + 4;
  if (outside && lab.title) {
    // right of the box, unless that lands on another machine or name: then below, then above
    const tw = textWidth(lab.title, size);
    const spots = [
      [X(b.x1) + 8, Y(b.cy) + 4, "start"],
      [X(b.cx), Y(b.y1) + size + 3, "middle"],
      [X(b.cx), Y(b.y0) - 4, "middle"],
    ];
    const free = ([x, y, a]) => {
      const x0 = a === "middle" ? x - tw / 2 : x;
      const r = { x0, x1: x0 + tw, y0: y - size, y1: y + 2 };
      const hit = (o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0;
      return !boxRects.some((o) => o.id !== e.id && hit(o)) && !textRects.some(hit);
    };
    [lx, ly, anchor] = spots.find(free) ?? spots[0];
  }
  for (const l of lines) {
    // outside names get a background-coloured halo so a line passing underneath never cuts through them
    late.push(`<text x="${lx}" y="${ly}" font-size="${size}" font-weight="600" fill="#203438" text-anchor="${anchor}"${outside ? HALO : ""}>${esc(l)}</text>`);
    noteText(lx, ly, l, size, anchor);
    ly += 13;
  }
  if (sub) noteText(lx, ly, sub, size - 1.5, anchor);
  if (sub) late.push(`<text x="${lx}" y="${ly}" font-size="${size - 1.5}" fill="#63767b" text-anchor="${anchor}">${esc(sub)}</text>`);
  if (lab.below) {
    lab.below.split("\n").forEach((l, i) =>
      add(`<text x="${X(b.cx)}" y="${Y(b.y1) + 16 + i * 14}" font-size="${i ? 9.5 : 11.5}" font-weight="${i ? 400 : 600}" fill="${i ? "#63767b" : "#304c40"}" text-anchor="middle">${esc(l)}</text>`),
    );
  }
}

/* buses */
for (const r of p.routes.filter((r) => r.kind === "bus")) {
  const n = NET[r.net];
  const y = r.polyline_m[0][1];
  const cs = connsOn(r.id);
  const srcs = [...new Set(cs.map((c) => c.from))];
  // a shared bus is only solid when every connection it carries is backed by a source
  path(r.polyline_m, n.color, n.w + 0.4, cs.some(isAssumed) ? ASSUMED_DASH : undefined);
  for (const s of srcs) {
    const b = box(byId[s]);
    path([[b.cx, b.cy < y ? b.y1 : b.y0], [b.cx, y]], n.color, n.w, cs.filter((c) => c.from === s).some(isAssumed) ? ASSUMED_DASH : undefined);
  }
  for (const c of cs) {
    const b = box(byId[c.to]);
    const x = dropX(c);
    const yEnd = b.cy > y ? b.y0 : b.y1;
    path([[x, y], [x, yEnd]], n.color, n.w - 0.2, isAssumed(c) ? ASSUMED_DASH : undefined);
    if (c.status === "needs_confirmation") text(x + 0.35, (y + yEnd) / 2, "?", 13, n.color, 700);
    if (isAssumed(c)) assumedTag(X(x) + 3, Y((y + yEnd) / 2) + (c.status === "needs_confirmation" ? 6 : -6), "start", true);
  }
}

/* trench pipes + hidden branches */
for (const t of trenches) {
  // the hatched strip says "below the floor"; the stroke itself follows the evidence rule like every other line
  const trenchDash = t.cs.some(isAssumed) ? ASSUMED_DASH : undefined;
  path([[t.x0, t.y - 0.1], [t.x1, t.y - 0.1]], NET.cooling.color, 2.6, trenchDash);
  path([[t.x0, t.y + 0.1], [t.x1, t.y + 0.1]], RETURN, 2.6, trenchDash);
  for (const s of new Set(t.cs.map((c) => c.from))) {
    const b = box(byId[s]);
    path([[b.cx, b.cy < t.y ? b.y1 : b.y0], [b.cx, t.y - 0.3]], NET.cooling.color, 2.2, t.cs.filter((c) => c.from === s).some(isAssumed) ? ASSUMED_DASH : undefined);
  }
  for (const c of t.cs) {
    const b = box(byId[c.to]);
    const x = dropX(c);
    const pending = c.status === "needs_confirmation";
    const y0 = b.cy > t.y ? t.y + 0.3 : t.y - 0.3;
    const y1 = b.cy > t.y ? b.y0 : b.y1;
    path([[x, y0], [x, y1]], NET.cooling.color, 2.4, isAssumed(c) ? ASSUMED_DASH : undefined);
    if (pending) text(x + 0.35, (y0 + y1) / 2, "?", 13, NET.cooling.color, 700);
    if (isAssumed(c)) assumedTag(X(x) + 3, Y((y0 + y1) / 2) + (pending ? 6 : -6), "start", true);
  }
}

/* point-to-point connections */
for (const c of p.connections.filter((c) => !c.route && c.waypoints_m)) {
  const n = NET[c.net];
  path(c.waypoints_m, n.color, n.w, isAssumed(c) ? ASSUMED_DASH : undefined);
  if (isAssumed(c)) {
    const [a, b] = [c.waypoints_m[Math.floor((c.waypoints_m.length - 1) / 2)], c.waypoints_m[Math.floor((c.waypoints_m.length - 1) / 2) + 1]];
    assumedTag(X((a[0] + b[0]) / 2) + 3, Y((a[1] + b[1]) / 2) - 6, "start", true);
  }
}

for (const l of late) add(l);

/* 가정 tags (#f3f6f6 chip, text-3), on top of everything. A connection tag that finds no free spot near its line
   is left out rather than drawn over a name; its line is still dashed (see the legend). */
let skippedTags = 0;
const placedTags = [];
const NUDGE = [0, 13, -13, 26, -26, 39, -39].flatMap((dy) => [0, 12, -12, 24, -24, 36, -36].map((dx) => [dx, dy]));
for (const { px, py: py0, anchor, conn } of tags) {
  const w = 22;
  const bx = anchor === "end" ? px - w : px;
  // nudge in small steps until it sits on neither another tag nor a name
  let [x0, py] = [bx, py0];
  const free = ([dx, dy]) => {
    const r = { x0: bx + dx, x1: bx + dx + w, y0: py0 + dy, y1: py0 + dy + 12 };
    const clash = (o) => r.x0 < o.x1 + 2 && r.x1 + 2 > o.x0 && r.y0 < o.y1 + 1 && r.y1 + 1 > o.y0;
    return !placedTags.some(clash) && !textRects.some(clash);
  };
  const found = NUDGE.find(free);
  if (!found && conn) {
    skippedTags++;
    continue;
  }
  const spot = found ?? [0, 0];
  [x0, py] = [bx + spot[0], py0 + spot[1]];
  placedTags.push({ x0, x1: x0 + w, y0: py, y1: py + 12 });
  add(`<g><rect x="${x0}" y="${py}" width="${w}" height="12" rx="3" fill="#f3f6f6" stroke="#e1e8e7" stroke-width="0.6"/><text x="${x0 + w / 2}" y="${py + 9}" font-size="8.5" font-weight="500" fill="#6a8879" text-anchor="middle">가정</text></g>`);
}

/* legend */
const used = [...new Set(p.connections.map((c) => c.net))];
const legY = Math.round(96 + S * B.d + 50);
add(`<g transform="translate(40 ${legY})">`);
add(`<text x="0" y="0" font-size="13" font-weight="700" fill="#203438">범례</text>`);
const items = [];
for (const net of ["cooling", "power", "air", "gas", "exhaust", "bundle", "signal"]) if (used.includes(net)) items.push({ col: NET[net].color, w: Math.min(NET[net].w + 0.6, 5), label: NET[net].label + (net === "cooling" ? " (바닥 아래 트렌치)" : "") });
if (used.includes("cooling")) items.push({ col: RETURN, w: 3, label: "냉각수 환수" });
items.push({ col: "#647f75", w: 2, label: "실선: 근거 있는 치수·연결" });
items.push({ col: "#647f75", w: 2, dash: ASSUMED_DASH, label: "점선 + 가정: 가정한 치수·연결", tag: true });
if (p.connections.some((c) => c.status === "needs_confirmation")) items.push({ col: NET.cooling.color, w: 2, dash: ASSUMED_DASH, label: "? 확인 필요한 연결 (가정)" });
items.push({ col: "#94a3a8", w: 2, dash: "2 5", label: "수동·카트·AGV 이송" });
items.forEach((it, i) => {
  const col = Math.floor(i / 4);
  const row = i % 4;
  const x = col * 300;
  const y = 22 + row * 22;
  add(`<line x1="${x}" y1="${y}" x2="${x + 34}" y2="${y}" stroke="${it.col}" stroke-width="${it.w}"${it.dash ? ` stroke-dasharray="${it.dash}"` : ""}/><text x="${x + 44}" y="${y + 4}" font-size="12" fill="#203438">${esc(it.label)}</text>`);
  if (it.tag) add(`<rect x="${x + 6}" y="${y - 12}" width="22" height="12" rx="3" fill="#f3f6f6" stroke="#e1e8e7" stroke-width="0.6"/><text x="${x + 17}" y="${y - 3}" font-size="8.5" font-weight="500" fill="#6a8879" text-anchor="middle">가정</text>`);
});
add(`</g>`);

/* evidence legend */
add(`<g transform="translate(${40 + 3 * 300} ${legY})">`);
add(`<text x="0" y="0" font-size="13" font-weight="700" fill="#203438">치수 근거 (설비 모서리의 점)</text>`);
Object.values(EVID).forEach(([col, label], i) => {
  add(`<circle cx="6" cy="${22 + i * 22}" r="4.5" fill="${col}" stroke="#ffffff" stroke-width="1"/><text x="20" y="${26 + i * 22}" font-size="12" fill="#203438">${label}</text>`);
});
add(`</g>`);

/* provenance summary */
const a = p.assumptions;
const takt = (a.working_days_per_year * a.shifts_per_day * a.productive_hours_per_shift * 3600 * a.oee) / a.annual_volume_units;
const sourced = p.connections.filter((c) => c.provenance.confidence === "sourced").length;
const pending = p.connections.filter((c) => c.status === "needs_confirmation").length;
const dimCount = { sourced: 0, secondary: 0, assumed: 0 };
for (const e of p.equipment) if (e.type !== "conveyor") dimCount[footprintEvidence(e)]++;
const SHORT = { sourced: "직접", secondary: "보조", assumed: "가정" };
const refs = Object.values(p.catalog).filter((t) => t.model).map((t) => `${t.name_ko}: ${t.model} ${t.footprint_m.w}×${t.footprint_m.d} m [${SHORT[t.provenance.footprint_m.confidence]}]`);
const refLines = [];
let cur = "참조 모델(치수 근거) — ";
for (const r of refs) {
  if ((cur + r).length > 150) { refLines.push(cur.trimEnd().replace(/ ·$/, "")); cur = ""; }
  cur += r + " · ";
}
refLines.push(cur.trimEnd().replace(/ ·$/, ""));
add(`<g transform="translate(40 ${legY + 114})" font-size="11" fill="#63767b">`);
refLines.forEach((l, i) => add(`<text x="0" y="${51 + i * 17}">${esc(l)}</text>`));
add(`<text x="0" y="0">설비 치수 근거: 직접 확인 ${dimCount.sourced} · 보조 출처 ${dimCount.secondary} · 가정 ${dimCount.assumed}. 연결 ${p.connections.length}개 중 근거 있음 ${sourced} · 가정 ${p.connections.length - sourced} · 확인 필요 ${pending}. 연 ${a.annual_volume_units.toLocaleString()}개 가정 → 택트 타임 ${takt.toFixed(1)}초 (검증: node scripts/check-factory-profile.mjs).</text>`);
add(`<text x="0" y="17">출처 ${p.sources.length}건은 프로파일의 sources 참고. 핵심 설비 7종은 제조사 제원 기준(위 점 색 참고), 나머지 치수와 모든 사이클 타임은 가정. 안전 방호(펜스·광커튼)는 도면에서 제외(요청).</text>`);
add(`</g>`);
add(`</svg>`);

writeFileSync(outPath, out.join("\n") + "\n");
console.log("wrote", outPath.replace(root + "/", ""), `(${p.equipment.length} equipment, ${p.connections.length} connections, 가정 tags ${tags.length - skippedTags}, left out for space ${skippedTags})`);
