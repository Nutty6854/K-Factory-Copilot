"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { Mats, Tokens } from "./shared";
import { BELT_X0, BELT_X1, BELT_Z, BT, PLATE, ROBOT_XS } from "./layout";

/* ── sparks (reads an active flag each frame; no React re-render) ─── */

const SPARK_N = 36;
export function Sparks({
  active,
  color,
  rate,
  power,
}: {
  active: { current: boolean };
  color: string;
  rate: number;
  power: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(
    () => ({
      p: new Float32Array(SPARK_N * 3),
      v: new Float32Array(SPARK_N * 3),
      life: new Float32Array(SPARK_N),
      acc: 0,
      dummy: new THREE.Object3D(),
    }),
    [],
  );
  useFrame((_, rawDt) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(rawDt, 0.05);
    const { p, v, life, dummy } = data;
    if (active.current) data.acc = Math.min(data.acc + rate * dt, 4);
    for (let i = 0; i < SPARK_N; i++) {
      if (life[i] <= 0 && data.acc >= 1) {
        data.acc -= 1;
        life[i] = 0.25 + Math.random() * 0.35;
        p[i * 3] = p[i * 3 + 1] = p[i * 3 + 2] = 0;
        const a = Math.random() * Math.PI * 2;
        const s = (0.5 + Math.random() * 1.3) * power;
        v[i * 3] = Math.cos(a) * s;
        v[i * 3 + 1] = (0.8 + Math.random() * 1.8) * power;
        v[i * 3 + 2] = Math.sin(a) * s;
      }
      if (life[i] > 0) {
        life[i] -= dt;
        v[i * 3 + 1] -= 9 * dt;
        p[i * 3] += v[i * 3] * dt;
        p[i * 3 + 1] += v[i * 3 + 1] * dt;
        p[i * 3 + 2] += v[i * 3 + 2] * dt;
      }
      const s = life[i] > 0 ? Math.min(life[i] * 3, 1) : 0;
      dummy.position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      dummy.scale.setScalar(s * 0.022 + 0.0001);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, SPARK_N]} frustumCulled={false}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </instancedMesh>
  );
}

/* ── workpiece ────────────────────────────────────────────────────── */

export type WorkRefs = {
  group: THREE.Group;
  hole1: THREE.Mesh;
  hole2: THREE.Mesh;
  seam: THREE.Group;
  seamMat: THREE.MeshStandardMaterial;
  ledMat: THREE.MeshStandardMaterial;
};
export type Work = {
  refs: WorkRefs | null;
  state: "free" | "live";
  k: number;
  x: number;
  machine: number;
  insp: 0 | 1 | 2;
  weld: number;
  heat: number;
};

export function Workpiece({ w, mats }: { w: Work; mats: Mats }) {
  const group = useRef<THREE.Group>(null);
  const hole1 = useRef<THREE.Mesh>(null);
  const hole2 = useRef<THREE.Mesh>(null);
  const seam = useRef<THREE.Group>(null);
  const seamMat = useRef<THREE.MeshStandardMaterial>(null);
  const ledMat = useRef<THREE.MeshStandardMaterial>(null);
  useLayoutEffect(() => {
    w.refs = {
      group: group.current!,
      hole1: hole1.current!,
      hole2: hole2.current!,
      seam: seam.current!,
      seamMat: seamMat.current!,
      ledMat: ledMat.current!,
    };
    return () => {
      w.refs = null;
    };
  }, [w]);
  const top = PLATE.h / 2;
  return (
    <group ref={group} visible={false}>
      <RoundedBox args={[PLATE.w, PLATE.h, PLATE.d]} radius={0.012} smoothness={3} material={mats.zinc} />
      {[-0.2, 0.2].map((x, i) => (
        <mesh key={x} ref={i === 0 ? hole1 : hole2} position={[x, top + 0.0015, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.004, 24]} />
          <meshStandardMaterial color="#0b0d0e" roughness={0.9} />
        </mesh>
      ))}
      <group ref={seam} position={[-0.32, top + 0.006, 0.12]}>
        <mesh position={[0.32, 0, 0]}>
          <boxGeometry args={[0.64, 0.012, 0.03]} />
          <meshStandardMaterial
            ref={seamMat}
            color="#6b6f72"
            emissive="#ff7a1a"
            emissiveIntensity={0}
            metalness={0.8}
            roughness={0.45}
            toneMapped={false}
          />
        </mesh>
      </group>
      <mesh position={[-0.38, top + 0.012, -0.2]}>
        <sphereGeometry args={[0.014, 12, 12]} />
        <meshStandardMaterial ref={ledMat} color="#444" emissive="#000" emissiveIntensity={0} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ── floor / conveyor / fence ─────────────────────────────────────── */

export function Floor({ t, mats }: { t: Tokens; mats: Mats }) {
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
    tex.repeat.set(10, 5);
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
        <planeGeometry args={[26, 14]} />
        <meshStandardMaterial color={t.floor} roughness={0.8} roughnessMap={rough} metalness={0} />
      </mesh>
      {ROBOT_XS.flatMap((x, i) => [
        line(x, -1.0, 2.3, 0.05, `a${i}`),
        line(x, 0.98, 2.3, 0.05, `b${i}`),
        line(x - 1.15, -0.01, 0.05, 2.03, `c${i}`),
        line(x + 1.15, -0.01, 0.05, 2.03, `d${i}`),
      ])}
      {/* AGV lane */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.003, 3.4]} userData={{ noCast: true }}>
        <planeGeometry args={[12.6, 0.8]} />
        <meshBasicMaterial color="#e0b020" transparent opacity={0.1} />
      </mesh>
    </group>
  );
}

