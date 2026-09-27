import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { CardTile } from '@/components/cards/card-tile';
import type { HoloCardData } from '@/components/cards/holo-card';
import { SortableDeckGrid } from '@/components/decks/sortable-deck-grid';
import { ThinkingLoader } from '@/components/ui/thinking-loader';
import { toast } from '@/lib/notify';
import { api } from '@/lib/supabase/api';
import type { Id } from '@/lib/supabase/api';
import { backendQuery } from '@/lib/supabase/backend';
import { useQuery } from '@tanstack/react-query';
import { useMutation } from '@/lib/supabase/backend';
import { useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export default function DeckDetailScreen() {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: Id<'decks'> }>();
  const { width } = useWindowDimensions();
  const { data: result } = useQuery(backendQuery(api.decks.get, { id }));
  const { data: captures } = useQuery(backendQuery(api.animals.listCaptures, {}));
  const toggleCard = useMutation(api.decks.toggleCard);
  const togglePublic = useMutation(api.decks.togglePublic);
  const toggleLike = useMutation(api.decks.toggleLike);
  const deckWidth = width - 32;
  const cardWidth = (width - 32 - 24) / 4;

  if (result === undefined || captures === undefined) return <View style={styles.center}><ThinkingLoader label={t('deck_loading')} state="composing" /></View>;
  if (result === null) return <View style={styles.center}><Text style={styles.title}>{copy("ui_copy_200")}</Text></View>;
  const selected = new Set(result.captureIds);
  const visibleCards = result.owner ? captures : result.cards;
  const toggleDeckCard = (captureId: Id<'animalCaptures'>) => {
    void toggleCard({ deckId: id, captureId }).catch(() =>
      toast.fail(t('deck_full_title'), t('deck_full_body')),
    );
  };

  // PUBLIER N'A PAS DE PUBLIC EN V1, ET C'EST VOULU.
  //
  // La galerie de decks publics `(tidy)` porte `href: null` et le Cercle est
  // coupé (`@/lib/launch-flags`) : personne ne peut atteindre le deck d'un autre
  // joueur. Le bouton « publier » reste quand même, parce que l'état
  // `is_public` se pose dès maintenant — le jour où la galerie s'ouvre, les
  // decks déjà publiés y sont, au lieu d'une vitrine vide.
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text style={styles.title}>{result.deck.name}</Text>
        <Text style={styles.meta}>{copy("ui_copy_201")}{' '}{result.deck.authorName} · {result.deck.cardCount} {' '}{copy("ui_copy_091")}</Text>
        {result.deck.description ? <Text style={styles.description}>{result.deck.description}</Text> : null}
        {result.owner ? (
          <Pressable style={[styles.publish, result.deck.isPublic && styles.published]} onPress={() => void togglePublic({ id })}>
            <SymbolView name={result.deck.isPublic ? 'globe' : 'lock.fill'} size={16} tintColor={result.deck.isPublic ? '#241a04' : '#fffdf3'} />
            <Text style={[styles.publishText, result.deck.isPublic && styles.publishedText]}>{result.deck.isPublic ? t('deck_published') : t('deck_publish')}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.likeButton} onPress={() => void toggleLike({ id })}>
            <SymbolView name={result.deck.liked ? 'heart.fill' : 'heart'} size={18} tintColor="#e97770" />
            <Text style={styles.likeText}>{result.deck.likeCount}</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.deckGrid}>
        {result.owner ? (
          <SortableDeckGrid
            cards={result.cards as (HoloCardData & { _id: Id<'animalCaptures'> })[]}
            deckId={id}
            width={deckWidth - 28}
          />
        ) : (
          <View style={styles.cards}>
            {result.cards.map((capture) => (
              <CardTile key={capture._id} data={capture} width={cardWidth} />
            ))}
          </View>
        )}
      </View>

      {result.owner ? <Text style={styles.hint}>{copy("ui_copy_202")}</Text> : null}
      <View style={styles.cards}>
        {visibleCards.map((capture) => {
          const isSelected = selected.has(capture._id);
          return (
            <Pressable key={capture._id} disabled={!result.owner} style={[styles.cardWrap, result.owner && !isSelected && styles.unselected]} onPress={() => toggleDeckCard(capture._id)}>
              <CardTile data={capture} width={cardWidth} />
              {result.owner ? <View style={[styles.check, isSelected && styles.checkSelected]}><SymbolView name={isSelected ? 'checkmark' : 'plus'} size={15} tintColor={isSelected ? '#241a04' : '#fff'} weight="bold" /></View> : null}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, backgroundColor: theme.colors.background },
  content: { padding: 16, paddingBottom: 120 },
  heading: { alignSelf: 'stretch', gap: 6, marginBottom: 18 },
  title: { color: theme.colors.foreground, fontFamily: theme.fonts.display, fontSize: 30 },
  meta: { color: theme.colors.primary, fontFamily: theme.fonts.bold, fontSize: 13 },
  description: { color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 15, lineHeight: 21 },
  publish: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 13, borderRadius: 15, backgroundColor: '#241a04' },
  published: { backgroundColor: '#2b2418' },
  publishText: { color: '#fffdf3', fontFamily: theme.fonts.bold, fontSize: 14 },
  publishedText: { color: '#241a04' },
  likeButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  likeText: { color: theme.colors.foreground, fontFamily: theme.fonts.bold },
  deckGrid: { marginBottom: 18, padding: 14, borderRadius: 8, backgroundColor: '#1c1509' },
  hint: { alignSelf: 'stretch', marginBottom: 12, color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 13, lineHeight: 18 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cardWrap: { position: 'relative' },
  unselected: { opacity: 0.4 },
  check: { position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  checkSelected: { backgroundColor: '#2b2418' },
}));
