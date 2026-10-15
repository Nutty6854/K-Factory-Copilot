"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Mats } from "./shared";
import { CHILLER, PANEL, RACK, ROBOT_XS, WELD, netTouches, type NetKind, type Status } from "./layout";

/*
 * Utility networks: cooling water (supply + return) and power (cable tray).
 * Every pipe carries a moving dash pattern so you can read flow direction/speed at a glance;
 * faults slow the flow and recolour it, selecting a node lights up the lines connected to it.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** polyline with rounded elbows */
function rounded(pts: THREE.Vector3[], r = 0.14) {
  const out: THREE.Vector3[] = [pts[0].clone()];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const da = pts[i - 1].clone().sub(p);
    const db = pts[i + 1].clone().sub(p);
    const ra = Math.min(r, da.length() / 2);
    const rb = Math.min(r, db.length() / 2);
    out.push(p.clone().add(da.normalize().multiplyScalar(ra)));
    out.push(p.clone().add(db.normalize().multiplyScalar(rb)));
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

type PipeDef = {
  key: string;
  net: NetKind;
  /** drops belong to one edge; trunks are shared (to = null) */
  from: string;
  to: string | null;
  pts: THREE.Vector3[];
  radius: number;
};

function buildPipes(): PipeDef[] {
  const { supplyY: sY, supplyZ: sZ, returnY: rY, returnZ: rZ, trayY: tY, trayZ: tZ } = RACK;
  const robotIds = ["robot_01", "robot_02", "robot_03"];
  const pipes: PipeDef[] = [];

  /* cooling: chiller → header → robots, and back */
  pipes.push({
    key: "c-sup",
    net: "cooling",
    from: "chiller",
    to: null,
    radius: 0.045,
    pts: [V(CHILLER.x - 0.3, 1.12, CHILLER.z), V(CHILLER.x - 0.3, sY, CHILLER.z), V(CHILLER.x - 0.3, sY, sZ), V(WELD.x - 0.17, sY, sZ)],
  });
  pipes.push({
    key: "c-ret",
    net: "cooling",
    from: "chiller",
    to: null,
    radius: 0.045,
    pts: [V(WELD.x - 0.05, rY, rZ), V(CHILLER.x - 0.1, rY, rZ), V(CHILLER.x - 0.1, rY, CHILLER.z), V(CHILLER.x - 0.1, 1.12, CHILLER.z)],
  });
  ROBOT_XS.forEach((rx, i) => {
    pipes.push({
      key: `c-sd${i}`,
      net: "cooling",
      from: "chiller",
      to: robotIds[i],
      radius: 0.04,
      pts: [V(rx - 0.17, sY, sZ), V(rx - 0.17, 0.72, sZ), V(rx - 0.17, 0.72, -0.4), V(rx - 0.17, 0.42, -0.4)],
    });
    pipes.push({
      key: `c-rd${i}`,
      net: "cooling",
      from: "chiller",
      to: robotIds[i],
      radius: 0.04,
      pts: [V(rx - 0.05, 0.42, -0.4), V(rx - 0.05, 0.58, -0.4), V(rx - 0.05, 0.58, rZ), V(rx - 0.05, rY, rZ)],
    });
  });

  /* the weld source is on the same cooling line (chiller_01 → weldsrc_01 in the factory profile) */
  pipes.push({
    key: "c-sd-weld",
    net: "cooling",
    from: "chiller",
    to: "weld_src",
    radius: 0.04,
    pts: [V(WELD.x - 0.17, sY, sZ), V(WELD.x - 0.17, 0.78, sZ), V(WELD.x - 0.17, 0.78, WELD.z - 0.1), V(WELD.x - 0.17, 0.62, WELD.z - 0.1)],
  });
  pipes.push({
    key: "c-rd-weld",
    net: "cooling",
    from: "chiller",
    to: "weld_src",
    radius: 0.04,
    pts: [V(WELD.x - 0.05, 0.62, WELD.z - 0.1), V(WELD.x - 0.05, 0.7, WELD.z - 0.1), V(WELD.x - 0.05, 0.7, rZ), V(WELD.x - 0.05, rY, rZ)],
  });

  /* power: panel → tray → consumers */
  pipes.push({
    key: "p-trunk",
    net: "power",
    from: "power_a",
    to: null,
    radius: 0.03,
    pts: [V(PANEL.x, 1.9, PANEL.z), V(PANEL.x, tY, PANEL.z), V(PANEL.x, tY, tZ), V(WELD.x, tY, tZ)],
  });
  ROBOT_XS.forEach((rx, i) => {
    pipes.push({
      key: `p-d${i}`,
      net: "power",
      from: "power_a",
      to: robotIds[i],
      radius: 0.028,
      pts: [V(rx + 0.15, tY, tZ), V(rx + 0.15, 0.9, tZ), V(rx + 0.15, 0.9, -0.4), V(rx + 0.15, 0.42, -0.4)],
    });
  });
  pipes.push({
    key: "p-chiller",
    net: "power",
    from: "power_a",
    to: "chiller",
    radius: 0.028,
    pts: [V(CHILLER.x + 0.3, tY, tZ), V(CHILLER.x + 0.3, 0.62, tZ), V(CHILLER.x + 0.3, 0.62, CHILLER.z - 0.42)],
  });
  pipes.push({
    key: "p-weld",
    net: "power",
    from: "power_a",
    to: "weld_src",
    radius: 0.028,
    pts: [V(WELD.x, tY, tZ), V(WELD.x, 0.55, tZ), V(WELD.x, 0.55, WELD.z - 0.32)],
  });
  return pipes;
}

function dashTextures() {
  const mk = (bg: string, fg: string) => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 16;
    const g = c.getContext("2d")!;
    g.fillStyle = bg;
    g.fillRect(0, 0, 64, 16);
    const grad = g.createLinearGradient(0, 0, 26, 0);
    grad.addColorStop(0, bg);
    grad.addColorStop(0.25, fg);
    grad.addColorStop(1, fg);
    g.fillStyle = grad;
    g.fillRect(0, 0, 26, 16);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk("#9aa5aa", "#ffffff"), em: mk("#000000", "#ffffff") };
}

