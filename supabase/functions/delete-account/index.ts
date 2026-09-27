// Supprimer son compte. Pour de bon.
//
// Directive Apple 5.1.1(v) : une app qui permet de créer un compte doit
// permettre de le supprimer DEPUIS l'app — pas par un site, pas par un e-mail.
//
// ─────────────────────────────────────────────────────────────────────────
// L'ORDRE N'EST PAS ARBITRAIRE
//
//   1. les données      `delete_my_account()`, avec le jeton DU JOUEUR
//   2. le compte Clerk   l'API d'administration, avec la clé de service
//
// Dans cet ordre parce que les deux échecs possibles ne coûtent pas la même
// chose. Si Clerk tombe après l'étape 1, le joueur peut encore se connecter et
// trouve une app vide : désagréable, et réparable en réessayant. Dans l'autre
// sens, le compte disparaît en laissant derrière lui des photos et un
// historique de conversations que PLUS AUCUNE session ne peut atteindre —
// donc plus personne ne peut supprimer.
//
// ─────────────────────────────────────────────────────────────────────────
// L'IDENTITÉ VIENT DU JETON, JAMAIS DU CORPS
//
// Cette fonction ne prend aucun paramètre. `delete_my_account()` non plus. Un
// `userId` dans le corps de la requête serait une porte pour supprimer le
// compte de quelqu'un d'autre — et il n'y a pas de retour en arrière.

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

  const clerkKey = Deno.env.get('CLERK_SECRET_KEY');
  // Vérifié AVANT de toucher aux données : sans cette clé on ne pourrait pas
  // finir, et il vaut mieux ne rien avoir commencé.
  if (!clerkKey) return json({ error: 'Account deletion is not configured' }, 503);

  // Une clé de développement peut renvoyer 404 pour un compte de production.
  // Vérifier l'identité AVANT toute purge, plutôt que confondre ce 404 avec
  // une suppression réussie.
  const clerkUrl = `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`;
  const clerkHeaders = { authorization: `Bearer ${clerkKey}` };
  const identity = await fetch(clerkUrl, { headers: clerkHeaders });
  if (!identity.ok || (await identity.json()).id !== userId) {
    return json({ error: 'Could not verify account deletion configuration' }, 503);
  }

  // Storage doit effacer les blobs via son API, jamais directement en SQL.
  // Relire la première page après chaque suppression évite de sauter des fichiers.
  for (;;) {
    const { data: files, error: listError } = await userDb.rpc('list_my_account_files');
    if (listError) return json({ error: 'Could not list account files' }, 500);
    if (!files?.length) break;
    for (const bucket of ['capture-originals', 'capture-stickers', 'items']) {
      const paths = files.filter((file: { bucket_id: string }) => file.bucket_id === bucket)
        .map((file: { name: string }) => file.name);
      if (!paths.length) continue;
      const { data: removed, error } = await userDb.storage.from(bucket).remove(paths);
      if (error || removed?.length !== paths.length) {
        return json({ error: 'Could not delete all account files; please retry' }, 500);
      }
    }
  }

  // 1. Les données. La fonction est transactionnelle et vérifie son propre
  //    travail : si une table lui échappe, elle lève et RIEN n'est supprimé.
  const { error: purgeError } = await userDb.rpc('delete_my_account');
  if (purgeError) return json({ error: `Data deletion failed: ${purgeError.message}` }, 500);

  // 2. Le compte lui-même.
  const clerk = await fetch(clerkUrl, {
    method: 'DELETE',
    headers: clerkHeaders,
  });
  if (!clerk.ok && clerk.status !== 404) {
    // Les données sont parties, le compte non. On le DIT plutôt que de rendre
    // un succès : le joueur doit savoir qu'il reste une identité à effacer, et
    // rappuyer suffit — la première étape est idempotente.
    return json({ error: 'Account data was deleted but the login could not be removed', purged: true }, 502);
  }

  return json({ ok: true });
});
