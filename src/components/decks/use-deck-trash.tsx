import { useTranslation as useUiTranslation } from 'react-i18next';
// La poubelle du deck : ses signaux, et le calque qui la dessine.
//
// Elle est séparée de la grille pour une raison de peinture, pas de style. Le
// plateau vit dans l'en-tête d'une liste, et une poubelle rendue là-dedans se
// dispute le `zIndex` avec les rangées de la collection — que la liste emballe
// dans ses propres conteneurs, hors de notre portée. Elle passait dessous.
//
// Un calque de drag appartient donc à la RACINE de l'écran, au-dessus de tout,
// et il se repositionne à partir du bord bas du plateau mesuré au début de
// chaque portage. Le hook porte l'état, la grille s'y branche, l'écran dessine.
//
// Ce qu'elle n'est pas : un bouton, ni une affordance de l'appui long. Elle
// n'apparaît qu'en tirant une carte SOUS le plateau, progressivement — voir
// `onDragMove`. L'appui long sert d'abord à réordonner, et une corbeille qui
// monte au simple maintien dirait le contraire.

import { DeleteIconFont } from '@/components/ui/delete-button';
import type { Id } from '@/lib/supabase/api';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useRef } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import type { DragMoveCallback } from 'react-native-sortables';

import { binApproach, binLayout } from './deck-slot-geometry';

/**
 * De combien il faut tirer la carte SOUS le plateau pour que la poubelle soit
 * entièrement levée. Court exprès : passé le bord du deck, l'intention de
 * sortir la carte est déjà claire, et une révélation trop lente donnerait
 * l'impression que rien ne répond.
 */
const REVEAL_TRAVEL = 64;
/** L'écart entre le bas du plateau et le haut de la poubelle. Franc : posée
 *  juste dessous, elle se lirait comme une neuvième case du deck. */
/** L'indice, plus haut : il occupe le vide que la poubelle viendra prendre. */
const HINT_OFFSET = 18;

/**
 * L'apprentissage du geste.
 *
 * Tirer vers le bas ne s'annonce nulle part — un geste caché que rien ne
 * signale n'existe pas. Donc pendant le portage, et seulement pendant, une
 * ligne apparaît sous le plateau : « Glisse vers le bas pour retirer ». Elle
 * s'efface à mesure qu'on descend, parce que la poubelle prend le relais et
 * dit la même chose en mieux.
 *
 * Elle disparaît définitivement au premier retrait réussi : la phrase a été
 * lue, le geste est acquis. Et un plafond pour qui ne retire jamais rien —
 * cinq portages suffisent à avoir vu la ligne, au-delà c'est du bruit pour
 * quelqu'un qui ne fait que réordonner.
 */
const store = createMMKV({ id: 'deck-trash' });
const HINTS_KEY = 'hints';
const LEARNED_KEY = 'learned';
const MAX_HINTS = 5;

export type DeckTrash = ReturnType<typeof useDeckTrash>;

