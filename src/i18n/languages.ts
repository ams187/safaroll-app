// Language resolution, mirroring ~/Yaqin's `src/i18n/languages.ts`: a declared
// list of shipped locales, a normaliser for whatever tag the device hands over,
// and one function that turns the device's preferences into a supported code.
//
// The locale comes from `expo-localization`, which reads the OS preference list
// in order. `Intl` only ever reports the single resolved locale, so a device set
// to Italian-then-French would fall to English there instead of French here.
import { getLocales, type Locale } from 'expo-localization';
import { setUiLanguage } from './current';

export const DEFAULT_LANGUAGE = 'en';

export const APP_STORE_LOCALIZATIONS = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
] as const;

export type AppLanguage = (typeof APP_STORE_LOCALIZATIONS)[number]['code'];

export const SUPPORTED_LANGUAGES = APP_STORE_LOCALIZATIONS.map((language) => language.code);

const supportedLanguageSet = new Set<string>(SUPPORTED_LANGUAGES);
const languageByCode = new Map(APP_STORE_LOCALIZATIONS.map((language) => [language.code, language]));

/** Regional tags collapse onto the base language we actually ship. */
const LEGACY_LANGUAGE_MAP: Record<string, AppLanguage> = {
  'en-US': 'en',
  'en-GB': 'en',
  'en-AU': 'en',
  'en-CA': 'en',
  'fr-FR': 'fr',
  'fr-CA': 'fr',
  'fr-BE': 'fr',
  'fr-CH': 'fr',
};

export function isSupportedLanguage(language: string | null | undefined): language is AppLanguage {
  return !!language && supportedLanguageSet.has(language);
}

export function getLanguageDisplayName(language: string | null | undefined): string {
  const normalized = normalizeLanguageCode(language);
  return languageByCode.get(normalized)?.nativeName ?? 'English';
}

export function normalizeLanguageCode(language: string | null | undefined): AppLanguage {
  if (!language) return DEFAULT_LANGUAGE;

  const tag = language.replace('_', '-');
  if (isSupportedLanguage(tag)) return tag;
  if (LEGACY_LANGUAGE_MAP[tag]) return LEGACY_LANGUAGE_MAP[tag];

  const [base] = tag.split('-');
  if (LEGACY_LANGUAGE_MAP[base]) return LEGACY_LANGUAGE_MAP[base];
  if (isSupportedLanguage(base)) return base;

  return DEFAULT_LANGUAGE;
}

/** The device's preferred tags, best first. */
function deviceLocales(): Locale[] {
  try {
    return getLocales();
  } catch {
    return [];
  }
}

let current: AppLanguage | null = null;

/**
 * The language the app is currently speaking. Cached because the collection
 * grid asks once per card and building an `Intl` formatter per cell is not
 * free. i18next will own the updates once it is wired — until then this is
 * simply the device's choice, resolved once.
 */
export function currentLanguage(): AppLanguage {
  if (current === null) current = getDeviceLanguage();
  return current;
}

export function setCurrentLanguage(language: AppLanguage) {
  current = language;
  setUiLanguage(language);
}

export function getDeviceLanguage(locales: Locale[] = deviceLocales()): AppLanguage {
  for (const locale of locales) {
    const tag = locale.languageTag?.replace('_', '-');
    const languageCode = locale.languageCode ?? undefined;

    if (tag && isSupportedLanguage(tag)) return tag;
    // `normalizeLanguageCode` falls back to English, so an unrelated locale
    // would otherwise look like a deliberate English preference — hence the
    // explicit `en` test before accepting the fallback and stopping the scan.
    if (tag) {
      const normalized = normalizeLanguageCode(tag);
      if (normalized !== DEFAULT_LANGUAGE || tag.toLowerCase().startsWith('en')) return normalized;
    }
    if (languageCode) {
      const normalized = normalizeLanguageCode(languageCode);
      if (normalized !== DEFAULT_LANGUAGE || languageCode === 'en') return normalized;
    }
  }
  return DEFAULT_LANGUAGE;
}
