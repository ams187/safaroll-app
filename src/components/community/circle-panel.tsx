import { useTranslation as useUiTranslation } from 'react-i18next';
// Le Cercle : qui te suit, qui t'attend, et comment en ajouter.
//
// POURQUOI CE FICHIER NE CONTIENT PAS SA PRÉSENTATION
//
// Le cercle s'ouvre en feuille native sur iOS et en modal ailleurs. Les deux
// montrent EXACTEMENT ce contenu : le dupliquer ferait diverger deux versions
// du même écran à la première retouche. La feuille décide de la présentation,
// ce fichier décide de ce qu'on lit.
//
// POURQUOI LE CERCLE EXISTE
//
// Le classement mondial donne l'échelle, le cercle donne l'enjeu. Être 3 128ᵉ
// sur la Terre ne motive personne ; être 2ᵉ sur cinq amis, si. C'est la porte
// d'entrée du filtre « Mon cercle » du Registre — sans lui, ce filtre reste
// vide et le Registre n'a qu'une moitié de raison d'exister.
//
// DEUX FAÇONS D'AJOUTER, ET ELLES NE SE RECOUVRENT PAS
//
//   par lien partagé  pour quelqu'un à qui on écrit, et qui n'a pas encore l'app
//   par identifiant   pour quelqu'un dont on a le pseudo sous les yeux
//
// Le partage passe en premier : la plupart des gens n'ont pas l'identifiant de
// leur ami sous les yeux, ils ont son numéro.
//
// La recherche est EXACTE : un `like '%…%'` transformerait ce champ en annuaire
// de tous les comptes. On tape l'identifiant complet, celui qu'on donne à
// quelqu'un qu'on connaît.
//
// L'ordre de la liste n'est pas alphabétique : les demandes reçues d'abord,
// parce qu'elles attendent un geste. Ce qui demande une réponse passe avant ce
// qui n'en demande aucune.

import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { api, type Friend } from '@/lib/supabase/api';
import { useBackendAuth, useMutation, useQuery } from '@/lib/supabase/backend';

/** Les demandes reçues attendent un geste : elles passent devant. */
const ORDER: Record<Friend['direction'], number> = { friend: 2, in: 0, out: 1 };

