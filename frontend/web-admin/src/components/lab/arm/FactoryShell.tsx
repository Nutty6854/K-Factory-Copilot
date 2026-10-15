"use client";

import { useMemo } from "react";

/*
 * The building around the line: slab joints, painted lanes, columns, portal beams, walls with roller doors,
 * hanging lights and a few shop-floor props. Shapes and positions are our assumptions for a plausible
 * 54 × 16 m hall (the profile only gives the footprint); none of it is measured. Nothing here can be
 * clicked and nothing casts shadows, so it never gets in the way of the machines.
 */

type Vec = [number, number, number];
const noRay = () => null;

function Box({ at, size, color, opacity = 1, emissive, rough = 0.8, metal = 0.1 }: { at: Vec; size: Vec; color: string; opacity?: number; emissive?: string; rough?: number; metal?: number }) {
  return (
    <mesh position={at} raycast={noRay} userData={{ noCast: true }}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={rough} metalness={metal} transparent={opacity < 1} opacity={opacity} emissive={emissive ?? "#000000"} emissiveIntensity={emissive ? 1.2 : 0} />
    </mesh>
  );
}

/** Paint on the floor: a flat strip at ground level. */
function Strip({ x, z, w, d, color, opacity = 1 }: { x: number; z: number; w: number; d: number; color: string; opacity?: number }) {
  return (
    <mesh position={[x, 0.009, z]} rotation-x={-Math.PI / 2} raycast={noRay} userData={{ noCast: true }}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  );
}

function Cyl({ at, r, len, color }: { at: Vec; r: number; len: number; color: string }) {
  return (
    <mesh position={at} raycast={noRay} userData={{ noCast: true }}>
      <cylinderGeometry args={[r, r, len, 14]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.3} />
    </mesh>
  );
}

const WALL_H = 6;
/** Pedestrian walkway along the open front side: 1.5 m clear, next to the cart lane (13.0 to 14.95 m). */
const WALK_Z0 = 15.45;
const WALK_Z1 = 16.95;
const COL = "#8c999c";
const WALL_LOW = "#cdd5d3";
const WALL_UP = "#e3e9e7";

