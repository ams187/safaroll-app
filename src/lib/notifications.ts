import { translate } from '@/i18n';
import { remoteNudgesActive, setOneSignalPushEnabled, syncLiveActivityPreference } from '@/lib/onesignal';
import type { Nudge } from '@/lib/animals/season-nudges';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

type NotificationsModule = typeof import('expo-notifications');

let Notifications: NotificationsModule | null = null;
try {
  Notifications = require('expo-notifications') as NotificationsModule;
} catch {
  Notifications = null;
}

export const notificationsAvailable = Notifications !== null;

const store = createMMKV({ id: 'notification-preferences' });
const ENABLED = 'enabled';
const PREFIX = 'safaroll:';
const LEGACY_PREFIX = 'birdy-season';
const CHANNEL = 'safaroll-reminders';
const listeners = new Set<() => void>();
let revision = 0;
let configured = false;

function emit() {
  revision += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotificationRevision() {
  return useSyncExternalStore(subscribe, () => revision, () => revision);
}

export function useNotificationsEnabled() {
  useNotificationRevision();
  return store.getBoolean(ENABLED) === true;
}

/**
 * LES ACTIVITÉS EN DIRECT ONT LEUR PROPRE INTERRUPTEUR.
 *
 * POURQUOI PAS SOUS CELUI DES NOTIFICATIONS
 *
 * Ce ne sont pas des notifications. Une notification interrompt une fois ;
 * une Live Activity OCCUPE l'écran verrouillé pendant toute une sortie. Quelqu'un
 * peut vouloir des rappels saisonniers sans avoir sa pastille dynamique prise
 * en otage pendant une heure — et l'inverse est vrai aussi.
 *
 * Duolingo range les siennes de la même façon : l'écran verrouillé est un
 * réglage à part, parce que ce n'est pas le même espace ni le même contrat.
 *
 * DÉFAUT À VRAI. C'est l'intérêt de la fonctionnalité : personne n'ira
 * l'allumer pour découvrir ce qu'elle fait. Elle se coupe après l'avoir vue,
 * pas avant.
 */
const ACTIVITES = 'live-activities-enabled';

export function useLiveActivitiesEnabled() {
  useNotificationRevision();
  return store.getBoolean(ACTIVITES) !== false;
}

export function setLiveActivitiesEnabled(enabled: boolean): void {
  store.set(ACTIVITES, enabled);
  // Refuser doit AUSSI fermer la porte au serveur. Sans ce retrait, le jeton
  // push-to-start reste valide et une campagne pourrait rallumer une activité
  // que le joueur vient d'interdire.
  syncLiveActivityPreference();
  emit();
}

/** Lecture hors composant — pour les appelants qui ne sont pas des hooks. */
export function liveActivitiesEnabled(): boolean {
  return store.getBoolean(ACTIVITES) !== false;
}

/** Installe une seule fois le comportement au premier plan et le canal Android. */
export async function configureNotifications(): Promise<void> {
  if (!Notifications || configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: translate('notification_channel_reminders'),
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => undefined);
  }
  await cancelLegacyNotifications();
  // Une ancienne installation peut déjà avoir le droit système sans avoir la
  // préférence MMKV, ajoutée plus tard. On l'adopte une seule fois.
  const granted = await hasNotificationPermission();
  if (!store.contains(ENABLED) && granted) {
    store.set(ENABLED, true);
    emit();
  } else if (store.getBoolean(ENABLED) === true && !granted) {
    store.set(ENABLED, false);
    emit();
  }
  setOneSignalPushEnabled(store.getBoolean(ENABLED) === true && granted);
}

export async function refreshNotificationPermission(): Promise<void> {
  const granted = await hasNotificationPermission();
  const enabled = store.getBoolean(ENABLED) === true;
  setOneSignalPushEnabled(enabled && granted);
  if (!enabled || granted) return;
  store.set(ENABLED, false);
  emit();
  await cancelSafaRollNotifications();
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** À appeler uniquement après un geste explicite. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted
      ? true
      : current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted;
    store.set(ENABLED, granted);
    emit();
    // Les deux chemins d'activation (onboarding et toggle du profil) passent
    // ici : le droit système obtenu vaut aussi abonnement au push serveur.
    setOneSignalPushEnabled(granted);
    return granted;
  } catch {
    return false;
  }
}

export async function setNotificationsEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    store.set(ENABLED, false);
    emit();
    // UN SEUL INTERRUPTEUR : couper ici coupe aussi le push serveur. Sinon le
    // joueur qui vient de dire non recevrait encore les rappels des Journeys.
    setOneSignalPushEnabled(false);
    await cancelSafaRollNotifications();
    return false;
  }
  return ensureNotificationPermission();
}

async function canSchedule() {
  return store.getBoolean(ENABLED) === true && (await hasNotificationPermission());
}

