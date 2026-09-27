import { createClient } from '@supabase/supabase-js';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = process.argv[2];
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!root || !url || !key) throw new Error('Usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... bun scripts/migrate-convex-to-supabase.ts <export-dir>');

const db = createClient(url, key, { auth: { persistSession: false } });
const iso = (value?: number) => value === undefined ? undefined : new Date(value).toISOString();
const uuid = () => crypto.randomUUID();

async function rows(table: string): Promise<any[]> {
  const file = Bun.file(join(root, table, 'documents.jsonl'));
  if (!existsSync(file.name!)) return [];
  return (await file.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function insert(table: string, values: any[]) {
  if (!values.length) return;
  for (let index = 0; index < values.length; index += 200) {
    const { error } = await db.from(table).insert(values.slice(index, index + 200));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

const [existing] = await Promise.all([
  db.from('species_catalog').select('scientific_name', { count: 'exact', head: true }),
]);
if (existing.error) throw existing.error;
if (existing.count) throw new Error('Supabase is not empty; migration aborted to prevent duplicates');

const catalog = await rows('speciesCatalog');
await insert('species_catalog', catalog.map((row) => ({
  scientific_name: row.scientificName, gbif_key: row.gbifKey, canonical_name: row.canonicalName,
  vernacular_name: row.vernacularName, vernacular_name_en: row.vernacularNameEn,
  kingdom: row.kingdom, phylum: row.phylum, class: row.class, order: row.order,
  family: row.family, genus: row.genus, animal_group: row.group,
  occurrences: row.occurrences ?? {}, rarity: row.rarity, created_at: iso(row._creationTime),
})));

const seasons = await rows('speciesSeasons');
const catalogName = new Map(catalog.map((row) => [row.scientificName.toLowerCase().split(/\s+/).slice(0, 2).join(' '), row.scientificName]));
await insert('species_seasons', seasons.flatMap((row) => {
  const scientificName = catalogName.get(row.scientificName.toLowerCase().split(/\s+/).slice(0, 2).join(' '));
  return scientificName ? [{
  region: row.region, scientific_name: scientificName, monthly_counts: row.monthlyCounts,
  computed_at: iso(row.computedAt),
  }] : [];
}));

const expeditionIds = new Map<string, string>();
const expeditions = await rows('expeditions');
await insert('expeditions', expeditions.map((row) => {
  const id = uuid(); expeditionIds.set(row._id, id);
  return { id, user_id: row.userId, started_at: iso(row.startedAt), ended_at: iso(row.endedAt), created_at: iso(row._creationTime) };
}));

const storageDir = join(root, '_storage');
const storageFiles = readdirSync(storageDir).filter((name) => name !== 'documents.jsonl');
const captureIds = new Map<string, string>();
const captures = await rows('birdCaptures');

async function upload(storageId: string | undefined, bucket: string, userId: string) {
  if (!storageId) return undefined;
  const filename = storageFiles.find((name) => name.startsWith(storageId));
  if (!filename && bucket === 'items') return undefined;
  if (!filename) throw new Error(`Missing Convex storage file ${storageId}`);
  const path = `${userId}/${storageId}${extname(filename)}`;
  const source = Bun.file(join(storageDir, filename));
  const contentType = filename.endsWith('.webp') ? 'image/webp' : filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const { error } = await db.storage.from(bucket).upload(path, await source.arrayBuffer(), { contentType, upsert: true });
  if (error) throw new Error(`${bucket}/${path}: ${error.message}`);
  return path;
}

const migratedCaptures = [];
for (const row of captures) {
  const id = uuid(); captureIds.set(row._id, id);
  const [originalPath, stickerPath] = await Promise.all([
    upload(row.originalStorageId, 'capture-originals', row.userId),
    upload(row.stickerStorageId, 'capture-stickers', row.userId),
  ]);
  migratedCaptures.push({
    id, user_id: row.userId, status: row.status, original_path: originalPath, sticker_path: stickerPath,
    capture_source: row.captureSource ?? 'camera', aspect_ratio: row.aspectRatio, captured_at: iso(row.capturedAt),
    dominant_color: row.dominantColor, expedition_id: expeditionIds.get(row.expeditionId),
    latitude: row.latitude, longitude: row.longitude, scientific_name: row.scientificName,
    common_name: row.commonName, common_name_locale: row.commonNameLocale, in_atlas: row.inAtlas,
    confidence: row.confidence, identification_issue: row.identificationIssue, taxonomy: row.taxonomy,
    candidates: row.candidates, rarity: row.rarity, local_encounter_rarity: row.localEncounterRarity,
    local_occurrence_count: row.localOccurrenceCount, rarity_source: row.raritySource,
    created_at: iso(row._creationTime),
  });
}
await insert('animal_captures', migratedCaptures);

const deckIds = new Map<string, string>();
await insert('decks', (await rows('birdDecks')).map((row) => {
  const id = uuid(); deckIds.set(row._id, id);
  return { id, user_id: row.userId, author_name: row.authorName, name: row.name, description: row.description,
    is_public: row.isPublic, created_at: iso(row.createdAt ?? row._creationTime) };
}));
await insert('deck_cards', (await rows('birdDeckCards')).map((row) => ({
  id: uuid(), user_id: row.userId, deck_id: deckIds.get(row.deckId), capture_id: captureIds.get(row.captureId),
  position: row.position ?? 0, added_at: iso(row.addedAt ?? row._creationTime),
})));
await insert('deck_likes', (await rows('birdDeckLikes')).map((row) => ({
  user_id: row.userId, deck_id: deckIds.get(row.deckId), created_at: iso(row._creationTime),
})));

const itemIds = new Map<string, string>();
const migratedItems = [];
for (const row of await rows('items')) {
  const id = uuid(); itemIds.set(row._id, id);
  migratedItems.push({
    id, user_id: row.userId, type: row.type, status: row.status, title: row.title, description: row.description,
    url: row.url, storage_path: await upload(row.storageId, 'items', row.userId), aspect_ratio: row.aspectRatio,
    captured_at: iso(row.capturedAt), latitude: row.latitude, longitude: row.longitude, is_sticker: row.isSticker,
    tags: row.tags ?? [], content: row.content, site_name: row.siteName, hero_image_url: row.heroImageUrl,
    note: row.note, intents: row.intents, products: row.products, products_status: row.productsStatus,
    search_text: row.searchText ?? '', created_at: iso(row._creationTime),
  });
}
await insert('items', migratedItems);

const spaceIds = new Map<string, string>();
await insert('spaces', (await rows('spaces')).map((row) => {
  const id = uuid(); spaceIds.set(row._id, id);
  return { id, user_id: row.userId, name: row.name, description: row.description, dynamic: row.dynamic ?? false, created_at: iso(row._creationTime) };
}));
await insert('space_items', (await rows('spaceItems')).map((row) => ({
  id: uuid(), user_id: row.userId, space_id: spaceIds.get(row.spaceId), item_id: itemIds.get(row.itemId),
  status: row.status ?? 'saved', intents: row.intents, created_at: iso(row._creationTime),
})));
await insert('identification_reports', (await rows('identificationReports')).map((row) => ({
  id: uuid(), user_id: row.userId, capture_id: captureIds.get(row.captureId), predicted_name: row.predictedName,
  claimed_name: row.claimedName, note: row.note, created_at: iso(row.createdAt ?? row._creationTime),
})));

console.log(`Migrated ${catalog.length} species, ${captures.length} captures, ${storageFiles.length} stored files.`);
