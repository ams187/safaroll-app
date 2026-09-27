import { stickerThumbPath } from '@/lib/animals/photo-payload';
import { queryClient } from '@/lib/query-client';
import { useAuth } from '@clerk/expo';
import { queryOptions, useQuery as useTanstackQuery } from '@tanstack/react-query';
import { createContext, createElement, use, useCallback, useMemo, type ReactNode } from 'react';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { createMMKV } from 'react-native-mmkv';
import { createWorkletRuntime, runOnRuntimeAsync, type WorkletRuntime } from 'react-native-worklets';
import type { Endpoint } from './api';
import { getSupabaseAccessToken, supabase } from './client';

type AnyRow = Record<string, any>;

/**
 * INVALIDER PAR FAMILLES, JAMAIS TOUT.
 *
 * `invalidateQueries()` sans filtre refetche TOUTES les requêtes actives — dont
 * le catalogue : 5 576 lignes, six pages HTTP, ~3 Mo de JSON à parser sur le
 * fil JS. Chaque mutation (poser une carte, épingler, liker) et chaque
 * événement realtime le déclenchait, et c'est exactement le gel que l'on
 * sentait en parcourant la collection : le scroll s'arrête le temps que le
 * monde entier soit re-téléchargé.
 *
 * Les clés de requête sont `['supabase', '<famille>.<nom>', args]` : un
 * préfixe de famille suffit à cibler. Le catalogue et les saisons ne figurent
 * dans AUCUNE portée — ils ne changent qu'aux imports, côté serveur.
 */
export function invalidateFamilies(prefixes: string[]) {
  return queryClient.invalidateQueries({
    predicate: (query) =>
      prefixes.some((prefix) => String(query.queryKey[1] ?? '').startsWith(prefix)),
  });
}

/** Ce qu'une mutation d'une famille peut rendre périmé ailleurs. */
const MUTATION_SCOPES: Record<string, string[]> = {
  // Une capture nourrit les decks (elle y est posée), la communauté (les
  // compteurs) et les expéditions (le journal) — mais jamais le catalogue.
  animals: ['animals.', 'decks.', 'community.', 'expeditions.', 'worldSpecies.'],
  animalId: [],
  community: ['community.'],
  decks: ['decks.'],
  expeditions: ['expeditions.', 'animals.'],
  items: ['items.', 'spaces.'],
  // Bloquer quelqu'un retire son deck de la galerie, son nom du podium et sa
  // fiche de la recherche : trois familles, pas une.
  moderation: ['moderation.', 'community.', 'decks.'],
  profile: ['profile.', 'community.'],
  reports: ['animals.'],
  spaces: ['spaces.', 'items.'],
};
const ms = (value: string | null | undefined) => value ? new Date(value).getTime() : undefined;
const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };

async function rpc(name: string, args: AnyRow = {}) {
  const { data, error } = await supabase.rpc(name, args);
  fail(error);
  return data;
}

/**
 * MOI, ET PAS « CE QUE J'AI LE DROIT DE LIRE ».
 *
 * Les politiques RLS de `decks`, `deck_cards` et `animal_captures` disent
 * « la mienne OU une publique » — il le faut, la galerie communautaire lit par
 * là. Une requête « mes decks » qui compte sur RLS pour la borner reçoit donc
 * AUSSI les decks publics des autres. Mesuré : la collection rendait 110
 * cartes dont 80 appartenaient à d'autres comptes, et les cinq decks présentés
 * comme « les miens » appartenaient tous à quelqu'un d'autre — d'où le
 * « Placement impossible » au dépôt d'une carte, `place_deck_card` refusant
 * d'écrire dans le deck d'autrui.
 *
 * Toute requête « à moi » filtre donc explicitement. RLS reste la sécurité ;
 * ce filtre n'est que la portée.
 *
 * Mémorisé par jeton : `current_user_id()` est un aller-retour, et la
 * collection est l'écran le plus chaud de l'app. Le jeton Clerk tourne, et
 * l'entrée tombe avec lui.
 */
let identite: { jeton: string; promesse: Promise<string | null> } | null = null;
async function monId(): Promise<string | null> {
  const jeton = await getSupabaseAccessToken();
  if (!jeton) return null;
  if (identite?.jeton !== jeton) identite = { jeton, promesse: rpc('current_user_id') };
  return identite.promesse;
}

async function invoke(name: string, body: AnyRow) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  fail(error);
  return data;
}

// Persisted queries live for 24h. Keep their private artwork URLs valid past
// that boundary so a restored grid never boots with already-expired images.
const SIGNED_TTL_SECONDS = 60 * 60 * 48;
/** Re-sign this far ahead of expiry, so a URL handed out now outlives the session. */
const RESIGN_BEFORE_MS = 6 * 60 * 60 * 1000;

/**
 * One URL per storage object, reused for as long as it is valid.
 *
 * `createSignedUrls` mints a fresh token every call, so the same die-cut came
 * back under a different URL on every refetch — and every mutation ends with
 * `invalidateQueries()`, so refetches are constant. A URL is an identity to
 * every image cache in the app: expo-image keys its memory and disk caches on
 * it, `card-image.ts` keys its decoded SkImages on it, and the persisted query
 * cache stores it. A new string for the same bytes missed all three at once,
 * which is why the collection kept re-downloading cards it had just shown.
 */
/**
 * LES SIGNATURES SURVIVENT AU REDÉMARRAGE.
 *
 * CE QUE ÇA RÉPARE
 *
 * Le cache était une `Map` en mémoire. Une signature vit 48 h
 * (`SIGNED_TTL_SECONDS`) et n'est refaite qu'à 6 h de la fin
 * (`RESIGN_BEFORE_MS`) — mais la carte partait à chaque fermeture de l'app, et
 * tout était resigné au lancement suivant pour des URLs encore bonnes deux
 * jours.
 *
 * LE COÛT, MESURÉ LE 2026-09-01 SUR UN COMPTE RÉEL
 *
 * Signer sous le jeton du joueur coûte ~18 ms PAR OBJET — l'autorisation est
 * évaluée objet par objet côté serveur. Avec la clé de service, qui contourne
 * RLS, les mêmes 278 chemins passent en 98 ms. C'est linéaire :
 *
 *     10 chemins →   276 ms      278 chemins → 5 148 ms
 *     50 chemins → 1 037 ms      (service)   →    98 ms
 *
 * Et découper en requêtes parallèles ne sauve presque rien (5 952 → 4 519 ms) :
 * le coût est par objet, pas par requête. La seule issue est d'en signer MOINS.
 *
 * L'app en signe 444 au lancement (les originaux, plus deux tailles de
 * détourage par capture). D'où l'écran vide de plusieurs secondes après
 * l'animation de démarrage — l'arbre est monté, il attend ses images.
 *
 * Persister la carte supprime ce coût sur tous les lancements suivants. Le
 * premier lancement après 42 h le paie encore : c'est correct, la signature a
 * réellement expiré.
 *
 * Même mécanisme que `catalogStore` plus bas — MMKV, déjà là, rien de neuf.
 */
