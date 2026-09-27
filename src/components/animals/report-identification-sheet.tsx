import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { api } from '@/lib/supabase/api';
import type { Id } from '@/lib/supabase/api';
import { useMutation } from '@/lib/supabase/backend';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/**
 * "Signaler une erreur" — the honest answer to a wrong card. Two fields, no
 * ceremony: what it really is, and anything else. A player who can correct
 * the app trusts it more than one who can only be wrong at it.
 */
export function ReportIdentificationSheet({
  captureId,
  onClose,
  predictedName,
  visible,
}: {
  captureId: Id<'animalCaptures'> | null;
  onClose: () => void;
  predictedName?: string;
  visible: boolean;
}) {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const report = useMutation(api.reports.reportIdentification);
  const [claimed, setClaimed] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!captureId || claimed.trim().length === 0 || sending) return;
    setSending(true);
    try {
      await report({ captureId, claimedName: claimed, note: note || undefined });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setClaimed('');
      setNote('');
      onClose();
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Pressable onPress={onClose} style={styles.headerButton}>
                <Text style={styles.headerButtonText}>{copy("common_cancel")}</Text>
              </Pressable>
              <Text style={styles.title}>{t('report_title')}</Text>
              <Pressable
                disabled={claimed.trim().length === 0 || sending}
                onPress={() => void submit()}
                style={[styles.headerButton, styles.send, claimed.trim().length === 0 && styles.sendOff]}
              >
                {sending ? (
                  <ActivityIndicator color="#241a04" size="small" />
                ) : (
                  <Text style={styles.sendText}>{copy("ui_copy_082")}</Text>
                )}
              </Pressable>
            </View>

            {predictedName ? (
              <Text style={styles.predicted}>{copy("ui_copy_083")}{' '}{predictedName}</Text>
            ) : null}

            <Text style={styles.label}>{copy("ui_copy_084")}</Text>
            <TextInput
              autoCapitalize="sentences"
              autoFocus
              onChangeText={setClaimed}
              placeholder={t('report_species_placeholder')}
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={styles.input}
              value={claimed}
            />

            <Text style={styles.label}>{copy("ui_copy_085")}</Text>
            <TextInput
              multiline
              onChangeText={setNote}
              placeholder={t('report_add_note')}
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={[styles.input, styles.noteInput]}
              value={note}
            />

            <Text style={styles.legal}>
              {copy("ui_copy_086")}</Text>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backdropTap: { flex: 1 },
  sheet: {
    gap: 10,
    padding: 20,
    paddingBottom: 40,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: '#1a1409',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  headerButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerButtonText: {
    color: '#fff8e5',
    fontFamily: theme.fonts.medium,
    fontSize: 14,
  },
  send: { backgroundColor: '#2b2418' },
  sendOff: { opacity: 0.4 },
  sendText: {
    color: '#241a04',
    fontFamily: theme.fonts.bold,
    fontSize: 14,
  },
  title: {
    color: '#fff8e5',
    fontFamily: theme.fonts.bold,
    fontSize: 16,
  },
  predicted: {
    color: 'rgba(255,255,255,0.5)',
    fontFamily: theme.fonts.regular,
    fontSize: 12,
    fontStyle: 'italic',
  },
  label: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.62)',
    fontFamily: theme.fonts.bold,
    fontSize: 13,
  },
  input: {
    color: '#fff8e5',
    fontFamily: theme.fonts.regular,
    fontSize: 15,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  noteInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  legal: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.34)',
    fontFamily: theme.fonts.regular,
    fontSize: 11,
    lineHeight: 16,
  },
}));