export function FactoryShell({ w, d }: { w: number; d: number }) {
  const colXs = useMemo(() => {
    const n = Math.round(w / 9);
    return Array.from({ length: n + 1 }, (_, i) => (i * w) / n);
  }, [w]);
  const joints = useMemo(() => {
    const xs: number[] = [];
    for (let x = 6; x < w; x += 6) xs.push(x);
    const zs: number[] = [];
    for (let z = 4; z < d; z += 4) zs.push(z);
    return { xs, zs };
  }, [w, d]);
  const doorZ = 12.1; // roller doors line up with the receiving and shipping zones
  const laneZ0 = 13.0;
  const laneZ1 = 14.95;

  return (
    <group>
      {/* slab saw-cut joints */}
      {joints.xs.map((x) => (
        <Strip key={`jx${x}`} x={x} z={d / 2} w={0.03} d={d} color="#d4dcda" />
      ))}
      {joints.zs.map((z) => (
        <Strip key={`jz${z}`} x={w / 2} z={z} w={w} d={0.03} color="#d4dcda" />
      ))}

      {/* cart lane (yellow edge lines) and pedestrian walkway (green) on the front side of the hall */}
      <Strip x={w / 2} z={laneZ0} w={w - 2} d={0.1} color="#d9b74a" />
      <Strip x={w / 2} z={laneZ1} w={w - 2} d={0.1} color="#d9b74a" />
      {Array.from({ length: Math.floor((w - 2) / 1.5) }, (_, i) => (
        <Strip key={`ar${i}`} x={1.5 + i * 1.5 + 0.35} z={(laneZ0 + laneZ1) / 2} w={0.6} d={0.05} color="#d9b74a" opacity={0.55} />
      ))}
      <Strip x={w / 2} z={(WALK_Z0 + WALK_Z1) / 2} w={w - 2} d={WALK_Z1 - WALK_Z0} color="#62a982" opacity={0.45} />
      <Strip x={w / 2} z={WALK_Z0} w={w - 2} d={0.06} color="#ffffff" opacity={0.9} />
      <Strip x={w / 2} z={WALK_Z1} w={w - 2} d={0.06} color="#ffffff" opacity={0.9} />
      {/* fire point in front of the control room */}
      <Strip x={47.0} z={4.1} w={0.9} d={0.9} color="#c7473b" opacity={0.7} />

      {/* columns and portal beams */}
      {colXs.map((x) => (
        <group key={`c${x}`}>
          {[0.18, d - 0.18].map((z) => (
            <group key={z}>
              {/* the columns on the open front side are drawn faint so they do not hide the line */}
              <Box at={[x, WALL_H / 2, z]} size={[0.36, WALL_H, 0.3]} color={COL} metal={0.4} rough={0.5} opacity={z < d / 2 ? 1 : 0.22} />
              <Box at={[x, 0.15, z]} size={[0.5, 0.3, 0.44]} color="#6f7b7e" opacity={z < d / 2 ? 1 : 0.35} />
            </group>
          ))}
          <Box at={[x, WALL_H + 0.18, d / 2]} size={[0.28, 0.36, d]} color={COL} metal={0.4} rough={0.5} opacity={0.4} />
        </group>
      ))}
      {/* two purlin runs along the hall */}
      {[d * 0.25, d * 0.75].map((z) => (
        <Box key={`pu${z}`} at={[w / 2, WALL_H + 0.45, z]} size={[w, 0.12, 0.12]} color="#a2adb0" metal={0.4} rough={0.5} />
      ))}

      {/* walls: back and both ends, with a window band and roller doors; the front side stays open */}
      <Box at={[w / 2, 0.6, -0.05]} size={[w, 1.2, 0.1]} color={WALL_LOW} />
      <Box at={[w / 2, 3.45, -0.05]} size={[w, 3.3, 0.1]} color={WALL_UP} />
      <Box at={[w / 2, 5.4, -0.08]} size={[w, 1.2, 0.04]} color="#9fc3d1" opacity={0.55} />
      {[-0.05, w + 0.05].map((x) => (
        <group key={`w${x}`}>
          <Box at={[x, 0.6, d / 2]} size={[0.1, 1.2, d]} color={WALL_LOW} />
          <Box at={[x, 3.45, d / 2]} size={[0.1, 3.3, d]} color={WALL_UP} />
          <Box at={[x, 5.4, d / 2]} size={[0.04, 1.2, d]} color="#9fc3d1" opacity={0.55} />
          {/* roller door: dark panel, ribs, and a yellow frame */}
          <Box at={[x + (x < 0 ? 0.05 : -0.05), 1.7, doorZ]} size={[0.05, 3.4, 3.6]} color="#98a5a8" metal={0.3} rough={0.5} />
          {Array.from({ length: 9 }, (_, i) => (
            <Box key={i} at={[x + (x < 0 ? 0.09 : -0.09), 0.3 + i * 0.37, doorZ]} size={[0.03, 0.04, 3.5]} color="#7f8c8f" />
          ))}
          <Box at={[x + (x < 0 ? 0.09 : -0.09), 1.7, doorZ - 1.85]} size={[0.06, 3.5, 0.1]} color="#d9b74a" />
          <Box at={[x + (x < 0 ? 0.09 : -0.09), 1.7, doorZ + 1.85]} size={[0.06, 3.5, 0.1]} color="#d9b74a" />
        </group>
      ))}

      {/* hanging linear lights in two rows */}
      {[d * 0.25, d * 0.75].map((z) =>
        Array.from({ length: Math.floor(w / 4.5) }, (_, i) => (
          <group key={`l${z}-${i}`}>
            <Box at={[2.25 + i * 4.5, WALL_H - 0.5, z]} size={[2.4, 0.07, 0.22]} color="#f3f6f6" emissive="#fff6d8" />
            <Box at={[1.2 + i * 4.5, WALL_H - 0.28, z]} size={[0.02, 0.45, 0.02]} color="#6f7b7e" />
            <Box at={[3.3 + i * 4.5, WALL_H - 0.28, z]} size={[0.02, 0.45, 0.02]} color="#6f7b7e" />
          </group>
        )),
      )}

      {/* fire extinguishers on columns along the back wall */}
      {[colXs[1], colXs[3], colXs[5]].filter((x) => x !== undefined).map((x) => (
        <group key={`fx${x}`}>
          <Box at={[x, 1.35, 0.45]} size={[0.3, 0.3, 0.02]} color="#c7473b" />
          <Cyl at={[x, 0.95, 0.4]} r={0.07} len={0.4} color="#c7473b" />
        </group>
      ))}

      {/* props: maintenance bench and tool cabinet behind the robot cells */}
      <Box at={[34.4, 0.88, 3.7]} size={[1.6, 0.05, 0.7]} color="#c9ced0" metal={0.3} />
      {[-0.7, 0.7].flatMap((dx) => [-0.3, 0.3].map((dz) => <Box key={`bl${dx}${dz}`} at={[34.4 + dx, 0.43, 3.7 + dz]} size={[0.05, 0.86, 0.05]} color="#5b6a6e" />))}
      <Box at={[36.2, 0.9, 3.7]} size={[0.9, 1.8, 0.5]} color="#4a5a5e" />
      <Box at={[36.2, 1.2, 3.94]} size={[0.8, 0.02, 0.02]} color="#2f3b3f" />
      {/* scrap container beside the laser, waste bin by the deburrer */}
      <Box at={[16.4, 0.5, 3.9]} size={[1.5, 1.0, 1.0]} color="#5f86a3" metal={0.3} rough={0.6} />
      <Box at={[16.4, 1.02, 3.9]} size={[1.54, 0.04, 1.04]} color="#4c6e87" />
      <Cyl at={[26.6, 0.35, 5.9]} r={0.25} len={0.7} color="#6f7b7e" />
      {/* hand pallet truck parked at the receiving zone, stacked empty pallets by the shipping zone */}
      <Box at={[6.6, 0.1, 12.6]} size={[1.1, 0.12, 0.55]} color="#d9b74a" />
      <Box at={[6.05, 0.5, 12.6]} size={[0.04, 0.8, 0.04]} color="#2f3b3f" />
      {Array.from({ length: 6 }, (_, i) => (
        <Box key={`pp${i}`} at={[47.9, 0.07 + i * 0.15, 12.4]} size={[1.2, 0.12, 0.8]} color="#8a6f45" />
      ))}
    </group>
  );
}
