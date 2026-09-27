import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';
import { updateChorusActivity } from '../_shared/chorus-lifecycle.ts';

import { LANGUAGE_CODES, vernacularsByConsensus } from '../_shared/vernacular-consensus.ts';
import { rarityFromOccurrences } from '../_shared/species-rarity.ts';

type Prediction = {
  scientificName: string; commonName: string; confidence: number;
  kingdom: string; phylum: string; class: string; order: string; family: string; genus: string;
};

type GbifMatch = {
  usageKey: number;
  canonicalName?: string;
  scientificName?: string;
  confidence?: number;
  matchType?: string;
  rank?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
};

type CatalogRow = {
  scientific_name: string;
  vernacular_name: string | null;
  vernacular_name_en: string | null;
  kingdom?: string | null;
  phylum?: string | null;
  class?: string | null;
  order?: string | null;
  family?: string | null;
  genus?: string | null;
  rarity?: string | null;
  vernaculars?: Record<string, string> | null;
};

/**
 * CE QUE BIOCLIP NE PEUT PAS DIRE.
 *
 * MESURÉ DANS SON PROPRE DICTIONNAIRE (2026-08-24,
 * `services/animal-id/probe_labels.py`, 794 878 étiquettes) :
 *
 *     Canis familiaris   ABSENT      ← le genre Canis n'a que 12 espèces,
 *                                      et la seule option pour un chien est
 *                                      `Canis lupus / Gray wolf`
 *     Sus domesticus     ABSENT
 *     Felis catus        'Domestic cat'
 *     Bos taurus         'Domesticated cattle'
 *     Ovis aries         'Domestic Sheep'
 *     Capra hircus       'Domestic goat'
 *     Equus caballus     'Horse'      · Equus asinus 'Ass'
 *     Lama glama         'Llama'      · Cavia porcellus 'Guinea pig'
 *     Gallus gallus      'Red junglefowl' · Bubalus bubalis 'Water buffalo'
 *
 * Le chien est le SEUL domestique que BioCLIP ne sait pas nommer. Ce n'est pas
 * une faiblesse du modèle : l'étiquette n'existe pas. Aucun rang, aucun prompt,
 * aucun seuil n'y change quoi que ce soit — il faut un autre avis.
 *
 * POURQUOI CETTE TABLE NE CONTIENT QU'UNE ESPÈCE
 *
 * Elle en a compté douze, et onze étaient nuisibles. Arbitrer un chat ne
 * corrige rien — BioCLIP dit déjà `Felis catus` — mais expose au bruit : sur
 * une photo de VRAI loup, la meilleure étiquette domestique d'Apple était
 * `cat` à 0,0359. Une entrée n'est légitime que si BioCLIP est INCAPABLE de
 * nommer l'espèce lui-même.
 *
 * Le cochon reste dehors faute de destination : `Sus domesticus` manque aussi
 * à `species_catalog`. Le jour où il y entre, une ligne suffit ici.
 *
 * Les identifiants viennent du vocabulaire réel d'iOS (1 303 étiquettes), lu et
 * non deviné. La comparaison est EXACTE : `hotdog` et `prairie_dog` contiennent
 * « dog » sans être l'animal.
 */
const ESPECE_DOMESTIQUE_PAR_ETIQUETTE: Record<string, { espece: string; famille: string }> = {
  bulldog: { espece: 'Canis familiaris', famille: 'Canidae' },
  corgi: { espece: 'Canis familiaris', famille: 'Canidae' },
  dog: { espece: 'Canis familiaris', famille: 'Canidae' },
  husky: { espece: 'Canis familiaris', famille: 'Canidae' },
  malamute: { espece: 'Canis familiaris', famille: 'Canidae' },
  sheepdog: { espece: 'Canis familiaris', famille: 'Canidae' },
};

/**
 * Le témoin sauvage : l'étiquette que le MÊME classifieur aurait choisie si
 * l'animal était sauvage. Apple l'a dans son vocabulaire, donc `dog` qui la
 * devance est un choix, pas une absence d'option.
 *
 * `fox` EN A ÉTÉ RETIRÉ, et c'est une mesure qui l'a exigé. Sur les quatre
 * chiens réels, `dog` ne devance `fox` que d'un facteur 4,99 à 5,48 — un shiba
 * RESSEMBLE à un renard, c'est même sa réputation. Garder `fox` comme témoin
 * faisait échouer deux chiens sur quatre. Contre `coyote_wolf`, le seul témoin
 * qui parle de loup, l'écart mesuré est de 23 à 52.
 */
const TEMOINS_SAUVAGES = ['coyote_wolf'];

