// Le cachet.
//
// POURQUOI PAS UNE MÉDAILLE
//
// Une première version dessinait un pentagone doré à cadenas. C'est la
// signature d'une autre app, et une signature ne s'emprunte pas : les
// structures d'écran sont des conventions que tout le monde partage, mais la
// FORME d'un jeton de récompense est ce à quoi on reconnaît un produit. Copiée,
// elle ne dit plus « SafaRoll », elle dit « l'autre, en moins bien ».
//
// CE QUE CETTE APP AVAIT DÉJÀ SOUS LA MAIN
//
// Tout son vocabulaire est celui d'un carnet de terrain : parchemin, encre,
// atlas, Registre, expédition. Un carnet de naturaliste, ça se TAMPONNE — le
// cachet à l'encre est l'objet exact de ce monde-là, et il n'appartient à
// personne d'autre ici.
//
// IL DIT AUSSI MIEUX CE QU'IL DOIT DIRE
//
//   OBTENU        l'encre est passée. Aplat plein, glyphe en parchemin, bord
//                 dentelé de tampon. On voit une empreinte.
//   VERROUILLÉ    le tampon n'a pas encore été pressé : le relief est là, à
//                 sec, sans encre. Pas de cadenas — l'absence d'encre EST
//                 l'information, et il n'y a rien à déverrouiller, il y a
//                 quelque chose à mériter.
//
// L'INCLINAISON N'EST PAS DÉCORATIVE
//
// Un tampon posé à la main n'est jamais d'aplomb. L'angle est dérivé de la clé
// de la distinction, donc stable : la même distinction penche toujours pareil,
// et la grille cesse de ressembler à un tableur.

import {
  Canvas,
  Group,
  LinearGradient,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/**
 * Le bord dentelé d'un tampon : un disque dont le rayon ondule.
 *
 * `TEETH` dents peu profondes — assez pour qu'on lise « cachet » à 68 points,
 * pas assez pour que ça devienne un soleil d'école primaire.
 */
const TEETH = 22;
const DEPTH = 0.045;

function sealPath(size: number) {
  const path = Skia.Path.Make();
  const radius = size / 2;
  const steps = TEETH * 8;
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const r = radius * (1 - DEPTH + DEPTH * Math.cos(angle * TEETH));
    const x = radius + r * Math.cos(angle);
    const y = radius + r * Math.sin(angle);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.close();
  return path;
}

/** Un angle stable, dérivé de la clé : -5° à +5°. */
function tiltFor(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return ((Math.abs(hash) % 100) / 100) * 10 - 5;
}

export function Seal({
  earned,
  icon,
  label,
  seed = '',
  size = 68,
}: {
  earned: boolean;
  icon: SFSymbol;
  /** Le seuil écrit dans le cachet — « 25 » dit l'objectif sans qu'on l'ouvre. */
  label?: string;
  /** De quoi tirer l'inclinaison. La clé de la distinction, en général. */
  seed?: string;
  size?: number;
}) {
  const { theme } = useUnistyles();
  const path = sealPath(size);
  const tilt = tiltFor(seed || (label ?? icon));
  const glyph = size * 0.28;

  // Encre passée, ou relief à sec. Le cachet sec reprend le parchemin de la
  // page : il n'est pas « gris désactivé », il est en attente.
  const ink = earned
    ? ([theme.colors.foreground, '#100d07'] as const)
    : ([theme.colors.primarySoft, '#d8d0b4'] as const);
  const face = earned ? theme.colors.onPrimary : theme.colors.faint;

  return (
    <View style={{ width: size, height: size, transform: [{ rotate: `${tilt}deg` }] }}>
      <Canvas style={{ width: size, height: size }}>
        <Path path={path}>
          <LinearGradient colors={[...ink]} end={vec(size, size)} start={vec(0, 0)} />
        </Path>
        {/* Le liseré intérieur : c'est lui qui fait « tampon » plutôt que
            « pastille ». À sec il reste, en creux — le relief existe avant
            l'encre. */}
        <Group
          transform={[
            { translateX: size * 0.5 },
            { translateY: size * 0.5 },
            { scale: 0.84 },
            { translateX: -size * 0.5 },
            { translateY: -size * 0.5 },
          ]}
        >
          <Path
            color={earned ? theme.colors.onPrimary : '#c4bb9d'}
            path={path}
            strokeWidth={size * 0.022}
            style="stroke"
          />
        </Group>
      </Canvas>

      {/* SF Symbols et la police maison plutôt que du texte Skia : ce sont déjà
          les glyphes de toute l'app, les redessiner ici les ferait diverger au
          premier changement de thème. */}
      <View pointerEvents="none" style={styles.face}>
        <SymbolView name={icon} size={glyph} tintColor={face} />
        {label ? (
          <Text style={[styles.label, { color: face, fontSize: size * 0.2 }]}>{label}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  face: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  label: {
    fontFamily: theme.fonts.display,
  },
}));
