// CE QUI DONNE SON IMAGE AU WIDGET DECK.
//
// Le widget attend un CHEMIN DE FICHIER, pas des données :
//
//   let chemin = defaults?.string(forKey: "safaroll.deckImage")
//   let image  = UIImage(contentsOfFile: chemin)
//
// Et rien ne l'écrivait. `setWidgetDeck` existait dans `widget-storage.ts`
// depuis le début sans un seul appelant — le widget ne pouvait donc afficher
// que son état d'attente, à vie.
//
// POURQUOI UNE VUE CACHÉE PLUTÔT QU'UN DESSIN HORS ÉCRAN
//
// `makeImageFromView` photographie une vue RÉELLEMENT MONTÉE — c'est le même
// appel que le partage de carte et que le brûlage. Il n'existe pas d'équivalent
// « rends-moi cet arbre React sans l'afficher ». On monte donc la composition
// pour de vrai, à sa taille finale, hors du champ visible.
//
// `pointerEvents="none"` et une position absolue très au-dessus de l'écran :
// elle ne peut ni être vue, ni intercepter un geste, ni décaler quoi que ce
// soit dans la mise en page.
//
// POURQUOI LE FICHIER VA DANS L'APP GROUP
//
// Une extension a son propre bac à sable : elle ne peut pas lire le cache de
// l'app. Le conteneur partagé est le seul terrain commun, et son chemin porte
// un identifiant tiré par le système — d'où `appGroupPath`, ajouté côté natif.
//
// CE QU'ON NE FAIT PAS : redessiner à chaque rendu. La signature du deck (son
// identifiant, ses cartes, dans l'ordre) sert de garde. Sans elle, chaque
// passage sur l'écran d'accueil réécrirait un PNG et rechargerait le widget,
// pour une image identique.

import { CardTile } from '@/components/cards/card-tile';
import { CARD_RATIO, type HoloCardData } from '@/components/cards/holo-card';
import { WIDGET_DECK_ACTIF } from '@/lib/launch-flags';
import { api } from '@/lib/supabase/api';
import type { DeckResult } from '@/lib/supabase/api';
import { useQuery as useBackendQuery } from '@/lib/supabase/backend';
import { setWidgetDeck } from '@/lib/widget-storage';
import { appGroupPath } from 'subject-lift';
import { makeImageFromView } from '@shopify/react-native-skia';
import { Directory, File } from 'expo-file-system';
import { useEffect, useRef } from 'react';
import { Platform, View, type View as RNView } from 'react-native';

/** Le même groupe que le widget et l'extension de partage. */
const APP_GROUP = 'group.com.example.safaroll';

/**
 * LA MÊME PILE QUE L'ACCUEIL, PAS UNE AUTRE MISE EN PAGE.
 *
 * `DeckStack` empile les cartes VERTICALEMENT, chacune décalée de 14 % de la
 * hauteur de la précédente — le bandeau de nom de chaque carte dépasse sous
 * celle du dessus, façon Apple Wallet. Le widget doit montrer ça, pas une
 * variation : c'est le même objet, vu ailleurs.
 *
 * QUATRE CARTES ET NON HUIT. La pile de l'accueil en montre huit parce qu'elle
 * a toute la largeur de l'écran. Ici la tuile fait 169 pt, marges déduites
 * : à huit, la carte tomberait sous 50 pt de large. Quatre gardent le geste
 * — une pile, pas une carte — avec des cartes encore lisibles.
 */
const CARTES = 4;

/** Le chevauchement de `DeckStack` replié, repris à l'identique. */
const DEPASSEMENT = 0.14;

/** La composition est rendue à cette largeur, puis réduite par le widget. */
const LARGEUR_CARTE = 300;
const HAUTEUR_CARTE = Math.round(LARGEUR_CARTE / CARD_RATIO);

/** Ce qui identifie l'image à produire. Change → on redessine, sinon non. */
function signature(deck: { _id: string } | undefined, cartes: HoloCardData[]) {
  if (!deck) return '';
  return `${deck._id}:${cartes.map((c) => String(c._id)).join(',')}`;
}

export function DeckWidgetPainter() {
  const decks = useBackendQuery(api.decks.listMineWithCards, {});
  const scene = useRef<RNView>(null);
  const dernierRendu = useRef<string>('');

  // Le deck ÉPINGLÉ, sinon le premier qui a des cartes. `listMineWithCards`
  // trie déjà les épinglés en tête, mais on ne s'appuie pas sur un tri pour une
  // règle métier : elle serait invisible le jour où le tri change.
  const choisi =
    decks?.find((d: DeckResult) => d.deck.pinned && d.cards.length > 0)
    ?? decks?.find((d: DeckResult) => d.cards.length > 0);
  const cartes = (choisi?.cards ?? []).slice(0, CARTES) as HoloCardData[];
  const empreinte = signature(choisi?.deck, cartes);

  useEffect(() => {
    if (!WIDGET_DECK_ACTIF) return;
    if (Platform.OS !== 'ios' || !empreinte) return;
    if (dernierRendu.current === empreinte) return;
    let vivant = true;

    // UNE FRAME D'ATTENTE, ET ELLE EST OBLIGATOIRE.
    //
    // `makeImageFromView` rend `null` sur une vue qui n'a pas encore de mise en
    // page. Capturer dans le même passage que le montage échouerait donc en
    // silence — pas d'erreur, juste un widget qui ne se remplit jamais.
    //
    // Une frame, pas un `useState` : poser un drapeau depuis un effet déclenche
    // une cascade de rendus, et le compilateur React le refuse.
    const frame = requestAnimationFrame(() => void peindre());

    async function peindre() {
      try {
        const dossier = appGroupPath(APP_GROUP);
        // Pas de conteneur = pas de droit provisionné sur ce binaire. Le widget
        // garde son état d'attente, ce qui est exactement ce qu'il doit faire.
        if (!dossier) return;

        const cliche = await makeImageFromView(scene);
        if (!cliche || !vivant) return;

        const cible = new Directory(`file://${dossier}`);
        const fichier = new File(cible, 'deck-widget.png');
        if (fichier.exists) fichier.delete();
        fichier.create();
        fichier.write(cliche.encodeToBytes());

        // Le widget lit un chemin de SYSTÈME DE FICHIERS, pas une URL : c'est
        // `UIImage(contentsOfFile:)` qui le consomme, et il ne sait pas défaire
        // un `file://`.
        dernierRendu.current = empreinte;
        setWidgetDeck(`${dossier}/deck-widget.png`, choisi?.deck.name ?? '');
      } catch {
        // Un widget qu'on ne sait pas repeindre n'est pas une raison de casser
        // l'écran qui a déclenché le rendu. Il gardera son image précédente.
      }
    }

    return () => {
      vivant = false;
      cancelAnimationFrame(frame);
    };
  }, [choisi?.deck.name, empreinte]);

  if (!WIDGET_DECK_ACTIF || !empreinte) return null;

  return (
    <View collapsable={false} pointerEvents="none" ref={scene} style={styles.scene}>
      {cartes.map((carte, index) => (
        <View
          key={String(carte._id)}
          style={{
            // Absolu et non empilé par le flux : la carte du dessus doit
            // RECOUVRIR la précédente, exactement comme `StackCard`.
            left: 0,
            position: 'absolute',
            top: Math.round(index * HAUTEUR_CARTE * DEPASSEMENT),
            zIndex: index,
          }}
        >
          <CardTile data={carte} width={LARGEUR_CARTE} />
        </View>
      ))}
    </View>
  );
}

const styles = {
  scene: {
    backgroundColor: 'transparent',
    // La hauteur de la pile repliée : une carte pleine, plus le dépassement de
    // chacune des suivantes. Même formule que `pileStyle` dans `DeckStack`.
    height: Math.round(HAUTEUR_CARTE * (1 + (CARTES - 1) * DEPASSEMENT)),
    // HORS DU CHAMP, PAS INVISIBLE. Une vue en `opacity: 0` ou `display: none`
    // n'a pas de pixels à photographier — `makeImageFromView` rendrait `null`.
    // Elle doit être RENDUE, simplement pas là où on regarde.
    left: 0,
    position: 'absolute' as const,
    top: -4000,
    width: LARGEUR_CARTE,
  },
};
