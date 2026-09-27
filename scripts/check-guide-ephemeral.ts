// Une question posée depuis une fiche ne doit RIEN laisser derrière elle.
//
// Le bogue réparé ici : la feuille « Demander au Guide » d'une carte écrivait
// dans le magasin singleton du Guide du profil. La question s'ajoutait au fil
// en cours, partait en base, et réapparaissait superposée à la conversation du
// profil au retour. Trois choses doivent tenir, et ce sont les trois assertions
// ci-dessous : le fil du profil est rendu intact, rien n'est sauvegardé pendant
// l'emprunt, et la chaîne serveur (`previousResponseId`) ne traverse pas.

import { mock } from 'bun:test';

let sauvegardes = 0;
let envoye: string | null = null;
let recevoir: (raw: string) => void = () => {};
/** La réponse du serveur qui pose la chaîne : c'est elle qui fixe `previousResponseId`. */
const termine = (id: string) => recevoir(JSON.stringify({ type: 'response.completed', response: { id } }));

let titresDemandes: string[] = [];
mock.module('@/lib/supabase/client', () => ({
  getSupabaseAccessToken: async () => 'jeton',
  supabase: {
    functions: {
      invoke: async (nom: string, options: { body: { message: string } }) => {
        titresDemandes.push(`${nom}:${options.body.message}`);
        return { data: { title: 'Sommeil du martinet' }, error: null };
      },
    },
  },
}));
mock.module('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }), currentState: 'active' } }));
mock.module('react-native-nitro-websockets', () => ({ NitroWebSocket: class {} }));
mock.module('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `id-${(n += 1)}` };
});
mock.module('@/lib/notify', () => ({ announce: { done() {}, fail() {} }, toast: { done() {}, fail() {}, info() {} } }));
mock.module('@/components/guide/rag/search-knowledge-base', () => ({ searchSafaRollKb: async () => '' }));
mock.module('@/components/guide/openai/connection-manager', () => ({
  connectionManager: {
    forceReconnect() {},
    send(payload: string) { envoye = payload; return true; },
    setHandlers(handlers: { onServerEvent: (raw: string) => void }) { recevoir = handlers.onServerEvent; },
  },
}));
mock.module('@/components/guide/state/guide-persistence', () => ({
  saveGuideConversation: async () => { sauvegardes += 1; },
}));

const { useChatStore } = await import('../src/components/guide/state/chat-store');

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(`check-guide-ephemeral: ${message}`);
};
const attendre = () => new Promise((resolve) => setTimeout(resolve, 0));

// ── Le fil du profil : une question, une réponse close ─────────────────────
useChatStore.getState().send('Où niche le martinet ?');
termine('resp_profil');
await attendre();

assert(titresDemandes.length === 1, 'un premier message doit demander un nom de discussion');
assert(useChatStore.getState().title === 'Sommeil du martinet', 'le nom rendu par le modèle doit remplacer le repli');

const filProfil = useChatStore.getState();
const idProfil = filProfil.conversationId;
assert(filProfil.messages.length === 2, 'le fil du profil doit porter la question et la réponse');
assert(idProfil !== null, 'le fil du profil doit avoir un identifiant');
assert(sauvegardes > 0, 'un fil du profil doit être sauvegardé');

// ── L'emprunt : une question de fiche ──────────────────────────────────────
const avant = sauvegardes;
useChatStore.getState().startEphemeral();
assert(useChatStore.getState().messages.length === 0, "l'emprunt doit partir d'une feuille vierge");
assert(useChatStore.getState().conversationId === null, "l'emprunt ne doit hériter d'aucun identifiant");

const titresAvantFiche = titresDemandes.length;
useChatStore.getState().send('À propos du Martinet noir : que mange-t-il ?');
assert(
  titresDemandes.length === titresAvantFiche,
  "une question de fiche ne doit pas demander de nom : elle n'est jamais sauvegardée",
);
assert(
  JSON.parse(envoye ?? '{}').previous_response_id === undefined,
  "la question de fiche ne doit pas hériter de la chaîne serveur du profil",
);
termine('resp_fiche');
await attendre();
assert(sauvegardes === avant, 'AUCUNE sauvegarde ne doit partir pendant une question de fiche');

