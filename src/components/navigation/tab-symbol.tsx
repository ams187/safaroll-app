// Le repli hors iOS. `symbolEffect` est une API SF Symbols, donc il n'y a rien
// à animer ailleurs : le symbole est rendu tel quel et `tap` est ignoré.

import { SymbolView } from 'expo-symbols';
import type { TabSymbolProps } from './tab-symbol-types';

export function TabSymbol({ color, size, symbol }: TabSymbolProps) {
  return <SymbolView name={symbol} size={size} tintColor={color} />;
}
