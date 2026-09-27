import { createClient } from '@supabase/supabase-js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// `EXPO_PUBLIC_SUPABASE_URL` en repli : c'est la seule des deux que `.env.local`
// définit, et l'URL du projet n'a rien de secret — seule la clé l'est.
const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  throw new Error(
    'Il manque SUPABASE_SECRET_KEY (Dashboard → Project Settings → API Keys → service_role).',
  );
}
const db = createClient(url, key, { auth: { persistSession: false } });
const directory = join(process.cwd(), 'assets/cards/species');
const files = readdirSync(directory).filter((name) => name.endsWith('.webp'));

for (let index = 0; index < files.length; index += 10) {
  await Promise.all(files.slice(index, index + 10).map(async (name) => {
    const { error } = await db.storage.from('card-scenes').upload(name, await Bun.file(join(directory, name)).arrayBuffer(), {
      contentType: 'image/webp', cacheControl: '31536000', upsert: true,
    });
    if (error) throw new Error(`${name}: ${error.message}`);
  }));
  console.log(`${Math.min(index + 10, files.length)}/${files.length}`);
}

