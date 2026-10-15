"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, RoundedBox, SoftShadows } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { IndustrialArm, solveIK, type ArmHandle, type ArmMats } from "./IndustrialArm";
import { clamp01, lerp, readTokens, smoother, useMats, type Tokens } from "./shared";

/*
 * Experiment: procedural 6-axis arm doing pick & place (no external models).
 *   ?state=anom   abnormal: slower, vibrating, stalls, red LEDs
 *   ?q=low        low quality (dpr 1, no AO / bloom / soft shadows)
 *   ?fps=1        fps readout
 */

/* ── layout ───────────────────────────────────────────────────────── */

const BT = 0.62; // belt top height
const BELT_Z = 1.5;
const BELT_X0 = -4.2;
const BELT_X1 = 3.2;
const STOP_X = -0.85;
const ITEM = { w: 0.18, h: 0.12, d: 0.1 };
const CRATE = { x: 1.5, z: 0.45, floor: 0.14 };
const SLOTS = 24;
const POOL = SLOTS + 8;
const BELT_SPEED = 0.5;
const ITEM_GAP = 0.42;

function readParams() {
  const q = new URLSearchParams(window.location.search);
  return { anomaly: q.get("state") === "anom", low: q.get("q") === "low", showFps: q.get("fps") === "1" };
}

function slotPose(i: number) {
  const layer = Math.floor(i / 12);
  const k = i % 12;
  const col = k % 6;
  const row = Math.floor(k / 6);
  return {
    x: CRATE.x + (col - 2.5) * 0.15,
    z: CRATE.z + (row - 0.5) * 0.26,
    y: CRATE.floor + ITEM.h / 2 + layer * 0.13,
  };
}

/* ── sim state shared with the HUD ─────────────────────────────────── */

type Sim = {
  q: number[];
  grip: number;
  phase: string;
  cycles: number;
  placed: number;
  queue: number;
  vib: number;
};
const newSim = (): Sim => ({
  q: [0, 0, 0, 0, 0, 0],
  grip: 1,
  phase: "대기",
  cycles: 0,
  placed: 0,
  queue: 0,
  vib: 2.1,
});

type ItemState = "free" | "belt" | "held" | "placed";
type PoolItem = { mesh: THREE.Mesh | null; state: ItemState; x: number; scale: number };
type Seg = {
  label: string;
  x: number;
  y: number;
  z: number;
  psi: number;
  grip: number;
  dur: number;
  done?: () => void;
};

/* ── static set dressing ──────────────────────────────────────────── */

function Floor({ t, mats }: { t: Tokens; mats: ReturnType<typeof useMats> }) {
  const rough = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#b0b0b0";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      const v = 150 + Math.random() * 90;
      g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      g.beginPath();
      g.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 14, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(7, 5);
    return tex;
  }, []);

  const line = (x: number, z: number, w: number, d: number, key: string) => (
    <mesh key={key} rotation-x={-Math.PI / 2} position={[x, 0.004, z]} material={mats.yellow} userData={{ noCast: true }}>
      <planeGeometry args={[w, d]} />
    </mesh>
  );

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow userData={{ noCast: true }}>
        <planeGeometry args={[16, 11]} />
        <meshStandardMaterial color={t.floor} roughness={0.8} roughnessMap={rough} metalness={0} />
      </mesh>
      {/* robot safety zone */}
      {line(0, -1.05, 2.5, 0.05, "s1")}
      {line(0, 1.05, 2.5, 0.05, "s2")}
      {line(-1.25, 0, 0.05, 2.15, "s3")}
      {line(1.25, 0, 0.05, 2.15, "s4")}
      {/* pallet zone */}
      {line(CRATE.x, CRATE.z - 0.78, 1.5, 0.04, "p1")}
      {line(CRATE.x, CRATE.z + 0.78, 1.5, 0.04, "p2")}
      {line(CRATE.x - 0.75, CRATE.z, 0.04, 1.6, "p3")}
      {line(CRATE.x + 0.75, CRATE.z, 0.04, 1.6, "p4")}
    </group>
  );
}

