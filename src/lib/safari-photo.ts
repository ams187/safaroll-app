export type SafariPhoto = { uri: string; source: string; author: string; license: string };

/** Check the image's own licence, never inherit the occurrence's licence. */
export function selectSafariPhoto(payload: unknown, name: string): SafariPhoto | null {
  const records = (payload as { results?: unknown[] })?.results;
  if (!Array.isArray(records)) return null;
  for (const value of records) {
    const row = value as { species?: string; media?: Record<string, unknown>[] };
    if (typeof row?.species !== 'string' || row.species.toLowerCase() !== name.trim().toLowerCase() || !Array.isArray(row.media)) continue;
    for (const media of row.media) {
      if (media?.type !== 'StillImage' || typeof media.license !== 'string' || typeof media.identifier !== 'string') continue;
      const license = media.license.replace(/^http:/, 'https:');
      if (!['https://creativecommons.org/licenses/by/4.0/', 'https://creativecommons.org/publicdomain/zero/1.0/'].includes(license)) continue;
      // These providers expose a bounded 500px rendition: never load multi-MB originals.
      if (!/^https:\/\/(?:inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)\/photos\/\d+\/original\.(?:jpg|jpeg|png)$/i.test(media.identifier)) continue;
      if (typeof media.references !== 'string' || !/^https:\/\/www\.inaturalist\.org\/photos\/\d+$/.test(media.references)) continue;
      const author = media.creator || media.rightsHolder;
      if (typeof author !== 'string' || !author.trim()) continue;
      return { uri: media.identifier.replace('/original.', '/medium.'), source: media.references, author, license };
    }
  }
  return null;
}

export async function fetchSafariPhoto(name: string, signal?: AbortSignal): Promise<SafariPhoto | null> {
  const query = new URLSearchParams({ scientificName: name, mediaType: 'StillImage', limit: '30' });
  query.append('license', 'CC_BY_4_0');
  query.append('license', 'CC0_1_0');
  const response = await fetch(`https://api.gbif.org/v1/occurrence/search?${query}`, { signal });
  if (!response.ok) throw new Error(`GBIF photos: ${response.status}`);
  return selectSafariPhoto(await response.json(), name);
}
