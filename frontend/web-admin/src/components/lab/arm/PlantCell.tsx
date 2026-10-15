"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, SoftShadows } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { IndustrialArm, solveIK, type ArmHandle, type ArmMats } from "./IndustrialArm";
import { Agv, Chiller, ControlCabinet, FumeArm, Manifolds, PowerPanel, WeldStation } from "./equipment";
import {
  BELT_X0,
  BELT_X1,
  BELT_Z,
  BT,
  NODES,
  PITCH,
  PLATE,
  feedsOf,
  nodeById,
  suppliesOf,
  type Infra,
  type NetKind,
  type NodeDef,
  type Status,
} from "./layout";
import { Conveyor, Fence, Floor, Sparks, Workpiece, type Work } from "./scenery";
import { Rack, Utilities } from "./utilities";
import { clamp01, lerp, readTokens, smoother, useMats, type Tokens } from "./shared";

/*
 * Experiment: line A = 3 arms (가공 → 검사 → 용접) + the equipment that keeps them running
 * (chiller on 냉각라인1, power panel for Power Zone A, weld power source, controller, AGV).
 * Parts index one station at a time; the line waits for the slowest robot.
 *
 * Scenarios (buttons, or ?scenario=… [&target=1..3]):
 *   bearing_wear / motor_overload   one robot degrades  → cycle delay
 *   cooling                          chiller fault       → all robots on the cooling line affected
 *   power                            power panel fault   → everything fed by Power Zone A affected
 * Other params:  ?q=low   ?fps=1
 */

/* ── scenario model ───────────────────────────────────────────────── */

type ScnKind = "none" | "bearing_wear" | "motor_overload" | "cooling" | "power";
type Scn = { kind: ScnKind; target: number };

const SCENARIOS: { id: ScnKind; label: string }[] = [
  { id: "none", label: "정상" },
  { id: "bearing_wear", label: "베어링 마모" },
  { id: "motor_overload", label: "모터 과부하" },
  { id: "cooling", label: "냉각 이상" },
  { id: "power", label: "전원 이상" },
];

type Statuses = { robots: Status[]; chiller: Status; panel: Status; weld: Status };

function statusesFor(scn: Scn): Statuses {
  const n: Status = "normal";
  const s: Statuses = { robots: [n, n, n], chiller: n, panel: n, weld: n };
  if (scn.kind === "bearing_wear" || scn.kind === "motor_overload") s.robots[scn.target - 1] = "abnormal";
  if (scn.kind === "cooling") {
    s.chiller = "abnormal";
    s.robots = ["warning", "warning", "warning"];
  }
  if (scn.kind === "power") {
    s.panel = "abnormal";
    s.chiller = "warning";
    s.weld = "warning";
    s.robots = ["warning", "warning", "warning"];
  }
  return s;
}

const worst = (arr: Status[]): Status =>
  arr.includes("abnormal") ? "abnormal" : arr.includes("warning") ? "warning" : "normal";

function readParams() {
  const q = new URLSearchParams(window.location.search);
  let kind = (q.get("scenario") ?? "none") as ScnKind;
  if (!SCENARIOS.some((s) => s.id === kind)) kind = "none";
  let target = Number(q.get("target") ?? 3);
  const anom = (q.get("anom") ?? "").split(",").find((n) => /^[1-3]$/.test(n));
  if (kind === "none" && (anom || q.get("state") === "anom")) {
    kind = "bearing_wear";
    target = anom ? Number(anom) : 3;
  }
  if (!(target >= 1 && target <= 3)) target = 3;
  return { scn: { kind, target } as Scn, low: q.get("q") === "low", showFps: q.get("fps") === "1" };
}

const chipText = (scn: Scn) =>
  scn.kind === "bearing_wear" || scn.kind === "motor_overload"
    ? `이상 감지 · Robot 0${scn.target} 사이클 지연`
    : scn.kind === "cooling"
      ? "냉각라인1 이상 · 로봇 3대 영향"
      : scn.kind === "power"
        ? "전원반 A 이상 · 설비 전반 영향"
        : "가동 중";


/* ── sim types ────────────────────────────────────────────────────── */

const INDEX_DUR = 1.4;
const HOME = { x: 0, y: 1.3, z: 0.95 };
const TOP_Y = BT + PLATE.h;
const POOL = 7;
const slotX = (k: number) => (k - 1) * PITCH; // k=0,1,2 → stations; -1 entry; 3 exit

type Cur = { x: number; y: number; z: number; psi: number; grip: number };
type Seg = {
  label: string;
  x: number;
  y: number;
  z: number;
  psi: number;
  dur: number;
  spin?: number;
  glow?: number;
  beam?: number;
  spark?: boolean;
  tick?: (k: number) => void;
  done?: () => void;
};

type RobotRun = {
  cur: Cur;
  plan: Seg[] | null;
  idx: number;
  segT: number;
  from: Cur;
  done: boolean;
  spinAngle: number;
  spinI: number;
  glow: number;
  beam: number;
};