useChatStore.getState().rate(useChatStore.getState().messages[1]!.id, 'up');
await attendre();
assert(sauvegardes === avant, 'noter une réponse de fiche ne doit rien sauvegarder non plus');

// ── Le retour : le fil du profil rendu intact ──────────────────────────────
useChatStore.getState().endEphemeral();
const rendu = useChatStore.getState();
assert(rendu.ephemeral === false, "l'emprunt doit être terminé");
assert(rendu.conversationId === idProfil, 'le fil du profil doit retrouver son identifiant');
assert(rendu.messages.length === 2, 'le fil du profil doit retrouver ses deux messages, et pas un de plus');
assert(rendu.messages[0]!.text === 'Où niche le martinet ?', 'le premier message du profil doit être le sien');
assert(rendu.title === filProfil.title, 'le titre du fil du profil doit être rendu');

// La chaîne serveur revient elle aussi : sans ça le profil repartirait sans
// contexte, ou pire, avec celui de la fiche.
useChatStore.getState().send('Et en hiver ?');
assert(
  JSON.parse(envoye ?? '{}').previous_response_id === 'resp_profil',
  'le fil du profil doit reprendre SA chaîne serveur, pas celle de la fiche',
);
useChatStore.getState().stop();
await attendre();
useChatStore.getState().loadConversation({
  id: idProfil!, messages: filProfil.messages, pinned: false, previousResponseId: 'resp_profil',
  title: filProfil.title, updatedAt: '',
});

// ── L'epoch : tout remplacement en bloc doit invalider l'ancre de défilement ─
// `ChatScreen` mémorise la position du message envoyé pour le caler en haut.
// Si cette position survit à un changement de contenu, la liste calcule son
// espace de fin sur des messages qui n'existent plus.
{
  const debut = useChatStore.getState().epoch;
  useChatStore.getState().send('Un message de plus');
  assert(useChatStore.getState().epoch === debut, 'envoyer un message ne doit PAS invalider l\'ancre');
  useChatStore.getState().stop();

  const avantChargement = useChatStore.getState().epoch;
  const memeFil = {
    id: idProfil!, messages: filProfil.messages, pinned: false, previousResponseId: 'resp_profil',
    title: filProfil.title, updatedAt: '',
  };
  useChatStore.getState().loadConversation(memeFil);
  assert(
    useChatStore.getState().epoch > avantChargement,
    'rouvrir LA MÊME discussion doit invalider l\'ancre : l\'identifiant ne change pas, les messages si',
  );

  const avantNouvelle = useChatStore.getState().epoch;
  useChatStore.getState().newChat();
  assert(useChatStore.getState().epoch > avantNouvelle, 'une nouvelle discussion doit invalider l\'ancre');

  useChatStore.getState().loadConversation(memeFil);
}

// ── Idempotence : le filet de démontage ne doit pas casser un fil vivant ───
useChatStore.getState().endEphemeral();
assert(useChatStore.getState().messages.length === 2, 'un second retour à vide ne doit rien effacer');

// ── Le plafond quotidien : ce que voit le joueur au 51ᵉ message ────────────
{
  const avant = useChatStore.getState().messages.length;
  useChatStore.getState().send('Une question de trop');
  assert(useChatStore.getState().messages.length === avant + 2, 'un envoi pose la question ET la bulle du Guide');

  recevoir(JSON.stringify({
    type: 'error',
    error: { code: 'guide_daily_limit', message: 'Reviens lui parler demain.' },
  }));

  const etat = useChatStore.getState();
  assert(etat.paused, 'le plafond doit fermer le Guide pour la session');
  assert(
    etat.messages.length === avant + 1,
    "la bulle vide du Guide doit DISPARAÎTRE — la laisser en erreur affiche « Réessaie », " +
      'un geste qui ne peut pas aboutir avant demain',
  );
  assert(!etat.isStreaming, 'plus rien ne coule');

  const fige = useChatStore.getState().messages.length;
  useChatStore.getState().send('Et encore une');
  assert(
    useChatStore.getState().messages.length === fige,
    'une fois en pause, plus aucun envoi ne part — sinon chaque tentative gonflerait le compteur du serveur',
  );
}

console.log('check-guide-ephemeral: une question de fiche ne touche ni la base ni le fil du profil');
