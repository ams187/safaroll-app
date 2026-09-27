import { useTranslation as useUiTranslation } from 'react-i18next';
/**
 * <BurningCard /> — a capture printed on a sheet of paper that catches fire and
 * burns away when you press Delete.
 *
 * Ported from the `immersive-overlay` / burning-photo-card block. The WGSL
 * shaders, the WebGPU burn simulation, the procedural paper grain and the Skia
 * rasterizer are the reference's, unchanged: they are one tuned system and
 * every constant in them is load-bearing (their own comments say which, and
 * why). What SafaRoll changed is everything above the paper —
 *
 *   - the card is the player's capture, so the photograph, the title, the date
 *     and the button's label arrive as PROPS rather than as constants;
 *   - there is no "Restore from backup". This deletes a real row and two real
 *     files, so the burn is the confirmation and the only way back is not to
 *     press the button;
 *   - a close control while the sheet is still whole, because a screen whose
 *     only affordance is destructive needs a door.
 *
 * Runtime: `react-native-webgpu` is native code, so this needs the dev client —
 * which this app already is (`ios/Podfile.lock` links it, and the capture
 * lift stage already runs on it). Nothing new to install.
 *
 * @license MIT (the block); see the repo notes on the vendored sources.
 */


import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PixelRatio,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Canvas, useCanvasRef, type RNCanvasContext } from 'react-native-webgpu';
import type { CardInk } from '@/lib/card-ink';

/* ==========================================================================
 * WGSL SHADER SOURCES
 *
 * Pipelines:
 *   SIM_WGSL       compute — reaction/diffusion burn-mask solver (ping-pong storage textures)
 *   PAPER_WGSL     render  — paper surface, char/ember zones, curling ash, discard
 *   PARTICLE_WGSL  compute + render — fire/smoke emitter fed by the burn mask
 *   COMPOSITE_WGSL render  — ACES tonemap, vignette, dither
 * ========================================================================== */

/** Simplex 3D noise, curl noise and hash helpers shared by every stage. */
const NOISE = /* wgsl */ `
const PI: f32 = 3.14159265;

fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289v4(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute4(x: vec4f) -> vec4f { return mod289v4(((x * 34.0) + 1.0) * x); }
fn taylorInvSqrt4(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }

// Ashima-style simplex noise, ported to WGSL. Returns roughly [-1, 1].
fn snoise(v: vec3f) -> f32 {
  let C = vec2f(1.0 / 6.0, 1.0 / 3.0);
  let D = vec4f(0.0, 0.5, 1.0, 2.0);

  var i = floor(v + dot(v, C.yyy));
  let x0 = v - i + dot(i, C.xxx);

  let g = step(x0.yzx, x0.xyz);
  let l = 1.0 - g;
  let i1 = min(g.xyz, l.zxy);
  let i2 = max(g.xyz, l.zxy);

  let x1 = x0 - i1 + C.xxx;
  let x2 = x0 - i2 + C.yyy;
  let x3 = x0 - D.yyy;

  i = mod289v3(i);
  let p = permute4(permute4(permute4(
      i.z + vec4f(0.0, i1.z, i2.z, 1.0)) +
      i.y + vec4f(0.0, i1.y, i2.y, 1.0)) +
      i.x + vec4f(0.0, i1.x, i2.x, 1.0));

  let n_ = 0.142857142857;
  let ns = n_ * D.wyz - D.xzx;

  let j = p - 49.0 * floor(p * ns.z * ns.z);

  let x_ = floor(j * ns.z);
  let y_ = floor(j - 7.0 * x_);

  let x = x_ * ns.x + ns.yyyy;
  let y = y_ * ns.x + ns.yyyy;
  let h = 1.0 - abs(x) - abs(y);

  let b0 = vec4f(x.xy, y.xy);
  let b1 = vec4f(x.zw, y.zw);

  let s0 = floor(b0) * 2.0 + 1.0;
  let s1 = floor(b1) * 2.0 + 1.0;
  let sh = -step(h, vec4f(0.0));

  let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  let a1 = b1.xzyw + s1.xzyw * sh.zzww;

  var p0 = vec3f(a0.xy, h.x);
  var p1 = vec3f(a0.zw, h.y);
  var p2 = vec3f(a1.xy, h.z);
  var p3 = vec3f(a1.zw, h.w);

  let norm = taylorInvSqrt4(vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  var m = max(0.6 - vec4f(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4f(0.0));
  m *= m;
  return 42.0 * dot(m * m, vec4f(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

fn fbm3(p: vec3f) -> f32 {
  var f = 0.0;
  var amp = 0.5;
  var q = p;
  for (var i = 0; i < 4; i++) {
    f += amp * snoise(q);
    q *= 2.02;
    amp *= 0.5;
  }
  return f;
}

/**
 * The x and y of the divergence-free curl of a 3D noise potential field.
 * Only .xy is ever consumed — this is a 2D effect, and both callers flatten the
 * result to the picture plane.
 */
fn curlNoiseXY(p: vec3f) -> vec2f {
  let e = 0.34;
  let ex = vec3f(e, 0.0, 0.0);
  let ey = vec3f(0.0, e, 0.0);
  let ez = vec3f(0.0, 0.0, e);
  let A = vec3f(31.416, 17.13, 7.77);
  let B = vec3f(-11.3, 5.91, 23.24);
  let x = (snoise(p + ey + B) - snoise(p - ey + B))
        - (snoise(p + ez + A) - snoise(p - ez + A));
  let y = (snoise(p + ez) - snoise(p - ez))
        - (snoise(p + ex + B) - snoise(p - ex + B));
  return vec2f(x, y) / (2.0 * e);
}

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn rnd(state: ptr<function, u32>) -> f32 {
  *state = pcg(*state);
  return f32(*state) / 4294967296.0;
}

fn hash21(p: vec2f) -> f32 {
  let h = pcg(u32(p.x) * 1973u + u32(p.y) * 9277u + 26699u);
  return f32(h) / 4294967296.0;
}
`;

/** Hot-band colour ramp: deep red -> orange -> yellow -> white core. */
const BLACKBODY = /* wgsl */ `
fn blackbody(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  var c = mix(vec3f(0.42, 0.015, 0.0), vec3f(1.0, 0.20, 0.015), smoothstep(0.0, 0.35, x));
  c = mix(c, vec3f(1.0, 0.58, 0.10), smoothstep(0.30, 0.62, x));
  c = mix(c, vec3f(1.0, 0.90, 0.55), smoothstep(0.58, 0.86, x));
  c = mix(c, vec3f(1.0, 1.0, 0.94), smoothstep(0.84, 1.0, x));
  return c;
}
`;

/* ------------------------------------------------------------------ *
 * 1. Compute: burn-mask spread solver
 * ------------------------------------------------------------------ */

/** Output texels per side of a solver workgroup. */
const SIM_TILE = 8;
/** The same tile plus the one-texel halo its 3x3 neighbourhoods reach into. */
const SIM_HALO = SIM_TILE + 2;
/** Seconds a texel's age saturates at; it is only ever read as a ramp. */
const SIM_AGE_MAX = 64;

const SIM_WGSL = /* wgsl */ `
${NOISE}

struct SimU {
  seed: vec2f,
  seedRadius: f32,
  seedActive: f32,
  seedB: vec2f,
  dt: f32,
  time: f32,
  speed: f32,
  noiseScale: f32,
  noiseContrast: f32,
  aspect: f32,
  reset: f32,
  edgeBias: f32,
};

@group(0) @binding(0) var<uniform> u: SimU;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var dstTex: texture_storage_2d<rgba16float, write>;

/** The workgroup's output tile and halo, staged in shared memory. */
var<workgroup> tile: array<f32, ${SIM_HALO * SIM_HALO}>;

@compute @workgroup_size(${SIM_TILE}, ${SIM_TILE})
fn main(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
  @builtin(workgroup_id) wid: vec3u,
) {
  let dim = textureDimensions(srcTex);
  let coord = vec2i(gid.xy);
  let cell = hash21(vec2f(coord));

  if (u.reset > 0.5) {
    if (gid.x < dim.x && gid.y < dim.y) {
      textureStore(dstTex, coord, vec4f(0.0, 0.0, cell, 0.0));
    }
    return;
  }

  let hi = vec2i(dim) - vec2i(1, 1);
  let origin = vec2i(wid.xy) * ${SIM_TILE} - vec2i(1, 1);
  for (var t = li; t < ${SIM_HALO * SIM_HALO}u; t += ${SIM_TILE * SIM_TILE}u) {
    let c = clamp(
      origin + vec2i(i32(t % ${SIM_HALO}u), i32(t / ${SIM_HALO}u)),
      vec2i(0, 0), hi);
    tile[t] = textureLoad(srcTex, c, 0).r;
  }
  workgroupBarrier();

  if (gid.x >= dim.x || gid.y >= dim.y) { return; }

  let uv = (vec2f(coord) + 0.5) / vec2f(dim);
  let cur = textureLoad(srcTex, coord, 0);

  if (cur.r >= 1.0) {
    textureStore(dstTex, coord,
      vec4f(1.0, min(cur.g + u.dt, ${SIM_AGE_MAX}.0), cell, cur.a));
    return;
  }

  let t0 = (li / ${SIM_TILE}u) * ${SIM_HALO}u + (li % ${SIM_TILE}u);
  var sum = 0.0;
  var maxN = 0.0;
  for (var dy = 0u; dy <= 2u; dy++) {
    for (var dx = 0u; dx <= 2u; dx++) {
      let v = tile[t0 + dy * ${SIM_HALO}u + dx];
      sum += v;
      maxN = max(maxN, v);
    }
  }
  let avg = sum / 9.0;

  let act = step(0.004, maxN);

  var nv = cur.a;
  var rate = 0.0;
  if (act > 0.0) {
    let base = snoise(vec3f(uv * u.noiseScale, u.time * 0.12)) * 0.5 + 0.5;
    let fine = snoise(vec3f(uv * u.noiseScale * 3.1, u.time * 0.35 + 19.0)) * 0.5 + 0.5;
    nv = clamp(mix(base, base * (0.45 + fine), 0.6), 0.0, 1.0);
    rate = clamp(pow(max(nv, 0.0), u.noiseContrast), 0.0, 2.0);
  }

  let edge = 1.0 - smoothstep(0.0, 0.18, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  let fuel = 1.0 + edge * u.edgeBias;

  var burn = cur.r;

  let drive = avg * avg * 4.2 + avg * 0.7 + 0.015;
  burn += u.dt * u.speed * rate * fuel * drive * act;
  burn = max(burn, mix(burn, avg, 0.22 * act * min(rate, 1.0)));
  burn = max(burn, cur.r);

  if (u.seedActive > 0.5) {
    let p = uv * vec2f(u.aspect, 1.0);
    let a = u.seed * vec2f(u.aspect, 1.0);
    let ab = (u.seedB - u.seed) * vec2f(u.aspect, 1.0);
    let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    if (distance(p, a + ab * t) < u.seedRadius) {
      burn = max(burn, 1.0);
    }
  }

  burn = clamp(burn, 0.0, 1.0);

  var age = cur.g;
  if (burn > 0.02) { age = min(age + u.dt, ${SIM_AGE_MAX}.0); }

  textureStore(dstTex, coord, vec4f(burn, age, cell, nv));
}
`;

/* ------------------------------------------------------------------ *
 * 1b. Compute: the blur pyramid the discolouration is read from
 * ------------------------------------------------------------------ */

const SMEAR_W = 256;
const SMEAR_H = 352;
const SMEAR_LEVELS = 8;

const SMEAR_SEED_WGSL = /* wgsl */ `
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSamp: sampler;
@group(0) @binding(2) var dstTex: texture_storage_2d<rgba16float, write>;

const W: u32 = ${SMEAR_W}u;
const H: u32 = ${SMEAR_H}u;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= W || gid.y >= H) { return; }
  let uv0 = vec2f(f32(gid.x), f32(gid.y)) / vec2f(f32(W), f32(H));
  let step = 1.0 / vec2f(f32(W), f32(H));
  var sum = 0.0;
  for (var y = 0; y < 2; y++) {
    for (var x = 0; x < 2; x++) {
      let o = (vec2f(f32(x), f32(y)) + 0.5) * 0.5;
      sum += textureSampleLevel(srcTex, srcSamp, uv0 + o * step, 0.0).r;
    }
  }
  textureStore(dstTex, vec2i(gid.xy), vec4f(sum * 0.25, 0.0, 0.0, 1.0));
}
`;

