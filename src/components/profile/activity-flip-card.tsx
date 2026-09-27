import { useTranslation as useUiTranslation } from 'react-i18next';
import { GRILLE_ACTIVITE_ACTIVE } from '@/lib/launch-flags';
import type { Capture } from '@/lib/supabase/api';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { PressableOpacity } from 'pressto';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
} from 'react-native-reanimated';
import { GitHubContributions } from './github-contributions';

const SPRING_CONFIG = {
  mass: 1.2,
  stiffness: 60,
  damping: 12,
  velocity: 0.2,
} as const;

export function ActivityFlipCard({ captures, children, style }: { captures: readonly Capture[]; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { t: copy } = useUiTranslation();
  const [isFlipped, setIsFlipped] = useState(false);

  const progress = useDerivedValue(() => {
    return withSpring(isFlipped ? 1 : 0, SPRING_CONFIG);
  }, [isFlipped]);
  const frontAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(progress.get(), [0, 1], [0, 180]);
    const scale = interpolate(progress.get(), [0, 0.5, 1], [1, 0.95, 1]);

    return {
      transform: [
        { perspective: 1000 },
        { rotateY: `${rotateY}deg` },
        { scale },
      ],
      backfaceVisibility: 'hidden',
    };
  }, [progress]);

  const backAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(progress.get(), [0, 1], [180, 360]);
    const scale = interpolate(progress.get(), [0, 0.5, 1], [1, 0.95, 1]);

    return {
      transform: [
        { perspective: 1000 },
        { rotateY: `${rotateY}deg` },
        { scale },
      ],
      backfaceVisibility: 'hidden',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    };
  }, [progress]);

  // COUPÉ AU LANCEMENT — voir `GRILLE_ACTIVITE_ACTIVE`.
  //
  // Le retour se fait APRÈS les hooks, jamais avant : le drapeau est une
  // constante de module, donc la branche ne change pas d'un rendu à l'autre,
  // mais placer un retour au-dessus des hooks apprendrait la mauvaise habitude
  // à la prochaine condition, qui elle sera dynamique.
  if (!GRILLE_ACTIVITE_ACTIVE) {
    // LE CADRE RESTE, SEUL LE GESTE PART.
    //
    // Rendre `children` nu laissait le bandeau se dimensionner sur son contenu :
    // c'est `flipContainer` qui impose les 151 pt, et `cardFace` qui pose le
    // rayon, l'ombre et le rognage. Sans eux la carte partait sur toute la
    // hauteur de son contenu.
    return (
      <View style={style}>
        <View style={styles.flipContainer}>
          <View style={styles.cardFace}>{children}</View>
        </View>
      </View>
    );
  }

  return (
    <PressableOpacity
      accessibilityHint={copy("ui_copy_092")}
      accessibilityLabel={isFlipped ? copy("ui_copy_258") : copy("ui_copy_259")}
      accessibilityRole="button"
      onPress={() => setIsFlipped(prev => !prev)}
      style={style}
    >
      <View style={styles.flipContainer}>
        <Animated.View style={[styles.cardFace, frontAnimatedStyle]}>
          {children}
        </Animated.View>
        <Animated.View style={[styles.cardFace, backAnimatedStyle]}>
          {isFlipped ? <GitHubContributions active captures={captures} /> : null}
        </Animated.View>
      </View>
    </PressableOpacity>
  );
}

const styles = StyleSheet.create({
  cardFace: {
    borderCurve: 'continuous',
    borderRadius: 28,
    boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.1)',
    height: '100%',
    overflow: 'hidden',
    width: '100%',
  },
  flipContainer: {
    height: 151,
    width: '100%',
  },
});