type RobotSim = {
  q: number[];
  phase: string;
  jobs: number;
  vib: number;
  amp: number;
  temp: number;
  metric: string;
  ok: number;
  ng: number;
};
type InfraSim = {
  chiller: { flow: number; temp: number };
  panel: { volt: number; amp: number };
  weld: { amp: number; gas: number };
};
type LineSim = { robots: RobotSim[]; produced: number; mode: "dwell" | "index"; waitingOn: string; infra: InfraSim };

const ROBOTS = NODES.filter((n) => n.kind === "robot");

const newLineSim = (): LineSim => ({
  robots: ROBOTS.map(() => ({
    q: [0, 0, 0, 0, 0, 0],
    phase: "대기",
    jobs: 0,
    vib: 2.1,
    amp: 12.8,
    temp: 48,
    metric: "-",
    ok: 0,
    ng: 0,
  })),
  produced: 0,
  mode: "dwell",
  waitingOn: "",
  infra: { chiller: { flow: 42, temp: 18 }, panel: { volt: 380, amp: 54 }, weld: { amp: 0, gas: 0 } },
});

type Rig = {
  arm: { current: ArmHandle | null };
  tip: { current: THREE.Group | null };
  light: { current: THREE.PointLight | null };
  spark: { current: boolean };
};

/* ── plans (robot frame: robot at origin, part centre at z = BELT_Z) ─ */

const dist2 = (c: Cur, x: number, z: number) => Math.hypot(c.x - x, c.z - z);

function planMachining(w: Work, c: Cur): Seg[] {
  const hov = TOP_Y + 0.3;
  const holes = [-0.2, 0.2];
  const segs: Seg[] = [
    { label: "접근", x: holes[0], y: hov, z: BELT_Z, psi: 0, dur: Math.max(0.7, dist2(c, holes[0], BELT_Z) / 1.5) },
  ];
  holes.forEach((hx, i) => {
    if (i > 0) segs.push({ label: "이동", x: hx, y: hov, z: BELT_Z, psi: 0, dur: 0.4, spin: 0.4 });
    segs.push({ label: "가공 하강", x: hx, y: TOP_Y + 0.05, z: BELT_Z, psi: 0, dur: 0.5, spin: 1 });
    segs.push({
      label: "가공",
      x: hx,
      y: TOP_Y - 0.015,
      z: BELT_Z,
      psi: 0,
      dur: 0.9,
      spin: 1,
      spark: true,
      tick: (k) => (w.machine = i * 0.5 + k * 0.5),
    });
    segs.push({ label: "가공 상승", x: hx, y: hov, z: BELT_Z, psi: 0, dur: 0.4, spin: 0.6 });
  });
  segs.push({ label: "복귀", ...HOME, psi: 0, dur: 0.8 });
  return segs;
}

function planScan(w: Work, ng: boolean): Seg[] {
  const hov = TOP_Y + 0.34;
  return [
    { label: "접근", x: -0.36, y: hov, z: BELT_Z - 0.1, psi: 0, dur: 0.8 },
    { label: "스캔", x: 0.36, y: hov, z: BELT_Z - 0.1, psi: 0, dur: 1.1, beam: 1 },
    { label: "스캔", x: 0.36, y: hov, z: BELT_Z + 0.1, psi: 0, dur: 0.3, beam: 1 },
    { label: "스캔", x: -0.36, y: hov, z: BELT_Z + 0.1, psi: 0, dur: 1.1, beam: 1 },
    { label: "판정", x: 0, y: hov + 0.05, z: BELT_Z, psi: 0, dur: 0.5, beam: 0.3, done: () => (w.insp = ng ? 2 : 1) },
    { label: "복귀", ...HOME, psi: 0, dur: 0.8 },
  ];
}

function planWeld(w: Work, c: Cur): Seg[] {
  const z = BELT_Z + 0.12;
  const hov = TOP_Y + 0.3;
  const low = TOP_Y + 0.04;
  return [
    { label: "접근", x: -0.32, y: hov, z, psi: 0, dur: Math.max(0.7, dist2(c, -0.32, z) / 1.5) },
    { label: "용접 하강", x: -0.32, y: low, z, psi: 0, dur: 0.45 },
    {
      label: "용접",
      x: 0.32,
      y: low,
      z,
      psi: 0,
      dur: 2.4,
      glow: 1,
      spark: true,
      tick: (k) => {
        w.weld = k;
        w.heat = 1;
      },
    },
    { label: "용접 상승", x: 0.32, y: hov, z, psi: 0, dur: 0.35 },
    { label: "복귀", ...HOME, psi: 0, dur: 0.8 },
  ];
}

/* ── the sim + scene ──────────────────────────────────────────────── */

const labelV = new THREE.Vector3();

const newRobotRun = (): RobotRun => ({
  cur: { ...HOME, psi: 0, grip: 1 },
  plan: null,
  idx: 0,
  segT: 0,
  from: { ...HOME, psi: 0, grip: 1 },
  done: true,
  spinAngle: 0,
  spinI: 0,
  glow: 0,
  beam: 0,
});