export function useDeckTrash(onRemove?: (captureId: Id<'animalCaptures'>) => void) {
  // Capturée comme simple nombre dans le worklet : la couche est pleine
  // largeur, donc c'est tout ce qu'il faut pour centrer la cible.
  const { width: screenWidth } = useWindowDimensions();
  // Trois signaux, tous sur le fil UI, aucun re-rendu : `reveal` la fait
  // monter, `proximity` entrouvre le couvercle à l'approche, `overBin` décide.
  const reveal = useSharedValue(0);
  const proximity = useSharedValue(0);
  const overBin = useSharedValue(0);
  // La TAILLE de la poubelle, pas sa position.
  //
  // Sa position se déduit : la couche est ancrée à `gridBottom + BIN_OFFSET`,
  // pleine largeur, contenu centré. La mesurer était le bug — `measureInWindow`
  // partait dans le même tick que celui du plateau, donc au premier portage
  // elle rendait la position d'une poubelle encore garée à `0 + BIN_OFFSET`,
  // en haut de l'écran. Le doigt ne la touchait jamais. Au portage suivant
  // `gridBottom` était connu d'avance, la poubelle était à sa place, et tout
  // marchait — d'où « elle ne s'ouvre qu'à la deuxième tentative ».
  //
  // La taille, elle, ne dépend d'aucune position : `onLayout` la donne une
  // fois au montage et elle ne bouge plus.
  const binSize = useSharedValue({ height: 0, width: 0 });
  const gridBottom = useSharedValue(0);
  // 1 pendant un portage qui mérite l'indice. Distinct de `reveal` : celui-ci
  // dit « on porte une carte », l'autre « on la descend ». Confondre les deux
  // ferait monter la poubelle au simple maintien.
  const hinting = useSharedValue(0);
  const gridRef = useRef<View | null>(null);

  const onDragStart = useCallback(() => {
    // Mesurés à CHAQUE début de portage, pas au montage : le deck vit dans
    // l'en-tête d'une liste qui défile, donc sa position d'écran change.
    gridRef.current?.measureInWindow((_x, y, _w, h) => {
      gridBottom.set(y + h);
    });

    const seen = store.getNumber(HINTS_KEY) ?? 0;
    if (!(store.getBoolean(LEARNED_KEY) ?? false) && seen < MAX_HINTS) {
      store.set(HINTS_KEY, seen + 1);
      hinting.set(1);
    }
  }, [gridBottom, hinting]);

  const onDragMove = useCallback<DragMoveCallback>(
    ({ touchData }) => {
      'worklet';
      const bottom = gridBottom.get();
      if (bottom === 0) return;

      // Zéro tant que le doigt est sur le plateau, 1 une fois `REVEAL_TRAVEL`
      // en dessous. Continu entre les deux : la poubelle se lève à la vitesse
      // où on la tire, elle ne surgit pas.
      const pulled = (touchData.absoluteY - bottom) / REVEAL_TRAVEL;
      reveal.set(Math.max(0, Math.min(1, pulled)));

      const size = binSize.get();
      if (size.width === 0) return;
      // Déduit, jamais mesuré : la couche occupe toute la largeur et centre son
      // contenu, donc x ne dépend que de la largeur de l'écran.
      const approach = binApproach(
        touchData.absoluteX,
        touchData.absoluteY,
        binLayout(bottom, screenWidth, size),
      );
      proximity.set(approach.proximity);
      overBin.set(approach.inside ? 1 : 0);
    },
    [binSize, gridBottom, overBin, proximity, reveal, screenWidth],
  );

  // Le couvercle qui s'ouvre ne suffit pas : la main doit le SENTIR au moment
  // où lâcher changerait de sens.
  useAnimatedReaction(
    () => overBin.get(),
    (now, before) => {
      if (now === 1 && before === 0) {
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      }
    },
  );

  const settle = useCallback(() => {
    reveal.set(0);
    proximity.set(0);
    overBin.set(0);
    hinting.set(0);
  }, [hinting, overBin, proximity, reveal]);

  /** Le geste vient d'être exécuté : la phrase n'a plus rien à apprendre. */
  const markLearned = useCallback(() => {
    store.set(LEARNED_KEY, true);
  }, []);

  // Lâchée sur la poubelle, la carte ne doit PAS revoler vers son slot — elle
  // vient d'être jetée. Durée de dépose nulle dans ce cas précis.
  const dropAnimationDuration = useDerivedValue<number>(() => (overBin.get() === 1 ? 0 : 300));

  return useMemo(
    () => ({
      binSize,
      dropAnimationDuration,
      /** La poubelle n'existe que si quelqu'un sait retirer une carte. */
      enabled: onRemove !== undefined,
      gridBottom,
      gridRef,
      hinting,
      markLearned,
      onDragMove,
      onDragStart,
      onRemove,
      overBin,
      proximity,
      reveal,
      settle,
    }),
    [
      binSize,
      dropAnimationDuration,
      gridBottom,
      hinting,
      markLearned,
      onDragMove,
      onDragStart,
      onRemove,
      overBin,
      proximity,
      reveal,
      settle,
    ],
  );
}

/**
 * Le calque. À poser à la RACINE de l'écran, dernier enfant — sa place dans
 * l'arbre est ce qui le met au-dessus des rangées de la collection.
 *
 * La même corbeille en deux pièces que le bouton Supprimer de la carte en
 * détail : même fonte icomoon, couvercle et corps séparés, parce que toute
 * l'animation est là. Blanche sur un disque rouge — c'est le sens pour lequel
 * la fonte a été dessinée ; en rouge sur la page crème elle n'était que deux
 * traits pâles.
 */