const PERIOD = 0.35;
const COL = {
  cooling: { ok: new THREE.Color("#5bbbe6"), bad: new THREE.Color("#ff7a3d") },
  power: { ok: new THREE.Color("#f2b13c"), bad: new THREE.Color("#ff4a2e") },
};

type Live = { def: PipeDef; mat: THREE.MeshStandardMaterial; maps: THREE.CanvasTexture[]; geo: THREE.TubeGeometry };

export function Utilities({
  net,
  selectedId,
  show,
}: {
  /** current state of each network (mutated by the sim, read every frame) */
  net: { current: Record<NetKind, Status> };
  selectedId: string | null;
  show: Record<NetKind, boolean>;
}) {
  const sel = useRef(selectedId);
  const vis = useRef(show);
  useEffect(() => {
    sel.current = selectedId;
    vis.current = show;
  }, [selectedId, show]);

  const lives = useMemo<Live[]>(() => {
    const base = dashTextures();
    return buildPipes().map((def) => {
      const curve = new THREE.CatmullRomCurve3(rounded(def.pts), false, "centripetal");
      const len = curve.getLength();
      const geo = new THREE.TubeGeometry(curve, Math.max(24, Math.ceil(len * 14)), def.radius, 10, false);
      const map = base.map.clone();
      const em = base.em.clone();
      for (const t of [map, em]) {
        t.repeat.set(len / PERIOD, 1);
        t.needsUpdate = true;
      }
      const mat = new THREE.MeshStandardMaterial({
        map,
        emissiveMap: em,
        color: COL[def.net].ok,
        emissive: COL[def.net].ok,
        emissiveIntensity: 1,
        roughness: 0.4,
        metalness: 0.35,
        toneMapped: false,
      });
      return { def, mat, maps: [map, em], geo };
    });
  }, []);

  const groups = useRef<Record<NetKind, THREE.Group | null>>({ cooling: null, power: null });
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = sel.current;
    (["cooling", "power"] as NetKind[]).forEach((k) => {
      if (groups.current[k]) groups.current[k]!.visible = vis.current[k];
    });
    for (const { def, mat, maps } of lives) {
      const st = net.current[def.net];
      const bad = st !== "normal";
      const active = s === null ? true : def.to === null ? netTouches(def.net, s) : s === def.from || s === def.to;
      tmp.copy(bad ? COL[def.net].bad : COL[def.net].ok);
      if (s !== null && !active) tmp.multiplyScalar(0.45);
      mat.color.copy(tmp);
      mat.emissive.copy(tmp);

      let speed: number;
      let inten: number;
      if (def.net === "cooling") {
        speed = bad ? 0.1 : 0.5;
        inten = bad ? 0.9 + 0.7 * Math.sin(performance.now() / 180) : 1.1;
      } else {
        speed = bad ? 0.2 + Math.random() * 1.6 : 1.1;
        inten = bad ? 0.4 + Math.random() * 1.6 : 1.1;
      }
      if (s !== null) inten *= active ? 1.9 : 0.12;
      mat.emissiveIntensity = Math.max(inten, 0);
      for (const m of maps) m.offset.x -= (speed * dt) / PERIOD;
    }
  });

  return (
    <>
      {(["cooling", "power"] as NetKind[]).map((k) => (
        <group
          key={k}
          ref={(g) => {
            groups.current[k] = g;
          }}
        >
          {lives
            .filter((l) => l.def.net === k)
            .map((l) => (
              <mesh key={l.def.key} geometry={l.geo} material={l.mat} userData={{ noCast: true }} />
            ))}
        </group>
      ))}
    </>
  );
}