export function CirclePanel({ bottomInset = 24, onLeave }: {
  bottomInset?: number;
  /** Fermer la feuille — un profil s'ouvre derrière elle, pas dedans. */
  onLeave: () => void;
}) {
  const { t: copy } = useUiTranslation();
  const router = useRouter();
  const { isAuthenticated } = useBackendAuth();
  const friends = useQuery(api.community.friends, isAuthenticated ? {} : 'skip');
  const handle = useQuery(api.community.myHandle, isAuthenticated ? {} : 'skip');

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<Friend | null | undefined>(undefined);

  const findExplorer = useMutation(api.community.findExplorer);
  const requestFriend = useMutation(api.community.requestFriend);
  const respondFriend = useMutation(api.community.respondFriend);

  const sealed = (friends ?? []).filter((friend) => friend.direction === 'friend');
  const sorted = [...(friends ?? [])].sort(
    (a, b) => ORDER[a.direction] - ORDER[b.direction] || a.displayName.localeCompare(b.displayName),
  );

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    // `undefined` = pas encore cherché, `null` = cherché et introuvable. Les
    // confondre ferait clignoter « introuvable » avant la première frappe.
    setFound(undefined);
    try {
      setFound((await findExplorer({ handle: query })) ?? null);
    } finally {
      setSearching(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{copy("ui_copy_059")}</Text>
        <Text style={styles.title}>{copy("ui_copy_060")}</Text>
      </View>

      <View style={styles.invite}>
        <View style={styles.inviteText}>
          <Text style={styles.inviteTitle}>{copy("ui_copy_061")}</Text>
          <Text style={styles.inviteBody}>{copy("ui_copy_062")}</Text>
        </View>
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync().catch(() => undefined);
            void Share.share({
              message: handle
                ? `Rejoins-moi sur SafaRoll — mon identifiant d’explorateur : @${handle}`
                : 'Rejoins-moi sur SafaRoll, on collectionne les animaux qu’on photographie.',
            }).catch(() => undefined);
          }}
          style={({ pressed }) => [styles.inviteButton, pressed && { opacity: 0.75 }]}
        >
          <SymbolView name="square.and.arrow.up" size={14} tintColor="#faf6ee" weight="semibold" />
          <Text style={styles.inviteButtonText}>{copy("safari_invite_button")}</Text>
        </Pressable>
      </View>

      {handle ? (
        <Text style={styles.myHandle}>
          {copy("ui_copy_063")}<Text style={styles.myHandleValue}>@{handle}</Text>
        </Text>
      ) : null}

      <View style={styles.searchRow}>
        <Text style={styles.at}>@</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          onSubmitEditing={() => void search()}
          placeholder={copy("ui_copy_064")}
          placeholderTextColor="#b5aa97"
          returnKeyType="search"
          style={styles.searchInput}
          value={query}
        />
        <Pressable
          disabled={searching || !query.trim()}
          onPress={() => void search()}
          style={({ pressed }) => [styles.searchButton, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.searchButtonText}>{copy("ui_copy_065")}</Text>
        </Pressable>
      </View>

      {found === null ? (
        <Text style={styles.notFound}>
          {copy("ui_copy_066")}</Text>
      ) : found ? (
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync().catch(() => undefined);
            void requestFriend({ userId: found.userId });
            setFound(null);
            setQuery('');
          }}
          style={({ pressed }) => [styles.foundRow, pressed && { opacity: 0.75 }]}
        >
          <Text numberOfLines={1} style={styles.foundName}>{found.displayName}</Text>
          <Text style={styles.foundAction}>{copy("ui_copy_067")}</Text>
        </Pressable>
      ) : null}

      <View style={styles.listHead}>
        <Text style={styles.eyebrow}>{copy("ui_copy_068")}</Text>
        <Text style={styles.count}>{sealed.length}</Text>
      </View>

      {friends === undefined ? null : sorted.length === 0 ? (
        <View style={styles.empty}>
          <SymbolView name="person.2" size={34} tintColor="#b5aa97" />
          <Text style={styles.emptyTitle}>{copy("ui_copy_069")}</Text>
          <Text style={styles.emptyBody}>
            {copy("ui_copy_070")}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {sorted.map((friend) => (
            <View key={friend.userId} style={styles.row}>
              <Pressable
                onPress={() => {
                  // La feuille se referme d'abord : un écran poussé SOUS une
                  // feuille présentée s'ouvrirait derrière elle, invisible.
                  onLeave();
                  router.push(`/player/${friend.userId}`);
                }}
                style={styles.rowIdentity}
              >
                <Text numberOfLines={1} style={styles.rowName}>{friend.displayName}</Text>
                <Text style={styles.rowState}>
                  {friend.direction === 'friend'
                    ? 'Dans ton cercle'
                    : friend.direction === 'in'
                      ? copy("ui_copy_260")
                      : copy("ui_copy_261")}
                </Text>
              </Pressable>

              {friend.direction === 'in' ? (
                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => undefined);
                    void respondFriend({ accept: true, userId: friend.userId });
                  }}
                  style={({ pressed }) => [styles.accept, pressed && { opacity: 0.75 }]}
                >
                  <Text style={styles.acceptText}>{copy("ui_copy_071")}</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => undefined);
                    void respondFriend({ accept: false, userId: friend.userId });
                  }}
                  style={({ pressed }) => [styles.remove, pressed && { opacity: 0.6 }]}
                >
                  <SymbolView name="xmark" size={12} tintColor="#8d8271" weight="semibold" />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  accept: {
    backgroundColor: theme.colors.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  acceptText: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.bold,
    fontSize: 13,
  },
  at: {
    color: theme.colors.faint,
    fontFamily: theme.fonts.bold,
    fontSize: 15,
  },
  content: { gap: 14, paddingTop: 22 },
  count: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.display,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  empty: { alignItems: 'center', gap: 6, paddingHorizontal: 40, paddingVertical: 32 },
  emptyBody: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13,
    textAlign: 'center',
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 15,
    marginTop: 4,
  },
  eyebrow: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    letterSpacing: 1.4,
  },
  foundAction: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 13,
  },
  foundName: { color: theme.colors.foreground, flex: 1, fontFamily: theme.fonts.bold, fontSize: 15 },
  foundRow: {
    alignItems: 'center',
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.lg,
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  header: { gap: 4, paddingHorizontal: 20 },
  invite: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderCurve: 'continuous',
    flexDirection: 'row',
    gap: 14,
    marginHorizontal: 20,
    padding: 18,
  },
  inviteBody: { color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 13 },
  inviteButton: {
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  inviteButtonText: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.bold,
    fontSize: 14,
  },
  inviteText: { flex: 1, gap: 3 },
  inviteTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 18,
  },
  list: { gap: 8, paddingHorizontal: 20 },
  listHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: 20,
  },
  myHandle: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 12,
    paddingHorizontal: 20,
  },
  myHandleValue: { color: theme.colors.foreground, fontFamily: theme.fonts.bold },
  notFound: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13,
    paddingHorizontal: 20,
  },
  remove: { padding: 8 },
  row: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderCurve: 'continuous',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowIdentity: { flex: 1, gap: 2 },
  rowName: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 15 },
  rowState: { color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 12 },
  searchButton: {
    backgroundColor: theme.colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  searchButtonText: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 13 },
  searchInput: {
    color: theme.colors.foreground,
    flex: 1,
    fontFamily: theme.fonts.medium,
    fontSize: 15,
    paddingVertical: 4,
  },
  searchRow: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderCurve: 'continuous',
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { color: theme.colors.foreground, fontFamily: theme.fonts.display, fontSize: 30 },
}));
