// @ts-check
import React, { memo, useCallback, useRef, useState } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import {
  Canvas,
  Fill,
  Shader,
  ImageShader,
  makeImageFromView,
  type SkImage,
} from "@shopify/react-native-skia";
import {
  useSharedValue,
  withTiming,
  Easing,
  useAnimatedStyle,
} from "react-native-reanimated";
import Animated from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { SiriContext } from "./context";
import { SHADER_SOURCE } from "./conf";
import { useSiriUniforms } from "./use-siri-uniforms";
import type { IAppleIntelligenceProvider, ISiriToggleOptions } from "./types";

export const SiriProvider: React.FC<IAppleIntelligenceProvider> &
  React.FunctionComponent<IAppleIntelligenceProvider> = memo<
  IAppleIntelligenceProvider & React.ComponentProps<typeof SiriProvider>
>(
  ({
    children,
    introDuration = 1200,
    outroDuration = 600,
    wave: defaultWave,
    noise: defaultNoise,
    glow: defaultGlow,
    shimmer: defaultShimmer,
    border: defaultBorder,
  }: IAppleIntelligenceProvider & React.ComponentProps<typeof SiriProvider>):
    | (React.ReactNode & React.JSX.Element & React.ReactElement)
    | null => {
    const viewRef = useRef<View>(null);
    const [snapshot, setSnapshot] = useState<SkImage | null>(null);
    const [active, setActive] = useState<boolean>(false);
    const [layout, setLayout] = useState<{ width: number; height: number }>({
      width: 0,
      height: 0,
    });
    const busyRef = useRef<boolean>(false);

    const [overlayContent, setOverlayContent] = useState<React.ReactNode>(null);

    const overlayOpacity = useSharedValue<number>(0);

    const { iTime, intensity, uniforms, applyConfig, frameCallback } = useSiriUniforms({
      layout,
      defaultWave,
      defaultNoise,
      defaultGlow,
      defaultShimmer,
      defaultBorder,
    });

    const overlayStyle = useAnimatedStyle<
      Required<Partial<Pick<ViewStyle, "opacity">>>
    >(() => ({
      opacity: overlayOpacity.get(),
    }));

    const dismiss = useCallback(() => {
      frameCallback.setActive(false);
      busyRef.current = false;
      setActive(false);
      setSnapshot(null);
      setOverlayContent(null);
    }, [frameCallback]);

    const toggle = useCallback(
      async (options?: ISiriToggleOptions) => {
        if (active) {
          busyRef.current = true;
          intensity.set(
            withTiming<number>(
              0,
              { duration: outroDuration, easing: Easing.out(Easing.quad) },
              (finished) => {
                if (!finished) return;
                overlayOpacity.set(
                  withTiming(0, { duration: 200 }, (done) => {
                    if (done) scheduleOnRN(dismiss);
                  }),
                );
              },
            ),
          );
          return;
        }

        if (
          busyRef.current ||
          !viewRef.current ||
          layout.width === 0 ||
          layout.height === 0
        )
          return;
        busyRef.current = true;

        try {
          const image = await makeImageFromView(viewRef);
          if (!image) {
            busyRef.current = false;
            return;
          }

          applyConfig(options);
          intensity.set(0);
          iTime.set(0);
          overlayOpacity.set(1);

          setSnapshot(image);
          setActive(true);
          frameCallback.setActive(true);
          busyRef.current = false;

          intensity.set(withTiming(1, {
            duration: introDuration,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
          }));
        } catch (err) {
          busyRef.current = false;
          console.warn("[SiriProvider]", err);
        }
      },
      [
        active,
        layout,
        introDuration,
        outroDuration,
        applyConfig,
        frameCallback,
        dismiss,
        intensity,
        overlayOpacity,
        iTime,
      ],
    );

    const setOverlay = useCallback((content: React.ReactNode) => {
      setOverlayContent(content);
    }, []);

    return (
      <SiriContext.Provider value={{ toggle, isActive: active, setOverlay }}>
        {/* The wrapper is load-bearing. A Context.Provider renders its children
            straight into the *parent* layout, so without it the overlay's
            `inset: 0` resolved against whatever surrounds the provider rather
            than against the view it snapshotted — painting the captured content
            a second time, offset by however much else that parent contained. */}
        <View style={styles.container}>
          <View
            ref={viewRef}
            style={styles.container}
            collapsable={false}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setLayout({ width, height });
            }}
          >
            {children}
          </View>
          {active && snapshot && layout.width > 0 && (
            <Animated.View
              style={[styles.overlay, overlayStyle]}
              pointerEvents="none"
            >
              <Canvas style={{ width: layout.width, height: layout.height }}>
                <Fill>
                  <Shader source={SHADER_SOURCE} uniforms={uniforms}>
                    <ImageShader
                      image={snapshot}
                      fit="cover"
                      width={layout.width}
                      height={layout.height}
                    />
                  </Shader>
                </Fill>
              </Canvas>
            </Animated.View>
          )}
          {overlayContent}
        </View>
      </SiriContext.Provider>
    );
  },
);

SiriProvider.displayName = 'SiriProvider';

export default memo<
  React.FC<IAppleIntelligenceProvider> &
    React.FunctionComponent<IAppleIntelligenceProvider> &
    React.ComponentProps<typeof SiriProvider>
>(SiriProvider);

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Spelled out rather than `StyleSheet.absoluteFillObject`, which RN 0.86 no
  // longer types. Same rect, and it survives the next upstream copy-paste.
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9999 },
});