/* ── structural rack that carries the lines ───────────────────────── */

export function Rack({ mats }: { mats: Mats }) {
  const { xs, z, trayY, trayZ } = RACK;
  const x0 = Math.min(PANEL.x, xs[0]);
  const x1 = xs[xs.length - 1];
  const trayLen = WELD.x + 0.25 - PANEL.x;
  const trayCx = (PANEL.x + WELD.x + 0.25) / 2;
  return (
    <group>
      {xs.map((x) => (
        <group key={x}>
          <mesh position={[x, 1.35, z]} material={mats.graphite}>
            <boxGeometry args={[0.12, 2.7, 0.12]} />
          </mesh>
          <mesh position={[x, 0.015, z]} material={mats.steel}>
            <boxGeometry args={[0.34, 0.03, 0.34]} />
          </mesh>
          {/* pipe cantilever + stand for the supply line */}
          <mesh position={[x, 2.22, (z + RACK.returnZ) / 2 - 0.1]} material={mats.graphite}>
            <boxGeometry args={[0.07, 0.05, 0.7]} />
          </mesh>
          <mesh position={[x, 2.37, RACK.supplyZ]} material={mats.graphite}>
            <boxGeometry args={[0.04, 0.3, 0.04]} />
          </mesh>
          {/* tray bracket */}
          <mesh position={[x, trayY - 0.1, (z + trayZ) / 2]} material={mats.graphite}>
            <boxGeometry args={[0.07, 0.05, Math.abs(z - trayZ) + 0.2]} />
          </mesh>
        </group>
      ))}
      <mesh position={[(x0 + x1) / 2, 2.72, z]} material={mats.graphite}>
        <boxGeometry args={[x1 - x0, 0.1, 0.12]} />
      </mesh>
      {/* cable tray channel */}
      <mesh position={[trayCx, trayY - 0.045, trayZ]} material={mats.steel}>
        <boxGeometry args={[trayLen, 0.03, 0.26]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[trayCx, trayY - 0.01, trayZ + s * 0.125]} material={mats.steel}>
          <boxGeometry args={[trayLen, 0.08, 0.015]} />
        </mesh>
      ))}
    </group>
  );
}
