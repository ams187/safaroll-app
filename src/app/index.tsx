import { useOnboarding } from '@/lib/onboarding';
import { useBackendAuth } from '@/lib/supabase/backend';
import { Redirect } from 'expo-router';

export default function LaunchRoute() {
  const { isLoaded, isSignedIn } = useBackendAuth();
  const { introSeen, onboarded } = useOnboarding();

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href={onboarded ? '/(app)/(tabs)/(home)' : '/(app)/onboarding?resume=meet'} />;
  return <Redirect href={introSeen ? '/(auth)/sign-in' : '/(app)/onboarding'} />;
}
