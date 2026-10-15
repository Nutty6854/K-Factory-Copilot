"use client";

import { Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, SoftShadows, useGLTF } from "@react-three/drei";
import { EffectComposer, N8AO, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

/*
 * Experiment: one robot cell built from CC0 GLB models (Kenney Factory Kit 3.0,
 * see public/models/kenney-factory/SOURCE.md). Query params:
 *   ?state=anom   Robot 03 abnormal (tint + ! pin)
 *   ?robots=3     three robots (frame-rate check)
 *   ?fps=1        on-screen fps readout (also window.__kfFps)
 */

const BASE = "/models/kenney-factory";
const MODELS = {
  arm: `${BASE}/robot-arm-a.glb`,
  conveyor: `${BASE}/conveyor-long.glb`,
  cooler: `${BASE}/machine-window.glb`,
  box: `${BASE}/box-small.glb`,
};
Object.values(MODELS).forEach((url) => useGLTF.preload(url));

type Tokens = Record<
  "bg" | "floor" | "grid" | "primary" | "anom" | "bang" | "surface" | "label" | "anomBg" | "dangerStrong",
  string
>;
const TOKEN_VARS: Record<keyof Tokens, string> = {
  bg: "--kf-bg",
  floor: "--kf-map-floor",
  grid: "--kf-map-grid",
  primary: "--kf-primary",
  anom: "--kf-equip-anom",
  bang: "--kf-anom-bang",
  surface: "--kf-surface",
  label: "--kf-map-label",
  anomBg: "--kf-label-anom-bg",
  dangerStrong: "--kf-danger-strong",
};
function readTokens(): Tokens {
  const s = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.entries(TOKEN_VARS).map(([k, v]) => [k, s.getPropertyValue(v).trim()]),
  ) as Tokens;
}

type RobotSpec = { id: string; name: string; x: number; z: number; facing: 1 | -1 };

function readParams() {
  const q = new URLSearchParams(window.location.search);
  return {
    anomaly: q.get("state") === "anom",
    three: q.get("robots") === "3",
    showFps: q.get("fps") === "1",
  };
}

/* ── Models ─────────────────────────────────────────────────────────── */

function useCloned(url: string, tint?: string) {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (tint) {
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        m.color = new THREE.Color(tint);
        mesh.material = m;
      }
    });
    return root;
  }, [scene, tint]);
}

/** Kenney arm is a straight column with named joints; pose it to reach over the belt. */
function RobotArm({ spec, tint }: { spec: RobotSpec; tint?: string }) {
  const root = useCloned(MODELS.arm, tint);
  useLayoutEffect(() => {
    const j = (n: string) => root.getObjectByName(n);
    j("element-a")!.rotation.y = spec.facing === 1 ? Math.PI : 0;
    j("element-b")!.rotation.x = -0.35;
    j("element-d")!.rotation.x = -1.2;
    j("element-f")!.rotation.x = -0.9;
  }, [root, spec.facing]);
  return <primitive object={root} position={[spec.x, 0, spec.z]} />;
}

function Prop({ url, position, rotationY = 0 }: { url: string; position: [number, number, number]; rotationY?: number }) {
  const root = useCloned(url);
  return <primitive object={root} position={position} rotation={[0, rotationY, 0]} raycast={() => null} />;
}

/* ── Camera: fixed oblique ortho, fitted to the cell bounds on resize ── */

const CAM_DIR = new THREE.Vector3(-0.55, 0.62, 0.78).normalize();

type Anchors = Record<string, { head: [number, number] }>;

function CameraFit({
  bounds,
  robots,
  onProject,
}: {
  bounds: THREE.Box3;
  robots: RobotSpec[];
  onProject: (a: Anchors) => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  useLayoutEffect(() => {
    const f = CAM_DIR.clone().negate();
    const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, f).normalize();
    const center = bounds.getCenter(new THREE.Vector3());
    let rx = 0;
    let uy = 0;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const p = new THREE.Vector3(x, y, z).sub(center);
          rx = Math.max(rx, Math.abs(p.dot(right)));
          uy = Math.max(uy, Math.abs(p.dot(up)));
        }
    camera.zoom = Math.min((0.84 * size.width) / (2 * rx), (0.78 * size.height) / (2 * uy));
    camera.position.copy(center).addScaledVector(CAM_DIR, 40);
    camera.near = 0.1;
    camera.far = 200;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    onProject(
      Object.fromEntries(
        robots.map((r) => {
          const v = new THREE.Vector3(r.x, 2.75, r.z).project(camera);
          return [r.id, { head: [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height] }];
        }),
      ),
    );
  }, [camera, size.width, size.height, bounds, robots, onProject]);
  return null;
}

function FpsProbe({ onFps }: { onFps: (fps: number) => void }) {
  const acc = useRef({ frames: 0, t: performance.now() });
  useFrame(() => {
    const a = acc.current;
    a.frames += 1;
    const now = performance.now();
    if (now - a.t >= 1000) {
      const fps = (a.frames * 1000) / (now - a.t);
      (window as unknown as { __kfFps?: number[] }).__kfFps ??= [];
      (window as unknown as { __kfFps: number[] }).__kfFps.push(fps);
      onFps(fps);
      a.frames = 0;
      a.t = now;
    }
  });
  return null;
}

/* ── Scene ──────────────────────────────────────────────────────────── */

