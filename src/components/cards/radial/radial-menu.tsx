import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  // FadeIn and FadeOut come back with the parked hovered-action label below.
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

// Implemented from the official brief at https://rnmotion.dev/animations/radial-menu.md
// Its "Do not change these behaviors" section is honoured verbatim: 500ms long
// press, pan matched with activateAfterLongPress(500), release tracked through
// an incrementing signal, runOnJS for haptics/selection/cancel/measure, and
// entrance damping kept at 80 so buttons never overshoot.

/** Icon shape consumed by the radial buttons: just a size + color. */
export interface RadialIconProps {
  size: number;
  color: string;
}

export interface RadialActionDef {
  id: string;
  icon: (props: RadialIconProps) => React.ReactElement;
  title: string;
}

export function makeIcon(name: React.ComponentProps<typeof Ionicons>['name']) {
  return function RadialIcon({ color, size }: RadialIconProps) {
    return <Ionicons color={color} name={name} size={size} />;
  };
}

const BUTTON_RADIUS = 28;
const DEFAULT_RADIUS = 96;
const DEFAULT_ANGLE_STEP_DEG = 40;
const BASE_ICON_SIZE = 22;

function lerpAngle(a: number, b: number, t: number) {
  'worklet';
  return a + (b - a) * t;
}

interface RadialButtonModel {
  id: string;
  icon: RadialActionDef['icon'];
  pos: { x: number; y: number };
  title: string;
}

function RadialButton({
  animationProgress,
  button,
  cursorX,
  cursorY,
  hoveredId,
  pressX,
  pressY,
}: {
  animationProgress: SharedValue<number>;
  button: RadialButtonModel;
  cursorX: SharedValue<number>;
  cursorY: SharedValue<number>;
  hoveredId: SharedValue<string | null>;
  pressX: number;
  pressY: number;
}) {
  const [currentIconSize, setCurrentIconSize] = useState(BASE_ICON_SIZE);
  const Icon = button.icon;

  const proximityScale = useDerivedValue(() => {
    const dx = cursorX.get() - button.pos.x;
    const dy = cursorY.get() - button.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const normalized = Math.max(0, Math.min(1, 1 - dist / (BUTTON_RADIUS * 2)));
    return 1 + normalized * 0.4;
  });

  // The icon size follows proximity, bridged into React state as the guide does.
  useAnimatedReaction(
    () => proximityScale.get() * BASE_ICON_SIZE,
    (size) => {
      runOnJS(setCurrentIconSize)(Math.round(size));
    },
  );

  // Position, size and proximity in one style. `left`/`top`/`width`/`height` are
  // intentional per the guide: the button count is tiny and the hit target has
  // to grow with the visual circle.
  const animatedButtonStyle = useAnimatedStyle(() => {
    const progress = animationProgress.get();
    const startX = pressX - BUTTON_RADIUS;
    const startY = pressY - BUTTON_RADIUS;
    const endX = button.pos.x - BUTTON_RADIUS;
    const endY = button.pos.y - BUTTON_RADIUS;

    const currentX = startX + (endX - startX) * progress;
    const currentY = startY + (endY - startY) * progress;

    const cx = cursorX.get();
    const cy = cursorY.get();
    const dx = cx - button.pos.x;
    const dy = cy - button.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const normalized = Math.max(0, Math.min(1, 1 - dist / (BUTTON_RADIUS * 2)));
    const proximity = 1 + normalized * 0.4;

    const vx = endX - startX;
    const vy = endY - startY;
    const vlen = Math.max(1, Math.sqrt(vx * vx + vy * vy));
    const closeness = Math.max(0, Math.min(1, (proximity - 1) / 0.4));
    const offset = 32 * closeness * closeness * progress;

    const size = BUTTON_RADIUS * 2 * progress * proximity;

    return {
      left: currentX + (vx / vlen) * offset,
      top: currentY + (vy / vlen) * offset,
      opacity: progress,
      width: size,
      height: size,
      borderRadius: size,
    };
  });

  // Guide, "Button visuals": active icon dark on a light circle, inactive icon
  // white on a dark circle. Both the circle and the glyph swap.
  const circleStyle = useAnimatedStyle(() => ({
    backgroundColor: hoveredId.get() === button.id ? '#FFFFFF' : '#1C1C1E',
  }));

  const activeIconStyle = useAnimatedStyle(() => ({
    opacity: hoveredId.get() === button.id ? 1 : 0,
  }));

  const inactiveIconStyle = useAnimatedStyle(() => ({
    opacity: hoveredId.get() === button.id ? 0 : 1,
  }));

  return (
    // Nothing in the fan takes touches: every finger goes to the overlay's pan,
    // which is what tracks the cursor and decides the selection on release. In
    // the reference the opening finger is already captured by the card, so its
    // buttons never had to be transparent to touch — a fan opened by tap does.
    <Animated.View
      pointerEvents="none"
      style={[styles.button, animatedButtonStyle, circleStyle]}
    >
      <Animated.View style={[styles.iconLayer, activeIconStyle]}>
        <Icon color="#1C1C1E" size={currentIconSize} />
      </Animated.View>
      <Animated.View style={[styles.iconLayer, inactiveIconStyle]}>
        <Icon color="#FFFFFF" size={currentIconSize} />
      </Animated.View>
    </Animated.View>
  );
}

