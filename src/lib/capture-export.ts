import { renderCardPng } from '@/lib/card-share';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { useMemo, useSyncExternalStore, type RefObject } from 'react';
import type { View } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

export type CaptureExportKind = 'card' | 'photo' | 'sticker';
export type CaptureExportPreferences = Record<CaptureExportKind, boolean>;

const store = createMMKV({ id: 'capture-export' });
const kinds: CaptureExportKind[] = ['card', 'sticker', 'photo'];
const listeners = new Set<() => void>();
let version = 0;

const key = (userId: string, kind: CaptureExportKind) => `${userId}.${kind}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCaptureExportPreferences(userId?: string | null): CaptureExportPreferences {
  return Object.fromEntries(
    kinds.map((kind) => [kind, userId ? store.getBoolean(key(userId, kind)) === true : false]),
  ) as CaptureExportPreferences;
}

export function useCaptureExportPreferences(userId?: string | null) {
  const revision = useSyncExternalStore(subscribe, () => version, () => version);
  return useMemo(() => {
    void revision; // Invalidates the MMKV snapshot after a switch changes.
    return getCaptureExportPreferences(userId);
  }, [revision, userId]);
}

/** Returns false when iOS did not grant write access. */
export async function setCaptureExportPreference(
  userId: string | null | undefined,
  kind: CaptureExportKind,
  enabled: boolean,
): Promise<boolean> {
  if (!userId) return false;
  if (enabled) {
    const permission = await requestPermissionsAsync(true, ['photo']);
    if (!permission.granted) return false;
  }
  store.set(key(userId, kind), enabled);
  version += 1;
  listeners.forEach((listener) => listener());
  return true;
}

export async function exportCaptureAssets({
  cardRef,
  name,
  originalUri,
  preferences,
  stickerUri,
}: {
  cardRef: RefObject<View | null>;
  name: string;
  originalUri: string;
  preferences: CaptureExportPreferences;
  stickerUri: string | null;
}) {
  const tasks: Promise<unknown>[] = [];
  if (preferences.photo) tasks.push(Asset.create(originalUri));
  if (preferences.sticker && stickerUri) tasks.push(Asset.create(stickerUri));
  if (preferences.card) {
    tasks.push(renderCardPng({ name, ref: cardRef }).then((file) => Asset.create(file.uri)));
  }
  const results = await Promise.allSettled(tasks);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
