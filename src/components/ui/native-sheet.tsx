import { useTranslation as useUiTranslation } from 'react-i18next';
// Le repli non-iOS. `@expo/ui/swift-ui` n'existe que sur iOS, et cette version
// n'en importe rien — pas même un type — pour qu'un bundle Android n'ait aucune
// raison de le résoudre.
//
// Un `Modal` avec `presentationStyle: 'pageSheet'` donne déjà la feuille du
// système : geste de fermeture et recul de l'écran derrière compris. Ce qu'il
// n'a pas, ce sont les paliers — on ouvre donc à une seule hauteur, et un
// bouton « Fermer » remplace le rabattement.

import type { ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export function NativeSheet({
  children,
  onClose,
  onDismiss,
  open,
}: {
  children: ReactNode;
  /** Ignorés ici : `Modal` n'a pas de paliers. Présents pour l'égalité des signatures. */
  detent?: 'medium' | 'large' | { fraction: number } | { height: number };
  detents?: ('medium' | 'large' | { fraction: number } | { height: number })[];
  onClose: () => void;
  onDismiss?: () => void;
  onDetentChange?: (detent: 'medium' | 'large') => void;
  open: boolean;
}) {
  const { t: copy } = useUiTranslation();
  return (
    <Modal animationType="slide" onDismiss={onDismiss} onRequestClose={onClose} presentationStyle="pageSheet" visible={open}>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <Pressable onPress={onClose} style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}>
            <Text style={styles.closeText}>{copy("reveal_close")}</Text>
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  close: { paddingHorizontal: 4, paddingVertical: 4 },
  closeText: { color: theme.colors.muted, fontFamily: theme.fonts.medium, fontSize: 15 },
  head: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  sheet: { backgroundColor: theme.colors.background, flex: 1 },
}));
