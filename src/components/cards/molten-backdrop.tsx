import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

/**
 * La roche en fusion, derrière une carte LÉGENDAIRE.
 *
 * CE QUE J'AI CHANGÉ AU BLOC D'ORIGINE
 * ------------------------------------
 * Ses quatre couleurs — croûte, braise, coulée, cœur blanc — étaient des
 * constantes figées dans le shader : la même lave orange pour tout le monde.
 * Elles sont devenues des UNIFORMES, teintées par la couleur dominante de la
 * capture, celle-là même qui a déjà servi à peindre le corps de la carte
 * (`identityFor`). Le renard roux coule en cuivre, le martin-pêcheur en bleu
 * chauffé à blanc — la pièce prend la couleur de l'animal qu'elle éclaire, et
 * non l'inverse.
 *
 * POURQUOI LA DÉRIVATION SE FAIT EN JS ET PAS DANS LE SHADER
 * ---------------------------------------------------------
 * Les quatre teintes ne dépendent que de la capture, jamais du temps ni du
 * pixel. Les calculer dans `main()` les recalculerait à chaque fragment, à
 * chaque frame — des millions de fois par seconde pour un résultat constant.
 * Ici elles sont dérivées une fois, à l'ouverture de la fiche.
 *
 * CE QUE ÇA COÛTE, ET POURQUOI C'EST RÉSERVÉ AUX LÉGENDAIRES
 * ---------------------------------------------------------
 * Trois champs de bruit fractal à cinq octaves, par pixel, à chaque image :
 * c'est cher, et c'est assumé — une légendaire doit se payer. Le montage est
 * conditionné par l'appelant : aucune autre rareté ne fait tourner ce canevas.
 */

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;
uniform float3 uRock;
uniform float3 uEmber;
uniform float3 uMid;
uniform float3 uHot;

const float speed = 1.0;
const float scale = 2.6;
const float warp = 1.4;
const float crack = 6.0;
const float detail = 14.0;
const float heat = 1.0;
const float grain = 1.0;
const float vignette = 1.0;

