// Un aplat dégradé à coins ronds, en Skia.
//
// POURQUOI PAS `expo-linear-gradient`
//
// C'est un module NATIF. L'ajouter oblige à reconstruire le client de dev, et
// tout ce qui n'est pas reconstruit rend un écran blanc en attendant. Skia est
// déjà lié dans ce build — il dessine le même dégradé, sans rien à rebâtir.
//
// L'aplat se pose EN ARRIÈRE-PLAN absolu plutôt qu'en conteneur : un `Canvas`
// ne peut pas avoir d'enfants React, donc le contenu vit à côté, au-dessus, et
// la hauteur reste dictée par le contenu — pas par une valeur en dur qu'il
// faudrait corriger à chaque changement de texte.

import { Canvas, LinearGradient, RoundedRect, vec } from '@shopify/react-native-skia';
import { useState } from 'react';
import { View, type ViewStyle } from 'react-native';

import type { SafariTone } from '@/lib/safari-palette';

export function SafariGradient({
  children,
  radius = 24,
  style,
  tone,
}: {
  children: React.ReactNode;
  radius?: number;
  style?: ViewStyle;
  tone: SafariTone;
}) {
  const [size, setSize] = useState({ height: 0, width: 0 });

  return (
    <View
      onLayout={(event) => {
        const { height, width } = event.nativeEvent.layout;
        // Comparé avant d'écrire : `onLayout` refire à chaque passe, et poser
        // le même objet relancerait un rendu à l'infini.
        setSize((current) =>
          current.width === width && current.height === height ? current : { height, width },
        );
      }}
      style={style}
    >
      {size.width > 0 ? (
        <Canvas style={{ position: 'absolute', width: size.width, height: size.height }}>
          <RoundedRect height={size.height} r={radius} width={size.width} x={0} y={0}>
            <LinearGradient
              colors={[tone.from, tone.to]}
              end={vec(size.width, size.height)}
              start={vec(0, 0)}
            />
          </RoundedRect>
        </Canvas>
      ) : null}
      {children}
    </View>
  );
}
