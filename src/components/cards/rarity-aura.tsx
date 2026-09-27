import { LiquidMetalOverlay, NeonOverlay } from '@/components/vfx/native-overlays';
import { StyleSheet, View } from 'react-native';

import type { CardIdentity } from './card-identity';
import type { RarityTier } from '@/lib/animals/rarity';
import { AURA_LOUDNESS, METAL_TIERS } from './rarity-aura-scale';

/**
 * The living edge of a rare card — the contour, on the miniature exactly as on
 * the full card.
 *
 * Two shaders from @native-springs/shaders, kept as their reference screens
 * configure them and only rescaled. Huit paliers, deux matières :
 *
 *   commun … ultra rare   NÉON — une ligne allumée qui parcourt le bord
 *   épique … légendaire   MÉTAL LIQUIDE — un chrome qui coule
 *
 * Le changement de MATIÈRE à l'entrée d'épique est la frontière que le joueur
 * doit sentir : pas huit nuances d'une même chose, mais une lumière qui devient
 * une matière. À l'intérieur de chaque matière, l'escalade est stricte et
 * vérifiée par `check-card-rarity.ts` — une carte plus rare ne peut jamais
 * paraître plus calme.
 *
 * Le légendaire est le SEUL à recevoir distorsion et aberration chromatique :
 * son contour se décompose en couleurs quand la carte bouge, et rien en dessous
 * ne l'imite.
 *
 * All three take their colour from the capture, never from the tier: the metal
 * is poured in the animal's darkest body stop and reflects its glow, the neon
 * runs between the same two. Rarity only decides how loud the edge is — the
 * card system's two axes, kept apart here as everywhere else.
 *
 * SUR LA MINIATURE, LES DEUX PALIERS DU BAS N'ONT RIEN
 *
 * Un bord que toutes les cartes portent n'est pas une récompense, et une grille
 * où vingt vignettes respirent est une grille illisible. Commun et peu commun
 * gardent donc leur contour pour la carte OUVERTE, là où il n'y en a qu'une à
 * l'écran — c'est ce que `showQuietTiers` décide.
 *
 * C'est aussi ce qui garde le coût tenable : une vue GPU native par carte,
 * `unique` pour que toutes les instances partagent une horloge qui n'avance
 * qu'une fois par vsync, et la grille bascule sur `CardTile` pendant l'inertie,
 * ce qui les démonte entièrement.
 *
 * Native Metal/OpenGL views: on a dev client built before the dependency was
 * added the overlays resolve to null and the card simply has no edge — never a
 * crash. Keep that guard (see `vfx/native-overlays.ts`).
 */

/**
 * Every geometric constant is a fraction of 340 — the width the full card was
 * designed at — so a 79pt deck slot wears the same frame rather than one five
 * times too thick. Same convention as `RIM_DILATION` in `holo-card.tsx`.
 *
 * Both lines are hairlines, well under what the reference screens use: their
 * demo is one shape filling a phone, this is a frame around card art it must
 * not compete with. The clamps matter as much as the fractions — pure scaling
 * would leave a miniature with a 0.8px line, which is no line at all.
 */
const DESIGN_WIDTH = 340;
// Un fil, mais un fil qu'on VOIT.
//
// Ces valeurs étaient réglées pour la vignette : 2 px de néon au maximum, et
// 0,9 px au minimum. À cette échelle le shader coule bel et bien, mais sur un
// trait d'un pixel personne ne le distingue — le contour paraissait figé.
//
// Le contour n'est plus la même chose selon la taille : la vignette garde son
// fil, la carte ouverte reçoit une vraie bande. La mise à l'échelle par
// `DESIGN_WIDTH` s'en charge, il fallait juste que le plafond la laisse monter.
/** Reference uses `borderWidth` 15 — a band. A card wants something between. */
const METAL_BORDER = 7 / DESIGN_WIDTH;
const METAL_BORDER_RANGE = { max: 7, min: 2 };
/** Reference: `NeonOverlayScreen` preview, `borderWidth` 3 and `inset` 15. */
const NEON_BORDER = 4.5 / DESIGN_WIDTH;
const NEON_BORDER_RANGE = { max: 4.5, min: 1.4 };
const NEON_INSET = 15 / DESIGN_WIDTH;

