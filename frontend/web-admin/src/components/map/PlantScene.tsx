"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Lightformer, RoundedBox, useGLTF } from "@react-three/drei";
import { AgvDetail, DETAIL_TYPES, FumeHoodDetail, MachineDetail } from "@/components/lab/arm/MachineDetail";
import { PlantSim } from "@/data/plantSim";
import { resolveStatus } from "@/data/plantStatus";
import type { Instance } from "@/data/factoryProfile";
import { strokeGeometry } from "@/components/map/plantGeometry";
import {
  BUILDING,
  MACHINES,
  ZONES,
  boxOf,
  connectionsOf,
  footprintAssumed,
  isSelectable,
  outlineOf,
  type ConnPath,
} from "@/components/map/plantMapData";

/*
 * The whole line in 3D, laid out from the factory profile (same coordinates as /lab/plant).
 * Kenney Factory Kit CC0 GLBs where a model fits (robot arm, conveyor, carried boxes), the lab equipment
 * geometry for everything else. The 31 machines without data are drawn in neutral gray only (body and
 * accents), so nothing on them can be read as a status colour; only the 3 demo robots carry status.
 *
 * Motion is display only: the material flow comes from PlantSim with every machine held at "normal",
 * and the robot arms loop a fixed motion. Nothing here is read back by the Rule Engine.
 */

const BASE = "/models/kenney-factory";
export const MODELS = {
  arm: `${BASE}/robot-arm-a.glb`,
  conveyor: `${BASE}/conveyor-long.glb`,
  box: `${BASE}/box-small.glb`,
};
Object.values(MODELS).forEach((url) => useGLTF.preload(url));

export type SceneTokens = {
  bg: string;
  floor: string;
  grid: string;
  floorEdge: string;
  primary: string;
  equipAnom: string;
  warn: string;
  text3: string;
};

/** One neutral gray for every machine without data (never the 정상 green, never a status colour). */
const NEUTRAL = "#cfd4d5";
const noRay = () => null;

/** Every machine runs; the flow picture never depends on the demo judgement. */
const ALL_NORMAL = resolveStatus({});
const SIM_SCALE = 10;
/** Simulated seconds run before the first frame, so parts are already on the line. */
const PREWARM_S = 900;

export function useWarmSim() {
  const sim = useRef<PlantSim | null>(null);
  if (!sim.current) {
    sim.current = new PlantSim();
    sim.current.advance(PREWARM_S, ALL_NORMAL);
  }
  return sim as MutableRefObject<PlantSim>;
}

/* ── models ───────────────────────────────────────────────────────────── */

/** First mesh of a single-mesh GLB, for instancing. */
function useMeshOf(url: string) {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    let found: THREE.Mesh | null = null;
    scene.traverse((o) => {
      if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
    });
    const m = found as unknown as THREE.Mesh;
    return { geometry: m.geometry, material: m.material as THREE.Material };
  }, [scene]);
}