const signedStore = createMMKV({ id: 'signed-urls' });
const SIGNED_STORE_KEY = 'v1';

function chargerSignatures() {
  const carte = new Map<string, { expiresAt: number; url: string }>();
  try {
    const brut = signedStore.getString(SIGNED_STORE_KEY);
    if (!brut) return carte;
    const maintenant = Date.now();
    for (const [clef, valeur] of Object.entries(
      JSON.parse(brut) as Record<string, { expiresAt: number; url: string }>,
    )) {
      // Les périmées sont jetées à la lecture, pas gardées puis ignorées :
      // sinon le fichier gonfle indéfiniment avec des URLs mortes.
      if (valeur?.url && valeur.expiresAt - maintenant > RESIGN_BEFORE_MS) carte.set(clef, valeur);
    }
  } catch {
    // Un fichier corrompu ne doit pas empêcher l'app de démarrer : on repart
    // d'un cache vide, ce qui coûte une signature, jamais un écran d'erreur.
  }
  return carte;
}

const signedUrls = chargerSignatures();

// Écriture groupée : `signedMap` peut être appelée plusieurs fois de suite au
// démarrage, et sérialiser 444 entrées à chaque appel coûterait plus cher que
// ce qu'on économise.
let ecritureEnAttente: ReturnType<typeof setTimeout> | null = null;
function enregistrerSignatures() {
  if (ecritureEnAttente) return;
  ecritureEnAttente = setTimeout(() => {
    ecritureEnAttente = null;
    try {
      signedStore.set(SIGNED_STORE_KEY, JSON.stringify(Object.fromEntries(signedUrls)));
    } catch {
      // Le cache est une optimisation : ne pas pouvoir l'écrire ne casse rien.
    }
  }, 1200);
}

async function signedMap(bucket: string, paths: (string | null | undefined)[]) {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  if (!unique.length) return new Map<string, string>();
  const now = Date.now();
  const resolved = new Map<string, string>();
  const missing: string[] = [];
  for (const path of unique) {
    const cached = signedUrls.get(`${bucket}:${path}`);
    if (cached && cached.expiresAt - now > RESIGN_BEFORE_MS) resolved.set(path, cached.url);
    else missing.push(path);
  }
  if (!missing.length) return resolved;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(missing, SIGNED_TTL_SECONDS);
  fail(error);
  (data ?? []).forEach((item, index) => {
    // `item.path` is what the API echoes back; the positional fallback is the
    // shape this used to rely on.
    const path = item.path ?? missing[index];
    if (!item.signedUrl || !path) return;
    signedUrls.set(`${bucket}:${path}`, { expiresAt: now + SIGNED_TTL_SECONDS * 1000, url: item.signedUrl });
    resolved.set(path, item.signedUrl);
  });
  enregistrerSignatures();
  return resolved;
}

function captureShape(row: AnyRow, originals = new Map<string, string>(), stickers = new Map<string, string>()) {
  const originalUrl = originals.get(row.original_path) ?? null;
  return {
    _id: row.id, _creationTime: ms(row.created_at)!, userId: row.user_id,
    status: row.status, originalStorageId: row.original_path, stickerStorageId: row.sticker_path ?? undefined,
    captureSource: row.capture_source, aspectRatio: row.aspect_ratio, capturedAt: ms(row.captured_at)!,
    dominantColor: row.dominant_color ?? undefined, expeditionId: row.expedition_id ?? undefined,
    latitude: row.latitude ?? undefined, longitude: row.longitude ?? undefined,
    scientificName: row.scientific_name ?? undefined, commonName: row.common_name ?? undefined,
    commonNameLocale: row.common_name_locale ?? undefined,
    vernaculars: row.vernaculars ?? undefined, inAtlas: row.in_atlas ?? undefined,
    confidence: row.confidence ?? undefined, identificationIssue: row.identification_issue ?? undefined,
    taxonomy: row.taxonomy ?? undefined, candidates: row.candidates ?? undefined, rarity: row.rarity ?? undefined,
    localEncounterRarity: row.local_encounter_rarity ?? undefined,
    localOccurrenceCount: row.local_occurrence_count ?? undefined, raritySource: row.rarity_source ?? undefined,
    originalUrl, stickerUrl: stickers.get(row.sticker_path) ?? originalUrl,
    // LA VIGNETTE DU DÉTOURAGE, POUR LES VUES OÙ L'ANIMAL EST PETIT.
    //
    // Son chemin se DÉDUIT de celui du détourage (`stickerThumbPath`) : aucune
    // colonne, aucune migration, et le lien entre les deux ne peut pas se
    // rompre. `undefined` si elle n'a pas encore été produite — les captures
    // antérieures au vignettage, ou celles dont l'envoi a échoué. L'appelant
    // retombe alors sur `stickerUrl`.
    stickerThumbUrl: row.sticker_path
      ? stickers.get(stickerThumbPath(row.sticker_path))
      : undefined,
  };
}

/**
 * La planche de chaque espèce présente dans ce lot, en UNE requête.
 *
 * Le slug appartient à l'espèce, pas à la rencontre : l'écrire sur la capture
 * à l'identification le figerait, et une planche livrée demain ne remplacerait
 * jamais l'empruntée d'aujourd'hui. Résolu à la lecture, il suit.
 */
async function sceneSlugs(names: (string | null | undefined)[]) {
  const unique = [...new Set(names.filter((name): name is string => Boolean(name)))];
  if (!unique.length) return new Map<string, string>();
  const rows = await rpc('scene_slugs', { names: unique }).catch(() => null);
  return new Map<string, string>(
    (rows ?? []).map((row: AnyRow) => [row.scientific_name, row.scene_slug]),
  );
}