/**
 * Rend l'espèce qu'Apple désigne, ou rien.
 *
 * POURQUOI UNE COMPARAISON ET PAS UN SEUIL
 *
 * Sur un sujet détouré, le fond transparent écrase toutes les confiances : un
 * chien parfaitement reconnaissable plafonne à 0,16, et `hasMinimumPrecision`
 * ne passe jamais. Un seuil absolu serait donc soit inopérant, soit inventé.
 * Le rapport entre étiquettes du même classifieur, lui, reste lisible.
 *
 * LE GARDE-FOU DE FAMILLE, ET CE QU'IL A ATTRAPÉ
 *
 * Sur une photo de VRAI loup, la meilleure étiquette domestique d'Apple était
 * `cat` à 0,0359 — du bruit, mais du bruit qui aurait suffi à renommer le loup
 * en chat. Apple peut corriger l'espèce À L'INTÉRIEUR d'une famille, jamais la
 * famille : BioCLIP est bon en taxonomie, Apple est bon pour distinguer le
 * domestique du sauvage. Chacun tranche ce qu'il sait.
 *
 * Silencieux dès qu'Apple ne dit rien de cette liste — l'immense majorité des
 * captures.
 */
function arbitrageVision(
  labels: unknown, familleBioclip: string | undefined, nomResolu: string | undefined,
): { espece: string; famille: string } | undefined {
  if (!Array.isArray(labels) || !familleBioclip) return undefined;
  const scores = new Map<string, number>();
  for (const brut of labels) {
    if (!brut || typeof brut !== 'object') continue;
    const { identifier, confidence } = brut as { confidence?: unknown; identifier?: unknown };
    if (typeof identifier === 'string' && typeof confidence === 'number') scores.set(identifier, confidence);
  }
  if (!scores.size) return undefined;

  let meilleur: { espece: string; note: number } | undefined;
  for (const [etiquette, note] of scores) {
    const cible = ESPECE_DOMESTIQUE_PAR_ETIQUETTE[etiquette];
    if (cible && (!meilleur || note > meilleur.note)) meilleur = { espece: cible.espece, note };
  }
  if (!meilleur) return undefined;

  // Le témoin doit être NETTEMENT derrière. Pire cas mesuré sur de vrais
  // chiens : 23. On demande 5 — largement sous ce plancher, pour qu'une photo
  // difficile ne soit pas exclue, et largement au-dessus de l'égalité qu'on
  // attendrait d'un vrai loup.
  const sauvage = Math.max(0, ...TEMOINS_SAUVAGES.map((l) => scores.get(l) ?? 0));
  if (meilleur.note <= sauvage * 5) return undefined;

  const famille = Object.values(ESPECE_DOMESTIQUE_PAR_ETIQUETTE)
    .find((v) => v.espece === meilleur.espece)?.famille;
  if (!famille || famille !== familleBioclip) return undefined;
  if (meilleur.espece === nomResolu) return undefined;
  return { espece: meilleur.espece, famille };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

function isPrediction(value: unknown): value is Prediction {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.scientificName === 'string' && typeof item.commonName === 'string'
    && typeof item.confidence === 'number' && Number.isFinite(item.confidence)
    && item.confidence >= 0 && item.confidence <= 1
    && ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'].every((key) => typeof item[key] === 'string');
}

function encounterRarity(count: unknown) {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) return undefined;
  if (count < 5) return 'legendary';
  if (count < 25) return 'rare';
  if (count < 100) return 'uncommon';
  return 'common';
}

async function gbifSpecies(scientificName: string) {
  try {
    const response = await fetch(
      `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return null;
    const match = await response.json() as GbifMatch;
    if (
      !match.usageKey
      || match.matchType === 'NONE'
      || !['SPECIES', 'SUBSPECIES'].includes(match.rank ?? '')
      || (match.confidence ?? 0) < 90
    ) return null;

    // `limit=200` et non 100 : une espèce connue en a plus de cent, et les
    // langues sont rendues dans l'ordre des sources, pas par importance — un
    // plafond trop bas coupe silencieusement l'arabe ou le japonais.
    const namesResponse = await fetch(
      `https://api.gbif.org/v1/species/${match.usageKey}/vernacularNames?limit=200`,
      { signal: AbortSignal.timeout(8_000) },
    ).catch(() => null);
    const names = namesResponse?.ok
      ? ((await namesResponse.json() as { results?: { language?: string; vernacularName?: string }[] }).results ?? [])
      : [];

    // Le nom que le PLUS de sources répètent, pas le premier rendu : GBIF les
    // classe par autorité taxonomique, ce qui remonte le nom savant. Le premier
    // français de la perruche ondulée est « Mélopsitte ondulé ».
    const vernaculars = vernacularsByConsensus(names, LANGUAGE_CODES);

    // Le compteur MONDIAL de l'espèce — celui qui décide de sa rareté.
    //
    // Sans lui, une espèce hors catalogue était notée par son abondance
    // LOCALE, ce que la conception interdit explicitement : le même animal
    // inconnu aurait été rare pour un joueur et commun pour un autre, selon
    // l'endroit où il se trouvait. Une requête de plus sur un chemin qui
    // interroge déjà GBIF, et la règle mondiale s'applique à n'importe quelle
    // espèce décrite, pas seulement aux 5 799 du catalogue.
    const countResponse = await fetch(
      `https://api.gbif.org/v1/occurrence/search?limit=0&taxonKey=${match.usageKey}`,
      { signal: AbortSignal.timeout(8_000) },
    ).catch(() => null);
    const counted = countResponse?.ok
      ? (await countResponse.json() as { count?: number }).count
      : undefined;

    return {
      match,
      vernaculars,
      commonName: vernaculars.en,
      commonNameLocale: vernaculars.fr,
      // `undefined` et non zéro : une requête ratée ne vaut pas « jamais
      // observé », qui donnerait une carte légendaire à un moineau.
      worldOccurrences: typeof counted === 'number' ? counted : undefined,
    };
  } catch {
    return null;
  }
}


