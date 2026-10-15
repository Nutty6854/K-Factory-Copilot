"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Equipment } from "@/data/demo";
import type { PlantSim } from "@/data/plantSim";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PlantScene, useWarmSim, type SceneTokens } from "@/components/map/PlantScene";
import {
  BUILDING,
  LABELED,
  REF_SIDE_M,
  SELECTABLE,
  ZONES,
  boxOf,
  byDemoId,
  cellPoints,
  connectionsOf,
  footprintAssumed,
  isSelectable,
  subOf,
  titleOf,
  type ConnPath,
} from "@/components/map/plantMapData";

/*
 * Main map: the whole line in 3D from the factory profile, inside the v2 shell.
 *  stage 1 (far):  floor zone names + ! pins only
 *  stage 2 (near): name labels (right of the box, pushed apart), ! pins stay, hover adds the subtitle
 *  stage 3 (selected / abnormal): the camera eases to the cell, the selected machine's connections are drawn
 * The map never shows scores, numbers or a legend. Judgement stays with the Rule Engine (statuses come in via props).
 */

type Props = {
  equipment: Equipment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Map controls and the first-entry hint only show on the 지도 tab */
  showControls?: boolean;
};

/** Detail card geometry (Figma 7:23): 384 wide, 16 from the right edge. */
const CARD = { right: 16, width: 384 };

/**
 * Safe zone for equipment, labels and ! pins (figma bro chrome spec): x 120 to (detail card left − 80),
 * y 96 to (height − 40). Computed from the real canvas size, so 1440 gives 960 and 1280 gives 800.
 */
function safeZone(w: number, h: number) {
  const right = w - CARD.right - CARD.width - 80;
  return { l: 120, t: 96, w: Math.max(right - 120, 200), h: Math.max(h - 40 - 96, 200) };
}
/** Share of the safe zone the whole line fills, and a selected cell fills. */
const FIT_HOME = 0.94;
const FIT_CELL = 0.86;
const VIEW_DIR = new THREE.Vector3(0, 8.4, 6.6).normalize();
const EASE_MS = 400;
/** Stage 2 starts when one machine side is this many px on screen, and ends below STAGE_OUT. */
const STAGE_IN = 48;
const STAGE_OUT = 40;
const HINT_MS = 4000;
/** An anomaly does not steal the camera within this long after the user dragged or zoomed. */
const INTERACT_GRACE_MS = 1200;

type MapApi = { zoom: (factor: number) => void; rotate: (rad: number) => void; home: () => void };
type View = { target: THREE.Vector3; position: THREE.Vector3; off: [number, number]; dist: number };
type Focus = { key: string; id: string } | null;

