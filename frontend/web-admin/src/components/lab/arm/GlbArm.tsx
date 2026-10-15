"use client";

import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { createPortal } from "@react-three/fiber";
import { RoundedBox, useGLTF } from "@react-three/drei";
import { GLB_ARM, ToolHead, type ArmGeo, type ArmHandle, type ArmMats, type ToolKind } from "./IndustrialArm";
import { detailRobot } from "./glbDetails";

/*
 * Robot models drawn from GLB files. Both have the six joints as nodes j1..j6 with the local axes j1 Y, j2 X, j3 X, j4 Z, j5 X, j6 Z
 * (+Y up, +Z front, metres, floor at the origin), and neither has animation clips: the joint nodes are turned from code.
 *
 *  - factory-robot-concept (default, the 2026-10-15 handoff): an original illustrative exterior for the factory map, 0.64 x 1.10 x
 *    1.34 m. Its zero pose has the lower arm 0.763 m long and tipped 10.6 degrees backwards, the forearm 0.641 m from the elbow to the
 *    wrist centre and tipped 8.1 degrees up. It is smaller than the 1.8 m the cells are laid out for, so it is drawn 1.3 times
 *    larger (display only; the profile's footprint is untouched) and stands on the same 0.3 m pedestal as every robot.
 *  - robot-detailed (the earlier ABB IRB 2600ID-like exterior): kept to compare, select it with ?robot=detailed.
 */
export type GlbModel = {
  url: string;
  /** display scale of the whole model */
  scale: number;
  /** link lengths in the form the IK needs, already scaled and including the pedestal in the shoulder height */
  arm: ArmGeo;
  /** where the tool face is on j6 (model units, before the display scale) */
  flangeZ: number;
  /** angle of the lower arm from vertical, and of the elbow-to-wrist-centre line from vertical, at the model's joint zero */
  zeroA: number;
  zeroB: number;
  /** what is added on top of the model once loaded */
  extras?: (root: THREE.Object3D) => void;
};

/** The robot stands on a 0.3 m pedestal, like the primitive arm. */
const PEDESTAL = 0.3;

const CONCEPT_SCALE = 1.3;
/** Link geometry of the concept model, read from its joint nodes: j2 (0, 0.41, 0.11), j3 +(0, 0.75, -0.14), j5 +(0, 0.09, 0.635) from j3, flange face 0.138 m beyond j5. */
export const CONCEPT_MODEL: GlbModel = {
  // the query is the model revision: bump it when the file is replaced so browsers do not keep the old one
  url: "/models/factory-robot-concept/factory-robot-concept.glb?v=rear-panel-v2",
  scale: CONCEPT_SCALE,
  arm: { A: Math.hypot(0.75, 0.14) * CONCEPT_SCALE, B: Math.hypot(0.09, 0.635) * CONCEPT_SCALE, OFF: 0.11 * CONCEPT_SCALE, SH: PEDESTAL + 0.41 * CONCEPT_SCALE, T: 0.138 * CONCEPT_SCALE + 0.207 },
  flangeZ: 0.04,
  zeroA: Math.atan2(-0.14, 0.75),
  zeroB: Math.atan2(0.635, 0.09),
};

/** Angle of the elbow-to-wrist-centre line from the lower arm at joint zero of the earlier model: atan2(0.786, 0.15). */
export const DETAILED_MODEL: GlbModel = {
  url: "/models/robot-detailed/robot-detailed.glb",
  scale: 1,
  arm: GLB_ARM,
  flangeZ: 0.045,
  zeroA: 0,
  zeroB: Math.atan2(0.786, 0.15),
  extras: detailRobot,
};

/**
 * The three service connectors on the concept robot's base panel (on the rear, -Z, since the v2 model), where the robot's lines plug in.
 * Slot 0 is on the +X side, 1 in the middle, 2 on the -X side. Returns the connector tip as an offset from the robot's centre at the floor, in
 * metres as drawn (display scale and pedestal included), or null for a model without connectors. Model values: centres x +0.08 / 0 / -0.075,
 * y 0.132, tip at z -0.297.
 */
export function robotConnector(slot: 0 | 1 | 2): { dx: number; y: number; dz: number } | null {
  if (ROBOT_MODEL !== CONCEPT_MODEL) return null;
  const x = [0.08, 0, -0.075][slot];
  return { dx: x * CONCEPT_SCALE, y: PEDESTAL + 0.132 * CONCEPT_SCALE, dz: -0.297 * CONCEPT_SCALE };
}

