"use client";

import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";

/*
 * Procedural 6-axis industrial arm (no external assets).
 * Frame: arm base at origin, forward = +z, up = +y.
 *   J1 yaw (turret)  J2 shoulder pitch  J3 elbow pitch
 *   J4 forearm roll  J5 wrist pitch     J6 flange roll
 * Gripper: parallel two-finger, TCP at the fingertip centre.
 */

/*
 * Link lengths follow the ABB IRB 2600 family so the reach matches the 1.85 m on the datasheet:
 * OFF + A + B = 0.15 + 0.9 + 0.803 = 1.853 m (lengths from the standard IRB 2600 ROS-Industrial
 * definition, Apache-2.0; the ID variant's own lengths are not published, so this is an assumption).
 * SH is the J2 axis above the floor: 0.3 m pedestal + 0.445 m base height.
 */
export const ARM = {
  A: 0.9, // shoulder -> elbow
  B: 0.803, // elbow -> wrist centre
  OFF: 0.15, // shoulder axis forward offset
  BASE_Y: 0.52, // J1 axis height
  SH: 0.745, // J2 axis height
  T: 0.38, // wrist centre -> TCP (tool pointing down)
} as const;

/** IRB 2600ID axis ranges from the ABB datasheet, degrees (J2 is measured from vertical, J3 from the horizontal forearm). */
export const JOINT_LIMITS_DEG = {
  J1: [-180, 180],
  J2: [-95, 155],
  J3: [-180, 75],
  J4: [-175, 175],
  J5: [-120, 120],
  J6: [-400, 400],
} as const;

export type ArmMats = {
  paint: THREE.Material;
  accent: THREE.Material;
  graphite: THREE.Material;
  aluminum: THREE.Material;
  rubber: THREE.Material;
  steel: THREE.Material;
  copper: THREE.Material;
};

export type ToolKind = "gripper" | "spindle" | "torch" | "scanner";

/** Per-frame tool effects: spindle angle (rad), torch tip glow 0..1, scanner beam 0..1 */
export type ArmFx = { spin?: number; glow?: number; beam?: number };

