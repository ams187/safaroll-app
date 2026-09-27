import { StyleSheet } from 'react-native-unistyles';

const shared = {
  fonts: {
    regular: 'Satoshi-Regular',
    medium: 'Satoshi-Medium',
    bold: 'Satoshi-Bold',
    display: 'ExposureTrial-0',
    brand: 'Baloo2-ExtraBold',
  },
  gap: (v: number) => v * 8,
  radius: {
    sm: 8,
    md: 11,
    lg: 16,
    xl: 24,
  },
} as const;

const lightTheme = {
  ...shared,
  colors: {
    background: '#faf6ee',
    surface: '#fffdf8',
    surfaceMuted: '#f3ecdd',
    foreground: '#2b2418',
    muted: '#8d8271',
    faint: '#b5aa97',
    // The accent IS the ink. Nothing in the chrome carries a hue any more —
    // the animals, their foils and the rarity tiers are the only colour on
    // screen, which is where it was always meant to be. Amber also had to go
    // for a second reason: `rarity.ts` gives LÉGENDAIRE `#ffca4b`, and one
    // colour cannot mean both "this control is active" and "this card is rare".
    primary: '#2b2418',
    /**
     * Parchment. The app's one warm surface: every chip, pill and badge fill,
     * and the type that sits on an ink fill.
     *
     * It can only ever be a FILL or light-on-dark type. At ~87% luminance it
     * is nine points off the cream page, which no eye resolves — parchment as
     * text on the background would be invisible. Ink on parchment, or
     * parchment on ink; never parchment on paper.
     */
    primarySoft: '#e6dfc4',
    primaryText: '#2b2418',
    /**
     * Type on a `primary` fill. Parchment rather than pure white: warm on warm
     * settles, where #fff on near-black is a hard edge that belongs to a
     * different app.
     */
    onPrimary: '#e6dfc4',
    border: '#ece3d1',
    imageBorder: 'rgba(0, 0, 0, 0.07)',
    /**
     * The two jobs black cannot do, and the only hues left in the chrome.
     *
     * `success` because `danger` is rust and a success in ink is
     * indistinguishable from ordinary type at the exact moment it must be
     * noticed. Green is the universal reading, and nothing else says it.
     *
     * `viewfinder` is the parchment, so the camera belongs to the same app as
     * everything else. Nearly every camera surface it paints sits on a dark
     * plate — the badge on `rgba(0,0,0,0.48)`, the fallback on a dark view —
     * where parchment reads cleanly.
     *
     * The one exception is the shutter ring, which sits on raw video: against
     * a bright sky or a pale animal, parchment can wash out. It carries a dark
     * shadow for exactly that case (`camera.tsx`), which is what a stroke
     * would have done had a single border been able to hold two colours.
     */
    success: '#2f6b4f',
    viewfinder: '#e6dfc4',
    danger: '#c05a3a',
    overlay: 'rgba(43, 36, 24, 0.45)',
  },
} as const;

const darkTheme = {
  ...shared,
  colors: {
    background: '#191510',
    surface: '#231e16',
    surfaceMuted: '#2c261c',
    foreground: '#f4eddd',
    muted: '#a2977f',
    faint: '#6f6650',
    // Inverted, like everything else in the dark theme: the ink here is the
    // light one, so a filled control is pale and its type is dark.
    primary: '#f4eddd',
    primarySoft: '#2f2a21',
    primaryText: '#f4eddd',
    onPrimary: '#191510',
    /** Parchment survives the dark theme unchanged: it is already light. */
    border: '#332c20',
    imageBorder: 'rgba(255, 255, 255, 0.07)',
    success: '#5fa87d',
    viewfinder: '#e6dfc4',
    danger: '#e07a58',
    overlay: 'rgba(0, 0, 0, 0.55)',
  },
} as const;

const appThemes = {
  light: lightTheme,
  dark: darkTheme,
};

const breakpoints = {
  xs: 0,
  sm: 300,
  md: 500,
  lg: 800,
  xl: 1200,
} as const;

type AppThemes = typeof appThemes;
type AppBreakpoints = typeof breakpoints;

declare module 'react-native-unistyles' {
  // Module augmentation requires empty extending interfaces (type aliases can't
  // merge across declarations), so the empty-object-type rule doesn't apply.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface UnistylesThemes extends AppThemes {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}

StyleSheet.configure({
  themes: appThemes,
  breakpoints,
  settings: {
    adaptiveThemes: true,
  },
});

// SONDE TEMPORAIRE — diagnostic « Unistyles was loaded, but it's not configured ».
//
// Si cette ligne s'affiche AVEC un nom de thème, `configure` a réussi à cet
// instant précis : tout échec ultérieur des `StyleSheet.create` prouve qu'un
// `destroy()` natif est passé ENTRE les deux — l'invalidate d'un autre hôte
// React (le dev launcher). Si elle n'apparaît pas, c'est `configure` lui-même
// qui a lancé. À retirer une fois tranché.
if (__DEV__) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { UnistylesRuntime } = require('react-native-unistyles') as typeof import('react-native-unistyles');
    console.log(`[unistyles] configuré — thème=${UnistylesRuntime.themeName} @${Date.now() % 100000}`);
  } catch (e) {
    console.log(`[unistyles] configure OK mais lecture immédiate KO : ${String(e)}`);
  }
}
