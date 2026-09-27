import { Stack } from 'expo-router';

export default function DeckLayout() {
  return (
    <Stack screenOptions={{ headerLargeTitle: true, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ title: 'Capturer' }} />
      <Stack.Screen name="[id]" options={{ title: 'Deck', headerLargeTitle: false }} />
    </Stack>
  );
}
