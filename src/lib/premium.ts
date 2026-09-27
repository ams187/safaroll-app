import { useEntitled } from '@/lib/purchases';
import { api } from '@/lib/supabase/api';
import { useBackendAuth, useQuery } from '@/lib/supabase/backend';
import { useSyncExternalStore } from 'react';
import { createMMKV } from 'react-native-mmkv';

const store = createMMKV({ id: 'premium' });
const KEY = 'entitled';
const listeners = new Set<() => void>();

function setEntitled(value: boolean) {
  store.set(KEY, value);
  listeners.forEach((listener) => listener());
}

/**
 * L'abonnement Premium.
 *
 * LE SERVEUR EST LA VÉRITÉ, LE FLAG LOCAL N'EST QU'UN LEVIER DE DEV
 * ----------------------------------------------------------------
 * Ce hook ne lisait QUE `store.getBoolean(KEY)`, un booléen MMKV posé sur
 * l'appareil. Un compte marqué `is_premium = true` dans Supabase restait
 * donc verrouillé dans l'app : l'abonnement était payé côté serveur et ignoré
 * côté écran. C'est le bug qui rendait un compte premium indiscernable d'un
 * compte gratuit — et il se serait reproduit à chaque réinstallation, puisque
 * MMKV repart vide.
 *
 * Désormais `profiles.is_premium` décide, via la RPC `is_premium()`. Le
 * booléen local ne subsiste que comme interrupteur de développement (réglages
 * du profil, sous `__DEV__`) : il peut OUVRIR l'accès pour essayer, jamais le
 * fermer à quelqu'un qui a payé.
 *
 * CE QUE ÇA NE CHANGE PAS
 * -----------------------
 * L'« Identification Pro » continue de vérifier l'abonnement côté serveur au
 * moment de l'appel. Ce hook décide de ce qu'on AFFICHE ; il ne garde rien qui
 * coûte de l'argent, et un client ne doit jamais être cru sur ce point.
 */
export function usePremium() {
  const { isAuthenticated } = useBackendAuth();
  const serveur = useQuery(api.profile.isPremium, isAuthenticated ? {} : 'skip');
  // RevenueCat, TROISIÈME source et la plus rapide : au retour de l'achat, le
  // droit est déjà actif côté SDK alors que le webhook n'a pas encore touché
  // `profiles`. Sans elle, le joueur qui vient de payer voit son paywall se
  // refermer sur un compte toujours gratuit — quelques secondes qui se lisent
  // comme un vol.
  const achat = useEntitled();

  const local = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => store.getBoolean(KEY) ?? false,
  );

  return {
    // Un OU, jamais un ET : chacune des trois sources peut OUVRIR l'accès,
    // aucune ne peut le fermer. Un ET laisserait un abonné payant verrouillé
    // par la source la plus lente à répondre.
    // Le levier local n'existe qu'en dev : en release, un booléen posé sur
    // l'appareil ne doit jamais ouvrir un écran payant.
    isPremium: (serveur ?? false) || achat || (__DEV__ && local),
    devToggle: () => setEntitled(!local),
  };
}
