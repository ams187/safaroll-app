// La teinte des flous, alignée sur le thème.
//
// `BlurView` ne suit pas Unistyles : sa teinte est un mot, pas un jeton. Posé
// en dur, un flou clair sur le thème sombre rend un voile laiteux — et
// l'inverse assombrit une page crème. Une seule constante, lue partout.

import { UnistylesRuntime } from 'react-native-unistyles';

export const BLUR_TINT: 'dark' | 'light' =
  UnistylesRuntime.themeName === 'dark' ? 'dark' : 'light';
