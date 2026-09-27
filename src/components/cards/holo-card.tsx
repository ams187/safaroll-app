import { uiLanguage } from '@/i18n/current';

import { speciesName } from '@/lib/animals/species-name';
import {
  Blur,
  Canvas,
  ColorMatrix,
  Fill,
  Group,
  Image as SkiaImage,
  LinearGradient,
  Oval,
  Paint,
  RadialGradient,
  Rect,
} from '@shopify/react-native-skia';
import { Image as ExpoImage, type ImageRef } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';
import { cardRarity, frameWidthFor, tierFor, type Rarity } from '@/lib/animals/rarity';
import {
  type LocalEncounterRarity,
  type SpeciesMastery,
} from '@/lib/animals/progression';
import { animalGroupName } from '@/lib/animals/animal-group-name';
import { currentLanguage } from '@/i18n/languages';
import { useCardImage } from './card-image';
import { effectKeyFor, identityFor } from './card-identity';
import { cardSceneFor, fullSceneFrom } from './card-scenes';
import { SceneImage } from './scene-image';
import { components, fallbackEffect } from './fx/effects';
import { useCardFx } from './fx/use-card-fx';
import { RarityAura } from './rarity-aura';
import { MasteryStars } from './mastery-stars';

/** Card-face copy, read in the UI language at render (no i18next: scripts load this file). */
const CARD_TEXT = {
  fr: { identifying: 'Carte en cours d’identification', class: 'classe', mastery: 'niveau de maîtrise', imported: 'IMAGE IMPORTÉE', field: 'CAPTURE TERRAIN' },
  en: { identifying: 'Card being identified', class: 'class', mastery: 'mastery level', imported: 'IMPORTED IMAGE', field: 'FIELD CAPTURE' },
} as const;

export type HoloCardData = {
  _id?: string;
  stickerUrl: string | null;
  /**
   * Le détourage réduit à 384 px. Les vues où l'animal fait moins de 300 px —
   * la grille, les tuiles, les emplacements de deck — lisent CELUI-CI : 0,6 Mo
   * en mémoire au lieu de 7,8. La carte ouverte et la révélation gardent le
   * détourage entier, c'est là qu'on voit les plumes.
   */
  stickerThumbUrl?: string;
  /** The uncut photo. The burn prints this — a die-cut's alpha would ink black. */
  originalUrl?: string | null;
  commonName?: string;
  scientificName?: string;
  commonNameLocale?: string;
  inAtlas?: boolean;
  confidence?: number;
  capturedAt?: number;
  captureSource?: 'camera' | 'library';
  latitude?: number;
  longitude?: number;
  status: 'processing' | 'ready' | 'needs_review' | 'failed';
  identificationIssue?:
    'no_animal_detected' | 'low_confidence' | 'service_unavailable' | 'invalid_image' | 'unsupported_capture';
  rarity?: Rarity;
  localEncounterRarity?: LocalEncounterRarity;
  localOccurrenceCount?: number;
  raritySource?: 'gbif';
  dominantColor?: string;
  /** La planche de l'espèce, résolue par le serveur. Voir `card-scenes.ts`. */
  sceneSlug?: string;
  /** Module Metro embarqué, prioritaire pour une carte de démonstration hors ligne. */
  sceneAsset?: number | string | ImageRef;
  /** Détourage Metro embarqué, prioritaire sur l'URL d'une capture. */
  stickerAsset?: number | ImageRef;
  /** Distinct observation-day progression — injected client-side. */
  mastery?: SpeciesMastery;
  taxonomy?: {
    kingdom?: string;
    phylum?: string;
    class?: string;
    order: string;
    family: string;
    genus: string;
  };
  candidates?: {
    scientificName: string;
    commonName: string;
    commonNameLocale?: string;
    confidence: number;
    kingdom?: string;
    phylum?: string;
    class?: string;
    order: string;
    family: string;
    genus: string;
  }[];
};

