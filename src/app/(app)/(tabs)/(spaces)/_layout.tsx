import { Stack } from 'expo-router';

/**
 * No header at all.
 *
 * This used to be `headerTransparent: true` + `headerLargeTitle: true`. A
 * transparent large-title header is still a real native navigation bar laid
 * over the top of the screen — invisible, but it occupies ~100pt and it eats
 * every touch that lands there. The old hub was a ScrollView with
 * `contentInsetAdjustmentBehavior="automatic"`, so its content started below
 * the bar and nobody noticed.
 *
 * The screen now puts its own segmented bar at the very top, right inside that
 * dead zone, which is why two different tab bars in a row rendered perfectly
 * and refused to be tapped. The collection tab never had the problem because
 * its stack sets `headerShown: false`.
 */
export default function HubLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