/** The model in use: the concept robot, or the earlier one with ?robot=detailed. Read once; the 3D scene is client-only. */
export const ROBOT_MODEL: GlbModel = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("robot") === "detailed" ? DETAILED_MODEL : CONCEPT_MODEL;

useGLTF.preload(ROBOT_MODEL.url);

export function GlbArm({
  mats,
  handle,
  status = "normal",
  tool = "spindle",
  position = [0, 0, 0],
  onClick,
  onDoubleClick,
}: {
  mats: ArmMats;
  handle: RefObject<ArmHandle | null>;
  status?: "normal" | "warning" | "abnormal";
  tool?: ToolKind;
  position?: [number, number, number];
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  const model = ROBOT_MODEL;
  const gltf = useGLTF(model.url);
  const root = useMemo(() => gltf.scene.clone(true), [gltf]);
  const j6 = useMemo(() => root.getObjectByName("j6") as THREE.Object3D, [root]);
  const spinRef = useRef<THREE.Group>(null);
  const tipMat = useRef<THREE.MeshStandardMaterial>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const fingerL = useRef<THREE.Group>(null);
  const fingerR = useRef<THREE.Group>(null);
  const led = useRef<THREE.MeshStandardMaterial>(null);

  useLayoutEffect(() => {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        // the walking camera can end up inside the arm (no collision yet): a one-sided shell then shows nothing from inside and the arm looks hollow
        (m.material as THREE.Material).side = THREE.DoubleSide;
      }
    });
    model.extras?.(root);
    const dbg = (window as unknown as { __kfc?: Record<string, unknown> }).__kfc;
    if (dbg) dbg.glbRoot = root; // debug only (?debug): lets a check read the model's nodes
    const n = (name: string) => root.getObjectByName(name)!;
    const mine: ArmHandle = {
      apply(q, _grip, fx) {
        n("j1").rotation.y = q[0];
        // the IK works on the two link angles measured from vertical; the model's joint zero is tipped by zeroA (lower arm) and zeroB (forearm)
        n("j2").rotation.x = q[1] - model.zeroA;
        n("j3").rotation.x = q[2] + model.zeroA - model.zeroB;
        n("j4").rotation.z = q[3];
        n("j5").rotation.x = q[4] - (Math.PI / 2 - model.zeroB);
        n("j6").rotation.z = q[5];
        if (spinRef.current) spinRef.current.rotation.y = fx?.spin ?? 0;
        if (tipMat.current) tipMat.current.emissiveIntensity = (fx?.glow ?? 0) * 8;
        if (beamRef.current && beamMat.current) {
          const b = fx?.beam ?? 0;
          beamRef.current.visible = b > 0.01;
          beamMat.current.opacity = b * 0.32;
        }
      },
    };
    handle.current = mine;
    return () => {
      if (handle.current === mine) handle.current = null;
    };
  }, [root, handle, model]);

  useLayoutEffect(() => {
    const m = led.current;
    if (!m) return;
    const c = status === "abnormal" ? "#ff4a2e" : status === "warning" ? "#ffb02e" : "#35e08a";
    m.color.set(c);
    m.emissive.set(c);
  }, [status]);

  return (
    <group position={position} onClick={onClick ? (e) => (e.stopPropagation(), onClick()) : undefined} onDoubleClick={onDoubleClick ? (e) => (e.stopPropagation(), onDoubleClick()) : undefined}>
      <RoundedBox args={[0.82, PEDESTAL, 0.82]} radius={0.02} smoothness={3} position={[0, PEDESTAL / 2, 0]} material={mats.steel} />
      {/* status light strip on the front of the pedestal */}
      <mesh position={[0, PEDESTAL - 0.03, 0.412]}>
        <boxGeometry args={[0.5, 0.014, 0.008]} />
        <meshStandardMaterial ref={led} color="#35e08a" emissive="#35e08a" emissiveIntensity={3} toneMapped={false} />
      </mesh>
      <primitive object={root} position={[0, PEDESTAL, 0]} scale={model.scale} />
      {createPortal(
        <group position={[0, 0, model.flangeZ]} rotation={[Math.PI / 2, 0, 0]} scale={1 / model.scale}>
          <ToolHead tool={tool} mats={mats} spinRef={spinRef} tipMat={tipMat} beamRef={beamRef} beamMat={beamMat} fingerL={fingerL} fingerR={fingerR} />
        </group>,
        j6,
      )}
    </group>
  );
}