function Conveyor({
  mats,
  speedRef,
  stopperUp,
}: {
  mats: ReturnType<typeof useMats>;
  speedRef: React.RefObject<number>;
  stopperUp: React.RefObject<boolean>;
}) {
  const L = BELT_X1 - BELT_X0;
  const cx = (BELT_X0 + BELT_X1) / 2;
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#2b3134";
    g.fillRect(0, 0, 128, 64);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * 128, Math.random() * 64, 2, 1);
    }
    g.fillStyle = "#3a4246";
    g.fillRect(0, 0, 3, 64);
    const tx = new THREE.CanvasTexture(c);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.repeat.set(L / 0.35, 1);
    tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  }, [L]);
  const stopper = useRef<THREE.Mesh>(null);

  useFrame((_, dt) => {
    tex.offset.x -= ((speedRef.current ?? 0) * Math.min(dt, 0.05)) / 0.35;
    if (stopper.current) {
      const target = stopperUp.current ? BT + 0.07 : BT - 0.08;
      stopper.current.position.y += (target - stopper.current.position.y) * Math.min(1, dt * 14);
    }
  });

  const legs = Array.from({ length: 7 }, (_, i) => BELT_X0 + 0.25 + (i * (L - 0.5)) / 6);

  return (
    <group position={[0, 0, BELT_Z]}>
      <mesh position={[cx, BT - 0.012, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[L, 0.56]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <RoundedBox args={[L + 0.1, 0.12, 0.05]} radius={0.01} position={[cx, BT - 0.06, s * 0.31]} material={mats.steel} />
          <RoundedBox args={[L, 0.05, 0.03]} radius={0.008} position={[cx, BT + 0.045, s * 0.3]} material={mats.aluminum} />
        </group>
      ))}
      {legs.flatMap((x) =>
        [-1, 1].map((s) => (
          <mesh key={`${x}${s}`} position={[x, (BT - 0.12) / 2, s * 0.28]} material={mats.graphite}>
            <boxGeometry args={[0.05, BT - 0.12, 0.05]} />
          </mesh>
        )),
      )}
      {legs.slice(0, -1).map((x, i) => (
        <mesh key={`b${i}`} position={[x + (L - 0.5) / 12, 0.22, 0]} material={mats.graphite}>
          <boxGeometry args={[0.03, 0.03, 0.56]} />
        </mesh>
      ))}
      {[BELT_X0 + 0.02, BELT_X1 - 0.02].map((x) => (
        <mesh key={x} position={[x, BT - 0.06, 0]} rotation-x={Math.PI / 2} material={mats.aluminum}>
          <cylinderGeometry args={[0.055, 0.055, 0.58, 24]} />
        </mesh>
      ))}
      {/* drive motor + gearbox */}
      <group position={[BELT_X1 + 0.12, 0.34, 0.2]}>
        <RoundedBox args={[0.3, 0.2, 0.2]} radius={0.03} material={mats.graphite} />
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[-0.0 + (i - 2) * 0.05, 0.11, 0]} material={mats.steel}>
            <boxGeometry args={[0.02, 0.025, 0.2]} />
          </mesh>
        ))}
      </group>
      {/* photo-eye + pop-up stopper */}
      <mesh ref={stopper} position={[STOP_X + 0.14, BT - 0.08, 0]} material={mats.yellow}>
        <boxGeometry args={[0.035, 0.12, 0.3]} />
      </mesh>
      <mesh position={[STOP_X, BT + 0.12, -0.34]} material={mats.graphite}>
        <cylinderGeometry args={[0.018, 0.018, 0.24, 12]} />
      </mesh>
      <mesh position={[STOP_X, BT + 0.22, -0.34]}>
        <sphereGeometry args={[0.022, 12, 12]} />
        <meshStandardMaterial color="#ff4a2e" emissive="#ff4a2e" emissiveIntensity={2.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

function CratePallet({ mats }: { mats: ReturnType<typeof useMats> }) {
  const w = 1.1;
  const d = 0.72;
  return (
    <group position={[CRATE.x, 0, CRATE.z]}>
      {/* pallet */}
      {[-0.4, 0, 0.4].map((x) => (
        <mesh key={x} position={[x * 1.05, 0.045, 0]} material={mats.wood}>
          <boxGeometry args={[0.12, 0.09, d]} />
        </mesh>
      ))}
      {[-0.28, 0, 0.28].map((z) => (
        <mesh key={z} position={[0, 0.1, z]} material={mats.wood}>
          <boxGeometry args={[w + 0.04, 0.025, 0.12]} />
        </mesh>
      ))}
      {/* crate */}
      <mesh position={[0, 0.125, 0]} material={mats.crate}>
        <boxGeometry args={[w, 0.03, d]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[0, 0.26, s * (d / 2 - 0.015)]} material={mats.crate}>
            <boxGeometry args={[w, 0.26, 0.03]} />
          </mesh>
          <mesh position={[s * (w / 2 - 0.015), 0.26, 0]} material={mats.crate}>
            <boxGeometry args={[0.03, 0.26, d]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Cabinet({ mats, status }: { mats: ReturnType<typeof useMats>; status: "normal" | "abnormal" }) {
  const led = status === "abnormal" ? "#ff4a2e" : "#35e08a";
  const tower = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!tower.current) return;
    tower.current.emissiveIntensity = status === "abnormal" ? (Math.sin(clock.elapsedTime * 9) > 0 ? 3.5 : 0.3) : 2.4;
  });
  const cableToBase = useMemo(() => {
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.2, 0.05, -0.2),
      new THREE.Vector3(-0.9, 0.012, -0.05),
      new THREE.Vector3(-0.55, 0.012, -0.28),
      new THREE.Vector3(-0.28, 0.02, -0.42),
      new THREE.Vector3(0.0, 0.1, -0.4),
    ]);
    return new THREE.TubeGeometry(c, 40, 0.02, 7, false);
  }, []);
  const pendantCable = useMemo(() => {
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.31, 1.0, 0.0),
      new THREE.Vector3(0.42, 0.78, 0.08),
      new THREE.Vector3(0.36, 0.62, 0.14),
      new THREE.Vector3(0.28, 0.72, 0.1),
      new THREE.Vector3(0.22, 0.66, 0.14),
    ]);
    return new THREE.TubeGeometry(c, 30, 0.007, 6, false);
  }, []);
  return (
    <group>
      <group position={[-1.5, 0, -0.75]} rotation-y={0.35}>
        <RoundedBox args={[0.6, 1.2, 0.5]} radius={0.015} position={[0, 0.6, 0]} material={mats.cabinet} />
        {/* door seams, vents, handle */}
        <mesh position={[0, 0.6, 0.252]} material={mats.graphite}>
          <boxGeometry args={[0.005, 1.1, 0.002]} />
        </mesh>
        <mesh position={[0, 1.1, 0.252]} material={mats.graphite}>
          <boxGeometry args={[0.56, 0.005, 0.002]} />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} position={[-0.12, 0.2 + i * 0.022, 0.252]} material={mats.graphite}>
            <boxGeometry args={[0.2, 0.008, 0.002]} />
          </mesh>
        ))}
        <mesh position={[0.18, 0.62, 0.27]} material={mats.aluminum}>
          <boxGeometry args={[0.03, 0.14, 0.03]} />
        </mesh>
        {/* e-stop + status LED */}
        <mesh position={[0.17, 0.95, 0.262]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.032, 0.032, 0.03, 20]} />
          <meshStandardMaterial color="#cf3b2b" roughness={0.4} />
        </mesh>
        <mesh position={[0.17, 0.95, 0.254]} rotation-x={Math.PI / 2} material={mats.yellow}>
          <cylinderGeometry args={[0.048, 0.048, 0.008, 20]} />
        </mesh>
        <mesh position={[-0.17, 0.95, 0.256]}>
          <sphereGeometry args={[0.014, 12, 12]} />
          <meshStandardMaterial color={led} emissive={led} emissiveIntensity={3} toneMapped={false} />
        </mesh>
        {/* signal tower */}
        <mesh position={[-0.2, 1.3, 0]} material={mats.graphite}>
          <cylinderGeometry args={[0.012, 0.012, 0.2, 10]} />
        </mesh>
        <mesh position={[-0.2, 1.46, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.12, 20]} />
          <meshStandardMaterial ref={tower} color={led} emissive={led} emissiveIntensity={2.4} toneMapped={false} />
        </mesh>
        {/* teach pendant on its hook */}
        <group position={[0.31, 0.64, 0.0]}>
          <RoundedBox args={[0.025, 0.2, 0.13]} radius={0.01} position={[0.012, 0, 0]} material={mats.graphite} />
          <mesh position={[0.026, 0.02, 0]}>
            <boxGeometry args={[0.004, 0.11, 0.1]} />
            <meshStandardMaterial color="#31506b" roughness={0.2} metalness={0.2} />
          </mesh>
        </group>
        <mesh geometry={pendantCable} material={mats.rubber} position={[0, 0, 0]} userData={{ noCast: true }} />
      </group>
      {/* floor cable cabinet -> robot base (world space) */}
      <mesh geometry={cableToBase} material={mats.rubber} userData={{ noCast: true }} />
    </group>
  );
}

