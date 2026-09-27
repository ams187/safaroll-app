// Le menu contextuel du système — l'appui long qui fait reculer la page et
// pose une carte d'actions au-dessus de l'élément touché.
//
// `.contextMenu` de SwiftUI, via `@expo/ui`. Rien de ça ne se réécrit : le
// flou, le grossissement de l'aperçu, la carte qui s'ancre du bon côté selon
// la place restante, le retour haptique, le rouge `destructive` d'Apple — un
// panneau maison en approche la forme et jamais le geste.
//
// `RNHostView` remet du React Native à l'intérieur : la ligne garde sa mise en
// page et sa typo, seule la carte d'actions est native.
//
// Deux fichiers, comme `native-sheet` : `@expo/ui/swift-ui` n'existe que sur
// iOS, et le repli à côté n'en importe rien — pas même un type.

import { Button, ContextMenu, Host, RNHostView } from '@expo/ui/swift-ui';
import type { ReactElement } from 'react';
import type { SFSymbol } from 'expo-symbols';

export type ContextMenuAction = {
  /** Rouge, et rangé à part par le système. */
  destructive?: boolean;
  icon?: SFSymbol;
  label: string;
  onPress: () => void;
};

export function ContextMenuRow({
  actions,
  children,
}: {
  actions: ContextMenuAction[];
  children: ReactElement;
}) {
  return (
    <Host matchContents>
      <ContextMenu>
        <ContextMenu.Trigger>
          <RNHostView matchContents>{children}</RNHostView>
        </ContextMenu.Trigger>
        <ContextMenu.Items>
          {actions.map((action) => (
            <Button
              key={action.label}
              label={action.label}
              onPress={action.onPress}
              role={action.destructive ? 'destructive' : 'default'}
              systemImage={action.icon}
            />
          ))}
        </ContextMenu.Items>
      </ContextMenu>
    </Host>
  );
}