const Cell = memo(function Cell({
  sim,
  tokens,
  scn,
  show,
  low,
  selectedId,
  onSelect,
  labelEls,
}: {
  sim: { current: LineSim };
  tokens: Tokens;
  scn: Scn;
  show: Record<NetKind, boolean>;
  low: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  labelEls: { current: (HTMLButtonElement | null)[] };
}) {
  const mats = useMats(tokens);
  const scene = useThree((x) => x.scene);
  const status = useMemo(() => statusesFor(scn), [scn]);
  const statusRef = useRef(status);
  const scnRef = useRef(scn);
  const scnStart = useRef(performance.now());
  useEffect(() => {
    statusRef.current = status;
    scnRef.current = scn;
    scnStart.current = performance.now();
  }, [status, scn]);

  const dxRef = useRef(0);
  const infra = useRef<Infra>({ chiller: "normal", panel: "normal", weld: "normal", speed: 1 });
  const net = useRef<Record<NetKind, Status>>({ cooling: "normal", power: "normal" });
  const ringRef = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const focus = useRef({ active: false, x: 0 });

  const rigs = useMemo<Rig[]>(
    () => ROBOTS.map(() => ({ arm: { current: null }, tip: { current: null }, light: { current: null }, spark: { current: false } })),
    [],
  );

  const st = useRef({
    mode: "dwell" as "dwell" | "index",
    modeT: 0,
    prevE: 0,
    planned: false,
    robots: ROBOTS.map(newRobotRun),
    works: Array.from({ length: POOL }, (_, i) => {
      const w: Work = { refs: null, state: "free", k: 0, x: 0, machine: 0, insp: 0, weld: 0, heat: 0 };
      if (i === 0) Object.assign(w, { state: "live", k: 2, machine: 1, insp: 1 });
      if (i === 1) Object.assign(w, { state: "live", k: 1, machine: 1 });
      if (i === 2) Object.assign(w, { state: "live", k: 0 });
      if (i === 3) Object.assign(w, { state: "live", k: -1 });
      w.x = slotX(w.k);
      return w;
    }),
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

  const firstSel = useRef(true);
  useEffect(() => {
    // the initial selection should not move the camera; later picks glide toward the equipment
    if (firstSel.current) {
      firstSel.current = false;
      return;
    }
    const sel = nodeById(selectedId);
    focus.current = { active: true, x: sel ? sel.x * 0.55 - 0.2 : -0.5 };
  }, [selectedId]);

  useFrame((state, rawDt) => {
    const s = st.current;
    const ls = sim.current;
    const stt = statusRef.current;
    const kind = scnRef.current.kind;
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    const tf = (performance.now() - scnStart.current) / 1000; // seconds since the scenario started
    const works = s.works;

    /* shared-equipment state → nets + props read by the equipment components */
    infra.current.chiller = stt.chiller;
    infra.current.panel = stt.panel;
    infra.current.weld = stt.weld;
    net.current.cooling = stt.chiller === "abnormal" ? "abnormal" : "normal";
    net.current.power = stt.panel === "abnormal" ? "abnormal" : "normal";

    /* ---- dwell start: hand each robot the part parked at its station ---- */
    if (s.mode === "dwell" && !s.planned) {
      s.planned = true;
      ROBOTS.forEach((cfg, ri) => {
        const rr = s.robots[ri];
        const w = works.find((x) => x.state === "live" && x.k === ri);
        rr.idx = 0;
        rr.segT = 0;
        rr.from = { ...rr.cur };
        if (!w) {
          rr.plan = null;
          rr.done = true;
          return;
        }
        rr.done = false;
        if (cfg.tool === "spindle") rr.plan = planMachining(w, rr.cur);
        else if (cfg.tool === "scanner") rr.plan = planScan(w, stt.robots[ri] === "abnormal" && Math.random() < 0.5);
        else rr.plan = planWeld(w, rr.cur);
      });
    }

    /* ---- robots ---- */
    let slowest = "";
    let minSp = 1;
    let ampSum = 0;
    ROBOTS.forEach((cfg, ri) => {
      const rr = s.robots[ri];
      const rsim = ls.robots[ri];
      const rig = rigs[ri];
      const rs = stt.robots[ri];
      const abn = rs === "abnormal";

      let sp = 1;
      let shake = 0;
      let stall = false;
      if (kind === "bearing_wear" && abn) {
        stall = (t + ri * 1.3) % 8 > 6.6;
        shake = stall ? 1.6 : 0.5;
        sp = 0.6;
      } else if (kind === "motor_overload" && abn) {
        stall = (t + ri * 1.3) % 6 > 5.2;
        shake = stall ? 0.7 : 0.15;
        sp = 0.5;
      } else if (kind === "cooling") {
        sp = 0.85;
      } else if (kind === "power") {
        sp = 0.75;
        stall = t % 7 > 6.5; // brown-out blips hit every robot at once
      }
      minSp = Math.min(minSp, stall ? 0.2 : sp);
      const rdt = stall ? 0 : dt * sp;

      let seg: Seg | null = null;
      if (rr.plan) {
        seg = rr.plan[rr.idx];
        rr.segT += rdt;
        const k = clamp01(rr.segT / seg.dur);
        const e = smoother(k);
        const f = rr.from;
        rr.cur.x = lerp(f.x, seg.x, e);
        rr.cur.y = lerp(f.y, seg.y, e);
        rr.cur.z = lerp(f.z, seg.z, e);
        rr.cur.psi = lerp(f.psi, seg.psi, e);
        seg.tick?.(k);
        if (k >= 1) {
          seg.done?.();
          rr.from = { x: seg.x, y: seg.y, z: seg.z, psi: seg.psi, grip: 1 };
          rr.idx += 1;
          rr.segT = 0;
          if (rr.idx >= rr.plan.length) {
            rr.plan = null;
            rr.done = true;
            rsim.jobs += 1;
            if (cfg.tool === "scanner") {
              const w = works.find((x) => x.state === "live" && x.k === ri);
              if (w?.insp === 2) rsim.ng += 1;
              else rsim.ok += 1;
            }
          }
        }
      }
      if (!rr.done) slowest = cfg.name;

      /* tool effects (smoothed) */
      const a = 1 - Math.exp(-dt * 12);
      rr.spinI += ((seg?.spin ?? 0) - rr.spinI) * a;
      rr.glow += ((seg?.glow ?? 0) - rr.glow) * a;
      rr.beam += ((seg?.beam ?? 0) - rr.beam) * a;
      rr.spinAngle += dt * 60 * rr.spinI;
      const sparking = !!seg?.spark && rdt > 0;
      rig.spark.current = sparking || (abn && cfg.tool === "torch" && kind === "bearing_wear" && Math.sin(t * 7) > 0.4);
      if (rig.light.current) rig.light.current.intensity = cfg.tool === "torch" && seg?.spark ? 3 + Math.random() * 5 : 0;
      rig.tip.current?.position.set(cfg.x + rr.cur.x, rr.cur.y, rr.cur.z);
      rig.light.current?.position.set(0, 0.08, 0);

      /* IK → joints */
      solveIK(rr.cur.x, rr.cur.y, rr.cur.z, rr.cur.psi, rsim.q);
      rsim.q = rsim.q.slice();
      if (shake > 0) {
        rsim.q[0] += Math.sin(t * 61 + ri) * 0.0035 * shake;
        rsim.q[1] += Math.sin(t * 53 + 1 + ri) * 0.006 * shake;
        rsim.q[2] += Math.sin(t * 67 + 2 + ri) * 0.005 * shake;
        rsim.q[4] += Math.sin(t * 71 + 3 + ri) * 0.004 * shake;
      }
      rig.arm.current?.apply(rsim.q, 1, { spin: rr.spinAngle, glow: rr.glow, beam: rr.beam });

      /* telemetry: bearing_wear / motor_overload use the demo's sensor deltas */
      const working = !!seg && seg.label !== "접근" && seg.label !== "복귀";
      rsim.phase = stall ? "정지(이상)" : seg ? seg.label : s.mode === "index" ? "이송 대기" : "대기";
      if (kind === "bearing_wear" && abn) {
        rsim.vib = 3.0 + Math.sin(t * 9) * 0.3 + (shake > 1 ? 0.9 : 0);
        rsim.amp = 15.2 + (working ? 0.7 : 0) + Math.sin(t * 5 + ri) * 0.1;
        rsim.temp = 54 + Math.sin(t * 0.3) * 0.4;
      } else if (kind === "motor_overload" && abn) {
        rsim.vib = 2.7 + Math.sin(t * 6) * 0.15;
        rsim.amp = 17.4 + Math.sin(t * 4) * 0.5 + (working ? 0.9 : 0);
        rsim.temp = 51.8 + Math.sin(t * 0.3) * 0.4;
      } else {
        rsim.vib = 2.1 + Math.sin(t * 3 + ri) * 0.08;
        rsim.amp = 12.8 + (working ? 0.7 : 0) + Math.sin(t * 5 + ri) * 0.1;
        rsim.temp = 48 + Math.sin(t * 0.2 + ri) * 0.3;
        if (kind === "cooling") rsim.temp += Math.min(14, tf * 0.35);
        if (kind === "power") rsim.amp += Math.sin(t * 7 + ri) * 1.4 - (stall ? 3 : 0);
      }
      ampSum += rsim.amp;
      rsim.metric =
        cfg.tool === "spindle"
          ? `${Math.round(8000 * rr.spinI)} rpm`
          : cfg.tool === "torch"
            ? `${Math.round(180 * rr.glow)} A`
            : rr.beam > 0.2
              ? "스캔 중"
              : `OK ${rsim.ok} / NG ${rsim.ng}`;
    });
    infra.current.speed = minSp;

    /* shared equipment telemetry */
    const ii = ls.infra;
    if (kind === "cooling") {
      ii.chiller.flow = Math.max(12, 42 - tf * 2.2) + Math.sin(t * 8) * 0.6;
      ii.chiller.temp = 18 + Math.min(14, tf * 0.9);
    } else {
      ii.chiller.flow = 42 + Math.sin(t * 0.7) * 0.8;
      ii.chiller.temp = 18 + Math.sin(t * 0.3) * 0.2;
    }
    ii.panel.volt = kind === "power" ? 342 + Math.sin(t * 6) * 14 : 380 + Math.sin(t * 0.9) * 1.2;
    ii.panel.amp = ampSum + 8 + ii.weld.amp * 0.08;
    ii.weld.amp = s.robots[2].glow * 180;
    ii.weld.gas = s.robots[2].glow > 0.1 ? 14 : 0;

    /* ---- part flow ---- */
    let dx = 0;
    if (s.mode === "dwell") {
      s.modeT += dt;
      ls.waitingOn = slowest;
      const allDone = s.robots.every((r) => r.done);
      if (allDone && s.modeT > 0.8) {
        s.mode = "index";
        s.modeT = 0;
        s.prevE = 0;
        const free = works.find((w) => w.state === "free");
        if (free) Object.assign(free, { state: "live", k: -2, x: slotX(-2), machine: 0, insp: 0, weld: 0, heat: 0 });
      }
    } else {
      s.modeT += dt;
      const e = smoother(clamp01(s.modeT / INDEX_DUR));
      dx = (e - s.prevE) * PITCH;
      s.prevE = e;
      for (const w of works) if (w.state === "live") w.x = slotX(w.k) + PITCH * e;
      if (s.modeT >= INDEX_DUR) {
        for (const w of works) {
          if (w.state !== "live") continue;
          w.k += 1;
          w.x = slotX(w.k);
          if (w.k === 3) ls.produced += 1;
          if (w.k > 3) w.state = "free";
        }
        s.mode = "dwell";
        s.modeT = 0;
        s.planned = false;
      }
    }
    dxRef.current = dx;
    ls.mode = s.mode;

    /* ---- workpiece visuals ---- */
    for (const w of works) {
      const r = w.refs;
      if (!r) continue;
      r.group.visible = w.state === "live";
      if (w.state !== "live") continue;
      w.heat = Math.max(0, w.heat - dt / 3);
      r.group.position.set(w.x, BT + PLATE.h / 2, BELT_Z);
      const sc = smoother(clamp01((w.x - BELT_X0) / 0.8)) * (1 - smoother(clamp01((w.x - (BELT_X1 - 0.8)) / 1.0)));
      r.group.scale.setScalar(Math.max(sc, 0.001));
      r.hole1.scale.setScalar(Math.max(clamp01(w.machine * 2), 0.001));
      r.hole2.scale.setScalar(Math.max(clamp01(w.machine * 2 - 1), 0.001));
      r.seam.scale.x = Math.max(w.weld, 0.001);
      r.seamMat.emissiveIntensity = w.heat * 3;
      const led = w.insp === 1 ? "#35e08a" : w.insp === 2 ? "#ff4a2e" : "#444444";
      r.ledMat.color.set(led);
      r.ledMat.emissive.set(w.insp ? led : "#000000");
      r.ledMat.emissiveIntensity = w.insp ? 3 : 0;
    }

    /* ---- DOM name tags follow their equipment (projected, no React state) ---- */
    NODES.forEach((n, i) => {
      const el = labelEls.current[i];
      if (!el) return;
      labelV.set(n.x, n.labelY, n.z).project(state.camera);
      const px = ((labelV.x + 1) / 2) * state.size.width;
      const py = ((1 - labelV.y) / 2) * state.size.height;
      el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.visibility = labelV.z > 1 ? "hidden" : "visible";
    });

    /* ---- selection ring + camera focus ---- */
    if (ringRef.current && ringMat.current) {
      const sel = nodeById(selectedId);
      ringMat.current.opacity = sel ? 0.55 + 0.2 * Math.sin(t * 3) : 0;
      if (sel) {
        ringRef.current.position.set(sel.x, 0.006, sel.z);
        ringRef.current.scale.setScalar(sel.ring / 0.65);
      }
    }
    const c = controls.current;
    if (c && focus.current.active) {
      const target = c.target;
      const nx = target.x + (focus.current.x - target.x) * (1 - Math.exp(-dt * 4));
      state.camera.position.x += nx - target.x;
      target.x = nx;
      c.update();
      if (Math.abs(nx - focus.current.x) < 0.01) focus.current.active = false;
    }
  });

  const select = (id: string) => onSelect(id);

  return (
    <>
      <color attach="background" args={[tokens.bg]} />
      {!low ? <SoftShadows size={14} focus={0.6} samples={10} /> : null}
      <hemisphereLight args={["#ffffff", tokens.floor, 0.55]} />
      <directionalLight
        castShadow
        position={[-4, 9, 7]}
        intensity={1.8}
        shadow-mapSize={low ? [1024, 1024] : [2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-10, 10, 7, -7, 0.1, 36]} />
      </directionalLight>
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={1.8} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[16, 12, 1]} />
        <Lightformer intensity={0.9} position={[-8, 3, 4]} rotation-y={Math.PI / 3} scale={[8, 4, 1]} />
        <Lightformer intensity={0.6} position={[8, 2, -4]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} />
        <Lightformer intensity={0.5} position={[0, 2, 8]} rotation-y={Math.PI} scale={[14, 3, 1]} />
      </Environment>

      <Floor t={tokens} mats={mats} />
      <Conveyor mats={mats} dxRef={dxRef} />
      <Fence mats={mats} />
      <Rack mats={mats} />
      <Utilities net={net} selectedId={selectedId} show={show} />
      <Manifolds mats={mats} />
      <Chiller infra={infra} onSelect={select} />
      <PowerPanel mats={mats} infra={infra} onSelect={select} />
      <WeldStation mats={mats} infra={infra} onSelect={select} />
      <FumeArm mats={mats} />
      <ControlCabinet mats={mats} status={worst([...status.robots, status.panel])} />
      <Agv infra={infra} />

      {ROBOTS.map((cfg, i) => (
        <group key={cfg.id}>
          <IndustrialArm
            mats={mats as ArmMats}
            handle={rigs[i].arm}
            status={status.robots[i]}
            tool={cfg.tool}
            position={[cfg.x, 0, 0]}
            onClick={() => onSelect(cfg.id)}
          />
          <group ref={rigs[i].tip}>
            <Sparks
              active={rigs[i].spark}
              color={cfg.tool === "spindle" ? "#bcd6ff" : "#ffd27a"}
              rate={cfg.tool === "spindle" ? 26 : 46}
              power={status.robots[i] === "abnormal" && cfg.tool === "torch" ? 1.5 : 1}
            />
            <pointLight ref={rigs[i].light} color="#ffd9a0" intensity={0} distance={2.4} />
          </group>
        </group>
      ))}
      {st.current.works.map((w, i) => (
        <Workpiece key={i} w={w} mats={mats} />
      ))}
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} position={[0, 0.006, 0]} userData={{ noCast: true }}>
        <ringGeometry args={[0.62, 0.68, 64]} />
        <meshBasicMaterial ref={ringMat} color={tokens.primary} transparent opacity={0} toneMapped={false} />
      </mesh>
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        enablePan={false}
        target={[-0.5, 1.05, 0.5]}
        minDistance={4}
        maxDistance={20}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 2.1}
      />
    </>
  );
});

