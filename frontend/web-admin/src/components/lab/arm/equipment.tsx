"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { Mats } from "./shared";
import { CAB, CHILLER, PANEL, ROBOT_XS, WELD, type Infra, type Status } from "./layout";

type Sel = (id: string) => void;
type InfraRef = { current: Infra };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function useExtra() {
  return useMemo(
    () => ({
      chiller: new THREE.MeshPhysicalMaterial({ color: "#e3ebee", roughness: 0.4, metalness: 0.1, clearcoat: 0.4 }),
      blue: new THREE.MeshStandardMaterial({ color: "#3f8fbd", roughness: 0.45, metalness: 0.2 }),
      glass: new THREE.MeshStandardMaterial({ color: "#10222e", roughness: 0.15, metalness: 0.6 }),
      gas: new THREE.MeshStandardMaterial({ color: "#8fa0a8", roughness: 0.35, metalness: 0.7 }),
      gasTop: new THREE.MeshStandardMaterial({ color: "#2f6f55", roughness: 0.4, metalness: 0.5 }),
      hose: new THREE.MeshStandardMaterial({ color: "#1b1f21", roughness: 0.7 }),
      hoseBlue: new THREE.MeshStandardMaterial({ color: "#2f6fa3", roughness: 0.6 }),
    }),
    [],
  );
}

const statusColor = (s: Status) => (s === "abnormal" ? "#ff4a2e" : s === "warning" ? "#ffb02e" : "#35e08a");

/** cylinder between two points */
function Link({
  a,
  b,
  r,
  rEnd,
  mat,
}: {
  a: [number, number, number];
  b: [number, number, number];
  r: number;
  rEnd?: number;
  mat: THREE.Material;
}) {
  const { pos, quat, len } = useMemo(() => {
    const A = V(...a);
    const B = V(...b);
    const d = B.clone().sub(A);
    const len = d.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
    return { pos: A.clone().add(B).multiplyScalar(0.5).toArray() as [number, number, number], quat, len };
  }, [a, b]);
  return (
    <mesh position={pos} quaternion={quat} material={mat}>
      <cylinderGeometry args={[rEnd ?? r, r, len, 16]} />
    </mesh>
  );
}

/* ── manifolds where the lines land on each robot plinth ──────────── */

export function Manifolds({ mats }: { mats: Mats }) {
  return (
    <>
      {ROBOT_XS.map((x) => (
        <group key={x} position={[x, 0, -0.4]}>
          <RoundedBox args={[0.5, 0.1, 0.08]} radius={0.015} position={[0, 0.37, 0]} material={mats.graphite} />
          {[-0.17, -0.05, 0.15].map((dx, i) => (
            <mesh key={dx} position={[dx, 0.425, 0]} material={i === 2 ? mats.yellow : mats.aluminum}>
              <cylinderGeometry args={[0.05, 0.05, 0.02, 16]} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

/* ── chiller (cooling line 1) ─────────────────────────────────────── */

export function Chiller({ infra, onSelect }: { infra: InfraRef; onSelect: Sel }) {
  const m = useExtra();
  const fans = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const disp = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = infra.current.chiller;
    const w = st === "normal" ? 14 : st === "warning" ? 7 : 1.2;
    fans.forEach((f, i) => {
      if (f.current) f.current.rotation.y += dt * w * (i ? -1 : 1);
    });
    if (disp.current) {
      const c = statusColor(st);
      disp.current.color.set(c);
      disp.current.emissive.set(c);
    }
  });
  return (
    <group
      position={[CHILLER.x, 0, CHILLER.z]}
      onClick={(e) => (e.stopPropagation(), onSelect("chiller"))}
    >
      <RoundedBox args={[1.2, 1.05, 0.8]} radius={0.03} smoothness={3} position={[0, 0.55, 0]} material={m.chiller} />
      <mesh position={[0, 0.84, 0]} material={m.blue}>
        <boxGeometry args={[1.215, 0.1, 0.815]} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} position={[-0.25, 0.14 + i * 0.045, 0.402]} material={m.glass}>
          <boxGeometry args={[0.55, 0.015, 0.006]} />
        </mesh>
      ))}
      <mesh position={[0.36, 0.42, 0.404]} material={m.glass}>
        <boxGeometry args={[0.3, 0.16, 0.006]} />
      </mesh>
      <mesh position={[0.36, 0.42, 0.409]}>
        <planeGeometry args={[0.24, 0.1]} />
        <meshStandardMaterial ref={disp} color="#35e08a" emissive="#35e08a" emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.5, 0.03, 0.3]} material={m.glass}>
          <boxGeometry args={[0.12, 0.06, 0.12]} />
        </mesh>
      ))}
      {/* top fans */}
      {[-0.3, 0.3].map((x, i) => (
        <group key={x} position={[x, 1.085, 0.05]}>
          <mesh rotation-x={Math.PI / 2} material={m.glass}>
            <torusGeometry args={[0.26, 0.018, 8, 36]} />
          </mesh>
          <group ref={fans[i]}>
            {[0, 1, 2, 3].map((b) => (
              <mesh key={b} rotation={[0, (b * Math.PI) / 2, 0]} position={[0, 0, 0]} material={m.glass}>
                <boxGeometry args={[0.46, 0.008, 0.06]} />
              </mesh>
            ))}
            <mesh material={m.glass}>
              <cylinderGeometry args={[0.04, 0.04, 0.02, 16]} />
            </mesh>
          </group>
        </group>
      ))}
      {/* pipe stubs (supply / return) */}
      {[-0.3, -0.1].map((x, i) => (
        <mesh key={x} position={[x, 1.1, 0]} material={i ? m.hoseBlue : m.blue}>
          <cylinderGeometry args={[0.06, 0.06, 0.07, 16]} />
        </mesh>
      ))}
    </group>
  );
}

