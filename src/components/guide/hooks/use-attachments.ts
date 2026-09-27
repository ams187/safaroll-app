import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import type { Attachment } from '../state/chat-store';

export function useAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const pickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      base64: true,
      mediaTypes: ['images'],
      quality: 0.9,
      selectionLimit: 4,
    });
    if (result.canceled) return;
    const picked = result.assets.filter((asset) => asset.base64).map((asset) => ({
      uri: asset.uri,
      dataUrl: `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}`,
    }));
    setAttachments((previous) => [...previous, ...picked].slice(0, 4));
  }, []);
  const removeAttachment = useCallback((index: number) => {
    setAttachments((previous) => previous.filter((_, current) => current !== index));
  }, []);
  const clearAttachments = useCallback(() => setAttachments([]), []);
  return { attachments, pickImages, removeAttachment, clearAttachments };
}
