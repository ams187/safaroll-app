// Le mur d'animaux qui défile — premier écran de l'onboarding.
//
// Porté du bloc `ai-image-playground-react-native-marquee` d'AnimateReactNative :
// trois rangées qui glissent en sens alternés, l'ensemble incliné, et un fondu
// vers la couleur du fond en haut comme en bas pour que le mur n'ait pas de
// bord.
//
// TROIS ÉCARTS AVEC LE BLOC D'ORIGINE, ET LEURS RAISONS
//
// LES IMAGES SONT DANS LE BUNDLE, PAS SUR LE RÉSEAU
//   L'original pointe des URL distantes. Le tout premier écran de l'app ne peut
//   pas dépendre du réseau : hors ligne, ou sur un métro, la promesse s'ouvre
//   sur trois rangées vides. Les 27 photos Unsplash sont téléchargées une fois,
//   recadrées carré en webp 440 px (1 Mo au total), et montées en `require`.
//
// LE FONDU EST EN SKIA, PAS EN `expo-linear-gradient`
//   Même raison que `safari-gradient.tsx` : le dégradé natif obligerait à
//   reconstruire le client de dev, et tout ce qui ne l'est pas rendrait un
//   écran blanc. Skia est déjà lié. Un seul `Canvas` porte les deux fondus.
//
// LES COULEURS VIENNENT DU THÈME
//   Le bloc est violet sur fond nuit. Ici le fond est le papier de l'app, en
//   clair comme en sombre, sinon le mur flotterait au-dessus d'un écran qui
//   n'est pas le sien.

import { Marquee } from '@animatereactnative/marquee';
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';

/**
 * 27 photos, 9 par rangée. Le compte n'est pas décoratif : chaque rangée est
 * clonée autant de fois qu'il en faut pour couvrir l'écran, donc une rangée
 * courte se répète vite et le mur se met à bégayer. Neuf vignettes font environ
 * trois largeurs d'écran — assez pour qu'on ne revoie jamais deux fois la même
 * bête au même moment.
 */
export const PHOTOS = [
  require('../../../assets/onboarding/a01.webp'),
  require('../../../assets/onboarding/a02.webp'),
  require('../../../assets/onboarding/a03.webp'),
  require('../../../assets/onboarding/a04.webp'),
  require('../../../assets/onboarding/a05.webp'),
  require('../../../assets/onboarding/a06.webp'),
  require('../../../assets/onboarding/a07.webp'),
  require('../../../assets/onboarding/a08.webp'),
  require('../../../assets/onboarding/a09.webp'),
  require('../../../assets/onboarding/a10.webp'),
  require('../../../assets/onboarding/a11.webp'),
  require('../../../assets/onboarding/a12.webp'),
  require('../../../assets/onboarding/a13.webp'),
  require('../../../assets/onboarding/a14.webp'),
  require('../../../assets/onboarding/a15.webp'),
  require('../../../assets/onboarding/a16.webp'),
  require('../../../assets/onboarding/a17.webp'),
  require('../../../assets/onboarding/a18.webp'),
  require('../../../assets/onboarding/a19.webp'),
  require('../../../assets/onboarding/a20.webp'),
  require('../../../assets/onboarding/a21.webp'),
  require('../../../assets/onboarding/a22.webp'),
  require('../../../assets/onboarding/a23.webp'),
  require('../../../assets/onboarding/a24.webp'),
  require('../../../assets/onboarding/a25.webp'),
  require('../../../assets/onboarding/a26.webp'),
  require('../../../assets/onboarding/a27.webp'),
];

const ROWS = 3;
const SPACING = 8;
/** Lent : le mur respire, il ne roule pas. */
const SPEED = 0.22;
const STAGGER = 180;

/** `#rrggbb` → la même couleur, transparente. Skia lit le CSS. */
function fade(hex: string) {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, 0)`;
}

export function AnimalMarquee() {
  const { theme } = useUnistyles();
  const { width } = useWindowDimensions();
  const [size, setSize] = useState({ height: 0, width: 0 });

  const item = width * 0.34;
  const background = theme.colors.background;
  const clear = fade(background);

  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { height, width: w } = nativeEvent.layout;
    setSize((current) =>
      current.width === w && current.height === height ? current : { height, width: w },
    );
  };

  return (
    <View onLayout={onLayout} style={styles.wall}>
      <View style={[styles.rows, { gap: SPACING }]}>
        {Array.from({ length: ROWS }, (_, row) => (
          <Marquee key={row} reverse={row % 2 !== 0} speed={SPEED} spacing={SPACING}>
            <View style={{ flexDirection: 'row', gap: SPACING }}>
              {PHOTOS.slice(row * 9, row * 9 + 9).map((photo, index) => (
                <Animated.Image
                  entering={(row % 2 === 0 ? FadeInRight : FadeInLeft)
                    .duration(500)
                    .delay(STAGGER * (row + 1) + index * 25)}
                  key={index}
                  source={photo}
                  style={{ aspectRatio: 1, borderRadius: 14, width: item }}
                />
              ))}
            </View>
          </Marquee>
        ))}
      </View>

      {/* Les deux fondus, dans un seul canevas : le mur n'a ni haut ni bas. */}
      {size.width > 0 ? (
        <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Rect height={size.height * 0.24} width={size.width} x={0} y={0}>
            <LinearGradient
              colors={[background, clear]}
              end={vec(0, size.height * 0.24)}
              start={vec(0, 0)}
            />
          </Rect>
          <Rect
            height={size.height * 0.42}
            width={size.width}
            x={0}
            y={size.height * 0.58}
          >
            <LinearGradient
              colors={[clear, background, background]}
              end={vec(0, size.height)}
              positions={[0, 0.72, 1]}
              start={vec(0, size.height * 0.58)}
            />
          </Rect>
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wall: {
    flex: 1,
    overflow: 'hidden',
  },
  // L'inclinaison est ce qui empêche le mur de ressembler à une grille : les
  // rangées débordent volontairement de chaque côté, le parent les coupe.
  rows: {
    flex: 1,
    justifyContent: 'center',
    transform: [{ rotate: '-4deg' }, { scale: 1.15 }],
  },
});