/* ── power panel (Power Zone A) ───────────────────────────────────── */

export function PowerPanel({ mats, infra, onSelect }: { mats: Mats; infra: InfraRef; onSelect: Sel }) {
  const lamps = [useRef<THREE.MeshStandardMaterial>(null), useRef<THREE.MeshStandardMaterial>(null), useRef<THREE.MeshStandardMaterial>(null)];
  useFrame(({ clock }) => {
    const st = infra.current.panel;
    lamps.forEach((l, i) => {
      const m = l.current;
      if (!m) return;
      let c = "#35e08a";
      let k = 3;
      if (st === "abnormal") {
        const f = Math.sin(clock.elapsedTime * (9 + i * 3) + i) > 0;
        c = f ? "#ff4a2e" : "#ffb02e";
        k = f ? 3.5 : 0.8;
      } else if (st === "warning") c = "#ffb02e";
      m.color.set(c);
      m.emissive.set(c);
      m.emissiveIntensity = k;
    });
  });
  return (
    <group position={[PANEL.x, 0, PANEL.z]} onClick={(e) => (e.stopPropagation(), onSelect("power_a"))}>
      <RoundedBox args={[0.9, 1.9, 0.45]} radius={0.015} position={[0, 0.95, 0]} material={mats.cabinet} />
      {[-0.15, 0.15].map((x) => (
        <mesh key={x} position={[x, 0.95, 0.227]} material={mats.graphite}>
          <boxGeometry args={[0.005, 1.8, 0.002]} />
        </mesh>
      ))}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <mesh key={i} position={[0, 0.2 + i * 0.022, 0.227]} material={mats.graphite}>
          <boxGeometry args={[0.5, 0.008, 0.002]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.28, 0.95, 0.24]} material={mats.aluminum}>
          <boxGeometry args={[0.03, 0.2, 0.03]} />
        </mesh>
      ))}
      {/* warning plate + phase lamps */}
      <mesh position={[0, 1.45, 0.23]} material={mats.yellow}>
        <boxGeometry args={[0.42, 0.18, 0.006]} />
      </mesh>
      <mesh position={[0, 1.45, 0.234]} material={mats.graphite}>
        <cylinderGeometry args={[0.045, 0.045, 0.004, 3]} />
      </mesh>
      {[-0.2, 0, 0.2].map((x, i) => (
        <mesh key={x} position={[x, 1.68, 0.232]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.028, 0.028, 0.02, 16]} />
          <meshStandardMaterial ref={lamps[i]} color="#35e08a" emissive="#35e08a" emissiveIntensity={3} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, 1.93, 0]} material={mats.graphite}>
        <cylinderGeometry args={[0.08, 0.1, 0.05, 16]} />
      </mesh>
    </group>
  );
}

/* ── weld power source, wire feeder, gas cylinders ────────────────── */