float mo_hash(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float mo_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mo_hash(i);
    float b = mo_hash(i + float2(1.0, 0.0));
    float c = mo_hash(i + float2(0.0, 1.0));
    float d = mo_hash(i + float2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float mo_fbm(float2 p, int octaves) {
    float sum = 0.0, amp = 0.5, norm = 0.0;
    float2x2 rot = float2x2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 5; i++) {
        if (i >= octaves) break;
        sum += amp * mo_noise(p);
        norm += amp;
        amp *= 0.5;
        p = rot * p * 2.03;
    }
    return sum / max(norm, 0.0001);
}

float mo_ridge(float value, float sharpness) {
    float r = 1.0 - abs(value * 2.0 - 1.0);
    return pow(clamp(r, 0.0, 1.0), sharpness);
}

half4 main(float2 position) {
    float2 size = uResolution;
    float2 uv   = position / size;
    float  t    = uTime * speed;

    float2 p = uv - 0.5;
    p.x *= size.x / max(size.y, 1.0);
    p *= max(scale, 0.0001);
    p.y += t * 0.06;

    float2 w = float2(mo_fbm(p * 1.1 + float2(0.0, t * 0.08), 4),
                      mo_fbm(p * 1.1 + float2(7.7, -t * 0.06), 4));
    float2 q = p + warp * (w - 0.5);

    float body  = mo_fbm(q * 1.5, 5);
    float veins = mo_ridge(mo_fbm(q * 2.2 + 3.1, 5), max(crack, 0.0001));
    float fine  = mo_ridge(mo_fbm(q * 5.0 + 11.0, 4), max(detail, 0.0001));

    float lava = veins * 1.3 + fine * 0.6;
    lava *= 0.55 + 0.75 * body;
    lava += 0.10 * smoothstep(0.55, 1.0, body);
    lava *= heat;

    float shade = 0.35 + 0.65 * mo_fbm(q * 4.0 + 21.0, 3);

    float3 c = uRock * shade;
    c = mix(c, uEmber, clamp(lava * 1.1, 0.0, 1.0));
    c = mix(c, uMid,   clamp(lava - 0.55, 0.0, 1.0));
    c = mix(c, uHot,   clamp(lava - 1.15, 0.0, 1.0));
    c = clamp(c, 0.0, 1.0);

    float2 d = uv - 0.5;
    c *= 1.0 - 0.85 * vignette * dot(d, d);
    c += (mo_hash(uv * 900.0 + t) - 0.5) * 0.015 * grain;

    return half4(half3(clamp(c, 0.0, 1.0)), 1.0);
}
`);

// `Make` rend `null` quand le SkSL ne compile pas — et le `!` d'origine
// transformait ça en `<Shader source={null} />`, qui ne dessine rien SANS
// erreur. Un fond noir et aucun message : impossible de distinguer « le shader
// a échoué » de « le composant n'est pas monté ». On le dit, une fois.
if (!SOURCE && __DEV__) {
  console.warn('[molten] le shader ne compile pas — fond de repli utilisé.');
}

/** `#rrggbb` → composantes 0..1. Rend null sur une entrée qu'on ne sait pas lire. */
function rgbOf(hex: string | undefined): [number, number, number] | null {
  if (!hex) return null;
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (full.length !== 6 || !/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

/**
 * LA PIÈCE PREND LA COULEUR DE LA CARTE, PAS CELLE DE LA PHOTO.
 *
 * Deux erreurs successives avant d'arriver là. D'abord j'ai pris la couleur
 * dominante brute : sur un lémurien à `#2C2D30`, un anthracite, la braise était
 * noire et la croûte plus noire encore. Puis j'ai forcé une saturation
 * plancher : un gris neutre dont la teinte n'est que du bruit — un point d'écart
 * entre les canaux — s'est mis à couler en bleu franc.
 *
 * Les deux fois, je refabriquais une couleur que la carte possédait déjà.
 * `identityFor` la calcule pour peindre le CORPS de la carte, et gère
 * exactement ce cas : quand l'échantillon de la photo n'est pas exploitable,
 * elle retombe sur la teinte du royaume, avec une saturation bornée à
 * [0.55, 0.85]. Le fond lit donc la couleur du corps, et la pièce est d'accord
 * avec la carte par construction — pas par coïncidence.
 *
 * Ce qui reste ici, c'est la seule chose que la carte ne fournit pas : la RAMPE
 * de chaleur. Une lave n'est pas une couleur, c'est un écart de luminance —
 * croûte sombre, braise, coulée, cœur presque blanc.
 */
function hsl(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
    : max === g ? ((b - r) / d + 2) / 6
    : ((r - g) / d + 4) / 6;
  return [h, s, l];
}

/** La lave d'origine, quand la capture n'a livré aucune couleur exploitable. */
const FALLBACK = {
  rock: [0.058824, 0.031373, 0.031373] as [number, number, number],
  ember: [0.85098, 0.141176, 0.019608] as [number, number, number],
  mid: [1.0, 0.517647, 0.062745] as [number, number, number],
  hot: [1.0, 0.94902, 0.721569] as [number, number, number],
};

function rgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [canal(h + 1 / 3), canal(h), canal(h - 1 / 3)];
}

export function MoltenBackdrop({ color }: { color?: string }) {
  const { width, height } = useWindowDimensions();
  const clock = useClock();

  const palette = useMemo(() => {
    const base = rgbOf(color);
    if (!base) return FALLBACK;
    // La teinte et la saturation viennent du corps de la carte : elles sont
    // déjà bornées et déjà retombées sur le royaume si besoin. Rien à corriger.
    const [h, s] = hsl(base);
    return {
      // La croûte : la teinte, refroidie mais JAMAIS noire. À zéro, les creux
      // deviennent des trous et le relief disparaît.
      rock: rgb(h, s * 0.55, 0.07),
      ember: rgb(h, s, 0.42),
      mid: rgb(h, Math.min(1, s * 1.05), 0.62),
      // Le cœur garde un souffle de teinte : au blanc pur, les veines les plus
      // chaudes perdent la couleur de l'animal là où l'œil se pose.
      hot: rgb(h, s * 0.35, 0.9),
    };
  }, [color]);

  const uniforms = useDerivedValue(() => ({
    uResolution: [width, height],
    uTime: clock.get() / 1000,
    uRock: palette.rock,
    uEmber: palette.ember,
    uMid: palette.mid,
    uHot: palette.hot,
  }));

  // Sans shader, un dégradé de la même famille plutôt qu'un trou noir : la
  // fiche garde une pièce éclairée par l'animal, en attendant le correctif.
  if (!SOURCE) {
    const [r, g, b] = palette.ember;
    const ember = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: ember }]} />;
  }

  return (
    <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Fill>
        <Shader source={SOURCE} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
