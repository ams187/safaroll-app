import {
  Blur,
  Canvas,
  ColorMatrix,
  Group,
  Image,
  Paint,
  makeImageFromView,
  rect,
  rrect,
  type SkImage,
} from '@shopify/react-native-skia';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

type PopoutDirection = 'top-left' | 'top-right';

type Dimensions = { height: number; width: number };

export function LiquidPopup({
  button,
  cacheKeys = [],
  direction = 'top-left',
  panel,
  toggled,
}: {
  button: ReactElement;
  cacheKeys?: readonly (boolean | number | string | null)[];
  direction?: PopoutDirection;
  panel: ReactElement;
  toggled: boolean;
}) {
  const [panelImage, setPanelImage] = useState<SkImage | null>(null);
  const [buttonImage, setButtonImage] = useState<SkImage | null>(null);
  const [panelSize, setPanelSize] = useState<Dimensions>({ height: 0, width: 0 });
  const [buttonSize, setButtonSize] = useState<Dimensions>({ height: 0, width: 0 });
  const panelRef = useRef<View>(null);
  const buttonRef = useRef<View>(null);
  const capturing = useRef(false);
  const progress = useSharedValue(toggled ? 1 : 0);
  const cacheSignature = cacheKeys.join('|');

  const padding = 18;
  const gap = 6;
  const canvasWidth = panelSize.width + buttonSize.width + gap + padding;
  const canvasHeight = Math.max(panelSize.height + buttonSize.height + gap, panelSize.height) + padding;
  const buttonX = direction === 'top-left' ? canvasWidth - buttonSize.width - padding / 2 : padding / 2;
  const buttonY = canvasHeight - buttonSize.height - padding / 2;
  const panelEndX = direction === 'top-left' ? padding / 2 : canvasWidth - panelSize.width - padding / 2;
  const panelEndY = buttonY - panelSize.height - gap;

  const capture = useCallback(async () => {
    if (!panelRef.current || !buttonRef.current || capturing.current) return;
    capturing.current = true;
    try {
      const [nextPanel, nextButton] = await Promise.all([
        makeImageFromView(panelRef),
        makeImageFromView(buttonRef),
      ]);
      setPanelImage(nextPanel);
      setButtonImage(nextButton);
    } catch (error) {
      console.warn('Liquid menu capture failed:', error);
    } finally {
      capturing.current = false;
    }
  }, []);

  useEffect(() => {
    progress.value = withTiming(toggled ? 1 : 0, {
      duration: toggled ? 520 : 420,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, toggled]);

  useEffect(() => {
    if (panelSize.width === 0 || buttonSize.width === 0) return;
    const timer = setTimeout(() => void capture(), 16);
    return () => clearTimeout(timer);
  }, [buttonSize.width, cacheSignature, capture, panelSize.width]);

  const rectX = useDerivedValue(() =>
    interpolate(
      progress.value,
      [0, 1],
      [buttonX + buttonSize.width / 4, panelEndX],
      Extrapolation.CLAMP,
    ),
  );
  const rectY = useDerivedValue(() =>
    interpolate(
      progress.value,
      [0, 1],
      [buttonY + buttonSize.height / 4, panelEndY],
      Extrapolation.CLAMP,
    ),
  );
  const rectWidth = useDerivedValue(() =>
    interpolate(progress.value, [0, 1], [buttonSize.width / 2, panelSize.width]),
  );
  const rectHeight = useDerivedValue(() =>
    interpolate(progress.value, [0, 1], [buttonSize.height / 2, panelSize.height]),
  );
  const blur = useDerivedValue(() =>
    interpolate(progress.value, [0, 0.5, 1], [0, 24, 0], Extrapolation.CLAMP),
  );
  const matrix = useDerivedValue(() => {
    const alpha = interpolate(progress.value, [0, 1], [45, 1], Extrapolation.CLAMP);
    const bias = interpolate(progress.value, [0, 1], [-11, 0], Extrapolation.CLAMP);
    return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, alpha, bias];
  });
  const clip = useDerivedValue(() => {
    const radius = interpolate(
      progress.value,
      [0, 1],
      [buttonSize.height / 2, 24],
      Extrapolation.CLAMP,
    );
    return rrect(rect(rectX.value, rectY.value, rectWidth.value, rectHeight.value), radius, radius);
  });

  const panelStyle = useAnimatedStyle(() => ({
    left: panelEndX,
    position: 'absolute',
    top: progress.value === 1 ? panelEndY : 10_000,
  }));
  const buttonStyle = useAnimatedStyle(() => ({
    left: buttonX,
    position: 'absolute',
    top: progress.value === 0 ? buttonY : 10_000,
  }));

  const onPanelLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    setPanelSize(nativeEvent.layout);
  };
  const onButtonLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    setButtonSize(nativeEvent.layout);
  };

  return (
    <View style={{ height: canvasHeight, width: canvasWidth }}>
      <Canvas pointerEvents="none" style={{ height: canvasHeight, width: canvasWidth }}>
        <Group
          layer={
            <Paint>
              <Blur blur={blur} />
              <ColorMatrix matrix={matrix} />
            </Paint>
          }
        >
          <Group clip={clip}>
            <Image image={panelImage} height={rectHeight} width={rectWidth} x={rectX} y={rectY} />
          </Group>
          <Image
            height={buttonSize.height}
            image={buttonImage}
            width={buttonSize.width}
            x={buttonX}
            y={buttonY}
          />
        </Group>
      </Canvas>

      <View pointerEvents="box-none" style={{ height: canvasHeight, position: 'absolute', width: canvasWidth }}>
        <Animated.View
          collapsable={false}
          onLayout={onPanelLayout}
          pointerEvents={toggled ? 'auto' : 'none'}
          ref={panelRef}
          style={panelStyle}
        >
          {panel}
        </Animated.View>
        <Animated.View
          collapsable={false}
          onLayout={onButtonLayout}
          pointerEvents={toggled ? 'none' : 'auto'}
          ref={buttonRef}
          style={buttonStyle}
        >
          {button}
        </Animated.View>
      </View>
    </View>
  );
}
