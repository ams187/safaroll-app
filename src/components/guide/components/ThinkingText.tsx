// « Le Guide réfléchit… », et le reflet qui passe dessus.
//
// Porté de `WithShimmer` (VoyageMaker/Oria), avec une substitution : le dégradé
// y venait d'`expo-linear-gradient`, absent d'ici et qui coûterait une
// recompilation native. Skia le dessine, il est déjà dans le bundle. Le masque,
// lui, est le même — `@react-native-masked-view` arrive avec expo-router et son
// pod est déjà lié.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI CE MONTAGE PLUTÔT QUE L'ANCIEN
//
// `ShimmerText` (supprimé avec ce fichier) peignait le texte DANS un canvas
// Skia : `matchFont`, mesure des mots, retour à la ligne à la main, et une
// largeur en dur à fournir depuis l'appelant (`width={180}`). Une phrase plus
// longue se faisait couper, et rien de tout ça n'existait pour un lecteur
// d'écran.
//
// Ici le texte est un vrai `<Text>`. Il se compose, se coupe et s'annonce comme
// n'importe quel autre texte de l'app ; le dégradé passe derrière et le masque
// le découpe à la forme des lettres. Personne n'a plus à connaître sa largeur.
//
//   masque    = le texte
//   dessous   = un aplat sourd (la couleur au repos)
//   par-dessus = une bande claire de 400 pt qui traverse, transparente aux bords
//
// Sur Android, `MaskedView` sur du texte animé coûte cher pour ce que ça rend :
// le texte s'affiche sans reflet, comme dans l'original.

import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import MaskedView from '@react-native-masked-view/masked-view';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { theme } from '../theme';

/** Plus large que la phrase : au milieu du passage, tout est éclairé d'un coup. */
const BANDE = 400;
const DUREE_MS = 1500;
const TRANSPARENT = 'rgba(0,0,0,0)';

export function ThinkingText({ style, text }: { style?: TextStyle; text: string }) {
  const [hauteur, setHauteur] = useState(0);
  const x = useSharedValue(-BANDE);

  useEffect(() => {
    x.value = withRepeat(
      withSequence(
        withTiming(BANDE, { duration: DUREE_MS, easing: Easing.inOut(Easing.ease) }),
        // Retour instantané : la bande repart de la gauche sans se voir revenir.
        withTiming(-BANDE, { duration: 0 }),
      ),
      -1,
    );
    return () => cancelAnimation(x);
  }, [x]);

  const passage = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const mesurer = (event: LayoutChangeEvent) => setHauteur(event.nativeEvent.layout.height);

  if (process.env.EXPO_OS === 'android') {
    return <Text style={[styles.text, style, { color: theme.textSecondary }]}>{text}</Text>;
  }

  return (
    <MaskedView maskElement={<Text style={[styles.text, style]}>{text}</Text>}>
      <View onLayout={mesurer} style={styles.clip}>
        {/* Invisible, mais c'est lui qui donne sa taille à tout le reste : le
            masque et l'aplat doivent occuper exactement la place du texte. */}
        <Text style={[styles.text, style, styles.ghost]}>{text}</Text>
        <View style={[StyleSheet.absoluteFill, styles.repos]} />
        <Animated.View style={[styles.bande, passage]}>
          <Canvas style={styles.fill}>
            <Rect height={hauteur} width={BANDE} x={0} y={0}>
              <LinearGradient
                colors={[TRANSPARENT, theme.text, TRANSPARENT]}
                end={vec(BANDE, 0)}
                positions={[0.15, 0.5, 0.85]}
                start={vec(0, 0)}
              />
            </Rect>
          </Canvas>
        </Animated.View>
      </View>
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  bande: { bottom: 0, position: 'absolute', top: 0, width: BANDE },
  clip: { overflow: 'hidden' },
  fill: { flex: 1 },
  ghost: { opacity: 0 },
  repos: { backgroundColor: theme.textSecondary },
  text: { fontFamily: 'Satoshi-Medium', fontSize: 16 },
});
