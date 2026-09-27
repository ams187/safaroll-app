import { useTranslation as useUiTranslation } from 'react-i18next';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { cardRarity, frameWidthFor, tierFor } from '@/lib/animals/rarity';
import { identityFor } from './card-identity';
import { speciesName } from '@/lib/animals/species-name';

import { cardSceneFor, fullSceneFrom } from './card-scenes';
import { SceneImage } from './scene-image';
import { cardMetrics, COMPACT_BELOW, type HoloCardData } from './holo-card';
import { MasteryStars } from './mastery-stars';

/**
 * The small card used in the deck row and the collection grid. Same rarity
 * language as the full card — frame, plate and stars — but no canvas and no
 * shader, so a screenful of them stays at 60fps.
 */
type CardTileProps = {
  data?: HoloCardData;
  light?: boolean;
  locked?: boolean;
  lockedShape?: SFSymbol;
  lockedHint?: string;
  number?: number;
  onPress?: (stickerRef: React.RefObject<View | null>) => void;
  width: number;
};

export function CardTile(props: CardTileProps) {
  return props.locked ? <LockedCardTile {...props} /> : <UnlockedCardTile {...props} />;
}

function LockedCardTile({ lockedHint, lockedShape, number, width }: CardTileProps) {
  const { t: copy } = useUiTranslation();
  const tier = tierFor(undefined);
  const { height, radius } = cardMetrics(width);
  const silent = width < COMPACT_BELOW;
  const wellColor = tier.holo[Math.floor(tier.holo.length / 2)];

  return (
    <View
      accessible
      accessibilityLabel={copy("ui_copy_103")}
      style={[
        styles.frame,
        {
          backgroundColor: tier.accent,
          borderColor: tier.onAccent,
          borderWidth: frameWidthFor(tier, width),
          borderRadius: radius,
          height,
          width,
        },
        styles.frameLocked,
      ]}
    >
      <View style={[styles.well, { backgroundColor: tier.base }]} />
      <View style={[styles.wellTint, { backgroundColor: wellColor }]} />
      <View style={[styles.sheen, { backgroundColor: tier.holo[0] }]} />
      <View collapsable={false} style={styles.art}>
        <SymbolView
          name={lockedShape ?? 'pawprint.fill'}
          size={width * 0.42}
          tintColor="rgba(255,255,255,0.14)"
          type="hierarchical"
        />
      </View>
      {silent ? null : (
        <View style={[styles.plate, { backgroundColor: tier.onAccent }]}>
          <Text
            numberOfLines={1}
            style={[styles.name, { color: '#fff8e8', fontSize: Math.max(9, width * 0.1) }]}
          >
            {lockedHint ?? '???'}
          </Text>
        </View>
      )}
      {number !== undefined && !silent ? (
        <Text style={styles.number}>{`#${String(number).padStart(3, '0')}`}</Text>
      ) : null}
    </View>
  );
}

