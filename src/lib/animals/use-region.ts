// La région du joueur, résolue.
//
// Un seul hook pour toute l'app, parce que trois écrans en dépendent — les
// défis, l'atlas et le paywall — et qu'ils doivent tous répondre la même chose.
// La règle est dans `region.ts`, pure ; ici il n'y a que les branchements.

import { resolveRegion, type ResolvedRegion } from '@/lib/animals/region';
import { api } from '@/lib/supabase/api';
import { useBackendAuth, useQuery } from '@/lib/supabase/backend';
import { getLocales } from 'expo-localization';
import { useMemo } from 'react';

/**
 * Lu une fois, hors composant : la région de l'appareil ne change pas en cours
 * de session, et `getLocales()` traverse le pont natif.
 */
const DEVICE_REGION = getLocales()[0]?.regionCode ?? null;

export function useRegion(): ResolvedRegion & {
  /** `undefined` = pas encore chargé, `null` = jamais demandé. */
  declared: string | null | undefined;
} {
  const { isAuthenticated } = useBackendAuth();
  const declared = useQuery(api.profile.myRegion, isAuthenticated ? {} : 'skip');

  return useMemo(() => {
    // Tant que le serveur n'a pas répondu, `declared` est `undefined` et on
    // retombe sur l'appareil — donc la première frame affiche déjà une région
    // plausible au lieu du monde, puis se corrige sans clignoter si le joueur
    // en avait déclaré une autre.
    return { ...resolveRegion({ declared, deviceRegion: DEVICE_REGION }), declared };
  }, [declared]);
}
