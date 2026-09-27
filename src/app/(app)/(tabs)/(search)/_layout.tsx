import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function ProfileLayout() {
  const { t } = useTranslation();
  return <Stack screenOptions={{ headerTransparent: true }}><Stack.Screen name="index" options={{ title: t('hub_tab_profile'), headerLargeTitle: true }} /></Stack>;
}