function UnlockedCardTile({
  data,
  light,
  number,
  onPress,
  width,
}: CardTileProps) {
  /**
   * Drop the two decoded images and keep everything else. A screenful of tiles
   * is eight `expo-image` decodes per row; skipping them while the grid is
   * being flung is the difference between a smooth fling and a stuttering one.
   * Layout is untouched on purpose — a light tile that measured differently
   * would make the list correct positions mid-scroll.
   */
  // Each tile owns the ref to its own animal — that is what flies to the card.
  const stickerRef = useRef<View | null>(null);
  const tier = tierFor(cardRarity(data));
  // The frame says the rarity; the well says which card this is. Same per-card
  // body colour as the full card, so a tile and its detail view match.
  const identity = data ? identityFor(data) : undefined;
  const wellColor = identity?.body[1] ?? tier.holo[Math.floor(tier.holo.length / 2)];
  const sheenColor = identity?.glow ?? tier.holo[0];
  // Une tuile ne dépasse jamais la taille d'une cellule de grille : elle tire
  // donc la vignette, comme la miniature. Voir `cardSceneFor`.
  const [failedSceneThumb, setFailedSceneThumb] = useState<string | null>(null);
  // Idem : le détourage réduit s'il existe, l'entier sinon.
  const [failedStickerThumb, setFailedStickerThumb] = useState<string | null>(null);
  const stickerUrl =
    data?.stickerThumbUrl && failedStickerThumb !== data.stickerThumbUrl
      ? data.stickerThumbUrl
      : data?.stickerUrl;
  const stickerIsThumb = stickerUrl === data?.stickerThumbUrl;
  const stickerCacheKey = data?._id
    ? `${data._id}:sticker-${stickerIsThumb ? 'thumb' : 'full'}`
    : stickerUrl ?? undefined;
  const thumbSource =
    !data || light
      ? undefined
      : cardSceneFor(data.scientificName, cardRarity(data), {
          sceneSlug: data.sceneSlug,
          size: 'grid',
        });
  const sceneSource =
    thumbSource && failedSceneThumb === thumbSource ? fullSceneFrom(thumbSource) : thumbSource;
  const { height, radius } = cardMetrics(width);
  // Same rule as the full card: below this width a tile carries no type at
  // all. It stands in for the miniature during fast scrolls, so a name here
  // would flash in and out as the list speeds up and settles.
  const silent = width < COMPACT_BELOW;
  const ready = data?.status === 'ready' || data?.status === 'needs_review';
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
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={speciesName(data) ?? data?.scientificName}
      disabled={!onPress}
      onPress={() => onPress?.(stickerRef)}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <View
        style={[
          styles.frame,
          {
            // The rarity colour IS the tile — a grid of dark rectangles reads
            // as one grey block from arm's length.
            backgroundColor: tier.accent,
            borderColor: tier.onAccent,
            borderWidth: frameWidthFor(tier, width),
            borderRadius: radius,
            height,
            width,
          },
        ]}
      >
        <View style={[styles.well, { backgroundColor: tier.base }]} />
        {sceneSource ? (
          <SceneImage
            cachePolicy={sceneSource === thumbSource ? 'memory-disk' : 'disk'}
            fit="cover"
            onError={() => {
              if (thumbSource) setFailedSceneThumb(thumbSource);
            }}
            style={styles.scene}
            uri={sceneSource}
          />
        ) : null}
        <View
          style={[
            styles.wellTint,
            { backgroundColor: wellColor },
            sceneSource ? styles.sceneTint : undefined,
          ]}
        />
        <View style={[styles.sheen, { backgroundColor: sheenColor }]} />

        <View collapsable={false} ref={stickerRef} style={styles.art}>
          {light || !stickerUrl ? (
            <SymbolView
              name="pawprint.fill"
              size={width * 0.42}
              tintColor="rgba(255,255,255,0.14)"
              type="hierarchical"
            />
          ) : (
            <SceneImage
              cacheKey={stickerCacheKey}
              cachePolicy={stickerIsThumb ? 'memory-disk' : 'disk'}
              fit="contain"
              onError={() => {
                if (data?.stickerThumbUrl) setFailedStickerThumb(data.stickerThumbUrl);
              }}
              style={styles.image}
              uri={stickerUrl}
            />
          )}
        </View>

        {silent ? null : (
          <View style={[styles.plate, { backgroundColor: tier.onAccent }]}>
            <Text
              numberOfLines={1}
              style={[styles.name, { color: '#fff8e8', fontSize: Math.max(9, width * 0.1) }]}
            >
              {/* `speciesName` et non `commonName` : `commonName` est la colonne
                  ANGLAISE. La grande carte passait par la chaîne de langue, la
                  tuile non — la même bête s'appelait « vice-roi » sur la carte
                  ouverte et « Viceroy » dans le deck, le musée et l'année
                  sauvage. */}
              {speciesName(data) ?? data?.scientificName ?? '…'}
            </Text>
          </View>
        )}

        {mastery ? (
          <View style={[styles.mastery, !silent && styles.masteryAbovePlate]}>
            <MasteryStars mastery={mastery} size={Math.max(8, width * 0.115)} />
          </View>
        ) : null}
        {number !== undefined && !silent ? (
          <Text style={styles.number}>{`#${String(number).padStart(3, '0')}`}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create(() => ({
  pressed: {
    transform: [{ scale: 0.96 }],
  },
  frame: {
    overflow: 'hidden',
    borderWidth: 2,
    justifyContent: 'flex-end',
  },
  frameLocked: {
    opacity: 0.55,
  },
  sheen: {
    position: 'absolute',
    top: '-38%',
    right: '-30%',
    left: '-30%',
    height: '86%',
    opacity: 0.34,
    transform: [{ rotate: '-18deg' }],
  },
  well: {
    position: 'absolute',
    top: '6%',
    right: '7%',
    bottom: '20%',
    left: '7%',
    borderRadius: 6,
    opacity: 0.85,
  },
  wellTint: {
    position: 'absolute',
    top: '6%',
    right: '7%',
    bottom: '20%',
    left: '7%',
    borderRadius: 6,
    opacity: 0.42,
  },
  scene: {
    position: 'absolute',
    top: '6%',
    right: '7%',
    bottom: '20%',
    left: '7%',
    borderRadius: 6,
  },
  sceneTint: {
    opacity: 0.14,
  },
  art: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: '18%',
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '84%',
    height: '84%',
  },
  plate: {
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  name: {
    fontWeight: '800',
  },
  mastery: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    left: 4,
    gap: 2,
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 3,
  },
  masteryAbovePlate: {
    bottom: 30,
  },
  number: {
    position: 'absolute',
    top: 4,
    right: 6,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 8,
    fontVariant: ['tabular-nums'],
  },
}));
