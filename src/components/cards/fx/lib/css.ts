// CSS -> Skia translation helpers: gradient geometry, color conversion,
// cover-fit math, and W3C filter-function color matrices.
// Pure TS, no RN imports. This is the shared vocabulary every Skia effect
// module uses to transliterate a CSS holo-card recipe exactly.

/**
 * exact CSS Color 4 HSL -> sRGB algorithm, returned as a Skia-friendly
 * `rgba(r, g, b, a)` string with integer 0-255 channels.
 * @param {Number} h hue in degrees
 * @param {Number} s saturation percentage (0-100)
 * @param {Number} l lightness percentage (0-100)
 * @param {Number} a alpha (0-1), default: 1
 * @returns {String}
 */
export const hsl = (h: number, s: number, l: number, a: number = 1): string => {
  let hue = h % 360;
  if (hue < 0) hue += 360;
  const sat = s / 100;
  const light = l / 100;

  const f = (n: number): number => {
    const k = (n + hue / 30) % 12;
    const c = sat * Math.min(light, 1 - light);
    return light - c * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };

  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/**
 * CSS `linear-gradient()` start/end points for a w x h box.
 * 0deg = "to top", angles increase clockwise. Gradient line length for
 * angle A is `|w*sin(A)| + |h*cos(A)|`, centered on the box center.
 * @param {Number} angleDeg CSS gradient angle in degrees
 * @param {Number} w box width
 * @param {Number} h box height
 * @returns {{start: {x: Number, y: Number}, end: {x: Number, y: Number}}}
 */
export const linearGradientPoints = (
  angleDeg: number,
  w: number,
  h: number
): { start: { x: number; y: number }; end: { x: number; y: number } } => {
  "worklet";
  const rad = (angleDeg * Math.PI) / 180;
  const len = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const dirX = Math.sin(rad);
  const dirY = -Math.cos(rad);
  const cx = w / 2;
  const cy = h / 2;
  const half = len / 2;
  return {
    start: { x: cx - dirX * half, y: cy - dirY * half },
    end: { x: cx + dirX * half, y: cy + dirY * half },
  };
};

/**
 * max distance from (cx,cy) to the 4 corners of a w x h box.
 * (matches CSS `radial-gradient(..., farthest-corner)` sizing)
 * @returns {Number}
 */
export const farthestCornerRadius = (cx: number, cy: number, w: number, h: number): number => {
  "worklet";
  const dx = Math.max(cx, w - cx);
  const dy = Math.max(cy, h - cy);
  return Math.hypot(dx, dy);
};

/**
 * object-fit/background-size: cover transform for fitting an imgW x imgH
 * image into a boxW x boxH box, scaled uniformly and centered.
 * @returns {{scale: Number, tx: Number, ty: Number}}
 */
export const coverTransform = (
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number
): { scale: number; tx: number; ty: number } => {
  "worklet";
  const scale = Math.max(boxW / imgW, boxH / imgH);
  return {
    scale,
    tx: (boxW - imgW * scale) / 2,
    ty: (boxH - imgH * scale) / 2,
  };
};

/**
 * pct(vPct, size) = vPct/100 * size — resolves a percentage against a size.
 * @returns {Number}
 */
export const pct = (vPct: number, size: number): number => {
  "worklet";
  return (vPct / 100) * size;
};

// -- W3C Filter Effects color matrices -----------------------------------
// 4x5 row-major (20 floats), Skia ColorMatrix convention:
// row0=R, row1=G, row2=B, row3=A, each row = [rCoef, gCoef, bCoef, aCoef, translate]
// with color components normalized 0..1 (so translate is also 0..1).

/** `filter: brightness(b)` matrix. */
export const brightnessMatrix = (b: number): number[] => {
  "worklet";
  return [b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
};

/** `filter: contrast(c)` matrix. translate = 0.5*(1-c). */
export const contrastMatrix = (c: number): number[] => {
  "worklet";
  const t = 0.5 * (1 - c);
  return [c, 0, 0, 0, t, 0, c, 0, 0, t, 0, 0, c, 0, t, 0, 0, 0, 1, 0];
};

/** `filter: saturate(s)` matrix, W3C luma weights R=0.213 G=0.715 B=0.072. */
export const saturateMatrix = (s: number): number[] => {
  "worklet";
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
    0, 0, 0, 1, 0,
  ];
};

/** `filter: hue-rotate(deg)` matrix, W3C Filter Effects spec coefficients. */
export const hueRotateMatrix = (deg: number): number[] => {
  "worklet";
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928, 0, 0,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283, 0, 0,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ];
};