const SMEAR_DOWN_WGSL = /* wgsl */ `
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSamp: sampler;
@group(0) @binding(2) var dstTex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dim = textureDimensions(dstTex);
  if (gid.x >= dim.x || gid.y >= dim.y) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(dim);
  let v = textureSampleLevel(srcTex, srcSamp, uv, 0.0).r;
  textureStore(dstTex, vec2i(gid.xy), vec4f(v, 0.0, 0.0, 1.0));
}
`;

/* ------------------------------------------------------------------ *
 * 2. Render: paper surface
 * ------------------------------------------------------------------ */

/** Burn-mask resolution, in texels — the solver's grid. */
const MASK_SIZE = 1024;
/** Occupancy / fragment-ownership grid resolution. MASK_SIZE must divide by it. */
const OCC_SIZE = 256;

const SCENE_BINDINGS = /* wgsl */ `
struct Scene {
  viewProj: mat4x4f,
  model: mat4x4f,
  camRight: vec3f,
  time: f32,
  camUp: vec3f,
  emissive: f32,
  camPos: vec3f,
  curlStrength: f32,
  paperSize: vec2f,
  riseAmount: f32,
  curlScale: f32,
  charDarkness: f32,
  flicker: f32,
  charSpread: f32,
  deckleDepth: f32,
  deckleScale: f32,
  inkAmount: f32,
  cornerRadius: f32,
};

@group(0) @binding(0) var<uniform> s: Scene;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var burnTex: texture_2d<f32>;
@group(0) @binding(3) var paperTex: texture_2d<f32>;
@group(0) @binding(4) var ownerTex: texture_2d<u32>;
@group(0) @binding(6) var smearTex: texture_2d<f32>;
@group(0) @binding(7) var smearSamp: sampler;
@group(0) @binding(8) var inkTex: texture_2d<f32>;

/** Average burn over a disc of radius r (WORLD units), from the blur pyramid. */
fn smearAt(uv: vec2f, r: f32) -> f32 {
  let lod = clamp(log2(max(r, 1e-4) * ${SMEAR_W}.0) - 1.0, 0.0, ${SMEAR_LEVELS - 1}.0);
  return textureSampleLevel(smearTex, smearSamp, uv, lod).r;
}

fn ownerAt(uv: vec2f) -> u32 {
  let c = clamp(vec2i(uv * ${OCC_SIZE}.0), vec2i(0), vec2i(${OCC_SIZE - 1}));
  return textureLoad(ownerTex, c, 0).r;
}

const MASK_INSET = vec2f(0.5 / ${MASK_SIZE}.0);

fn burnAt(uv: vec2f) -> vec4f {
  let c = clamp(uv, MASK_INSET, vec2f(1.0) - MASK_INSET);
  return textureSampleLevel(burnTex, samp, c, 0.0);
}
`;

const DECKLE_EDGE = /* wgsl */ `
fn fibreNoise(p: vec2f) -> f32 {
  return snoise(vec3f(p, 0.0)) * 0.66 + snoise(vec3f(p * 2.1 + 17.0, 0.0)) * 0.34;
}

/** How far the tear has eaten in from one border, at position \`t\` along it. */
fn deckleBite(t: f32, seed: f32) -> f32 {
  let f = s.deckleScale;
  let slow = snoise(vec3f(t * f, seed, 0.0));
  let mid = snoise(vec3f(t * f * 2.3, seed + 5.0, 0.0));
  let fine = snoise(vec3f(t * f * 5.5, seed + 11.0, 0.0));
  var v = 0.42 + slow * 0.30 + mid * 0.10 + fine * 0.045;
  v = clamp((v - 0.45) * 2.3 + 0.45, 0.0, 1.0);
  let notch = smoothstep(0.68, 0.90, snoise(vec3f(t * f * 2.1 + 40.0, seed + 23.0, 0.0)) * 0.5 + 0.5);
  return min(v + notch * 0.4, 1.0) * s.deckleDepth;
}

/** Distance to the sheet's SHAPE — a squircle. Positive inside. */
fn squircleDist(p: vec2f, halfSize: vec2f, radius: f32) -> f32 {
  let r = min(radius, min(halfSize.x, halfSize.y));
  if (r <= 0.0) {
    return min(min(p.x + halfSize.x, halfSize.x - p.x),
               min(p.y + halfSize.y, halfSize.y - p.y));
  }
  let q = abs(p) - halfSize + vec2f(r);
  let m = max(q, vec2f(0.0));
  let corner = pow(pow(m.x, 4.0) + pow(m.y, 4.0), 0.25);
  return r - (corner + min(max(q.x, q.y), 0.0));
}

fn deckleDist(uv: vec2f) -> f32 {
  let halfSize = s.paperSize * 0.5;
  let p = (uv - vec2f(0.5)) * s.paperSize;

  let dShape = squircleDist(p, halfSize, s.cornerRadius);
  let deckleCare = s.deckleDepth * 0.5 + 0.005;
  let bound = dShape - s.deckleDepth;
  if (bound > deckleCare) { return bound; }

  let dL = (p.x + halfSize.x) - deckleBite(p.y, 0.0);
  let dR = (halfSize.x - p.x) - deckleBite(p.y, 3.1);
  let dB = (p.y + halfSize.y) - deckleBite(p.x, 7.3);
  let dT = (halfSize.y - p.y) - deckleBite(p.x, 11.9);
  return min(min(min(dL, dR), min(dB, dT)), dShape);
}

fn deckleAlpha(d: f32) -> f32 {
  return clamp(d / 0.0016, 0.0, 1.0);
}
`;

const SURFACE_GEOMETRY = /* wgsl */ `
struct SurfacePoint {
  world: vec3f,
  normal: vec3f,
  curl: f32,
};

fn surfacePoint(uv: vec2f) -> SurfacePoint {
  let local = vec3f((uv.x - 0.5) * s.paperSize.x, (0.5 - uv.y) * s.paperSize.y, 0.0);

  var out: SurfacePoint;
  out.world = (s.model * vec4f(local, 1.0)).xyz;
  out.normal = normalize((s.model * vec4f(0.0, 0.0, 1.0, 0.0)).xyz);
  out.curl = 0.0;

  var mb = burnAt(uv).r * 0.34;
  for (var k = 0; k < 4; k++) {
    let ang = f32(k) * (PI * 0.5);
    mb += burnAt(uv + vec2f(cos(ang), sin(ang)) * 0.012).r * 0.165;
  }

  if (mb > 0.62) {
    out.curl = smoothstep(0.62, 0.72, mb) * (1.0 - smoothstep(0.78, 0.90, mb));
    let c2 = curlNoiseXY(out.world * s.curlScale + vec3f(0.0, -s.time * 0.35, s.time * 0.1));
    let c = normalize(vec3f(c2, 0.0) + vec3f(0.0, 0.0001, 0.0));
    let lift = vec3f(0.0, 1.0, 0.0) * s.riseAmount;
    out.world += (c * s.curlStrength + lift) * out.curl;
  }
  return out;
}
`;

const SURFACE_SHADING = /* wgsl */ `
struct Surface {
  color: vec3f,
  coverage: f32,
};

const COVERAGE_EPS: f32 = 0.004;

fn shadeSurface(uv: vec2f, nIn: vec3f, world: vec3f, curl: f32, front: bool) -> Surface {
  let m = burnAt(uv);
  let b = m.r;

  var out: Surface;
  out.color = vec3f(0.0);
  out.coverage = 0.0;

  if (b >= 0.92) { return out; }

  let dDeckle = deckleDist(uv);
  let dAlpha = deckleAlpha(dDeckle);
  if (dAlpha <= COVERAGE_EPS) { return out; }

  let fine = fbm3(vec3f(uv * 130.0, 0.0)) * 0.5 + 0.5;

  let cut = 0.85 - (fine - 0.5) * 0.12;
  out.coverage = (1.0 - smoothstep(cut - 0.22, cut, b)) * dAlpha;
  if (out.coverage <= COVERAGE_EPS) { return out; }

  var near = 0.0;
  for (var i = 0; i < 6; i++) {
    let a = f32(i) * (PI / 3.0) + 0.4;
    let o = vec2f(cos(a), sin(a));
    near += burnAt(uv + o * 0.006).r;
    near += burnAt(uv + o * 0.018).r;
  }
  near /= 12.0;

  let band = vec3f(
    smearAt(uv, s.charSpread * 0.55),
    smearAt(uv, s.charSpread * 1.15),
    smearAt(uv, s.charSpread * 2.0),
  );

  let grain = textureSampleLevel(paperTex, samp, uv * vec2f(3.0, 4.0), 0.0).rgb;

  var rough = 0.72;

  var toast = smoothstep(0.006, 0.22, band.z) * 0.34
            + smoothstep(0.012, 0.28, band.y) * 0.33
            + smoothstep(0.025, 0.34, band.x) * 0.33;
  toast = max(toast, smoothstep(0.05, 0.42, (b + near) * 0.5));
  let mottle = fbm3(vec3f(uv * 7.0, 0.0)) * 0.5 + 0.5;
  let fibre = fbm3(vec3f(uv * vec2f(38.0, 15.0), 0.0)) * 0.5 + 0.5;
  let jitter = (mottle - 0.5) * 0.22 + (fibre - 0.5) * 0.09;
  toast = clamp(toast + jitter * smoothstep(0.04, 0.45, toast) * (1.0 - toast), 0.0, 1.0);

  var albedo = mix(vec3f(0.95, 0.925, 0.875), vec3f(0.66, 0.52, 0.29),
                   smoothstep(0.03, 0.42, toast));
  albedo = mix(albedo, vec3f(0.42, 0.245, 0.105), smoothstep(0.32, 0.74, toast));
  albedo = mix(albedo, vec3f(0.17, 0.082, 0.036), smoothstep(0.70, 1.0, toast));

  let ink = textureSampleLevel(inkTex, smearSamp, uv, 0.0).rgb;
  albedo *= mix(vec3f(1.0), ink, s.inkAmount);

  let bs = mix(b, near, 0.68);

  let charT = clamp(max(max(bs / 0.25, (near - 0.05) / 0.40),
                        (band.x - 0.34) / 0.40), 0.0, 1.0);
  let char = smoothstep(0.0, 1.0, charT);
  let ashPowder = clamp(fine * 0.55 + (fbm3(vec3f(uv * 46.0, 0.0)) * 0.5 + 0.5) * 0.65, 0.0, 1.0);
  var charCol = vec3f(0.055, 0.046, 0.042) * s.charDarkness * (0.45 + grain.b * 1.1);
  charCol = mix(charCol, vec3f(0.185, 0.175, 0.170), smoothstep(0.6, 1.0, ashPowder) * 0.6);
  albedo = mix(albedo, charCol, char);
  rough = mix(rough, 0.97, char);

  let lipD = 1.0 - smoothstep(0.0, s.deckleDepth * 0.5 + 0.005, dDeckle);
  let lip = lipD * lipD;
  let fray = fibreNoise(uv * vec2f(30.0, 41.0) + 5.0) * 0.5 + 0.5;
  albedo = mix(albedo, albedo * 1.04 + vec3f(0.07, 0.066, 0.061) * (0.7 + fray * 0.5),
               lip * 0.8 * (1.0 - char));
  rough = mix(rough, 0.94, lip * (1.0 - char));
  let speck = smoothstep(0.62, 0.98, m.b) * char * 0.4;
  var emissive = blackbody(0.35) * speck * 1.6;

  if (bs >= 0.25) {
    let edgeFactor = clamp(1.0 - abs((bs - 0.55) / 0.38), 0.0, 1.0);
    let heatCol = pow(edgeFactor, 1.4) * 0.62;
    var heatAmp = pow(edgeFactor, 1.25);
    let emberNoise = clamp(
      (fbm3(vec3f(uv * 55.0, s.time * 1.1)) * 0.5 + 0.5) * 0.72
      + (fbm3(vec3f(uv * 17.0, s.time * 0.6)) * 0.5 + 0.5) * 0.45 - 0.16,
      0.0, 1.0);
    heatAmp *= 0.10 + 1.5 * emberNoise;
    let flick = 1.0 + s.flicker * (fbm3(vec3f(uv * 26.0, s.time * 2.6)) * 0.5);
    emissive += blackbody(heatCol) * heatAmp * s.emissive * flick;
    albedo = mix(albedo, vec3f(0.05, 0.03, 0.02), edgeFactor * 0.7);
  }

  let rimLight = smoothstep(0.02, 0.55, near);
  let fireLight = vec3f(0.95, 0.42, 0.13) * rimLight * 1.15;

  var n = normalize(nIn);
  if (!front) { n = -n; }

  let lightDir = normalize(vec3f(0.35, 0.85, 0.45));
  let viewDir = normalize(s.camPos - world);
  let diff = max(dot(n, lightDir), 0.0) * 0.62 + 0.30;
  let backlit = pow(max(dot(-n, lightDir), 0.0), 2.0) * 0.25;
  let spec = pow(max(dot(reflect(-lightDir, n), viewDir), 0.0), mix(48.0, 4.0, rough)) * (1.0 - rough) * 0.35;

  var color = albedo * (vec3f(diff + backlit) + fireLight) + vec3f(spec);
  color += blackbody(0.5) * curl * 0.2;
  color += emissive;

  out.color = color;
  return out;
}
`;

