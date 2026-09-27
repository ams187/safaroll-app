// Le nom d'une discussion, écrit par le modèle plutôt que découpé au couteau.
//
// Avant, le titre était le premier message tronqué à 120 caractères : « Est-ce
// que le martinet noir dort vraiment en vol ou c'est une légende que… ». Un
// historique de dix lignes comme celle-là ne se lit pas.
//
// UN APPEL À PART, ET PAS DANS LA CONVERSATION. `guide-chat` est un relais
// WebSocket vers une chaîne `previous_response_id` unique : y glisser une
// demande de titre polluerait le contexte de la vraie discussion. Ici, une
// requête HTTP isolée, sans mémoire (`store: false`), une dizaine de jetons.
//
// LE REPLI EST LE COMPORTEMENT D'AVANT. Tout ce qui échoue — clé absente,
// modèle indisponible, réponse vide — rend 200 avec `title: null`, et le client
// garde le message tronqué. Un titre est un confort ; il ne doit jamais
// empêcher une discussion de commencer.
//
// MAIS IL DIT POURQUOI. `reason` accompagne chaque `null` et le client le
// journalise en développement. Un repli silencieux se comporte exactement comme
// une fonctionnalité qui marche mal : on relance, on relit son code, on cherche
// côté client. Une ligne de texte évite tout ça. Rien de secret n'y passe — un
// mot-clé, un code HTTP, et le message d'erreur de l'API.

import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const MODEL = 'gpt-5.5';
const MAX_MESSAGE = 500;
/** Deux ou trois mots. La borne est là pour le cas où le modèle raconte sa vie. */
const MAX_TITLE = 40;

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

  const body = await request.json().catch(() => ({})) as { message?: unknown };
  if (typeof body.message !== 'string' || !body.message.trim()) return json({ error: 'Invalid message' }, 400);

  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAiKey) return json({ reason: 'no-key', title: null });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openAiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      max_output_tokens: 2000,
      instructions:
        "Tu nommes une discussion à partir de son premier message. Rends UNIQUEMENT le nom : deux ou trois mots, quatre au maximum, dans la langue du message. Pas de guillemets, pas de point final, pas de phrase, pas de verbe conjugué si tu peux l'éviter. Une étiquette qu'on reconnaît d'un coup d'œil dans une liste. Exemples : « Sommeil du martinet », « Chenille urticante », « Rapaces nocturnes ».",
      input: [{ type: 'message', role: 'user', content: body.message.slice(0, MAX_MESSAGE) }],
    }),
    signal: AbortSignal.timeout(12_000),
  }).catch((error) => ({ ok: false, status: 0, text: () => String(error) } as unknown as Response));

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return json({ reason: `http-${response.status}: ${detail.slice(0, 300)}`, title: null });
  }
  const payload = await response.json().catch(() => null) as {
    incomplete_details?: { reason?: string };
    output?: { content?: { text?: string; type?: string }[]; type?: string }[];
    output_text?: string;
    status?: string;
  } | null;

  const raw = payload?.output_text
    ?? payload?.output
      ?.flatMap((item) => item.content ?? [])
      .filter((part) => part.type !== 'reasoning')
      .map((part) => part.text ?? '')
      .join('')
    ?? '';
  // Le modèle met parfois des guillemets ou un point malgré la consigne.
  const title = raw.trim().replace(/^["«»'\s]+|["«»'.\s]+$/g, '').slice(0, MAX_TITLE);
  if (title) return json({ title });
  // Le cas le plus probable quand tout va bien par ailleurs : `gpt-5.5` raisonne,
  // et ses jetons de réflexion comptent dans `max_output_tokens`. À court, il
  // rend `status: 'incomplete'` sans avoir écrit un mot.
  return json({
    reason: `vide (status=${payload?.status ?? '?'}, incomplete=${payload?.incomplete_details?.reason ?? '-'}, sorties=${payload?.output?.map((item) => item.type).join('+') ?? '-'})`,
    title: null,
  });
});
