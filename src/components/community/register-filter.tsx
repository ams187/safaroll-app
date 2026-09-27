// Le repli non-iOS. `@expo/ui/swift-ui` n'existe que sur iOS, et cette version
// n'en importe rien — pas même un type — pour qu'un bundle Android n'ait aucune
// raison de le résoudre.
//
// Pas de menu natif équivalent ici : deux rangées de pastilles, la forme que
// l'app utilisait partout avant. Elles prennent plus de place que le menu iOS,
// et c'est le prix à payer pour rester à une seule implémentation par
// plateforme plutôt qu'à une imitation qui vieillit mal.

import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export type FilterOption<T extends string> = { key: T; label: string };

export function RegisterFilter<B extends string, S extends string>({
  boards,
  board,
  onBoard,
  onScope,
  scope,
  scopes,
}: {
  board: B;
  boards: readonly FilterOption<B>[];
  onBoard: (key: B) => void;
  onScope: (key: S) => void;
  scope: S;
  scopes: readonly FilterOption<S>[];
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {scopes.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => onScope(item.key)}
            style={[styles.chip, item.key === scope && styles.chipOn]}
          >
            <Text style={[styles.chipText, item.key === scope && styles.chipTextOn]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        {boards.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => onBoard(item.key)}
            style={[styles.chip, item.key === board && styles.chipOn]}
          >
            <Text style={[styles.chipText, item.key === board && styles.chipTextOn]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: 6, paddingBottom: 3, maxWidth: 190 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, justifyContent: 'flex-end' },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceMuted,
  },
  chipOn: { backgroundColor: theme.colors.primary },
  chipText: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 12,
  },
  chipTextOn: { color: theme.colors.onPrimary, fontFamily: theme.fonts.bold },
}));
