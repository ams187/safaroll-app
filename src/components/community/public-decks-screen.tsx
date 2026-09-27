import { DeckTile } from '@/components/animals/deck-tile';
import { useModeration } from '@/components/moderation/use-moderation';
import { ContextMenuRow } from '@/components/ui/context-menu';
import { ThinkingLoader } from '@/components/ui/thinking-loader';
import { toast } from '@/lib/notify';
import { api, type DeckSummary } from '@/lib/supabase/api';
import { backendQuery, useMutation } from '@/lib/supabase/backend';
import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export default function PublicDecksScreen() {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const router = useRouter();
  const { data } = useQuery(backendQuery(api.decks.listCommunity, {}));
  const toggleLike = useMutation(api.decks.toggleLike);
  if (!data) return <View style={styles.center}><ThinkingLoader label={t('community_loading')} state="working" /></View>;
  if (!data.length) return <View style={styles.center}><Text style={styles.title}>{copy("ui_copy_072")}</Text><Text style={styles.copy}>{copy("ui_copy_073")}</Text></View>;
  return (
    <LegendList
      data={data}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyExtractor={(deck) => deck._id}
      recycleItems
      renderItem={({ item }) => (
        <PublicDeckRow
          deck={item}
          onLike={() => {
            void toggleLike({ id: item._id })
              .then(() => toast.done(item.liked ? t('community_unfavorited') : t('community_favorited')))
              .catch(() => toast.fail(t('community_favorite_failed')));
          }}
          onPress={() => router.push({ pathname: '/(app)/(tabs)/(deck)/[id]', params: { id: item._id } })}
        />
      )}
    />
  );
}

/** Une tuile de la galerie, sous menu contextuel.
 *
 *  Un composant à part parce que `useModeration` est un hook : appelé dans le
 *  `renderItem` d'une liste, il changerait de nombre d'appels à chaque rendu.
 *
 *  L'appui long est l'idiome iOS pour « agir sur cet élément » ; la fiche du
 *  joueur, elle, porte un bouton visible. Les deux chemins existent parce
 *  qu'un seul geste caché ne se laisse pas trouver — ni par un utilisateur qui
 *  veut signaler, ni par un examinateur qui vérifie que c'est possible. */
function PublicDeckRow({
  deck,
  onLike,
  onPress,
}: {
  deck: DeckSummary;
  onLike: () => void;
  onPress: () => void;
}) {
  const moderation = useModeration({
    authorId: deck.authorId,
    authorName: deck.authorName,
    kind: 'deck',
    targetId: deck._id,
  });
  return (
    <ContextMenuRow actions={moderation.actions}>
      <DeckTile deck={deck} onLike={onLike} onPress={onPress} />
    </ContextMenuRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32, backgroundColor: theme.colors.background },
  title: { textAlign: 'center', color: theme.colors.foreground, fontFamily: theme.fonts.display, fontSize: 25 },
  copy: { textAlign: 'center', color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 15 },
  content: { padding: 16, paddingBottom: 120 },
  separator: { height: 10 },
}));