/** Luma weights (Rec. 709) — the same ones `saturateMatrix` uses in fx/lib/css. */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * A 4x5 colour matrix that fades a layer toward one hue: every pixel is mixed,
 * by `k`, with its own brightness painted in `hex`. At k=0 nothing changes; at
 * k=1 the layer is a monochrome wash in that colour. Alpha is untouched, so a
 * foil keeps its shape and only changes what colour it catches.
 */
function tintMatrix(hex: string, k: number): number[] {
  const n = hex.replace('#', '');
  const tint = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const row = (channel: number) => LUMA.map((l, i) => (i === channel ? 1 - k : 0) + k * tint[channel] * l);
  return [...row(0), 0, 0, ...row(1), 0, 0, ...row(2), 0, 0, 0, 0, 0, 1, 0];
}

/** Pokémon card proportions — width / height. */
export const CARD_RATIO = 0.716;

/**
 * The exact box a card occupies at a given width — the single authority for
 * every surface that has to sit flush with one: the miniature it degrades to
 * while scrolling, and the empty deck slots it sits beside. Two places
 * computing this separately is how the deck ended up with cards and holes of
 * different shapes.
 */
export function cardMetrics(width: number) {
  return {
    height: width / CARD_RATIO,
    // 5.5% is the printed card's own corner, and it holds down to about 182pt.
    // Below that the proportion stops reading: a deck slot is 79pt wide, which
    // put its corner at 4px — square enough that the dashed drop placeholder
    // beside it, drawn at a flat 10, looked like a different shape entirely.
    // So the corner stops shrinking there. Small cards need proportionally more
    // rounding to read as rounded at all, and the placeholder is what everything
    // else now matches.
    radius: Math.max(CARD_MIN_RADIUS, Math.round(width * 0.055)),
    width,
  };
}

/** The corner every card smaller than ~182pt wears. */
export const CARD_MIN_RADIUS = 10;

/**
 * Where the animal sits inside a card of this width. Exported because the
 * open-card transition has to land the flying sticker exactly on it.
 * Centred in the free zone between the header (~22% of the card) and the
 * plate (~25%): the rect's midpoint sits at 47% of the height, the optical
 * centre of what remains.
 */
export function portraitRectFor(width: number) {
  const height = width / CARD_RATIO;
  const inset = Math.round(width * 0.045);
  return {
    x: inset * 1.4,
    y: Math.round(height * 0.24),
    width: width - inset * 2.8,
    height: Math.round(height * 0.46),
  };
}

/**
 * The card face. A Skia canvas stacks, bottom to top: a quiet painted backdrop
 * in the encounter's palette, the holographic rim traced around the lifted
 * animal, the animal itself, then the real thing — one of the pixel-identical
 * pokemon-cards-css holo effects (see `fx/`), picked by rarity and species,
 * driven by the same springs, pointer math and gyro drive as the original.
 */
/**
 * Below this width the printed chrome stops being readable: the plate's fixed
 * 8-12px type is nearly as tall as the rarity pill itself, and the name — sized
 * as a fraction of the width — shrinks to seven pixels. A card this small is a
 * miniature, not a small card, so it drops everything it cannot say and keeps
 * only what identifies it at a glance.
 */
export const COMPACT_BELOW = 150;

/**
 * How loud the card is allowed to be. One place, because the alternative is
 * hunting an opacity through twenty-three effect modules.
 *
 * A real holo card is *subtle*: the foil is a sheen you have to tilt to find,
 * not a light source. The CSS port is calibrated for a 600px card on a bright
 * desktop screen, and transplanted at full strength onto a phone it burns.
 * These three knobs pull it back to print.
 */
const SUBTLETY = {
  /** The whole shine + glare stack from the CSS port. Drawn UNDER the animal. */
  effect: 0.42,
  /**
   * How far the foil is pulled toward the card's own colour, 0..1.
   *
   * The ported effects carry the Pokémon CSS's six hard-coded "sunpillar"
   * hues — acid green, magenta, cyan. On a printed card that is the point; on
   * top of a painted mountain scene it is just three colours that were never
   * in the picture. This bends the whole stack toward the card's own light
   * instead, in ONE place, rather than re-tinting twenty-three effect modules.
   * Not 1: a foil with no colour of its own stops shimmering.
   */
  foilTint: 0.72,
  /**
   * The sheen painted ON the animal — the one layer of the card drawn over the
   * die-cut, and therefore the only one that can touch how the animal reads.
   *
   * Off, and not for lack of trying: colour-dodge burned a white flamingo to
   * 255, overlay flattened a dark eagle into a washed slab, and a bounded
   * additive holo foil (ported from holosticker) was judged ugly on a real
   * card. The photograph the player took is the point of the card; nothing
   * draws over it.
   */
  subjectSheen: 0,
} as const;

