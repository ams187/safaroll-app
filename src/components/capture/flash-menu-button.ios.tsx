import { Host, Image, Menu, Picker, Section, Text as UIText, Toggle } from '@expo/ui/swift-ui';
import { frame, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import {
  flashSymbol,
  setFlashMode,
  useFlashMode,
  type FlashMode,
} from '@/lib/camera/flash';
import {
  setCaptureQualityDebugScenario,
  useCaptureQualityDebugScenario,
  type CaptureQualityDebugScenario,
} from '@/lib/camera/capture-quality-debug';
import { simulateWildlifeSound, useWildlifeSoundSetting } from '@/lib/camera/wildlife-sound';
import type { WildlifeSoundKind } from 'subject-lift';

const MODES: FlashMode[] = ['off', 'auto', 'on'];
const QUALITY_SCENARIOS: { label: string; value: CaptureQualityDebugScenario }[] = [
  { label: 'Automatique', value: 'automatic' },
  { label: 'Photo illisible', value: 'low_quality' },
  { label: 'Photo trop sombre', value: 'too_dark' },
  { label: 'Animal coupé', value: 'subject_clipped' },
  { label: 'Animal trop loin', value: 'subject_too_far' },
];
const SOUND_SCENARIOS: { label: string; value: WildlifeSoundKind }[] = [
  { label: 'Chant d’oiseau', value: 'bird' },
  { label: 'Coassement', value: 'frog' },
  { label: 'Insectes', value: 'insect' },
  { label: 'Rugissement', value: 'big_cat' },
];

export function FlashButton({
  compact = false,
  onStakeoutChange,
  stakeoutArmed = false,
}: {
  compact?: boolean;
  onStakeoutChange?: (armed: boolean) => void;
  stakeoutArmed?: boolean;
}) {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const { mode } = useFlashMode();
  const qualityScenario = useCaptureQualityDebugScenario();
  const wildlifeSound = useWildlifeSoundSetting();
  const size = compact ? 28 : 40;

  return (
    <Host matchContents seedColor="#b8892c" style={[styles.host, { height: size, width: size }]}>
      <Menu
        label={
          <Image
            color={mode === 'off' ? '#29242d' : '#b8892c'}
            size={compact ? 13 : 17}
            systemName={flashSymbol(mode)}
          />
        }
        modifiers={[frame({ width: size, height: size })]}
      >
        <Section title="Flash">
          <Picker
            modifiers={[pickerStyle('inline')]}
            onSelectionChange={(next) => {
              void Haptics.selectionAsync().catch(() => undefined);
              setFlashMode(next as FlashMode);
            }}
            selection={mode}
          >
            {MODES.map((item) => (
              <UIText key={item} modifiers={[tag(item)]}>
                {t(item === 'off' ? 'flash_off' : item === 'auto' ? 'flash_auto' : 'flash_on')}
              </UIText>
            ))}
          </Picker>
        </Section>
        {onStakeoutChange ? (
          <Section title={t('camera_capture_mode')}>
            <Toggle
              isOn={stakeoutArmed}
              onIsOnChange={(armed) => {
                void Haptics.selectionAsync().catch(() => undefined);
                onStakeoutChange(armed);
              }}
              systemImage="scope"
            >
              <UIText>{t('camera_stakeout_mode')}</UIText>
              <UIText>{t('camera_stakeout_hint')}</UIText>
            </Toggle>
          </Section>
        ) : null}
        {wildlifeSound.available ? (
          <Section title={t('camera_wildlife_sound_section')}>
            <Toggle
              isOn={wildlifeSound.enabled}
              onIsOnChange={(enabled) => {
                void Haptics.selectionAsync().catch(() => undefined);
                wildlifeSound.setEnabled(enabled);
              }}
              systemImage="ear.fill"
            >
              <UIText>{t('camera_wildlife_sound_mode')}</UIText>
              <UIText>{t('camera_wildlife_sound_hint')}</UIText>
            </Toggle>
          </Section>
        ) : null}
        {__DEV__ ? (
          <>
            <Section title={copy("ui_copy_110")}>
              <Picker
                modifiers={[pickerStyle('inline')]}
                onSelectionChange={(next) => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  simulateWildlifeSound(next as WildlifeSoundKind);
                }}
                selection="none"
              >
                <UIText modifiers={[tag('none')]}>{copy("ui_copy_111")}</UIText>
                {SOUND_SCENARIOS.map((scenario) => (
                  <UIText key={scenario.value} modifiers={[tag(scenario.value)]}>
                    {scenario.label}
                  </UIText>
                ))}
              </Picker>
            </Section>
            <Section title={copy("ui_copy_112")}>
              <Picker
                modifiers={[pickerStyle('inline')]}
                onSelectionChange={(next) => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  setCaptureQualityDebugScenario(next as CaptureQualityDebugScenario);
                }}
                selection={qualityScenario}
              >
                {QUALITY_SCENARIOS.map((scenario) => (
                  <UIText key={scenario.value} modifiers={[tag(scenario.value)]}>
                    {scenario.label}
                  </UIText>
                ))}
              </Picker>
            </Section>
          </>
        ) : null}
      </Menu>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    alignItems: 'center',
    backgroundColor: '#f3eee2',
    borderRadius: 20,
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
