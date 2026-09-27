import type { SafariSite } from './safaris';
export type ZooMapSite = SafariSite & { latitude: number; longitude: number };
export function zooMapShape(sites: ZooMapSite[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: 'FeatureCollection', features: sites.filter(site =>
    Number.isFinite(site.latitude) && Number.isFinite(site.longitude) && Math.abs(site.latitude) <= 90 && Math.abs(site.longitude) <= 180
  ).map(site => ({ type: 'Feature', id: site.id, properties: { id: site.id, name: site.name },
    geometry: { type: 'Point', coordinates: [site.longitude, site.latitude] } })) };
}
export async function fetchZooMapSites() {
  const { safariRequest } = await import('./safaris');
  const sites: ZooMapSite[] = [];
  for (let offset = 0; offset <= 100000; offset += 500) {
    const page = await safariRequest<ZooMapSite[]>('map-sites', { offset });
    sites.push(...page);
    if (page.length < 500) return sites;
  }
  throw new Error('Zoo catalogue pagination limit reached');
}
