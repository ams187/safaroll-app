// L'autorisation de position — et surtout le moment où elle est demandée.
//
// Sur iOS le dialogue système est à usage unique : refusé une fois, il ne
// réapparaît plus jamais et le seul recours restant est les Réglages. Donc rien
// ici ne l'appelle en passant. `askLocation` est la seule porte, et elle ne doit
// être franchie que depuis un écran où l'utilisateur vient de nous dire oui à
// NOUS. Un « plus tard » sur notre feuille ne coûte rien ; un « non » sur celle
// d'Apple est définitif.
//
// Ce que la position paie côté joueur, c'est le LIEU gardé avec la capture.
// L'argument était la rareté locale ; il est tombé avec elle — une observation
// sauvage GBIF dans un carré de ±1° ment dès qu'on photographie derrière une
// clôture. Reste le fait, gratuit et vrai : l'endroit est gravé sur la ligne.
// Le pin sur la carte est un bonus premium — jamais le motif de la demande :
// on ne vend pas une permission avec une fonctionnalité payante, sinon un
// joueur gratuit n'a aucune raison d'accepter et le stock qui vaudra le
// paywall plus tard ne se constitue jamais.
//
// Et le fait qui rend l'urgence honnête : une capture faite sans position
// n'aura jamais de position. La caméra iOS n'écrit pas de GPS dans l'EXIF, et
// il n'existe aucun endpoint pour patcher une ligne après coup.
//
// Les règles pures (délais, plafond, bannières) sont dans `location-rules.ts`,
// pour être vérifiables sans simulateur.

import { shouldInvite, type LocationGate } from '@/lib/location-rules';
import type { ExifLocation } from '@/lib/exif';
import * as Location from 'expo-location';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState, Linking } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

const store = createMMKV({ id: 'location-permission' });
const INVITES_KEY = 'invites';
const LAST_INVITE_KEY = 'lastInviteAt';

let current: LocationGate = 'unknown';
const listeners = new Set<() => void>();

function publish(next: LocationGate) {
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function classify(status: string, canAskAgain: boolean): LocationGate {
  if (status === 'granted') return 'granted';
  return canAskAgain ? 'ask' : 'settings';
}

/** Lit l'état sans jamais déclencher le dialogue système. */
export async function refreshLocationGate(): Promise<LocationGate> {
  try {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    publish(classify(status, canAskAgain));
  } catch {
    // Module absent ou service coupé : on ne prétend pas avoir une position.
    publish('settings');
  }
  return current;
}

/** Le dialogue système. Une seule cartouche — voir l'en-tête du fichier. */
export async function askLocation(): Promise<boolean> {
  try {
    const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    publish(classify(status, canAskAgain));
  } catch {
    publish('settings');
  }
  return current === 'granted';
}

/** Prépare le point GPS pendant que le joueur cadre, sans jamais demander la permission. */
export async function readCaptureLocation(): Promise<ExifLocation | undefined> {
  try {
    const known = await Location.getLastKnownPositionAsync({ maxAge: 600_000 });
    const position = known ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  } catch {
    // Une position absente dégrade la carte, elle ne doit jamais perdre la capture.
    return undefined;
  }
}

export function canInviteForLocation(gate: LocationGate): boolean {
  return shouldInvite({
    gate,
    invites: store.getNumber(INVITES_KEY) ?? 0,
    lastInviteAt: store.getNumber(LAST_INVITE_KEY) ?? 0,
    now: Date.now(),
  });
}

export function markLocationInvited() {
  store.set(INVITES_KEY, (store.getNumber(INVITES_KEY) ?? 0) + 1);
  store.set(LAST_INVITE_KEY, Date.now());
}

export function useLocationGate() {
  const gate = useSyncExternalStore(subscribe, () => current);

  useEffect(() => {
    void refreshLocationGate();
    // Le retour des Réglages est le SEUL signal qu'un blocage vient d'être
    // levé. Sans lui, l'utilisateur active, revient, rien ne bouge, et il
    // conclut que ça n'a pas marché — c'est là qu'on les perd.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshLocationGate();
    });
    return () => subscription.remove();
  }, []);

  return {
    ask: askLocation,
    gate,
    openSettings: useCallback(() => {
      void Linking.openSettings();
    }, []),
  };
}