/** Conveyor runs as instanced Kenney 2 m segments, stretched to the profile footprint. */
function Conveyors() {
  const { geometry, material } = useMeshOf(MODELS.conveyor);
  const runs = useMemo(() => MACHINES.filter((e) => e.type === "conveyor").map(boxOf), []);
  const count = runs.reduce((n, b) => n + Math.max(1, Math.round(b.w / 2)), 0);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let i = 0;
    for (const b of runs) {
      const n = Math.max(1, Math.round(b.w / 2));
      const seg = b.w / n;
      for (let k = 0; k < n; k++) {
        m.compose(new THREE.Vector3(b.cx - b.w / 2 + seg * (k + 0.5), 0, b.cz), q, new THREE.Vector3(seg / 2, 0.62 / 0.4, b.d));
        mesh.setMatrixAt(i++, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [runs]);
  return <instancedMesh ref={ref} args={[geometry, material, count]} raycast={noRay} receiveShadow />;
}

/** Carried parts (Kenney small box) and the carts under the ones off the belt, two instanced meshes. */
const POOL = 48;
function Carriers({ sim }: { sim: MutableRefObject<PlantSim> }) {
  // Kenney box geometry, plain carton colour (the kit texture has green stripes that could read as 정상)
  const { geometry } = useMeshOf(MODELS.box);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c9b27c", roughness: 0.8 }), []);
  useEffect(() => () => material.dispose(), [material]);
  const boxes = useRef<THREE.InstancedMesh>(null);
  const carts = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), zero: new THREE.Matrix4().makeScale(0, 0, 0) }), []);
  useFrame(() => {
    const b = boxes.current;
    const c = carts.current;
    if (!b || !c) return;
    const ks = sim.current.tokens;
    for (let i = 0; i < POOL; i++) {
      const k = ks[i];
      if (!k || k.hidden) {
        b.setMatrixAt(i, tmp.zero);
        c.setMatrixAt(i, tmp.zero);
        continue;
      }
      tmp.q.setFromAxisAngle(tmp.up, k.rot);
      // Kenney box is 0.6 × 0.55 × 0.5 m with its origin at the bottom; drawn as a 0.46 × 0.2 × 0.32 m carrier
      tmp.m.compose(tmp.p.set(k.x, k.y - 0.1, k.z), tmp.q, tmp.s.set(0.77, 0.36, 0.64));
      b.setMatrixAt(i, tmp.m);
      if (k.mode !== "conveyor") {
        tmp.m.compose(tmp.p.set(k.x, 0.2, k.z), tmp.q, tmp.s.set(1.08, 0.4, 0.78));
        c.setMatrixAt(i, tmp.m);
      } else c.setMatrixAt(i, tmp.zero);
    }
    b.instanceMatrix.needsUpdate = true;
    c.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={boxes} args={[geometry, material, POOL]} frustumCulled={false} raycast={noRay} castShadow />
      <instancedMesh ref={carts} args={[undefined, undefined, POOL]} frustumCulled={false} raycast={noRay}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#38464a" roughness={0.6} metalness={0.2} />
      </instancedMesh>
    </>
  );
}

/** Stock-lane carts, driven by the simulation in real time. */
function Agv({ sim, id }: { sim: MutableRefObject<PlantSim>; id: string }) {
  const g = useRef<THREE.Group>(null);
  const runner = useMemo(() => sim.current.agvs.find((v) => v.id === id) ?? null, [sim, id]);
  useFrame(() => {
    if (!g.current || !runner) return;
    g.current.position.set(runner.x, 0, runner.z);
    g.current.rotation.y = runner.rot;
  });
  return (
    <group ref={g} scale={1.35}>
      <GrayAgv />
    </group>
  );
}

function GrayAgv() {
  const g = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    g.current?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      const l = mat.color.r * 0.3 + mat.color.g * 0.59 + mat.color.b * 0.11;
      mat.color.setScalar(Math.min(0.92, 0.35 + l * 0.6));
      mat.emissive.setScalar(0);
      m.material = mat;
    });
  }, []);
  return (
    <group ref={g}>
      <AgvDetail opacity={1} />
    </group>
  );
}

/* ── robots: Kenney arm, fixed loop ───────────────────────────────────── */

const ARM_SCALE = 0.68;
type Joints = { a: THREE.Object3D; b: THREE.Object3D; d: THREE.Object3D; f: THREE.Object3D; ca: THREE.Object3D; cb: THREE.Object3D };