/*
 * Two layers deliberately have NO knob here, because both were dimmed once and
 * both times it made the card worse, not calmer:
 *
 *   the shimmer on the animal — a colour-dodge layer, so it only ever *adds*
 *     light. Turning it down does not soften the card, it darkens the sticker.
 *     `tier.subjectHolo` already grades it by rarity.
 *
 * Le liseré tracé autour du détourage a longtemps été le troisième intouchable,
 * pour la même raison : il séparait l'animal du décor. Il a fini par être
 * retiré — voir le bloc au-dessus de `styles`.
 */

type HoloCardProps = {
  /** Réduit uniquement la typographie quand la carte complète est montrée en miniature. */
  contentScale?: number;
  data: HoloCardData;
  /**
   * Ne dessine PAS le détourage, mais garde tout ce qui l'accompagne : son
   * ombre portée au sol, et sa texture dans le foil `sticker-holo`.
   *
   * Sert au sélecteur de rencontres, où c'est un `MorphView` qui rend l'animal
   * le temps du choix. Vider `stickerUrl` aurait suffi à ne pas le peindre —
   * et aurait emporté l'ombre et la tuile de foil avec lui, deux couches qui
   * ne dessinent pas l'animal mais qui ne veulent rien dire sans lui.
   */
  hideSubject?: boolean;
  /** Pointer drive: the card tilts under the finger and springs back. */
  interactive?: boolean;
  /** Atlas number, shown on the miniature where the full plate cannot fit. */
  number?: number;
  width: number;
};

/**
 * The two cards are two components, and the choice is made before either one
 * renders. That is the whole point of this function.
 *
 * A card below COMPACT_BELOW shows no foil, cannot be tilted, and carries no
 * gesture — but while it was one component with `compact` branches inside, it
 * still had to BUILD all of that on the way to deciding not to draw it: three
 * spring engines' worth of shared values, a pointer gesture, eight derived
 * values, an animated style. Hooks cannot be skipped, so the only way not to
 * pay for them is not to enter the component that calls them.
 *
 * That cost is per cell, and the collection grid mounts and tears down a
 * screenful at a time as it recycles. It is why the discovered cards came back
 * white on the way up the list while the locked slots beside them — plain
 * views, no hooks — never did.
 */
export function HoloCard(props: HoloCardProps) {
  return props.width < COMPACT_BELOW ? <CompactCard {...props} /> : <FullCard {...props} />;
}

/**
 * The miniature: a coloured box, two images and the mastery stars.
 *
 * Deliberately nothing else. No Skia, no Reanimated, no gesture handler, no
 * hook that allocates — so mounting one is the same work as mounting the
 * locked slot next to it, which is the only reason a fling through the grid
 * can keep up.
 */
