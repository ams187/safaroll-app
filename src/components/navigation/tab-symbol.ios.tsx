// Une icône d'onglet qui s'anime quand on la touche.
//
// C'est le symbole SF lui-même qui bouge, pas une vue qu'on ferait sauter
// autour : `symbolEffect` est l'API d'Apple, celle qui connaît les couches du
// glyphe et sait rebondir la caméra sans son boîtier. Un `scale` en Reanimated
// aurait grossi le dessin en bloc — ce n'est pas la même chose, et ça se voit.
//
// Le déclencheur est un `useNativeState` muté depuis un worklet : l'effet est
// « discret » au sens d'Apple, il rejoue à chaque CHANGEMENT de la valeur. On
// incrémente donc plutôt que de basculer un booléen, sinon deux appuis de
// suite sur le même onglet n'en produiraient qu'un seul.
//
// iOS 17+ requis — la cible du projet est 17.0 (`ios/Podfile.properties.json`),
// donc pas de garde de disponibilité à écrire ici. Les autres plateformes
// prennent `tab-symbol.tsx`, qui rend le même symbole sans l'animation.

import { Host, Image, useNativeState } from '@expo/ui/swift-ui';
import { symbolEffect } from '@expo/ui/swift-ui/modifiers';
import { useEffect } from 'react';
import { scheduleOnUI } from 'react-native-worklets';
import type { TabSymbolProps } from './tab-symbol-types';

export function TabSymbol({ color, effect, size, symbol, tap }: TabSymbolProps) {
  const trigger = useNativeState(0);

  useEffect(() => {
    // Zéro, c'est le montage : la barre ne doit pas s'animer toute seule à
    // l'ouverture de l'app, seulement sous le doigt.
    if (tap === 0) return;
    scheduleOnUI(() => {
      'worklet';
      trigger.value = trigger.value + 1;
    });
  }, [tap, trigger]);

  return (
    <Host matchContents>
      <Image
        color={color}
        modifiers={[symbolEffect(effect, { value: trigger })]}
        size={size}
        systemName={symbol}
      />
    </Host>
  );
}
