// L'écusson de distinction.
//
// L'ILLUSTRATION EST LE BADGE ENTIER, SILHOUETTE COMPRISE
//
// Une première version dessinait la forme en Skia et posait un symbole dessus.
// Elle est tombée le jour où les douze illustrations sont arrivées : elles
// portent déjà leur silhouette, leur matière et leur sujet. Redessiner un
// cadre autour de ces formes — carnet, aile, jumelles, vague — détruirait
// justement ce qui permet de les reconnaître de loin.
//
// Ce composant ne fait donc plus que trois choses, et c'est tout ce qu'il doit
// faire : afficher, éteindre, chiffrer.
//
// ÉTEINDRE, C'EST DÉSATURER — PAS BAISSER L'OPACITÉ
//
// Un badge à 40 % d'opacité se lit comme une erreur de rendu : il est pâle,
// donc cassé. En NOIR ET BLANC il se lit comme une photo pas encore coloriée —
// la chose existe, elle attend. C'est la même nuance que partout ailleurs dans
// cette app : ce qui manque n'est pas verrouillé, il est à mériter.
//
// La matrice passe par Skia parce que ni `expo-image` ni React Native n'ont de
// filtre de saturation, et que Skia est déjà lié dans ce build.
//
// LE CADENAS SE POSE PAR-DESSUS, IL NE REMPLACE PAS L'ILLUSTRATION
//
// L'écusson non mérité garde son dessin : c'est lui qui donne envie. Il perd sa
// couleur, s'estompe, et reçoit un cadenas au centre — trois signaux qui disent
// la même chose, ce qui est voulu. Le noir et blanc seul se lit de loin mais
// s'attrape mal en grille ; le cadenas seul se voit mais n'a pas d'humeur.
//
// LE CHIFFRE EST POSÉ PAR L'APP, JAMAIS PAR LE MODÈLE
//
// « 150 » est un SEUIL : il change si on rééquilibre le barème. Généré dans
// l'image, il faudrait relancer une génération pour corriger un nombre — et les
// modèles dessinent le texte de travers une fois sur trois.

import { Canvas, ColorMatrix, Image as SkiaImage, useImage } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** Saturation zéro. Les coefficients sont ceux de la luminance perçue. */
const GREYSCALE = [
  0.2126, 0.7152, 0.0722, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
  0, 0, 0, 1, 0,
];

export function QuestBadge({
  art,
  earned = true,
  label,
  size = 92,
}: {
  art?: number;
  earned?: boolean;
  /** Le seuil. « 150 » dit l'objectif sans qu'on ait à ouvrir la distinction. */
  label?: string;
  size?: number;
}) {
  return (
    <View style={{ width: size, height: size }}>
      {art ? (
        earned ? (
          <Image contentFit="contain" source={art} style={styles.art} />
        ) : (
          <LockedArt art={art} size={size} />
        )
      ) : null}

      {art && !earned ? (
        <View pointerEvents="none" style={styles.lockWrap}>
          <View
            style={[
              styles.lock,
              { width: size * 0.34, height: size * 0.34, borderRadius: size * 0.17 },
            ]}
          >
            <SymbolView name="lock.fill" size={size * 0.17} tintColor="#FFFBF0" />
          </View>
        </View>
      ) : null}

      {label ? (
        <View pointerEvents="none" style={[styles.labelWrap, { bottom: size * 0.015 }]}>
          <Text style={[styles.label, { fontSize: size * 0.25 }]}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

function LockedArt({ art, size }: { art: number; size: number }) {
  const image = useImage(art);
  if (!image) return <View style={styles.art} />;
  return (
    <Canvas style={{ width: size, height: size }}>
      <SkiaImage fit="contain" height={size} image={image} width={size} x={0} y={0}>
        <ColorMatrix matrix={GREYSCALE} />
      </SkiaImage>
    </Canvas>
  );
}

const styles = StyleSheet.create((theme) => ({
  art: { width: '100%', height: '100%' },
  // Centré sur le médaillon, pas dans un coin : l'illustration est déjà éteinte,
  // le cadenas doit se lire au premier coup d'œil et non se chercher.
  lockWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lock: {
    backgroundColor: 'rgba(23,18,10,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  label: {
    color: '#FFFBF0',
    fontFamily: theme.fonts.display,
    // Le chiffre passe sur l'anneau sombre ET sur l'aplat clair du champ. Sans
    // contour, il disparaît sur l'un des deux.
    textShadowColor: 'rgba(20,12,4,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
}));
