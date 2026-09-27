import { useTranslation as useUiTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { NitroImage } from 'react-native-nitro-image';
import { AttachmentMenu } from './AttachmentMenu';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { useAttachments } from '../hooks/use-attachments';
import type { Attachment } from '../state/chat-store';
import { theme } from '../theme';

const INPUT_MAX_HEIGHT = 120;
const THUMBS_ANIM_MS = 220;

type Props = {
  onSubmit: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  streaming: boolean;
  composerRef: React.RefObject<View | null>;
  onLayout: (event: LayoutChangeEvent) => void;
};

export const Composer = React.memo(function Composer({ onSubmit, onStop, streaming, composerRef, onLayout }: Props) {
  const { t: copy } = useUiTranslation();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const { attachments, pickImages, removeAttachment, clearAttachments } = useAttachments();
  const canSend = value.trim().length > 0 || attachments.length > 0;
  const onSend = () => {
    if (!canSend) return;
    onSubmit(value, attachments);
    setValue('');
    clearAttachments();
  };
  const hasAttachments = attachments.length > 0;
  const [thumbsContentHeight, setThumbsContentHeight] = useState(0);
  const thumbsStyle = useAnimatedStyle(() => ({
    height: withTiming(hasAttachments ? thumbsContentHeight : 0, { duration: THUMBS_ANIM_MS, easing: Easing.inOut(Easing.ease) }),
    opacity: withTiming(hasAttachments ? 1 : 0, { duration: THUMBS_ANIM_MS, easing: Easing.inOut(Easing.ease) }),
  }));
  const [displayedAttachments, setDisplayedAttachments] = useState(attachments);
  if (hasAttachments && displayedAttachments !== attachments) setDisplayedAttachments(attachments);
  const [oneLineHeight, setOneLineHeight] = useState<number>();
  const collapsedInputStyle = value.length === 0 && oneLineHeight != null ? { height: oneLineHeight } : undefined;

  return (
    <View ref={composerRef} onLayout={onLayout} style={[styles.container, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.row}>
        <AttachmentMenu onPickPhotos={pickImages} />
        <View style={styles.inputPillWrap}>
          <Glass style={styles.inputPill}>
            <Animated.View style={[styles.thumbsClip, thumbsStyle]} pointerEvents={hasAttachments ? 'auto' : 'none'}>
              <View style={styles.thumbs} onLayout={(event) => setThumbsContentHeight(Math.ceil(event.nativeEvent.layout.height))}>
                {displayedAttachments.map((attachment, index) => (
                  <View key={`${attachment.uri}:${index}`} style={styles.thumbWrap}>
                    <NitroImage image={{ filePath: attachment.uri }} style={styles.thumb} />
                    <Pressable style={styles.thumbRemove} hitSlop={8} onPress={() => removeAttachment(index)}>
                      <View style={styles.thumbRemoveBadge}><Icon name="xmark" size={11} color="#FFFFFF" /></View>
                    </Pressable>
                  </View>
                ))}
              </View>
            </Animated.View>
            <TextInput
              value={value}
              onChangeText={setValue}
              onLayout={(event) => {
                const height = Math.round(event.nativeEvent.layout.height);
                setOneLineHeight((current) => current ?? height);
              }}
              placeholder={copy("card_menu_guide")}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, collapsedInputStyle]}
              multiline
            />
          </Glass>
        </View>
        <Pressable onPress={streaming ? onStop : onSend} disabled={!streaming && !canSend} hitSlop={6}>
          <Glass interactive style={[styles.circle, (streaming || canSend) && styles.circleActive]}>
            <Icon name={streaming ? 'stop.fill' : 'arrow.up'} size={streaming ? 15 : 20} color={streaming || canSend ? theme.onSendActive : theme.sendInactive} />
          </Glass>
        </Pressable>
      </View>
    </View>
  );
});

const CIRCLE = 44;
const styles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  circleActive: { backgroundColor: theme.sendActive },
  inputPillWrap: { flex: 1 },
  inputPill: { minHeight: CIRCLE, borderRadius: 24, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6, overflow: 'hidden' },
  input: { fontFamily: 'Satoshi-Regular', fontSize: 16, color: theme.text, paddingVertical: 4, maxHeight: INPUT_MAX_HEIGHT },
  thumbsClip: { overflow: 'hidden' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 2, paddingBottom: 8 },
  thumbWrap: { width: 120, height: 120, borderRadius: 18, overflow: 'hidden' },
  thumb: { width: 120, height: 120, borderRadius: 16 },
  thumbRemove: { position: 'absolute', top: 6, right: 6 },
  thumbRemoveBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});
