// LA LANGUE CHOISIE À LA MAIN, ET POURQUOI « SYSTÈME » RESTE LE DÉFAUT.
//
// Jusqu'ici l'app suivait l'appareil, point. C'est le bon comportement par
// défaut — personne ne veut reconfigurer chaque application — mais c'était le
// SEUL comportement, et il laissait sans recours deux cas très réels :
//
//   - un téléphone en anglais tenu par quelqu'un qui préfère lire en français ;
//   - un francophone à l'étranger dont l'appareil est passé en anglais.
//
// iOS expose bien un réglage de langue par application (Réglages → SafaRoll),
// puisqu'on déclare `CFBundleLocalizations` — mais il est enfoui à trois écrans
// de là, hors de l'app, et personne ne l'y trouve.
//
// « Système » n'est donc pas une troisième langue : c'est l'absence de choix,
// et elle doit rester distincte d'un choix explicite. Quelqu'un qui a laissé
// « Système » et voyage doit voir l'app suivre son téléphone ; quelqu'un qui a
// choisi « Français » doit garder le français quoi qu'il arrive à l'appareil.
// Stocker la langue résolue plutôt que la préférence effacerait cette
// différence — et transformerait le premier en second au premier lancement.

import { useCallback, useSyncExternalStore } from 'react';
import { createMMKV } from 'react-native-mmkv';
import {
  getDeviceLanguage,
  isSupportedLanguage,
  type AppLanguage,
} from '@/i18n/languages';

/** `'system'` = suivre l'appareil. Les autres valeurs sont un choix explicite. */
export type LanguagePreference = 'system' | AppLanguage;

const store = createMMKV({ id: 'language-preference' });
const KEY = 'preference';

function lire(): LanguagePreference {
  const brut = store.getString(KEY);
  return isSupportedLanguage(brut) ? brut : 'system';
}

let courant: LanguagePreference = lire();
const abonnes = new Set<() => void>();

function souscrire(abonne: () => void) {
  abonnes.add(abonne);
  return () => {
    abonnes.delete(abonne);
  };
}

/** La préférence brute — `'system'` compris. */
export function getLanguagePreference(): LanguagePreference {
  return courant;
}

/** La langue à afficher réellement, préférence résolue contre l'appareil. */
export function resolveLanguage(preference: LanguagePreference = courant): AppLanguage {
  return preference === 'system' ? getDeviceLanguage() : preference;
}

export function setLanguagePreference(preference: LanguagePreference) {
  if (preference === courant) return;
  courant = preference;
  store.set(KEY, preference);
  for (const abonne of abonnes) abonne();
}

/**
 * La préférence courante et le geste qui la change.
 *
 * `getServerSnapshot` rend la même valeur : il n'y a pas de rendu serveur ici,
 * mais `useSyncExternalStore` le réclame et l'omettre plante en mode strict.
 */
export function useLanguagePreference() {
  const preference = useSyncExternalStore(souscrire, () => courant, () => courant);
  const choisir = useCallback((suivant: LanguagePreference) => setLanguagePreference(suivant), []);
  return { choose: choisir, preference };
}
