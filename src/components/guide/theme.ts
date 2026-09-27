import { Appearance } from 'react-native';

const dark = Appearance.getColorScheme() === 'dark';

// Margelo's tokens, recoloured with SafaRoll's ink-and-parchment palette.
export const theme = {
  background: dark ? '#191510' : '#faf6ee',
  // Le fond SOUS la conversation, sur lequel le tiroir des discussions est
  // posé. Un cran plus creusé que `background` : sans cet écart, la surface qui
  // coulisse par-dessus n'aurait pas de bord et ses coins arrondis ne se
  // liraient pas.
  drawerBackground: dark ? '#100d09' : '#efe8d9',
  text: dark ? '#f4eddd' : '#2b2418',
  textSecondary: dark ? '#a2977f' : '#8d8271',
  /** Le seul travail que l'encre ne sait pas faire : dire que c'est passé. */
  success: dark ? '#5fa87d' : '#2f6b4f',
  userBubbleBackground: dark ? '#2c261c' : '#e6dfc4',
  userBubbleText: dark ? '#f4eddd' : '#2b2418',
  glassFallbackBackground: dark ? '#231e16' : '#fffdf8',
  border: dark ? '#332c20' : '#ece3d1',
  sendActive: '#faf6ee',
  sendInactive: dark ? '#6f6650' : '#b5aa97',
  onSendActive: '#2b2418',
} as const;

export const markdownTokens = {
  bodyFontSize: 16,
  bodyLineHeight: 22,
  linkColor: dark ? '#e7b75a' : '#72531d',
  codeFontSize: 14,
  codeBackground: theme.userBubbleBackground,
  headings: {
    1: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
    2: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
    3: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  },
} as const;