export function RadialMenu({
  actions,
  angleStepDeg = DEFAULT_ANGLE_STEP_DEG,
  cursorX,
  cursorY,
  onCancel,
  onSelect,
  pressX,
  pressY,
  radius = DEFAULT_RADIUS,
  releaseSignal,
}: {
  actions: RadialActionDef[];
  angleStepDeg?: number;
  cursorX: SharedValue<number>;
  cursorY: SharedValue<number>;
  onCancel: () => void;
  onSelect: (id: string) => void;
  pressX: number;
  pressY: number;
  radius?: number;
  releaseSignal: SharedValue<number>;
}) {
  const { height, width } = useWindowDimensions();
  const hoveredId = useSharedValue<string | null>(null);
  const lastHapticId = useSharedValue<string | null>(null);

  // All buttons share one entrance progress, owned here as the guide specifies.
  const animationProgress = useSharedValue(0);
  const hasAnimatedIn = useRef(false);
  // Parked. The big hovered-action label exists in the demo video but in no
  // published source, so it was reconstructed from a screenshot — size and
  // placement are guesses. Uncomment this, `titleById`, the `setHoveredTitle`
  // call in the hover reaction, and the <Animated.Text> below to bring it back.
  // const [hoveredTitle, setHoveredTitle] = useState<string | null>(null);

  useEffect(() => {
    if (!hasAnimatedIn.current) {
      hasAnimatedIn.current = true;
      animationProgress.set(withSpring(1, { damping: 80 }));
    }
  }, [animationProgress]);

  // The menu picks a base angle from the press location so buttons fan away
  // from the nearest edge.
  const baseAngleDeg = useMemo(() => {
    const cx = width / 2;
    const isTopQuarter = pressY < height / 4;
    const isCenterBand = Math.abs(pressX - cx) < width * 0.1;

    const centerAngle = isTopQuarter ? 180 : 0;
    const leftFar = isTopQuarter ? 230 : 310;
    const rightFar = isTopQuarter ? 120 : 60;
    const dxNorm = Math.min(1, Math.abs(pressX - cx) / (width / 2));

    let userAngle = centerAngle;
    if (!isCenterBand) {
      userAngle =
        pressX < cx
          ? lerpAngle(centerAngle, leftFar, dxNorm)
          : lerpAngle(centerAngle, rightFar, dxNorm);
    }

    return (270 - userAngle + 360) % 360;
  }, [height, pressX, pressY, width]);

  const anglesDeg = useMemo(() => {
    const half = (actions.length - 1) / 2;
    return Array.from(
      { length: actions.length },
      (_, i) => baseAngleDeg + (i - half) * angleStepDeg,
    );
  }, [actions.length, angleStepDeg, baseAngleDeg]);

  const buttons = useMemo<RadialButtonModel[]>(() => {
    const toXY = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return { x: pressX + radius * Math.cos(rad), y: pressY + radius * Math.sin(rad) };
    };
    return actions.map((action, i) => ({
      icon: action.icon,
      id: action.id,
      pos: toXY(anglesDeg[i]),
      title: action.title,
    }));
  }, [actions, anglesDeg, pressX, pressY, radius]);

  const buttonCenters = useMemo(
    () => buttons.map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y })),
    [buttons],
  );

  // const titleById = useMemo(
  //   () => Object.fromEntries(actions.map((action) => [action.id, action.title])),
  //   [actions],
  // );

  // Track the nearest button center while the finger moves.
  useAnimatedReaction(
    () => ({ x: cursorX.get(), y: cursorY.get() }),
    (pos) => {
      let nearestId: string | null = null;
      let nearestDist2 = Infinity;
      const threshold2 = (BUTTON_RADIUS * 3) ** 2;

      for (const button of buttonCenters) {
        const dx = pos.x - button.x;
        const dy = pos.y - button.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < nearestDist2) {
          nearestDist2 = dist2;
          nearestId = button.id;
        }
      }

      const active = nearestId && nearestDist2 <= threshold2 ? nearestId : null;

      if (hoveredId.get() !== active) {
        hoveredId.set(active);
        // runOnJS(setHoveredTitle)(active ? (titleById[active] ?? null) : null);
        if (active && lastHapticId.get() !== active) {
          lastHapticId.set(active);
          runOnJS(Haptics.selectionAsync)();
        } else if (!active) {
          lastHapticId.set(null);
        }
      }
    },
  );

  // On release, either select the hovered action or cancel.
  useAnimatedReaction(
    () => releaseSignal.get(),
    (value, previous) => {
      if (previous == null || value === previous) return;

      const hovered = hoveredId.get();
      if (hovered) {
        runOnJS(Haptics.selectionAsync)();
        runOnJS(onSelect)(hovered);
      } else {
        runOnJS(onCancel)();
      }
    },
  );

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* One big label in the bottom-right naming the action under the finger.
          {hoveredTitle ? (
            <Animated.Text
              entering={FadeIn.duration(120)}
              exiting={FadeOut.duration(100)}
              key={hoveredTitle}
              numberOfLines={1}
              style={styles.hoveredTitle}
            >
              {hoveredTitle.toUpperCase()}
            </Animated.Text>
          ) : null} */}
      {buttons.map((button) => (
        <RadialButton
          animationProgress={animationProgress}
          button={button}
          cursorX={cursorX}
          cursorY={cursorY}
          hoveredId={hoveredId}
          key={button.id}
          pressX={pressX}
          pressY={pressY}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 6px 16px -4px rgba(0, 0, 0, 0.45)',
  },
  iconLayer: { position: 'absolute' },
  // hoveredTitle: {
  //   position: 'absolute',
  //   right: 24,
  //   bottom: 72,
  //   color: '#FFFFFF',
  //   fontSize: 40,
  //   fontWeight: '900',
  //   letterSpacing: -0.5,
  // },
});
