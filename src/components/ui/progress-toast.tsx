// La pilule d'avancement — portée du bloc « Dynamic progress toast ».
//
// LA MÉCANIQUE, RELEVÉE DANS LA SOURCE
// (Solarin-Johnson/my-app, `components/dynamic-toast`)
//
//   UNE PILULE QUI S'OUVRE   194 × 40 au repos, pleine largeur × 75 déployée.
//                            Largeur ET hauteur sont animées par le même
//                            ressort, donc la bascule est un seul geste.
//   ELLE ARRIVE PAR LE BAS   `translateY = 2 × (hauteur + marge)` hors écran,
//                            `scale 0.2`, opacité 0 — et remonte au ressort.
//                            Le facteur 2 est ce qui lui donne son élan : elle
//                            vient de plus loin qu'il n'en faut.
//   DEUX RESSORTS            un vif (210/24) pour les changements de taille,
//                            un plus lent (180/22) pour l'entrée et la sortie.
//                            Le même ressort partout donnerait une apparition
//                            aussi nerveuse qu'un changement d'état.
//
// CE QU'ON A CHANGÉ
//
//   PAS DE PROVIDER, PAS DE CONTEXTE   la source pilote la pilule depuis un
//                                      contexte partagé, pour un appui long qui
//                                      la déplie. Ici elle raconte UNE tâche :
//                                      elle s'ouvre quand la tâche a des
//                                      détails à donner, se referme quand
//                                      c'est fini. Un contexte pour un seul
//                                      appelant serait de la plomberie.
//   UN ANNEAU, PAS UN SPINNER          l'avancement est mesuré (les planches
//                                      téléchargées, le document composé), donc
//                                      il se montre. Un spinner qui tourne sans
//                                      rien savoir ment sur ce qu'il sait.
//
// L'ANNEAU EST EN SKIA, MAIS SON CHEMIN SE CALCULE EN JS
//
// Un arc dont on fait varier la longueur — impossible en vues natives sans
// dessiner douze segments. Skia est déjà lié, et un canevas de 22 points ne
// coûte rien.
//
// Le chemin passait d'abord par `useDerivedValue`, donc par le fil
// d'animation, qui appelait une fonction JS restée du côté React : « Tried to
// synchronously call a Remote Function ». La marquer `worklet` aurait marché,
// et aurait été inutile — l'avancement change trois fois pendant tout l'export,
// pas soixante fois par seconde. Un `useMemo` suffit, et évite au passage le
// piège des constantes de module capturées dans un worklet.

import {
  Canvas,
  Path,
  Skia,
  type SkPath,
} from '@shopify/react-native-skia';
import { BlurView } from 'expo-blur';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMemo } from 'react';
import { StyleSheet as RNStyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

const COLLAPSED = { height: 40, width: 194 };
const EXPANDED_HEIGHT = 75;
const SPACE = 20;
const RING = 22;
const STROKE = 3;

/** Vif : les changements de taille. */
const SPRING = { damping: 24, mass: 1, stiffness: 210 };
/** Lent : l'arrivée et la sortie, qui viennent de loin. */
const SPRING_SLOW = { damping: 22, mass: 1, stiffness: 180 };

export type ToastState = {
  /** 0..1, ou null quand l'étape ne se mesure pas. */
  progress: number | null;
  /** La ligne du haut. */
  title: string;
  /** La seconde ligne — n'apparaît qu'en déployé. */
  detail?: string;
  /** Terminé : la pilule se ferme sur une coche. */
  done?: boolean;
};

function ring(progress: number): SkPath {
  const path = Skia.Path.Make();
  const r = (RING - STROKE) / 2;
  path.addArc(
    { height: r * 2, width: r * 2, x: STROKE / 2, y: STROKE / 2 },
    -90,
    360 * Math.max(0.02, progress),
  );
  return path;
}

export function ProgressToast({ state }: { state: ToastState | null }) {
  const { theme } = useUnistyles();
  const { width } = useWindowDimensions();
  const expandedWidth = Math.min(width - SPACE * 2, 430);

  const shown = state !== null;
  // Déployée quand elle a quelque chose de plus à dire que son titre.
  const open = shown && Boolean(state?.detail) && !state?.done;

  const box = useAnimatedStyle(() => {
    const height = open ? EXPANDED_HEIGHT : COLLAPSED.height;
    return {
      height: withSpring(height, SPRING),
      opacity: withSpring(shown ? 1 : 0, SPRING),
      // Elle vient de deux fois sa hauteur sous l'écran : l'élan se voit.
      transform: [
        { scale: withSpring(shown ? 1 : 0.2, SPRING) },
        { translateY: withSpring(shown ? 0 : 2 * (height + SPACE), SPRING_SLOW) },
      ],
      width: withSpring(open ? expandedWidth : COLLAPSED.width, SPRING),
    };
  });

  const bar = useAnimatedStyle(() => ({
    width: withTiming(`${Math.round((state?.progress ?? 0) * 100)}%`, { duration: 260 }),
  }));

  const arc = useMemo(() => ring(state?.progress ?? 0.25), [state?.progress]);

  const track = useMemo(() => ring(1), []);

  return (
    <View pointerEvents="none" style={styles.layer}>
      <Animated.View style={[styles.pill, box]}>
        <BlurView intensity={30} style={RNStyleSheet.absoluteFill} tint="dark" />
        <View style={styles.plate} />
        <View style={styles.row}>
          {state?.done ? (
            <SymbolView
              name={'checkmark.circle.fill' as SFSymbol}
              size={RING}
              tintColor={theme.colors.onPrimary}
            />
          ) : (
            <Canvas style={{ height: RING, width: RING }}>
              <Path
                color="rgba(255,255,255,0.22)"
                path={track}
                start={0}
                strokeWidth={STROKE}
                style="stroke"
              />
              <Path
                color={theme.colors.onPrimary}
                path={arc}
                strokeCap="round"
                strokeWidth={STROKE}
                style="stroke"
              />
            </Canvas>
          )}

          <View style={styles.text}>
            <Text numberOfLines={1} style={styles.title}>
              {state?.title ?? ''}
            </Text>
            {open && state?.detail ? (
              <>
                <Text numberOfLines={1} style={styles.detail}>
                  {state.detail}
                </Text>
                <View style={styles.barTrack}>
                  <Animated.View style={[styles.barFill, bar]} />
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  layer: {
    alignItems: 'center',
    bottom: SPACE,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 200,
  },
  pill: {
    borderCurve: 'continuous',
    borderRadius: EXPANDED_HEIGHT / 2,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
  },
  // Le flou seul rend un gris sale sur fond clair : une plaque d'encre par
  // dessous lui donne sa matière, comme la barre d'onglets de l'app.
  plate: {
    backgroundColor: 'rgba(20,15,8,0.72)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
  },
  text: { flex: 1, gap: 3 },
  title: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.bold,
    fontSize: 13,
  },
  detail: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.regular,
    fontSize: 11,
    opacity: 0.65,
  },
  barTrack: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 2,
    height: 3,
    marginTop: 2,
    overflow: 'hidden',
  },
  barFill: {
    backgroundColor: theme.colors.onPrimary,
    height: '100%',
  },
}));