const PAPER_WGSL = /* wgsl */ `
${NOISE}
${BLACKBODY}
${SCENE_BINDINGS}
${DECKLE_EDGE}
${SURFACE_GEOMETRY}
${SURFACE_SHADING}

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) normal: vec3f,
  @location(3) curl: f32,
};

@vertex
fn vs(@location(0) uv: vec2f) -> VOut {
  let sp = surfacePoint(uv);
  var out: VOut;
  out.clip = s.viewProj * vec4f(sp.world, 1.0);
  out.uv = uv;
  out.world = sp.world;
  out.normal = sp.normal;
  out.curl = sp.curl;
  return out;
}

@fragment
fn fs(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (ownerAt(in.uv) != 0u) { discard; }

  let surf = shadeSurface(in.uv, in.normal, in.world, in.curl, front);
  if (surf.coverage <= COVERAGE_EPS) { discard; }
  return vec4f(surf.color, surf.coverage);
}
`;

/* ------------------------------------------------------------------ *
 * 2b. Compute + render: orphaned scraps
 * ------------------------------------------------------------------ */

const OCCUPANCY_WGSL = /* wgsl */ `
@group(0) @binding(0) var burnTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> occ: array<u32>;

const OCC: u32 = ${OCC_SIZE}u;
const BLOCK: i32 = ${MASK_SIZE / OCC_SIZE};

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= OCC || gid.y >= OCC) { return; }
  let base = vec2i(gid.xy) * BLOCK;
  var sum = 0.0;
  for (var y = 0; y < BLOCK; y++) {
    for (var x = 0; x < BLOCK; x++) {
      sum += textureLoad(burnTex, base + vec2i(x, y), 0).r;
    }
  }
  occ[gid.y * OCC + gid.x] = select(0u, 1u, sum / f32(BLOCK * BLOCK) < 0.72);
}
`;

/** Quads per side of the patch mesh drawn for each detached scrap. */
const FRAG_PATCH = 16;
const FRAG_VERTS = FRAG_PATCH * FRAG_PATCH * 6;

const FRAG_STRUCT = /* wgsl */ `
struct Frag {
  uvMin: vec2f,
  uvMax: vec2f,
  pos: vec3f,
  id: f32,
  pivot: vec3f,
  alpha: f32,
  rot: vec3f,
  pad0: f32,
};
`;

const FRAGMENT_WGSL = /* wgsl */ `
${NOISE}
${BLACKBODY}
${SCENE_BINDINGS}
${DECKLE_EDGE}
${SURFACE_GEOMETRY}
${SURFACE_SHADING}
${FRAG_STRUCT}

@group(0) @binding(5) var<storage, read> frags: array<Frag>;

const PATCH: u32 = ${FRAG_PATCH}u;

struct FOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) normal: vec3f,
  @location(3) @interpolate(flat) fid: u32,
  @location(4) @interpolate(flat) alpha: f32,
  @location(5) curl: f32,
};

fn rotateZ(v: vec3f, e: vec3f) -> vec3f {
  let c = cos(e.x);
  let sn = sin(e.x);
  return vec3f(v.x * c - v.y * sn, v.x * sn + v.y * c, v.z);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FOut {
  let f = frags[ii];
  var out: FOut;

  let quad = vi / 6u;
  let corner = vi % 6u;
  var offs = array<vec2u, 6>(
    vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u),
    vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 1u),
  );
  let o = offs[corner];
  let t = vec2f(f32(quad % PATCH + o.x), f32(quad / PATCH + o.y)) / f32(PATCH);
  let uv = mix(f.uvMin, f.uvMax, t);

  let sp = surfacePoint(uv);
  let pivotW = (s.model * vec4f(f.pivot, 1.0)).xyz;
  let world = rotateZ(sp.world - pivotW, f.rot) + f.pos;

  out.clip = s.viewProj * vec4f(world, 1.0);
  out.uv = uv;
  out.world = world;
  out.normal = rotateZ(sp.normal, f.rot);
  out.curl = sp.curl;
  out.fid = u32(f.id);
  out.alpha = f.alpha;
  return out;
}

@fragment
fn fs(in: FOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (ownerAt(in.uv) != in.fid) { discard; }

  let surf = shadeSurface(in.uv, in.normal, in.world, in.curl, front);
  if (surf.coverage * in.alpha <= COVERAGE_EPS) { discard; }
  return vec4f(surf.color, surf.coverage * in.alpha);
}
`;

/* ------------------------------------------------------------------ *
 * 3. Compute + render: fire and smoke particles
 * ------------------------------------------------------------------ */

const FIRE_END = '0.44';
const FIRE_OUT_RATE = '3.2';
const EMBER_CUT = '0.985';
const PAPER_CUT = '0.78';
const FUEL_LO = '0.22';
const FUEL_HI = '0.44';
const EMIT_MASS = '0.40';
const EMIT_INSET = '0.026';

const PARTICLE_STRUCT = /* wgsl */ `
struct Particle {
  pos: vec3f,
  life: f32,
  vel: vec3f,
  seed: f32,
};

fn isEmber(seed: f32) -> f32 {
  return step(${EMBER_CUT}, fract(seed * 13.77));
}
`;

const PARTICLE_SIM_WGSL = /* wgsl */ `
${NOISE}
${PARTICLE_STRUCT}

struct SimU {
  model: mat4x4f,
  paperSize: vec2f,
  dt: f32,
  time: f32,
  buoyancy: f32,
  turbulence: f32,
  turbScale: f32,
  drag: f32,
  emitChance: f32,
  reset: f32,
  spawnSpeed: f32,
  frame: u32,
};

@group(0) @binding(0) var<uniform> u: SimU;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle>;
@group(0) @binding(2) var burnTex: texture_2d<f32>;
@group(0) @binding(3) var ownerTex: texture_2d<u32>;

fn attachedAt(uv: vec2f) -> bool {
  let c = clamp(vec2i(uv * ${OCC_SIZE}.0), vec2i(0), vec2i(${OCC_SIZE - 1}));
  return textureLoad(ownerTex, c, 0).r == 0u;
}

fn sheetUV(world: vec3f) -> vec2f {
  let local = vec3f(
    dot(world, u.model[0].xyz),
    dot(world, u.model[1].xyz),
    dot(world, u.model[2].xyz),
  );
  return vec2f(local.x / u.paperSize.x + 0.5, 0.5 - local.y / u.paperSize.y);
}

fn burnAtTexel(uv: vec2f, dim: vec2f) -> f32 {
  return textureLoad(burnTex, vec2i(clamp(uv, vec2f(0.0), vec2f(1.0)) * dim), 0).r;
}

fn towardPaper(uv: vec2f, dim: vec2f) -> vec2f {
  let e = 0.020 / u.paperSize;
  let g = vec2f(
    burnAtTexel(uv + vec2f(e.x, 0.0), dim) - burnAtTexel(uv - vec2f(e.x, 0.0), dim),
    burnAtTexel(uv + vec2f(0.0, e.y), dim) - burnAtTexel(uv - vec2f(0.0, e.y), dim),
  );
  let len = length(g);
  if (len < 0.02) { return vec2f(0.0); }
  return -g / len;
}

fn paperMass(uv: vec2f, dim: vec2f) -> f32 {
  if (uv.x < -0.06 || uv.x > 1.06 || uv.y < -0.06 || uv.y > 1.06) { return 0.0; }

  let r1 = 0.035 / u.paperSize;
  let r2 = 0.075 / u.paperSize;

  var on = 0.0;
  var mass = 0.0;
  for (var k = 0u; k < 17u; k++) {
    var t = uv;
    if (k > 0u) {
      let a = f32(k) * (PI * 0.25);
      t = uv + vec2f(cos(a), sin(a)) * select(r1, r2, k > 8u);
    }
    if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) { continue; }
    on += 1.0;
    if (burnAtTexel(t, dim) < ${PAPER_CUT} && attachedAt(t)) { mass += 1.0; }
  }
  if (on < 1.0) { return 0.0; }
  return mass / on;
}

@compute @workgroup_size(64)
fn updateParticles(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&parts)) { return; }

  var p = parts[i];

  if (u.reset > 0.5) {
    p.life = 0.0;
    p.pos = vec3f(0.0);
    p.vel = vec3f(0.0);
    parts[i] = p;
    return;
  }

  var rs = pcg(i * 2654435761u + u.frame * 40503u);

  let dim = vec2f(textureDimensions(burnTex));

  if (p.life > 0.0) {
    let heat = p.life * p.life;
    let age = 1.0 - p.life;
    let buoy = vec3f(0.0, u.buoyancy * (0.25 + heat * 1.75), 0.0);
    let wind = vec3f(curlNoiseXY(p.pos * u.turbScale + vec3f(0.0, -u.time * 0.4, u.time * 0.12)), 0.0);
    p.vel += (buoy + wind * u.turbulence * (0.10 + 1.55 * age * age)) * u.dt;
    p.vel *= exp(-u.drag * u.dt);
    p.pos += p.vel * u.dt;

    let notEmber = 1.0 - isEmber(p.seed);
    let inFire = step(${FIRE_END}, p.life);
    var starveRate = 0.0;
    if (notEmber * inFire > 0.0) {
      let mass = paperMass(sheetUV(p.pos), dim);
      starveRate = ((1.0 - smoothstep(${FUEL_LO}, ${FUEL_HI}, mass)) * notEmber)
        * inFire * ${FIRE_OUT_RATE};
    }

    p.life -= u.dt * (0.55 + 0.95 * fract(p.seed * 7.31) + starveRate);
    if (p.life <= 0.0) { p.life = 0.0; }
  } else if (rnd(&rs) < u.emitChance) {
    for (var k = 0u; k < 10u; k++) {
      let hit = vec2f(rnd(&rs), rnd(&rs));
      let b = burnAtTexel(hit, dim);
      if (b <= 0.2 || b >= 0.8) { continue; }
      let uv = clamp(hit + towardPaper(hit, dim) * (${EMIT_INSET} / u.paperSize),
                     vec2f(0.0), vec2f(1.0));
      if (attachedAt(uv) && paperMass(uv, dim) > ${EMIT_MASS}) {
        let local = vec3f((uv.x - 0.5) * u.paperSize.x, (0.5 - uv.y) * u.paperSize.y, 0.0);
        let world = (u.model * vec4f(local, 1.0)).xyz;
        let nrm = normalize((u.model * vec4f(0.0, 0.0, 1.0, 0.0)).xyz);
        p.pos = world + nrm * (0.030 + rnd(&rs) * 0.010);
        p.vel = vec3f(
          (rnd(&rs) - 0.5) * 0.09,
          0.40 + rnd(&rs) * 0.55,
          0.0,
        ) * u.spawnSpeed;
        p.life = 1.0;
        p.seed = rnd(&rs);
        break;
      }
    }
  }

  parts[i] = p;
}
`;

