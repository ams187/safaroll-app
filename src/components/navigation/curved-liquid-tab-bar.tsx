import type { SymbolEffect } from '@expo/ui/swift-ui/modifiers';
import { Canvas, Path as SkiaPath } from '@shopify/react-native-skia';
import { GlassContainer, GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { type SFSymbol } from 'expo-symbols';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  useColorScheme,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { TabSymbol } from './tab-symbol';

const ARC_HEIGHT = 16;
const THICKNESS = 64;
const EDGE_PAD = 12;
const PILL_HEIGHT = 50;
const ICON_SIZE = 23;
const ICON_BOX = 44;
const SPRING_LEAD = { stiffness: 680, damping: 43, mass: 0.3 };
const SPRING_TRAIL = { stiffness: 150, damping: 19, mass: 1 };

const ICONS: Record<string, SFSymbol> = {
  '(home)': 'square.grid.2x2.fill',
  /*
   * NI DOSSIER NI BONHOMME.
   *
   * `folder.fill` venait d'Amber, où l'onglet ouvrait des « espaces » à
   * classer. Il n'ouvre plus rien de tel : derrière il y a la carte des
   * captures, le Guide, les quêtes, ma région. (Le Leaderboard et le Livre
   * sont coupés au lancement — voir `@/lib/launch-flags`.)
   *
   * Une icône de profil serait pire que le dossier — elle range tout ça dans
   * « réglages et compte », et un joueur n'ouvre pas les réglages. Or c'est
   * l'onglet qui contient tout ce qui donne envie de revenir.
   *
   * Les jumelles disent « va voir », dans la langue de l'app : on observe des
   * animaux, on ne gère pas un compte. Elles couvrent aussi bien la carte que
   * le Guide ou le classement — tout y est de l'exploration.
   */
  '(spaces)': 'binoculars.fill',
  '(deck)': 'camera.fill',
  camera: 'camera.fill',
  '(tidy)': 'person.3.fill',
  '(search)': 'person.fill',
};

/**
 * Ce que chaque icône fait quand on la touche.
 *
 * `bounce` partout sauf la caméra, et c'est voulu : une barre d'onglets est une
 * rangée, et trois animations différentes en feraient trois boutons sans
 * rapport. C'est aussi ce que fait iOS lui-même depuis 18. La caméra a droit à
 * son écart parce qu'elle n'est pas un onglet — elle ouvre le tiroir de prise
 * de vue, et `wiggle` dit « on te demande de viser » là où un rebond ne dirait
 * que « c'est sélectionné ».
 */
const TAP_EFFECTS: Record<string, SymbolEffect> = {
  camera: { effect: 'wiggle', direction: 'left' },
};
const DEFAULT_TAP_EFFECT: SymbolEffect = { effect: 'bounce', direction: 'up' };

type Route = { key: string; name: string };
type Point = { x: number; y: number };
type Arc = {
  center: Point;
  radius: number;
  startAngle: number;
  endAngle: number;
};

export function CurvedLiquidTabBar({
  activeIndex,
  onSelect,
  routes,
}: {
  activeIndex: number;
  onSelect: (index: number) => void;
  routes: readonly Route[];
}) {
  const [width, setWidth] = useState(0);
  const dark = useColorScheme() === 'dark';
  const glass = isLiquidGlassAvailable();
  const geometry = useGeometry(width, routes.length);

  // Un compteur d'appuis par onglet, pas un « onglet actif » : rejouer
  // l'animation demande un CHANGEMENT de valeur, et retaper l'onglet déjà
  // sélectionné doit rejouer l'effet comme sur iOS.
  const [taps, setTaps] = useState<number[]>(() => routes.map(() => 0));
  const select = useCallback(
    (index: number) => {
      setTaps((previous) =>
        previous.map((count, position) => (position === index ? count + 1 : count)),
      );
      onSelect(index);
    },
    [onSelect],
  );

  const { pan, pillCenter, pillStyle } = usePillAnimation(
    activeIndex,
    width,
    geometry,
    routes.length,
    select,
  );

  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const nextWidth = nativeEvent.layout.width;
    if (nextWidth !== width) setWidth(nextWidth);
  };

  return (
    <View style={[styles.bar, { height: geometry.barHeight }]} onLayout={onLayout}>
      {width > 0 ? (
        <>
          <CurvedSurface
            arc={geometry.arc}
            barHeight={geometry.barHeight}
            beads={geometry.beads}
            dark={dark}
            glass={glass}
            width={width}
          />

          <Animated.View style={[styles.pill, pillStyle]}>
            <GlassView
              glassEffectStyle="regular"
              isInteractive
              tintColor={dark ? '#0a0a0a' : '#fff'}
              style={[styles.pillFill, !glass && styles.pillFallback]}
            />
          </Animated.View>

          {routes.map((route, index) => {
            const x = geometry.tabCenters[index];
            const y = geometry.centerlineY(x);
            const dx = Math.min(
              Math.max(x - geometry.centerX, -geometry.halfSpan),
              geometry.halfSpan,
            );
            const tilt = Math.atan2(
              dx,
              Math.sqrt(Math.max(geometry.radius * geometry.radius - dx * dx, 0)),
            );
            return (
              <View
                key={route.key}
                pointerEvents="none"
                style={[
                  styles.iconBox,
                  {
                    left: x - ICON_BOX / 2,
                    top: y - ICON_BOX / 2,
                    transform: [{ rotate: `${tilt}rad` }],
                  },
                ]}
              >
                <LiquidTabIcon
                  dark={dark}
                  effect={TAP_EFFECTS[route.name] ?? DEFAULT_TAP_EFFECT}
                  icon={ICONS[route.name] ?? 'circle.fill'}
                  pillCenter={pillCenter}
                  slotWidth={geometry.slotWidth}
                  tap={taps[index] ?? 0}
                  x={x}
                />
              </View>
            );
          })}

          <GestureDetector gesture={pan}>
            <View style={[StyleSheet.absoluteFill, styles.pressRow]}>
              {routes.map((route, index) => (
                <Pressable
                  accessibilityLabel={route.name}
                  accessibilityRole="tab"
                  key={route.key}
                  onPress={() => select(index)}
                  style={styles.press}
                />
              ))}
            </View>
          </GestureDetector>
        </>
      ) : null}
    </View>
  );
}