function tomorrowAt(hour: number) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function triggerAt(date: Date) {
  return {
    type: Notifications!.SchedulableTriggerInputTypes.DATE,
    date,
    ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}),
  } as const;
}

async function cancelKind(kind: string) {
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => item.identifier.startsWith(`${PREFIX}${kind}:`))
      .map((item) => Notifications!.cancelScheduledNotificationAsync(item.identifier)),
  );
}

async function cancelLegacyNotifications() {
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    scheduled
      .filter((item) => item.identifier.startsWith(LEGACY_PREFIX))
      .map((item) => Notifications!.cancelScheduledNotificationAsync(item.identifier)),
  );
}

/** Un rappel unique demain matin — jamais un abonnement quotidien. */
export async function scheduleSeasonNudge(nudge: Nudge, hour = 9): Promise<boolean> {
  if (!Notifications || !(await canSchedule())) return false;
  try {
    await cancelKind('season');
    // Quand OneSignal est actif, la Journey saisonnière porte ce message —
    // déclenchée par les tags, elle atteint aussi le joueur qui n'ouvre plus
    // l'app, ce que cette planification locale ne saura jamais faire. On
    // nettoie l'existant puis on s'efface : un seul émetteur par message.
    if (remoteNudgesActive) return false;
    await Notifications.scheduleNotificationAsync({
      content: {
        body: nudge.body,
        data: {
          kind: 'season',
          scientificName: nudge.scientificName,
          url: `/(app)/(tabs)/(home)?species=${encodeURIComponent(nudge.scientificName)}`,
        },
        title: nudge.title,
      },
      identifier: `${PREFIX}season:${nudge.scientificName}`,
      trigger: triggerAt(tomorrowAt(hour)),
    });
    return true;
  } catch {
    return false;
  }
}

export async function scheduleObjectiveReminder(remaining: number): Promise<void> {
  if (!Notifications) return;
  await cancelKind('objective').catch(() => undefined);
  // Même retrait que le nudge saisonnier : la Journey « ligne d'arrivée »
  // prend le relais dès que OneSignal est actif. Le palier d'atlas, lui,
  // reste local — il célèbre un joueur présent, pas un joueur à rappeler.
  if (remoteNudgesActive) return;
  if (!(await canSchedule()) || remaining < 1 || remaining > 2) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      body: translate('notification_objective_body', { count: remaining }),
      data: { kind: 'objective', url: '/(app)/profile' },
      title: translate('notification_objective_title'),
    },
    identifier: `${PREFIX}objective:monthly`,
    trigger: triggerAt(tomorrowAt(18)),
  }).catch(() => undefined);
}

/** Notifie seulement un palier réellement franchi pendant la vie du compte. */
export async function notifyAtlasMilestone(userId: string, speciesCount: number): Promise<void> {
  if (!Notifications || speciesCount < 0) return;
  const key = `atlas:${userId}`;
  const previous = store.getNumber(key);
  store.set(key, speciesCount);
  if (previous === undefined) return;
  const milestone = Math.floor(speciesCount / 50) * 50;
  const notifiedKey = `atlas-notified:${userId}:${milestone}`;
  if (
    milestone < 50 ||
    milestone <= previous ||
    store.getBoolean(notifiedKey) === true ||
    !(await canSchedule())
  ) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      body: translate('notification_atlas_body', { count: milestone }),
      data: { kind: 'atlas', url: '/(app)/(tabs)/(home)' },
      title: translate('notification_atlas_title', { count: milestone }),
    },
    identifier: `${PREFIX}atlas:${userId}:${milestone}`,
    trigger: triggerAt(new Date(Date.now() + 2_000)),
  })
    .then(() => store.set(notifiedKey, true))
    .catch(() => undefined);
}

export function observeNotificationNavigation(open: (url: string) => void) {
  if (!Notifications) return () => undefined;
  const redirect = (notification: import('expo-notifications').Notification) => {
    const url = notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) open(url);
  };
  const last = Notifications.getLastNotificationResponse();
  if (last?.notification) {
    redirect(last.notification);
    Notifications.clearLastNotificationResponse();
  }
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    redirect(response.notification);
    Notifications?.clearLastNotificationResponse();
  });
  return () => subscription.remove();
}

export async function cancelSafaRollNotifications(): Promise<void> {
  if (!Notifications) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((item) => item.identifier.startsWith(PREFIX) || item.identifier.startsWith(LEGACY_PREFIX))
        .map((item) => Notifications!.cancelScheduledNotificationAsync(item.identifier)),
    );
  } catch {
    // Rien de planifié, rien à nettoyer.
  }
}

/** Compatibilité avec l'ancien nom public. */
export const cancelSeasonNudges = cancelSafaRollNotifications;