export function WeldStation({ mats, infra, onSelect }: { mats: Mats; infra: InfraRef; onSelect: Sel }) {
  const m = useExtra();
  const disp = useRef<THREE.MeshStandardMaterial>(null);
  const hoses = useMemo(() => {
    const tube = (pts: THREE.Vector3[], r: number) =>
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "centripetal"), 40, r, 8, false);
    return {
      gas: tube([V(0.78, 1.28, 0.05), V(0.6, 1.3, 0.12), V(0.42, 1.0, 0.2), V(0.34, 0.62, 0.3)], 0.012),
      // bundle from the feeder to the robot-03 plinth (world x≈3.02, z≈0.15)
      bundle: tube([V(-0.3, 0.12, 0.3), V(-0.6, 0.012, 0.55), V(-0.9, 0.012, 0.78), V(-1.13, 0.1, 0.7)], 0.03),
    };
  }, []);
  useFrame(() => {
    const d = disp.current;
    if (!d) return;
    const c = statusColor(infra.current.weld);
    d.color.set(c);
    d.emissive.set(c);
  });
  return (
    <group position={[WELD.x, 0, WELD.z]} onClick={(e) => (e.stopPropagation(), onSelect("weld_src"))}>
      {/* cart */}
      <mesh position={[0, 0.2, 0]} material={mats.graphite}>
        <boxGeometry args={[0.76, 0.04, 0.66]} />
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 0.3, 0.09, sz * 0.26]} rotation-z={Math.PI / 2} material={mats.rubber}>
            <cylinderGeometry args={[0.09, 0.09, 0.05, 16]} />
          </mesh>
        )),
      )}
      {/* source */}
      <RoundedBox args={[0.7, 0.52, 0.6]} radius={0.025} position={[0, 0.48, 0]} material={mats.cabinet} />
      <mesh position={[0, 0.5, 0.305]} material={m.glass}>
        <boxGeometry args={[0.6, 0.4, 0.008]} />
      </mesh>
      <mesh position={[-0.12, 0.6, 0.312]}>
        <planeGeometry args={[0.22, 0.09]} />
        <meshStandardMaterial ref={disp} color="#35e08a" emissive="#35e08a" emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
      {[0.12, 0.24].map((x) => (
        <mesh key={x} position={[x, 0.6, 0.322]} rotation-x={Math.PI / 2} material={mats.aluminum}>
          <cylinderGeometry args={[0.032, 0.032, 0.03, 16]} />
        </mesh>
      ))}
      {[-0.2, 0, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.38, 0.322]} rotation-x={Math.PI / 2} material={mats.yellow}>
          <cylinderGeometry args={[0.02, 0.02, 0.02, 12]} />
        </mesh>
      ))}
      <mesh position={[0, 0.77, 0]} material={mats.graphite}>
        <boxGeometry args={[0.34, 0.025, 0.05]} />
      </mesh>
      {/* wire feeder + spool */}
      <RoundedBox args={[0.44, 0.28, 0.3]} radius={0.02} position={[0, 0.93, 0]} material={mats.paint} />
      <mesh position={[0, 0.93, 0.17]} rotation-x={Math.PI / 2} material={mats.copper}>
        <cylinderGeometry args={[0.12, 0.12, 0.05, 28]} />
      </mesh>
      <mesh position={[0, 0.93, 0.2]} rotation-x={Math.PI / 2} material={mats.graphite}>
        <cylinderGeometry args={[0.03, 0.03, 0.03, 12]} />
      </mesh>
      {/* gas cylinders */}
      {[0.78, 1.0].map((x, i) => (
        <group key={x} position={[x, 0, 0.05 - i * 0.05]}>
          <mesh position={[0, 0.58, 0]} material={m.gas}>
            <cylinderGeometry args={[0.1, 0.1, 1.16, 24]} />
          </mesh>
          <mesh position={[0, 1.17, 0]} material={m.gasTop}>
            <sphereGeometry args={[0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh position={[0, 1.29, 0]} material={mats.aluminum}>
            <cylinderGeometry args={[0.025, 0.025, 0.1, 10]} />
          </mesh>
          <mesh position={[0, 0.82, 0]} rotation-x={Math.PI / 2} material={mats.yellow}>
            <torusGeometry args={[0.102, 0.008, 6, 24]} />
          </mesh>
        </group>
      ))}
      <mesh geometry={hoses.gas} material={m.hoseBlue} userData={{ noCast: true }} />
      <mesh geometry={hoses.bundle} material={m.hose} userData={{ noCast: true }} />
    </group>
  );
}

/* ── fume extraction arm at the weld station ──────────────────────── */

export function FumeArm({ mats }: { mats: Mats }) {
  const m = useExtra();
  const bx = ROBOT_XS[2] + 1.0;
  const P0: [number, number, number] = [0, 1.3, 0];
  const P1: [number, number, number] = [-0.2, 1.5, 0.35];
  const P2: [number, number, number] = [-0.38, 1.0, 0.8];
  const dir = V(P2[0] - P1[0], P2[1] - P1[1], P2[2] - P1[2]).normalize();
  const H: [number, number, number] = [P2[0] + dir.x * 0.16, P2[1] + dir.y * 0.16, P2[2] + dir.z * 0.16];
  return (
    <group position={[bx, 0, 0.65]}>
      <mesh position={[0, 0.025, 0]} material={mats.graphite}>
        <cylinderGeometry args={[0.16, 0.18, 0.05, 20]} />
      </mesh>
      <Link a={[0, 0.05, 0]} b={P0} r={0.05} mat={mats.steel} />
      <Link a={P0} b={P1} r={0.045} mat={m.hose} />
      <Link a={P1} b={P2} r={0.045} mat={m.hose} />
      <Link a={P2} b={H} r={0.06} rEnd={0.17} mat={mats.aluminum} />
      {[P0, P1, P2].map((p, i) => (
        <mesh key={i} position={p} material={mats.graphite}>
          <sphereGeometry args={[0.062, 14, 14]} />
        </mesh>
      ))}
    </group>
  );
}

