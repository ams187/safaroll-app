// Le contrat partagé par `tab-symbol.ios.tsx` et son repli. Isolé pour que la
// version non-iOS n'ait pas à importer `@expo/ui`, ne serait-ce que pour un
// type — le module a un binaire natif derrière lui, et Metro le résoudrait
// quand même.

import type { SymbolEffect } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'expo-symbols';

export type TabSymbolProps = {
  color: string;
  /** L'animation jouée à l'appui. Ignorée hors iOS. */
  effect: SymbolEffect;
  size: number;
  symbol: SFSymbol;
  /** Compteur d'appuis. Chaque incrément rejoue l'effet ; 0 = jamais touché. */
  tap: number;
};
