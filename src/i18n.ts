import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { AppState } from 'react-native';
import {
  DEFAULT_LANGUAGE,
  getDeviceLanguage,
  setCurrentLanguage,
  type AppLanguage,
} from '@/i18n/languages';
import { resources } from '@/locales/resources';

i18n.use(initReactI18next).init({
  resources,
  // The OS app-language setting is authoritative, including for users who
  // previously selected a language in the retired in-app picker.
  lng: getDeviceLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
});

// Species names are resolved outside React (the card grid asks per cell), so
// the cached language has to follow i18next rather than be read again.
setCurrentLanguage(i18n.language as AppLanguage);
i18n.on('languageChanged', (language) => setCurrentLanguage(language as AppLanguage));

// Refresh on resume when the OS does not restart the app after a locale change.
AppState.addEventListener('change', (nextState) => {
  if (nextState !== 'active') return;

  const deviceLanguage = getDeviceLanguage();
  if (i18n.language !== deviceLanguage) {
    void i18n.changeLanguage(deviceLanguage);
  }
});

/**
 * Translation outside React. Some copy is built by plain helpers that run far
 * from any component — the museum plaques, the season nudges — and a hook
 * cannot reach them. Reads the same instance, so it follows the language.
 */
export const translate = i18n.t.bind(i18n);

export default i18n;
