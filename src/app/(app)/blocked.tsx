// LES COMPTES BLOQUÉS, ET LE MOYEN DE REVENIR EN ARRIÈRE.
//
// Apple demande de pouvoir bloquer (directive 1.2). Il ne demande pas
// explicitement de pouvoir débloquer — mais un blocage sans retour est un
// piège : un appui long mal placé, et quelqu'un disparaît de la communauté
// pour toujours, sans que rien nulle part ne dise pourquoi.
//
// La liste vient de `list_blocked()`, une RPC qui traverse la RLS. Il le faut :
// depuis `20260819234500`, la policy de lecture de `profiles` masque
// précisément les gens bloqués — cet écran ne pourrait pas lire les noms qu'il
// doit afficher.

import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/notify';
import { api } from '@/lib/supabase/api';
import { useBackendAuth, useMutation, useQuery } from '@/lib/supabase/backend';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

export default function BlockedScreen() {
  const { t } = useTranslation();
  const { isAuthenticated } = useBackendAuth();
  const { theme } = useUnistyles();
  const blocked = useQuery(api.moderation.blocked, isAuthenticated ? {} : 'skip');
  const unblock = useMutation(api.moderation.unblock);

  if (!blocked?.length) {
    return (
      <View style={styles.empty}>
        <SymbolView name="hand.raised.slash" size={34} tintColor={theme.colors.faint} />
        <Text style={styles.emptyText}>
          {blocked ? t('blocked_empty') : t('blocked_loading')}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      {blocked.map((user) => (
        <View key={user.userId} style={styles.row}>
          {user.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarEmpty]}>
              <SymbolView name="person.fill" size={16} tintColor={theme.colors.faint} />
            </View>
          )}
          <Text numberOfLines={1} style={styles.name}>
            {user.displayName ?? t('blocked_default_name')}
          </Text>
          <Pressable
            hitSlop={10}
            onPress={() =>
              Alert.alert(
                t('blocked_unblock_title', { name: user.displayName ?? t('blocked_this_player') }),
                t('blocked_unblock_body'),
                [
                  { style: 'cancel', text: t('common_cancel') },
                  {
                    onPress: () => {
                      void unblock({ userId: user.userId })
                        .then(() => toast.done(t('blocked_done')))
                        .catch(() => toast.fail(t('blocked_failed')));
                    },
                    text: t('blocked_unblock'),
                  },
                ],
              )
            }
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={styles.actionText}>{t('blocked_unblock')}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: 16, gap: 10 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32, backgroundColor: theme.colors.background },
  emptyText: { color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 15, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background },
  name: { flex: 1, color: theme.colors.foreground, fontFamily: theme.fonts.regular, fontSize: 15 },
  action: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border },
  actionText: { color: theme.colors.primary, fontFamily: theme.fonts.regular, fontSize: 13 },
  pressed: { opacity: 0.7 },
}));
