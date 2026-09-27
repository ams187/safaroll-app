import { useTranslation as useUiTranslation } from 'react-i18next';
import { Stack } from 'expo-router';

export default function TidyStackLayout() {
  const { t: copy } = useUiTranslation();
  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: copy("spaces_community_title") }} />
    </Stack>
  );
}