const HOME_POINTS = (() => {
  const pts: THREE.Vector3[] = [];
  for (const x of [0, BUILDING.w]) for (const z of [0, BUILDING.d]) for (const y of [0, 2.6]) pts.push(new THREE.Vector3(x, y, z));
  return pts;
})();

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function projectRect(points: THREE.Vector3[], cam: THREE.Camera, w: number, h: number) {
  const v = new THREE.Vector3();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    v.copy(p).project(cam);
    const x = ((v.x + 1) / 2) * w;
    const y = ((1 - v.y) / 2) * h;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Camera pose that puts `points` inside the safe zone: distance by iteration along `dir`,
 * then a view offset so the projected centre lands on the safe-zone centre. The camera is restored afterwards.
 */
function solveView(camera: THREE.PerspectiveCamera, points: THREE.Vector3[], dir: THREE.Vector3, w: number, h: number, fit: number): View {
  const safe = safeZone(w, h);
  const target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const saved = { pos: camera.position.clone(), quat: camera.quaternion.clone(), view: camera.view ? { ...camera.view } : null };
  camera.clearViewOffset();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  let dist = 40;
  let rect = projectRect(points, camera, w, h);
  for (let i = 0; i < 10; i++) {
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    rect = projectRect(points, camera, w, h);
    const s = Math.max((rect.maxX - rect.minX) / (safe.w * fit), (rect.maxY - rect.minY) / (safe.h * fit));
    if (Math.abs(s - 1) < 0.002) break;
    dist *= s;
  }
  const off: [number, number] = [(rect.minX + rect.maxX) / 2 - (safe.l + safe.w / 2), (rect.minY + rect.maxY) / 2 - (safe.t + safe.h / 2)];
  const position = camera.position.clone();
  camera.position.copy(saved.pos);
  camera.quaternion.copy(saved.quat);
  if (saved.view) camera.setViewOffset(saved.view.fullWidth, saved.view.fullHeight, saved.view.offsetX, saved.view.offsetY, saved.view.width, saved.view.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return { target, position, off, dist };
}

/**
 * Fits the whole line into the safe zone on load / resize / home, eases to a cell when `focus` names one,
 * and back to the whole line when it clears. Orbit, zoom and the map buttons keep working around the result.
 */
function CameraRig({
  focus,
  apiRef,
  interactRef,
  onHome,
}: {
  focus: Focus;
  apiRef: RefObject<MapApi | null>;
  interactRef: MutableRefObject<{ active: boolean; last: number }>;
  onHome: () => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const size = useThree((s) => s.size);
  const off = useRef<[number, number]>([0, 0]);
  const home = useRef<View | null>(null);
  const anim = useRef<{ from: View; to: View; t0: number } | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  const applyOffset = useCallback(() => {
    const { width: w, height: h } = size;
    camera.setViewOffset(w, h, off.current[0], off.current[1], w, h);
    camera.updateProjectionMatrix();
  }, [camera, size]);

  const goal = useCallback((): View | null => {
    const { width: w, height: h } = size;
    if (!w || !h) return null;
    home.current = solveView(camera, HOME_POINTS, VIEW_DIR, w, h, FIT_HOME);
    if (controls) {
      controls.minDistance = home.current.dist * 0.12;
      controls.maxDistance = home.current.dist * 1.35;
    }
    const f = focusRef.current;
    const e = f ? byDemoId(f.id) : null;
    if (!e) return home.current;
    // keep the user's current heading, but look down at the same pitch as the default view
    const dir = controls ? camera.position.clone().sub(controls.target).setY(0) : new THREE.Vector3();
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(Math.hypot(VIEW_DIR.x, VIEW_DIR.z)).setY(VIEW_DIR.y);
    return solveView(camera, cellPoints(e), dir.normalize(), w, h, FIT_CELL);
  }, [camera, controls, size]);

  const jump = useCallback(
    (v: View) => {
      anim.current = null;
      camera.position.copy(v.position);
      off.current = [...v.off];
      applyOffset();
      if (controls) {
        controls.target.copy(v.target);
        controls.enabled = true;
        controls.update();
      }
    },
    [applyOffset, camera, controls],
  );

  const ease = useCallback(
    (v: View) => {
      if (!controls) return jump(v);
      anim.current = {
        from: { target: controls.target.clone(), position: camera.position.clone(), off: [...off.current], dist: 0 },
        to: v,
        t0: performance.now(),
      };
      controls.enabled = false;
    },
    [camera, controls, jump],
  );

  // size change: place the camera without animation (R3F rewrites the projection on resize, so do it for a couple of frames)
  const settle = useRef(0);
  useEffect(() => {
    settle.current = 0;
  }, [size.width, size.height, controls]);

  // focus change: ease to the cell or back home
  const firstFocus = useRef(true);
  useEffect(() => {
    if (firstFocus.current) {
      firstFocus.current = false;
      return;
    }
    const v = goal();
    if (v) ease(v);
  }, [focus?.key, goal, ease]);

  useFrame(() => {
    if (settle.current < 3) {
      settle.current += 1;
      const v = goal();
      if (v) jump(v);
      return;
    }
    const a = anim.current;
    if (!a || !controls) return;
    const k = Math.min(1, (performance.now() - a.t0) / EASE_MS);
    const e = easeOut(k);
    controls.target.lerpVectors(a.from.target, a.to.target, e);
    camera.position.lerpVectors(a.from.position, a.to.position, e);
    off.current[0] = a.from.off[0] + (a.to.off[0] - a.from.off[0]) * e;
    off.current[1] = a.from.off[1] + (a.to.off[1] - a.from.off[1]) * e;
    applyOffset();
    controls.update();
    if (k >= 1) {
      anim.current = null;
      controls.enabled = true;
    }
  });

  // user input cancels an animation and holds back anomaly auto-focus for a moment
  useEffect(() => {
    if (!controls) return;
    const start = () => {
      interactRef.current.active = true;
      interactRef.current.last = performance.now();
    };
    const end = () => {
      interactRef.current.active = false;
      interactRef.current.last = performance.now();
    };
    controls.addEventListener("start", start);
    controls.addEventListener("end", end);
    return () => {
      controls.removeEventListener("start", start);
      controls.removeEventListener("end", end);
    };
  }, [controls, interactRef]);

  useEffect(() => {
    const orbit = (mutate: (offset: THREE.Vector3) => void) => {
      if (!controls) return;
      anim.current = null;
      controls.enabled = true;
      const o = camera.position.clone().sub(controls.target);
      mutate(o);
      const len = THREE.MathUtils.clamp(o.length(), controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(o.setLength(len));
      controls.update();
    };
    apiRef.current = {
      zoom: (factor) => orbit((o) => o.multiplyScalar(factor)),
      rotate: (rad) => orbit((o) => o.applyAxisAngle(new THREE.Vector3(0, 1, 0), rad)),
      home: () => {
        onHome();
        const { width: w, height: h } = size;
        if (w && h) ease(solveView(camera, HOME_POINTS, VIEW_DIR, w, h, FIT_HOME));
      },
    };
  }, [apiRef, camera, controls, ease, onHome, size]);

  return null;
}

/* ── overlay: labels, ! pins, zone names, 가정 tags (DOM, constant screen size) ── */

type Rect = { x0: number; y0: number; x1: number; y1: number };
type OverlayEls = {
  host: RefObject<HTMLDivElement | null>;
  labels: MutableRefObject<(HTMLElement | null)[]>;
  leaders: MutableRefObject<(SVGLineElement | null)[]>;
  pins: MutableRefObject<(HTMLElement | null)[]>;
  zones: MutableRefObject<(HTMLElement | null)[]>;
  tags: MutableRefObject<(HTMLElement | null)[]>;
};
/** Label sits this far right of the box's projected right edge. */
const LABEL_GAP = 8;
const NEAR_Y = 8;
const NEAR_X = 4;
/** In place, then 14 px up / down; past that the label keeps a leader line back to its machine. */
const SLOTS = [
  { dy: 0, leader: false },
  { dy: -14, leader: false },
  { dy: 14, leader: false },
  // main map rule: a label is never dropped for lack of room; it moves further out on a leader instead
  ...Array.from({ length: 24 }, (_, i) => 28 + i * 14).flatMap((d) => [
    { dy: -d, leader: true },
    { dy: d, leader: true },
  ]),
];
const hits = (r: Rect, o: Rect, gx: number, gy: number) => r.x0 < o.x1 + gx && r.x1 + gx > o.x0 && r.y0 < o.y1 + gy && r.y1 + gy > o.y0;
const PIN = 22;

/** Box corners per labelled machine, relative to its centre (AGVs move, so their centre comes from the sim). */
const LABEL_CORNERS = LABELED.map((e) => {
  const b = boxOf(e);
  const y0 = e.type === "fume_hood" ? 1.9 : 0;
  const out: [number, number, number][] = [];
  for (const ox of [-b.w / 2, b.w / 2]) for (const oz of [-b.d / 2, b.d / 2]) for (const oy of [y0, y0 + b.h]) out.push([ox, oy, oz]);
  return out;
});
const LABEL_PRI = LABELED.map((e) => (isSelectable(e) ? 5 : 6));
const LABEL_AREA = LABELED.map((e) => {
  const b = boxOf(e);
  return b.w * b.d;
});

type Item = { el: HTMLElement; leader: SVGLineElement | null; w: number; h: number; ax: number; bx: number; ay: number; visible: boolean; pri: number; area: number };

function Overlay({
  els,
  sim,
  abnormal,
  selectedId,
  hoveredId,
  tags,
  stageRef,
  onStage,
}: {
  els: OverlayEls;
  sim: MutableRefObject<PlantSim>;
  abnormal: boolean[];
  selectedId: string | null;
  hoveredId: string | null;
  tags: ConnPath[];
  stageRef: MutableRefObject<1 | 2>;
  onStage: (s: 1 | 2) => void;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const sp = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  const obstacleEls = useRef<Element[]>([]);
  const lastQuery = useRef(-1e9);
  const items = useRef<Item[]>([]);
  const placed = useRef<Rect[]>([]);
  const obstacles = useRef<Rect[]>([]);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;

  useFrame((state) => {
    const host = els.host.current;
    if (!host) return;
    const W = state.size.width;
    const H = state.size.height;
    const cam = state.camera;
    // projects into the shared scratch point `sp` (no allocation per call)
    const toScreen = (x: number, y: number, z: number) => {
      v.set(x, y, z).project(cam);
      sp.x = ((v.x + 1) / 2) * W;
      sp.y = ((1 - v.y) / 2) * H;
      sp.z = v.z;
      return sp;
    };

    // stage: one machine side (REF_SIDE_M) measured at the orbit target
    const tgt = controls?.target;
    if (tgt) {
      right.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(REF_SIDE_M).add(tgt);
      toScreen(tgt.x, tgt.y, tgt.z);
      const ax = sp.x;
      const ay = sp.y;
      toScreen(right.x, right.y, right.z);
      const side = Math.hypot(sp.x - ax, sp.y - ay);
      const next = stageRef.current === 1 ? (side >= STAGE_IN ? 2 : 1) : side < STAGE_OUT ? 1 : 2;
      if (next !== stageRef.current) {
        stageRef.current = next;
        host.dataset.stage = next === 1 ? "far" : "near";
        onStage(next);
      }
    }
    const near = stageRef.current === 2;

    // chrome the map must stay clear of (cards, bars, toolbar), re-queried now and then
    // (time based, not frame based: a card that just opened must count right away even at a low frame rate)
    const now = performance.now();
    if (now - lastQuery.current > 150) {
      lastQuery.current = now;
      obstacleEls.current = Array.from(document.querySelectorAll("[data-map-obstacle]"));
    }
    const hr = host.getBoundingClientRect();
    obstacles.current.length = 0;
    for (const el of obstacleEls.current) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) obstacles.current.push({ x0: r.left - hr.left, y0: r.top - hr.top, x1: r.right - hr.left, y1: r.bottom - hr.top });
    }
    placed.current.length = 0;

    // ! pins: fixed 22 px, above abnormal robots
    SELECTABLE.forEach((e, i) => {
      const el = els.pins.current[i];
      if (!el) return;
      const b = boxOf(e);
      const { x: sx, y: sy, z: sz } = toScreen(b.cx, b.h + 0.25, b.cz);
      const show = abnormal[i] && sz <= 1 && sx > 0 && sx < W && sy > 0 && sy < H;
      el.style.visibility = show ? "visible" : "hidden";
      if (show) {
        el.style.transform = `translate(${(sx - PIN / 2).toFixed(1)}px, ${(sy - PIN - 6).toFixed(1)}px)`;
        placed.current.push({ x0: sx - PIN / 2, y0: sy - PIN - 6, x1: sx + PIN / 2, y1: sy });
      }
    });

    // zone names on the floor (stage 1 only; they fade out in stage 2)
    // Same rule as name labels: keep 8 px apart, push 14 px up/down when crowded (S1/S2/S3 sit close at 1280).
    const zoneRects: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const GAP = 8;
    const hit = (r: { x0: number; y0: number; x1: number; y1: number }) =>
      [...zoneRects, ...placed.current].some((o) => r.x0 < o.x1 + GAP && r.x1 + GAP > o.x0 && r.y0 < o.y1 + GAP && r.y1 + GAP > o.y0);
    ZONES.map((z, i) => ({ z, i, p: toScreen(z.at.x, 0, z.at.z) }))
      .sort((m, n) => m.p.x - n.p.x)
      .forEach(({ i, p }) => {
        const el = els.zones.current[i];
        if (!el) return;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        let dy = 0;
        for (const cand of [0, 14, -14, 28, -28, 42, -42]) {
          dy = cand;
          if (!hit({ x0: p.x - w / 2, y0: p.y + cand - h / 2, x1: p.x + w / 2, y1: p.y + cand + h / 2 })) break;
        }
        zoneRects.push({ x0: p.x - w / 2, y0: p.y + dy - h / 2, x1: p.x + w / 2, y1: p.y + dy + h / 2 });
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${(p.y + dy).toFixed(1)}px) translate(-50%, -50%)`;
        el.style.opacity = !near && p.z <= 1 ? "1" : "0";
      });

    // name labels + 가정 tags: stage 2 only, greedy placement so nothing touches
    const list = items.current;
    list.length = 0;
    if (near) {
      LABELED.forEach((e, i) => {
        const el = els.labels.current[i];
        if (!el) return;
        let cx = e.position_m.x;
        let cz = e.position_m.y;
        if (e.type === "agv") {
          const a = sim.current.agvs.find((q) => q.id === e.id);
          if (a) {
            cx = a.x;
            cz = a.z;
          }
        }
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        let behind = false;
        for (const [ox, oy, oz] of LABEL_CORNERS[i]) {
          toScreen(cx + ox, oy, cz + oz);
          if (sp.z > 1) behind = true;
          x0 = Math.min(x0, sp.x);
          x1 = Math.max(x1, sp.x);
          y0 = Math.min(y0, sp.y);
          y1 = Math.max(y1, sp.y);
        }
        const pri = e.demo_id && e.demo_id === selectedId ? 0 : e.id === hoveredId ? 1 : LABEL_PRI[i];
        list.push({ el, leader: els.leaders.current[i] ?? null, w: el.offsetWidth, h: el.offsetHeight, ax: x1, bx: x0, ay: (y0 + y1) / 2, visible: !behind && x1 > 0 && x0 < W && y1 > 0 && y0 < H, pri, area: LABEL_AREA[i] });
      });
      tags.forEach((t, j) => {
        const el = els.tags.current[j];
        if (!el) return;
        const { x: sx, y: sy, z: sz } = toScreen(t.tagAt.x, t.tagAt.y, t.tagAt.z);
        list.push({ el, leader: null, w: el.offsetWidth, h: el.offsetHeight, ax: sx - LABEL_GAP + 4, bx: sx, ay: sy, visible: sz <= 1, pri: 2, area: 0 });
      });
      list.sort((a, b) => a.pri - b.pri || b.area - a.area);
    } else {
      for (const el of els.labels.current) if (el) el.style.visibility = "hidden";
      for (const el of els.leaders.current) el?.setAttribute("visibility", "hidden");
      for (const el of els.tags.current) if (el) el.style.visibility = "hidden";
    }
    for (const it of list) {
      let at: Rect | null = null;
      let lead = false;
      let left = false;
      if (it.visible) {
        for (const side of [0, 1]) {
          for (const s of SLOTS) {
            const x0 = side ? it.bx - LABEL_GAP - it.w : it.ax + LABEL_GAP;
            const r = { x0, y0: it.ay + s.dy - it.h / 2, x1: x0 + it.w, y1: it.ay + s.dy + it.h / 2 };
            if (r.x0 < 4 || r.y0 < 4 || r.x1 > W - 4 || r.y1 > H - 4) continue;
            if (placed.current.some((o) => hits(r, o, NEAR_X, NEAR_Y)) || obstacles.current.some((o) => hits(r, o, 4, 4))) continue;
            at = r;
            lead = s.leader || side === 1;
            left = side === 1;
            break;
          }
          if (at) break;
        }
      }
      if (!at && it.visible) {
        // still no free spot: keep the label anyway, right of the box on a leader, only stepping off the chrome
        for (const s of SLOTS) {
          const x0 = it.ax + LABEL_GAP + 18;
          const r = { x0, y0: it.ay + s.dy - it.h / 2, x1: x0 + it.w, y1: it.ay + s.dy + it.h / 2 };
          if (r.y0 < 4 || r.y1 > H - 4 || obstacles.current.some((o) => hits(r, o, 4, 4))) continue;
          at = r;
          lead = true;
          break;
        }
      }
      if (!at) {
        // only a machine that is itself under a card or off the canvas edge ends up here
        it.el.style.visibility = "hidden";
        it.leader?.setAttribute("visibility", "hidden");
        continue;
      }
      placed.current.push(at);
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

/** The one 가정 marker (figma bro): #f3f6f6 background, text-3. */
function AssumedTag() {
  return <span className="rounded-[4px] bg-[#f3f6f6] px-1 text-[9.5px] font-medium leading-[13px] text-ink-3">가정</span>;
}

/* ── map chrome ───────────────────────────────────────────────────────── */

const CONTROL_GROUPS: { icon: IconName; label: string; run: (api: MapApi) => void }[][] = [
  [
    { icon: "zoom-in", label: "확대", run: (a) => a.zoom(0.8) },
    { icon: "zoom-out", label: "축소", run: (a) => a.zoom(1.25) },
  ],
  [
    { icon: "rotate-left", label: "왼쪽으로 회전", run: (a) => a.rotate(-Math.PI / 12) },
    { icon: "rotate-right", label: "오른쪽으로 회전", run: (a) => a.rotate(Math.PI / 12) },
  ],
  [{ icon: "home", label: "처음 시점", run: (a) => a.home() }],
];

const MAP_TOKENS: Record<keyof SceneTokens, string> = {
  bg: "--kf-bg",
  floor: "--kf-map-floor",
  grid: "--kf-map-grid",
  floorEdge: "--kf-map-floor-edge",
  primary: "--kf-primary",
  equipAnom: "--kf-equip-anom",
  warn: "--kf-warn",
  text3: "--kf-text-3",
};

/**
 * Colors come only from the :root variables in app/globals.css (same sheet Tailwind reads).
 * This component is client-only (next/dynamic ssr:false), so the document is available on first render.
 */
function readMapTokens(): SceneTokens {
  const s = getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(MAP_TOKENS).map(([key, cssVar]) => [key, s.getPropertyValue(cssVar).trim()])) as SceneTokens;
}

/** ?fps=1 dev readout for real-device checks (same probe as /lab/cell; also window.__kfFps). Not part of the demo UI. */
function FpsProbe({ onFps }: { onFps: (fps: number) => void }) {
  const acc = useRef({ frames: 0, t: performance.now() });
  useFrame(() => {
    const a = acc.current;
    a.frames += 1;
    const now = performance.now();
    if (now - a.t >= 1000) {
      const fps = (a.frames * 1000) / (now - a.t);
      const w = window as unknown as { __kfFps?: number[] };
      (w.__kfFps ??= []).push(fps);
      onFps(fps);
      a.frames = 0;
      a.t = now;
    }
  });
  return null;
}

export function FactoryMap({ equipment, selectedId, onSelect, showControls = true }: Props) {
  const [showFps] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fps") === "1");
  const [fps, setFps] = useState<number | null>(null);
  const [tokens] = useState(readMapTokens);
  const apiRef = useRef<MapApi | null>(null);
  const sim = useWarmSim();
  const [hint, setHint] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [stage, setStage] = useState<1 | 2>(1);
  const stageRef = useRef<1 | 2>(1);
  const interactRef = useRef({ active: false, last: 0 });

  useEffect(() => {
    const id = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(id);
  }, []);

  const statusById = useMemo(() => Object.fromEntries(equipment.map((e) => [e.id, e.status])), [equipment]);
  const abnormal = useMemo(() => SELECTABLE.map((e) => statusById[e.demo_id!] === "abnormal"), [statusById]);

  /* stage 3: selection eases to the cell; a new anomaly does too, once, unless the user is busy or looking elsewhere */
  const [focus, setFocus] = useState<Focus>(null);
  const selSeq = useRef(0);
  useEffect(() => {
    if (selectedId && byDemoId(selectedId)) setFocus({ key: `sel:${selectedId}:${++selSeq.current}`, id: selectedId });
    else setFocus(null);
  }, [selectedId]);
  const seenAnomaly = useRef(new Set<string>());
  useEffect(() => {
    for (const e of equipment) {
      if (e.status !== "abnormal" || !e.injectionId || seenAnomaly.current.has(e.injectionId)) continue;
      seenAnomaly.current.add(e.injectionId);
      const busy = interactRef.current.active || performance.now() - interactRef.current.last < INTERACT_GRACE_MS;
      if (busy || (selectedId && selectedId !== e.id)) continue;
      if (selectedId === e.id) continue; // already framed by the selection
      setFocus({ key: `anom:${e.injectionId}`, id: e.id });
    }
  }, [equipment, selectedId]);
  const goHome = useCallback(() => onSelect(""), [onSelect]);

  const selectedInstance = selectedId ? byDemoId(selectedId) : null;
  const tags = useMemo(() => (selectedInstance ? connectionsOf(selectedInstance.id).filter((p) => p.assumed) : []), [selectedInstance]);

  const els: OverlayEls = {
    host: useRef<HTMLDivElement>(null),
    labels: useRef<(HTMLElement | null)[]>([]),
    leaders: useRef<(SVGLineElement | null)[]>([]),
    pins: useRef<(HTMLElement | null)[]>([]),
    zones: useRef<(HTMLElement | null)[]>([]),
    tags: useRef<(HTMLElement | null)[]>([]),
  };
  const near = stage === 2;
  const hover = useCallback((id: string | null) => setHoveredId(id && stageRef.current === 2 ? id : null), []);

  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: [BUILDING.w / 2, 30, 60], fov: 34, near: 0.5, far: 400 }}
        shadows
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={() => onSelect("")}
      >
        <Suspense fallback={null}>
          <PlantScene tokens={tokens} sim={sim} statusById={statusById} selectedId={selectedId} hoveredId={near ? hoveredId : null} onSelect={onSelect} onHover={hover} />
        </Suspense>
        <OrbitControls makeDefault enablePan screenSpacePanning={false} zoomToCursor maxPolarAngle={Math.PI / 2.25} minPolarAngle={0.2} />
        <CameraRig focus={focus} apiRef={apiRef} interactRef={interactRef} onHome={goHome} />
        {showFps ? <FpsProbe onFps={setFps} /> : null}
        <Overlay els={els} sim={sim} abnormal={abnormal} selectedId={selectedId} hoveredId={hoveredId} tags={tags} stageRef={stageRef} onStage={setStage} />
      </Canvas>

      {showFps ? (
        <div className="pointer-events-none absolute left-28 top-20 z-30 rounded-lg bg-ink-1/80 px-2 py-1 font-mono text-xs text-surface">
          {fps ? `${fps.toFixed(0)} fps` : "…"}
        </div>
      ) : null}
      <div ref={els.host} data-stage="far" className="pointer-events-none absolute inset-0 overflow-hidden">
        <svg className="absolute inset-0 h-full w-full">
          {LABELED.map((e, i) => (
            <line
              key={e.id}
              ref={(el) => {
                els.leaders.current[i] = el;
              }}
              stroke="#e1e8e7"
              strokeWidth={2}
              strokeLinecap="round"
              visibility="hidden"
            />
          ))}
        </svg>
        {ZONES.map((z, i) => (
          <span
            key={z.id}
            ref={(el) => {
              els.zones.current[i] = el;
            }}
            className="absolute left-0 top-0 whitespace-nowrap rounded-md bg-bg/90 px-1.5 py-1 text-[12px] font-medium leading-none text-ink-3 opacity-0 transition-opacity duration-300"
          >
            {z.name}
          </span>
        ))}
        {LABELED.map((e, i) => {
          const selectable = isSelectable(e);
          const sel = selectable && selectedId === e.demo_id;
          const hov = hoveredId === e.id;
          const anom = selectable && statusById[e.demo_id!] === "abnormal";
          const sub = sel || hov ? subOf(e) : null;
          const cls = `${near ? "pointer-events-auto" : ""} invisible absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-medium leading-[14px] shadow-sm ${sel || hov ? "z-10" : ""} ${
            sel ? "bg-surface text-primary ring-[1.5px] ring-primary" : anom ? "bg-[var(--kf-label-anom-bg)] text-danger-strong" : "bg-surface text-[var(--kf-map-label)]"
          }`;
          const body = (
            <>
              <span>{titleOf(e)}</span>
              {sub ? <span className="font-normal text-ink-2">· {sub}</span> : null}
              {hov && !selectable && footprintAssumed(e) ? <AssumedTag /> : null}
            </>
          );
          const ref = (el: HTMLElement | null) => {
            els.labels.current[i] = el;
          };
          const enter = () => hover(e.id);
          const leave = () => setHoveredId((h) => (h === e.id ? null : h));
          return selectable ? (
            <button key={e.id} ref={ref} type="button" onClick={() => onSelect(e.demo_id!)} onMouseEnter={enter} onMouseLeave={leave} className={`${cls} cursor-pointer`}>
              {body}
            </button>
          ) : (
            <span key={e.id} ref={ref} onMouseEnter={enter} onMouseLeave={leave} className={cls}>
              {body}
            </span>
          );
        })}
        {tags.map((t, j) => (
          <span
            key={t.id}
            ref={(el) => {
              els.tags.current[j] = el;
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
        {SELECTABLE.map((e, i) => (
          <button
            key={e.id}
            type="button"
            aria-label={`${titleOf(e)} 이상`}
            ref={(el) => {
              els.pins.current[i] = el;
            }}
            onClick={() => onSelect(e.demo_id!)}
            className="pointer-events-auto invisible absolute left-0 top-0 z-20 flex size-[22px] items-center justify-center rounded-full bg-[var(--kf-anom-bang)] text-[13px] font-bold leading-none text-white shadow-md"
          >
            !
            <span className="absolute -bottom-[5px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[6px] border-x-transparent border-t-[var(--kf-anom-bang)]" />
          </button>
        ))}
      </div>

      {showControls ? (
        <div
          role="toolbar"
          aria-label="맵 조작"
          data-map-obstacle
          className="absolute right-[416px] top-20 z-10 flex flex-col items-center gap-0.5 rounded-[14px] border border-line bg-surface p-1 shadow-card"
        >
          {CONTROL_GROUPS.map((group, gi) => (
            <div key={gi} className="flex flex-col items-center gap-0.5">
              {gi > 0 ? <div className="my-px h-px w-6 bg-divider" /> : null}
              {group.map((c) => (
                <button
                  key={c.icon}
                  type="button"
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => apiRef.current && c.run(apiRef.current)}
                  className="flex size-9 items-center justify-center rounded-[10px] text-ink-1 hover:bg-bg"
                >
                  <Icon name={c.icon} size={18} />
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {showControls ? (
        <div
          aria-hidden={!hint}
          className={`pointer-events-none absolute bottom-12 left-[calc(50%-180px)] z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-2 shadow-card transition-opacity duration-500 ${
            hint ? "opacity-100" : "opacity-0"
          }`}
        >
          드래그로 회전 · 스크롤로 확대 · 로봇을 누르면 상세
        </div>
      ) : null}
    </div>
  );
}
