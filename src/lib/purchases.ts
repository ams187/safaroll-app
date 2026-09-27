import { translate } from '@/i18n';
// RevenueCat, porté de ~/Affirm — l'app de l'App Store dont les abonnements
// tournent en production.
//
// CE QUI VIENT D'AFFIRM, ET POURQUOI
//
//   CONFIGURATION MÉMOÏSÉE      une seule promesse, gardée par `isConfigured()`.
//                               Deux écrans qui montent en même temps ne
//                               configurent pas le SDK deux fois, et un échec
//                               remet la promesse à zéro pour qu'on puisse
//                               réessayer au lieu de rester cassé.
//   AUCUN IDENTIFIANT EN DUR    l'accès est « au moins un droit actif », pas
//                               `entitlements.active['premium']`. Renommer
//                               le droit dans le tableau de bord ne coupe donc
//                               l'abonnement de personne — c'est exactement le
//                               genre de panne qu'on ne découvre qu'en prod.
//   ÉCOUTE EN CONTINU           `addCustomerInfoUpdateListener` : un achat fait
//                               ailleurs, un essai qui expire, un
//                               remboursement — l'app suit sans redémarrer.
//
// CE QU'ON AJOUTE, PARCE QUE SAFAROLL A DES COMPTES
//
// Affirm est mono-profil et local ; ici il y a Clerk. `Purchases.logIn(userId)`
// attache l'achat au COMPTE et pas au téléphone : sans lui, changer d'appareil
// perdrait l'abonnement, et le webhook RevenueCat n'aurait aucun moyen de
// retrouver la ligne `profiles` à marquer.
//
// LA CLÉ EST CELLE DU TEST STORE
//
// `EXPO_PUBLIC_REVENUECAT_API_KEY` commence par `test_` : c'est la boutique de
// test de RevenueCat, celle qui laisse acheter sans App Store Connect. Le jour
// du passage en production, la même variable prendra la clé `appl_` — rien
// d'autre à changer ici.

import { useEffect, useSyncExternalStore } from 'react';

type PurchasesModule = typeof import('react-native-purchases');
type PurchasesPackage = import('react-native-purchases').PurchasesPackage;
type CustomerInfo = import('react-native-purchases').CustomerInfo;

// Module natif : importé sous garde, comme partout ailleurs dans ce dépôt
// (`notifications.ts`, `native-overlays.ts`). Un client de dev construit avant
// l'ajout du pod rend le paywall inerte au lieu de casser le bundle entier.
let RC: PurchasesModule | null = null;
try {
  RC = require('react-native-purchases') as PurchasesModule;
} catch {
  RC = null;
}

const Purchases = RC?.default ?? null;

export type Plan = 'weekly' | 'annual' | 'lifetime';

export type Offering = {
  plan: Plan;
  /** Déjà formaté par le store, dans la devise du joueur. */
  price: string;
  /** Absent quand on affiche les prix de repli. */
  pack?: PurchasesPackage;
};

export type PurchaseOutcome =
  | { ok: true; entitled: boolean }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string };

/**
 * Les prix affichés quand RevenueCat ne répond pas — hors ligne, clé absente,
 * client de dev sans le pod.
 *
 * Un paywall vide est pire qu'un paywall approximatif : il se lit comme une
 * panne et personne ne réessaie. L'achat, lui, échouera proprement avec un
 * message, ce qui est le comportement honnête.
 */
const REPLI: Offering[] = [
  { plan: 'weekly', price: '2,99 €' },
  { plan: 'annual', price: '29,99 €' },
  { plan: 'lifetime', price: '69,99 €' },
];

// ---------------------------------------------------------------- état vivant

const listeners = new Set<() => void>();
let entitled = false;
let offerings: Offering[] = REPLI;
let loading = true;

function emit() {
  for (const listener of listeners) listener();
}

/** Au moins un droit actif = abonné. Voir l'en-tête : aucun nom en dur. */
function readEntitlement(info: CustomerInfo): boolean {
  return Object.keys(info.entitlements?.active ?? {}).length > 0;
}

function applyCustomerInfo(info: CustomerInfo) {
  const next = readEntitlement(info);
  if (next === entitled) return;
  entitled = next;
  emit();
}

function planOf(pack: PurchasesPackage): Plan | null {
  const type = pack.packageType;
  if (type === RC?.PACKAGE_TYPE.WEEKLY) return 'weekly';
  if (type === RC?.PACKAGE_TYPE.ANNUAL) return 'annual';
  if (type === RC?.PACKAGE_TYPE.LIFETIME) return 'lifetime';
  // Une offre montée en « custom » dans le tableau de bord n'a pas de type
  // standard. On retombe sur l'identifiant plutôt que de la laisser tomber.
  const id = pack.identifier.toLowerCase();
  if (id.includes('week')) return 'weekly';
  if (id.includes('annual') || id.includes('year')) return 'annual';
  if (id.includes('life')) return 'lifetime';
  return null;
}