async function enrichCaptures(rows: AnyRow[], includeOriginals = true) {
  const [originals, stickers, scenes] = await Promise.all([
    includeOriginals ? signedMap('capture-originals', rows.map((row) => row.original_path)) : Promise.resolve(new Map<string, string>()),
    // Les deux tailles en une seule signature : `signedMap` déduplique et
    // met en cache, donc demander la vignette ne coûte pas un aller-retour de
    // plus.
    signedMap('capture-stickers', rows.flatMap((row) =>
      row.sticker_path ? [row.sticker_path, stickerThumbPath(row.sticker_path)] : [],
    )),
    sceneSlugs(rows.map((row) => row.scientific_name)),
  ]);
  return rows.map((row) => ({
    ...captureShape(row, originals, stickers),
    sceneSlug: scenes.get(row.scientific_name) ?? undefined,
  }));
}

const CATALOG_COLUMNS = 'created_at,gbif_key,scientific_name,canonical_name,vernacular_name,vernacular_name_en,kingdom,phylum,class,order,family,genus,animal_group,rarity';
let catalogParserRuntime: WorkletRuntime | null = null;

/** JSON.parse + normalisation des milliers d'espèces, hors du fil React. */
function parseCatalog(raw: string): Promise<AnyRow[]> {
  catalogParserRuntime ??= createWorkletRuntime({ name: 'safaroll-catalog-parser' });
  return runOnRuntimeAsync(
    catalogParserRuntime,
    (json: string) => {
      'worklet';
      const rows = JSON.parse(json) as AnyRow[];
      return rows.map((row) => {
        if ('scientificName' in row) return row;
        return {
          _id: row.scientific_name,
          _creationTime: new Date(row.created_at).getTime(),
          gbifKey: row.gbif_key,
          scientificName: row.scientific_name,
          canonicalName: row.canonical_name,
          vernacularName: row.vernacular_name ?? undefined,
          vernacularNameEn: row.vernacular_name_en ?? undefined,
          kingdom: row.kingdom ?? undefined,
          phylum: row.phylum ?? undefined,
          class: row.class ?? undefined,
          order: row.order ?? undefined,
          family: row.family ?? undefined,
          genus: row.genus ?? undefined,
          group: row.animal_group,
          rarity: row.rarity ?? undefined,
        };
      });
    },
    raw,
  );
}

