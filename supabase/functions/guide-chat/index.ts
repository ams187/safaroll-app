import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const MAX_FRAME_BYTES = 12 * 1024 * 1024;

/**
 * Est-ce un tour DU JOUEUR ?
 *
 * Deux sortes de trames partent d'ici vers OpenAI, et une seule doit compter :
 *
 *   response.create + input[message]              ← le joueur a écrit
 *   response.create + input[function_call_output] ← l'atlas répond au modèle
 *
 * La seconde est provoquée par le modèle lui-même. La compter diviserait le
 * plafond réel par deux, de façon invisible et selon les questions posées.
 *
 * Test sur la CHAÎNE, sans `JSON.parse` : une trame peut peser douze mégaoctets
 * quand le joueur joint une photo, et analyser tout ça à chaque message pour en
 * lire deux champs coûterait plus cher que ce qu'on protège.
 */
const estUnTourDuJoueur = (raw: string) =>
  raw.includes('"response.create"') && !raw.includes('"function_call_output"');

const PLAFOND_ATTEINT = JSON.stringify({
  type: 'error',
  error: {
    code: 'guide_daily_limit',
    message: 'Reviens lui parler demain.',
  },
});

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

Deno.serve(async (request) => {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'WebSocket upgrade required' }, 426);
  }

  const authorization = request.headers.get('authorization');
  if (!authorization) return json({ error: 'Unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false },
  });
  const { data: userId, error: authError } = await userDb.rpc('current_user_id');
  if (authError || !userId) return json({ error: 'Unauthorized' }, 401);

  const { data: profile } = await userDb
    .from('profiles')
    .select('is_premium')
    .eq('user_id', userId)
    .maybeSingle();
  if (!profile?.is_premium) return json({ error: 'SafaRoll+ required' }, 403);

  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAiKey) return json({ error: 'Guide is not configured' }, 503);

  const { socket, response } = Deno.upgradeWebSocket(request);
  const upstream = new WebSocket('wss://api.openai.com/v1/responses', {
    headers: { Authorization: `Bearer ${openAiKey}` },
  });
  const queued: string[] = [];

  upstream.on('open', () => {
    while (queued.length) upstream.send(queued.shift() as string);
  });
  upstream.on('message', (data) => {
    if (socket.readyState === globalThis.WebSocket.OPEN) socket.send(data.toString());
  });
  upstream.on('error', () => {
    if (socket.readyState === globalThis.WebSocket.OPEN) socket.close(1011, 'Guide upstream error');
  });
  upstream.on('close', (code, reason) => {
    if (socket.readyState === globalThis.WebSocket.OPEN) socket.close(code || 1000, reason.toString().slice(0, 120));
  });

  const relayer = (data: string) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
    else if (upstream.readyState === WebSocket.CONNECTING) queued.push(data);
  };

  /**
   * La file. Le plafond se lit en base, donc de façon asynchrone, alors qu'une
   * trame arrive de façon synchrone : sans cette chaîne, une réponse de l'atlas
   * pourrait doubler le message du joueur qu'elle suit et arriver chez OpenAI
   * dans le désordre.
   */
  let file: Promise<void> = Promise.resolve();

  socket.onmessage = ({ data }) => {
    if (typeof data !== 'string' || new TextEncoder().encode(data).byteLength > MAX_FRAME_BYTES) {
      socket.close(1009, 'Message too large');
      return;
    }
    file = file.then(async () => {
      if (socket.readyState !== globalThis.WebSocket.OPEN) return;
      if (estUnTourDuJoueur(data)) {
        const { data: autorise, error } = await userDb.rpc('consume_guide_message');
        // Une panne du compteur ne doit pas couper le Guide à un abonné : on
        // laisse passer. Le plafond protège d'une boucle, il n'est pas un
        // verrou de sécurité — l'abonnement, lui, a déjà été vérifié plus haut.
        if (!error && autorise === false) {
          socket.send(PLAFOND_ATTEINT);
          socket.close(1008, 'Guide daily limit');
          return;
        }
      }
      relayer(data);
    });
  };
  socket.onerror = () => upstream.close();
  socket.onclose = () => upstream.close();

  const closed = new Promise<void>((resolve) => {
    socket.addEventListener('close', () => resolve(), { once: true });
  });
  EdgeRuntime.waitUntil(closed);
  return response;
});