/**
 * Composes color matrices in CSS filter-chain order: `filter: f1 f2` means
 * f2(f1(x)) — concatColorMatrices(f1, f2) applies f1 first, then f2.
 * Each 4x5 matrix is treated as an affine 5x5 (bottom row [0,0,0,0,1]);
 * "apply a then b" is the matrix product b*a (b*(a*x) = (b*a)*x).
 */
export const concatColorMatrices = (...ms: number[][]): number[] => {
  "worklet";
  const identity = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
  if (ms.length === 0) return identity;

  const toRows = (m: number[]): number[][] => [
    [m[0], m[1], m[2], m[3], m[4]],
    [m[5], m[6], m[7], m[8], m[9]],
    [m[10], m[11], m[12], m[13], m[14]],
    [m[15], m[16], m[17], m[18], m[19]],
    [0, 0, 0, 0, 1],
  ];
  // combined = b * a (row x col), i.e. apply a first, then b
  const mul = (b: number[][], a: number[][]): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < 5; i++) {
      const row: number[] = [];
      for (let j = 0; j < 5; j++) {
        let sum = 0;
        for (let k = 0; k < 5; k++) sum += b[i][k] * a[k][j];
        row.push(sum);
      }
      out.push(row);
    }
    return out;
  };
  const flatten = (m: number[][]): number[] => [
    m[0][0], m[0][1], m[0][2], m[0][3], m[0][4],
    m[1][0], m[1][1], m[1][2], m[1][3], m[1][4],
    m[2][0], m[2][1], m[2][2], m[2][3], m[2][4],
    m[3][0], m[3][1], m[3][2], m[3][3], m[3][4],
  ];

  return ms.reduce((accFlat, next) => flatten(mul(toRows(next), toRows(accFlat))));
};

// -- gradient stop color fixups ------------------------------------------

const parseRgbComponents = (color: string): [number, number, number] => {
  const c = color.trim();
  if (c[0] === "#") {
    let hex = c.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((ch) => ch + ch)
        .join("");
    }
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  const match = c.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const parts = match[1].split(",").map((p) => parseFloat(p.trim()));
    return [parts[0], parts[1], parts[2]];
  }
  return [0, 0, 0];
};

/**
 * replaces any "transparent" stop color with an alpha-0 rgba of the nearest
 * non-transparent neighbor (prefers the previous stop, falls back to next).
 */
export const fixTransparentStops = (
  colors: string[],
  positions: number[]
): { colors: string[]; positions: number[] } => {
  const isTransparent = (c: string) => c.trim().toLowerCase() === "transparent";
  const out = colors.map((c, i) => {
    if (!isTransparent(c)) return c;
    let neighbor: string | undefined;
    for (let j = i - 1; j >= 0; j--) {
      if (!isTransparent(colors[j])) {
        neighbor = colors[j];
        break;
      }
    }
    if (!neighbor) {
      for (let j = i + 1; j < colors.length; j++) {
        if (!isTransparent(colors[j])) {
          neighbor = colors[j];
          break;
        }
      }
    }
    const [r, g, b] = neighbor ? parseRgbComponents(neighbor) : [0, 0, 0];
    return `rgba(${r}, ${g}, ${b}, 0)`;
  });
  return { colors: out, positions };
};