// ------------------------------------------------------------- configuration

let configured: Promise<void> | null = null;

function ensureConfigured(): Promise<void> {
  if (!Purchases) return Promise.reject(new Error('react-native-purchases absent du build'));
  if (!configured) {
    configured = (async () => {
      if (await Purchases.isConfigured()) return;
      const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
      if (!apiKey) throw new Error('EXPO_PUBLIC_REVENUECAT_API_KEY manquante');
      if (__DEV__ && RC) Purchases.setLogLevel(RC.LOG_LEVEL.WARN);
      Purchases.configure({ apiKey });
      Purchases.addCustomerInfoUpdateListener(applyCustomerInfo);
      applyCustomerInfo(await Purchases.getCustomerInfo());
    })().catch((error) => {
      // Remise à zéro : sans elle, un premier échec (avion, clé absente au
      // démarrage) condamnerait le paywall pour toute la session.
      configured = null;
      throw error;
    });
  }
  return configured;
}

async function loadOfferings() {
  if (!Purchases) return;
  await ensureConfigured();
  const all = await Purchases.getOfferings();
  // `current` plutôt qu'un identifiant écrit ici : c'est l'offre que le
  // tableau de bord désigne comme courante, donc on peut la remplacer côté
  // RevenueCat sans publier une version de l'app.
  const packs = all.current?.availablePackages ?? [];
  const mapped: Offering[] = [];
  for (const pack of packs) {
    const plan = planOf(pack);
    if (plan) mapped.push({ pack, plan, price: pack.product.priceString });
  }
  if (mapped.length > 0) offerings = mapped;
}

let loadingOnce: Promise<void> | null = null;

function ensureLoaded() {
  if (!loadingOnce) {
    loadingOnce = loadOfferings()
      .catch((error) => {
        if (__DEV__) console.warn('[purchases] offres indisponibles :', error);
      })
      .finally(() => {
        loading = false;
        emit();
      });
  }
  return loadingOnce;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // La configuration part au premier abonné, pas à l'import : un module qui
  // ouvre une session réseau à l'évaluation ralentit le démarrage à froid de
  // tout le monde, y compris de ceux qui n'ouvriront jamais le paywall.
  void ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

// ------------------------------------------------------------------- lecture

/** L'abonnement vu par RevenueCat. Faux tant que rien n'est chargé. */
export function useEntitled(): boolean {
  return useSyncExternalStore(subscribe, () => entitled, () => entitled);
}

export function useOfferings(): { loading: boolean; offerings: Offering[] } {
  const snapshot = useSyncExternalStore(subscribe, () => offerings, () => offerings);
  const busy = useSyncExternalStore(subscribe, () => loading, () => loading);
  return { loading: busy, offerings: snapshot };
}

/**
 * Attache l'acheteur à son compte Clerk.
 *
 * Sans ça, RevenueCat identifie un ANONYME par appareil : réinstaller ou
 * changer de téléphone perdrait l'abonnement, et le webhook n'aurait aucune
 * clé pour retrouver la ligne `profiles` correspondante.
 */
export function useRevenueCatIdentity(userId: string | null | undefined) {
  useEffect(() => {
    if (!Purchases || !userId) return;
    let vivant = true;
    void ensureConfigured()
      .then(() => Purchases.logIn(userId))
      .then(({ customerInfo }) => {
        if (vivant) applyCustomerInfo(customerInfo);
      })
      .catch((error) => {
        if (__DEV__) console.warn('[purchases] logIn a échoué :', error);
      });
    return () => {
      vivant = false;
    };
  }, [userId]);
}

// -------------------------------------------------------------------- achats

export async function purchase(plan: Plan): Promise<PurchaseOutcome> {
  if (!Purchases) return { error: translate('purchase_unavailable'), ok: false };
  try {
    await ensureLoaded();
    const pack = offerings.find((offering) => offering.plan === plan)?.pack;
    if (!pack) return { error: translate('purchase_offer_unavailable'), ok: false };
    const { customerInfo } = await Purchases.purchasePackage(pack);
    applyCustomerInfo(customerInfo);
    return { entitled: readEntitlement(customerInfo), ok: true };
  } catch (error) {
    const raté = error as { message?: string; userCancelled?: boolean };
    // L'annulation n'est pas une erreur : l'afficher comme telle accuse le
    // joueur d'avoir changé d'avis.
    if (raté.userCancelled) return { cancelled: true, ok: false };
    return { error: raté.message ?? translate('purchase_failed'), ok: false };
  }
}

export async function restore(): Promise<PurchaseOutcome> {
  if (!Purchases) return { error: translate('purchase_unavailable'), ok: false };
  try {
    await ensureConfigured();
    const customerInfo = await Purchases.restorePurchases();
    applyCustomerInfo(customerInfo);
    return { entitled: readEntitlement(customerInfo), ok: true };
  } catch (error) {
    const raté = error as { message?: string };
    return { error: raté.message ?? translate('purchase_restore_failed'), ok: false };
  }
}
