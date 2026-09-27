// Le repli non-iOS. Android n'a pas d'équivalent au menu contextuel d'UIKit —
// son idiome est la sélection longue puis une barre d'actions en haut, ce qui
// est un autre écran, pas un autre style. La ligne se rend donc telle quelle et
// les actions restent inatteignables ici : mieux vaut une fonction absente
// qu'une imitation qui ne se comporte comme rien de connu.

import type { ReactElement } from 'react';

export type ContextMenuAction = {
  destructive?: boolean;
  icon?: string;
  label: string;
  onPress: () => void;
};

export function ContextMenuRow({ children }: { actions: ContextMenuAction[]; children: ReactElement }) {
  return children;
}
