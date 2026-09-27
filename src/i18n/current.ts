/**
 * The language the UI is speaking, with no dependency at all.
 *
 * Plain data modules (rarity tiers, animal groups…) need the language to pick a
 * label, but importing `@/i18n` would pull react-i18next into them — and into
 * the `bun scripts/check-*` suites that load them outside React Native.
 * `src/i18n.ts` keeps this in sync through `setCurrentLanguage`.
 */
let lang: 'fr' | 'en' = 'en';

export function uiLanguage(): 'fr' | 'en' {
  return lang;
}

export function setUiLanguage(next: 'fr' | 'en') {
  lang = next;
}

/** BCP 47 tag for `toLocaleString` / `toLocaleDateString` in the UI language. */
export function uiLocaleTag(): 'fr-FR' | 'en-US' {
  return lang === 'fr' ? 'fr-FR' : 'en-US';
}