const PARTICLE_RENDER_WGSL = /* wgsl */ `
${NOISE}
${BLACKBODY}
${PARTICLE_STRUCT}

struct RenderU {
  viewProj: mat4x4f,
  camRight: vec3f,
  fireSize: f32,
  camUp: vec3f,
  smokeSize: f32,
  time: f32,
  fireIntensity: f32,
  smokeOpacity: f32,
  flameDetail: f32,
  flameWisp: f32,
  flameStretch: f32,
  flameTongue: f32,
  flameSharp: f32,
};

@group(0) @binding(0) var<uniform> r: RenderU;
@group(0) @binding(1) var<storage, read> rparts: array<Particle>;

fn flameField(world: vec3f, t: f32) -> f32 {
  var q = world;
  q.x += sin(world.y * 2.3 + t * 0.9) * 0.05 + sin(world.y * 5.1 - t * 1.4) * 0.022;
  q.z += sin(world.y * 3.7 + t * 1.1) * 0.035;

  let p = vec3f(q.x, q.y / max(r.flameTongue, 0.1), q.z) * r.flameDetail
        + vec3f(0.0, -t * 2.4, t * 0.16);

  var f = snoise(p) * 0.52;
  f += snoise(p * vec3f(2.1, 1.7, 2.1) + vec3f(19.7, 3.1, 11.3)) * 0.26;
  f += (1.0 - abs(snoise(p * vec3f(4.3, 3.1, 4.3) + vec3f(-7.2, 23.9, 5.4)))) * 0.22 - 0.11;
  return clamp(f * 0.5 + 0.5, 0.0, 1.0);
}

struct POut {
  @builtin(position) clip: vec4f,
  @location(0) quad: vec2f,
  @location(1) life: f32,
  @location(2) seed: f32,
  @location(3) world: vec3f,
};

@vertex
fn particleVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> POut {
  var out: POut;
  let p = rparts[ii];

  if (p.life <= 0.0) {
    out.clip = vec4f(0.0, 0.0, 2.0, 1.0);
    out.quad = vec2f(0.0);
    out.life = 0.0;
    out.seed = 0.0;
    out.world = vec3f(0.0);
    return out;
  }

  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let q = corners[vi];

  let age = 1.0 - p.life;
  let ember = isEmber(p.seed);
  let grow = mix(r.fireSize, r.smokeSize, smoothstep(0.15, 1.0, age));
  let size = mix(grow, r.fireSize * 0.18, ember) * (0.55 + fract(p.seed * 3.77));

  let fwd = normalize(cross(r.camRight, r.camUp));
  var vAxis = p.vel - fwd * dot(p.vel, fwd);
  let vLen = length(vAxis);
  vAxis = normalize(mix(r.camUp, vAxis / max(vLen, 1e-5), smoothstep(0.02, 0.20, vLen)));
  let hAxis = normalize(cross(fwd, vAxis));

  let stretchY = mix(r.flameStretch, 1.0, smoothstep(0.0, 0.7, age));
  let sq = select(vec2f(q.x * mix(0.7, 1.0, age), q.y * stretchY), vec2f(q.x, q.y * 1.8), ember > 0.5);
  let world = p.pos + (hAxis * sq.x + vAxis * sq.y) * size;

  out.clip = r.viewProj * vec4f(world, 1.0);
  out.quad = q;
  out.life = p.life;
  out.seed = p.seed;
  out.world = world;
  return out;
}

@fragment
fn particleFs(in: POut) -> @location(0) vec4f {
  let ember = isEmber(in.seed);
  let age = 1.0 - in.life;

  let q = in.quad;
  let taper = mix(1.0 - 0.72 * smoothstep(-0.5, 1.0, q.y), 1.0, ember);
  let rr = length(vec2f(q.x / max(taper, 0.18), q.y));
  if (rr > 1.0) { discard; }

  let field = flameField(in.world, r.time);

  let cut = mix(0.20, 0.54, r.flameWisp) + 0.34 * age;
  let edge = mix(0.26, 0.035, r.flameSharp);
  let body = smoothstep(cut, cut + edge, field);
  let dens = body * (0.30 + 0.70 * smoothstep(cut, cut + 0.42, field));

  let env = smoothstep(1.0, 0.04, rr);
  let mask = env * mix(dens, 1.0, ember);
  let softMask = smoothstep(1.0, 0.28, rr) * mix(mix(1.0, body, 0.35), 1.0, ember);

  let fireAmt = mix(smoothstep(${FIRE_END}, 0.98, in.life), smoothstep(0.02, 0.4, in.life), ember);
  let smokeMix = smoothstep(0.52, 0.12, in.life) * (1.0 - ember);

  let temp = clamp(mix(0.24, 0.52, in.life * in.life) * (0.58 + 0.42 * dens), 0.0, 1.0);
  let core = mask * mask;
  let fireCol = blackbody(temp) * core * r.fireIntensity * fireAmt * mix(1.0, 1.6, ember);

  let alpha = softMask * smokeMix * r.smokeOpacity * smoothstep(0.0, 0.25, in.life);
  let smokeCol = mix(vec3f(0.22, 0.17, 0.145), vec3f(0.05, 0.048, 0.052), smokeMix);

  return vec4f(fireCol + smokeCol * alpha, alpha);
}
`;

/* ------------------------------------------------------------------ *
 * 4. Post: ACES tonemap
 * ------------------------------------------------------------------ */

const FULLSCREEN_VS = /* wgsl */ `
struct FOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> FOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let p = pts[vi];
  var out: FOut;
  out.clip = vec4f(p, 0.0, 1.0);
  out.uv = vec2f((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5);
  return out;
}
`;

const COMPOSITE_WGSL = /* wgsl */ `
${FULLSCREEN_VS}

struct PostU { exposure: f32, pad0: f32, vignette: f32, time: f32 };

@group(0) @binding(0) var<uniform> u: PostU;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var scene: texture_2d<f32>;

fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(in: FOut) -> @location(0) vec4f {
  var c = textureSample(scene, samp, in.uv).rgb;
  c = aces(c * u.exposure);

  let d = distance(in.uv, vec2f(0.5));
  c *= mix(1.0, smoothstep(0.95, 0.25, d), u.vignette);

  let dither = (fract(sin(dot(in.uv * 1024.0, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  return vec4f(pow(c, vec3f(1.0 / 2.2)) + dither, 1.0);
}
`;

/* ==========================================================================
 * MAT4 / VEC3 HELPERS — minimal and column-major, as WGSL's `mat4x4f` is.
 * ========================================================================== */

type Mat4 = Float32Array;
type Vec3 = [number, number, number];

function mat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4],
      b1 = b[c * 4 + 1],
      b2 = b[c * 4 + 2],
      b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function orthographic(
  out: Mat4,
  halfW: number,
  halfH: number,
  near: number,
  far: number,
): Mat4 {
  out.fill(0);
  out[0] = 1 / halfW;
  out[5] = 1 / halfH;
  out[10] = 1 / (near - far);
  out[14] = near / (near - far);
  out[15] = 1;
  return out;
}

function lookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[3] = 0;
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[7] = 0;
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[11] = 0;
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;
  return out;
}

function transformPoint(m: Mat4, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/* ==========================================================================
 * PROCEDURAL PAPER TEXTURE
 * ========================================================================== */

const SIZE = 512;

function fract(x: number) {
  return x - Math.floor(x);
}

function hash2(x: number, y: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(fx, fy);
    fx *= 2.03;
    fy *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

let paperTextureCache: { data: Uint8Array; size: number } | null = null;

/**
 * The paper grain. Deterministic — same noise, same seed, same bytes — so it is
 * generated once per process and handed out by reference afterwards.
 *
 * This is 262 144 pixels of value-noise fbm on the JS thread, and before it was
 * cached it was most of the delay between confirming a delete and seeing the
 * card. The texture is only ever uploaded, never written to.
 */
function generatePaperTexture(): { data: Uint8Array; size: number } {
  if (paperTextureCache) return paperTextureCache;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;

      const fibre = fbm(u * 220, v * 34, 4);
      const crossFibre = fbm(u * 30 + 11, v * 190 + 7, 3);
      const grain = 0.5 + (fibre - 0.5) * 0.75 + (crossFibre - 0.5) * 0.45;

      const blotch = fbm(u * 5.5 + 31, v * 5.5 + 17, 4);
      const speckle = hash2(x * 0.61, y * 0.37) > 0.995 ? 0.35 : 0;

      const i = (y * SIZE + x) * 4;
      data[i] = Math.max(0, Math.min(255, (grain - speckle) * 255));
      data[i + 1] = Math.max(0, Math.min(255, blotch * 255));
      data[i + 2] = Math.max(0, Math.min(255, (0.5 + (fibre - blotch) * 0.6) * 255));
      data[i + 3] = 255;
    }
  }
  paperTextureCache = { data, size: SIZE };
  return paperTextureCache;
}

/* ==========================================================================
 * THE INK
 *
 * The reference composed its own card here — a photograph, a title, a printed
 * Delete button — out of Skia primitives, and burned that.
 *
 * SafaRoll does not. What burns is THE card: the one the player is looking at,
 * captured out of the live view by `cardInk` and handed over as a texture. So
 * everything that drew a card is gone, and all that is left of this section is
 * the sheet's own geometry.
 *
 * The ink is a MULTIPLIER over the paper's albedo: white is bare paper, and
 * nothing printed can lighten the sheet. `cardInk` lays its snapshot on white
 * for exactly that reason.
 * ========================================================================== */

/**
 * Where the fire starts, in sheet UV.
 *
 * Low and centred — under the card's plate, where a match would go. Not the
 * middle: a burn opening at the optical centre eats the animal first, and the
 * animal is the last thing that should go.
 */
const IGNITION: [number, number] = [0.5, 0.78];

/* ==========================================================================
 * THE ENGINE — WebGPU burning-paper renderer
 * ========================================================================== */

interface PaperParams {
  burnSpeed: number;
  noiseScale: number;
  noiseContrast: number;
  edgeBias: number;
  substeps: number;
  seedRadius: number;

  curlStrength: number;
  curlScale: number;
  riseAmount: number;

  emissive: number;
  flicker: number;
  charDarkness: number;
  charSpread: number;
  deckleDepth: number;
  deckleScale: number;
  cornerRadius: number;

  emitRate: number;
  turbulence: number;
  turbScale: number;
  buoyancy: number;
  drag: number;
  fireSize: number;
  smokeSize: number;
  fireIntensity: number;
  smokeOpacity: number;
  fragFall: number;
  fragFlutter: number;
  fragUpdraft: number;
  flameDetail: number;
  flameWisp: number;
  flameStretch: number;
  flameTongue: number;
  flameSharp: number;

  exposure: number;
  vignette: number;
}

const DEFAULT_PAPER_PARAMS: PaperParams = {
  burnSpeed: 40.0,
  noiseScale: 18.3,
  noiseContrast: 2.05,
  edgeBias: 2.0,
  substeps: 6,
  seedRadius: 0.02,

  curlStrength: 0.011,
  curlScale: 2.4,
  riseAmount: 0.01,

  emissive: 1.5,
  flicker: 0.55,
  charDarkness: 1.0,
  charSpread: 0.22,

  deckleDepth: 0.006,
  deckleScale: 4.2,
  cornerRadius: 0,

  emitRate: 2.2,
  turbulence: 1.03,
  turbScale: 3.65,
  buoyancy: 0.2,
  drag: 0.6,
  fireSize: 0.026,
  smokeSize: 0.05,
  fireIntensity: 0.2,
  smokeOpacity: 0.045,

  fragFall: 1.0,
  fragFlutter: 1.0,
  fragUpdraft: 1.0,

  flameDetail: 8.0,
  flameWisp: 0.61,
  flameStretch: 1.4,
  flameTongue: 1.7,
  flameSharp: 1.0,

  exposure: 0.72,
  vignette: 0,
};