/* ── controller cabinet + signal cables to each robot ─────────────── */

export function ControlCabinet({ mats, status }: { mats: Mats; status: Status }) {
  const tower = useRef<THREE.MeshStandardMaterial>(null);
  const led = statusColor(status);
  useFrame(({ clock }) => {
    if (tower.current)
      tower.current.emissiveIntensity = status === "abnormal" ? (Math.sin(clock.elapsedTime * 9) > 0 ? 3.5 : 0.3) : 2.4;
  });
  const cables = useMemo(
    () =>
      ROBOT_XS.map((rx, i) => {
        const c = new THREE.CatmullRomCurve3(
          [V(CAB.x + (i - 1) * 0.14, 0.05, CAB.z + 0.27), V((CAB.x + rx) / 2, 0.012, -0.8 + i * 0.03), V(rx - 0.3, 0.014, -0.58), V(rx - 0.3, 0.12, -0.44)],
          false,
          "centripetal",
        );
        return new THREE.TubeGeometry(c, 48, 0.014, 7, false);
      }),
    [],
  );
  return (
    <group>
      <group position={[CAB.x, 0, CAB.z]}>
        <RoundedBox args={[0.7, 1.3, 0.5]} radius={0.015} position={[0, 0.65, 0]} material={mats.cabinet} />
        <mesh position={[0, 0.65, 0.252]} material={mats.graphite}>
          <boxGeometry args={[0.005, 1.2, 0.002]} />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} position={[-0.16, 0.2 + i * 0.022, 0.252]} material={mats.graphite}>
            <boxGeometry args={[0.22, 0.008, 0.002]} />
          </mesh>
        ))}
        <mesh position={[0.2, 0.68, 0.27]} material={mats.aluminum}>
          <boxGeometry args={[0.03, 0.14, 0.03]} />
        </mesh>
        <mesh position={[0.2, 1.0, 0.262]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.032, 0.032, 0.03, 20]} />
          <meshStandardMaterial color="#cf3b2b" roughness={0.4} />
        </mesh>
        <mesh position={[0.2, 1.0, 0.254]} rotation-x={Math.PI / 2} material={mats.yellow}>
          <cylinderGeometry args={[0.048, 0.048, 0.008, 20]} />
        </mesh>
        <mesh position={[-0.2, 1.0, 0.256]}>
          <sphereGeometry args={[0.014, 12, 12]} />
          <meshStandardMaterial color={led} emissive={led} emissiveIntensity={3} toneMapped={false} />
        </mesh>
        <mesh position={[-0.25, 1.4, 0]} material={mats.graphite}>
          <cylinderGeometry args={[0.012, 0.012, 0.2, 10]} />
        </mesh>
        <mesh position={[-0.25, 1.56, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.12, 20]} />
          <meshStandardMaterial ref={tower} color={led} emissive={led} emissiveIntensity={2.4} toneMapped={false} />
        </mesh>
      </group>
      {cables.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.rubber} userData={{ noCast: true }} />
      ))}
    </group>
  );
}

/* ── AGV on the front lane ────────────────────────────────────────── */

export function Agv({ infra }: { infra: InfraRef }) {
  const g = useRef<THREE.Group>(null);
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  const phase = useRef(1.2);
  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    phase.current += dt * 0.22 * THREE.MathUtils.clamp(infra.current.speed, 0, 1);
    const s = Math.sin(phase.current);
    if (g.current) {
      g.current.position.x = s * 5.4;
      g.current.rotation.y = Math.cos(phase.current) > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    if (lamp.current) lamp.current.emissiveIntensity = 1.2 + Math.sin(clock.elapsedTime * 6);
  });
  return (
    <group ref={g} position={[0, 0, 3.4]}>
      <RoundedBox args={[0.95, 0.2, 0.62]} radius={0.04} position={[0, 0.17, 0]}>
        <meshStandardMaterial color="#5a6870" roughness={0.45} metalness={0.5} />
      </RoundedBox>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.8, 0.05, 0.52]} />
        <meshStandardMaterial color="#e0b020" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.6, 0.36, 0.4]} />
        <meshStandardMaterial color="#6d8e7d" roughness={0.7} />
      </mesh>
      <mesh position={[0.46, 0.2, 0]}>
        <sphereGeometry args={[0.04, 10, 10]} />
        <meshStandardMaterial ref={lamp} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1} toneMapped={false} />
      </mesh>
    </group>
  );
}
