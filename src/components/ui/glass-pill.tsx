import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

/**
 * Une pilule d'action en verre liquide — porté de `GlassPill` (~/Affirm).
 *
 * TROIS CHOSES QUI FONT LA DIFFÉRENCE, ET QUE J'AVAIS TOUTES RATÉES
 * -----------------------------------------------------------------
 * 1. `tintColor="systemUltraThinMaterial"` : un MATÉRIAU système, pas une
 *    couleur. C'est lui qui donne au verre son épaisseur et sa réfraction.
 *    Sans lui, `clear` sur un fond sombre rend un gris plat qu'on ne distingue
 *    pas d'un `rgba(255,255,255,0.10)` — le verre était actif et invisible.
 * 2. `isInteractive` : le verre répond au doigt, se déforme et suit la
 *    pression. C'est ce que l'œil reconnaît comme du liquide.
 * 3. Le `Pressable` est DEDANS, pas autour. Le verre doit envelopper le contenu
 *    pour le réfracter ; posé en frère du bouton, il n'a rien à travers quoi
 *    regarder. C'était mon erreur de structure, et elle annulait le reste.
 *
 * LE PARTAGE DES RÔLES ENTRE LES DEUX COUCHES
 * -------------------------------------------
 * Le verre porte la FORME (rayon, marges externes), le pressable porte le
 * REMBOURRAGE et le contenu. Mettre le rembourrage sur le verre laisserait une
 * zone tactile plus petite que la pilule visible — on toucherait le bord sans
 * rien déclencher.
 *
 * `clear`, COMME DANS AFFIRM
 * --------------------------
 * `clear` est un verre TRANSPARENT : il se voit par la déformation de ce qu'il
 * y a derrière. Sur le fond presque uni d'une carte ordinaire il se lit donc
 * beaucoup moins que sur la lave d'une légendaire. J'ai tenté `regular`, un
 * verre dépoli qui porte sa propre matière — ce n'est pas le rendu voulu.
 *
 * AUCUN LISERÉ, ET C'EST VOULU
 * ----------------------------
 * J'en avais ajouté un pour compenser cette invisibilité. C'était traiter le
 * symptôme : une bordure rend au verre l'aspect de bouton plein qu'il cherche
 * justement à éviter, et Affirm n'en a pas.
 *
 * LE REPLI SERT DEUX CAS, PAS UN
 * ------------------------------
 * Hors iOS 26, évidemment. Mais aussi PENDANT la transition d'ouverture :
 * `UIVisualEffectView` échantillonne son arrière-plan à la création de son
 * calque, donc un verre monté pendant que la carte vole reste plat pour de bon.
 * L'appelant passe alors `ready={false}` et le flou tient la place — la pilule
 * existe dès la première image, et le verre prend le relais une fois la scène
 * posée.
 *
 * LE FLOU IMITE LE VERRE, IL NE S'EN EXCUSE PAS
 * ---------------------------------------------
 * `BlurView` seul rend un aplat dépoli : la profondeur y est, la MATIÈRE non.
 * Ce qui fait lire un verre, c'est son arête — la ligne claire où la lumière
 * rase le bord. On l'ajoute ici, et ici seulement : le vrai verre la dessine
 * lui-même, la lui superposer ferait un double contour.
 */

/** L'arête qui fait passer un simple flou pour du verre. Repli uniquement. */
const FAUX_VERRE = {
  borderColor: 'rgba(255,255,255,0.22)',
  borderWidth: 1,
  overflow: 'hidden',
} as const;

const SPRING = { damping: 15, stiffness: 220 } as const;
const PRESSED_SCALE = 0.94;

export function GlassPill({
  accessibilityLabel,
  children,
  contentStyle,
  onPress,
  ready = true,
  shape,
  tintColor = 'systemUltraThinMaterial',
}: {
  accessibilityLabel: string;
  children: ReactNode;
  /** Rembourrage et disposition du contenu — porté par le pressable. */
  contentStyle: StyleProp<ViewStyle>;
  onPress: () => void;
  /** Faux tant que la scène bouge : le verre y naîtrait plat. Voir l'en-tête. */
  ready?: boolean;
  /** Rayon et marges — portés par le verre lui-même. */
  shape: StyleProp<ViewStyle>;
  tintColor?: string;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const inner = (
    <AnimatedPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      onPressIn={() => scale.set(withSpring(PRESSED_SCALE, SPRING))}
      onPressOut={() => scale.set(withSpring(1, SPRING))}
      style={[contentStyle, animated]}
    >
      {children}
    </AnimatedPressable>
  );

  if (ready && isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="clear" isInteractive style={shape} tintColor={tintColor}>
        {inner}
      </GlassView>
    );
  }

  return (
    <BlurView intensity={40} style={[shape, FAUX_VERRE]} tint="dark">
      {inner}
    </BlurView>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
