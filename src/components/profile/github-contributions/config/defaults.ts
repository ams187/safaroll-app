export type ColorScheme = {
  level0: string;
  level1: string;
  level2: string;
  level3: string;
  level4: string;
};

export const COLOR_SCHEMES = {
  github: {
    level0: 'rgba(240, 230, 211, 1)',
    level1: 'rgba(221, 198, 157, 1)',
    level2: 'rgba(195, 161, 107, 1)',
    level3: 'rgba(149, 109, 62, 1)',
    level4: 'rgba(93, 60, 29, 1)',
  },
} as const;

export const DEFAULT_COLOR_SCHEME: ColorScheme = COLOR_SCHEMES.github;