export function RobotCell() {
  const [params] = useState(readParams);
  const [t] = useState(readTokens);
  const [anchors, setAnchors] = useState<Anchors>({});
  const [fps, setFps] = useState<number | null>(null);
  const onProject = useCallback((a: Anchors) => setAnchors(a), []);

  const robots: RobotSpec[] = useMemo(
    () =>
      params.three
        ? [
            { id: "robot_01", name: "Robot 01", x: -3.2, z: -1.3, facing: 1 },
            { id: "robot_02", name: "Robot 02", x: 2.6, z: -1.3, facing: 1 },
            { id: "robot_03", name: "Robot 03", x: 0, z: 1.3, facing: -1 },
          ]
        : [{ id: "robot_03", name: "Robot 03", x: 0, z: 1.3, facing: -1 }],
    [params.three],
  );
  const conveyorXs = params.three ? [-4, -2, 0, 2, 4] : [-2, 0, 2];
  const halfX = params.three ? 5.6 : 3.6;
  const bounds = useMemo(
    () => new THREE.Box3(new THREE.Vector3(-halfX, 0, -3.2), new THREE.Vector3(halfX, 2.8, 2.4)),
    [halfX],
  );
  const coolerX = params.three ? -0.4 : -1.9;

  return (
    <div className="absolute inset-0 bg-bg">
      <Canvas
        orthographic
        shadows
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        camera={{ position: [10, 10, 10], zoom: 80 }}
      >
        <CameraFit bounds={bounds} robots={robots} onProject={onProject} />
        <color attach="background" args={[t.bg]} />
        <SoftShadows size={18} focus={0.6} samples={10} />
        <hemisphereLight args={["#ffffff", t.floor, 0.55]} />
        <directionalLight
          castShadow
          position={[-5, 9, 6]}
          intensity={1.7}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0005}
          shadow-normalBias={0.02}
        >
          <orthographicCamera attach="shadow-camera" args={[-9, 9, 9, -9, 0.1, 40]} />
        </directionalLight>
        <Environment resolution={128} frames={1}>
          <Lightformer intensity={1.6} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
          <Lightformer intensity={0.8} position={[-6, 3, 4]} rotation-y={Math.PI / 3} scale={[8, 4, 1]} />
          <Lightformer intensity={0.5} position={[6, 2, -4]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} />
        </Environment>

        {/* floor + lane markings */}
        <mesh rotation-x={-Math.PI / 2} receiveShadow raycast={() => null}>
          <planeGeometry args={[halfX * 2 + 2, 7.5]} />
          <meshStandardMaterial color={t.floor} roughness={0.95} />
        </mesh>
        {[-0.85, 0.85].map((z) => (
          <mesh key={z} rotation-x={-Math.PI / 2} position={[0, 0.003, z]} raycast={() => null}>
            <planeGeometry args={[halfX * 2, 0.05]} />
            <meshBasicMaterial color={t.grid} />
          </mesh>
        ))}

        <Suspense fallback={null}>
          {conveyorXs.map((x) => (
            <Prop key={x} url={MODELS.conveyor} position={[x, 0, 0]} />
          ))}
          <Prop url={MODELS.box} position={[conveyorXs[0] + 0.4, 0.4, 0]} />
          <Prop url={MODELS.box} position={[1.4, 0.4, 0]} rotationY={0.2} />
          <Prop url={MODELS.cooler} position={[coolerX, 0, -2.4]} rotationY={Math.PI / 2} />
          {robots.map((r) => (
            <RobotArm key={r.id} spec={r} tint={params.anomaly && r.id === "robot_03" ? t.anom : undefined} />
          ))}
        </Suspense>

        <EffectComposer multisampling={0} enableNormalPass={false}>
          <N8AO aoRadius={0.5} distanceFalloff={0.6} intensity={2.4} quality="medium" halfRes />
          <SMAA />
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        </EffectComposer>
        {params.showFps ? <FpsProbe onFps={setFps} /> : null}
      </Canvas>

      {/* floating name pills + ! pin (DOM overlay, fixed screen size) */}
      <div className="pointer-events-none absolute inset-0">
        {robots.map((r) => {
          const a = anchors[r.id];
          if (!a) return null;
          const abnormal = params.anomaly && r.id === "robot_03";
          return (
            <div
              key={r.id}
              className="absolute flex -translate-x-1/2 -translate-y-full items-center gap-1.5"
              style={{ left: a.head[0], top: a.head[1] }}
            >
              <span
                className={`whitespace-nowrap rounded-full px-3 py-[5px] text-[12px] font-medium leading-none shadow-md ${
                  abnormal ? "bg-[var(--kf-label-anom-bg)] text-danger-strong" : "bg-surface text-[var(--kf-map-label)]"
                }`}
              >
                {r.name}
              </span>
              {abnormal ? (
                <span className="relative flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[var(--kf-anom-bang)] text-[14px] font-bold text-white shadow-md">
                  !
                  <span className="absolute -bottom-[5px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-[var(--kf-anom-bang)]" />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute left-5 top-4 text-sm font-semibold text-ink-1">
        라인 A · 셀 시험
      </div>
      {params.showFps ? (
        <div className="absolute right-4 top-4 rounded-md bg-surface/90 px-2 py-1 font-mono text-xs text-ink-2 shadow-sm">
          {fps ? `${fps.toFixed(0)} fps` : "…"}
        </div>
      ) : null}
    </div>
  );
}
