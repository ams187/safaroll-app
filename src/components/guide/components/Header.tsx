import { useTranslation as useUiTranslation } from 'react-i18next';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { theme } from '../theme';

export const Header = React.memo(function Header({ onNewChat, onOpenRecents }: { onNewChat: () => void; onOpenRecents: () => void }) {
  const { t: copy } = useUiTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.row, { paddingTop: insets.top + PAD_TOP }]}>
      <Pressable accessibilityLabel={copy("ui_copy_131")} onPress={onOpenRecents} hitSlop={8}><Glass interactive style={styles.circle}><Icon name="line.3.horizontal" /></Glass></Pressable>
      <Glass interactive style={styles.namePill}><Text style={styles.name}>{copy("quick_guide_title")}</Text><Icon name="chevron.down" size={13} color={theme.textSecondary} /></Glass>
      <Pressable accessibilityLabel={copy("ui_copy_132")} onPress={onNewChat} hitSlop={8}><Glass interactive style={styles.circle}><Icon name="square.and.pencil" /></Glass></Pressable>
    </View>
  );
});
const CIRCLE = 44;
const PAD_TOP = 6;
const PAD_BOTTOM = 8;

/**
 * La hauteur du bandeau SOUS l'encoche, dérivée et non recopiée.
 *
 * Le bandeau est posé en absolu et OPAQUE : ce que la liste glisse dessous
 * disparaît. `ChatScreen` s'en sert pour deux choses qui doivent tomber juste —
 * le retrait haut du contenu, et `anchorOffset`, la hauteur à laquelle le
 * message qu'on vient d'envoyer vient se caler. Les deux valaient 56 en dur,
 * soit la barre sans l'encoche : sur un téléphone à encoche le message montait
 * une soixantaine de points TROP HAUT et finissait derrière le bandeau.
 *
 * Ajouter `useSafeAreaInsets().top` du côté appelant.
 */
export const GUIDE_HEADER_BAR = PAD_TOP + CIRCLE + PAD_BOTTOM;

const styles = StyleSheet.create({
  row: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: theme.background, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: PAD_BOTTOM },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  namePill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: CIRCLE, paddingHorizontal: 18, borderRadius: CIRCLE / 2, overflow: 'hidden' },
  name: { fontFamily: 'Satoshi-Bold', fontSize: 17, fontWeight: '600', color: theme.text },
});
