import { useTranslation as useUiTranslation } from 'react-i18next';
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { theme } from '../theme';

const CIRCLE = 44;
export function AttachmentMenu({ onPickPhotos }: { onPickPhotos: () => void }) {
  const { t: copy } = useUiTranslation();
  return (
    <Pressable accessibilityLabel={copy("ui_copy_130")} accessibilityRole="button" onPress={onPickPhotos}>
      <Glass interactive style={styles.circle}><Icon name="plus" size={22} color={theme.text} /></Glass>
    </Pressable>
  );
}
const styles = StyleSheet.create({ circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } });
