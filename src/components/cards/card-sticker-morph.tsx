// LE MORPH DU STICKER, POSÉ SUR LA CARTE ELLE-MÊME.
//
// Il a vécu dans la feuille des rencontres, en grand, au-dessus des vignettes.
// On regardait donc DEUX animaux : celui de l'aperçu et celui de la carte juste
// derrière — et c'est le mauvais qui bougeait. La carte est le sujet ; le
// changement doit se lire sur elle.
//
// Il ne se SUPERPOSE pas à l'animal de la carte : pendant l'aperçu, le canevas
// Skia ne dessine plus son détourage (voir `facePeinte` dans l'overlay). Le
// morph EST l'animal de la carte le temps du choix, dans le même rectangle.
//
// FICHIER À PART, ET C'EST SA RAISON D'ÊTRE.
//
// `react-native-morph-view` est un composant Fabric : son module natif doit
// être dans le binaire. Importé depuis l'overlay, il serait résolu au premier
// rendu de la collection — l'écran le plus utilisé de l'app — pour une
// animation qui ne sert qu'à qui ouvre le sélecteur. Isolé ici, il reste
// derrière un `lazy`.

import { portraitRectFor } from '@/components/cards/holo-card';
import { MorphView } from 'react-native-morph-view';

export function CardStickerMorph({
  a,
  b,
  largeurCarte,
  sens,
}: {
  /** L'image montrée quand `sens` est faux. */
  a: string;
  /** Celle montrée quand `sens` est vrai. Basculer `sens` joue le morph. */
  b: string;
  largeurCarte: number;
  sens: boolean;
}) {
  // LA MÊME GÉOMÉTRIE QUE LA CARTE, PAS UNE APPROXIMATION. `portraitRectFor`
  // est ce que le canevas Skia utilise pour placer l'animal, et `MorphView`
  // ajuste en `scaledToFit` — le même `contain`. Le morph se pose donc
  // exactement là où le détourage était, et la reprise ne saute pas.
  //
  // Aucun liseré : la carte n'en trace plus non plus (voir `holo-card`). Les
  // deux rendus montrent le même détourage nu, ce qui est justement la seule
  // façon qu'ils ont de se ressembler.
  const portrait = portraitRectFor(largeurCarte);
  return (
    <MorphView
      // Deux silhouettes d'une même espèce se ressemblent trop pour qu'un morph
      // serré se voie : c'est le flou qui rend la fusion lisible. Il retombe à
      // zéro aux deux extrémités, donc l'image au repos reste nette.
      blurRadius={26}
      duration={520}
      from={{ uri: a }}
      pointerEvents="none"
      style={{
        height: portrait.height,
        left: portrait.x,
        position: 'absolute',
        top: portrait.y,
        width: portrait.width,
      }}
      to={{ uri: b }}
      toggle={sens}
    />
  );
}
