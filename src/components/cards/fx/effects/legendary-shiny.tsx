import { Fragment } from 'react';
import { LinearGradient, RadialGradient, Rect } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { ShineLayer } from './base';
import { ShiftGlitter } from './glitter-foil';
import type { EffectProps } from './types';
import { textureImages, useTexture } from '../lib/assets';
import { farthestCornerRadius, pct } from '../lib/css';

/** Bright shiny foil for authored full art: sparkle and light, never ink-darkening. */
export function LegendaryShiny({ u }: EffectProps) {
  const glitter = useTexture(textureImages.glitter);
  const center = useDerivedValue(() => ({
    x: pct(u.pointerX.value, u.w),
    y: pct(u.pointerY.value, u.h),
  }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, u.w), pct(u.pointerY.value, u.h), u.w, u.h),
  );
  const sweepStart = useDerivedValue(() => ({
    x: (u.pointerFromLeft.value - 0.55) * u.w,
    y: 0,
  }));
  const sweepEnd = useDerivedValue(() => ({
    x: (u.pointerFromLeft.value + 0.45) * u.w,
    y: u.h,
  }));
  const shineOpacity = useDerivedValue(() =>
    u.cardOpacity.value * (0.24 + u.pointerFromCenter.value * 0.24),
  );
  const starOpacity = useDerivedValue(() =>
    u.cardOpacity.value * (0.3 + u.pointerFromCenter.value * 0.34),
  );

  return (
    <Fragment>
      <ShineLayer w={u.w} h={u.h} opacity={shineOpacity} blendMode="screen">
        <Rect x={0} y={0} width={u.w} height={u.h}>
          <LinearGradient
            start={sweepStart}
            end={sweepEnd}
            colors={['rgba(255,255,255,0)', 'rgba(255,238,184,0.58)', 'rgba(207,244,255,0.32)', 'rgba(255,255,255,0)']}
            positions={[0, 0.42, 0.58, 1]}
          />
        </Rect>
        <Rect x={0} y={0} width={u.w} height={u.h}>
          <RadialGradient
            c={center}
            r={radius}
            colors={['rgba(255,255,255,0.38)', 'rgba(255,232,173,0.12)', 'rgba(255,255,255,0)']}
            positions={[0, 0.28, 0.72]}
          />
        </Rect>
      </ShineLayer>

      {glitter ? (
        <ShineLayer w={u.w} h={u.h} opacity={starOpacity} blendMode="colorDodge">
          <ShiftGlitter img={glitter} u={u} sign={1} />
        </ShineLayer>
      ) : null}
    </Fragment>
  );
}
