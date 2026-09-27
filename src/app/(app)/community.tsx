import { CommunityScreen } from '@/components/community/community-screen';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export default function CommunityPage() {
  return <View style={styles.screen}><CommunityScreen /></View>;
}

const styles = StyleSheet.create((theme) => ({
  screen: { backgroundColor: theme.colors.background, flex: 1, paddingTop: theme.gap(1) },
}));
