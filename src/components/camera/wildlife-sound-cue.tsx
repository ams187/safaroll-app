import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { useWildlifeSound } from '@/lib/camera/wildlife-sound';

export function WildlifeSoundCue({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const cue = useWildlifeSound(active);
  if (!cue) return null;

  return (
    <Animated.View
      key={cue.id}
      entering={FadeInDown.duration(220)}
      exiting={FadeOutUp.duration(180)}
      pointerEvents="none"
      style={styles.cue}
    >
      <SymbolView name="ear.fill" size={14} tintColor="#29242d" />
      <Text numberOfLines={1} style={styles.label}>
        {t(`camera_wildlife_sound_${cue.kind}`)}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cue: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(243,238,226,0.94)',
    borderColor: 'rgba(41,36,45,0.14)',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 7,
    maxWidth: '82%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: 'absolute',
    top: 14,
  },
  label: {
    color: '#29242d',
    fontFamily: 'Satoshi-Medium',
    fontSize: 13,
  },
});