function Robot({
  e,
  status,
  selected,
  tokens,
  onSelect,
  onHover,
}: {
  e: Instance;
  status: string;
  selected: boolean;
  tokens: SceneTokens;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const { scene } = useGLTF(MODELS.arm);
  const root = useMemo(() => scene.clone(true), [scene]);
  const joints = useMemo<Joints>(() => {
    const j = (n: string) => root.getObjectByName(n)!;
    return { a: j("element-a"), b: j("element-b"), d: j("element-d"), f: j("element-f"), ca: j("claw-a"), cb: j("claw-b") };
  }, [root]);
  // one tinted copy of each material, swapped in while the Rule Engine says abnormal
  const mats = useMemo(() => {
    const pairs: { mesh: THREE.Mesh; base: THREE.Material; tint: THREE.Material; warn: THREE.Material }[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const base = mesh.material as THREE.MeshStandardMaterial;
      const tint = base.clone();
      tint.color = new THREE.Color(tokens.equipAnom);
      const warn = base.clone();
      warn.color = new THREE.Color(tokens.warn);
      pairs.push({ mesh, base, tint, warn });
    });
    return pairs;
  }, [root, tokens.equipAnom, tokens.warn]);
  const abnormal = status === "abnormal";
  useEffect(() => {
    for (const p of mats) p.mesh.material = status === "abnormal" ? p.tint : status === "warning" ? p.warn : p.base;
  }, [mats, status]);
  useEffect(
    () => () =>
      mats.forEach((p) => {
        p.tint.dispose();
        p.warn.dispose();
      }),
    [mats],
  );

  const phase = useMemo(() => e.position_m.x * 0.7, [e.position_m.x]);
  useFrame((st) => {
    if (abnormal) return; // a stopped robot holds its pose
    const t = st.clock.elapsedTime + phase;
    joints.a.rotation.y = Math.PI + 0.45 * Math.sin(t * 0.8);
    joints.b.rotation.x = -0.35 - 0.12 * Math.sin(t * 1.3);
    joints.d.rotation.x = -1.2 + 0.28 * Math.sin(t * 1.1 + 0.6);
    joints.f.rotation.x = -0.9 + 0.22 * Math.sin(t * 1.7);
    const grip = 0.06 * Math.max(0, Math.sin(t * 1.6));
    joints.ca.position.x = 0.175 - grip;
    joints.cb.position.x = -0.175 + grip;
  });

  const id = e.demo_id!;
  const click = (ev: ThreeEvent<MouseEvent>) => {
    ev.stopPropagation();
    onSelect(id);
  };
  return (
    <group position={[e.position_m.x, 0, e.position_m.y]}>
      <primitive object={root} scale={ARM_SCALE} />
      {/* generous invisible hit volume so the robot can be picked even when it is small on screen */}
      <mesh
        position={[0, 1, 0.3]}
        userData={{ noCast: true }}
        onClick={click}
        onPointerOver={(ev) => (ev.stopPropagation(), onHover(e.id))}
        onPointerOut={() => onHover(null)}
      >
        <cylinderGeometry args={[0.85, 0.85, 2, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected ? (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} raycast={noRay}>
          <ringGeometry args={[0.62, 0.72, 48]} />
          <meshBasicMaterial color={tokens.primary} />
        </mesh>
      ) : null}
    </group>
  );
}

/* ── other machines ───────────────────────────────────────────────────── */

const Machine = memo(function Machine({ e, sim, onHover }: { e: Instance; sim: MutableRefObject<PlantSim>; onHover: (id: string | null) => void }) {
  const b = boxOf(e);
  const color = NEUTRAL;
  const group = useRef<THREE.Group>(null);
  // the lab geometry has coloured accents (bottles, light strips, stripes): turn every material to its gray value
  useLayoutEffect(() => {
    group.current?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.grayed) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const grayed = mats.map((mat) => {
        const g = mat.clone() as THREE.MeshStandardMaterial;
        if (g.color) {
          const l = g.color.r * 0.3 + g.color.g * 0.59 + g.color.b * 0.11;
          g.color.setScalar(Math.min(0.92, 0.35 + l * 0.6));
        }
        if (g.emissive) g.emissive.setScalar(0);
        return g;
      });
      m.material = Array.isArray(m.material) ? grayed : grayed[0];
      m.userData.grayed = true;
    });
  });
  const hover = {
    onPointerOver: (ev: ThreeEvent<PointerEvent>) => (ev.stopPropagation(), onHover(e.id)),
    onPointerOut: () => onHover(null),
  };
  if (e.type === "fume_hood")
    return (
      <group ref={group} position={[b.cx, 1.9, b.cz]} {...hover}>
        {/* see-through, so the welding robot under it stays visible from above */}
        <FumeHoodDetail w={b.w} d={b.d} opacity={0.35} />
      </group>
    );
  if (DETAIL_TYPES.has(e.type))
    return (
      <group ref={group} position={[b.cx, 0, b.cz]} {...hover}>
        <MachineDetail type={e.type} act={() => sim.current.acts[e.id]} w={b.w} d={b.d} h={b.h} body={color} opacity={1} emissive="#000000" ei={0} />
      </group>
    );
  const low = e.type === "fixture" || e.type === "positioner_2station";
  return (
    <group ref={group} position={[b.cx, 0, b.cz]} {...hover}>
      <RoundedBox args={[b.w, low ? 0.3 : b.h, b.d]} radius={0.03} smoothness={2} position={[0, (low ? 0.3 : b.h) / 2, 0]}>
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.15} />
      </RoundedBox>
    </group>
  );
});