/** Une tranche du catalogue : Nitro transporte, une worklet parse. */
async function catalogPage(from: number, size: number) {
  const token = await getSupabaseAccessToken();
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) throw new Error('Catalog authentication is unavailable');
  const query = new URLSearchParams({
    limit: String(size),
    offset: String(from),
    order: 'animal_group.asc,vernacular_name.asc.nullslast,scientific_name.asc',
    select: CATALOG_COLUMNS,
  });
  const response = await nitroFetch(`${url}/rest/v1/species_catalog?${query}`, {
    headers: { Accept: 'application/json', apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Catalog page failed (${response.status})`);
  return parseCatalog(await response.text());
}

/**
 * LE CATALOGUE A SON PROPRE TIROIR, HORS DU CACHE PERSISTÉ.
 *
 * Le persister TanStack sérialise le cache ENTIER à chaque activité de
 * requête ; le catalogue en était de loin la plus grosse pièce, donc chaque
 * frappe du persister payait ses ~3 Mo de `JSON.stringify` sur le fil JS.
 * Ici il n'est écrit qu'une fois par vrai fetch — au plus une fois par jour —
 * et relu une fois au premier abonnement du lancement.
 */
const catalogStore = createMMKV({ id: 'catalog-cache' });
const CATALOG_STALE_MS = 24 * 60 * 60 * 1000;

function itemShape(row: AnyRow, imageUrl: string | null = null) {
  return {
    _id: row.id, _creationTime: ms(row.created_at)!, userId: row.user_id, type: row.type, status: row.status,
    title: row.title ?? undefined, description: row.description ?? undefined, url: row.url ?? undefined,
    storageId: row.storage_path ?? undefined, aspectRatio: row.aspect_ratio ?? undefined,
    capturedAt: ms(row.captured_at), latitude: row.latitude ?? undefined, longitude: row.longitude ?? undefined,
    isSticker: row.is_sticker ?? undefined, tags: row.tags ?? [], content: row.content ?? undefined,
    siteName: row.site_name ?? undefined, heroImageUrl: row.hero_image_url ?? undefined, note: row.note ?? undefined,
    intents: row.intents ?? undefined, products: row.products ?? undefined, productsStatus: row.products_status ?? undefined,
    searchText: row.search_text, imageUrl,
  };
}

async function enrichItems(rows: AnyRow[]) {
  const urls = await signedMap('items', rows.map((row) => row.storage_path));
  return rows.map((row) => itemShape(row, urls.get(row.storage_path) ?? null));
}

async function deckResults(community: boolean, authorId?: string) {
  const userId = await monId();
  // Le deck épinglé du PROPRIÉTAIRE des decks demandés — pas du visiteur. Sur un
  // profil visité, c'est le choix de l'hôte qui décide de l'ordre.
  const { data: owner } = await supabase
    .from('profiles').select('pinned_deck_id').eq('user_id', authorId ?? userId).maybeSingle();
  const pinnedId = owner?.pinned_deck_id ?? null;
  let decksQuery = supabase.from('decks').select('*, profiles!decks_user_id_fkey(display_name, avatar_url)').order('created_at', { ascending: !community }).limit(community ? 50 : 5);
  if (community) decksQuery = decksQuery.eq('is_public', true);
  // Hors communauté, `deckResults` ne sert QUE « mes decks » : le borner au
  // porteur du jeton, jamais à ce que RLS laisse passer. Sans jeton, rien —
  // et surtout pas la vitrine publique présentée comme la collection.
  if (authorId) decksQuery = decksQuery.eq('user_id', authorId);
  else if (!community) {
    if (!userId) return [];
    decksQuery = decksQuery.eq('user_id', userId);
  }
  const { data: decks, error } = await decksQuery;
  fail(error);
  if (!decks?.length) return [];
  const ids = decks.map((deck) => deck.id);
  const [{ data: members, error: membersError }, { data: likes, error: likesError }] = await Promise.all([
    supabase.from('deck_cards').select('*, animal_captures(*)').in('deck_id', ids).order('position'),
    supabase.from('deck_likes').select('*').in('deck_id', ids),
  ]);
  fail(membersError); fail(likesError);
  const captures = (members ?? []).map((member: AnyRow) => member.animal_captures).filter(Boolean);
  // `enrichCaptures` et NON `captureShape` : lui seul résout `sceneSlug`.
  //
  // Une espèce sans planche à elle en EMPRUNTE une — `Limenitis archippus`, le
  // vice-roi, porte celle de `pieris-bryoniae`. Sans ce slug, `cardSceneFor`
  // retombe sur un slug déduit du nom latin, `limenitis-archippus.webp`, qui
  // n'existe pas : l'image tombe en 404 et il ne reste que le dégradé.
  //
  // La même carte s'affichait donc avec son fond dans la collection (qui passe
  // par `enrichCaptures`) et sans dans le deck. Ça touchait toutes les espèces
  // à planche empruntée, pas une carte en particulier.
  //
  // `false` : un deck n'affiche jamais la photo d'origine, seulement le
  // détourage — signer les originaux serait un aller-retour pour rien, et
  // c'est ce que faisait déjà le `new Map()` d'avant.
  const shaped = await enrichCaptures(captures, false);
  const byId = new Map(shaped.map((capture) => [capture._id, capture]));
  const results = decks.map((deck) => {
    const deckMembers = (members ?? []).filter((member) => member.deck_id === deck.id);
    const cards = deckMembers.map((member) => byId.get(member.capture_id)).filter(Boolean);
    const deckLikes = (likes ?? []).filter((like) => like.deck_id === deck.id);
    const summary = {
      _id: deck.id, name: deck.name, description: deck.description,
      authorId: deck.user_id === userId ? null : deck.user_id,
      authorName: deck.profiles?.display_name ?? 'Explorer', authorAvatarUrl: deck.profiles?.avatar_url ?? null,
      isPublic: deck.is_public, cardCount: cards.length, likeCount: deckLikes.length,
      liked: deckLikes.some((like) => like.user_id === userId), coverUrl: cards[0]?.stickerUrl ?? null,
      groups: [...new Set(cards.map((card) => card?.taxonomy?.class).filter(Boolean))].slice(0, 4),
      pinned: deck.id === pinnedId,
    };
    return { deck: summary, owner: deck.user_id === userId, captureIds: deckMembers.map((member) => member.capture_id), cards };
  });

  // L'épinglé passe devant — mais SEULEMENT pour un visiteur.
  //
  // Appliqué aussi à ses propres decks, ce tri renumérotait les onglets :
  // épingler le deck 2 le faisait devenir le deck 1. Les cinq numéros sont des
  // emplacements fixes, on y range ses cartes en les retrouvant à leur place ;
  // les réordonner sous les pieds du joueur parce qu'il a choisi un favori,
  // c'est déplacer ses affaires pour l'avoir écouté.
  return community
    ? results.sort((a, b) => Number(b.deck.pinned) - Number(a.deck.pinned))
    : results;
}

async function expeditionSummaries() {
  // `expeditions` est déjà borné au propriétaire par RLS, pas `animal_captures`
  // — et c'est ce second jeu qui décide du « nouvelle espèce » de chaque
  // sortie. Une capture d'autrui dans le lot ferait passer une espèce pour
  // déjà vue, et la sortie ne compterait plus la découverte.
  const uid = await monId();
  if (!uid) return [];
  const [{ data: expeditions, error }, { data: captures, error: captureError }] = await Promise.all([
    supabase.from('expeditions').select('*').order('started_at', { ascending: false }).limit(30),
    supabase.from('animal_captures').select('id, expedition_id, scientific_name, captured_at').eq('user_id', uid).order('captured_at', { ascending: false }).limit(500),
  ]);
  fail(error); fail(captureError);
  return (expeditions ?? []).map((expedition) => {
    const current = (captures ?? []).filter((capture) => capture.expedition_id === expedition.id);
    const species = new Set(current.map((capture) => capture.scientific_name).filter(Boolean));
    let newSpeciesCount = 0;
    for (const name of species) {
      const first = [...(captures ?? [])].filter((capture) => capture.scientific_name === name)
        .sort((a, b) => +new Date(a.captured_at) - +new Date(b.captured_at))[0];
      if (first?.expedition_id === expedition.id) newSpeciesCount += 1;
    }
    return { _id: expedition.id, startedAt: ms(expedition.started_at)!, endedAt: ms(expedition.ended_at) ?? null,
      captureCount: current.length, speciesCount: species.size, newSpeciesCount };
  });
}

/**
 * TOUTES les lignes, pas les mille premières.
 *
 * PostgREST plafonne CHAQUE réponse à `max_rows` (1000, cf.
 * `supabase/config.toml`) sans erreur ni indice. Un `.limit(4000)` sort mille
 * lignes et rien ne le dit ; un `.limit(200)` écrit à la main a le même défaut
 * en pire, parce qu'il se périme sans bruit le jour où le joueur dépasse le
 * chiffre. Mesuré le 2026-09-01 : 167 captures pour une limite de 200.
 *
 * Ce que ça donne quand ça casse : des cartes qui disparaissent de la
 * collection sans message, des espèces qui cessent de compter comme
 * découvertes, un atlas qui rétrécit. Jamais une erreur.
 *
 * L'ORDRE DOIT ÊTRE TOTAL
 *
 * À égalité sur la colonne de tri, Postgres est libre de rendre les ex æquo
 * dans un ordre différent d'une page à l'autre — une ligne sort deux fois, une
 * autre jamais. Chaque appelant termine donc son tri par une colonne unique.
 */
const PAGE = 1000;
async function toutesLesPages<T>(
  page: (de: number, a: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const tout: T[] = [];
  // 200 pages = 200 000 lignes, très au-dessus de toute collection plausible.
  // C'est le filet contre une réponse inattendue, pas une limite de produit.
  for (let de = 0; de < 200 * PAGE; de += PAGE) {
    const { data, error } = await page(de, de + PAGE - 1);
    fail(error as never);
    tout.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return tout;
}

async function queryBackend(key: string, args: AnyRow = {}): Promise<any> {
  if (key === 'animals.listCaptures') {
    const uid = await monId();
    if (!uid) return [];
    // `id` en dernier départageur : deux captures de la même seconde sinon
    // ex æquo, et la pagination en perdrait une.
    return enrichCaptures(await toutesLesPages((de, a) => supabase.from('animal_captures')
      .select('*').eq('user_id', uid)
      .order('created_at', { ascending: false }).order('id').range(de, a)));
  }
  if (key === 'animals.getCapture') {
    const { data, error } = await supabase.from('animal_captures').select('*').eq('id', args.id).maybeSingle();
    fail(error); return data ? (await enrichCaptures([data]))[0] : null;
  }

  if (key === 'profile.isPremium') return (await rpc('is_premium')) ?? false;

  if (key === 'catalog.listAll') {
    // Le catalogue est le MÊME pour tout le monde, partout.
    //
    // Il a été filtré par région un temps — un joueur ne voyait que ce qu'il
    // pouvait croiser chez lui. C'était défendable, et c'est une mauvaise idée :
    // la collection est un objectif commun. Deux joueurs qui comparent leurs
    // avancements doivent avoir le même dénominateur, et le classement n'a de
    // sens que si la course est la même. Un guépard verrouillé chez un Français,
    // c'est une case à remplir un jour — pas un échec.
    //
    // La région reste décisive ailleurs : `seasons.inSeason` dit lesquelles
    // sont trouvables ce mois-ci, là où le joueur se trouve. Quoi chercher
    // maintenant, pas quoi avoir le droit d'avoir.
    //
    // POURQUOI ON PAGINE
    //
    // PostgREST plafonne CHAQUE réponse à `max_rows` (1000, cf.
    // `supabase/config.toml`). Un `.limit(4000)` était donc écrêté en silence :
    // pas d'erreur, pas d'indice, juste 1000 lignes sur 5576. L'app affichait
    // « /1000 » comme taille d'atlas, les 4576 autres espèces n'avaient aucune
    // case à remplir, et une espèce capturée hors de cette tranche ne comptait
    // même pas comme découverte. Paginer reste juste quand le catalogue grandit
    // — un plafond en dur redeviendrait faux au prochain import.
    //
    // LE DÉPARTAGEUR N'EST PAS DÉCORATIF
    //
    // 945 lignes ont un `vernacular_name` nul : à deux colonnes l'ordre n'est
    // pas total, et Postgres est libre de rendre les ex æquo dans un ordre
    // différent d'une requête à l'autre. Sur une pagination par `range`, ça
    // duplique des lignes dans une page et en perd dans une autre.
    // `scientific_name` est unique (vérifié : 5576 distincts sur 5576), donc il
    // fige l'ordre.
    const PAGE = 1000;
    const shaped: AnyRow[] = [];
    // Garde-fou : 60 000 espèces, très au-dessus de tout catalogue plausible.
    // Une boucle non bornée sur une réponse inattendue tournerait sans fin.
    for (let from = 0; from < 60 * PAGE; from += PAGE) {
      const page = await catalogPage(from, PAGE);
      shaped.push(...page);
      if (page.length < PAGE) break;
    }
    // UN CATALOGUE VIDE NE SE MET PAS EN CACHE.
    //
    // Un jeton sans la revendication `role` tombe en `anon` : PostgREST ne rend
    // alors PAS d'erreur, la politique RLS rend simplement zéro ligne. La boucle
    // ci-dessus voit `0 < PAGE`, s'arrête normalement, et écrivait `[]` — que
    // `initialData` resservait ensuite pendant les 24 h de `CATALOG_STALE_MS`.
    // Une panne d'authentification de quelques secondes empoisonnait l'atlas
    // pour une journée, redémarrages compris. Le catalogue n'est jamais vide en
    // vrai : 0 ligne veut dire « on n'a pas pu lire », pas « il n'y a rien ».
    if (shaped.length > 0) {
      catalogStore.set('rows', JSON.stringify(shaped));
      catalogStore.set('at', Date.now());
    }
    return shaped;
  }
  if (key === 'worldSpecies.list') {
    const [species, observations] = await Promise.all([
      toutesLesPages<AnyRow>((de, a) => supabase.from('world_species').select('*')
        .neq('status', 'rejected').order('last_seen_at', { ascending: false }).order('scientific_name').range(de, a)),
      toutesLesPages<AnyRow>((de, a) => supabase.from('world_species_observations')
        .select('scientific_name').order('id').range(de, a)),
    ]);
    const contributed = new Set(observations.map((row) => row.scientific_name));
    const storageUrl = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/card-scenes`;
    return species.map((row) => ({
      scientificName: row.scientific_name,
      commonName: row.common_name ?? row.canonical_name,
      commonNameLocale: row.common_name_locale ?? undefined,
      taxonomy: row.taxonomy,
      status: row.status,
      observationCount: row.observation_count,
      observerCount: row.observer_count,
      averageConfidence: row.average_confidence ?? undefined,
      artworkStatus: row.artwork_status,
      artworkUrl: row.artwork_path ? `${storageUrl}/${row.artwork_path}` : undefined,
      contributed: contributed.has(row.scientific_name),
      firstSeenAt: ms(row.first_seen_at)!,
      lastSeenAt: ms(row.last_seen_at)!,
    }));
  }
  if (key === 'community.leaderboard') {
    const rows = await rpc('community_leaderboard', { period: args.period ?? 'month' });
    return (rows ?? []).map((row: AnyRow) => ({
      rank: Number(row.rank), userId: row.user_id, displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null, speciesCount: Number(row.species_count), me: row.is_me,
    }));
  }
  if (key === 'community.register') {
    const rows = await rpc('register_board', {
      board: args.board ?? 'semaine',
      scope: args.scope ?? 'global',
    });
    return (rows ?? []).map((row: AnyRow) => ({
      rank: Number(row.rank), userId: row.user_id, displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null, score: Number(row.score), me: row.is_me,
      isPremium: row.is_premium === true,
    }));
  }
  if (key === 'community.findExplorer') {
    const rows = await rpc('find_explorer', { handle: args.handle });
    const row = (rows ?? [])[0];
    return row
      ? {
        userId: row.user_id, displayName: row.display_name, avatarUrl: row.avatar_url ?? null,
        status: 'pending', direction: 'out',
      }
      : null;
  }
  if (key === 'moderation.blocked') {
    const rows = await rpc('list_blocked');
    return (rows ?? []).map((row: AnyRow) => ({
      userId: row.user_id, displayName: row.display_name ?? null,
      avatarUrl: row.avatar_url ?? null, blockedAt: ms(row.blocked_at) ?? 0,
    }));
  }
  if (key === 'community.myHandle') return (await rpc('my_handle')) ?? null;
  if (key === 'community.friends') {
    const rows = await rpc('list_friends');
    return (rows ?? []).map((row: AnyRow) => ({
      userId: row.user_id, displayName: row.display_name, avatarUrl: row.avatar_url ?? null,
      status: row.status, direction: row.direction,
    }));
  }
  if (key === 'community.myVisibility') {
    const uid = await rpc('current_user_id');
    const { data, error } = await supabase.from('profiles').select('community_visible').eq('user_id', uid).maybeSingle();
    fail(error);
    return data?.community_visible ?? true;
  }
  if (key === 'profile.myRegion') {
    const uid = await rpc('current_user_id');
    const { data, error } = await supabase.from('profiles').select('region').eq('user_id', uid).maybeSingle();
    fail(error);
    return data?.region ?? null;
  }
  if (key === 'community.profile') {
    // The RPC crosses RLS for the aggregates; the decks do NOT need it — public
    // decks and their captures are readable by policy, so they take the same
    // path as the community gallery, signed stickers included.
    const [data, decks] = await Promise.all([
      rpc('community_profile', { target_user_id: args.userId }),
      deckResults(true, args.userId),
    ]);
    return data ? { ...data, decks } : null;
  }
  if (key === 'decks.listMineWithCards') return deckResults(false);
  if (key === 'decks.listMine') return (await deckResults(false)).map((result) => result.deck);
  if (key === 'decks.listCommunity') return (await deckResults(true)).map((result) => result.deck);
  if (key === 'decks.get') return (await deckResults(false)).find((result) => result.deck._id === args.id)
    ?? (await deckResults(true)).find((result) => result.deck._id === args.id) ?? null;
  if (key === 'expeditions.listMine') return expeditionSummaries();
  if (key === 'expeditions.getActive') return (await expeditionSummaries()).find((item) => item.endedAt === null) ?? null;
  if (key === 'expeditions.get') {
    const summary = (await expeditionSummaries()).find((item) => item._id === args.id);
    if (!summary) return null;
    const { data, error } = await supabase.from('animal_captures').select('*').eq('expedition_id', args.id).order('captured_at', { ascending: false });
    fail(error); return { summary, captures: await enrichCaptures(data ?? []) };
  }
  if (key === 'seasons.inSeason') {
    const month = args.month ?? new Date().getUTCMonth() + 1;
    // Plus de repli sur 'FR' : c'est lui qui servait la saisonnalité française
    // au monde entier. Sans région, on assume le monde et on le dit.
    const wanted = args.region ?? 'GLOBAL';
    const saisons = (region: string) => toutesLesPages<AnyRow>((de, a) => supabase
      .from('species_seasons').select('*').eq('region', region).order('scientific_name').range(de, a));
    let data = await saisons(wanted);
    // Pays pas encore alimenté par `seed:seasons` : on retombe sur le monde
    // plutôt que de rendre une liste vide. L'écran Défis dirait alors « reviens
    // le mois prochain » — un mensonge, puisque le mois prochain n'y changera
    // rien. Une liste mondiale est moins pertinente, jamais fausse.
    if (data.length === 0 && wanted !== 'GLOBAL') data = await saisons('GLOBAL');
    return data.map((row) => {
      const total = row.monthly_counts.reduce((sum: number, count: number) => sum + count, 0);
      return { scientificName: row.scientific_name, monthlyCounts: row.monthly_counts, share: total ? row.monthly_counts[month - 1] / total : 0 };
    }).filter((row) => row.share > 0).sort((a, b) => b.share - a.share).slice(0, args.limit ?? 12);
  }
  if (key === 'items.listItems' || key === 'items.searchItems' || key === 'items.similarItems') {
    let request = supabase.from('items').select('*').order('created_at', { ascending: false }).limit(key === 'items.searchItems' ? 50 : 1000);
    if (key === 'items.searchItems') request = request.textSearch('search_text', args.query?.trim() ?? '', { config: 'simple', type: 'websearch' });
    const { data, error } = await request; fail(error);
    const items = await enrichItems(data ?? []);
    if (key !== 'items.similarItems') return items;
    const source: AnyRow | undefined = items.find((item: AnyRow) => item._id === args.id);
    if (!source) return [];
    const tags = new Set(source.tags);
    return items.filter((item) => item._id !== source._id && item.status === 'ready')
      .map((item) => ({ item, score: item.tags.filter((tag: string) => tags.has(tag)).length }))
      .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 10).map(({ item }) => item);
  }
  if (key === 'items.getItem') {
    const { data, error } = await supabase.from('items').select('*, space_items(space_id, status, spaces(id, name))').eq('id', args.id).maybeSingle();
    fail(error); if (!data) return null;
    const [item] = await enrichItems([data]);
    return { ...item, spaces: (data.space_items ?? []).filter((join: AnyRow) => join.status === 'saved').map((join: AnyRow) => ({ _id: join.spaces.id, name: join.spaces.name })) };
  }
  if (key === 'spaces.listSpaces') {
    const { data, error } = await supabase.from('spaces').select('*, space_items(*, items(*))').order('created_at', { ascending: false });
    fail(error); const itemRows = (data ?? []).flatMap((space) => space.space_items.map((join: AnyRow) => join.items)).filter(Boolean);
    const urls = await signedMap('items', itemRows.map((item: AnyRow) => item.storage_path));
    return (data ?? []).map((space) => {
      const joins = space.space_items ?? [];
      const pool = joins.filter((join: AnyRow) => join.status !== 'dismissed').sort((a: AnyRow, b: AnyRow) => a.status === 'saved' ? -1 : b.status === 'saved' ? 1 : 0);
      return { _id: space.id, _creationTime: ms(space.created_at)!, userId: space.user_id, name: space.name,
        description: space.description ?? undefined, dynamic: space.dynamic,
        itemCount: joins.filter((join: AnyRow) => join.status === 'saved').length,
        suggestionCount: joins.filter((join: AnyRow) => join.status === 'suggested').length,
        previews: pool.map((join: AnyRow) => ({ url: urls.get(join.items?.storage_path) ?? join.items?.hero_image_url,
          type: join.items?.type, aspectRatio: join.items?.aspect_ratio ?? undefined, suggested: join.status === 'suggested' }))
          .filter((preview: AnyRow) => preview.url).slice(0, 3) };
    });
  }
  if (key === 'spaces.getSpace') {
    const { data, error } = await supabase.from('spaces').select('*, space_items(*, items(*))').eq('id', args.id).maybeSingle();
    fail(error); if (!data) return null;
    const joins = data.space_items ?? []; const enriched = await enrichItems(joins.map((join: AnyRow) => join.items).filter(Boolean));
    const byId = new Map(enriched.map((item) => [item._id, item]));
    return { _id: data.id, _creationTime: ms(data.created_at)!, userId: data.user_id, name: data.name,
      description: data.description ?? undefined, dynamic: data.dynamic,
      items: joins.filter((join: AnyRow) => join.status === 'saved').map((join: AnyRow) => ({ ...byId.get(join.item_id), spaceIntents: join.intents ?? undefined })),
      suggestions: joins.filter((join: AnyRow) => join.status === 'suggested').map((join: AnyRow) => byId.get(join.item_id)).filter(Boolean) };
  }
  throw new Error(`Unsupported Supabase query: ${key}`);
}