function Fence({ mats }: { mats: ReturnType<typeof useMats> }) {
  const meshTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.strokeStyle = "#fff";
    g.lineWidth = 5;
    g.strokeRect(0, 0, 64, 64);
    const tx = new THREE.CanvasTexture(c);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    return tx;
  }, []);
  const panels = useMemo(() => {
    const defs: { key: string; len: number; pos: [number, number, number]; rotY: number }[] = [
      { key: "b1", len: 2.6, pos: [-1.3, 0, -1.5], rotY: 0 },
      { key: "b2", len: 2.6, pos: [1.3, 0, -1.5], rotY: 0 },
      { key: "l1", len: 1.8, pos: [-2.6, 0, -0.6], rotY: Math.PI / 2 },
      
    ];
    // one tiled copy per panel: ~5 cm wire squares
    return defs.map((d) => {
      const tex = meshTex.clone();
      tex.repeat.set(Math.round(d.len / 0.06), Math.round(1.3 / 0.06));
      tex.needsUpdate = true;
      return { ...d, tex };
    });
  }, [meshTex]);
  return (
    <group>
      {panels.map(({ key, len, pos, rotY, tex }) => (
        <group key={key} position={pos} rotation-y={rotY}>
          <mesh position={[0, 0.85, 0]} userData={{ noCast: true }}>
            <planeGeometry args={[len, 1.3]} />
            <meshStandardMaterial
              color="#3a4348"
              alphaMap={tex}
              alphaTest={0.4}
              side={THREE.DoubleSide}
              roughness={0.6}
              metalness={0.5}
            />
          </mesh>
          {[-len / 2, len / 2].map((x) => (
            <mesh key={x} position={[x, 0.75, 0]} material={mats.yellow}>
              <boxGeometry args={[0.07, 1.5, 0.07]} />
            </mesh>
          ))}
          <mesh position={[0, 1.5, 0]} material={mats.yellow}>
            <boxGeometry args={[len, 0.04, 0.04]} />
          </mesh>
          <mesh position={[0, 0.2, 0]} material={mats.yellow}>
            <boxGeometry args={[len, 0.04, 0.04]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ── items (brackets) ─────────────────────────────────────────────── */

function bracketGeometry() {
  const { w, h, d } = ITEM;
  const th = 0.028;
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2 + th);
  s.lineTo(-w / 2 + th, -h / 2 + th);
  s.lineTo(-w / 2 + th, h / 2);
  s.lineTo(-w / 2, h / 2);
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(w / 2 - 0.045, -h / 2 + th / 2, 0.0, 0, Math.PI * 2, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 });
  g.translate(0, 0, -d / 2);
  return g;
}

/* ── the sim + scene ──────────────────────────────────────────────── */

const Cell = memo(function Cell({
  sim,
  tokens,
  anomaly,
  low,
  selected,
  onSelect,
}: {
  sim: React.RefObject<Sim>;
  tokens: Tokens;
  anomaly: boolean;
  low: boolean;
  selected: boolean;
  onSelect: (v: boolean) => void;
}) {
  const mats = useMats(tokens);
  const arm = useRef<ArmHandle | null>(null);
  const { scene } = useThree();
  const speedRef = useRef(BELT_SPEED);
  const stopperUp = useRef(true);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const geo = useMemo(bracketGeometry, []);
  const itemMats = useMemo(() => mats.zinc, [mats]);

  const s = useRef({
    t: 0,
    cur: { x: STOP_X, y: 1.1, z: BELT_Z, psi: Math.PI / 2, grip: 1 },
    plan: null as Seg[] | null,
    idx: 0,
    segT: 0,
    from: { x: 0, y: 0, z: 0, psi: 0, grip: 1 },
    target: null as PoolItem | null,
    placed: [] as PoolItem[],
    resetT: 0,
    spawnT: 1.2,
    stall: 0,
    items: Array.from({ length: POOL }, () => ({ mesh: null, state: "free", x: 0, scale: 1 }) as PoolItem),
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

  useFrame((state, rawDt) => {
    const st = s.current;
    const sm = sim.current!;
    let dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    const speed = anomaly ? 0.6 : 1;

    // anomaly: periodic stall with a nervous shake
    let shake = 0;
    if (anomaly) {
      st.stall = (t % 8) > 6.6 ? 1 : 0;
      if (st.stall) dt = 0;
      shake = st.stall ? 1.6 : 0.5;
    }

    st.t += dt;
    const items = st.items;

    /* belt items: accumulate against the stopper */
    const onBelt = items.filter((i) => i.state === "belt").sort((a, b) => b.x - a.x);
    let limit = STOP_X;
    for (const it of onBelt) {
      it.x = Math.min(it.x + BELT_SPEED * dt, limit);
      limit = it.x - ITEM_GAP;
    }
    speedRef.current = st.resetT > 0 ? 0.0 : BELT_SPEED * (dt > 0 ? 1 : 0);

    /* spawn */
    st.spawnT -= dt;
    if (st.spawnT <= 0 && st.resetT <= 0) {
      const free = items.find((i) => i.state === "free");
      const rearmost = onBelt.length ? onBelt[onBelt.length - 1].x : 99;
      if (free && rearmost > BELT_X0 + 0.5 + ITEM_GAP) {
        free.state = "belt";
        free.x = BELT_X0 + 0.25;
        free.scale = 1;
        st.spawnT = 1.0;
      }
    }

    const lead = onBelt[0];
    const leadReady = !!lead && Math.abs(lead.x - STOP_X) < 0.004 && lead !== st.target;
    stopperUp.current = !!lead && st.target === null;

    /* plan a pick & place cycle */
    if (!st.plan && st.resetT <= 0 && leadReady && st.placed.length < SLOTS) {
      const item = lead!;
      st.target = item;
      const slot = slotPose(st.placed.length);
      const px = STOP_X;
      const py = BT + ITEM.h / 2;
      const hoverPick = py + 0.34;
      const hoverPlace = slot.y + 0.44;
      const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
      const c = st.cur;
      st.plan = [
        { label: "집기 접근", x: px, y: hoverPick, z: BELT_Z, psi: Math.PI / 2, grip: 1, dur: Math.max(0.6, dist(c.x, c.z, px, BELT_Z) / 1.5) },
        { label: "집기 접근", x: px, y: py, z: BELT_Z, psi: Math.PI / 2, grip: 1, dur: 0.45 },
        { label: "파지", x: px, y: py, z: BELT_Z, psi: Math.PI / 2, grip: 0, dur: 0.3, done: () => (item.state = "held") },
        { label: "이송", x: px, y: hoverPick, z: BELT_Z, psi: Math.PI / 2, grip: 0, dur: 0.38 },
        { label: "이송", x: slot.x, y: hoverPlace, z: slot.z, psi: Math.PI, grip: 0, dur: Math.max(0.9, dist(px, BELT_Z, slot.x, slot.z) / 1.7) },
        { label: "적재", x: slot.x, y: slot.y, z: slot.z, psi: Math.PI, grip: 0, dur: 0.45 },
        {
          label: "적재",
          x: slot.x,
          y: slot.y,
          z: slot.z,
          psi: Math.PI,
          grip: 1,
          dur: 0.3,
          done: () => {
            item.state = "placed";
            if (item.mesh) {
              item.mesh.position.set(slot.x + (Math.random() - 0.5) * 0.008, slot.y, slot.z + (Math.random() - 0.5) * 0.008);
              item.mesh.rotation.y = Math.PI / 2 + (Math.random() - 0.5) * 0.05;
            }
            st.placed.push(item);
            sm.placed = st.placed.length;
            sm.cycles += 1;
            st.target = null;
            if (st.placed.length >= SLOTS) st.resetT = 0.8;
          },
        },
        { label: "복귀", x: slot.x, y: hoverPlace, z: slot.z, psi: Math.PI, grip: 1, dur: 0.38 },
      ];
      st.idx = 0;
      st.segT = 0;
      st.from = { ...c };
    }

    /* advance the plan */
    const c = st.cur;
    if (st.plan) {
      const seg = st.plan[st.idx];
      st.segT += dt * speed;
      const k = clamp01(st.segT / seg.dur);
      const e = smoother(k);
      c.x = lerp(st.from.x, seg.x, e);
      c.y = lerp(st.from.y, seg.y, e);
      c.z = lerp(st.from.z, seg.z, e);
      c.psi = lerp(st.from.psi, seg.psi, e);
      c.grip = lerp(st.from.grip, seg.grip, e);
      sm.phase = seg.label;
      if (k >= 1) {
        seg.done?.();
        st.from = { x: seg.x, y: seg.y, z: seg.z, psi: seg.psi, grip: seg.grip };
        st.idx += 1;
        st.segT = 0;
        if (st.idx >= st.plan.length) st.plan = null;
      }
    } else {
      sm.phase = st.resetT > 0 ? "상자 교체" : "대기";
    }

    /* crate swap: shrink the placed items away, then recycle them */
    if (st.resetT > 0) {
      st.resetT -= dt;
      const k = Math.max(st.resetT / 0.8, 0);
      for (const it of st.placed) it.scale = k;
      if (st.resetT <= 0) {
        for (const it of st.placed) {
          it.state = "free";
          it.scale = 1;
        }
        st.placed = [];
        sm.placed = 0;
      }
    }

    /* item meshes */
    let queue = 0;
    for (const it of items) {
      const m = it.mesh;
      if (!m) continue;
      m.visible = it.state !== "free";
      if (it.state === "belt") {
        queue += 1;
        m.position.set(it.x, BT + ITEM.h / 2, BELT_Z);
        m.rotation.y = 0;
      } else if (it.state === "held") {
        m.position.set(c.x, c.y, c.z);
        m.rotation.y = c.psi - Math.PI / 2;
      }
      m.scale.setScalar(Math.max(it.scale, 0.001));
    }
    sm.queue = queue;

    /* IK -> joints (+ anomaly vibration) */
    solveIK(c.x, c.y, c.z, c.psi, sm.q);
    sm.q = sm.q.slice();
    if (shake > 0) {
      sm.q[0] += Math.sin(t * 61) * 0.0035 * shake;
      sm.q[1] += Math.sin(t * 53 + 1) * 0.006 * shake;
      sm.q[2] += Math.sin(t * 67 + 2) * 0.005 * shake;
      sm.q[4] += Math.sin(t * 71 + 3) * 0.004 * shake;
    }
    sm.grip = c.grip;
    sm.vib = anomaly ? 3.4 + Math.sin(t * 9) * 0.35 + (st.stall ? 0.9 : 0) : 2.1 + Math.sin(t * 3) * 0.08;
    arm.current?.apply(sm.q, c.grip);

    if (ring.current) ring.current.opacity = selected ? 0.55 + 0.2 * Math.sin(t * 3) : 0;
  });

  const status = anomaly ? "abnormal" : "normal";

  return (
    <>
      <color attach="background" args={[tokens.bg]} />
      {!low ? <SoftShadows size={14} focus={0.6} samples={10} /> : null}
      <hemisphereLight args={["#ffffff", tokens.floor, 0.55]} />
      <directionalLight
        castShadow
        position={[-4, 8, 6]}
        intensity={1.8}
        shadow-mapSize={low ? [1024, 1024] : [2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-6, 6, 6, -6, 0.1, 30]} />
      </directionalLight>
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={1.8} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
        <Lightformer intensity={0.9} position={[-6, 3, 4]} rotation-y={Math.PI / 3} scale={[8, 4, 1]} />
        <Lightformer intensity={0.6} position={[6, 2, -4]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} />
        <Lightformer intensity={0.5} position={[0, 2, 7]} rotation-y={Math.PI} scale={[10, 3, 1]} />
      </Environment>

      <Floor t={tokens} mats={mats} />
      <Conveyor mats={mats} speedRef={speedRef} stopperUp={stopperUp} />
      <CratePallet mats={mats} />
      <Cabinet mats={mats} status={status} />
      <Fence mats={mats} />

      <IndustrialArm
        mats={mats as ArmMats}
        handle={arm}
        status={status}
        onClick={() => onSelect(true)}
      />
      {/* selection ring */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]} userData={{ noCast: true }}>
        <ringGeometry args={[0.62, 0.68, 64]} />
        <meshBasicMaterial ref={ring} color={tokens.primary} transparent opacity={0} toneMapped={false} />
      </mesh>

      {/* products (pooled) */}
      {s.current.items.map((it, i) => (
        <mesh
          key={i}
          ref={(m) => {
            it.mesh = m;
          }}
          geometry={geo}
          material={itemMats}
          visible={false}
        />
      ))}
    </>
  );
});

function FpsProbe({ out }: { out: React.RefObject<number | null> }) {
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

/* ── page component ───────────────────────────────────────────────── */

const JOINT_LIMITS = [
  [-170, 170],
  [-90, 155],
  [-175, 80],
  [-180, 180],
  [-120, 120],
  [-360, 360],
];

/** HUD owns its own 8 Hz state so the WebGL tree never re-renders because of it. */
function Hud({
  sim,
  fpsRef,
  anomaly,
  selected,
  showFps,
}: {
  sim: React.RefObject<Sim>;
  fpsRef: React.RefObject<number | null>;
  anomaly: boolean;
  selected: boolean;
  showFps: boolean;
}) {
  const [hud, setHud] = useState<Sim>(() => newSim());
  const [fps, setFps] = useState<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      setHud({ ...sim.current, q: [...sim.current.q] });
      setFps(fpsRef.current);
    }, 120);
    return () => clearInterval(id);
  }, [sim, fpsRef]);

  const deg = (r: number) => (r * 180) / Math.PI;

  return (
    <>
      <div className="pointer-events-none absolute left-5 top-4 text-sm font-semibold text-ink-1">
        라인 A · 6축 로봇 셀 (절차적 모델)
      </div>
      {selected ? (
        <div className="absolute right-4 top-4 w-[230px] rounded-lg border border-line bg-surface/95 p-3 text-xs text-ink-1 shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-[13px]">Robot 01</b>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                anomaly ? "bg-danger-subtle text-danger-strong" : "bg-primary-subtle text-primary"
              }`}
            >
              {anomaly ? "이상" : "정상"}
            </span>
          </div>
          <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 text-ink-2">
            <span>동작</span>
            <b className="text-right text-ink-1">{hud.phase}</b>
            <span>이송 완료</span>
            <b className="text-right tabular-nums text-ink-1">{hud.cycles}</b>
            <span>상자 적재</span>
            <b className="text-right tabular-nums text-ink-1">
              {hud.placed} / {SLOTS}
            </b>
            <span>대기 제품</span>
            <b className="text-right tabular-nums text-ink-1">{hud.queue}</b>
            <span>진동</span>
            <b className={`text-right tabular-nums ${anomaly ? "text-danger-strong" : "text-ink-1"}`}>
              {hud.vib.toFixed(1)} mm/s
            </b>
          </div>
          <div className="border-t border-divider pt-2">
            {hud.q.map((q, i) => {
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
            <div className="mt-1 flex items-center justify-between text-ink-2">
              <span>그리퍼</span>
              <span className="font-mono tabular-nums text-ink-1">{(hud.grip * 100).toFixed(0)}% 열림</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute right-4 top-4 rounded-md bg-surface/90 px-2 py-1 text-xs text-ink-2 shadow-sm">
          로봇을 클릭하면 상세 표시
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

export function ArmCell() {
  const [params] = useState(readParams);
  const [tokens] = useState(readTokens);
  const sim = useRef<Sim>(newSim());
  const fpsRef = useRef<number | null>(null);
  const [selected, setSelected] = useState(true);

  return (
    <div className="absolute inset-0 bg-bg">
      <Canvas
        shadows
        dpr={params.low ? 1 : [1, 1.75]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        camera={{ position: [5.6, 3.9, 7.6], fov: 30, near: 0.1, far: 60 }}
        onPointerMissed={() => setSelected(false)}
      >
        <Cell sim={sim} tokens={tokens} anomaly={params.anomaly} low={params.low} selected={selected} onSelect={setSelected} />
        <OrbitControls
          makeDefault
          enableDamping
          enablePan={false}
          target={[0.35, 0.6, 0.55]}
          minDistance={3.5}
          maxDistance={11}
          minPolarAngle={0.3}
          maxPolarAngle={Math.PI / 2.1}
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
      <Hud sim={sim} fpsRef={fpsRef} anomaly={params.anomaly} selected={selected} showFps={params.showFps} />
    </div>
  );
}
