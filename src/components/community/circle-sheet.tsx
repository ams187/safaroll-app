// Le Cercle en vraie feuille du système. Le bloc `UISheetPresentationController`
// et son repli Android vivent maintenant dans `@/components/ui/native-sheet` —
// il en fallait un second pour les quêtes, et deux copies auraient dérivé.
//
// Deux paliers, et le second n'est pas décoratif : il y a une liste dedans, on
// ouvre à mi-hauteur pour garder le profil visible, on tire vers le haut quand
// la liste est longue.

import { NativeSheet } from '@/components/ui/native-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CirclePanel } from './circle-panel';

export function CircleSheet({ onClose, open }: { onClose: () => void; open: boolean }) {
  const insets = useSafeAreaInsets();

  return (
    <NativeSheet onClose={onClose} open={open}>
      <CirclePanel bottomInset={insets.bottom} onLeave={onClose} />
    </NativeSheet>
  );
}
