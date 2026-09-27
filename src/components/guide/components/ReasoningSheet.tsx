import { useTranslation as useUiTranslation } from 'react-i18next';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { NativeSheet } from '@/components/ui/native-sheet';
import { guideMarkdownStyle } from '../markdown-style';
import { theme } from '../theme';

export const ReasoningSheet = React.memo(function ReasoningSheet({ reasoning, onDismiss }: { reasoning: string; onDismiss: () => void }) {
  const { t: copy } = useUiTranslation();
  const insets = useSafeAreaInsets();
  return (
    <NativeSheet detents={['medium', 'large']} onClose={onDismiss} open>
      <View style={styles.header}>
        <View style={styles.closeButton} />
        <Text style={styles.title}>{copy("ui_copy_124")}</Text>
        <View style={styles.closeButton} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <EnrichedMarkdownText markdown={reasoning} markdownStyle={guideMarkdownStyle} flavor="github" />
      </ScrollView>
    </NativeSheet>
  );
});
const CLOSE = 32;
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  closeButton: { width: CLOSE, height: CLOSE, borderRadius: CLOSE / 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Satoshi-Bold', fontSize: 17, fontWeight: '600', color: theme.text },
  scroll: { paddingHorizontal: 20 }, scrollContent: { paddingTop: 4 },
});