export type ArmHandle = {
  /** q = [J1..J6] radians, grip 0 (closed) .. 1 (open) */
  apply: (q: number[], grip: number, fx?: ArmFx) => void;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Tool-down IK. Target TCP (arm frame) + desired gripper world yaw psi. Writes q[0..5]. */
export type ArmGeo = { A: number; B: number; OFF: number; SH: number; T: number };

/** Link lengths of the GLB arm (ABB IRB 2600 family): elbow to wrist centre is hypot(0.786, 0.15) and the tool starts 0.135 m beyond the wrist centre. */
export const GLB_ARM: ArmGeo = { A: 0.9, B: Math.hypot(0.786, 0.15), OFF: 0.15, SH: 0.745, T: 0.342 };

export function solveIK(px: number, py: number, pz: number, psi: number, q: number[], g: ArmGeo = ARM) {
  const { A, B, OFF, SH, T } = g;
  const q1 = Math.atan2(px, pz);
  const r = Math.hypot(px, pz) - OFF;
  const h = py + T - SH;
  const rr = clamp(Math.hypot(r, h), Math.abs(A - B) + 0.05, A + B - 0.02);
  const c2 = (rr * rr - A * A - B * B) / (2 * A * B);
  const a2 = Math.acos(clamp(c2, -1, 1));
  const phi = Math.atan2(r, h);
  const a1 = phi - Math.atan2(B * Math.sin(a2), A + B * Math.cos(a2));
  q[0] = q1;
  q[1] = a1;
  q[2] = a2;
  q[3] = 0;
  q[4] = Math.PI - (a1 + a2);
  q[5] = q1 - psi;
}

/** The tool on the flange (gripper, spindle, torch, scanner), drawn around the flange face with +y as the tool axis. Shared by the primitive arm and the GLB arm. */
export function ToolHead({
  tool,
  mats,
  spinRef,
  tipMat,
  beamRef,
  beamMat,
  fingerL,
  fingerR,
}: {
  tool: ToolKind;
  mats: ArmMats;
  spinRef: RefObject<THREE.Group | null>;
  tipMat: RefObject<THREE.MeshStandardMaterial | null>;
  beamRef: RefObject<THREE.Mesh | null>;
  beamMat: RefObject<THREE.MeshBasicMaterial | null>;
  fingerL: RefObject<THREE.Group | null>;
  fingerR: RefObject<THREE.Group | null>;
}) {
  const { accent, graphite, aluminum, rubber, steel } = mats;
  return (
    <>
                    {tool === "gripper" ? (
                      <>
                    <RoundedBox args={[0.22, 0.09, 0.13]} radius={0.015} position={[0, 0.045, 0]} material={graphite} />
                    <mesh position={[0, 0.092, 0]} material={accent}>
                      <boxGeometry args={[0.224, 0.006, 0.134]} />
                    </mesh>
                    {[-1, 1].map((s) => (
                      <mesh key={s} position={[s * 0.06, 0.05, 0.075]} rotation={[Math.PI / 2, 0, 0]} material={aluminum}>
                        <cylinderGeometry args={[0.011, 0.011, 0.03, 12]} />
                      </mesh>
                    ))}
                    {/* guide rail */}
                    <mesh position={[0, 0.103, 0]} material={steel}>
                      <boxGeometry args={[0.24, 0.016, 0.05]} />
                    </mesh>
                    <group ref={fingerL} position={[-0.0625, 0, 0]}>
                      <mesh position={[0, 0.151, 0]} material={aluminum}>
                        <boxGeometry args={[0.025, 0.09, 0.07]} />
                      </mesh>
                      <mesh position={[0.012, 0.16, 0]} material={rubber}>
                        <boxGeometry args={[0.006, 0.05, 0.06]} />
                      </mesh>
                    </group>
                    <group ref={fingerR} position={[0.0625, 0, 0]}>
                      <mesh position={[0, 0.151, 0]} material={aluminum}>
                        <boxGeometry args={[0.025, 0.09, 0.07]} />
                      </mesh>
                      <mesh position={[-0.012, 0.16, 0]} material={rubber}>
                        <boxGeometry args={[0.006, 0.05, 0.06]} />
                      </mesh>
                    </group>
                      </>
                    ) : null}
                    {tool === "spindle" ? (
                      <>
                        <mesh position={[0, 0.06, 0]} material={graphite}>
                          <cylinderGeometry args={[0.056, 0.056, 0.12, 24]} />
                        </mesh>
                        {[0, 1, 2, 3].map((i) => (
                          <mesh key={i} position={[0, 0.03 + i * 0.025, 0]} material={steel}>
                            <cylinderGeometry args={[0.063, 0.063, 0.008, 24]} />
                          </mesh>
                        ))}
                        <mesh position={[0, 0.002, 0]} material={accent}>
                          <cylinderGeometry args={[0.058, 0.058, 0.014, 24]} />
                        </mesh>
                        <mesh position={[0, 0.128, 0]} material={aluminum}>
                          <cylinderGeometry args={[0.042, 0.032, 0.03, 20]} />
                        </mesh>
                        <group ref={spinRef} position={[0, 0.143, 0]}>
                          <mesh position={[0, 0.032, 0]} material={aluminum}>
                            <cylinderGeometry args={[0.011, 0.011, 0.064, 12]} />
                          </mesh>
                          {[0, 1, 2, 3].map((i) => (
                            <mesh key={i} position={[0, 0.018 + i * 0.014, 0]} rotation={[0, i * 0.6, 0]} material={graphite}>
                              <boxGeometry args={[0.026, 0.004, 0.003]} />
                            </mesh>
                          ))}
                        </group>
                      </>
                    ) : null}
                    {tool === "torch" ? (
                      <>
                        <mesh position={[0, 0.05, 0]} material={graphite}>
                          <cylinderGeometry args={[0.034, 0.034, 0.1, 20]} />
                        </mesh>
                        <mesh position={[0, 0.105, 0]} material={accent}>
                          <cylinderGeometry args={[0.036, 0.036, 0.012, 20]} />
                        </mesh>
                        <mesh position={[0, 0.16, 0]} material={mats.copper}>
                          <cylinderGeometry args={[0.022, 0.03, 0.1, 20]} />
                        </mesh>
                        <mesh position={[0, 0.215, 0]} material={steel}>
                          <cylinderGeometry args={[0.012, 0.018, 0.02, 16]} />
                        </mesh>
                        <mesh position={[0, 0.226, 0]}>
                          <sphereGeometry args={[0.009, 10, 10]} />
                          <meshStandardMaterial ref={tipMat} color="#ffcf8a" emissive="#ff8a1e" emissiveIntensity={0} toneMapped={false} />
                        </mesh>
                      </>
                    ) : null}
                    {tool === "scanner" ? (
                      <>
                        <RoundedBox args={[0.16, 0.1, 0.12]} radius={0.015} position={[0, 0.06, 0]} material={graphite} />
                        <mesh position={[0, 0.112, 0]} material={accent}>
                          <boxGeometry args={[0.164, 0.006, 0.124]} />
                        </mesh>
                        <mesh position={[0, 0.131, 0]}>
                          <cylinderGeometry args={[0.036, 0.036, 0.03, 24]} />
                          <meshStandardMaterial color="#10222e" roughness={0.1} metalness={0.7} />
                        </mesh>
                        <mesh position={[0, 0.148, 0]}>
                          <cylinderGeometry args={[0.026, 0.026, 0.004, 24]} />
                          <meshStandardMaterial color="#35b6ff" emissive="#35b6ff" emissiveIntensity={1.5} toneMapped={false} />
                        </mesh>
                        {[-1, 1].map((sx) => (
                          <mesh key={sx} position={[sx * 0.055, 0.12, 0.03]}>
                            <sphereGeometry args={[0.008, 8, 8]} />
                            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={2.5} toneMapped={false} />
                          </mesh>
                        ))}
                        <mesh ref={beamRef} position={[0, 0.15 + 0.16, 0]} rotation={[Math.PI, 0, 0]} visible={false}>
                          <coneGeometry args={[0.2, 0.32, 28, 1, true]} />
                          <meshBasicMaterial
                            ref={beamMat}
                            color="#35e08a"
                            transparent
                            opacity={0.3}
                            depthWrite={false}
                            side={THREE.DoubleSide}
                            toneMapped={false}
                          />
                        </mesh>
                      </>
                    ) : null}
    </>
  );
}

const CABLE_SEGMENTS = 44;

export function IndustrialArm({
  mats,
  handle,
  status = "normal",
  tool = "gripper",
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
  const { A, B, OFF, BASE_Y, SH } = ARM;

  const root = useRef<THREE.Group>(null);
  const turret = useRef<THREE.Group>(null);
  const shoulder = useRef<THREE.Group>(null);
  const elbow = useRef<THREE.Group>(null);
  const foreRoll = useRef<THREE.Group>(null);
  const wrist = useRef<THREE.Group>(null);
  const flangeRoll = useRef<THREE.Group>(null);
  const fingerL = useRef<THREE.Group>(null);
  const fingerR = useRef<THREE.Group>(null);
  const ledMat = useRef<THREE.MeshStandardMaterial>(null);
  const spinRef = useRef<THREE.Group>(null);
  const tipMat = useRef<THREE.MeshStandardMaterial>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);

  // cable anchors (moving frames) + the two cable meshes (world space)
  const aBase = useRef<THREE.Group>(null);
  const aLow1 = useRef<THREE.Group>(null);
  const aLow2 = useRef<THREE.Group>(null);
  const aElbow = useRef<THREE.Group>(null);
  const aFore1 = useRef<THREE.Group>(null);
  const aFore2 = useRef<THREE.Group>(null);
  const aWrist = useRef<THREE.Group>(null);
  const cableA = useRef<THREE.Mesh>(null);
  const cableB = useRef<THREE.Mesh>(null);

  // the lower arm is a cast beam whose two ends are round with the same radius as the shoulder and elbow housings (0.17 and 0.15),
  // so the arm and the joints meet flush instead of one primitive poking through the other
  const lowerGeo = useMemo(() => {
    const bevel = 0.035;
    const r1 = 0.17 - bevel;
    const r2 = 0.15 - bevel;
    const phi = Math.asin((r1 - r2) / A);
    const sh = new THREE.Shape();
    // profile in (u, y): u becomes the arm's depth (z) after the rotation below
    sh.absarc(0, 0, r1, Math.PI + phi, 2 * Math.PI - phi + 0, false); // bottom end (around the shoulder axis), right side up
    sh.absarc(0, A, r2, -phi, Math.PI + phi, false); // top end (around the elbow axis)
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 28 });
    g.translate(0, 0, -0.1);
    g.rotateY(Math.PI / 2); // extrusion axis becomes x (the shoulder axis)
    g.computeVertexNormals();
    return g;
  }, [A]);

  const scratch = useMemo(
    () => ({ v: new THREE.Vector3(), pts: [] as THREE.Vector3[] }),
    [],
  );

  useLayoutEffect(() => {
    const anchors = [aBase, aLow1, aLow2, aElbow, aFore1, aFore2, aWrist];

    const rebuild = (mesh: THREE.Mesh | null, side: number, radius: number, lift: number) => {
      if (!mesh) return;
      const pts = anchors.map((a, i) => {
        const p = (scratch.pts[i + anchors.length * (side > 0 ? 0 : 1)] ??= new THREE.Vector3());
        a.current!.getWorldPosition(scratch.v);
        p.copy(scratch.v);
        p.y += lift * Math.sin((i / (anchors.length - 1)) * Math.PI) * 0.1;
        p.x += side * 0.0; // lateral offset is baked into anchor positions
        return p;
      });
      const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
      const g = new THREE.TubeGeometry(curve, CABLE_SEGMENTS, radius, 7, false);
      mesh.geometry.dispose();
      mesh.geometry = g;
    };

    handle.current = {
      apply(q, grip, fx) {
        if (!turret.current) return;
        turret.current.rotation.y = q[0];
        shoulder.current!.rotation.x = q[1];
        elbow.current!.rotation.x = q[2];
        foreRoll.current!.rotation.y = q[3];
        wrist.current!.rotation.x = q[4];
        flangeRoll.current!.rotation.y = q[5];
        const gap = 0.0625 + (0.095 - 0.0625) * clamp(grip, 0, 1);
        if (fingerL.current && fingerR.current) {
          fingerL.current.position.x = -gap;
          fingerR.current.position.x = gap;
        }
        if (spinRef.current) spinRef.current.rotation.y = fx?.spin ?? 0;
        if (tipMat.current) tipMat.current.emissiveIntensity = (fx?.glow ?? 0) * 8;
        if (beamRef.current && beamMat.current) {
          const b = fx?.beam ?? 0;
          beamRef.current.visible = b > 0.01;
          beamMat.current.opacity = b * 0.32;
        }
        root.current!.updateMatrixWorld(true);
        rebuild(cableA.current, 1, 0.026, 1);
        rebuild(cableB.current, -1, 0.017, 0.6);
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle, scratch]);

  useLayoutEffect(() => {
    const m = ledMat.current;
    if (!m) return;
    const c = status === "abnormal" ? "#ff4a2e" : status === "warning" ? "#ffb02e" : "#35e08a";
    m.color.set(c);
    m.emissive.set(c);
  }, [status]);

  const { paint, accent, graphite, aluminum, rubber, steel } = mats;
  const boltAngles = [0, 1, 2, 3, 4, 5].map((i) => (i / 6) * Math.PI * 2);

  return (
    <>
      <group ref={root} position={position} onClick={onClick ? (e) => (e.stopPropagation(), onClick()) : undefined} onDoubleClick={onDoubleClick ? (e) => (e.stopPropagation(), onDoubleClick()) : undefined}>
        {/* plinth + anchor bolts */}
        <RoundedBox args={[0.82, 0.3, 0.82]} radius={0.02} smoothness={3} position={[0, 0.15, 0]} material={steel} />
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`${sx}${sz}`} position={[sx * 0.34, 0.31, sz * 0.34]} material={aluminum}>
              <cylinderGeometry args={[0.03, 0.03, 0.025, 6]} />
            </mesh>
          )),
        )}
        {/* fixed base housing */}
        <mesh position={[0, 0.41, 0]} material={paint}>
          <cylinderGeometry args={[0.27, 0.3, 0.22, 40]} />
        </mesh>
        <mesh position={[0, 0.355, 0]} material={accent}>
          <cylinderGeometry args={[0.305, 0.305, 0.022, 40]} />
        </mesh>
        <mesh position={[0, 0.5, 0]} material={graphite}>
          <cylinderGeometry args={[0.285, 0.285, 0.03, 40]} />
        </mesh>
        {/* status LED ring on base */}
        <mesh position={[0, 0.385, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.285, 0.008, 8, 48]} />
          <meshStandardMaterial ref={ledMat} color="#35e08a" emissive="#35e08a" emissiveIntensity={3} toneMapped={false} />
        </mesh>
        {/* cable connector box on the back of the base */}
        <RoundedBox args={[0.22, 0.16, 0.12]} radius={0.015} position={[0.12, 0.4, -0.3]} material={graphite} />
        <group ref={aBase} position={[0.13, 0.4, -0.37]} />
        {/* cast ribs around the base housing, bolts on the turntable flange and a name plate (no logo) */}
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
          return <RoundedBox key={`rib${i}`} args={[0.05, 0.2, 0.07]} radius={0.012} position={[Math.sin(a) * 0.3, 0.4, Math.cos(a) * 0.3]} rotation={[0, a, 0]} material={paint} />;
        })}
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <mesh key={`bolt${i}`} position={[Math.sin(a) * 0.255, 0.518, Math.cos(a) * 0.255]} material={steel}>
              <cylinderGeometry args={[0.012, 0.012, 0.012, 8]} />
            </mesh>
          );
        })}
        <RoundedBox args={[0.16, 0.06, 0.012]} radius={0.004} position={[0, 0.42, 0.318]} material={graphite} />
        <mesh position={[0, 0.405, 0.325]} material={accent}>
          <boxGeometry args={[0.1, 0.006, 0.004]} />
        </mesh>

        {/* J1 turret */}
        <group ref={turret} position={[0, BASE_Y, 0]}>
          <mesh position={[0, 0.07, 0]} material={paint}>
            <cylinderGeometry args={[0.25, 0.27, 0.14, 40]} />
          </mesh>
          <RoundedBox args={[0.38, 0.3, 0.4]} radius={0.05} smoothness={4} position={[0, 0.2, 0.02]} material={paint} />
          <RoundedBox args={[0.3, 0.22, 0.14]} radius={0.03} position={[0, 0.2, -0.2]} material={graphite} />

          {/* J2 shoulder */}
          <group ref={shoulder} position={[0, SH - BASE_Y, OFF]}>
            <mesh rotation={[0, 0, Math.PI / 2]} material={paint}>
              <cylinderGeometry args={[0.17, 0.17, 0.42, 36]} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.225, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={graphite}>
                <cylinderGeometry args={[0.135, 0.135, 0.05, 36]} />
              </mesh>
            ))}
            <mesh position={[0.245, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={accent}>
              <cylinderGeometry args={[0.07, 0.07, 0.012, 24]} />
            </mesh>
            {/* lower arm */}
            <mesh geometry={lowerGeo} material={paint} />
            {/* inlay panels and bolts on the flat faces of the cast arm */}
            {[-1, 1].map((sx) => (
              <group key={sx}>
                <RoundedBox args={[0.01, A - 0.62, 0.075]} radius={0.004} position={[sx * 0.136, A / 2, 0]} material={graphite} />
                {[0.34, 0.5, A - 0.34].map((y) => (
                  <mesh key={y} position={[sx * 0.136, y, 0.0]} rotation={[0, 0, Math.PI / 2]} material={steel}>
                    <cylinderGeometry args={[0.011, 0.011, 0.008, 8]} />
                  </mesh>
                ))}
              </group>
            ))}
            <mesh position={[-0.3, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={paint}>
              <cylinderGeometry args={[0.12, 0.12, 0.12, 32]} />
            </mesh>
            <mesh position={[-0.37, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={graphite}>
              <cylinderGeometry args={[0.085, 0.085, 0.03, 24]} />
            </mesh>
            <RoundedBox args={[0.1, 0.5, 0.05]} radius={0.015} position={[0.0, 0.5, -0.115]} material={graphite} />
            <group ref={aLow1} position={[0.06, 0.28, -0.24]} />
            <group ref={aLow2} position={[0.06, A - 0.12, -0.2]} />

            {/* J3 elbow */}
            <group ref={elbow} position={[0, A, 0]}>
              <mesh rotation={[0, 0, Math.PI / 2]} material={paint}>
                <cylinderGeometry args={[0.15, 0.15, 0.36, 36]} />
              </mesh>
              {[-1, 1].map((s) => (
                <mesh key={s} position={[s * 0.2, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={graphite}>
                  <cylinderGeometry args={[0.12, 0.12, 0.05, 36]} />
                </mesh>
              ))}
              <mesh position={[0.27, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={paint}>
                <cylinderGeometry args={[0.1, 0.1, 0.14, 32]} />
              </mesh>
              <mesh position={[0.35, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={graphite}>
                <cylinderGeometry args={[0.07, 0.07, 0.03, 24]} />
              </mesh>
              <group ref={aElbow} position={[0.05, 0.02, -0.22]} />

              {/* J4 forearm roll */}
              <group ref={foreRoll}>
                <mesh position={[0, 0.2, 0]} material={paint}>
                  <cylinderGeometry args={[0.125, 0.14, 0.34, 36]} />
                </mesh>
                {/* gasket collar over the seam between the elbow housing and the forearm tube */}
                <mesh position={[0, 0.115, 0]} material={graphite}>
                  <cylinderGeometry args={[0.148, 0.155, 0.075, 40]} />
                </mesh>
                <mesh position={[0, 0.39, 0]} material={graphite}>
                  <cylinderGeometry args={[0.118, 0.118, 0.04, 36]} />
                </mesh>
                <mesh position={[0, 0.5 + (B - 0.5 - 0.12) / 2 - 0.0, 0]} material={paint}>
                  <cylinderGeometry args={[0.085, 0.1, B - 0.5 - 0.12 + 0.2, 32]} />
                </mesh>
                <mesh position={[0, 0.3, 0]} material={accent}>
                  <cylinderGeometry args={[0.142, 0.142, 0.018, 36]} />
                </mesh>
                <group ref={aFore1} position={[0.05, 0.3, -0.17]} />
                <group ref={aFore2} position={[0.05, 0.78, -0.12]} />

                {/* J5 wrist */}
                <group ref={wrist} position={[0, B, 0]}>
                  <mesh rotation={[0, 0, Math.PI / 2]} material={paint}>
                    <cylinderGeometry args={[0.085, 0.085, 0.2, 28]} />
                  </mesh>
                  {[-1, 1].map((s) => (
                    <mesh key={s} position={[s * 0.115, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={graphite}>
                      <cylinderGeometry args={[0.07, 0.07, 0.04, 28]} />
                    </mesh>
                  ))}
                  <mesh position={[0, 0.085, 0]} material={graphite}>
                    <cylinderGeometry args={[0.062, 0.07, 0.1, 28]} />
                  </mesh>
                  {/* collar where the forearm tube enters the wrist housing */}
                  <mesh position={[0, -0.085, 0]} material={graphite}>
                    <cylinderGeometry args={[0.092, 0.098, 0.05, 32]} />
                  </mesh>
                  <group ref={aWrist} position={[0.07, 0.02, -0.07]} />
                  {/* flange */}
                  <mesh position={[0, 0.16, 0]} material={aluminum}>
                    <cylinderGeometry args={[0.082, 0.082, 0.026, 32]} />
                  </mesh>
                  {boltAngles.map((a) => (
                    <mesh
                      key={a}
                      position={[Math.cos(a) * 0.06, 0.177, Math.sin(a) * 0.06]}
                      material={graphite}
                    >
                      <cylinderGeometry args={[0.008, 0.008, 0.01, 6]} />
                    </mesh>
                  ))}

                  {/* J6 + gripper */}
                  <group ref={flangeRoll} position={[0, 0.173, 0]}>
                    <ToolHead tool={tool} mats={mats} spinRef={spinRef} tipMat={tipMat} beamRef={beamRef} beamMat={beamMat} fingerL={fingerL} fingerR={fingerR} />
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>

      {/* harness: world-space tubes rebuilt every frame from the moving anchors */}
      <mesh ref={cableA} material={rubber} userData={{ noCast: true }}>
        <bufferGeometry />
      </mesh>
      <mesh ref={cableB} material={graphite} userData={{ noCast: true }}>
        <bufferGeometry />
      </mesh>
    </>
  );
}