function hairline(width: number, fraction: number, range: { max: number; min: number }) {
  return Math.min(range.max, Math.max(range.min, width * fraction));
}

export function RarityAura({
  identity,
  radius,
  showQuietTiers = false,
  tier,
  width,
}: {
  identity: CardIdentity;
  /** The card's own corner radius, so the frame follows the exact same curve. */
  radius: number;
  /**
   * Monter le contour des deux paliers les plus communs. Faux par défaut :
   * la grille en affiche vingt à la fois, et un bord que tout le monde porte
   * ne récompense personne. La carte ouverte, elle, est seule à l'écran.
   */
  showQuietTiers?: boolean;
  tier: RarityTier;
  width: number;
}) {
  const loudness = AURA_LOUDNESS[tier.key];
  const quiet = tier.key === 'common' || tier.key === 'uncommon';
  if (quiet && !showQuietTiers) return null;

  if (METAL_TIERS.includes(tier.key) && LiquidMetalOverlay) {
    // Seul le légendaire se décompose en couleurs. C'est sa signature : si un
    // autre palier la portait, la carte la plus rare cesserait d'être
    // reconnaissable d'un coup d'œil.
    const top = tier.key === 'legendary';
    return (
      <LiquidMetalOverlay
        parameters={{
          intensity: 1,
          borderWidth: hairline(width, METAL_BORDER * loudness, METAL_BORDER_RANGE),
          cornerRadius: radius,
          // Metal poured in the animal's own colour: its darkest body stop as
          // the base, its glow as the reflection. That contrast is what makes
          // it read as metal rather than as paint — the same relationship the
          // block's gold preset has between #a67c00 and #ffdc73.
          baseColor: identity.body[2],
          highlightColor: identity.glow,
          flowSpeed: 0.7 + loudness * 0.8,
          stripeCount: tier.key === 'epic' ? 2 : tier.key === 'mythic' ? 3 : 4,
          // Both well under the reference's 1.0/2.0: those are tuned for a
          // 15px band, and on a hairline they only read as noise.
          distortion: top ? 0.3 : 0,
          chromaticAberration: top ? 0.5 : 0,
          flowOffset: [0, 0],
          flowAngle: 70,
          specular: { intensity: 1, position: [0, 0], size: 0.3 + loudness * 0.2 },
          roughness: 0,
        }}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        unique
      />
    );
  }

  if (!NeonOverlay) return null;

  // The neon line is drawn `inset` pixels in from the view's edges so its glow
  // has somewhere to spill. The view is blown up by exactly that inset on all
  // four sides, which lands the lit line back on the card's own edge and lets
  // the halo bleed past it.
  const inset = Math.max(4, width * NEON_INSET);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { margin: -inset }]}>
      <NeonOverlay
        parameters={{
          intensity: 1,
          borderWidth: hairline(width, NEON_BORDER * loudness, NEON_BORDER_RANGE),
          cornerRadius: radius,
          // The rarity says how loud, the animal says what colour — the card
          // system's two axes, kept separate here as everywhere else.
          color: identity.glow,
          secondaryColor: identity.body[0],
          glowSize: 2.4 + loudness * 3.2,
          glowFalloff: 1.2,
          flowSpeed: 0.4 + loudness,
          flowIntensity: loudness,
          pulseSpeed: 0.5 + loudness * 0.6,
          pulseIntensity: loudness * 0.32,
          // Le dernier néon avant le métal scintille : il annonce que quelque
          // chose change au cran suivant.
          flickerIntensity: tier.key === 'ultra_rare' ? 0.12 : 0,
          colorBlend: 0.8,
          inset,
        }}
        style={StyleSheet.absoluteFill}
        unique
      />
    </View>
  );
}
