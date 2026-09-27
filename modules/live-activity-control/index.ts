import { requireOptionalNativeModule } from 'expo-modules-core';

const control = requireOptionalNativeModule<{ endAll(): void }>('LiveActivityControl');

export function endLocalLiveActivities(): void {
  if (process.env.EXPO_OS !== 'ios') return;
  if (!control) throw new Error('LiveActivityControl requires a new iOS build');
  control.endAll();
}
