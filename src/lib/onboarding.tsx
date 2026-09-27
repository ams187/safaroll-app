import { useBackendAuth } from '@/lib/supabase/backend';
import * as SecureStore from 'expo-secure-store';
import { createContext, use, useCallback, useMemo, useState } from 'react';

const ONBOARDING_KEY = 'safaroll.onboarded';
const INTRO_SEEN_KEY = 'safaroll.onboarding-intro-seen';

type OnboardingContextValue = {
  introSeen: boolean;
  markIntroSeen: () => void;
  onboarded: boolean;
  completeOnboarding: () => void;
  /** Rejoue l'onboarding. Réservé au bouton `__DEV__` du profil. */
  resetOnboarding: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue>({
  introSeen: false,
  markIntroSeen: () => {},
  onboarded: true,
  completeOnboarding: () => {},
  resetOnboarding: () => {},
});

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useBackendAuth();
  const storageKey = userId ? `${ONBOARDING_KEY}.${userId}` : null;
  const [introSeen, setIntroSeen] = useState(() => SecureStore.getItem(INTRO_SEEN_KEY) === 'true');
  const [override, setOverride] = useState<{ key: string; value: boolean } | null>(null);
  const onboarded = useMemo(() => {
    if (!storageKey) return false;
    if (override?.key === storageKey) return override.value;
    return SecureStore.getItem(storageKey) === 'true';
  }, [override, storageKey]);

  const completeOnboarding = useCallback(() => {
    if (!storageKey) return;
    SecureStore.setItem(storageKey, 'true');
    setOverride({ key: storageKey, value: true });
  }, [storageKey]);

  const markIntroSeen = useCallback(() => {
    SecureStore.setItem(INTRO_SEEN_KEY, 'true');
    setIntroSeen(true);
  }, []);

  // Le garde de `(app)/_layout` bascule sur `onboarded` : effacer la clé suffit
  // à réancrer la pile sur l'onboarding, sans redémarrer l'app.
  const resetOnboarding = useCallback(() => {
    if (!storageKey) return;
    SecureStore.deleteItemAsync(storageKey).catch(() => undefined);
    setOverride({ key: storageKey, value: false });
  }, [storageKey]);

  const value = useMemo(
    () => ({ introSeen, markIntroSeen, onboarded, completeOnboarding, resetOnboarding }),
    [introSeen, markIntroSeen, onboarded, completeOnboarding, resetOnboarding],
  );

  return <OnboardingContext value={value}>{children}</OnboardingContext>;
}

export function useOnboarding() {
  return use(OnboardingContext);
}
