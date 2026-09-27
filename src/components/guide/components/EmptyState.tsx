import { useTranslation as useUiTranslation } from 'react-i18next';
import React from 'react';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { theme } from '../theme';

export function EmptyState({ composerHeight }: { composerHeight: number }) {
  const { t: copy } = useUiTranslation();
  const { progress } = useReanimatedKeyboardAnimation();
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: progress.value * -(composerHeight + 1) }] }));
  return (
    <Animated.View style={[styles.container, animatedStyle]} pointerEvents="none">
      <View style={styles.logoWrap}><Image source={require('../../../../assets/icon.png')} style={styles.logo} contentFit="contain" cachePolicy="memory-disk" /></View>
      <Text style={styles.title}>{copy("ui_copy_133")}</Text>
      <Text style={styles.subtitle}>{copy("ui_copy_134")}</Text>
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 44 },
  logoWrap: { width: 52, height: 52, borderRadius: 15, overflow: 'hidden', opacity: 0.42 },
  logo: { width: 52, height: 52 },
  title: { color: theme.text, fontFamily: 'ExposureTrial-0', fontSize: 25, marginTop: 18, textAlign: 'center' },
  subtitle: { color: theme.textSecondary, fontFamily: 'Satoshi-Regular', fontSize: 14, lineHeight: 20, marginTop: 7, textAlign: 'center' },
});
