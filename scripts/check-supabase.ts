const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const url = required('EXPO_PUBLIC_SUPABASE_URL');
const key = required('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
const clerkKey = required('CLERK_SECRET_KEY');
const clerkHeaders = { authorization: `Bearer ${clerkKey}` };

const users = await fetch('https://api.clerk.com/v1/users?limit=1', { headers: clerkHeaders }).then((response) => response.json());
const userId = users[0]?.id;
if (!userId) throw new Error('No Clerk user available for the integration check');

const sessions = await fetch(`https://api.clerk.com/v1/sessions?user_id=${encodeURIComponent(userId)}&status=active`, { headers: clerkHeaders }).then((response) => response.json());
const sessionId = sessions[0]?.id;
if (!sessionId) throw new Error('No active Clerk session available for the integration check');

const tokenResponse = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/tokens`, {
  method: 'POST', headers: { ...clerkHeaders, 'content-type': 'application/json' }, body: '{}',
}).then((response) => response.json());
const token = tokenResponse.jwt as string | undefined;
if (!token) throw new Error('Clerk did not mint a session token');

const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { role?: string };
if (claims.role !== 'authenticated') {
  throw new Error('Clerk session tokens need the custom claim {"role":"authenticated"}');
}

const headers = { apikey: key, authorization: `Bearer ${token}` };
const [catalog, promotedSpecies, captures, anonymousCaptures, profile, anonymousProfile, decks, cardScene] = await Promise.all([
  fetch(`${url}/rest/v1/species_catalog?select=scientific_name`, { headers }),
  fetch(`${url}/rest/v1/world_species?select=scientific_name&status=eq.validated&artwork_status=eq.ready&artwork_path=not.is.null&gbif_key=not.is.null`, { headers }),
  fetch(`${url}/rest/v1/animal_captures?select=id`, { headers }),
  fetch(`${url}/rest/v1/animal_captures?select=id`, { headers: { apikey: key } }),
  fetch(`${url}/rest/v1/profiles?select=user_id,display_name&user_id=eq.${encodeURIComponent(userId)}`, { headers }),
  fetch(`${url}/rest/v1/profiles?select=user_id&user_id=eq.${encodeURIComponent(userId)}`, { headers: { apikey: key } }),
  fetch(`${url}/rest/v1/decks?select=id,profiles!decks_user_id_fkey(display_name)`, { headers }),
  fetch(`${url}/storage/v1/object/public/card-scenes/phoenicopterus-roseus.webp`),
]);

const catalogRows = await catalog.json();
const promotedRows = await promotedSpecies.json();
const captureRows = await captures.json();
const anonymousRows = await anonymousCaptures.json();
const profileRows = await profile.json();
const anonymousProfileRows = anonymousProfile.ok ? await anonymousProfile.json() : [];
const deckRows = await decks.json();
if (!promotedSpecies.ok) throw new Error(`World catalog is unreadable (${promotedSpecies.status})`);
const expectedCatalogSize = 884 + promotedRows.length;
if (!catalog.ok || catalogRows.length !== expectedCatalogSize) {
  throw new Error(`Global catalog is incomplete (${catalog.status}/${catalogRows.length}, expected ${expectedCatalogSize})`);
}
// Not a fixed count any more: it was 40 on migration day, and it goes down
// every time a card is burnt, so it fired on ordinary use and hid every check
// below it.
if (!captures.ok || captureRows.length === 0) throw new Error(`Captures are unreadable (${captures.status}/${captureRows.length})`);
if (!anonymousCaptures.ok || anonymousRows.length !== 0) throw new Error(`RLS leaked private captures (${anonymousCaptures.status}/${anonymousRows.length})`);
if (!profile.ok || profileRows.length !== 1) throw new Error(`Profile is missing (${profile.status}/${profileRows.length})`);
if (anonymousProfileRows.length !== 0) throw new Error('RLS leaked a profile to anonymous users');
if (!decks.ok || !Array.isArray(deckRows)) throw new Error(`Deck/profile relation is broken (${decks.status})`);
if (!cardScene.ok) throw new Error('Card scene storage migration is incomplete');

// One deck write, end to end.
//
// `reorder_deck_cards` shipped with a plain SQL fault — `value` selected from a
// `WITH ORDINALITY` set that never named a column that — and nothing caught it:
// it typechecks, it lints, and the client's own error handling turns a failed
// reorder into a silent snap-back. The only thing that sees it is calling it.
// So this swaps the first two cards of a real deck, checks the swap landed, and
// puts them back.
const deckCards = await fetch(
  `${url}/rest/v1/deck_cards?select=deck_id,capture_id,position&order=deck_id,position`,
  { headers },
).then((response) => response.json());

const deckId = deckCards.find(
  (card: { deck_id: string }) => deckCards.filter((other: { deck_id: string }) => other.deck_id === card.deck_id).length >= 2,
)?.deck_id;

if (!deckId) {
  console.log(`Supabase migration OK: Clerk auth, profiles, ${expectedCatalogSize} global species, captures, RLS and card scenes. (no deck with 2+ cards — reorder not exercised)`);
} else {
  const order: string[] = deckCards.filter((card: { deck_id: string }) => card.deck_id === deckId).map((card: { capture_id: string }) => card.capture_id);
  const swapped = [order[1], order[0], ...order.slice(2)];

  const reorder = (ids: string[]) =>
    fetch(`${url}/rest/v1/rpc/reorder_deck_cards`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ target_deck_id: deckId, target_capture_ids: ids }),
    });

  const swap = await reorder(swapped);
  if (!swap.ok) throw new Error(`Deck reorder was rejected (${swap.status} ${await swap.text()})`);

  const after = await fetch(
    `${url}/rest/v1/deck_cards?select=capture_id&deck_id=eq.${deckId}&order=position`,
    { headers },
  ).then((response) => response.json());
  const landed = after.map((card: { capture_id: string }) => card.capture_id);

  // Restored before the assertion: a failed check must not leave the deck
  // shuffled.
  const restore = await reorder(order);
  if (JSON.stringify(landed) !== JSON.stringify(swapped)) throw new Error(`Deck reorder did not persist (${JSON.stringify(landed)})`);
  if (!restore.ok) throw new Error(`Deck order could not be restored (${restore.status} ${await restore.text()})`);

  console.log(`Supabase migration OK: Clerk auth, profiles, ${expectedCatalogSize} global species, captures, RLS, card scenes and a deck reorder round-trip.`);
}