/* ── building: floor, zone pads, low walls, back columns ──────────────── */

const Building = memo(function Building({ tokens, onFloor }: { tokens: SceneTokens; onFloor: () => void }) {
  const B = BUILDING;
  const cols = useMemo(() => {
    const n = Math.round(B.w / 9);
    return Array.from({ length: n + 1 }, (_, i) => (i * B.w) / n);
  }, [B.w]);
  const colRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    cols.forEach((x, i) => colRef.current?.setMatrixAt(i, m.makeTranslation(x, 2.2, 0)));
    if (colRef.current) colRef.current.instanceMatrix.needsUpdate = true;
  }, [cols]);
  const strip = profile_utility_strip();
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[B.w / 2, -0.01, B.d / 2]} receiveShadow onClick={(ev) => ev.delta <= 3 && onFloor()}>
        <planeGeometry args={[B.w + 60, B.d + 60]} />
        <meshBasicMaterial color={tokens.bg} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[B.w / 2, 0.002, B.d / 2]} receiveShadow raycast={noRay}>
        <planeGeometry args={[B.w, B.d]} />
        <meshStandardMaterial color={tokens.floor} roughness={0.95} />
      </mesh>
      {strip ? (
        <mesh rotation-x={-Math.PI / 2} position={[B.w / 2, 0.004, strip / 2]} raycast={noRay}>
          <planeGeometry args={[B.w, strip]} />
          <meshBasicMaterial color={tokens.grid} transparent opacity={0.55} />
        </mesh>
      ) : null}
      {/* process zone pads */}
      {ZONES.map((z) => (
        <mesh key={z.id} rotation-x={-Math.PI / 2} position={[(z.x0 + z.x1) / 2, 0.005, (z.z0 + z.z1) / 2]} raycast={noRay}>
          <planeGeometry args={[z.x1 - z.x0 + 1.2, z.z1 - z.z0 + 1.2]} />
          <meshBasicMaterial color={tokens.grid} transparent opacity={0.45} />
        </mesh>
      ))}
      {/* cart lane (painted) */}
      {[13.0, 14.95].map((z) => (
        <mesh key={z} rotation-x={-Math.PI / 2} position={[B.w / 2, 0.006, z]} raycast={noRay}>
          <planeGeometry args={[B.w - 1, 0.08]} />
          <meshBasicMaterial color="#d9b74a" />
        </mesh>
      ))}
      {/* low walls on three sides, front left open so the line stays visible */}
      {(
        [
          [B.w / 2, 0, B.w, 0.2],
          [0, B.d / 2, 0.2, B.d],
          [B.w, B.d / 2, 0.2, B.d],
        ] as const
      ).map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.45, z]} raycast={noRay}>
          <boxGeometry args={[w, 0.9, d]} />
          <meshStandardMaterial color="#cdd5d3" roughness={0.85} />
        </mesh>
      ))}
      <instancedMesh ref={colRef} args={[undefined, undefined, cols.length]} raycast={noRay}>
        <boxGeometry args={[0.36, 4.4, 0.36]} />
        <meshStandardMaterial color="#8c999c" roughness={0.6} metalness={0.3} />
      </instancedMesh>
    </group>
  );
});

function profile_utility_strip() {
  return (BUILDING as { utility_strip_depth_m?: number }).utility_strip_depth_m ?? null;
}

