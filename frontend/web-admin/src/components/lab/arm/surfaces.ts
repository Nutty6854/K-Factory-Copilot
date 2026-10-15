import * as THREE from "three";

/*
 * Surface textures drawn in code (no image files, nothing to license): painted panels with seams and screws,
 * brushed steel, dark speckled paint. The maps are grey-scale and are MULTIPLIED with the material colour, so the
 * colour code (evidence level, status) still reads and only the surface gets structure.
 *
 * The maps are projected from the part's own axes (triplanar), so a panel seam is always the same size in metres no
 * matter how large or small the box it sits on is.
 */

export type SurfaceKind = "paint" | "steel" | "dark";

type Spec = { tile: number; strength: number; draw: (ctx: CanvasRenderingContext2D, n: number, rnd: () => number) => void };

// small deterministic random numbers: the same machine always gets the same surface
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPECS: Record<SurfaceKind, Spec> = {
  // painted sheet metal: 1.2 m tile, a seam every 0.6 m, screws on the seams, soft darker rim like a pressed edge
  paint: {
    tile: 1.2,
    strength: 1,
    draw(ctx, n, rnd) {
      ctx.fillStyle = "#f3f3f1";
      ctx.fillRect(0, 0, n, n);
      for (let i = 0; i < n * 14; i++) {
        const g = 226 + Math.floor(rnd() * 26);
        ctx.fillStyle = `rgba(${g},${g},${g},0.55)`;
        ctx.fillRect(rnd() * n, rnd() * n, 1.4, 1.4);
      }
      // soft bevel: the panel is a little darker toward its edges
      ctx.strokeStyle = "#000";
      for (let i = 0; i < n * 0.03; i++) {
        ctx.globalAlpha = 0.011;
        ctx.strokeRect(i, i, n - 2 * i, n - 2 * i);
      }
      ctx.globalAlpha = 1;
      // seams
      ctx.strokeStyle = "#a9aeae";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, n - 2, n - 2);
      ctx.strokeStyle = "#c2c6c6";
      ctx.beginPath();
      ctx.moveTo(n / 2, 0);
      ctx.lineTo(n / 2, n);
      ctx.moveTo(0, n / 2);
      ctx.lineTo(n, n / 2);
      ctx.stroke();
      // screws
      ctx.fillStyle = "#8d9393";
      const s = n * 0.045;
      for (const [x, y] of [[s, s], [n - s, s], [s, n - s], [n - s, n - s], [n / 2, s], [n / 2, n - s], [s, n / 2], [n - s, n / 2]]) {
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  // brushed steel: horizontal streaks of different brightness
  steel: {
    tile: 0.8,
    strength: 1,
    draw(ctx, n, rnd) {
      ctx.fillStyle = "#dcdedd";
      ctx.fillRect(0, 0, n, n);
      for (let y = 0; y < n; y++) {
        const g = 196 + Math.floor(rnd() * 56);
        ctx.fillStyle = `rgb(${g},${g + 1},${g + 1})`;
        ctx.fillRect(0, y, n, 1);
      }
      for (let i = 0; i < 70; i++) {
        const y = rnd() * n;
        const x = rnd() * n;
        ctx.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "120,125,125"},${0.1 + rnd() * 0.18})`;
        ctx.fillRect(x, y, 30 + rnd() * 160, 1);
      }
    },
  },
  // dark paint or rubber: fine speckle, nearly flat
  dark: {
    tile: 0.5,
    strength: 1,
    draw(ctx, n, rnd) {
      ctx.fillStyle = "#e4e6e6";
      ctx.fillRect(0, 0, n, n);
      for (let i = 0; i < n * 16; i++) {
        const g = 190 + Math.floor(rnd() * 62);
        ctx.fillStyle = `rgba(${g},${g},${g},0.7)`;
        ctx.fillRect(rnd() * n, rnd() * n, 1.3, 1.3);
      }
    },
  },
};

const cache = new Map<SurfaceKind, THREE.CanvasTexture>();

function texture(kind: SurfaceKind) {
  const hit = cache.get(kind);
  if (hit) return hit;
  const n = kind === "dark" ? 256 : 512;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d")!;
  SPECS[kind].draw(ctx, n, rng(kind.length * 7919 + n));
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(kind, t);
  return t;
}

/**
 * Props to spread on a <meshStandardMaterial>: it keeps its own colour, roughness and metalness and gets the surface
 * multiplied in. Safe to call on the server (returns nothing).
 */
export function surfaceProps(kind: SurfaceKind): { onBeforeCompile?: (shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }) => void; customProgramCacheKey?: () => string } {
  if (typeof document === "undefined") return {};
  const spec = SPECS[kind];
  return {
    customProgramCacheKey: () => "kfc-surface",
    onBeforeCompile(shader) {
      shader.uniforms.uSurf = { value: texture(kind) };
      shader.uniforms.uInfo = { value: new THREE.Vector2(spec.tile, spec.strength) };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vLP;\nvarying vec3 vLN;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLP = position;\nvLN = normal;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform sampler2D uSurf;
uniform vec2 uInfo;
varying vec3 vLP;
varying vec3 vLN;
vec3 gSurf;
vec3 surfTri() {
  vec3 n = abs(vLN);
  n = n / (n.x + n.y + n.z + 1e-5);
  float s = 1.0 / uInfo.x;
  return texture2D(uSurf, vLP.zy * s).rgb * n.x + texture2D(uSurf, vLP.xz * s).rgb * n.y + texture2D(uSurf, vLP.xy * s).rgb * n.z;
}`,
        )
        .replace("#include <map_fragment>", "#include <map_fragment>\ngSurf = surfTri();\ndiffuseColor.rgb *= mix(vec3(1.0), gSurf, uInfo.y);")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (0.78 + 0.44 * gSurf.g), 0.0, 1.0);");
    },
  };
}
