// La feuille du système, une fois, pour tout le monde.
//
// Ce bloc SwiftUI vivait en entier dans `circle-sheet.ios.tsx`. Il en fallait
// un deuxième pour les quêtes, et deux copies d'un `UISheetPresentationController`
// dérivent toujours : un jour l'une gagne un palier que l'autre n'a pas, et
// deux parenthèses de la même page ne se ferment plus pareil.
//
// POURQUOI UNE FEUILLE ET PAS UNE PAGE
//
// Ce qu'on ouvre depuis le profil est une PARENTHÈSE, pas une destination. Une
// page poussée dans la pile efface le profil, met une flèche de retour, et fait
// oublier d'où on vient ; une feuille laisse le profil visible derrière et se
// referme d'un glissement. Le geste, l'inertie, l'accroche aux paliers, le
// recul de l'écran derrière — tout ça est du système, et l'approximation d'un
// modal React se sent à la milliseconde près.
//
// `RNHostView` remet du React Native à l'intérieur du SwiftUI : la feuille est
// native, son contenu garde la DA parchemin de l'app.

import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import type { PresentationDetent } from '@expo/ui/swift-ui/modifiers';
import {
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import type { ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/**
 * LA HAUTEUR DE LA FEUILLE, IMPOSÉE PLUTÔT QUE DEMANDÉE.
 *
 * SwiftUI propose à `RNHostView` une hauteur IDÉALE, pas celle de la feuille.
 * Le contenu React Native se dimensionne donc sur LUI-MÊME, en cascade : mesuré
 * sur la page des quêtes, la fenêtre du `ScrollView` faisait 1526 pt, soit
 * exactement la hauteur de son contenu. Fenêtre et contenu de même taille, il
 * n'y a rien à faire défiler — la page rebondit et le bas reste rogné par la
 * feuille.
 *
 * Un `flex: 1` côté React Native n'y peut rien : `flex` répartit la hauteur
 * d'un parent, et ce parent n'en avait aucune. `containerRelativeFrame` non
 * plus — essayé, mesuré, sans effet.
 *
 * Alors on la calcule. Le palier `large` d'iOS ouvre juste sous l'encoche ;
 * `medium` occupe la moitié basse. Ce n'est pas au pixel près, mais c'est une
 * hauteur FINIE, et c'est tout ce qu'il manquait pour qu'un `ScrollView`
 * redevienne un `ScrollView`.
 *
 * À retirer le jour où `@expo/ui` propage la taille de la feuille à
 * `RNHostView` — le symptôme sera alors une feuille légèrement trop courte.
 */
const GARDE_HAUTE = 10;

export function NativeSheet({
  children,
  detent,
  // L'ORDRE COMPTE : le premier palier est celui d'ouverture
  // (`firstOrderedDetent`, côté Swift). Par défaut mi-hauteur — le profil reste
  // visible derrière, et on tire la feuille vers le haut quand c'est long.
  detents = ['medium', 'large'],
  onClose,
  onDismiss,
  onDetentChange,
  open,
}: {
  children: ReactNode;
  /**
   * Le palier voulu, quand l'appelant a une raison de pousser la feuille —
   * une réponse qui arrive alors qu'elle est à mi-hauteur, par exemple.
   *
   * Côté Swift, `.onChange(of: initialSelection)` ne réagit qu'à un CHANGEMENT
   * de valeur : renvoyer « large » deux fois de suite ne fait rien. D'où
   * `onDetentChange` — l'appelant reflète les glissements de l'utilisateur, sa
   * valeur redescend à « medium » toute seule, et la poussée suivante porte.
   */
  /**
   * Un palier `{ height }` mesure la feuille en POINTS. C'est ce qu'il faut
   * quand le contenu a une taille connue et courte — trois vignettes et un
   * bouton n'ont rien à faire dans une demi-page de vide.
   */
  detent?: PresentationDetent;
  detents?: PresentationDetent[];
  onClose: () => void;
  onDismiss?: () => void;
  /** Appelé quand l'utilisateur change de palier au doigt. */
  onDetentChange?: (detent: 'medium' | 'large') => void;
  open: boolean;
}) {
  const { theme } = useUnistyles();
  const { height: ecran } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Le premier palier est celui d'ouverture ; `detent` le remplace quand
  // l'appelant pilote la hauteur.
  const palier = detent ?? detents[0] ?? 'large';
  const hauteur =
    typeof palier === 'object'
      ? // Une hauteur donnée est la hauteur de la FEUILLE, encart du bas
        // compris : le contenu reçoit ce qui reste.
        ('height' in palier ? palier.height : ecran * palier.fraction) - insets.bottom
      : palier === 'medium'
        ? ecran / 2
        : ecran - insets.top - GARDE_HAUTE;

  return (
    // `matchContents` + position absolue : sans ça le SwiftUI occuperait une
    // place dans la mise en page de la page hôte alors qu'il ne dessine rien
    // tant que la feuille est fermée.
    <Host matchContents style={styles.host}>
      <BottomSheet isPresented={open} onDismiss={onDismiss} onIsPresentedChange={(presented) => !presented && onClose()}>
        <Group
          modifiers={[
            // DEUX FORMES, ET LA DIFFÉRENCE COMPTE.
            //
            // Avec `selection`, `@expo/ui` n'applique plus le modificateur
            // directement : il interpose une vue SwiftUI supplémentaire
            // (`PresentationDetentsSelectionView`) qui porte l'état du palier.
            // Cette couche s'est glissée entre la feuille et le contenu React
            // Native, et le défilement intérieur en a pâti — la page des quêtes
            // remontait d'elle-même dès qu'on la tirait.
            //
            // Seule la feuille du Guide d'une carte pilote son palier. Pour
            // toutes les autres, on garde la forme simple, celle d'avant.
            detent === undefined && onDetentChange === undefined
              ? presentationDetents(detents)
              : presentationDetents(detents, {
                  onSelectionChange: (selected) =>
                    onDetentChange?.(selected === 'large' ? 'large' : 'medium'),
                  selection: detent,
                }),
            presentationDragIndicator('visible'),
            // Peint TOUT le chrome de la feuille, jusque sous l'indicateur de
            // glissement et l'encart du bas — ce qu'un `background()` ordinaire
            // ne touche pas, laissant deux beiges différents se toucher.
            presentationBackground(theme.colors.background),
          ]}
        >
          <RNHostView>
            <View style={[styles.sheet, { height: hauteur }]}>{children}</View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute' },
  sheet: { flexGrow: 0, flexShrink: 0 },
});