/** Vertices per side of the sheet mesh. */
const GRID = 192;
const PARTICLE_COUNT = 32768;
const PARTICLE_STRIDE = 32;

const OCC_CELLS = OCC_SIZE * OCC_SIZE;
const OCC_SHIFT = Math.log2(OCC_SIZE);
const OCC_MASK = OCC_SIZE - 1;
const OWNER_DEAD = 0xffffffff;

const CELL_FREE = 0;
const CELL_ATTACHED = 1;
const CELL_ISLAND = 2;
const CELL_BLOCKED = 3;
const OCC_INTERVAL = 6;
const FRAG_MIN_CELLS = 4;
const FRAG_MAX_CELLS = 6000;
const MAX_FRAGS = 48;
const FRAG_Z_LIFT = 0.012;

const SCENE = {
  viewProj: 0,
  model: 16,
  camRight: 32,
  time: 35,
  camUp: 36,
  emissive: 39,
  camPos: 40,
  curlStrength: 43,
  paperSize: 44,
  riseAmount: 46,
  curlScale: 47,
  charDarkness: 48,
  flicker: 49,
  charSpread: 50,
  deckleDepth: 51,
  deckleScale: 52,
  inkAmount: 53,
  cornerRadius: 54,
} as const;
const SCENE_FLOATS = 56;

const BURN_U = {
  seed: 0,
  seedRadius: 2,
  seedActive: 3,
  seedB: 4,
  dt: 6,
  time: 7,
  speed: 8,
  noiseScale: 9,
  noiseContrast: 10,
  aspect: 11,
  reset: 12,
  edgeBias: 13,
} as const;
const BURN_U_FLOATS = 16;

const PART_SIM_U = {
  model: 0,
  paperSize: 16,
  dt: 18,
  time: 19,
  buoyancy: 20,
  turbulence: 21,
  turbScale: 22,
  drag: 23,
  emitChance: 24,
  reset: 25,
  spawnSpeed: 26,
  frame: 27,
} as const;
const PART_SIM_U_FLOATS = 28;

const PART_U = {
  viewProj: 0,
  camRight: 16,
  fireSize: 19,
  camUp: 20,
  smokeSize: 23,
  time: 24,
  fireIntensity: 25,
  smokeOpacity: 26,
  flameDetail: 27,
  flameWisp: 28,
  flameStretch: 29,
  flameTongue: 30,
  flameSharp: 31,
} as const;
const PART_U_FLOATS = 32;

const FRAG = {
  uvMin: 0,
  uvMax: 2,
  pos: 4,
  id: 7,
  pivot: 8,
  alpha: 11,
  rot: 12,
} as const;
const FRAG_FLOATS = 16;

interface Fragment {
  id: number;
  cells: Int32Array;
  uvMin: [number, number];
  uvMax: [number, number];
  pivot: Vec3;
  spawn: Vec3;
  pos: Vec3;
  age: number;
  fallY: number;
  vy: number;
  fallSpeed: number;
  updraft: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  swayBase: number;
  spin: number;
  rollAmp: number;
  alpha: number;
  retiring: boolean;
}

const HDR_FORMAT: GPUTextureFormat = 'rgba16float';

const SURFACE_BLEND: GPUBlendState = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

const PARTICLE_BLEND: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

const PAPER_W = 1.0;
const PAPER_H = 1.38;
const VIEW_H = 1.8;
const VIEW_HALF_W_MIN = PAPER_W * 0.5 + 0.12;
const CAM_Z = 2.35;

const SEED_STEPS_MAX = 24;

interface Seed {
  a: [number, number];
  b: [number, number];
}

const spot = (u: number, v: number): Seed => ({ a: [u, v], b: [u, v] });

interface PaperEngineOptions {
  viewHeight?: number;
}

class BurningPaperEngine {
  readonly params: PaperParams = { ...DEFAULT_PAPER_PARAMS };

  inkAmount = 1;
  paperLeft = 1;

  private context: RNCanvasContext;
  private device: GPUDevice;
  private format: GPUTextureFormat;

  private simTex: GPUTexture[] = [];
  private simView: GPUTextureView[] = [];
  private simPipeline!: GPUComputePipeline;
  private simBind: GPUBindGroup[][] = [];
  private simUniform!: GPUBuffer;
  private simData!: Float32Array;
  private simSlotFloats = BURN_U_FLOATS;
  private simIndex = 0;

  private smearTex!: GPUTexture;
  private smearAll!: GPUTextureView;
  private smearSampler!: GPUSampler;
  private smearSeedPipeline!: GPUComputePipeline;
  private smearDownPipeline!: GPUComputePipeline;
  private smearSeedBind: GPUBindGroup[] = [];
  private smearDownBind: GPUBindGroup[] = [];

  private paperPipeline!: GPURenderPipeline;
  private paperBind: GPUBindGroup[] = [];
  private sceneUniform!: GPUBuffer;
  private sceneData = new Float32Array(SCENE_FLOATS);
  private gridVerts!: GPUBuffer;
  private gridIndices!: GPUBuffer;
  private indexCount = 0;
  private paperTex!: GPUTexture;
  private sampler!: GPUSampler;
  private inkTex!: GPUTexture;

  private particleBuffer!: GPUBuffer;
  private particleSimPipeline!: GPUComputePipeline;
  private particleSimBind: GPUBindGroup[] = [];
  private particleSimUniform!: GPUBuffer;
  private particleSimData = new Float32Array(PART_SIM_U_FLOATS);
  private particleSimU32 = new Uint32Array(this.particleSimData.buffer);
  private particlePipeline!: GPURenderPipeline;
  private particleBind!: GPUBindGroup;
  private particleUniform!: GPUBuffer;
  private particleData = new Float32Array(PART_U_FLOATS);

  private occPipeline!: GPUComputePipeline;
  private occBind: GPUBindGroup[] = [];
  private occBuffer!: GPUBuffer;
  private occRead!: GPUBuffer;
  private occReadPending = false;
  private sheetEra = 0;
  private ownerTex!: GPUTexture;
  private ownerView!: GPUTextureView;
  private owner = new Uint32Array(OCC_CELLS);
  private ownerDirty = false;
  private labelScratch = new Int32Array(OCC_CELLS);
  private stackScratch = new Int32Array(OCC_CELLS);
  private componentScratch = new Int32Array(OCC_CELLS);
  private frags: Fragment[] = [];
  private nextFragId = 1;
  private fragPipeline!: GPURenderPipeline;
  private fragBind: GPUBindGroup[] = [];
  private fragBuffer!: GPUBuffer;
  private fragData = new Float32Array(MAX_FRAGS * FRAG_FLOATS);
  private fragCount = 0;

  private compositePipeline!: GPURenderPipeline;
  private postScratch = new Float32Array(4);
  private postUniform!: GPUBuffer;
  private hdrTex: GPUTexture | null = null;
  private depthTex: GPUTexture | null = null;
  private hdrView: GPUTextureView | null = null;
  private depthView: GPUTextureView | null = null;
  private compositeBind: GPUBindGroup | null = null;

  private model = mat4();
  private view = mat4();
  private proj = mat4();
  private viewProj = mat4();
  private eye: Vec3 = [0, 0, CAM_Z];
  private readonly camRight: Vec3 = [1, 0, 0];
  private readonly camUp: Vec3 = [0, 1, 0];
  private halfW = 1;
  private halfH = VIEW_H / 2;
  private viewH = VIEW_H;
  private viewHalfWMin = VIEW_HALF_W_MIN;

  private width = 1;
  private height = 1;
  private cssW = 1;
  private cssH = 1;
  private raf = 0;
  private frame = 0;
  private lastT = 0;
  private time = 0;
  private disposed = false;
  private resetPending = false;
  private seedQueue: Seed[] = [];
  private timeOrigin = performance.now();

