// Pure colour maths — no imports, so the check script runs it under plain `bun`.

export type Hsl = { h: number; s: number; l: number };

export function hexToHsl(hex: string): Hsl {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((channel) => channel + channel)
          .join('')
      : value;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  return { h: (h * 60 + 360) % 360, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hue = ((h % 360) + 360) % 360;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;

  const [r, g, b] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];

  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Force a sampled colour into a range that reads as a UI accent on near-black.
 * A crow samples almost black and a swan almost white; both must still light a
 * button and a glow, so saturation and lightness are clamped and only the hue —
 * the part that actually says "this animal" — survives untouched.
 */
export function accentOn(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex({
    h,
    s: Math.min(0.9, Math.max(0.48, s)),
    l: Math.min(0.68, Math.max(0.54, l)),
  });
}

/** Black or white, whichever reads on `hex`. */
export function inkOn(hex: string): string {
  return hexToHsl(hex).l > 0.55 ? '#08090c' : '#ffffff';
}

/** Shortest signed distance from `a` to `b` on the hue wheel, in degrees. */
export function hueDelta(a: number, b: number) {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Mean hue of a set of colours, weighted by saturation — greys don't vote. */
export function meanHue(colors: string[]) {
  let x = 0;
  let y = 0;
  for (const color of colors) {
    const { h, s } = hexToHsl(color);
    x += Math.cos((h * Math.PI) / 180) * s;
    y += Math.sin((h * Math.PI) / 180) * s;
  }
  if (x === 0 && y === 0) return 0;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Rotate every stop of a palette around the hue wheel, keeping S and L. */
export function rotatePalette(colors: string[], degrees: number) {
  if (degrees === 0) return [...colors];
  return colors.map((color) => {
    const hsl = hexToHsl(color);
    return hslToHex({ ...hsl, h: hsl.h + degrees });
  });
}
