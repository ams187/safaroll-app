import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

const short = (value: string, max: number) => value.trim().replace(/\s+/g, ' ').slice(0, max);

function fallbackMetadata(item: Record<string, unknown>) {
  if (item.type === 'note') {
    const note = short(String(item.note ?? ''), 10_000);
    if (!note) throw new Error('Note is empty');
    return {
      title: short(note.split(/[.!?\n]/)[0] || note, 80),
      description: short(note, 280),
      tags: ['note'],
      search_text: note,
    };
  }

  if (item.type === 'link') {
    const url = new URL(String(item.url ?? ''));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL');
    const siteName = url.hostname.replace(/^www\./, '');
    return {
      title: short(siteName, 80),
      description: short(url.href, 280),
      site_name: siteName,
      tags: ['lien'],
      search_text: `${siteName} ${url.href}`,
    };
  }

  if (item.type === 'image') {
    return {
      title: item.is_sticker ? 'Sticker sauvegardé' : 'Image sauvegardée',
      description: null,
      tags: item.is_sticker ? ['image', 'sticker'] : ['image'],
      search_text: item.is_sticker ? 'sticker image' : 'image',
    };
  }

  throw new Error('Unsupported item type');
}

Deno.serve(async (request) => {
  const authorization = request.headers.get('authorization');
  if (!authorization) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => ({})) as { itemId?: string; findLinks?: boolean };
  if (!body.itemId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.itemId)) {
    return json({ error: 'Invalid itemId' }, 400);
  }

  const userDb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { authorization } }, auth: { persistSession: false } },
  );
  const { data: userId, error: authError } = await userDb.rpc('current_user_id');
  if (authError || !userId) return json({ error: 'Unauthorized' }, 401);

  const { data: item, error: readError } = await userDb.from('items').select('*').eq('id', body.itemId).maybeSingle();
  if (readError || !item) return json({ error: 'Item not found' }, 404);

  if (body.findLinks) {
    const { error } = await userDb.from('items').update({ products_status: 'failed' }).eq('id', item.id);
    if (error) return json({ error: error.message }, 500);
    return json({ status: 'unavailable' });
  }

  try {
    const metadata = fallbackMetadata(item);
    const { error } = await userDb.from('items').update({ ...metadata, status: 'ready' }).eq('id', item.id);
    if (error) throw error;
    return json({ status: 'ready' });
  } catch (error) {
    await userDb.from('items').update({ status: 'failed' }).eq('id', item.id);
    console.error('process-item', error);
    return json({ error: 'Item processing failed' }, 422);
  }
});
