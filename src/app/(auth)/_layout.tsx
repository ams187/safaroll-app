import { useAuth } from '@clerk/expo';
import { useOnboarding } from '@/lib/onboarding';
import { Redirect, Stack } from 'expo-router';

export default function AuthRoutesLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const { onboarded } = useOnboarding();

  if (!isLoaded) {
    return null;
  }

  if (isSignedIn) {
    return <Redirect href={onboarded ? '/(app)/(tabs)/(home)' : '/(app)/onboarding?resume=meet'} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
