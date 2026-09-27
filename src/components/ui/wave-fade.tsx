// Le balayage diagonal qui découvre une carte.
//
// Il ne photographie plus son contenu.
//
// La version d'avant rendait les enfants HORS ÉCRAN à -10 000 px, en prenait
// une capture avec `makeImageFromView`, jouait le balayage sur cette capture,
// puis remettait les vrais enfants à leur place. Trois défauts, tous visibles :
//
//   — la capture partait avant que les images du contenu soient décodées, donc
//     le balayage jouait sur une carte sans animal, qui apparaissait d'un coup
//     à la fin ;
//   — le remplacement final de la photo par la vraie vue était un changement
//     d'image, et il se lisait comme tel ;
//   — `makeImageFromView` est une capture synchrone du GPU, payée à l'ouverture
//     de chaque carte.
//
// Maintenant les enfants sont montés normalement, à leur place, dès la première
// frame. Ce qui bouge, c'est un CACHE par-dessus : un dégradé de la couleur du
// fond qui glisse en diagonale et les découvre. Plus de capture, plus d'échange,
// et rien à attendre — ce qui est dessous est la vraie vue depuis le début.

import { Canvas, LinearGradient, RoundedRect, vec } from '@shopify/react-native-skia';
import { useEffect, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Easing, runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

export function WaveFade({
  children,
  color,
  duration = 760,
  radius = 0,
}: {
  children: ReactNode;
  /** La couleur du cache — celle du fond sur lequel la carte se pose. */
  color: string;
  duration?: number;
  /** Le rayon des coins du contenu : un cache carré sur une carte arrondie
   *  déborderait à chaque angle. */
  radius?: number;
}) {
  const [dimensions, setDimensions] = useState({ height: 0, width: 0 });
  const [uncovered, setUncovered] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0 || uncovered) return;
    progress.set(0);
    progress.set(
      withTiming(1, { duration, easing: Easing.in(Easing.cubic) }, (completed) => {
        // Démonté à l'arrivée : un canevas Skia immobile par-dessus la carte
        // continuerait de composer une couche pour rien.
        if (completed) runOnJS(setUncovered)(true);
      }),
    );
  }, [dimensions.height, dimensions.width, duration, progress, uncovered]);

  // La diagonale du cache : il part de sous la carte, à gauche, et sort par le
  // coin opposé. `fade` est la longueur du dégradé lui-même — sans elle le
  // cache aurait un bord net et se lirait comme un volet, pas comme une vague.
  const start = useDerivedValue(() => {
    const diagonal = Math.hypot(dimensions.width, dimensions.height);
    const fade = diagonal * 0.4;
    const initialX = -fade * (dimensions.width / Math.max(diagonal, 1));
    const initialY = dimensions.height + fade * (dimensions.height / Math.max(diagonal, 1));
    return vec(
      initialX + progress.value * (dimensions.width - initialX),
      initialY + progress.value * -initialY,
    );
  });
  const end = useDerivedValue(() => {
    const diagonal = Math.hypot(dimensions.width, dimensions.height);
    const fade = diagonal * 0.4;
    return vec(
      start.value.x + fade * (dimensions.width / Math.max(diagonal, 1)),
      start.value.y - fade * (dimensions.height / Math.max(diagonal, 1)),
    );
  });

  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { height, width } = nativeEvent.layout;
    if (height !== dimensions.height || width !== dimensions.width) setDimensions({ height, width });
  };

  return (
    <View onLayout={onLayout}>
      {children}
      {!uncovered && dimensions.width > 0 ? (
        <Canvas
          pointerEvents="none"
          style={{
            height: dimensions.height,
            left: 0,
            position: 'absolute',
            top: 0,
            width: dimensions.width,
          }}
        >
          {/* Transparent derrière la vague, opaque là où la carte n'est pas
              encore découverte — l'inverse exact du masque d'avant, puisque
              c'est un cache et non une fenêtre. */}
          <RoundedRect height={dimensions.height} r={radius} width={dimensions.width} x={0} y={0}>
            <LinearGradient colors={['transparent', color]} end={end} start={start} />
          </RoundedRect>
        </Canvas>
      ) : null}
    </View>
  );
}