/* ── strokes: selected connections and the hovered footprint ─────────── */

function Stroke({ points, color, radius, dashed }: { points: THREE.Vector3[]; color: string; radius: number; dashed: boolean }) {
  const geo = useMemo(() => strokeGeometry(points, radius, dashed), [points, radius, dashed]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <mesh geometry={geo} raycast={noRay}>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.5} />
    </mesh>
  );
}

function Connections({ paths }: { paths: ConnPath[] }) {
  return (
    <>
      {paths.map((p) => (
        <Stroke key={p.id} points={p.points} color={p.color} radius={p.radius} dashed={p.assumed} />
      ))}
    </>
  );
}

function HoverOutline({ id }: { id: string | null }) {
  const e = id ? MACHINES.find((m) => m.id === id) : null;
  const pts = useMemo(() => (e && e.type !== "agv" && !isSelectable(e) ? outlineOf(e) : null), [e]);
  if (!e || !pts) return null;
  return <Stroke points={pts} color="#6f8582" radius={0.035} dashed={footprintAssumed(e)} />;
}

/* ── scene ────────────────────────────────────────────────────────────── */

export const PlantScene = memo(function PlantScene({
  tokens,
  sim,
  statusById,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
}: {
  tokens: SceneTokens;
  sim: MutableRefObject<PlantSim>;
  /** Rule Engine status per demo id (robots only) */
  statusById: Record<string, string>;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const selectedInstance = selectedId ? MACHINES.find((m) => m.demo_id === selectedId) ?? null : null;
  const paths = useMemo(() => (selectedInstance ? connectionsOf(selectedInstance.id) : []), [selectedInstance]);
  const scene = useThree((s) => s.scene);
  const light = useRef<THREE.DirectionalLight>(null);
  useLayoutEffect(() => {
    // aim the sun (and its shadow box) at the middle of the hall
    const l = light.current;
    if (l) {
      l.target.position.set(BUILDING.w / 2, 0, BUILDING.d / 2);
      scene.add(l.target);
    }
    // machines cast and receive; flat floor pieces only receive
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
      m.receiveShadow = true;
      if (!(m.geometry instanceof THREE.PlaneGeometry) && !(m.geometry instanceof THREE.RingGeometry) && m.raycast !== noRay && !m.userData.noCast) m.castShadow = true;
    });
    return () => {
      if (l) scene.remove(l.target);
    };
  }, [scene]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    sim.current.advance(dt * SIM_SCALE, ALL_NORMAL);
    sim.current.stepAgvs(dt, SIM_SCALE);
  });

  const B = BUILDING;
  return (
    <>
      <color attach="background" args={[tokens.bg]} />
      <hemisphereLight args={["#ffffff", tokens.floor, 0.75]} />
      <directionalLight ref={light} castShadow position={[B.w / 2 + 14, 26, B.d + 18]} intensity={1.6} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} shadow-normalBias={0.03}>
        <orthographicCamera attach="shadow-camera" args={[-36, 36, 20, -20, 1, 90]} />
      </directionalLight>
      <Environment resolution={64} frames={1}>
        <Lightformer intensity={1.8} position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[40, 20, 1]} />
        <Lightformer intensity={0.7} position={[-20, 4, 10]} rotation-y={Math.PI / 3} scale={[20, 6, 1]} />
      </Environment>

      <Building tokens={tokens} onFloor={() => onSelect("")} />
      <Conveyors />
      {MACHINES.map((e) => {
        if (e.type === "conveyor") return null;
        if (e.type === "agv") return <Agv key={e.id} sim={sim} id={e.id} />;
        if (isSelectable(e))
          return (
            <Robot
              key={e.id}
              e={e}
              status={statusById[e.demo_id!] ?? "normal"}
              selected={selectedId === e.demo_id}
              tokens={tokens}
              onSelect={onSelect}
              onHover={onHover}
            />
          );
        return <Machine key={e.id} e={e} sim={sim} onHover={onHover} />;
      })}
      <Carriers sim={sim} />
      <Connections paths={paths} />
      <HoverOutline id={hoveredId} />
    </>
  );
});