function FpsProbe({ out }: { out: { current: number | null } }) {
  const acc = useRef({ frames: 0, t: performance.now() });
  useFrame(() => {
    const a = acc.current;
    a.frames += 1;
    const now = performance.now();
    if (now - a.t >= 1000) {
      out.current = (a.frames * 1000) / (now - a.t);
      a.frames = 0;
      a.t = now;
    }
  });
  return null;
}

/* ── name tags (positions written by the Cell each frame) ─────────── */

const dot = (s: Status) => (s === "abnormal" ? "bg-danger" : s === "warning" ? "bg-warn" : "bg-normal");

function Labels({
  statuses,
  selectedId,
  onSelect,
  els,
}: {
  statuses: Record<string, Status>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  els: { current: (HTMLButtonElement | null)[] };
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {NODES.map((n, i) => {
        const s = statuses[n.id];
        const cls =
          s === "abnormal"
            ? "bg-[var(--kf-label-anom-bg)] text-danger-strong"
            : s === "warning"
              ? "bg-warn-subtle text-warn-text ring-1 ring-warn"
              : selectedId === n.id
                ? "bg-primary text-white"
                : "bg-surface text-[var(--kf-map-label)]";
        return (
          <button
            key={n.id}
            ref={(el) => {
              els.current[i] = el;
            }}
            onClick={() => onSelect(n.id)}
            className={`pointer-events-auto absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-[5px] font-medium leading-none shadow-md ${
              n.kind === "robot" ? "text-[12px]" : "text-[11px]"
            } ${cls}`}
          >
            {s !== "normal" ? <span className={`h-1.5 w-1.5 rounded-full ${dot(s)}`} /> : null}
            {n.tag}
          </button>
        );
      })}
    </div>
  );
}

