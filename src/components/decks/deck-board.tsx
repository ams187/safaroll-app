// Le plateau de deck, en lecture seule.
//
// C'est le même objet que celui de la collection — cadre parchemin, les cinq
// numéros en boutons Clash avec leur pointeur, le titre, les huit
// emplacements — mais sans rien de ce qui le rend éditable : pas de drag, pas
// de tri, pas de mesure de zone de drop. Un deck qu'on visite ne se réarrange
// pas.
//
// Il partage la géométrie (`deckSlotMetrics`) et la palette (`CLASH`) avec la
// version éditable, donc les deux plateaux ne peuvent pas dériver l'un de
// l'autre : un slot fait la même taille et un coin le même arrondi des deux
// côtés de l'app.

import { HoloCard, type HoloCardData } from '@/components/cards/holo-card';
import { Press3D, PRESS_DEPTH } from '@/components/ui/press-3d';
import { CLASH } from '@/lib/clash-palette';
import { SymbolView } from 'expo-symbols';
import { useRef, type RefObject } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import {
  DECK_COLUMNS,
  DECK_GAP,
  DECK_SLOT_COUNT,
  DECK_TAB_GAP,
  DECK_TAB_HEIGHT,
} from './deck-slot-geometry';
import { deckSlotMetrics } from './sortable-deck-grid';

const SECTION_MARGIN = 0;
const SECTION_BORDER = 3;
const SECTION_PADDING = 12;
const SECTION_RADIUS = 20;

export type DeckBoardDeck = { cards: HoloCardData[]; name: string };

export function DeckBoard({
  activeIndex,
  decks,
  onEnlarge,
  onSelect,
  width,
}: {
  activeIndex: number;
  decks: DeckBoardDeck[];
  /**
   * Ouvre la carte en grand. Reçoit la vue de la carte, parce que la
   * transition la MESURE pour savoir d'où voler — un ref au `current` nul et
   * la carte ne s'ouvre jamais.
   */
  onEnlarge?: (card: HoloCardData, cardRef: RefObject<View | null>) => void;
  onSelect: (index: number) => void;
  /** Largeur extérieure du plateau, bordure comprise. */
  width: number;
}) {
  const gridWidth = width - (SECTION_BORDER + SECTION_PADDING) * 2;
  const metrics = deckSlotMetrics(gridWidth);
  const deck = decks[activeIndex];

  return (
    <View style={[styles.section, { width }]}>
      {/* Un onglet par deck publié — jamais cinq : les quatre autres seraient
          des portes vers rien chez quelqu'un qui n'en a publié qu'un. */}
      {decks.length > 1 ? (
        <View style={styles.tabBar}>
          <View style={styles.tabs}>
            {decks.map((item, index) => {
              const selected = index === activeIndex;
              return (
                <Press3D
                  accessibilityLabel={`Deck ${index + 1}`}
                  borderRadius={11}
                  faceStyle={[styles.tab, selected ? styles.tabSelected : null]}
                  key={item.name + index}
                  onPress={() => onSelect(index)}
                  selected={selected}
                  shadowColor={selected ? CLASH.tabLipOn : CLASH.tabLip}
                  style={styles.tabSlot}
                >
                  <Text style={styles.tabText}>{index + 1}</Text>
                  {selected ? <View style={styles.tabPointer} /> : null}
                </Press3D>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.heading}>
        <Text style={styles.eyebrow}>DECK {activeIndex + 1}</Text>
        <Text numberOfLines={1} style={styles.title}>
          {deck?.name ?? `Deck ${activeIndex + 1}`}
        </Text>
      </View>

      <View style={[styles.grid, { gap: DECK_GAP }]}>
        {Array.from({ length: DECK_SLOT_COUNT }, (_, index) => {
          const card = deck?.cards[index];
          return card ? (
            // La même face de carte que le deck éditable (`SortableDeckGrid` →
            // `HoloCard`), pas une tuile approchante : un deck visité doit être
            // indistinguable du sien, au pixel.
            <BoardCard
              card={card}
              key={card._id ?? index}
              onEnlarge={onEnlarge}
              width={metrics.width}
            />
          ) : (
            <View
              key={`empty-${index}`}
              style={[
                styles.empty,
                {
                  borderRadius: metrics.radius,
                  height: metrics.height,
                  width: metrics.width,
                },
              ]}
            >
              <SymbolView name="minus" size={13} tintColor="rgba(255,255,255,0.4)" />
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Une carte du plateau. Elle existe pour posséder un ref : la transition
 * d'ouverture mesure la vue de la carte pour savoir d'où la faire voler,
 * exactement comme `DeckSlotCard` dans le deck éditable.
 */
function BoardCard({
  card,
  onEnlarge,
  width,
}: {
  card: HoloCardData;
  onEnlarge?: (card: HoloCardData, cardRef: RefObject<View | null>) => void;
  width: number;
}) {
  const cardRef = useRef<View | null>(null);
  const face = (
    <View collapsable={false} ref={cardRef}>
      <HoloCard data={card} interactive={false} width={width} />
    </View>
  );
  if (!onEnlarge) return face;
  return (
    <Pressable accessibilityRole="button" onPress={() => onEnlarge(card, cardRef)}>
      {face}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    marginHorizontal: SECTION_MARGIN,
    borderRadius: SECTION_RADIUS,
    borderWidth: SECTION_BORDER,
    borderColor: CLASH.deckFrame,
    paddingHorizontal: SECTION_PADDING,
    paddingTop: 8,
    paddingBottom: 14,
  },
  tabBar: {
    paddingTop: 4,
    // De la place pour que le pointeur du deck ouvert dépasse dessous.
    paddingBottom: 20,
    marginBottom: 6,
  },
  tabs: {
    flexDirection: 'row',
    gap: DECK_TAB_GAP,
    // L'ombre pend PRESS_DEPTH sous chaque face sans être dans le flux : la
    // rangée doit réserver cette hauteur ou la grille s'assoit dessus.
    marginBottom: PRESS_DEPTH,
  },
  tabSlot: {
    flex: 1,
  },
  tab: {
    height: DECK_TAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: CLASH.tabLip,
    backgroundColor: CLASH.tabFace,
  },
  tabSelected: {
    borderColor: CLASH.tabLipOn,
    backgroundColor: CLASH.tabFaceOn,
  },
  tabPointer: {
    position: 'absolute',
    bottom: -13,
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: CLASH.tabFaceOn,
  },
  tabText: {
    color: CLASH.tabInk,
    fontFamily: theme.fonts.display,
    fontSize: 19,
  },
  heading: {
    marginBottom: 10,
  },
  eyebrow: {
    color: theme.colors.primaryText,
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    letterSpacing: 1.7,
  },
  title: {
    marginTop: 2,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 24,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  // Le même trou percé dans le plateau que dans la version éditable, moins le
  // « + » : il n'y a rien à ajouter dans le deck de quelqu'un d'autre.
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: CLASH.slotWellEdge,
    borderStyle: 'dashed',
    backgroundColor: CLASH.slotWell,
  },
}));

export { DECK_COLUMNS };
