import { APP_NAME } from '@/constants/app';
import { BalloonText } from 'pink-balloon-font';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Parchment glyphs, recoloured ahead of time by
 * `scripts/build-wordmark-parchment.sh`.
 *
 * Not `tintColor`: that flattens the balloon to a silhouette and throws away
 * the gloss, which is the whole logo. The script bakes in the CSS `color`
 * blend instead — parchment's hue over the glyph's own luminance — so the
 * inflation and the highlights survive the palette change.
 *
 * Metro resolves `require` at build time, so the map is written out by hand.
 * It only covers the letters of the app name, which is the only word this
 * component ever draws.
 */
const PARCHMENT: Record<string, number> = {
  A: require('../../assets/wordmark/A.png'),
  F: require('../../assets/wordmark/F.png'),
  L: require('../../assets/wordmark/L.png'),
  O: require('../../assets/wordmark/O.png'),
  R: require('../../assets/wordmark/R.png'),
  S: require('../../assets/wordmark/S.png'),
};

/** Advances from `pink-balloon-font/assets/font.json`, in its 256 em. */
const ADVANCE: Record<string, number> = { A: 194, F: 158, L: 147, O: 163, R: 147, S: 160 };
const EM = 256;

export function Wordmark({
  letterSpacing = -3,
  size = 48,
  style,
  variant = 'pink',
}: {
  letterSpacing?: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
  /**
   * `parchment` for the app's own surfaces, where the palette carries no hue.
   * `pink` stays on the booster: its pack art is bright cream exactly where the
   * wordmark sits, and parchment on parchment would vanish.
   */
  variant?: 'parchment' | 'pink';
}) {
  const text = APP_NAME.toUpperCase();

  if (variant === 'pink') {
    return (
      <BalloonText
        accessibilityLabel={APP_NAME}
        letterSpacing={letterSpacing}
        size={size}
        style={style}
        text={text}
      />
    );
  }

  const letters = Array.from(text);

  return (
    <View
      accessible
      accessibilityLabel={APP_NAME}
      accessibilityRole="text"
      style={[{ flexDirection: 'row', height: size }, style]}
    >
      {letters.map((letter, index) => (
        <Image
          key={`${letter}-${index}`}
          resizeMode="stretch"
          source={PARCHMENT[letter]}
          style={{
            width: size * (ADVANCE[letter] / EM),
            height: size,
            marginRight: index === letters.length - 1 ? 0 : letterSpacing,
          }}
        />
      ))}
    </View>
  );
}