const CompactCard = memo(function CompactCard({ data, width }: HoloCardProps) {
  const { height, radius } = cardMetrics(width);
  const rarity = cardRarity(data);
  const ready = data.status === 'ready' || data.status === 'needs_review';
  const tier = tierFor(ready ? rarity : undefined);
  const identity = identityFor(data);
  const portrait = useMemo(() => portraitRectFor(width), [width]);
  // La miniature tire la VIGNETTE : c'est elle qui peuple la grille, donc elle
  // qui paie le suréchantillonnage à chaque cellule montée.
  const thumbUrl = cardSceneFor(data.scientificName, ready ? rarity : undefined, {
    sceneSlug: data.sceneSlug,
    size: 'grid',
  });
  // Repli sur la pleine planche si la vignette n'existe pas encore — voir
  // `fullSceneFrom`. `null` tant qu'aucune erreur n'est survenue.
  const [failedSceneThumb, setFailedSceneThumb] = useState<string | null>(null);
  const sceneUrl = thumbUrl && failedSceneThumb === thumbUrl ? fullSceneFrom(thumbUrl) : thumbUrl;
  // Le détourage réduit quand il existe. Repli sur l'entier pour les captures
  // antérieures au vignettage — l'affichage est identique, seule la mémoire
  // change (0,6 Mo contre 7,8).
  const [failedStickerThumb, setFailedStickerThumb] = useState<string | null>(null);
  const stickerUrl =
    data.stickerThumbUrl && failedStickerThumb !== data.stickerThumbUrl
      ? data.stickerThumbUrl
      : data.stickerUrl;
  const stickerIsThumb = stickerUrl === data.stickerThumbUrl;
  const stickerCacheKey = data._id
    ? `${data._id}:sticker-${stickerIsThumb ? 'thumb' : 'full'}`
    : stickerUrl ?? undefined;

  // Le style, lui, reste mémoïsé : les deux moteurs le comparent en surface,
  // et un objet neuf à chaque rendu relance une mise en page pour rien.
  //
  // Le cache du sticker porte l'identifiant de capture plutôt que l'URL signée,
  // qui change à chaque re-signature.
  const stickerStyle = useMemo(
    () => ({
      height: portrait.height,
      left: portrait.x,
      position: 'absolute' as const,
      top: portrait.y,
      width: portrait.width,
    }),
    [portrait],
  );
  // A ready card always shows stars, even before its observation days have
  // been counted — same fallback the full card uses, so a tile and the card it
  // opens into never disagree about the level.
  const mastery = ready
    ? (data.mastery ?? {
        daysToNextLevel: 1,
        level: 1,
        levelStartDays: 1,
        nextLevelDays: 2,
        observationDays: 1,
      })
    : undefined;

  return (
    <View
      accessible
      accessibilityLabel={ready ? (speciesName(data) ?? data.scientificName) : CARD_TEXT[uiLanguage()].identifying}
      accessibilityRole="image"
      style={[
        styles.body,
        {
          // The card's own colour, and the one thing here that cannot fail to
          // paint: it is what stands in for the card until the artwork lands.
          backgroundColor: identity.body[1],
          experimental_backgroundImage: `linear-gradient(${identity.bodyAngle}deg, ${identity.body.join(', ')})`,
          borderColor: tier.accent,
          borderWidth: frameWidthFor(tier, width),
          borderRadius: radius,
          height,
          width,
        },
      ]}
    >
      {/* A bundled asset — already on the device, so no transition: a local
          file fading in only looks like a download. */}
      {sceneUrl ? (
        <SceneImage
          cachePolicy={sceneUrl === thumbUrl ? 'memory-disk' : 'disk'}
          fit="cover"
          // La vignette manque encore pour cette espèce : on retombe sur la
          // pleine planche plutôt que de laisser la carte vide.
          onError={() => {
            if (thumbUrl) setFailedSceneThumb(thumbUrl);
          }}
          style={StyleSheet.absoluteFill}
          uri={sceneUrl}
        />
      ) : null}
      {/* The full card's two type scrims, native gradients rather than Skia.
          If the platform ever declines them what is lost is a scrim, not the
          card — the body colour underneath is a plain background. */}
      <View
        pointerEvents="none"
        style={[
          styles.scrimTop,
          { experimental_backgroundImage: `linear-gradient(180deg, ${tier.onAccent}cc, ${tier.onAccent}00)` },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.scrimBottom,
          { experimental_backgroundImage: `linear-gradient(180deg, ${tier.onAccent}00, ${tier.onAccent}e0)` },
        ]}
      />
      {stickerUrl ? (
        <SceneImage
          cacheKey={stickerCacheKey}
          cachePolicy={stickerIsThumb ? 'memory-disk' : 'disk'}
          fit="contain"
          // Vide la vue quand la cellule reçoit une autre carte, pour qu'un
          // emplacement recyclé ne montre jamais l'animal précédent l'espace
          // d'une image.
          onError={() => {
            if (data.stickerThumbUrl) setFailedStickerThumb(data.stickerThumbUrl);
          }}
          style={stickerStyle}
          uri={stickerUrl}
        />
      ) : null}
      {mastery ? (
        <View style={[styles.overlay, { padding: Math.max(4, Math.round(width * 0.045) * 0.8) }]}>
          <View style={styles.miniMastery}>
            <MasteryStars mastery={mastery} size={Math.max(8, width * 0.115)} />
          </View>
        </View>
      ) : null}
    </View>
  );
});

