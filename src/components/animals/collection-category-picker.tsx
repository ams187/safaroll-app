// LA PASTILLE COMPTE CE QU'ON A, PAS CE QUI MANQUE.
//
// Elle a affiché « 3 / 5576 ». Ce dénominateur était le catalogue entier, et il
// disait à un nouveau venu qu'il en était à 0,05 % — pas une progression, une
// annonce qu'il ne finira jamais. Sur les 5 576 espèces, 201 seulement ont été
// photographiées par qui que ce soit depuis l'ouverture.
//
// ET IL N'Y A PAS DE MEILLEUR DÉNOMINATEUR.
//
// « Trouvables près de toi » serait faux : un zoo met un lion ou un toucan à
// portée d'iPhone en France, donc `species_seasons` — qui décrit la présence
// SAUVAGE par région — ne mesure pas ce qui est atteignable. Un objectif faux
// est pire qu'un objectif absent.
//
// Reste le nombre seul. C'est un fait sur ce que le joueur possède, immunisé au
// zoo, aux saisons et aux voyages, et il ne peut que monter : chaque capture
// améliore le chiffre, là où elle bougeait un pourcentage invisible.

import type { SFSymbol } from 'expo-symbols';
import { SymbolView } from 'expo-symbols';
import { memo } from 'react';
import { Text, View } from 'react-native';

type Props = {
  categories: {
    discovered: number;
    icon: SFSymbol;
    key: string;
    label: string;
  }[];
  discovered: number;
  onSelect: (key: string) => void;
  selected: string;
};

export const CollectionCategoryPicker = memo(function CollectionCategoryPicker({ discovered }: Props) {
  return (
    <View style={{ height: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, borderRadius: 20, backgroundColor: '#f3eee2' }}>
      <SymbolView name="square.grid.2x2.fill" size={14} tintColor="#29242d" />
      <Text style={{ color: '#29242d', fontSize: 14, fontWeight: '700' }}>{discovered}</Text>
    </View>
  );
});