export function DeckTrashBin({ trash }: { trash: DeckTrash }) {
  const { t: copy } = useUiTranslation();
  const { binSize, gridBottom, hinting, overBin, proximity, reveal } = trash;

  // Le claquement du survol, à part de `proximity` : l'approche est continue
  // (elle suit le doigt), le survol est un événement — lui seul passe par un
  // ressort, qui ne redémarre qu'aux bascules 0/1.
  const snap = useDerivedValue(() =>
    withSpring(overBin.get(), { damping: 14, mass: 0.5, stiffness: 320 }),
  );

  // Positionnée depuis le bord bas du plateau plutôt que depuis le bas de
  // l'écran : elle reste l'issue de CE deck, où qu'il soit dans le défilement.
  // L'écran est ancré en haut de la fenêtre, donc ses coordonnées et celles de
  // la fenêtre coïncident.
  const containerStyle = useAnimatedStyle(() => ({
    opacity: reveal.get(),
    top: binLayout(gridBottom.get(), 0, { height: 0, width: 0 }).y,
    transform: [
      { translateY: (1 - reveal.get()) * 24 },
      { scale: 0.86 + reveal.get() * 0.14 + snap.get() * 0.06 },
    ],
  }));

  // L'ouverture : jusqu'à 70 % par la seule approche, le reste au survol. Le
  // couvercle pivote autour de sa charnière arrière — rotation, montée et
  // déport combinés — comme dans l'animation du bouton d'origine.
  const lidStyle = useAnimatedStyle(() => {
    const open = Math.min(1, proximity.get() * 0.7 + snap.get() * 0.45);
    return {
      transform: [
        { translateX: open * 9 },
        { translateY: open * -9 },
        { rotateZ: `${open * -34}deg` },
      ],
    };
  });

  // Le halo : un anneau qui enfle sous le disque à l'approche et claque au
  // survol. Il donne à la cible une taille visible plus grande que le disque,
  // sans dessiner de cadre.
  const haloStyle = useAnimatedStyle(() => {
    const near = Math.max(proximity.get(), snap.get());
    return { opacity: near * 0.3, transform: [{ scale: 0.72 + near * 0.5 }] };
  });

  // L'indice cède sa place à mesure que la poubelle monte : à mi-descente il
  // est déjà à moitié parti. Les deux ne se chevauchent jamais vraiment, et
  // c'est la poubelle qui a le dernier mot.
  const hintStyle = useAnimatedStyle(() => ({
    opacity: hinting.get() * (1 - Math.min(1, reveal.get() * 2)),
    top: gridBottom.get() + HINT_OFFSET,
    transform: [{ translateY: reveal.get() * -8 }],
  }));

  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.layer, styles.hint, hintStyle]}>
        <SymbolView name="arrow.down" size={13} tintColor={HINT_INK} weight="semibold" />
        <Text style={styles.hintText}>{copy("ui_copy_094")}</Text>
      </Animated.View>

      <Animated.View pointerEvents="none" style={[styles.layer, containerStyle]}>
      {/* La vue mesurée est la boîte, plus large que le disque : la cible de
          lâcher reste indulgente sans qu'aucun cadre ne se voie. */}
      <View
        collapsable={false}
        onLayout={({ nativeEvent }) => {
          const { height, width } = nativeEvent.layout;
          if (width !== binSize.get().width || height !== binSize.get().height) {
            binSize.set({ height, width });
          }
        }}
        style={styles.target}
      >
        <Animated.View style={[styles.halo, haloStyle]} />
        <View style={styles.disc}>
          {/* Les deux pièces se SUPERPOSENT : deux glyphes pleine taille de la
              même fonte, dessinés pour s'empiler à la même origine — le
              couvercle dans le vide au-dessus du corps. Laissées dans le flux,
              elles se rangent l'une sous l'autre et la corbeille se coupe en
              deux. */}
          <View style={styles.glyphs}>
            <DeleteIconFont color="#fff" name="Bottom" size={40} style={styles.glyph} />
            <Animated.View style={[styles.glyph, lidStyle]}>
              <DeleteIconFont color="#fff" name="Top" size={40} />
            </Animated.View>
          </View>
        </View>
      </View>
      </Animated.View>
    </>
  );
}

/** L'encre de l'indice : lisible, jamais autoritaire. C'est une note, pas une
 *  instruction. */
const HINT_INK = 'rgba(43,36,24,0.5)';

const styles = StyleSheet.create((theme) => ({
  layer: {
    position: 'absolute',
    right: 0,
    left: 0,
    // Au-dessus de tout ce que l'écran dessine. Il est déjà le dernier enfant,
    // ceci le protège d'un frère qui se donnerait une élévation plus tard.
    zIndex: 100,
    alignItems: 'center',
  },
  hint: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  hintText: {
    color: HINT_INK,
    fontFamily: theme.fonts.medium,
    fontSize: 13,
  },
  target: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 62,
    paddingVertical: 20,
  },
  halo: {
    position: 'absolute',
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: theme.colors.danger,
  },
  disc: {
    width: 82,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 41,
    // La terre cuite du thème, pas un rouge de signalisation. `#b3261e` était
    // juste mais dur, et étranger à une page crème : sur du parchemin, un rouge
    // froid crie. Celui-ci reste chaud, et garde 4,4:1 avec le glyphe blanc —
    // au-dessus du seuil des grands éléments graphiques.
    backgroundColor: theme.colors.danger,
    // L'ombre la décolle de la page : elle flotte au-dessus du contenu, elle
    // n'en fait pas partie.
    shadowColor: theme.colors.danger,
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
  },
  // Une boîte carrée à la taille du glyphe, dans laquelle les deux pièces sont
  // posées en absolu à la même origine — c'est ce qui les superpose.
  glyphs: {
    width: 40,
    height: 40,
  },
  glyph: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
}));