function FullCard({
  contentScale = 1,
  data,
  hideSubject = false,
  interactive = true,
  number,
  width,
}: HoloCardProps) {
  const { theme } = useUnistyles();
  const height = width / CARD_RATIO;
  const rarity = cardRarity(data);
  const ready = data.status === 'ready' || data.status === 'needs_review';
  const mastery = ready
    ? (data.mastery ?? {
        daysToNextLevel: 1,
        level: 1,
        levelStartDays: 1,
        nextLevelDays: 2,
        observationDays: 1,
      })
    : undefined;
  const masteryLevel = mastery?.level;
  const tier = tierFor(ready ? rarity : undefined);

  const species = data.scientificName ?? data.commonName ?? 'unidentified';
  const identity = identityFor(data);
  const effectKey = effectKeyFor({ rarity: ready ? rarity : undefined, species });
  const Effect = components[effectKey] ?? fallbackEffect;

  const { gesture, rotateX, rotateY, uniforms } = useCardFx({
    height,
    // A grid card has no gesture on it and no foil to drive. Its springs would
    // still hold three frame callbacks open, and a screenful of cards being
    // recycled opens and closes those dozens of times a second.
    live: interactive,
    seedKey: species,
    width,
  });
  // Cached across mounts, and decoded to the size this card draws at — see
  // `card-image.ts`. Nothing here is ever drawn wider than the card itself.
  const artworkEdge = PixelRatio.getPixelSizeForLayoutSize(height);
  const sceneUrl = cardSceneFor(data.scientificName, ready ? rarity : undefined, {
    sceneSlug: data.sceneSlug,
  });
  // Grid cards use expo-image below: it owns a persistent disk cache and does
  // not restart a Skia decode whenever LegendList recycles a cell. The full
  // card keeps Skia images because its mask, rim and foil need SkImage values.
  // Bundled onboarding art is already local. Rendering it through expo-image
  // avoids asking thirty Skia canvases to decode the same twelve files at once.
  const image = useCardImage(data.stickerAsset ? null : data.stickerUrl, artworkEdge);
  const scene = useCardImage(data.sceneAsset ? null : sceneUrl, artworkEdge);

  const inset = Math.round(width * 0.045);
  const portrait = useMemo(() => portraitRectFor(width), [width]);
  // The foil's colour, read off the card itself — see `tintMatrix`.
  const foilMatrix = useMemo(() => tintMatrix(identity.glow, SUBTLETY.foilTint), [identity.glow]);

  // The rotator: CSS rotateY(--rotate-x) rotateX(--rotate-y), 600px
  // perspective — the axis swap is the original's, don't "fix" it.
  const tiltStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 600 }, { rotateY: `${rotateX.get()}deg` }, { rotateX: `${rotateY.get()}deg` }],
  }));

  const radius = cardMetrics(width).radius;
  const language = currentLanguage();
  const group = animalGroupName(data.taxonomy, language);
  const masteryLabel =
    masteryLevel && mastery ? <MasteryStars interactive={interactive} mastery={mastery} size={13} /> : null;
  const footer = data.taxonomy?.family ?? '';

  // The body gradient runs along the realm's angle: vertical sky for birds,
  // near-horizontal water for fish, diagonals for fur and scales.
  const bodyLine = useMemo(() => {
    const rad = ((identity.bodyAngle - 90) * Math.PI) / 180;
    const r = Math.sqrt(width * width + height * height) / 2;
    const cx = width / 2;
    const cy = height / 2;
    return {
      start: { x: cx - Math.cos(rad) * r, y: cy - Math.sin(rad) * r },
      end: { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r },
    };
  }, [height, identity.bodyAngle, width]);

  // The card is a Skia canvas plus absolutely-positioned text, which VoiceOver
  // reads as scattered fragments — or, for the canvas, not at all. One label on
  // the container speaks the card as a sentence, the way a sighted player reads
  // it in a glance.
  const spokenLabel = ready
    ? [
        speciesName(data),
        data.scientificName,
        tier.label.toLowerCase(),
        group !== 'ANIMALIA' ? `${CARD_TEXT[uiLanguage()].class} ${group}` : '',
        masteryLevel ? `${CARD_TEXT[uiLanguage()].mastery} ${masteryLevel}` : '',
      ]
        .filter(Boolean)
        .join(', ')
    : CARD_TEXT[uiLanguage()].identifying;

  const face = (
    <Animated.View style={[{ height, width }, interactive && tiltStyle]}>
      <View
        accessible
        accessibilityLabel={spokenLabel}
        accessibilityRole="image"
        style={[
          styles.body,
          {
            backgroundColor: tier.base,
            borderColor: tier.accent,
            // Rarity's whole voice now that the stars belong to mastery: a
            // legendary is a card you pick out of a grid without reading it.
            borderWidth: frameWidthFor(tier, width),
            borderRadius: radius,
            height,
            width,
          },
        ]}
      >
        {data.sceneAsset ? (
          <ExpoImage
            cachePolicy="memory-disk"
            contentFit="cover"
            pointerEvents="none"
            source={data.sceneAsset}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
          {/* The painted card body — this animal's own colour, dyed like a
              printed energy card, running along its realm's angle. */}
          {!data.sceneAsset ? <Fill color={identity.body[2]} /> : null}
          {!data.sceneAsset ? (
            <Rect x={0} y={0} width={width} height={height}>
              <LinearGradient start={bodyLine.start} end={bodyLine.end} colors={identity.body} />
            </Rect>
          ) : null}
          {scene ? <SkiaImage image={scene} x={0} y={0} width={width} height={height} fit="cover" /> : null}
          {/* The halo the subject stands in front of. */}
          <Rect x={0} y={0} width={width} height={height}>
            <RadialGradient
              c={{
                x: portrait.x + portrait.width / 2,
                y: portrait.y + portrait.height / 2,
              }}
              r={portrait.height * 0.8}
              colors={[`${identity.glow}66`, `${identity.glow}00`]}
            />
          </Rect>

          {/* Short scrims behind the type only. */}
          <Rect x={0} y={0} width={width} height={height * 0.2}>
            <LinearGradient
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: height * 0.2 }}
              colors={[`${tier.onAccent}cc`, `${tier.onAccent}00`]}
            />
          </Rect>
          <Rect x={0} y={height * 0.7} width={width} height={height * 0.3}>
            <LinearGradient
              start={{ x: 0, y: height * 0.7 }}
              end={{ x: 0, y: height }}
              colors={[`${tier.onAccent}00`, `${tier.onAccent}e0`]}
            />
          </Rect>

          {(data.sceneAsset ?? scene) && (data.stickerAsset ?? image) ? (
            <Group
              layer={
                <Paint>
                  <Blur blur={width * 0.018} />
                </Paint>
              }
              opacity={0.5}
            >
              <Oval
                x={portrait.x + portrait.width * 0.2}
                y={portrait.y + portrait.height * 0.79}
                width={portrait.width * 0.6}
                height={portrait.height * 0.11}
                color="#4b2138"
              />
            </Group>
          ) : null}

          {/* The real Pokémon holo: shine + glare surfaces from the CSS port,
              stacked over the whole card exactly as on the printed originals.
              The energy type modulates the effects that read it, like print.
              `img` is the die-cut animal: only `sticker-holo` reads it, as the
              tile of its foil, in the place the 151 set puts a Poké Ball. */}
          {/* `layer`, not a bare `opacity` prop: this composites the whole
              effect stack once, as its own isolated surface, so neither the
              damping nor the tint can reach a sibling drawn after it — the
              animal. The tint is what makes the foil belong to the picture:
              the CSS port's rainbow is bent toward this card's own light. */}
          <Group
            layer={
              <Paint opacity={SUBTLETY.effect}>
                <ColorMatrix matrix={foilMatrix} />
              </Paint>
            }
          >
            <Effect img={image ?? undefined} u={uniforms} types={[identity.energyType]} />
          </Group>

          {/* The animal is drawn LAST, over the whole foil stack. Every
              layer above it is a blend — the glare alone runs an `overlay`
              whose far stop is rgba(0,0,0,0.75) — so anything painted on
              top of the die-cut takes light off it. On a printed card that
              is fine, the foil sits under the ink. Here the animal IS the
              card: it stays readable whatever the effect does. */}
          {image && !hideSubject ? (
            <SkiaImage
              image={image}
              x={portrait.x}
              y={portrait.y}
              width={portrait.width}
              height={portrait.height}
              fit="contain"
            />
          ) : null}

          {/* The animal catches the light — and this is the layer that has to
              be handled with tongs, because it is the ONLY thing drawn over the
              die-cut, so whatever it does to contrast is what the player sees.
              Two blends were tried and both destroyed the subject:
                colorDodge — base / (1 - blend). Against a bright foil it runs to
                  pure white: a white flamingo burned to 255 and vanished into a
                  pale scene.
                overlay — a light layer at a third strength across the whole
                  animal flattens its range. The eagle came out a washed slab
                  and read as semi-transparent.
              softLight is the one built for this: it bends values toward the
              blend colour without ever clipping them, so a dark eagle keeps its
              feathers, a white flamingo keeps its edges, and both still take
              the tint as the card turns. */}
        </Canvas>

        {data.stickerAsset && !hideSubject ? (
          <ExpoImage
            contentFit="contain"
            pointerEvents="none"
            source={data.stickerAsset}
            style={{
              height: portrait.height,
              left: portrait.x,
              position: 'absolute',
              top: portrait.y,
              width: portrait.width,
            }}
          />
        ) : null}

        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="box-none"
          style={[styles.overlay, { padding: inset * 1.4 }]}
        >
          <>
              <View pointerEvents="none" style={styles.header}>
                <View style={styles.headerText}>
                  <Text
                    style={[
                      styles.group,
                      {
                        color: tier.accent,
                        fontSize: 10 * contentScale,
                        letterSpacing: 1.6 * contentScale,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {group.toUpperCase()}
                  </Text>
                  <Text
                    style={[
                      styles.name,
                      {
                        fontFamily: theme.fonts.display,
                        fontSize: width * 0.095 * contentScale,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {ready ? (speciesName(data) ?? data.scientificName) : 'Identification…'}
                  </Text>
                  <Text
                    style={[
                      styles.scientific,
                      { fontFamily: theme.fonts.regular, fontSize: 11 * contentScale },
                    ]}
                    numberOfLines={1}
                  >
                    {ready ? (data.scientificName ?? '') : 'BioCLIP 2 analyse la capture'}
                  </Text>
                </View>
              </View>

              <View pointerEvents="none" style={{ height: portrait.height }} />

              <View pointerEvents="box-none" style={[styles.plate, { gap: 6 * contentScale }]}>
                {/* The card's rarity — the species' own, the same for every player
                on earth, which is what makes a card worth showing to someone.
                Il n'y a plus qu'un axe : la rareté de rencontre locale a été
                retirée de l'app (voir `cardRarity`), elle mentait dès qu'on
                photographiait en captivité. */}
                <View pointerEvents="box-none" style={styles.plateTop}>
                  <View
                    pointerEvents="none"
                    style={[
                      styles.rarityPill,
                      {
                        borderColor: tier.accent,
                        paddingHorizontal: 10 * contentScale,
                        paddingVertical: 5 * contentScale,
                      },
                    ]}
                  >
                    {/* The stars that used to sit here counted the rarity. They
                        count mastery now, on the other side of this row — the
                        frame carries the rarity, and one symbol cannot mean two
                        things on the same card. */}
                    <Text
                      style={[
                        styles.rarityText,
                        {
                          color: tier.accent,
                          fontFamily: theme.fonts.bold,
                          fontSize: 10 * contentScale,
                          letterSpacing: 1.2 * contentScale,
                        },
                      ]}
                    >
                      {tier.label}
                    </Text>
                  </View>
                  {masteryLevel ? <View style={styles.masteryLockup}>{masteryLabel}</View> : null}
                </View>
                {footer ? (
                  <Text
                    pointerEvents="none"
                    style={[
                      styles.footer,
                      { fontFamily: theme.fonts.medium, fontSize: 12 * contentScale },
                    ]}
                    numberOfLines={2}
                  >
                    {footer}
                  </Text>
                ) : null}
                <Text
                  pointerEvents="none"
                  style={[
                    styles.source,
                    {
                      fontFamily: theme.fonts.bold,
                      fontSize: 8 * contentScale,
                      letterSpacing: 1.1 * contentScale,
                    },
                  ]}
                >
                  {(data.captureSource === 'library' ? CARD_TEXT[uiLanguage()].imported : CARD_TEXT[uiLanguage()].field) +
                    (identity.reason ? ` · ${identity.reason.toUpperCase()}` : '')}
                </Text>
              </View>
          </>
        </View>
      </View>
      {/* Outside the body, not inside it: the body clips (`overflow: 'hidden'`)
          and the neon's whole point is a glow that spills past the edge. Inside
          the rotator, though, so the frame tilts with the card it belongs to.

          `showQuietTiers` suit `interactive`, qui n'est vrai que sur la carte
          ouverte : commun et peu commun y portent leur néon, alors que la
          grille — vingt vignettes à la fois — les garde nus. */}
      <RarityAura
        identity={identity}
        radius={radius}
        showQuietTiers={interactive}
        tier={tier}
        width={width}
      />
    </Animated.View>
  );

  if (!interactive) return face;
  return <GestureDetector gesture={gesture}>{face}</GestureDetector>;
}

/*
 * LE LISERÉ A ÉTÉ RETIRÉ, ET C'ÉTAIT UN CHOIX ASSUMÉ.
 *
 * `RimLight` dilatait le détourage et remplissait l'anneau du dégradé
 * holographique. Il tenait un vrai rôle — séparer l'animal du décor, pour qu'un
 * flamant pâle ne se dissolve pas dans un lagon pâle — mais il chargeait la
 * carte, et sur la grande majorité des captures il se voyait plus qu'il ne
 * servait. Décision de l'auteur, prise en connaissance du risque.
 *
 * Si un animal pâle finit par disparaître dans sa scène, la réponse n'est pas
 * de rendre l'anneau : c'est d'assombrir la scène derrière lui.
 *
 * L'anneau était le SEUL consommateur de `identity.softHolo`, de
 * `cardSceneHoloFor` et de la direction de lumière `gradientStart/End` — tout
 * ça est parti avec lui.
 */
const styles = StyleSheet.create({
  body: {
    overflow: 'hidden',
    borderWidth: 2,
  },
  // The canvas' `Rect(0, 0, w, h*0.2)` and `Rect(0, h*0.7, w, h*0.3)`.
  scrimTop: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    height: '20%',
  },
  scrimBottom: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: '30%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  headerText: {
    flex: 1,
  },
  group: {
    fontSize: 10,
    letterSpacing: 1.6,
    fontWeight: '700',
  },
  name: {
    marginTop: 3,
    color: '#fffdf6',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 4,
  },
  scientific: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontStyle: 'italic',
  },
  plate: {
    gap: 6,
  },
  rarityPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  plateTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  masteryLockup: {
    alignItems: 'flex-end',
  },
  rarityText: {
    fontSize: 10,
    letterSpacing: 1.2,
  },
  miniMastery: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    gap: 3,
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 3,
  },
  stars: {
    fontSize: 9,
    letterSpacing: 1,
  },
  plateCompact: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  numberCompact: {
    color: 'rgba(255,255,255,0.62)',
    letterSpacing: 0.5,
  },
  footer: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 12,
  },
  source: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 8,
    letterSpacing: 1.1,
  },
});
