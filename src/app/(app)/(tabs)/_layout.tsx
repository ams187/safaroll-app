import { ExpandableCameraTabBar } from '@/components/navigation/expandable-camera-tab-bar';
import { Tabs } from 'expo-router/js-tabs';

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="(home)"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <ExpandableCameraTabBar {...props} />}
    >
      <Tabs.Screen name="(home)" options={{ title: 'Collection' }} />
      {/* Le titre ne s'affiche pas — la barre est en icônes seules — mais il
          est lu par VoiceOver, et « Espace » ne décrivait plus rien. */}
      <Tabs.Screen name="(spaces)" options={{ title: 'Explorer' }} />
      <Tabs.Screen name="(deck)" options={{ href: null }} />
      <Tabs.Screen name="(tidy)" options={{ href: null }} />
      <Tabs.Screen name="(search)" options={{ href: null }} />
    </Tabs>
  );
}