async function recordWildDiscovery(
  admin: ReturnType<typeof createClient>,
  capture: Record<string, unknown>,
  prediction: Prediction,
) {
  const gbif = await gbifSpecies(prediction.scientificName);
  const scientificName = gbif?.match.canonicalName ?? prediction.scientificName;
  const taxonomy = {
    kingdom: gbif?.match.kingdom ?? prediction.kingdom,
    phylum: gbif?.match.phylum ?? prediction.phylum,
    class: gbif?.match.class ?? prediction.class,
    order: gbif?.match.order ?? prediction.order,
    family: gbif?.match.family ?? prediction.family,
    genus: gbif?.match.genus ?? prediction.genus,
  };
  const { error: speciesError } = await admin.from('world_species').upsert({
    scientific_name: scientificName,
    gbif_key: gbif?.match.usageKey ?? null,
    canonical_name: scientificName,
    common_name: gbif?.commonName ?? prediction.commonName ?? scientificName,
    common_name_locale: gbif?.commonNameLocale ?? null,
    taxonomy,
    taxonomy_validated: Boolean(gbif),
    last_seen_at: capture.captured_at,
  }, { onConflict: 'scientific_name' });
  if (speciesError) throw speciesError;

  const latitude = typeof capture.latitude === 'number' ? capture.latitude : null;
  const longitude = typeof capture.longitude === 'number' ? capture.longitude : null;
  const { error: observationError } = await admin.from('world_species_observations').upsert({
    scientific_name: scientificName,
    capture_id: capture.id,
    observer_id: capture.user_id,
    confidence: prediction.confidence,
    // Universal coarse buckets are safer than trying to maintain a perfect
    // list of sensitive taxa. Exact coordinates never enter community data.
    latitude_bucket: latitude === null ? null : Math.round(latitude * 10) / 10,
    longitude_bucket: longitude === null ? null : Math.round(longitude * 10) / 10,
    observed_at: capture.captured_at,
  }, { onConflict: 'capture_id' });
  if (observationError) throw observationError;
}