export function Conveyor({ mats, dxRef }: { mats: Mats; dxRef: { current: number } }) {
  const L = BELT_X1 - BELT_X0;
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
  useFrame(() => {
    tex.offset.x -= dxRef.current / 0.35;
  });
  const legs = Array.from({ length: 9 }, (_, i) => BELT_X0 + 0.25 + (i * (L - 0.5)) / 8);
  return (
    <group position={[0, 0, BELT_Z]}>
      <mesh position={[0, BT - 0.012, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[L, 0.62]} />
        <meshStandardMaterial map={tex} roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <RoundedBox args={[L + 0.1, 0.12, 0.05]} radius={0.01} position={[0, BT - 0.06, s * 0.34]} material={mats.steel} />
          <RoundedBox args={[L, 0.05, 0.03]} radius={0.008} position={[0, BT + 0.045, s * 0.33]} material={mats.aluminum} />
        </group>
      ))}
      {legs.flatMap((x) =>
        [-1, 1].map((s) => (
          <mesh key={`${x}${s}`} position={[x, (BT - 0.12) / 2, s * 0.3]} material={mats.graphite}>
            <boxGeometry args={[0.05, BT - 0.12, 0.05]} />
          </mesh>
        )),
      )}
      {legs.slice(0, -1).map((x, i) => (
        <mesh key={`b${i}`} position={[x + (L - 0.5) / 16, 0.22, 0]} material={mats.graphite}>
          <boxGeometry args={[0.03, 0.03, 0.6]} />
        </mesh>
      ))}
      {[BELT_X0 + 0.02, BELT_X1 - 0.02].map((x) => (
        <mesh key={x} position={[x, BT - 0.06, 0]} rotation-x={Math.PI / 2} material={mats.aluminum}>
          <cylinderGeometry args={[0.055, 0.055, 0.64, 24]} />
        </mesh>
      ))}
      <group position={[BELT_X1 + 0.12, 0.34, 0.2]}>
        <RoundedBox args={[0.3, 0.2, 0.2]} radius={0.03} material={mats.graphite} />
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[(i - 2) * 0.05, 0.11, 0]} material={mats.steel}>
            <boxGeometry args={[0.02, 0.025, 0.2]} />
          </mesh>
        ))}
      </group>
      {/* station fixtures: locating pad + pins */}
      {ROBOT_XS.map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, BT + 0.0015, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[1.05, 0.54]} />
            <meshBasicMaterial color="#6d8e7d" transparent opacity={0.2} depthWrite={false} />
          </mesh>
          {[-1, 1].flatMap((sx) =>
            [-1, 1].map((sz) => (
              <mesh key={`${sx}${sz}`} position={[sx * 0.5, BT + 0.02, sz * 0.285]} material={mats.yellow}>
                <cylinderGeometry args={[0.014, 0.014, 0.04, 10]} />
              </mesh>
            )),
          )}
        </group>
      ))}
    </group>
  );
}

export function Fence({ mats }: { mats: Mats }) {
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
      ...[-5.2, -2.6, 0, 2.6, 5.2].map((x, i) => ({
        key: `b${i}`,
        len: 2.6,
        pos: [x, 0, -1.7] as [number, number, number],
        rotY: 0,
      })),
      { key: "l", len: 2.2, pos: [-6.5, 0, -0.6], rotY: Math.PI / 2 },
      { key: "r", len: 2.2, pos: [6.5, 0, -0.6], rotY: Math.PI / 2 },
    ];
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
