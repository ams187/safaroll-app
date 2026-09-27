import { useTranslation as useUiTranslation } from 'react-i18next';
import { translate } from '@/i18n';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';
import { LegendList, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '../components/Glass';
import { Icon } from '../components/Icon';
import { theme } from '../theme';
import {
  byPinnedThenRecent,
  deleteGuideConversation,
  listGuideConversations,
  pinGuideConversation,
  renameGuideConversation,
  type SavedConversation,
} from '../state/guide-persistence';
import { ContextMenuRow } from '@/components/ui/context-menu';
import { useChatStore } from '../state/chat-store';
import { toast } from '@/lib/notify';

function relativeTime(value: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return translate('guide_now');
  if (minutes < 60) return translate('guide_minutes_ago', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return translate('guide_hours_ago', { count: hours });
  return translate('guide_days_ago', { count: Math.round(hours / 24) });
}

if (__DEV__) console.assert(relativeTime('2026-01-01T11:00:00Z', Date.parse('2026-01-01T12:00:00Z')) === translate('guide_hours_ago', { count: 1 }));

/**
 * Le tiroir, posé sous la conversation — voir `RootDrawer`.
 *
 * `contentStyle` et `dockStyle` viennent de `useSwipeMenu` : le contenu se
 * découvre en montant et en s'ouvrant, la barre du bas monte pareil mais ne
 * s'efface jamais. Deux styles et non un, parce qu'un tiroir dont TOUT
 * apparaît en même temps n'a pas de profondeur.
 */
export function RecentsScreen({ active, contentStyle, dockStyle, onNewChat, onOpen }: { active: boolean; contentStyle?: AnimatedStyle<ViewStyle>; dockStyle?: AnimatedStyle<ViewStyle>; onNewChat: () => void; onOpen: (conversation: SavedConversation) => void }) {
  const { t: copy } = useUiTranslation();
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void listGuideConversations()
      .then((items) => { if (alive) setConversations(items); })
      .catch((error) => { if (__DEV__) console.warn('[guide] historique indisponible :', error); });
    return () => { alive = false; };
  }, [active]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr');
    return needle ? conversations.filter((item) => item.title.toLocaleLowerCase('fr').includes(needle)) : conversations;
  }, [conversations, query]);
  /**
   * Les trois actions écrivent D'ABORD dans la liste, puis au serveur, et
   * défont si le serveur refuse. Attendre l'aller-retour laisserait la ligne
   * inchangée sous le doigt une demi-seconde après le geste — le seul moment
   * où le doute est certain.
   */
  const rollback = useCallback((message: string) => (previous: SavedConversation[]) => {
    setConversations(previous);
    toast.fail(message);
  }, []);

  const remove = useCallback((conversation: SavedConversation) => {
    Alert.alert(
      copy("ui_copy_274"),
      copy('guide_delete_detail', { title: conversation.title }),
      [
        { style: 'cancel', text: copy("common_cancel") },
        {
          onPress: () => {
            // Si c'est la discussion OUVERTE, il faut la lâcher aussi. Le magasin
            // la sauvegarde par `upsert` à la moindre réponse ou notation : la
            // laisser chargée, c'est la voir réapparaître quelques secondes après.
            if (useChatStore.getState().conversationId === conversation.id) useChatStore.getState().newChat();
            let previous: SavedConversation[] = [];
            setConversations((current) => {
              previous = current;
              return current.filter((item) => item.id !== conversation.id);
            });
            void deleteGuideConversation(conversation.id)
              .catch(() => rollback(copy("ui_copy_275"))(previous));
          },
          style: 'destructive',
          text: copy("card_menu_delete"),
        },
      ],
    );
  }, [rollback, copy]);

  const rename = useCallback((conversation: SavedConversation) => {
    // `Alert.prompt` n'existe que sur iOS — et le menu contextuel qui y mène
    // non plus (voir `@/components/ui/context-menu`), donc ce chemin est
    // inatteignable ailleurs.
    if (Platform.OS !== 'ios') return;
    Alert.prompt(
      copy('guide_rename'),
      undefined,
      [
        { style: 'cancel', text: copy("common_cancel") },
        {
          onPress: (value?: string) => {
            const title = (value ?? '').trim().slice(0, 120);
            if (!title || title === conversation.title) return;
            let previous: SavedConversation[] = [];
            setConversations((current) => {
              previous = current;
              return current.map((item) => item.id === conversation.id ? { ...item, title } : item);
            });
            // Le magasin porte SON titre et le réécrit à chaque sauvegarde : sans
            // cette ligne, la prochaine réponse du Guide rendrait l'ancien nom.
            if (useChatStore.getState().conversationId === conversation.id) useChatStore.setState({ title });
            void renameGuideConversation(conversation.id, title)
              .catch(() => rollback(copy("ui_copy_278"))(previous));
          },
          text: copy("ui_copy_273"),
        },
      ],
      'plain-text',
      conversation.title,
    );
  }, [rollback, copy]);

  const togglePin = useCallback((conversation: SavedConversation) => {
    const pinned = !conversation.pinned;
    let previous: SavedConversation[] = [];
    setConversations((current) => {
      previous = current;
      return current
        .map((item) => item.id === conversation.id ? { ...item, pinned } : item)
        .sort(byPinnedThenRecent);
    });
    void pinGuideConversation(conversation.id, pinned)
      .catch(() => rollback(pinned ? copy("ui_copy_270") : copy("ui_copy_271"))(previous));
  }, [rollback, copy]);
  const renderRecent = useCallback(({ item }: LegendListRenderItemProps<SavedConversation>) => (
    <ContextMenuRow
      actions={[
        { icon: item.pinned ? 'pin.slash' : 'pin', label: item.pinned ? copy("ui_copy_272") : copy("collection_pin_short"), onPress: () => togglePin(item) },
        { icon: 'pencil', label: copy("ui_copy_273"), onPress: () => rename(item) },
        { destructive: true, icon: 'trash', label: copy("card_menu_delete"), onPress: () => remove(item) },
      ]}
    >
      <Pressable style={styles.row} onPress={() => onOpen(item)}>
        <View style={styles.rowText}><Text style={styles.title} numberOfLines={1}>{item.title}</Text><Text style={styles.time}>{relativeTime(item.updatedAt)}</Text></View>
        {item.pinned ? <Icon name="pin.fill" size={14} color={theme.textSecondary} /> : null}
      </Pressable>
    </ContextMenuRow>
  ), [onOpen, remove, rename, togglePin, copy]);
  return (
    <View style={styles.container}>
      <Animated.View style={[styles.reveal, contentStyle]}>
        <View style={[styles.topRow, { paddingTop: insets.top + 8 }]}><View style={styles.search}><Icon name="magnifyingglass" size={18} color={theme.textSecondary} /><TextInput onChangeText={setQuery} style={styles.searchInput} value={query} placeholder={copy("ui_copy_138")} placeholderTextColor={theme.textSecondary} /></View></View>
        {/* Pas de `recycleItems` : chaque ligne porte un hôte SwiftUI pour son
            menu contextuel, et recycler des vues natives entre des lignes qui
            n'ont pas les mêmes actions est le genre de chose qui se voit un
            jour sur deux. L'historique est plafonné à 50 entrées — il n'y a
            rien à gagner à les recycler. */}
        <LegendList data={filtered} keyExtractor={(item) => item.id} estimatedItemSize={66} recycleItems={false} ListHeaderComponent={<Text style={styles.section}>{copy("ui_copy_139")}</Text>} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false} renderItem={renderRecent} />
      </Animated.View>
      <Animated.View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }, dockStyle]}>
        <Pressable style={styles.newChatWrap} onPress={onNewChat} hitSlop={8}><Glass interactive style={styles.newChat}><Icon name="plus" size={16} /><Text style={styles.newChatText}>{copy("ui_copy_132")}</Text></Glass></Pressable>
        <Glass style={styles.circle}><Icon name="gearshape" size={20} /></Glass>
      </Animated.View>
    </View>
  );
}
const CIRCLE = 44;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.drawerBackground },
  reveal: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: CIRCLE, borderRadius: CIRCLE / 2, paddingHorizontal: 16, backgroundColor: theme.glassFallbackBackground },
  searchInput: { flex: 1, fontFamily: 'Satoshi-Regular', fontSize: 17, color: theme.text, padding: 0 },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  section: { color: theme.textSecondary, fontFamily: 'Satoshi-Medium', fontSize: 16, fontWeight: '500', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8 },
  listContent: { paddingBottom: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 },
  rowText: { flex: 1, gap: 3 }, title: { color: theme.text, fontFamily: 'Satoshi-Bold', fontSize: 18, fontWeight: '600' }, time: { color: theme.textSecondary, fontFamily: 'Satoshi-Regular', fontSize: 15 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 10 },
  newChatWrap: { flex: 1 }, newChat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: CIRCLE, borderRadius: CIRCLE / 2, overflow: 'hidden' },
  newChatText: { color: theme.text, fontFamily: 'Satoshi-Bold', fontSize: 17, fontWeight: '600' },
});
