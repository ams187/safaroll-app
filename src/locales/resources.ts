import type { AppLanguage } from '@/i18n/languages';

import en from './en.json';
import fr from './fr.json';

export const resources: Record<AppLanguage, { translation: typeof en }> = {
  en: { translation: en },
  fr: { translation: fr },
};

/** Every key that exists, so `t()` is checked at compile time. */
export type TranslationKey = keyof typeof en;