/* ── HUD (own 8 Hz state; the WebGL tree never re-renders for it) ─── */

const JOINT_LIMITS = [
  [-170, 170],
  [-90, 155],
  [-175, 80],
  [-180, 180],
  [-120, 120],
  [-360, 360],
];

const NET_LABEL: Record<NetKind, string> = { cooling: "냉각라인1", power: "전원반 A" };

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <>
      <span>{k}</span>
      <b className={`text-right tabular-nums ${bad ? "text-danger-strong" : "text-ink-1"}`}>{v}</b>
    </>
  );
}

function Hud({
  sim,
  fpsRef,
  scn,
  statuses,
  selectedId,
  showFps,
}: {
  sim: { current: LineSim };
  fpsRef: { current: number | null };
  scn: Scn;
  statuses: Record<string, Status>;
  selectedId: string | null;
  showFps: boolean;
}) {
  const [hud, setHud] = useState<LineSim>(() => newLineSim());
  const [fps, setFps] = useState<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const s = sim.current;
      setHud({ ...s, robots: s.robots.map((r) => ({ ...r, q: [...r.q] })) });
      setFps(fpsRef.current);
    }, 120);
    return () => clearInterval(id);
  }, [sim, fpsRef]);

  const node = nodeById(selectedId);
  const ri = ROBOTS.findIndex((r) => r.id === selectedId);
  const r = ri >= 0 ? hud.robots[ri] : null;
  const nodeStatus = node ? statuses[node.id] : "normal";
  const bad = nodeStatus === "abnormal";
  const deg = (v: number) => (v * 180) / Math.PI;
  const lineStatus = worst(Object.values(statuses));

  const deps = (n: NodeDef) => {
    const feeds = feedsOf(n.id).map((e) => ({ dir: "←", net: e.net, other: nodeById(e.from)! }));
    const supplies = suppliesOf(n.id).map((e) => ({ dir: "→", net: e.net, other: nodeById(e.to)! }));
    return [...feeds, ...supplies];
  };

  return (
    <>
      <div className="pointer-events-none absolute left-5 top-4 text-sm">
        <b className="font-semibold text-ink-1">라인 A · 설비 연결 구조 (절차적 모델)</b>
      </div>
      <div className="pointer-events-none absolute left-5 top-11 flex flex-wrap items-center gap-1.5 text-xs">
        <span
          className={`rounded-full px-2.5 py-1 ${
            lineStatus === "abnormal"
              ? "bg-danger-subtle text-danger-strong"
              : lineStatus === "warning"
                ? "bg-warn-subtle text-warn-text"
                : "bg-primary-subtle text-primary"
          }`}
        >
          {chipText(scn)}
          {(scn.kind === "bearing_wear" || scn.kind === "motor_overload") && hud.waitingOn
            ? ` (${hud.waitingOn} 작업 중)`
            : ""}
        </span>
        <span className="rounded-full bg-surface/90 px-2.5 py-1 text-ink-2 shadow-sm">
          생산 <b className="tabular-nums text-ink-1">{hud.produced}</b>
        </span>
        <span className="rounded-full bg-surface/90 px-2.5 py-1 text-ink-2 shadow-sm">
          {hud.mode === "index" ? "제품 이송 중" : "공정 진행 중"}
        </span>
      </div>

      {node ? (
        <div className="absolute right-4 top-4 w-[250px] rounded-lg border border-line bg-surface/95 p-3 text-xs text-ink-1 shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-[13px]">{node.kind === "robot" ? `${node.name} · ${node.role}` : node.name}</b>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                bad
                  ? "bg-danger-subtle text-danger-strong"
                  : nodeStatus === "warning"
                    ? "bg-warn-subtle text-warn-text"
                    : "bg-primary-subtle text-primary"
              }`}
            >
              {bad ? "이상" : nodeStatus === "warning" ? "주의" : "정상"}
            </span>
          </div>

          <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 text-ink-2">
            {node.kind === "robot" && r ? (
              <>
                <Row k="동작" v={r.phase} />
                <Row k={node.unit ?? "-"} v={r.metric} />
                <Row k="처리 수" v={String(r.jobs)} />
                <Row k="진동" v={`${r.vib.toFixed(1)} mm/s`} bad={r.vib > 2.5} />
                <Row k="전류" v={`${r.amp.toFixed(1)} A`} bad={r.amp > 14.5} />
                <Row k="온도" v={`${r.temp.toFixed(1)} °C`} bad={r.temp > 52} />
              </>
            ) : null}
            {node.kind === "chiller" ? (
              <>
                <Row k="공급 온도" v={`${hud.infra.chiller.temp.toFixed(1)} °C`} bad={hud.infra.chiller.temp > 22} />
                <Row k="유량" v={`${hud.infra.chiller.flow.toFixed(0)} L/min`} bad={hud.infra.chiller.flow < 30} />
              </>
            ) : null}
            {node.kind === "panel" ? (
              <>
                <Row k="전압" v={`${hud.infra.panel.volt.toFixed(0)} V`} bad={hud.infra.panel.volt < 360} />
                <Row k="총 전류" v={`${hud.infra.panel.amp.toFixed(1)} A`} />
              </>
            ) : null}
            {node.kind === "weld" ? (
              <>
                <Row k="용접 전류" v={`${hud.infra.weld.amp.toFixed(0)} A`} />
                <Row k="가스 유량" v={`${hud.infra.weld.gas.toFixed(0)} L/min`} />
              </>
            ) : null}
          </div>

          <div className="border-t border-divider pt-2">
            <div className="mb-1 text-[11px] font-semibold text-ink-2">연결</div>
            {deps(node).map((d, i) => (
              <div key={i} className="mb-0.5 flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${dot(statuses[d.other.id])}`} />
                <span className="text-ink-2">
                  {d.dir} {NET_LABEL[d.net]}
                </span>
                <span className="ml-auto">{d.other.name}</span>
              </div>
            ))}
          </div>

          {node.kind === "robot" && r ? (
            <div className="mt-2 border-t border-divider pt-2">
              {r.q.map((q, i) => {
                const [lo, hi] = JOINT_LIMITS[i];
                const d = deg(q);
                const pct = ((Math.max(lo, Math.min(hi, d)) - lo) / (hi - lo)) * 100;
                return (
                  <div key={i} className="mb-1 flex items-center gap-2">
                    <span className="w-5 text-ink-2">J{i + 1}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-cand-1-track">
                      <div className="h-full rounded bg-cand-1-bar" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-12 text-right font-mono tabular-nums">{d.toFixed(0)}°</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="pointer-events-none absolute right-4 top-4 rounded-md bg-surface/90 px-2 py-1 text-xs text-ink-2 shadow-sm">
          설비를 클릭하면 상세와 연결 관계 표시
        </div>
      )}
      {showFps ? (
        <div className="absolute bottom-4 right-4 rounded-md bg-surface/90 px-2 py-1 font-mono text-xs text-ink-2 shadow-sm">
          {fps ? `${fps.toFixed(0)} fps` : "…"}
        </div>
      ) : null}
    </>
  );
}

/* ── controls: scenario picker + network toggles ──────────────────── */

function Controls({
  scn,
  onScn,
  show,
  onShow,
}: {
  scn: Scn;
  onScn: (k: ScnKind) => void;
  show: Record<NetKind, boolean>;
  onShow: (k: NetKind) => void;
}) {
  return (
    <>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-surface/95 p-1 text-xs shadow-md">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => onScn(s.id)}
            className={`rounded-full px-3 py-1.5 ${
              scn.kind === s.id
                ? s.id === "none"
                  ? "bg-primary text-white"
                  : "bg-danger text-white"
                : "text-ink-2 hover:bg-primary-subtle"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded-full bg-surface/95 px-3 py-1.5 text-xs shadow-md">
        {(["cooling", "power"] as NetKind[]).map((k) => (
          <label key={k} className="flex cursor-pointer items-center gap-1.5 text-ink-2">
            <input type="checkbox" checked={show[k]} onChange={() => onShow(k)} className="accent-[var(--kf-primary)]" />
            <span className="h-2 w-2 rounded-full" style={{ background: k === "cooling" ? "#5bbbe6" : "#f2b13c" }} />
            {NET_LABEL[k]}
          </label>
        ))}
      </div>
    </>
  );
}

/* ── page component ───────────────────────────────────────────────── */

export function LineCell() {
  const [params] = useState(readParams);
  const [tokens] = useState(readTokens);
  const sim = useRef<LineSim>(newLineSim());
  const fpsRef = useRef<number | null>(null);
  const labelEls = useRef<(HTMLButtonElement | null)[]>([]);
  const [scn, setScn] = useState<Scn>(params.scn);
  const [show, setShow] = useState<Record<NetKind, boolean>>({ cooling: true, power: true });
  const [selectedId, setSelectedId] = useState<string | null>(
    params.scn.kind === "cooling" ? "chiller" : params.scn.kind === "power" ? "power_a" : params.scn.kind === "none" ? "robot_01" : `robot_0${params.scn.target}`,
  );

  const status = useMemo(() => statusesFor(scn), [scn]);
  const statuses = useMemo<Record<string, Status>>(
    () => ({
      robot_01: status.robots[0],
      robot_02: status.robots[1],
      robot_03: status.robots[2],
      chiller: status.chiller,
      power_a: status.panel,
      weld_src: status.weld,
    }),
    [status],
  );

  const pickScenario = (kind: ScnKind) => {
    // robot-level faults hit the selected robot (default: Robot 03)
    const selRobot = selectedId?.startsWith("robot_0") ? Number(selectedId.slice(-1)) : 0;
    setScn({ kind, target: selRobot || 3 });
    if (kind === "cooling") setSelectedId("chiller");
    else if (kind === "power") setSelectedId("power_a");
  };

  return (
    <div className="absolute inset-0 bg-bg">
      <Canvas
        shadows
        dpr={params.low ? 1 : [1, 1.75]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        camera={{ position: [1.4, 4.9, 17.0], fov: 30, near: 0.1, far: 80 }}
        onPointerMissed={() => setSelectedId(null)}
      >
        <Cell
          sim={sim}
          tokens={tokens}
          scn={scn}
          show={show}
          low={params.low}
          selectedId={selectedId}
          onSelect={setSelectedId}
          labelEls={labelEls}
        />
        {!params.low ? (
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <N8AO aoRadius={0.45} distanceFalloff={0.6} intensity={2.2} quality="medium" halfRes />
            <Bloom mipmapBlur intensity={0.35} luminanceThreshold={1} luminanceSmoothing={0.2} />
            <SMAA />
            <ToneMapping mode={ToneMappingMode.NEUTRAL} />
          </EffectComposer>
        ) : null}
        {params.showFps ? <FpsProbe out={fpsRef} /> : null}
      </Canvas>
      <Labels statuses={statuses} selectedId={selectedId} onSelect={setSelectedId} els={labelEls} />
      <Hud sim={sim} fpsRef={fpsRef} scn={scn} statuses={statuses} selectedId={selectedId} showFps={params.showFps} />
      <Controls scn={scn} onScn={pickScenario} show={show} onShow={(k) => setShow((s) => ({ ...s, [k]: !s[k] }))} />
    </div>
  );
}