async function mutateBackend(key: string, args: AnyRow = {}) {
  let result: any = null;
  if (key === 'animalId.warmup') result = await invoke('identify-animal', { warmup: true });
  else if (key === 'animals.attachArtwork') result = await rpc('attach_capture_artwork', { target_capture_id: args.captureId, p_sticker_path: args.stickerStorageId ?? null, p_dominant_color: args.dominantColor ?? null });
  else if (key === 'animals.confirmIdentification') {
    result = await rpc('confirm_capture_identification', { target_capture_id: args.id, target_scientific_name: args.scientificName });
    await invoke('identify-animal', { captureId: args.id, registerConfirmed: true });
  }
  else if (key === 'animals.deleteCapture') {
    const { data, error } = await supabase.from('animal_captures').delete().eq('id', args.id).select('id, original_path, sticker_path').maybeSingle();
    fail(error);
    if (!data) throw new Error('Capture not found or not deletable');
    const stickers = data.sticker_path ? [data.sticker_path, stickerThumbPath(data.sticker_path)] : [];
    await Promise.all([data.original_path && supabase.storage.from('capture-originals').remove([data.original_path]), stickers.length && supabase.storage.from('capture-stickers').remove(stickers)]);
  }
  else if (key === 'community.setVisible') {
    const uid = await rpc('current_user_id');
    const { error } = await supabase.from('profiles').update({ community_visible: args.visible }).eq('user_id', uid);
    fail(error);
  }
  else if (key === 'community.requestFriend') result = await rpc('request_friend', { target_user_id: args.userId });
  else if (key === 'community.respondFriend') {
    result = await rpc('respond_friend', { accept: args.accept, target_user_id: args.userId });
  }
  else if (key === 'decks.pin') result = await rpc('pin_deck', { target_deck_id: args.deckId });
  else if (key === 'profile.setRegion') {
    const uid = await rpc('current_user_id');
    const { error } = await supabase.from('profiles').update({ region: args.region }).eq('user_id', uid);
    fail(error);
  }
  else if (key === 'profile.setAcquisitionSource') {
    const uid = await rpc('current_user_id');
    const { error } = await supabase
      .from('profiles')
      .update({ acquisition_source: args.source })
      .eq('user_id', uid);
    fail(error);
  }
  else if (key === 'decks.ensureDefaults') result = await rpc('ensure_default_decks', { author_name: args.authorName ?? 'Explorer' });
  else if (key === 'decks.placeCard') result = await rpc('place_deck_card', { target_deck_id: args.deckId, target_capture_id: args.captureId, target_position: args.position });
  else if (key === 'decks.reorderCards') result = await rpc('reorder_deck_cards', { target_deck_id: args.deckId, target_capture_ids: args.captureIds });
  else if (key === 'decks.toggleCard') result = await rpc('toggle_deck_card', { target_deck_id: args.deckId, target_capture_id: args.captureId });
  else if (key === 'decks.toggleLike') result = await rpc('toggle_deck_like', { target_deck_id: args.id });
  else if (key === 'decks.togglePublic') result = await rpc('toggle_deck_public', { target_deck_id: args.id });
  else if (key === 'expeditions.start') {
    const active = await queryBackend('expeditions.getActive'); if (active) result = active._id;
    else { const { data, error } = await supabase.from('expeditions').insert({}).select('id').single(); fail(error); if (!data) throw new Error('Expedition creation failed'); result = data.id; }
  }
  else if (key === 'expeditions.end') { const { data, error } = await supabase.from('expeditions').update({ ended_at: new Date().toISOString() }).is('ended_at', null).select('id').maybeSingle(); fail(error); result = data?.id ?? null; }
  else if (key === 'moderation.block') await rpc('block_user', { target_user_id: args.userId });
  else if (key === 'moderation.unblock') await rpc('unblock_user', { target_user_id: args.userId });
  else if (key === 'moderation.report') {
    await rpc('report_content', {
      kind: args.kind, target_id: args.targetId, reason: args.reason,
      note: args.note?.trim().slice(0, 500) ?? null,
    });
  }
  else if (key === 'reports.reportIdentification') {
    const { data: capture, error: captureError } = await supabase.from('animal_captures').select('scientific_name').eq('id', args.captureId).single();
    fail(captureError);
    const { error } = await supabase.from('identification_reports').insert({ capture_id: args.captureId, predicted_name: capture?.scientific_name, claimed_name: args.claimedName.trim().slice(0, 120), note: args.note?.trim().slice(0, 500) }); fail(error);
  }
  else if (key === 'items.deleteItem') {
    const { data } = await supabase.from('items').select('storage_path').eq('id', args.id).maybeSingle();
    const { error } = await supabase.from('items').delete().eq('id', args.id); fail(error); if (data?.storage_path) await supabase.storage.from('items').remove([data.storage_path]);
  }
  else if (key === 'items.createLinkItem' || key === 'items.createNoteItem') {
    const payload = key.endsWith('LinkItem') ? { type: 'link', url: /^\w+:\/\//.test(args.url.trim()) ? args.url.trim() : `https://${args.url.trim()}` } : { type: 'note', note: args.text.trim() };
    const { data, error } = await supabase.from('items').insert({ ...payload, status: 'processing' }).select('id').single(); fail(error);
    if (!data) throw new Error('Item creation failed');
    result = data.id;
    if (args.spaceId) {
      const { error: membershipError } = await supabase.from('space_items').insert({ space_id: args.spaceId, item_id: data.id, status: 'saved' });
      fail(membershipError);
    }
    void supabase.functions.invoke('process-item', { body: { itemId: data.id } });
  }
  else if (key === 'items.findLinks') void supabase.functions.invoke('process-item', { body: { itemId: args.id, findLinks: true } });
  else if (key === 'spaces.createSpace') { const { data, error } = await supabase.from('spaces').insert({ name: args.name.trim(), description: args.description, dynamic: args.dynamic ?? false }).select('id').single(); fail(error); if (!data) throw new Error('Space creation failed'); result = data.id; }
  else if (key === 'spaces.updateSpace') { const { id, ...patch } = args; if (patch.name) patch.name = patch.name.trim(); const { error } = await supabase.from('spaces').update(patch).eq('id', id); fail(error); }
  else if (key === 'spaces.deleteSpace') { const { error } = await supabase.from('spaces').delete().eq('id', args.id); fail(error); }
  else if (['spaces.addItemToSpace', 'spaces.acceptSuggestion'].includes(key)) { const { error } = await supabase.from('space_items').upsert({ item_id: args.itemId, space_id: args.spaceId, status: 'saved' }, { onConflict: 'space_id,item_id' }); fail(error); }
  else if (key === 'spaces.removeItemFromSpace') { const { error } = await supabase.from('space_items').delete().eq('item_id', args.itemId).eq('space_id', args.spaceId).eq('status', 'saved'); fail(error); }
  else if (key === 'spaces.dismissSuggestion') { const { error } = await supabase.from('space_items').update({ status: 'dismissed' }).eq('item_id', args.itemId).eq('space_id', args.spaceId).eq('status', 'suggested'); fail(error); }
  else if (key === 'spaces.acceptAllSuggestions') { const { error } = await supabase.from('space_items').update({ status: 'saved' }).eq('space_id', args.spaceId).eq('status', 'suggested'); fail(error); }
  else if (['animals.generateUploadUrl', 'items.generateUploadUrl', 'animals.createCapture', 'items.createImageItem'].includes(key)) throw new Error(`${key} uses direct Supabase Storage now`);
  else throw new Error(`Unsupported Supabase mutation: ${key}`);
  // Ciblé, pas global : voir `invalidateFamilies`. Le repli sur la famille de
  // la clé couvre une famille nouvelle sans qu'on pense à la table.
  const family = key.split('.')[0];
  await invalidateFamilies(MUTATION_SCOPES[family] ?? [`${family}.`]);
  return result;
}

export function backendQuery<Args, Result>(endpoint: Endpoint<Args, Result>, args: Args) {
  const base = {
    queryKey: ['supabase', endpoint.key, args],
    queryFn: () => queryBackend(endpoint.key, args as AnyRow) as Promise<Result>,
  };
  if (endpoint.key === 'catalog.listAll') {
    const raw = catalogStore.getString('rows');
    const cachedAt = catalogStore.getNumber('at') ?? 0;
    const remaining = Math.max(0, CATALOG_STALE_MS - (Date.now() - cachedAt));
    // Le tiroir reste servi avant le réseau, mais son JSON n'est plus parsé
    // synchroniquement pendant le premier rendu React.
    return queryOptions<Result>({
      ...base,
      queryFn: async () => {
        if (!raw || remaining === 0) return base.queryFn();
        try {
          const parsed = await parseCatalog(raw);
          if (parsed.length > 0) return parsed as Result;
        } catch {
          catalogStore.remove('rows');
          catalogStore.remove('at');
        }
        return base.queryFn();
      },
      staleTime: raw && remaining > 0 ? remaining : CATALOG_STALE_MS,
    });
  }
  if (endpoint.key === 'animals.listCaptures') {
    // La collection est déjà observée par l'onglet principal. Monter une
    // seconde vue (Quêtes, Carte, Livre…) ne doit pas transformer un simple
    // abonnement en refetch de 200 captures, puis rerendre toutes les vues
    // cachées qui partagent ce tableau. Les mutations et le retour au premier
    // plan l'invalident explicitement.
    return queryOptions<Result>({ ...base, refetchOnMount: false, staleTime: 60_000 });
  }
  return queryOptions<Result>({ ...base, staleTime: 60_000 });
}

export function useQuery<Args, Result>(endpoint: Endpoint<Args, Result>, args: Args | 'skip') {
  return useTanstackQuery({ ...backendQuery(endpoint, args === 'skip' ? ({} as Args) : args), enabled: args !== 'skip' }).data;
}

export function useMutation<Args, Result>(endpoint: Endpoint<Args, Result>) {
  return useCallback((args?: Args) => mutateBackend(endpoint.key, (args ?? {}) as AnyRow) as Promise<Result>, [endpoint]);
}

export const useAction = useMutation;

type BackendAuthState = {
  isAuthenticated: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
};

const BackendAuthContext = createContext<BackendAuthState>({
  isAuthenticated: false,
  isLoaded: false,
  isSignedIn: false,
  userId: null,
});

/**
 * Clerk publie l'objet de session complet à chaque rafraîchissement de jeton.
 * SafaRoll n'a besoin ici que de quatre primitives : les sélectionner une fois
 * évite que chaque requête montée se réabonne au même objet mouvant.
 */
export function BackendAuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const isLoaded = auth.isLoaded;
  const isSignedIn = Boolean(auth.isSignedIn);
  const userId = auth.userId ?? null;
  const value = useMemo(
    () => ({ isAuthenticated: isLoaded && isSignedIn, isLoaded, isSignedIn, userId }),
    [isLoaded, isSignedIn, userId],
  );

  return createElement(BackendAuthContext.Provider, { value }, children);
}

export function useBackendAuth() {
  return use(BackendAuthContext);
}
