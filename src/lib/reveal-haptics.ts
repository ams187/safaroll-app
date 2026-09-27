// The haptic half of the card reveal. Pulsar (CoreHaptics patterns) when the
// dev client has it linked; expo-haptics otherwise, so a pre-rebuild client
// still buzzes instead of crashing at import time — hence the guarded require.
import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { scheduleOnRN } from 'react-native-worklets';
import type { Rarity } from '@/lib/animals/rarity';
import { pulsar as sharedPulsar } from '@/lib/haptics';

// `System`, majuscule — le nom réel du paquet. Il était écrit `system` ici
// aussi : personne ne s'en apercevait parce que la révélation n'appelle que des
// motifs de premier niveau (`triumph`, `crescendo`, `bloom`, `snap`). La faute
// dormait jusqu'à ce qu'un appelant s'en serve.
type PulsarPresets = Record<string, () => void> & {
  System: { impactHeavy: () => void; impactLight: () => void; selection: () => void };
};

type RealtimeComposer = {
  start: () => void;
  set: (amplitude: number, frequency: number, startIfNeeded?: boolean) => void;
  stop: () => void;
};

type PulsarModule = {
  Presets: PulsarPresets;
  useRealtimeComposer: () => RealtimeComposer;
};

// Le chargement gardé vit dans `@/lib/haptics` : il vaut pour tout l'app, pas
// seulement pour la révélation. Deux `require` du même module seraient sans
// danger, mais un seul garde subtil est plus facile à garder juste.
const pulsar = sharedPulsar as PulsarModule | null;

/**
 * The escalating tremor while the animal waits to become a card.
 *
 * Pulsar's realtime composer is one continuous CoreHaptics player whose
 * amplitude and frequency are modulated live, which is exactly the shape of
 * "it vibrates harder and harder" — a burst per frame would feel like gravel.
 * Its methods are worklets, so `set` is driven straight from the UI thread by
 * the same shared value that shakes the sticker: picture and vibration can't
 * drift apart. Without Pulsar linked it degrades to throttled expo-haptics
 * ticks, which do need the JS thread.
 */
export function useRevealTremor() {
  // `pulsar` is a module-scope constant, so the hook order never varies.
  const composer = pulsar ? pulsar.useRealtimeComposer() : null;
  const nativeSet = composer?.set;
  const nativeStop = composer?.stop;

  return useMemo(
    () => ({
      /** `level` 0 → 1. Safe to call every frame. */
      set: (level: number) => {
        'worklet';
        const clamped = level < 0 ? 0 : level > 1 ? 1 : level;
        // Deliberately short of full scale: this runs for as long as the
        // identification takes, and a continuous buzz at maximum amplitude
        // stops reading as anticipation and starts reading as a fault.
        if (nativeSet) nativeSet(0.05 + clamped * 0.4, 0.2 + clamped * 0.55, true);
        else scheduleOnRN(fallbackTick, clamped);
      },
      stop: () => {
        'worklet';
        if (nativeStop) nativeStop();
      },
    }),
    [nativeSet, nativeStop],
  );
}

let lastFallbackTick = 0;

/** expo-haptics can only fire discrete taps, so the ramp is faked by density. */
function fallbackTick(level: number) {
  const now = Date.now();
  // Fast at full charge, sparse at rest — the gap is what reads as intensity.
  if (now - lastFallbackTick < 260 - level * 170) return;
  lastFallbackTick = now;
  void Haptics.impactAsync(
    level > 0.72
      ? Haptics.ImpactFeedbackStyle.Heavy
      : level > 0.4
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
  ).catch(() => undefined);
}

/**
 * The impact — fired the instant the animal lands on the card. The pattern
 * climbs with the rarity: a common card clicks, a legendary gets the finale.
 */
export function revealBurst(rarity: Rarity | undefined) {
  try {
    if (!pulsar) {
      void Haptics.notificationAsync(
        rarity === 'legendary'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
      return;
    }
    const presets = pulsar.Presets;
    // Trois familles de retour, pas huit : la main ne distingue pas huit
    // nuances de vibration, et prétendre le contraire ne ferait que diluer le
    // moment. Le trio du haut partage le triomphe, c'est ce qui le fait
    // ressentir comme un palier à part.
    if (rarity === 'legendary' || rarity === 'mythic' || rarity === 'epic') presets.triumph();
    else if (rarity === 'ultra_rare' || rarity === 'very_rare') presets.crescendo();
    else if (rarity === 'rare' || rarity === 'uncommon') presets.bloom();
    else presets.snap();
  } catch {
    // Haptics are seasoning, never a crash.
  }
}