const LiquidTabIcon = memo(function LiquidTabIcon({
  dark,
  effect,
  icon,
  pillCenter,
  slotWidth,
  tap,
  x,
}: {
  dark: boolean;
  effect: SymbolEffect;
  icon: SFSymbol;
  pillCenter: SharedValue<number>;
  slotWidth: number;
  tap: number;
  x: number;
}) {
  const activeStyle = useAnimatedStyle(() => {
    const distance = Math.abs(pillCenter.value - x);
    return {
      opacity: interpolate(
        distance,
        [0, slotWidth * 0.55],
        [1, 0],
        Extrapolation.CLAMP,
      ),
      transform: [
        {
          scale: interpolate(
            distance,
            [0, slotWidth * 0.55],
            [1.08, 1],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });
  const idleStyle = useAnimatedStyle(() => {
    const distance = Math.abs(pillCenter.value - x);
    return {
      opacity: interpolate(
        distance,
        [0, slotWidth * 0.55],
        [0, 1],
        Extrapolation.CLAMP,
      ),
    };
  });

  // Les deux calques portent le MÊME compteur d'appuis, donc la même animation
  // au même instant. N'animer que le calque actif aurait laissé un fantôme
  // immobile derrière lui pendant le fondu.
  //
  // Couleurs en dur plutôt qu'en `DynamicColorIOS` : le symbole est rendu par
  // SwiftUI maintenant, et sa prop `color` attend une couleur, pas un objet de
  // couleur dynamique de React Native. La barre connaît déjà le thème.
  return (
    <View style={styles.iconStack}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, idleStyle]}>
        <TabSymbol
          color={dark ? '#aeaeb2' : '#3a3a3c'}
          effect={effect}
          size={ICON_SIZE}
          symbol={icon}
          tap={tap}
        />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, activeStyle]}>
        <TabSymbol
          color={dark ? '#fff' : '#000'}
          effect={effect}
          size={ICON_SIZE}
          symbol={icon}
          tap={tap}
        />
      </Animated.View>
    </View>
  );
});