Deno.serve(async (request) => {
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

  const body = await request.json().catch(() => ({})) as {
    captureId?: string;
    registerConfirmed?: boolean;
    warmup?: boolean;
  };
  if (body.warmup) {
    const serviceUrl = Deno.env.get('ANIMAL_ID_API_URL');
    const serviceToken = Deno.env.get('ANIMAL_ID_API_TOKEN');
    if (!serviceUrl || !serviceToken) return json({ error: 'Identification service is not configured' }, 503);
    await fetch(serviceUrl, {
      method: 'POST', headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ warmup: true }), signal: AbortSignal.timeout(120_000),
    }).catch(() => null);
    return json(null);
  }
  if (!body.captureId) return json({ error: 'Missing captureId' }, 400);

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: capture, error: captureError } = await userDb.from('animal_captures').select('*').eq('id', body.captureId).maybeSingle();
  if (captureError || !capture) return json({ error: 'Capture not found' }, 404);

  if (body.registerConfirmed) {
    if (capture.status !== 'ready' || capture.in_atlas !== false || !capture.scientific_name) return json(null);
    const prediction: Prediction = {
      scientificName: capture.scientific_name,
      commonName: capture.common_name ?? capture.scientific_name,
      confidence: capture.confidence ?? 0,
      kingdom: capture.taxonomy?.kingdom ?? '',
      phylum: capture.taxonomy?.phylum ?? '',
      class: capture.taxonomy?.class ?? '',
      order: capture.taxonomy?.order ?? '',
      family: capture.taxonomy?.family ?? '',
      genus: capture.taxonomy?.genus ?? '',
    };
    await recordWildDiscovery(admin, capture, prediction);
    // Le RPC de confirmation pose la rareté du catalogue, mais une espèce hors
    // atlas n'y a pas de ligne : sa carte sortirait confirmée et sans foil.
    // C'est ici qu'on la note — même échelle mondiale que le chemin nominal.
    if (capture.rarity == null) {
      const gbif = await gbifSpecies(capture.scientific_name);
      const localRarity = encounterRarity(capture.local_occurrence_count);
      const rarity = rarityFromOccurrences(gbif?.worldOccurrences) ?? localRarity;
      if (rarity) {
        await admin.from('animal_captures')
          .update({ rarity, local_encounter_rarity: localRarity ?? null })
          .eq('id', capture.id).eq('user_id', capture.user_id);
      }
    }
    return json(null);
  }

  // UNE CAPTURE NE S'IDENTIFIE QU'UNE FOIS.
  //
  // Rien n'empêchait de rappeler cette fonction sur une capture déjà résolue :
  // même `captureId`, même image, une inférence Modal de plus à chaque appel.
  // C'était le chemin le moins cher pour faire exploser la facture sans même
  // avoir à prendre une photo.
  //
  // `failed` reste ouvert — c'est par là que la file hors-ligne retente, et une
  // panne réseau n'a pas à condamner une capture. `processing` est le cas
  // nominal, celui du premier appel.
  if (capture.status === 'ready' || capture.status === 'needs_review') {
    return json({ status: capture.status });
  }

  // LES RETENTATIVES SONT COMPTÉES. `failed` reste réinvocable — la file
  // hors-ligne en dépend — mais plus sans fin : six départs pour la même
  // capture, ce n'est plus une panne réseau, c'est une image que le service ne
  // saura jamais lire, ou une boucle qui paie une inférence Modal par tour.
  // Le compteur s'incrémente AVANT l'appel, sous `admin` : un client qui
  // annule la requête à mi-course a quand même consommé son essai.
  const attempts = (capture.identify_attempts as number | null) ?? 0;
  if (attempts >= 6) {
    await admin.from('animal_captures')
      .update({ status: 'failed', identification_issue: 'service_unavailable' })
      .eq('id', capture.id).eq('user_id', capture.user_id);
    return json({ error: 'Too many identification attempts' }, 429);
  }
  await admin.from('animal_captures')
    .update({ identify_attempts: attempts + 1 })
    .eq('id', capture.id).eq('user_id', capture.user_id);

  const serviceUrl = Deno.env.get('ANIMAL_ID_API_URL');
  const serviceToken = Deno.env.get('ANIMAL_ID_API_TOKEN');
  if (!serviceUrl || !serviceToken) return json({ error: 'Identification service is not configured' }, 503);

  // IDENTIFICATION PRO — le recours, pas la première réponse.
  //
  // Toute capture est identifiée par le même modèle pour tout le monde : la
  // justesse n'est pas un palier payant, sinon un joueur gratuit ne reçoit pas
  // « moins », il reçoit une carte FAUSSE, et le Registre — dont toute la
  // valeur tient à ce que la course soit la même — devient pay-to-win.
  //
  // Ce que l'abonnement achète, c'est de RELANCER une identification douteuse
  // sur le gros modèle. L'écart est du confort : le joueur gratuit atteint la
  // même réponse en corrigeant depuis les candidats.
  //
  // L'abonnement est lu EN BASE, jamais dans le corps de la requête : un
  // client qui pourrait s'accorder le modèle cher le ferait.
  // UN SEUL MODÈLE POUR TOUT LE MONDE
  //
  // Toute capture passe par BioCLIP 2.5. Il n'y a plus de « second avis »
  // payant : le recours qui vivait ici relançait sur un modèle plus lourd, et
  // depuis que ce modèle EST celui de base, relancer rendrait la même réponse.
  //
  // C'était de toute façon une promesse morte — il pointait déjà sur 2.5 avec
  // une version de pybioclip qui refuse ce modèle, et aurait planté à la
  // première utilisation. Personne ne s'en est aperçu : il fallait cumuler une
  // capture douteuse ET un abonnement pour l'atteindre.
  //
  // La justesse de l'identification n'est pas un palier payant et ne doit pas
  // le redevenir : un joueur gratuit qui reçoit une carte FAUSSE n'a pas
  // « moins », il a faux — et le Registre, dont toute la valeur tient à ce que
  // la course soit la même pour tous, deviendrait pay-to-win.
  const tier = 'base';

  let issue = 'service_unavailable';
  try {
    const { data: signed, error: signedError } = await admin.storage.from('capture-originals').createSignedUrl(capture.original_path, 300);
    if (signedError || !signed) { issue = 'invalid_image'; throw signedError ?? new Error('Image missing'); }

    const response = await fetch(serviceUrl, {
      method: 'POST', headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ imageUrl: signed.signedUrl, latitude: capture.latitude, longitude: capture.longitude, capturedAt: new Date(capture.captured_at).getTime(), tier }),
      // Un délai est un PLAFOND, pas une attente : une réponse en une seconde
      // revient en une seconde. Il couvre le pire cas — le premier appel d'un
      // conteneur neuf, qui paie le chargement des poids (92 s mesuré sur
      // BioCLIP 2.5). Trop court, la capture ressortirait en
      // `service_unavailable` : on accuserait le modèle d'un défaut qui n'est
      // qu'un chargement.
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { detail?: { code?: string } } | null;
      issue = error?.detail?.code ?? issue;
      throw new Error(`Animal ID failed (${response.status})`);
    }

    const result = await response.json() as { predictions?: unknown; localOccurrenceCount?: unknown };
    if (!Array.isArray(result.predictions)) throw new Error('Invalid Animal ID response');
    const predictions = result.predictions.filter(isPrediction).slice(0, 5);
    if (!predictions.length) { issue = 'no_animal_detected'; throw new Error('No animal detected'); }

    // BioCLIP est un classifieur FERMÉ : il renvoie toujours l'espèce la plus
    // proche, même devant un sac à dos. Quand rien n'est reconnu, le softmax
    // s'éparpille sur ~500k espèces et même le top 5 entier ne pèse presque
    // rien. Mesuré sur les captures réelles : sac à dos = 0.044 de masse
    // cumulée (tique + merle + cafard + vautour — quatre classes différentes),
    // pire vrai animal accepté = 0.37. Sous 10 %, ce n'est pas un animal.
    const topMass = predictions.reduce((sum, p) => sum + p.confidence, 0);
    if (topMass < 0.1) { issue = 'no_animal_detected'; throw new Error('Nothing recognizable in frame'); }

    // Second verrou, appris d'un tube de dentifrice : classé « Luciola
    // kervillei » à 11 % — la masse passait (0.31, tous les candidats étaient
    // des lucioles : l'objet RESSEMBLAIT à une luciole) mais le meilleur score
    // restait dérisoire. Or une espèce obscure = peu d'observations GBIF =
    // carte légendaire : plus la photo était mauvaise, plus elle brillait.
    // Repère mesuré : pire vrai animal accepté = 0.37 de top-1. Sous 0.2, ce
    // n'est pas une identification, c'est un tirage au sort — on refuse
    // franchement (« reprends la photo ») plutôt que de frapper une carte
    // fausse. Jamais de carte au rabais : elle serait un mensonge doré.
    const top1 = Math.max(...predictions.map((p) => p.confidence));
    if (top1 < 0.2) { issue = 'no_animal_detected'; throw new Error('Nothing recognizable in frame'); }

    // DEUX CLÉS D'ENTRÉE DANS LE CATALOGUE, PAS UNE.
    //
    // Le nom scientifique seul ne suffit pas, et deux mesures du 2026-08-23 le
    // montrent :
    //
    //   Canis lupus (Domestic Dog)  → le catalogue nomme `Canis lupus`
    //                                 « Loup gris ». Un chien devenait un loup.
    //   Uncia uncia (Snow leopard)  → absent du catalogue, qui connaît
    //                                 `Panthera uncia`. La panthère des neiges
    //                                 perdait nom français, rareté et planche.
    //
    // Le premier est un TAXON COLLAPSÉ : TreeOfLife range le chien domestique
    // sous `Canis lupus` et ne le distingue que par son nom commun. Le second
    // est un SYNONYME. Les deux se règlent d'un coup en interrogeant aussi le
    // nom vernaculaire anglais — sans aucune espèce codée en dur.
    const names = predictions.map((prediction) => prediction.scientificName);
    const communs = predictions.map((p) => p.commonName?.trim()).filter(Boolean) as string[];
    const [{ data: catalog, error: catalogError }, { data: parCommun }] = await Promise.all([
      admin.from('species_catalog').select('*').in('scientific_name', names),
      communs.length
        ? admin.from('species_catalog').select('*').in('vernacular_name_en', communs)
        : Promise.resolve({ data: [] as CatalogRow[] }),
    ]);
    if (catalogError) throw catalogError;
    const byName = new Map((catalog ?? []).map((entry) => [entry.scientific_name, entry]));

    // UNIQUEMENT SI LE NOM ANGLAIS EST SANS AMBIGUÏTÉ.
    //
    // Mesuré : 48 noms anglais sur 5 282 désignent plusieurs espèces. La
    // plupart sont des synonymes du même animal (`Bison bison` / `Bos bison`),
    // mais pas tous — « silver-spotted skipper » couvre deux papillons
    // différents. Devant une ambiguïté on ne tranche pas : on laisse le nom
    // scientifique décider, comme avant.
    const ambigus = new Set<string>();
    const parVernaculaire = new Map<string, CatalogRow>();
    for (const ligne of (parCommun ?? []) as CatalogRow[]) {
      const clef = ligne.vernacular_name_en?.trim().toLowerCase();
      if (!clef) continue;
      const deja = parVernaculaire.get(clef);
      if (deja && deja.scientific_name !== ligne.scientific_name) ambigus.add(clef);
      parVernaculaire.set(clef, ligne);
    }

    /**
     * Le nom commun est l'étiquette que BioCLIP a RÉELLEMENT appariée ; le nom
     * scientifique n'en est que le parent, parfois périmé. Quand les deux
     * désignent des espèces différentes du catalogue, le nom commun gagne.
     */
    const resoudre = (p: Prediction): CatalogRow | undefined => {
      const clef = p.commonName?.trim().toLowerCase();
      if (clef && !ambigus.has(clef)) {
        const parNom = parVernaculaire.get(clef);
        if (parNom) return parNom;
      }
      return byName.get(p.scientificName);
    };

    // Catalogue membership is never identification evidence. BioCLIP's score
    // stays authoritative; otherwise an atlas candidate could displace the
    // actual animal simply because it belongs to the curated 884.
    predictions.sort((a, b) => b.confidence - a.confidence);
    let best = predictions[0];
    let entry = resoudre(best);

    // LE SECOND AVIS D'APPLE, QUAND IL PORTE SUR CE QU'IL SAIT.
    //
    // Aucune relecture de noms ne rattrape la capture du 23 août : BioCLIP a
    // répondu « Gray Wolf » à 1,000, sans le moindre candidat chien. Il fallait
    // un avis indépendant, et il existait déjà — inutilisé.
    const arbitre = arbitrageVision(capture.vision_labels, best.family, entry?.scientific_name);
    if (arbitre) {
      const ligne = (await admin.from('species_catalog').select('*').eq('scientific_name', arbitre.espece).maybeSingle()).data;
      if (ligne) {
        entry = ligne as CatalogRow;
        // LA TAXONOMIE SUIT L'ESPÈCE, elle ne reste pas celle du loup. Sur
        // chien/loup le genre est le même, donc l'écart ne se verrait pas ;
        // sur `Lama glama` il se verrait, et la fiche mentirait sur la famille.
        best = {
          ...best,
          class: ligne.class ?? best.class,
          commonName: ligne.vernacular_name_en ?? best.commonName,
          family: ligne.family ?? best.family,
          genus: ligne.genus ?? best.genus,
          kingdom: ligne.kingdom ?? best.kingdom,
          order: ligne.order ?? best.order,
          phylum: ligne.phylum ?? best.phylum,
          scientificName: ligne.scientific_name,
        };
      }
    }
    // Le drapeau ne déclenche plus aucune question à l'écran : la correction
    // est repliée sur la fiche, ouverte à la demande. Il reste utile ici — plus
    // bas, c'est lui qui empêche une identification incertaine d'être
    // enregistrée comme une découverte sauvage.
    const needsReview = best.confidence < 0.45 || best.confidence - (predictions[1]?.confidence ?? 0) < 0.12;
    const localRarity = encounterRarity(result.localOccurrenceCount);

    // Les candidats passent par la MÊME résolution que le retenu. Sinon la
    // fiche de correction proposerait « Loup gris » en second choix d'un chien
    // — le défaut corrigé plus haut, réapparu là où l'utilisateur va lire.
    const candidates = predictions.map((prediction) => {
      const ligne = resoudre(prediction);
      return {
        ...prediction,
        commonName: ligne?.vernacular_name_en ?? prediction.commonName ?? prediction.scientificName,
        commonNameLocale: ligne?.vernacular_name ?? undefined,
        scientificName: ligne?.scientific_name ?? prediction.scientificName,
      };
    });
    // Les noms dans toutes les langues retenues, une seule fois, à
    // l'identification. Le catalogue prime — ses noms sont relus à la main —
    // mais il ne dispense de GBIF QUE s'il porte vraiment le nom.
    //
    // La condition était `entry ? null : …`, la simple présence au catalogue,
    // sur la foi que « les 5 576 espèces ont toutes leurs vernaculaires ».
    // Fausse : 945 lignes n'ont aucun nom français. Elles étaient donc les
    // SEULES espèces au monde à finir en latin sur la carte — une espèce
    // absente du catalogue, elle, était traduite par GBIF. L'inverse de ce
    // qu'on veut, et invisible tant qu'on ne compte pas les trous.
    //
    // Le garde-fou d'origine tient toujours : l'appel reste évité pour les
    // 4 631 lignes complètes, ce qui suffit à ne pas faire étrangler GBIF.
    // `scripts/backfill-vernaculars.ts` ferme les 945 restantes, après quoi
    // cette branche ne s'ouvre plus que pour les espèces hors catalogue.
    const gbif = entry?.vernacular_name && entry?.vernacular_name_en
      ? null
      : await gbifSpecies(best.scientificName);
    const vernaculars = {
      ...(gbif?.vernaculars ?? {}),
      ...(entry?.vernaculars ?? {}),
      ...(entry?.vernacular_name_en ? { en: entry.vernacular_name_en } : {}),
      ...(entry?.vernacular_name ? { fr: entry.vernacular_name } : {}),
    };

    const { error: updateError } = await admin.from('animal_captures').update({
      status: needsReview ? 'needs_review' : 'ready', scientific_name: best.scientificName,
      // Lus dans `vernaculars`, PAS dans `entry` : la fusion ci-dessus a déjà
      // fait primer le catalogue sur GBIF. Lire `entry` directement rejetait
      // le nom GBIF même quand le catalogue n'en avait aucun.
      common_name: vernaculars.en ?? best.commonName ?? best.scientificName,
      common_name_locale: vernaculars.fr ?? null, vernaculars,
      in_atlas: Boolean(entry), confidence: best.confidence,
      identification_issue: best.confidence < 0.45 ? 'low_confidence' : null,
      taxonomy: { kingdom: best.kingdom, phylum: best.phylum, class: best.class, order: best.order, family: best.family, genus: best.genus },
      candidates,
      // L'ordre compte. Le catalogue d'abord : sa rareté est figée et relue.
      // Puis la règle mondiale, qui vaut pour toute espèce décrite. La rareté
      // locale n'arrive qu'en dernier recours, quand GBIF n'a rien rendu —
      // elle ne devrait jamais noter une carte, mais une carte sans rareté du
      // tout n'a même pas de foil.
      //
      // Toujours frappée, même quand la confiance est basse : le joueur
      // photographie précisément parce qu'il ne connaît pas le nom — il ne
      // peut pas être l'arbitre d'une carte « à confirmer ». Ce qui protège le
      // foil des photos sans animal, c'est le REFUS en amont (plancher de
      // confiance ci-dessus), jamais une carte au rabais.
      rarity: entry?.rarity ?? rarityFromOccurrences(gbif?.worldOccurrences) ?? localRarity,
      local_encounter_rarity: localRarity,
      local_occurrence_count: typeof result.localOccurrenceCount === 'number' ? result.localOccurrenceCount : null,
      rarity_source: typeof result.localOccurrenceCount === 'number' ? 'gbif' : null,
    }).eq('id', capture.id).eq('user_id', capture.user_id);
    if (updateError) throw updateError;
    if (!entry && !needsReview) await recordWildDiscovery(admin, capture, best);
    // LA CARTE QUI ARRIVE, QUAND PERSONNE NE REGARDE.
    //
    // L'identification prend quelques secondes. Le joueur qui verrouille son
    // téléphone entre-temps — ou qui bascule d'app — ne voit jamais la
    // révélation : il retrouve une carte déjà posée dans sa collection, sans
    // le moment qui lui donnait sa valeur.
    //
    // Ce push RESTITUE ce moment. Il ne relance pas, il ne demande rien : il
    // annonce un fait que l'app était en train de produire pour lui. C'est
    // ce qui le rend transactionnel et non promotionnel, et pourquoi il n'a
    // pas à passer par la boucle de silence — on ne se lasse pas d'apprendre
    // qu'une carte est prête.
    // LA PREMIÈRE MONDIALE.
    //
    // Une espèce que PERSONNE n'avait encore photographiée dans SafaRoll. Ce
    // n'est pas un palier inventé — c'est un fait, daté, qui n'arrivera qu'une
    // fois pour cette espèce et qui appartient à celui qui l'a trouvée.
    //
    // La rareté d'un message fait sa valeur : celui-ci ne peut pas se répéter,
    // donc il ne peut pas lasser. C'est l'exact opposé d'une relance.
    const premiere = await estPremiereMondiale(admin, best.scientificName, capture.id);
    await pousserCartePrete(admin, capture, best, entry, needsReview, premiere);
    // Si une chasse de l'aube tourne sur l'écran verrouillé, elle apprend la
    // capture — sans que le joueur ait ouvert l'app.
    await majChasseAube(admin, capture.user_id);
    return json({ status: needsReview ? 'needs_review' : 'ready' });
  } catch (error) {
    console.error('identify-animal', error);
    await admin.from('animal_captures').update({ status: 'failed', identification_issue: issue }).eq('id', capture.id).eq('user_id', capture.user_id);
    return json({ error: 'Identification failed', issue }, 502);
  }
});

