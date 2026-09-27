import { useTranslation as useUiTranslation } from 'react-i18next';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export type DeckTileData = {
  name: string;
  description: string;
  authorName: string;
  cardCount: number;
  likeCount: number;
  liked: boolean;
  isPublic: boolean;
  coverUrl: string | null;
  groups: string[];
};

export function DeckTile({ deck, onPress, onLike }: { deck: DeckTileData; onPress: () => void; onLike?: () => void }) {
  const { t: copy } = useUiTranslation();
  return (
    <Pressable style={styles.root} onPress={onPress}>
      <View style={styles.cover}>
        {deck.coverUrl ? <Image source={{ uri: deck.coverUrl }} contentFit="contain" style={styles.image} /> : <SymbolView name="pawprint.fill" size={38} tintColor="#d8a94a" />}
      </View>
      <View style={styles.copy}>
        <View style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>{deck.name}</Text>
          {deck.isPublic ? <SymbolView name="globe" size={14} tintColor="#8fa59a" /> : null}
        </View>
        <Text style={styles.author}>{deck.authorName} · {deck.cardCount} {' '}{copy("ui_copy_091")}</Text>
        {deck.groups.length ? <Text style={styles.groups} numberOfLines={1}>{deck.groups.join(' · ')}</Text> : null}
        {deck.description ? <Text style={styles.description} numberOfLines={2}>{deck.description}</Text> : null}
      </View>
      {onLike ? (
        <Pressable accessibilityLabel="Like deck" hitSlop={10} style={styles.like} onPress={onLike}>
          <SymbolView name={deck.liked ? 'heart.fill' : 'heart'} size={18} tintColor={deck.liked ? '#e97770' : '#8fa59a'} />
          <Text style={styles.likeCount}>{deck.likeCount}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 22, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  cover: { width: 72, height: 88, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: '#241a04', overflow: 'hidden' },
  image: { width: '92%', height: '92%' },
  copy: { flex: 1, gap: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 18 },
  author: { color: theme.colors.primary, fontFamily: theme.fonts.medium, fontSize: 12 },
  groups: { color: theme.colors.muted, fontFamily: theme.fonts.medium, fontSize: 11 },
  description: { color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 13, lineHeight: 18 },
  like: { alignItems: 'center', gap: 2, padding: 4 },
  likeCount: { color: theme.colors.muted, fontFamily: theme.fonts.medium, fontSize: 11 },
}));
