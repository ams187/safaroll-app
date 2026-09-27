import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { AudioManager, type SessionOptions } from 'react-native-audio-api';
import { createMMKV } from 'react-native-mmkv';
import {
  addWildlifeSoundListener,
  isWildlifeSoundAvailable,
  startWildlifeSoundAnalysis,
  stopWildlifeSoundAnalysis,
  type WildlifeSoundEvent,
} from 'subject-lift';

const store = createMMKV({ id: 'camera-wildlife-sound' });
const KEY = 'enabled';
const session: SessionOptions = {
  iosCategory: 'record',
  iosMode: 'measurement',
  iosNotifyOthersOnDeactivation: true,
  iosOptions: ['mixWithOthers'],
};

let enabled = store.getBoolean(KEY) === true;
let appActive = AppState.currentState === 'active';
let running = false;
let starting = false;
let generation = 0;
let cue: (WildlifeSoundEvent & { id: number }) | null = null;
let cueTimer: ReturnType<typeof setTimeout> | null = null;
const activeConsumers = new Set<symbol>();
const settingSubscribers = new Set<() => void>();
const cueSubscribers = new Set<() => void>();

function notifySettings() {
  for (const subscriber of settingSubscribers) subscriber();
}

function notifyCue() {
  for (const subscriber of cueSubscribers) subscriber();
}

function clearCue() {
  if (cueTimer) clearTimeout(cueTimer);
  cueTimer = null;
  if (!cue) return;
  cue = null;
  notifyCue();
}

function shouldRun() {
  return enabled && appActive && activeConsumers.size > 0 && isWildlifeSoundAvailable;
}

async function reconcile() {
  if (!shouldRun()) {
    generation += 1;
    clearCue();
    if (running) {
      running = false;
      await stopWildlifeSoundAnalysis().catch(() => false);
      await AudioManager.setAudioSessionActivity(false).catch(() => undefined);
    }
    return;
  }
  if (running || starting) return;

  const token = ++generation;
  starting = true;
  try {
    const permission = await AudioManager.requestRecordingPermissions();
    if (token !== generation || !shouldRun()) return;
    if (permission !== 'Granted') {
      setWildlifeSoundEnabled(false);
      return;
    }
    AudioManager.setAudioSessionOptions(session);
    await AudioManager.setAudioSessionActivity(true);
    if (token !== generation || !shouldRun()) {
      await AudioManager.setAudioSessionActivity(false).catch(() => undefined);
      return;
    }
    running = await startWildlifeSoundAnalysis();
    if (!running) await AudioManager.setAudioSessionActivity(false).catch(() => undefined);
  } catch {
    running = false;
    await AudioManager.setAudioSessionActivity(false).catch(() => undefined);
  } finally {
    starting = false;
  }
}

addWildlifeSoundListener((event) => {
  publishCue(event);
});

function publishCue(event: WildlifeSoundEvent) {
  cue = { ...event, id: Date.now() };
  notifyCue();
  if (cueTimer) clearTimeout(cueTimer);
  cueTimer = setTimeout(() => {
    clearCue();
  }, 3_200);
}

export function simulateWildlifeSound(kind: WildlifeSoundEvent['kind']) {
  if (__DEV__) publishCue({ confidence: 1, kind });
}

AppState.addEventListener('change', (state) => {
  appActive = state === 'active';
  void reconcile();
});

function subscribeSettings(subscriber: () => void) {
  settingSubscribers.add(subscriber);
  return () => settingSubscribers.delete(subscriber);
}

function subscribeCue(subscriber: () => void) {
  cueSubscribers.add(subscriber);
  return () => cueSubscribers.delete(subscriber);
}

export function setWildlifeSoundEnabled(next: boolean) {
  if (enabled === next) return;
  enabled = next;
  store.set(KEY, next);
  notifySettings();
  void reconcile();
}

export function useWildlifeSoundSetting() {
  const isEnabled = useSyncExternalStore(subscribeSettings, () => enabled, () => false);
  return {
    available: Platform.OS === 'ios' && isWildlifeSoundAvailable,
    enabled: isEnabled,
    setEnabled: setWildlifeSoundEnabled,
  };
}

/**
 * Arms the native listener only while a real camera preview is active. Several
 * camera surfaces may stay mounted; the token set prevents an inactive one
 * from stopping the active one's microphone.
 */
export function useWildlifeSound(active: boolean) {
  const token = useRef(Symbol('wildlife-sound-consumer'));
  useEffect(() => {
    const id = token.current;
    if (active) activeConsumers.add(id);
    return () => {
      activeConsumers.delete(id);
      void reconcile();
    };
  }, [active]);
  useEffect(() => {
    if (active) void reconcile();
  }, [active]);

  return useSyncExternalStore(subscribeCue, () => cue, () => null);
}