  static async create(
    context: RNCanvasContext,
    opts: PaperEngineOptions = {},
  ): Promise<BurningPaperEngine> {
    let adapter: GPUAdapter | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (!candidate) throw new Error('WebGPU is not supported on this device (no adapter)');
      const info = (
        candidate as {
          info?: { vendor?: string; description?: string; architecture?: string };
        }
      ).info;
      const desc = info
        ? `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.toLowerCase()
        : '';
      if (!desc.includes('swiftshader')) {
        adapter = candidate;
        break;
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    if (!adapter) {
      throw new Error(
        'Only the SwiftShader (software) Vulkan adapter is available — creating a ' +
          'device on it crashes Dawn on the Android emulator. Real devices are unaffected.',
      );
    }
    const device = await adapter.requestDevice();
    return new BurningPaperEngine(context, device, opts);
  }

  private constructor(
    context: RNCanvasContext,
    device: GPUDevice,
    opts: PaperEngineOptions,
  ) {
    this.context = context;
    this.device = device;
    this.format = navigator.gpu.getPreferredCanvasFormat();

    device.onuncapturederror = (e) => console.error('[BurningCard] WebGPU:', e.error.message);
    device.lost.then((info) => {
      if (!this.disposed) console.error('[BurningCard] device lost:', info.message);
    });
    this.viewH = opts.viewHeight ?? VIEW_H;
    this.viewHalfWMin = VIEW_HALF_W_MIN * (this.viewH / VIEW_H);

    const canvas = context.canvas as HTMLCanvasElement;
    const dpr = Math.min(PixelRatio.get(), 2);
    this.cssW = Math.max(1, Math.round(canvas.clientWidth));
    this.cssH = Math.max(1, Math.round(canvas.clientHeight));
    this.width = Math.max(1, Math.round(this.cssW * dpr));
    this.height = Math.max(1, Math.round(this.cssH * dpr));
    canvas.width = this.width;
    canvas.height = this.height;

    context.configure({ device, format: this.format, alphaMode: 'opaque' });

    this.createSim();
    this.createFragments();
    this.createSmear();
    this.createPaper();
    this.createParticles();
    this.createPost();
    this.createTargets();

    this.lastT = performance.now() - this.timeOrigin;
    this.raf = requestAnimationFrame(this.loop);
  }

  private createSim() {
    const d = this.device;

    for (let i = 0; i < 2; i++) {
      const tex = d.createTexture({
        size: [MASK_SIZE, MASK_SIZE],
        format: HDR_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      });
      this.simTex.push(tex);
      this.simView.push(tex.createView());
    }

    this.simSlotFloats = Math.max(
      BURN_U_FLOATS,
      d.limits.minUniformBufferOffsetAlignment / 4,
    );
    this.simData = new Float32Array(SEED_STEPS_MAX * this.simSlotFloats);
    this.simUniform = d.createBuffer({
      size: this.simData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const module = d.createShaderModule({ code: SIM_WGSL, label: 'burn-sim' });
    this.simPipeline = d.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });

    const layout = this.simPipeline.getBindGroupLayout(0);
    for (let i = 0; i < 2; i++) {
      const perStep: GPUBindGroup[] = [];
      for (let s = 0; s < SEED_STEPS_MAX; s++) {
        perStep.push(
          d.createBindGroup({
            layout,
            entries: [
              {
                binding: 0,
                resource: {
                  buffer: this.simUniform,
                  offset: s * this.simSlotFloats * 4,
                  size: BURN_U_FLOATS * 4,
                },
              },
              { binding: 1, resource: this.simView[i] },
              { binding: 2, resource: this.simView[1 - i] },
            ],
          }),
        );
      }
      this.simBind.push(perStep);
    }
  }

  private createSheetMesh() {
    const d = this.device;
    const side = GRID + 1;

    const uvs = new Float32Array(side * side * 2);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const i = (y * side + x) * 2;
        uvs[i] = x / GRID;
        uvs[i + 1] = y / GRID;
      }
    }
    this.gridVerts = d.createBuffer({
      size: uvs.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(this.gridVerts, 0, uvs);

    const indices = new Uint32Array(GRID * GRID * 6);
    let k = 0;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const topLeft = y * side + x;
        const topRight = topLeft + 1;
        const botLeft = topLeft + side;
        const botRight = botLeft + 1;
        indices[k++] = topLeft;
        indices[k++] = botLeft;
        indices[k++] = topRight;
        indices[k++] = topRight;
        indices[k++] = botLeft;
        indices[k++] = botRight;
      }
    }
    this.indexCount = indices.length;
    this.gridIndices = d.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    d.queue.writeBuffer(this.gridIndices, 0, indices);
  }

  private createPaper() {
    const d = this.device;

    this.createSheetMesh();

    const { data, size } = generatePaperTexture();
    this.paperTex = d.createTexture({
      size: [size, size],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    d.queue.writeTexture(
      { texture: this.paperTex },
      data,
      { bytesPerRow: size * 4, rowsPerImage: size },
      [size, size],
    );

    this.sampler = d.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });

    this.inkTex = this.createInkTexture(1, 1);
    d.queue.writeTexture(
      { texture: this.inkTex },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );

    this.sceneUniform = d.createBuffer({
      size: this.sceneData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const module = d.createShaderModule({ code: PAPER_WGSL, label: 'paper' });
    this.paperPipeline = d.createRenderPipeline({
      label: 'paper',
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 8,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: SURFACE_BLEND }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    const fragModule = d.createShaderModule({
      code: FRAGMENT_WGSL,
      label: 'paper-fragments',
    });
    this.fragPipeline = d.createRenderPipeline({
      label: 'paper-fragments',
      layout: 'auto',
      vertex: { module: fragModule, entryPoint: 'vs' },
      fragment: {
        module: fragModule,
        entryPoint: 'fs',
        targets: [{ format: HDR_FORMAT, blend: SURFACE_BLEND }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    this.buildSurfaceBinds();
  }

  private buildSurfaceBinds() {
    const d = this.device;
    const paperView = this.paperTex.createView();
    const inkView = this.inkTex.createView();

    this.paperBind = [];
    this.fragBind = [];
    for (let i = 0; i < 2; i++) {
      const shared: GPUBindGroupEntry[] = [
        { binding: 0, resource: { buffer: this.sceneUniform } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.simView[i] },
        { binding: 3, resource: paperView },
        { binding: 4, resource: this.ownerView },
        { binding: 6, resource: this.smearAll },
        { binding: 7, resource: this.smearSampler },
        { binding: 8, resource: inkView },
      ];
      this.paperBind.push(
        d.createBindGroup({
          layout: this.paperPipeline.getBindGroupLayout(0),
          entries: shared,
        }),
      );
      this.fragBind.push(
        d.createBindGroup({
          layout: this.fragPipeline.getBindGroupLayout(0),
          entries: [...shared, { binding: 5, resource: { buffer: this.fragBuffer } }],
        }),
      );
    }
  }

  private createInkTexture(width: number, height: number): GPUTexture {
    return this.device.createTexture({
      label: 'ink',
      size: [width, height],
      format: 'rgba8unorm-srgb',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
  }

  private createSmear() {
    const d = this.device;

    this.smearTex = d.createTexture({
      size: [SMEAR_W, SMEAR_H],
      mipLevelCount: SMEAR_LEVELS,
      format: HDR_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    this.smearAll = this.smearTex.createView();
    this.smearSampler = d.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    const seed = d.createShaderModule({ code: SMEAR_SEED_WGSL, label: 'smear-seed' });
    const down = d.createShaderModule({ code: SMEAR_DOWN_WGSL, label: 'smear-down' });
    this.smearSeedPipeline = d.createComputePipeline({
      layout: 'auto',
      compute: { module: seed, entryPoint: 'main' },
    });
    this.smearDownPipeline = d.createComputePipeline({
      layout: 'auto',
      compute: { module: down, entryPoint: 'main' },
    });

    const level = (i: number) =>
      this.smearTex.createView({ baseMipLevel: i, mipLevelCount: 1 });

    for (let i = 0; i < 2; i++) {
      this.smearSeedBind.push(
        d.createBindGroup({
          layout: this.smearSeedPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.simView[i] },
            { binding: 1, resource: this.smearSampler },
            { binding: 2, resource: level(0) },
          ],
        }),
      );
    }
    for (let i = 1; i < SMEAR_LEVELS; i++) {
      this.smearDownBind.push(
        d.createBindGroup({
          layout: this.smearDownPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: level(i - 1) },
            { binding: 1, resource: this.smearSampler },
            { binding: 2, resource: level(i) },
          ],
        }),
      );
    }
  }

  private smearSize(i: number): [number, number] {
    return [Math.max(1, SMEAR_W >> i), Math.max(1, SMEAR_H >> i)];
  }

  private createFragments() {
    const d = this.device;

    this.occBuffer = d.createBuffer({
      size: OCC_CELLS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.occRead = d.createBuffer({
      size: OCC_CELLS * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    this.ownerTex = d.createTexture({
      size: [OCC_SIZE, OCC_SIZE],
      format: 'r32uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.ownerView = this.ownerTex.createView();
    this.uploadOwner();

    this.fragBuffer = d.createBuffer({
      size: this.fragData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const module = d.createShaderModule({ code: OCCUPANCY_WGSL, label: 'occupancy' });
    this.occPipeline = d.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    for (let i = 0; i < 2; i++) {
      this.occBind.push(
        d.createBindGroup({
          layout: this.occPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.simView[i] },
            { binding: 1, resource: { buffer: this.occBuffer } },
          ],
        }),
      );
    }
  }

  private uploadOwner() {
    this.device.queue.writeTexture(
      { texture: this.ownerTex },
      this.owner,
      { bytesPerRow: OCC_SIZE * 4, rowsPerImage: OCC_SIZE },
      [OCC_SIZE, OCC_SIZE],
    );
    this.ownerDirty = false;
  }

  private createParticles() {
    const d = this.device;

    this.particleBuffer = d.createBuffer({
      size: PARTICLE_COUNT * PARTICLE_STRIDE,
      usage: GPUBufferUsage.STORAGE,
    });

    this.particleSimUniform = d.createBuffer({
      size: this.particleSimData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.particleUniform = d.createBuffer({
      size: this.particleData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const simModule = d.createShaderModule({
      code: PARTICLE_SIM_WGSL,
      label: 'particle-sim',
    });
    const drawModule = d.createShaderModule({
      code: PARTICLE_RENDER_WGSL,
      label: 'particle-draw',
    });

    this.particleSimPipeline = d.createComputePipeline({
      layout: 'auto',
      compute: { module: simModule, entryPoint: 'updateParticles' },
    });
    for (let i = 0; i < 2; i++) {
      this.particleSimBind.push(
        d.createBindGroup({
          layout: this.particleSimPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.particleSimUniform } },
            { binding: 1, resource: { buffer: this.particleBuffer } },
            { binding: 2, resource: this.simView[i] },
            { binding: 3, resource: this.ownerView },
          ],
        }),
      );
    }

    this.particlePipeline = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module: drawModule, entryPoint: 'particleVs' },
      fragment: {
        module: drawModule,
        entryPoint: 'particleFs',
        targets: [{ format: HDR_FORMAT, blend: PARTICLE_BLEND }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    });

    this.particleBind = d.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleUniform } },
        { binding: 1, resource: { buffer: this.particleBuffer } },
      ],
    });
  }

  private createPost() {
    const d = this.device;

    this.postUniform = d.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const comp = d.createShaderModule({ code: COMPOSITE_WGSL, label: 'composite' });
    this.compositePipeline = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module: comp, entryPoint: 'vs' },
      fragment: {
        module: comp,
        entryPoint: 'fs',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private createTargets() {
    const d = this.device;
    const w = this.width;
    const h = this.height;
    this.updateCamera();

    this.hdrTex = d.createTexture({
      size: [w, h],
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.depthTex = d.createTexture({
      size: [w, h],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.hdrView = this.hdrTex.createView();
    this.depthView = this.depthTex.createView();

    this.compositeBind = d.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.postUniform } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.hdrView },
      ],
    });
  }

  private updateCamera() {
    const aspect = this.width / this.height;
    this.halfH = Math.max(this.viewH / 2, this.viewHalfWMin / Math.max(aspect, 1e-4));
    this.halfW = this.halfH * aspect;

    lookAt(this.view, this.eye, [0, 0, 0], [0, 1, 0]);
    orthographic(this.proj, this.halfW, this.halfH, 0.05, 50);
    multiply(this.viewProj, this.proj, this.view);
  }

  private detectIslands(occ: Uint32Array) {
    const label = this.labelScratch;
    const comp = this.componentScratch;
    const owner = this.owner;

    for (const f of this.frags) {
      let alive = false;
      for (const c of f.cells) {
        if (owner[c] === f.id && occ[c] !== 0) {
          alive = true;
          break;
        }
      }
      if (!alive) f.retiring = true;
    }

    let free = 0;
    for (let i = 0; i < OCC_CELLS; i++) {
      const isFree = occ[i] !== 0 && owner[i] === 0;
      label[i] = isFree ? CELL_FREE : CELL_BLOCKED;
      if (isFree) free++;
    }
    this.paperLeft = free / OCC_CELLS;

    for (let x = 0; x < OCC_SIZE; x++) this.flood(x, CELL_ATTACHED);

    for (let start = 0; start < OCC_CELLS; start++) {
      if (label[start] !== CELL_FREE) continue;
      const n = this.flood(start, CELL_ISLAND);

      if (n < FRAG_MIN_CELLS) {
        for (let k = 0; k < n; k++) owner[comp[k]] = OWNER_DEAD;
        this.ownerDirty = true;
        continue;
      }
      if (n > FRAG_MAX_CELLS || this.frags.length >= MAX_FRAGS) continue;

      let minX = OCC_SIZE,
        minY = OCC_SIZE,
        maxX = -1,
        maxY = -1;
      let sumX = 0,
        sumY = 0;
      for (let k = 0; k < n; k++) {
        const x = comp[k] & OCC_MASK;
        const y = comp[k] >> OCC_SHIFT;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        sumX += x;
        sumY += y;
      }
      this.spawnFragment(comp, n, minX, minY, maxX, maxY, sumX / n, sumY / n);
    }
  }

  private flood(start: number, mark: number): number {
    const label = this.labelScratch;
    const stack = this.stackScratch;
    const comp = this.componentScratch;
    if (label[start] !== CELL_FREE) return 0;

    let n = 0;
    let sp = 0;
    label[start] = mark;
    stack[sp++] = start;
    while (sp > 0) {
      const i = stack[--sp];
      comp[n++] = i;
      const x = i & OCC_MASK;
      const y = i >> OCC_SHIFT;
      const y0 = y > 0 ? -1 : 0;
      const y1 = y < OCC_SIZE - 1 ? 1 : 0;
      const x0 = x > 0 ? -1 : 0;
      const x1 = x < OCC_SIZE - 1 ? 1 : 0;
      for (let dy = y0; dy <= y1; dy++) {
        const row = (y + dy) << OCC_SHIFT;
        for (let dx = x0; dx <= x1; dx++) {
          const j = row + x + dx;
          if (label[j] !== CELL_FREE) continue;
          label[j] = mark;
          stack[sp++] = j;
        }
      }
    }
    return n;
  }

  private spawnFragment(
    comp: Int32Array,
    n: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    cx: number,
    cy: number,
  ) {
    const N = OCC_SIZE;
    const id = this.nextFragId++;
    const cells = comp.slice(0, n);
    for (let k = 0; k < n; k++) this.owner[cells[k]] = id;
    this.ownerDirty = true;

    const cu = (cx + 0.5) / N;
    const cv = (cy + 0.5) / N;
    const pivot: Vec3 = [(cu - 0.5) * PAPER_W, (0.5 - cv) * PAPER_H, 0];
    const spawn = transformPoint(this.model, pivot);
    spawn[2] += FRAG_Z_LIFT + (id % 8) * 0.0004;

    const r = Math.random();
    const swayPhase = Math.random() * Math.PI * 2;
    this.frags.push({
      id,
      cells,
      uvMin: [minX / N, minY / N],
      uvMax: [(maxX + 1) / N, (maxY + 1) / N],
      pivot,
      spawn,
      pos: [spawn[0], spawn[1], spawn[2]],
      age: 0,
      fallY: 0,
      vy: 0,
      fallSpeed: 0.26 + r * 0.3 + Math.min(n / FRAG_MAX_CELLS, 1) * 0.16,
      updraft: 0.7 + Math.random() * 1.1,
      swayAmp: 0.025 + Math.random() * 0.075,
      swayFreq: 1.5 + Math.random() * 2.4,
      swayPhase,
      swayBase: Math.sin(swayPhase),
      spin: (Math.random() - 0.5) * 2.6,
      rollAmp: 0.45 + Math.random() * 0.95,
      alpha: 1,
      retiring: false,
    });
  }

  private updateFragments(dt: number) {
    const p = this.params;
    const data = this.fragData;
    let n = 0;

    for (let i = this.frags.length - 1; i >= 0; i--) {
      const f = this.frags[i];
      f.age += dt;

      const lift = f.updraft * p.fragUpdraft * Math.exp(-f.age * 2.0);
      f.vy += (lift - 1.7) * dt;
      const terminal = -f.fallSpeed * p.fragFall;
      if (f.vy < terminal) f.vy = terminal;
      f.fallY += f.vy * dt;

      const ease = 1 - Math.exp(-f.age * 2.2);
      const phase = f.swayFreq * p.fragFlutter * f.age + f.swayPhase;
      const amp = f.swayAmp * p.fragFlutter * ease;
      const swayX = Math.sin(phase) - f.swayBase;
      f.pos[0] = f.spawn[0] + swayX * amp;
      f.pos[1] = f.spawn[1] + f.fallY;
      f.pos[2] = f.spawn[2];

      if (f.pos[1] < -2.2) f.retiring = true;
      if (f.retiring) f.alpha -= dt * 2.5;

      if (f.alpha <= 0) {
        for (const c of f.cells) {
          if (this.owner[c] === f.id) this.owner[c] = OWNER_DEAD;
        }
        this.ownerDirty = true;
        this.frags.splice(i, 1);
        continue;
      }

      const o = n * FRAG_FLOATS;
      data.set(f.uvMin, o + FRAG.uvMin);
      data.set(f.uvMax, o + FRAG.uvMax);
      data.set(f.pos, o + FRAG.pos);
      data.set(f.pivot, o + FRAG.pivot);
      data[o + FRAG.id] = f.id;
      data[o + FRAG.alpha] = Math.min(f.alpha, 1);
      const spun = f.age - (1 - Math.exp(-f.age * 2.2)) / 2.2;
      data[o + FRAG.rot] = f.spin * spun * 0.4 + swayX * ease * f.rollAmp * 0.5;
      data[o + FRAG.rot + 1] = 0;
      data[o + FRAG.rot + 2] = 0;
      n++;
    }

    this.fragCount = n;
    if (n > 0) {
      this.device.queue.writeBuffer(this.fragBuffer, 0, data, 0, n * FRAG_FLOATS);
    }
    if (this.ownerDirty) this.uploadOwner();
  }

  private clearFragments() {
    this.frags.length = 0;
    this.fragCount = 0;
    this.owner.fill(0);
    this.uploadOwner();
  }

  /**
   * Prints an image onto the sheet, in sheet UV. The image is a MULTIPLIER over
   * the paper's albedo, exactly like ink: white leaves bare paper.
   */
  setInk(rgba: Uint8Array, width: number, height: number) {
    if (this.disposed) return;
    if (this.inkTex.width !== width || this.inkTex.height !== height) {
      this.inkTex.destroy();
      this.inkTex = this.createInkTexture(width, height);
      this.buildSurfaceBinds();
    }
    this.device.queue.writeTexture(
      { texture: this.inkTex },
      rgba,
      { bytesPerRow: width * 4, rowsPerImage: height },
      [width, height],
    );
  }

  /** Re-prints one rectangle of the ink, leaving the rest of the page alone. */
  setInkRegion(rgba: Uint8Array, x: number, y: number, w: number, h: number) {
    if (this.disposed || w <= 0 || h <= 0) return;
    if (x < 0 || y < 0 || x + w > this.inkTex.width || y + h > this.inkTex.height) return;
    this.device.queue.writeTexture(
      { texture: this.inkTex, origin: { x, y } },
      rgba,
      { bytesPerRow: w * 4, rowsPerImage: h },
      [w, h],
    );
  }

  /** Seed the burn mask at a UV coordinate on the sheet. */
  ignite(u: number, v: number) {
    this.seedQueue.push(spot(u, v));
  }

  /**
   * Where the sheet's rectangle sits inside the canvas, in css px — what an
   * overlay needs to line a real touchable up with something printed on it.
   */
  sheetBox(): { left: number; top: number; width: number; height: number } {
    const width = (this.cssW * PAPER_W) / (2 * this.halfW);
    const height = (this.cssH * PAPER_H) / (2 * this.halfH);
    return {
      left: (this.cssW - width) / 2,
      top: (this.cssH - height) / 2,
      width,
      height,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.hdrTex?.destroy();
    this.depthTex?.destroy();
    this.inkTex?.destroy();
    this.paperTex?.destroy();
    this.ownerTex?.destroy();
    this.smearTex?.destroy();
    for (const t of this.simTex) t.destroy();
    this.simUniform?.destroy();
    this.sceneUniform?.destroy();
    this.gridVerts?.destroy();
    this.gridIndices?.destroy();
    this.particleBuffer?.destroy();
    this.particleSimUniform?.destroy();
    this.particleUniform?.destroy();
    this.fragBuffer?.destroy();
    this.occBuffer?.destroy();
    if (!this.occReadPending) this.occRead?.destroy();
    this.postUniform?.destroy();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    const now = performance.now() - this.timeOrigin;
    const dt = Math.min((now - this.lastT) / 1000, 1 / 30);
    this.lastT = now;
    this.time += dt;
    this.frame++;

    this.render(dt);
  };

  private render(dt: number) {
    const d = this.device;
    if (!this.hdrTex || !this.depthTex) return;

    const p = this.params;

    const steps = Math.min(
      SEED_STEPS_MAX,
      this.resetPending
        ? 1
        : Math.max(
            1,
            Math.round(p.substeps),
            Math.min(this.seedQueue.length, SEED_STEPS_MAX),
          ),
    );
    const groups = Math.ceil(MASK_SIZE / SIM_TILE);
    const startIndex = this.simIndex;
    const slot = this.simSlotFloats;

    for (let s = 0; s < steps; s++) {
      const seed = this.resetPending ? null : (this.seedQueue.shift() ?? null);
      const u = this.simData;
      const o = s * slot;
      u[o + BURN_U.seed] = seed ? seed.a[0] : 0;
      u[o + BURN_U.seed + 1] = seed ? seed.a[1] : 0;
      u[o + BURN_U.seedRadius] = p.seedRadius;
      u[o + BURN_U.seedActive] = seed ? 1 : 0;
      u[o + BURN_U.seedB] = seed ? seed.b[0] : 0;
      u[o + BURN_U.seedB + 1] = seed ? seed.b[1] : 0;
      u[o + BURN_U.dt] = dt / steps;
      u[o + BURN_U.time] = this.time;
      u[o + BURN_U.speed] = p.burnSpeed;
      u[o + BURN_U.noiseScale] = p.noiseScale;
      u[o + BURN_U.noiseContrast] = p.noiseContrast;
      u[o + BURN_U.aspect] = PAPER_W / PAPER_H;
      u[o + BURN_U.reset] = this.resetPending ? 1 : 0;
      u[o + BURN_U.edgeBias] = p.edgeBias;
    }
    d.queue.writeBuffer(this.simUniform, 0, this.simData, 0, steps * slot);
    this.simIndex = (startIndex + steps) % 2;

    const encoder = d.createCommandEncoder();

    const ps = this.particleSimData;
    ps.set(this.model, PART_SIM_U.model);
    ps[PART_SIM_U.paperSize] = PAPER_W;
    ps[PART_SIM_U.paperSize + 1] = PAPER_H;
    ps[PART_SIM_U.dt] = dt;
    ps[PART_SIM_U.time] = this.time;
    ps[PART_SIM_U.buoyancy] = p.buoyancy;
    ps[PART_SIM_U.turbulence] = p.turbulence;
    ps[PART_SIM_U.turbScale] = p.turbScale;
    ps[PART_SIM_U.drag] = p.drag;
    ps[PART_SIM_U.emitChance] = this.resetPending ? 0 : Math.min(p.emitRate * dt, 1);
    ps[PART_SIM_U.reset] = this.resetPending ? 1 : 0;
    ps[PART_SIM_U.spawnSpeed] = 1;
    this.particleSimU32[PART_SIM_U.frame] = this.frame;
    d.queue.writeBuffer(this.particleSimUniform, 0, this.particleSimData);

    const occRequested =
      this.frame % OCC_INTERVAL === 0 && !this.occReadPending && !this.resetPending;

    const cPass = encoder.beginComputePass();

    cPass.setPipeline(this.simPipeline);
    for (let s = 0; s < steps; s++) {
      cPass.setBindGroup(0, this.simBind[(startIndex + s) % 2][s]);
      cPass.dispatchWorkgroups(groups, groups);
    }

    cPass.setPipeline(this.smearSeedPipeline);
    cPass.setBindGroup(0, this.smearSeedBind[this.simIndex]);
    cPass.dispatchWorkgroups(Math.ceil(SMEAR_W / 8), Math.ceil(SMEAR_H / 8));
    cPass.setPipeline(this.smearDownPipeline);
    for (let i = 1; i < SMEAR_LEVELS; i++) {
      const [w, h] = this.smearSize(i);
      cPass.setBindGroup(0, this.smearDownBind[i - 1]);
      cPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    }

    cPass.setPipeline(this.particleSimPipeline);
    cPass.setBindGroup(0, this.particleSimBind[this.simIndex]);
    cPass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / 64));

    if (occRequested) {
      cPass.setPipeline(this.occPipeline);
      cPass.setBindGroup(0, this.occBind[this.simIndex]);
      const g = Math.ceil(OCC_SIZE / 8);
      cPass.dispatchWorkgroups(g, g);
    }
    cPass.end();

    if (occRequested) {
      encoder.copyBufferToBuffer(this.occBuffer, 0, this.occRead, 0, OCC_CELLS * 4);
    }
    this.updateFragments(dt);

    this.resetPending = false;

    const scene = this.sceneData;
    scene.set(this.viewProj, SCENE.viewProj);
    scene.set(this.model, SCENE.model);
    scene.set(this.camRight, SCENE.camRight);
    scene.set(this.camUp, SCENE.camUp);
    scene.set(this.eye, SCENE.camPos);
    scene[SCENE.time] = this.time;
    scene[SCENE.emissive] = p.emissive;
    scene[SCENE.curlStrength] = p.curlStrength;
    scene[SCENE.paperSize] = PAPER_W;
    scene[SCENE.paperSize + 1] = PAPER_H;
    scene[SCENE.riseAmount] = p.riseAmount;
    scene[SCENE.curlScale] = p.curlScale;
    scene[SCENE.charDarkness] = p.charDarkness;
    scene[SCENE.flicker] = p.flicker;
    scene[SCENE.charSpread] = p.charSpread;
    scene[SCENE.deckleDepth] = p.deckleDepth;
    scene[SCENE.deckleScale] = p.deckleScale;
    scene[SCENE.inkAmount] = this.inkAmount;
    scene[SCENE.cornerRadius] = p.cornerRadius;
    d.queue.writeBuffer(this.sceneUniform, 0, scene);

    const pu = this.particleData;
    pu.set(this.viewProj, PART_U.viewProj);
    pu.set(this.camRight, PART_U.camRight);
    pu.set(this.camUp, PART_U.camUp);
    pu[PART_U.fireSize] = p.fireSize;
    pu[PART_U.smokeSize] = p.smokeSize;
    pu[PART_U.time] = this.time;
    pu[PART_U.fireIntensity] = p.fireIntensity;
    pu[PART_U.smokeOpacity] = p.smokeOpacity;
    pu[PART_U.flameDetail] = p.flameDetail;
    pu[PART_U.flameWisp] = p.flameWisp;
    pu[PART_U.flameStretch] = p.flameStretch;
    pu[PART_U.flameTongue] = p.flameTongue;
    pu[PART_U.flameSharp] = p.flameSharp;
    d.queue.writeBuffer(this.particleUniform, 0, pu);

    const scenePass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.hdrView!,
          clearValue: { r: 0.012, g: 0.011, b: 0.014, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthView!,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    scenePass.setPipeline(this.paperPipeline);
    scenePass.setBindGroup(0, this.paperBind[this.simIndex]);
    scenePass.setVertexBuffer(0, this.gridVerts);
    scenePass.setIndexBuffer(this.gridIndices, 'uint32');
    scenePass.drawIndexed(this.indexCount);

    if (this.fragCount > 0) {
      scenePass.setPipeline(this.fragPipeline);
      scenePass.setBindGroup(0, this.fragBind[this.simIndex]);
      scenePass.draw(FRAG_VERTS, this.fragCount);
    }

    scenePass.setPipeline(this.particlePipeline);
    scenePass.setBindGroup(0, this.particleBind);
    scenePass.draw(6, PARTICLE_COUNT);
    scenePass.end();

    this.postScratch[0] = p.exposure;
    this.postScratch[1] = 0;
    this.postScratch[2] = p.vignette;
    this.postScratch[3] = this.time;
    d.queue.writeBuffer(this.postUniform, 0, this.postScratch);

    const post = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    post.setPipeline(this.compositePipeline);
    post.setBindGroup(0, this.compositeBind!);
    post.draw(3);
    post.end();

    d.queue.submit([encoder.finish()]);
    this.context.present();

    if (occRequested) {
      this.occReadPending = true;
      const era = this.sheetEra;
      this.occRead
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          this.occReadPending = false;
          if (this.disposed) {
            this.occRead.unmap();
            this.occRead.destroy();
            return;
          }
          if (era === this.sheetEra) {
            this.detectIslands(new Uint32Array(this.occRead.getMappedRange()));
          }
          this.occRead.unmap();
        })
        .catch(() => {
          this.occReadPending = false;
        });
    }
  }
}

/* ==========================================================================
 * THE COMPONENT
 * ========================================================================== */

type Phase = 'open' | 'burning' | 'burnt';

/**
 * Fraction of the sheet below which the burn counts as finished.
 *
 * Montée de 0,012 à 0,04, et c'est la queue de l'animation qu'on coupe, pas
 * le feu. `paperLeft` ne compte que le papier ENCORE ATTACHÉ (`owner === 0`) :
 * les fragments détachés sont déjà sortis du compte et tombent à l'écran. Les
 * derniers pourcents sont donc un bout de coin accroché pendant que tout le
 * reste est de la cendre en vol — le moment le plus long et le moins regardé,
 * puisque le front de flamme n'a presque plus de matière à manger.
 *
 * En descendant à 4 %, la scène rend la main pendant que les braises tombent
 * encore, ce qui est de toute façon l'image sur laquelle elle se terminait.
 */
const SPENT = 0.04;
/** Backstop for the burn watcher, in SIMULATED seconds. */
const BURN_MAX_SIM = 60;
/** The engine's own per-frame dt clamp; the backstop has to match it. */
const DT_CLAMP = 1 / 30;

const VIEW_HEIGHT = 1.7;

/**
 * How long the card sits there, printed and whole, before it catches.
 *
 * Not zero. The sheet has to register as the card the player just chose to
 * destroy — at zero it is already alight on the first frame anyone sees, and
 * what burns reads as an anonymous piece of paper.
 */
const HOLD_BEFORE_MS = 420;

/**
 * Quand « Passer » apparaît, une fois la carte allumée.
 *
 * Pas à la première image. Un bouton pour sauter une animation, offert avant
 * qu'elle ait commencé, dit à l'utilisateur qu'elle ne vaut pas la peine d'être
 * regardée — et c'est celle sur laquelle cette app a le plus travaillé. La
 * première fois, on la regarde ; à la vingtième, on veut passer. Une seconde et
 * demie sépare les deux publics.
 */
const SKIP_AFTER_MS = 1600;


/**
 * Where this screen starts, over the engine's defaults.
 *
 * `seedRadius` is about the press rather than the look: a seed sets the burn
 * mask straight to 1, so at the default radius the whole button would be gone
 * before the first frame. `cornerRadius` makes it a card rather than a sheet.
 */
const CARD_PARAMS: PaperParams = {
  ...DEFAULT_PAPER_PARAMS,
  seedRadius: 0.004,
  deckleDepth: 0.003,
  cornerRadius: 0.11,
};

interface SheetBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BurningCardProps {
  /**
   * False while this is only warming up behind something else.
   *
   * Building the engine is not free — a WebGPU device, eight pipelines, six
   * WGSL modules to compile — and doing it after the player has committed put
   * seconds of black screen between the decision and the fire. Mount this
   * hidden as soon as the ink exists, flip `armed` when they confirm, and the
   * burn starts on the next frame.
   */
  armed?: boolean;
  /** The card, photographed out of the live view — see `cardInk`. */
  ink: CardInk;
  /** Fires once the sheet is ash. The caller deletes and leaves. */
  onBurnt: () => void;
}

/**
 * Rotation means "throw this away and build it again at the new size": the
 * engine's drawing buffer is fixed at construction and every piece of state
 * under it belongs to the sheet that engine owns. So the stage is KEYED and
 * React unmounts the lot.
 */
export function BurningCard(props: BurningCardProps) {
  const { width, height } = useWindowDimensions();
  return <BurningStage key={`${width}x${height}`} {...props} />;
}

function BurningStage({ armed = true, ink, onBurnt }: BurningCardProps) {
  const { t: copy } = useUiTranslation();
  const canvasRef = useCanvasRef();
  const engineRef = useRef<BurningPaperEngine | null>(null);
  const fadeRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('open');
  /** « Passer » n'existe qu'une fois le feu pris, et pas tout de suite. */
  const [skipReady, setSkipReady] = useState(false);
  const [sheet, setSheet] = useState<SheetBox>({ left: 0, top: 0, width: 0, height: 0 });

  // Out of React entirely: the only consumer of this animation is a Skia
  // rasterization, so a state update per frame would buy nothing but re-renders.
  useEffect(() => {
    let cancelled = false;
    let engine: BurningPaperEngine | null = null;

    (async () => {
      try {
        // The native surface is created a frame or two after mount.
        let context = canvasRef.current?.getContext('webgpu');
        for (let i = 0; i < 60 && !context && !cancelled; i++) {
          await new Promise(requestAnimationFrame);
          context = canvasRef.current?.getContext('webgpu');
        }
        if (cancelled) return;
        if (!context) throw new Error('Could not acquire a WebGPU context');

        engine = await BurningPaperEngine.create(context, { viewHeight: VIEW_HEIGHT });
        if (cancelled) {
          engine.dispose();
          return;
        }
        Object.assign(engine.params, CARD_PARAMS);
        engineRef.current = engine;
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      engineRef.current = null;
      engine?.dispose();
    };
  }, [canvasRef]);

  /**
   * Print the card, then light it.
   *
   * Both in one effect, in this order, on the frame the engine is ready. The
   * reference waited for a press on a button it had printed; there is no button
   * here — the player already confirmed, on the dialog, and what they are owed
   * now is the fire and nothing else.
   *
   * A beat between the two so the card is on screen before it catches: at zero
   * the sheet is already burning in the first frame anyone sees it, and the
   * thing being destroyed never registers as having been there.
   */
  // Printed the moment the engine exists, armed or not: this is the half that
  // costs, and it is done while the player is still reading the dialog.
  useEffect(() => {
    if (!ready) return;
    engineRef.current?.setInk(ink.rgba, ink.width, ink.height);
  }, [ink, ready]);

  // And lit the moment they say yes. The beat is so the sheet registers as the
  // card they chose to destroy — at zero it is already alight in the first
  // frame anyone sees, and what burns reads as anonymous paper.
  useEffect(() => {
    if (!ready || !armed || phase !== 'open') return;
    const timer = setTimeout(() => {
      engineRef.current?.ignite(IGNITION[0], IGNITION[1]);
      setPhase('burning');
    }, HOLD_BEFORE_MS);
    return () => clearTimeout(timer);
  }, [armed, phase, ready]);

  // Watches the burn out. `paperLeft` comes from the occupancy read-back the
  // engine already does for its falling scraps, so this costs nothing but the
  // poll — and it tracks the burn actually finishing rather than guessing at a
  // duration that would be wrong on the first slow device.
  useEffect(() => {
    if (phase !== 'burning') return;
    let raf = 0;
    let simulated = 0;
    let last = performance.now();
    const tick = (now: number) => {
      simulated += Math.min((now - last) / 1000, DT_CLAMP);
      last = now;
      const engine = engineRef.current;
      if (!engine) return;
      if (engine.paperLeft < SPENT || simulated > BURN_MAX_SIM) {
        setPhase('burnt');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'burning') return;
    const timer = setTimeout(() => setSkipReady(true), SKIP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  // Dérivé plutôt que remis à zéro dans l'effet : un `setState` synchrone dans
  // un effet relance un rendu en cascade, et le compilateur React le refuse.
  const skippable = skipReady && phase === 'burning';

  // The reference offered a "Restore from backup" here. There is no backup: the
  // caller is about to destroy a real row and two real files, so the end of the
  // burn hands control straight back and the screen leaves.
  useEffect(() => {
    if (phase === 'burnt') onBurnt();
  }, [phase, onBurnt]);

  return (
    <View style={styles.root}>
      <Canvas ref={canvasRef} style={StyleSheet.absoluteFill} />

      {/* Passer, pas Annuler. La ligne est déjà condamnée — le feu est le
          spectacle de la suppression, pas la suppression elle-même, et la
          confirmation a eu lieu avant. Le raccourci mène donc exactement où
          mène la fin naturelle : `phase = 'burnt'`, et `onBurnt` s'ensuit. */}
      {skippable && !error ? (
        <Pressable
          accessibilityLabel={copy("ui_copy_101")}
          accessibilityRole="button"
          onPress={() => setPhase('burnt')}
          style={styles.skip}
        >
          <Text style={styles.skipText}>{copy("ui_copy_007")}</Text>
        </Pressable>
      ) : null}

      {error ? (
        <View style={[styles.center, StyleSheet.absoluteFill]}>
          <Text style={styles.errorTitle}>{copy("ui_copy_102")}</Text>
          <Text style={styles.errorText}>{error}</Text>
          {/* The card is not burning, but the player already said yes. Honour
              that rather than stranding them on an error they cannot act on. */}
          <Pressable style={styles.retryButton} onPress={onBurnt}>
            <Text style={styles.retryText}>{copy("auth_continue")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#08060a',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  /**
   * Transparent: this control's pressed state is printed on the paper
   * underneath it, in ink. Anything drawn here would sit on the glass in front
   * of the sheet and double what is already there.
   */
  hit: {
    position: 'absolute',
  },
  close: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 62 : 30,
    left: 20,
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(10, 7, 6, 0.66)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 140, 60, 0.24)',
  },
  closeGlyph: {
    color: '#ffcc9a',
    fontSize: 16,
    fontWeight: '700',
  },
  skip: {
    position: 'absolute',
    right: 0,
    bottom: Platform.OS === 'ios' ? 54 : 30,
    left: 0,
    alignSelf: 'center',
    alignItems: 'center',
  },
  skipText: {
    overflow: 'hidden',
    paddingVertical: 9,
    paddingHorizontal: 22,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    // La palette du feu, pas celle de l'app : ce bouton est posé sur la scène
    // sombre du brasier et rien d'autre ne l'entoure.
    borderColor: 'rgba(255, 140, 60, 0.24)',
    backgroundColor: 'rgba(10, 7, 6, 0.66)',
    color: '#ffcc9a',
    fontSize: 14,
    fontWeight: '700',
  },
  errorTitle: {
    color: '#ff8c3a',
    fontSize: 15,
    fontWeight: '700',
  },
  errorText: {
    color: '#a89684',
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 460,
  },
  retryButton: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 10,
    backgroundColor: '#ff6a1a',
  },
  retryText: {
    color: '#1a0a03',
    fontSize: 16,
    fontWeight: '700',
  },
});
