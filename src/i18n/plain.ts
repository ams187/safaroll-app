import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import { uiLanguage } from './current';

/**
 * `translate()` for modules that must stay loadable outside React Native
 * (the `bun scripts/check-*` suites): reads the locale files directly instead
 * of going through i18next. Plain `{{name}}` interpolation only — no plurals.
 */
export function plainT(key: string, vars?: Record<string, string | number>): string {
  const table: Record<string, string> = uiLanguage() === 'fr' ? fr : en;
  const text = table[key] ?? (en as Record<string, string>)[key] ?? key;
  return vars ? text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? '')) : text;
}
