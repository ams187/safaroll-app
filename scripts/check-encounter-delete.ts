import { readFile } from 'node:fs/promises';

const switcher = await readFile('src/components/cards/encounter-switcher.tsx', 'utf8');
const backend = await readFile('src/lib/supabase/backend.ts', 'utf8');

if (switcher.includes('Alert.alert')) throw new Error('Sticker deletion still depends on a nested native alert');
if (!switcher.includes('executerSuppression(cibleAConfirmer)')) throw new Error('Inline sticker deletion confirmation is missing');
if (!backend.includes(".delete().eq('id', args.id).select('id, original_path, sticker_path').maybeSingle()")) {
  throw new Error('Capture deletion does not verify the deleted row');
}
if (!backend.includes('stickerThumbPath(data.sticker_path)')) throw new Error('Sticker thumbnail cleanup is missing');

console.log('Encounter sticker deletion contract OK.');
