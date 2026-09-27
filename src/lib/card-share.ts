import { translate } from '@/i18n';
// Same sharing flow as Bloom: snapshot the rendered card once, cache a PNG,
// then hand that file to the native share sheet.
import { makeImageFromView } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import type { View } from 'react-native';

/** Capture the card exactly as displayed and write one PNG to cache. */
export async function renderCardPng({
  name,
  ref,
}: {
  ref: RefObject<View | null>;
  name: string;
}): Promise<File> {
  const snapshot = await makeImageFromView(ref);
  if (!snapshot) throw new Error('La capture de la carte a échoué.');

  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents left by NFD
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .toLowerCase() || 'carte';
  const file = new File(Paths.cache, `safaroll-${slug}.png`);
  if (file.exists) file.delete();
  file.create();
  file.write(snapshot.encodeToBytes());

  return file;
}

/** Open the native share sheet with the rendered card. */
export async function shareCard(args: {
  ref: RefObject<View | null>;
  name: string;
}): Promise<void> {
  const file = await renderCardPng(args);

  await Sharing.shareAsync(file.uri, {
    UTI: 'public.png',
    dialogTitle: translate('detail_share_card'),
    mimeType: 'image/png',
  });
}
