import React from 'react';
import { Appearance, View, type ColorValue, type ViewProps } from 'react-native';
import { isLiquidGlassSupported, LiquidGlassView } from '@callstack/liquid-glass';
import { theme } from '../theme';

type GlassProps = ViewProps & { interactive?: boolean; tintColor?: ColorValue };

export function Glass({ interactive, tintColor, style, children, ...rest }: GlassProps) {
  if (isLiquidGlassSupported) {
    return (
      <LiquidGlassView
        interactive={interactive}
        effect="regular"
        colorScheme={Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'}
        tintColor={tintColor}
        style={style}
        {...rest}
      >
        {children}
      </LiquidGlassView>
    );
  }
  return (
    <View style={[{ backgroundColor: tintColor ?? theme.glassFallbackBackground }, style]} {...rest}>
      {children}
    </View>
  );
}