/**
 * Annonce la carte à son propriétaire, par OneSignal.
 *
 * SILENCIEUX PAR CONSTRUCTION. Une notification manquée est un regret ; une
 * identification qui échoue parce que la notification a échoué serait une
 * perte de données. Rien de ce qui suit ne peut faire tomber l'appel.
 *
 * L'IMAGE EST CELLE DE L'ESPÈCE, pas la photo du joueur : la carte n'existe
 * pas encore comme image, elle se compose au rendu. La planche dit « voilà où
 * ton animal va se poser ».
 */
async function estPremiereMondiale(
  admin: ReturnType<typeof createClient>,
  scientificName: string,
  captureId: string,
): Promise<boolean> {
  // On EXCLUT la capture qui vient d'être écrite : sans ça, toute capture
  // serait sa propre prédécesseure et rien ne serait jamais une première.
  const { count, error } = await admin
    .from('animal_captures')
    .select('id', { count: 'exact', head: true })
    .eq('scientific_name', scientificName)
    .neq('id', captureId)
    .in('status', ['ready', 'needs_review']);
  // Dans le doute, on se tait : annoncer une fausse première mondiale
  // dévaluerait toutes les vraies.
  if (error) return false;
  return (count ?? 1) === 0;
}

async function pousserCartePrete(
  admin: ReturnType<typeof createClient>,
  capture: { user_id: string; original_path: string },
  best: { scientificName: string; commonName?: string | null },
  entry: { vernacular_name?: string | null; vernacular_name_en?: string | null } | null | undefined,
  needsReview: boolean,
  premiere = false,
): Promise<void> {
  const appId = Deno.env.get('ONESIGNAL_APP_ID');
  const apiKey = Deno.env.get('ONESIGNAL_API_KEY');
  if (!appId || !apiKey) return;

  const nomEn = entry?.vernacular_name_en ?? best.commonName ?? best.scientificName;
  const nomFr = entry?.vernacular_name ?? nomEn;

  // L'image est LA photo du joueur. Pas l'illustration de l'espèce (un fond
  // sans animal), pas le sticker : il est en WebP, et iOS n'accepte en pièce
  // jointe que JPEG, PNG et GIF — il s'afficherait vide.
  const { data: signe } = await admin.storage.from('capture-originals').createSignedUrl(capture.original_path, 86_400);
  const image = signe?.signedUrl;

  await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: { Authorization: `Key ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      app_id: appId,
      name: 'Carte prete',
      target_channel: 'push',
      include_aliases: { external_id: [capture.user_id] },
      // Le nom de l'espèce en titre, l'événement en corps. L'inverse obligeait
      // à écrire « photographié » — dont l'accord dépend du genre de l'espèce,
      // que la base ne connaît pas. « Trouvé cette espèce » place l'objet APRÈS
      // le participe : aucun accord, aucune faute possible.
      headings: { fr: nomFr, en: nomEn },
      contents: {
        fr: premiere
          ? 'Première mondiale — aucun joueur n’avait encore trouvé cette espèce.'
          : needsReview
            ? 'Ta carte est prête, à confirmer.'
            : 'Ta carte est prête.',
        en: premiere
          ? 'World first — no player had found this species yet.'
          : needsReview
            ? 'Your card is ready, to confirm.'
            : 'Your card is ready.',
      },
      ...(image ? { ios_attachments: { capture: image }, big_picture: image } : {}),
      // `kind: transactional` — la boucle de silence ne doit JAMAIS le couper :
      // il ne demande rien, il annonce ce que le joueur vient de déclencher.
      data: { kind: 'transactional', first: premiere, url: '/(app)/(tabs)/(home)' },
      // Le joueur regarde peut-être son écran : la notification ne doit pas
      // doubler la révélation qu'il est en train de voir.
      // Une première mondiale mérite de traverser un mode concentration ; une
      // carte ordinaire, non. C'est la seule notification de l'app qui monte
      // d'un cran, et elle ne peut arriver qu'une fois par espèce.
      // Valeurs OneSignal : `time_sensitive` avec un TIRET BAS. `time-sensitive`
      // rend un 400 et la première mondiale ne partait jamais.
      ios_interruption_level: premiere ? 'time_sensitive' : 'active',
    }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);
}

async function majChasseAube(admin: ReturnType<typeof createClient>, userId: string): Promise<void> {
  const appId = Deno.env.get('ONESIGNAL_APP_ID');
  const apiKey = Deno.env.get('ONESIGNAL_API_KEY');
  if (!appId || !apiKey) return;
  // A notification failure must never turn a saved capture into a failed one.
  await updateChorusActivity(admin, appId, apiKey, userId)
    .catch(error => console.warn('[chorus] Update failed:', String(error)));
}
