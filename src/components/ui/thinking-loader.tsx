import { uiLanguage } from '@/i18n/current';
import { ThinkingOrb, type OrbState, type OrbTheme } from 'expo-thinking-orbs';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

export function ThinkingLoader({
  label = uiLanguage() === 'fr' ? 'Chargement…' : 'Loading…',
  size = 64,
  state = 'working',
  theme = 'auto',
}: {
  label?: string;
  size?: number;
  state?: OrbState;
  theme?: OrbTheme;
}) {
  return (
    <View style={styles.root}>
      <ThinkingOrb
        accessibilityLabel={label}
        color="#2b2418"
        size={size}
        state={state}
        theme={theme}
      />
      <Text accessibilityElementsHidden style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  label: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 13,
  },
}));