const CurvedSurface = memo(function CurvedSurface({
  arc,
  barHeight,
  beads,
  dark,
  glass,
  width,
}: {
  arc: Arc;
  barHeight: number;
  beads: Point[];
  dark: boolean;
  glass: boolean;
  width: number;
}) {
  const path = strokedArcPath(arc, THICKNESS);
  return (
    <>
      {glass ? (
        <GlassContainer spacing={26} style={StyleSheet.absoluteFill}>
          {beads.map((point, index) => (
            <GlassView
              glassEffectStyle="regular"
              key={index}
              style={[styles.bead, { left: point.x, top: point.y }]}
            />
          ))}
        </GlassContainer>
      ) : null}
      <Canvas pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height: barHeight }]}>
        <SkiaPath
          color={dark ? 'rgba(0,0,0,0.52)' : 'rgba(255,255,255,0.52)'}
          path={path}
          transform={[{ translateX: THICKNESS / 2 }, { translateY: THICKNESS / 2 }]}
        />
        <SkiaPath
          color="rgba(0,0,0,0.05)"
          path={path}
          style="stroke"
          strokeWidth={1}
          transform={[{ translateX: THICKNESS / 2 }, { translateY: THICKNESS / 2 }]}
        />
      </Canvas>
    </>
  );
});

// Reanimated SharedValues are intentionally mutable inside UI-thread worklets.
/* eslint-disable react-hooks/immutability */
function usePillAnimation(
  activeIndex: number,
  width: number,
  geometry: ReturnType<typeof useGeometry>,
  count: number,
  onSelect: (index: number) => void,
) {
  const pillLeft = useSharedValue(0);
  const pillRight = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const initialized = useSharedValue(false);

  useAnimatedReaction(
    () => ({
      activeIndex,
      pillWidth: geometry.pillWidth,
      slotWidth: geometry.slotWidth,
      width,
    }),
    (current, previous) => {
      if (current.width <= 0) return;
      if (
        previous &&
        current.activeIndex === previous.activeIndex &&
        current.width === previous.width
      ) {
        return;
      }
      const target =
        EDGE_PAD + current.slotWidth * (current.activeIndex + 0.5);
      const targetLeft = target - current.pillWidth / 2;
      const targetRight = target + current.pillWidth / 2;
      if (!initialized.value) {
        initialized.value = true;
        pillLeft.value = targetLeft;
        pillRight.value = targetRight;
        return;
      }
      const movingRight = targetLeft >= pillLeft.value;
      pillLeft.value = withSpring(
        targetLeft,
        movingRight ? SPRING_TRAIL : SPRING_LEAD,
      );
      pillRight.value = withSpring(
        targetRight,
        movingRight ? SPRING_LEAD : SPRING_TRAIL,
      );
    },
  );

  const pillCenter = useDerivedValue(() => (pillLeft.value + pillRight.value) / 2);
  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-10, 10])
    .onBegin(() => {
      dragStart.value = (pillLeft.value + pillRight.value) / 2;
    })
    .onUpdate(({ translationX, velocityX }) => {
      const center = Math.min(
        Math.max(dragStart.value + translationX, geometry.minCenter),
        geometry.maxCenter,
      );
      const movingRight = velocityX >= 0;
      pillLeft.value = withSpring(
        center - geometry.pillWidth / 2,
        movingRight ? SPRING_TRAIL : SPRING_LEAD,
      );
      pillRight.value = withSpring(
        center + geometry.pillWidth / 2,
        movingRight ? SPRING_LEAD : SPRING_TRAIL,
      );
    })
    .onEnd(({ translationX, velocityX }) => {
      const projected = Math.min(
        Math.max(
          dragStart.value + translationX + velocityX * 0.06,
          geometry.minCenter,
        ),
        geometry.maxCenter,
      );
      const index = Math.min(
        Math.max(Math.round((projected - EDGE_PAD) / geometry.slotWidth - 0.5), 0),
        count - 1,
      );
      const target = EDGE_PAD + geometry.slotWidth * (index + 0.5);
      pillLeft.value = withSpring(target - geometry.pillWidth / 2, SPRING_TRAIL);
      pillRight.value = withSpring(target + geometry.pillWidth / 2, SPRING_TRAIL);
      scheduleOnRN(onSelect, index);
    });
  const pillStyle = useAnimatedStyle(() => {
    const left = pillLeft.value;
    const pillWidth = Math.max(pillRight.value - left, PILL_HEIGHT);
    const center = left + pillWidth / 2;
    const dx = Math.min(
      Math.max(center - geometry.centerX, -geometry.halfSpan),
      geometry.halfSpan,
    );
    const yBase = Math.sqrt(
      Math.max(geometry.radius * geometry.radius - dx * dx, 0),
    );
    const scaleY = interpolate(
      pillWidth,
      [geometry.pillWidth, geometry.pillWidth * 2.4],
      [1, 0.74],
      Extrapolation.CLAMP,
    );
    return {
      left,
      top: geometry.centerY - yBase - PILL_HEIGHT / 2,
      width: pillWidth,
      transform: [{ rotate: `${Math.atan2(dx, yBase)}rad` }, { scaleY }],
    };
  });

  return { pan, pillCenter, pillStyle };
}
/* eslint-enable react-hooks/immutability */

