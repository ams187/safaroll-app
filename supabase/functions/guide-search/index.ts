import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('authorization');
  if (!authorization) return json({ error: 'Unauthorized' }, 401);

  const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { authorization } },
    auth: { persistSession: false },
  });
  const { data: userId, error: authError } = await userDb.rpc('current_user_id');
  if (authError || !userId) return json({ error: 'Unauthorized' }, 401);
  const { data: profile } = await userDb.from('profiles').select('is_premium').eq('user_id', userId).maybeSingle();
  if (!profile?.is_premium) return json({ error: 'SafaRoll+ required' }, 403);

  const body = await request.json().catch(() => ({})) as { query?: unknown; topK?: unknown };
  if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 160) {
    return json({ error: 'Invalid query' }, 400);
  }
  const topK = typeof body.topK === 'number' && Number.isInteger(body.topK)
    ? Math.min(Math.max(body.topK, 1), 8)
    : 5;
  const { data, error } = await userDb.rpc('search_species_knowledge', {
    search_query: body.query.trim(),
    result_limit: topK,
  });
  if (error) return json({ error: 'Knowledge search failed' }, 500);

  const enriched = await Promise.all((data ?? []).map(async (species: Record<string, unknown>) => {
    const title = String(species.vernacular_name ?? species.scientific_name ?? '');
    const summaryResponse = await fetch(
      `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { 'user-agent': 'SafaRoll/1.0 (species guide)' }, signal: AbortSignal.timeout(4_000) },
    ).catch(() => null);
    const summary = summaryResponse?.ok
      ? await summaryResponse.json().catch(() => null) as { extract?: string; content_urls?: { desktop?: { page?: string } } } | null
      : null;
    return [
      `Espèce : ${species.vernacular_name ?? species.vernacular_name_en ?? species.scientific_name}`,
      `Nom scientifique : ${species.scientific_name}`,
      species.animal_group ? `Groupe : ${species.animal_group}` : null,
      species.class ? `Classe : ${species.class}` : null,
      species.family ? `Famille : ${species.family}` : null,
      species.genus ? `Genre : ${species.genus}` : null,
      species.rarity ? `Rareté SafaRoll : ${species.rarity}` : null,
      summary?.extract ? `Résumé encyclopédique : ${summary.extract}` : null,
      summary?.content_urls?.desktop?.page ? `Source : ${summary.content_urls.desktop.page}` : null,
    ].filter(Boolean).join('\n');
  }));

  const context = enriched.join('\n\n---\n\n');

  return json({ context });
});
