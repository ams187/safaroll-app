import { useCallback } from "react";
import { useSharedValue, useDerivedValue, useFrameCallback } from "react-native-reanimated";
import type {
  ISiriToggleOptions,
  IUseSiriUniformsOptions,
  IUseSiriUniformsResult,
  IShaderUniforms,
} from "./types";
import {
  DEFAULT_BORDER,
  DEFAULT_GLOW,
  DEFAULT_NOISE,
  DEFAULT_SHIMMER,
  DEFAULT_WAVE,
  MAX_COLORS,
  ZERO3,
} from "./const";
import { hexToRgb, mergeConfig } from "./helpers";

function useSiriUniforms<T extends IUseSiriUniformsOptions>({
  layout,
  defaultWave,
  defaultNoise,
  defaultGlow,
  defaultShimmer,
  defaultBorder,
}: T): IUseSiriUniformsResult {
  const iTime = useSharedValue<number>(0);
  const intensity = useSharedValue<number>(0);

  const frameCallback = useFrameCallback((frameInfo) => {
    iTime.set(frameInfo.timeSinceFirstFrame / 1000);
  }, false);

  const uMargin = useSharedValue<number>(DEFAULT_BORDER.margin);
  const uExcess = useSharedValue<number>(DEFAULT_BORDER.spread);
  const uRadius = useSharedValue<number>(DEFAULT_BORDER.radius);

  const uWaveSpeed = useSharedValue<number>(DEFAULT_WAVE.speed);
  const uWaveStrength = useSharedValue<number>(DEFAULT_WAVE.strength);
  const uWaveOriginX = useSharedValue<number>(DEFAULT_WAVE.origin[0]);
  const uWaveOriginY = useSharedValue<number>(DEFAULT_WAVE.origin[1]);

  const uNoiseScale = useSharedValue<number>(DEFAULT_NOISE.scale);
  const uNoiseSpeed = useSharedValue<number>(DEFAULT_NOISE.speed);
  const uNoiseStrength = useSharedValue<number>(DEFAULT_NOISE.strength);

  const uGlowSpeed = useSharedValue<number>(DEFAULT_GLOW.speed);
  const uGlowSaturation = useSharedValue<number>(DEFAULT_GLOW.saturation);
  const uGlowLightness = useSharedValue<number>(DEFAULT_GLOW.lightness);

  const uShimmerAmount = useSharedValue<number>(DEFAULT_SHIMMER.amount);
  const uShimmerSpeed = useSharedValue<number>(DEFAULT_SHIMMER.speed);

  const uColorCount = useSharedValue<number>(0);
  const uColor0 = useSharedValue<[number, number, number]>(ZERO3);
  const uColor1 = useSharedValue<[number, number, number]>(ZERO3);
  const uColor2 = useSharedValue<[number, number, number]>(ZERO3);
  const uColor3 = useSharedValue<[number, number, number]>(ZERO3);
  const uColor4 = useSharedValue<[number, number, number]>(ZERO3);
  const uColor5 = useSharedValue<[number, number, number]>(ZERO3);
  const uColor6 = useSharedValue<[number, number, number]>(ZERO3);
  const uColor7 = useSharedValue<[number, number, number]>(ZERO3);

  const uniforms = useDerivedValue<IShaderUniforms>(() => ({
    iTime: iTime.get(),
    intensity: intensity.get(),
    iResolution: [layout.width, layout.height] as const,
    uMargin: uMargin.get(),
    uExcess: uExcess.get(),
    uRadius: uRadius.get(),
    uWaveSpeed: uWaveSpeed.get(),
    uWaveStrength: uWaveStrength.get(),
    uWaveOrigin: [uWaveOriginX.get(), uWaveOriginY.get()] as const,
    uNoiseScale: uNoiseScale.get(),
    uNoiseSpeed: uNoiseSpeed.get(),
    uNoiseStrength: uNoiseStrength.get(),
    uGlowSpeed: uGlowSpeed.get(),
    uGlowSaturation: uGlowSaturation.get(),
    uGlowLightness: uGlowLightness.get(),
    uShimmerAmount: uShimmerAmount.get(),
    uShimmerSpeed: uShimmerSpeed.get(),
    uColorCount: uColorCount.get(),
    uColor0: uColor0.get(),
    uColor1: uColor1.get(),
    uColor2: uColor2.get(),
    uColor3: uColor3.get(),
    uColor4: uColor4.get(),
    uColor5: uColor5.get(),
    uColor6: uColor6.get(),
    uColor7: uColor7.get(),
  }));

  const applyConfig = useCallback(
    (override?: ISiriToggleOptions) => {
      const { wave, noise, glow, shimmer, border } = mergeConfig(
        {
          wave: defaultWave,
          noise: defaultNoise,
          glow: defaultGlow,
          shimmer: defaultShimmer,
          border: defaultBorder,
        },
        override,
      );

      uMargin.set(border.margin);
      uExcess.set(border.spread);
      uRadius.set(border.radius);

      uWaveSpeed.set(wave.speed);
      uWaveStrength.set(wave.strength);
      uWaveOriginX.set(wave.origin[0]);
      uWaveOriginY.set(wave.origin[1]);

      uNoiseScale.set(noise.scale);
      uNoiseSpeed.set(noise.speed);
      uNoiseStrength.set(noise.strength);

      uGlowSpeed.set(glow.speed);
      uGlowSaturation.set(glow.saturation);
      uGlowLightness.set(glow.lightness);

      uShimmerAmount.set(shimmer.amount);
      uShimmerSpeed.set(shimmer.speed);

      const colorSlots = [
        uColor0,
        uColor1,
        uColor2,
        uColor3,
        uColor4,
        uColor5,
        uColor6,
        uColor7,
      ];
      const colors =
        glow.colors && glow.colors.length > 0
          ? glow.colors.slice(0, MAX_COLORS)
          : [];
      uColorCount.set(colors.length);
      for (let i = 0; i < MAX_COLORS; i++) {
        colorSlots[i].value =
          i < colors.length ? hexToRgb<string>(colors[i]) : ZERO3;
      }
    },
    [
      defaultWave,
      defaultNoise,
      defaultGlow,
      defaultShimmer,
      defaultBorder,
      uMargin,
      uExcess,
      uRadius,
      uWaveSpeed,
      uWaveStrength,
      uWaveOriginX,
      uWaveOriginY,
      uNoiseScale,
      uNoiseSpeed,
      uNoiseStrength,
      uGlowSpeed,
      uGlowSaturation,
      uGlowLightness,
      uShimmerAmount,
      uShimmerSpeed,
      uColorCount,
      uColor0,
      uColor1,
      uColor2,
      uColor3,
      uColor4,
      uColor5,
      uColor6,
      uColor7,
    ],
  );

  return { iTime, intensity, uniforms, applyConfig, frameCallback };
}
export { useSiriUniforms };