function useGeometry(width: number, count: number) {
  return useMemo(() => {
    const innerWidth = Math.max(width - THICKNESS, 1);
    const arc = computeArc(innerWidth, ARC_HEIGHT);
    const centerX = width / 2;
    const centerY = arc.center.y + THICKNESS / 2;
    const halfSpan = innerWidth / 2;
    const slotWidth = count > 0 ? (width - EDGE_PAD * 2) / count : 1;
    const tabCenters = Array.from(
      { length: count },
      (_, index) => EDGE_PAD + slotWidth * (index + 0.5),
    );
    const centerlineY = (x: number) => {
      const dx = Math.min(Math.max(x - centerX, -halfSpan), halfSpan);
      return centerY - Math.sqrt(Math.max(arc.radius * arc.radius - dx * dx, 0));
    };
    const beadCount = Math.max(2, Math.round(innerWidth / 16));
    const beads = Array.from({ length: beadCount }, (_, index) =>
      pointOnArc(arc, index / (beadCount - 1)),
    );
    return {
      arc,
      barHeight: ARC_HEIGHT + THICKNESS,
      beads,
      centerX,
      centerY,
      centerlineY,
      halfSpan,
      maxCenter: tabCenters[count - 1] ?? 0,
      minCenter: tabCenters[0] ?? 0,
      pillWidth: Math.min(slotWidth * 1.12, 84),
      radius: arc.radius,
      slotWidth,
      tabCenters,
    };
  }, [count, width]);
}

function computeArc(width: number, height: number): Arc {
  const x = width / 2;
  const y = Math.max(height, 0.0001);
  const phi = Math.atan2(x, y);
  const radius = Math.sqrt(x * x + y * y) / 2 / Math.cos(phi);
  const theta = 2 * (Math.PI / 2 - phi);
  return {
    center: { x, y: radius },
    radius,
    startAngle: (3 * Math.PI) / 2 - theta,
    endAngle: (3 * Math.PI) / 2 + theta,
  };
}

function pointOnArc(arc: Arc, progress: number): Point {
  const angle = arc.startAngle + (arc.endAngle - arc.startAngle) * progress;
  return {
    x: arc.center.x + arc.radius * Math.cos(angle),
    y: arc.center.y + arc.radius * Math.sin(angle),
  };
}

function strokedArcPath(arc: Arc, thickness: number) {
  const half = thickness / 2;
  const point = (radius: number, angle: number) => ({
    x: arc.center.x + radius * Math.cos(angle),
    y: arc.center.y + radius * Math.sin(angle),
  });
  const outerStart = point(arc.radius + half, arc.startAngle);
  const outerEnd = point(arc.radius + half, arc.endAngle);
  const innerStart = point(arc.radius - half, arc.startAngle);
  const innerEnd = point(arc.radius - half, arc.endAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${arc.radius + half} ${arc.radius + half} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `A ${half} ${half} 0 0 1 ${innerEnd.x} ${innerEnd.y}`,
    `A ${arc.radius - half} ${arc.radius - half} 0 0 0 ${innerStart.x} ${innerStart.y}`,
    `A ${half} ${half} 0 0 1 ${outerStart.x} ${outerStart.y}`,
    'Z',
  ].join(' ');
}


const styles = StyleSheet.create({
  bar: {
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  bead: {
    position: 'absolute',
    width: THICKNESS,
    height: THICKNESS,
    borderRadius: THICKNESS / 2,
  },
  pill: {
    position: 'absolute',
    height: PILL_HEIGHT,
  },
  pillFill: {
    flex: 1,
    borderRadius: PILL_HEIGHT / 2,
  },
  pillFallback: {
    backgroundColor: 'rgba(99,99,102,0.5)',
  },
  iconBox: {
    position: 'absolute',
    width: ICON_BOX,
    height: ICON_BOX,
  },
  iconStack: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressRow: {
    flexDirection: 'row',
  },
  press: {
    flex: 1,
  },
});
