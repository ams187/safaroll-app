import { useTranslation as useUiTranslation } from 'react-i18next';
// Le filtre du Registre : un seul déclencheur, un `UIMenu` derrière.
//
// C'EST LE MOTIF DU LECTEUR DE YAQIN
//
// Là-bas, le choix de langue est un `Stack.Toolbar.Menu` : un bouton dans la
// barre, un menu natif qui s'ouvre, une coche sur la ligne active. Ici la
// section vit dans le hub et n'a pas de barre de navigation — le même `UIMenu`
// est donc ancré à un bouton dans la page, ce qui ne change rien à ce que
// l'utilisateur voit ni à ce qu'il touche.
//
// POURQUOI UN `Picker` DANS UN `Menu` ET PAS UNE LISTE DE `Button`
//
// SwiftUI rend un `Picker` inline à l'intérieur d'un menu comme une liste à
// coche unique : c'est le comportement natif de « choisir un parmi N », et il
// donne gratuitement la coche, la mise à jour et le repli du menu. Une liste de
// boutons obligerait à dessiner la coche à la main et à décider soi-même quand
// refermer — deux choses que le système fait déjà mieux.
//
// DEUX SECTIONS, PAS DEUX MENUS
//
// Portée et mesure sont deux questions (contre qui, sur quoi), mais on les pose
// au même moment. Deux sections titrées dans un seul menu, c'est un geste au
// lieu de deux, et l'ordre de lecture dit lequel compte d'abord.
//
// LE DÉCLENCHEUR EST UNE ICÔNE, ET C'EST UN ARBITRAGE
//
// Il affichait « Atlas · Mon cercle ». Écrire l'état est en général la bonne
// règle — sauf qu'ici le voisin est « Le Registre » en display 40, et deux
// libellés sur la même ligne faisaient passer le titre sur deux lignes.
//
// L'état n'est pas perdu pour autant : la LÉGENDE juste en dessous décrit la
// mesure active en toutes lettres (« Espèces vues depuis lundi. »), et le menu
// porte sa coche. L'icône ne fait donc que dire « il y a un choix ici » — ce
// qui est exactement son travail.

import { Host, Menu, Picker, Section, Text as UIText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export type FilterOption<T extends string> = { key: T; label: string };

export function RegisterFilter<B extends string, S extends string>({
  boards,
  board,
  onBoard,
  onScope,
  scope,
  scopes,
}: {
  board: B;
  boards: readonly FilterOption<B>[];
  onBoard: (key: B) => void;
  onScope: (key: S) => void;
  scope: S;
  scopes: readonly FilterOption<S>[];
}) {
  const { t: copy } = useUiTranslation();
  return (
    // `matchContents` : sans lui le SwiftUI réclame toute la largeur disponible
    // et pousse le podium hors de l'écran.
    <View style={styles.wrap}>
      <Host matchContents>
        <Menu label="" systemImage="line.3.horizontal.decrease.circle">
          <Section title={copy("ui_copy_050")}>
            <Picker
              modifiers={[pickerStyle('inline')]}
              onSelectionChange={(next) => onBoard(next as B)}
              selection={board}
            >
              {boards.map((item) => (
                <UIText key={item.key} modifiers={[tag(item.key)]}>
                  {item.label}
                </UIText>
              ))}
            </Picker>
          </Section>

          <Section title={copy("ui_copy_051")}>
            <Picker
              modifiers={[pickerStyle('inline')]}
              onSelectionChange={(next) => onScope(next as S)}
              selection={scope}
            >
              {scopes.map((item) => (
                <UIText key={item.key} modifiers={[tag(item.key)]}>
                  {item.label}
                </UIText>
              ))}
            </Picker>
          </Section>
        </Menu>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  // Rien qui centre ni qui étire : le composant vit maintenant dans la ligne du
  // titre, c'est elle qui décide de l'alignement.
  wrap: { paddingBottom: 3 },
}));
