// Note la rareté des captures qui n'en ont pas.
//
// D'OÙ VIENNENT CES LIGNES
//
// Des captures hors atlas identifiées AVANT que l'edge function ne note les
// espèces sauvages : la rareté du catalogue ne s'appliquait pas — elles n'y
// sont pas — et rien ne prenait le relais. Une carte sans rareté n'a même pas
// de foil : elle sort grise, et le joueur voit un bug.
//
// LA MÊME RÈGLE QUE LE SERVEUR, PAS UNE APPROXIMATION
//
// Le barème est importé de `_shared/species-rarity.ts`, celui qu'utilise
// `identify-animal`. Une seconde table de seuils écrite ici finirait par
// diverger, et deux joueurs verraient la même bête à deux raretés.
//
// UN COMPTEUR ABSENT NE VAUT PAS ZÉRO
//
// GBIF qui ne répond pas laisse la ligne intacte plutôt que de la noter
// légendaire — c'est exactement le piège que `rarityFromOccurrences` évite en
// rendant `undefined`, et le relancer plus tard ne coûte rien.
//
//   bun scripts/backfill-rarity.ts          liste ce qui serait fait
//   bun scripts/backfill-rarity.ts --write   écrit

import { rarityFromOccurrences } from '../supabase/functions/_shared/species-rarity.ts';

const ecrire = process.argv.includes('--write');

async function sql(query: string) {
  const proc = Bun.spawn(['bunx', 'supabase', 'db', 'query', '--linked', query], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const sortie = await new Response(proc.stdout).text();
  const debut = sortie.indexOf('{');
  if (debut < 0) throw new Error(sortie);
  return JSON.parse(sortie.slice(debut)).rows as Record<string, unknown>[];
}

async function occurrencesMondiales(nom: string): Promise<number | undefined> {
  const match = await fetch(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(nom)}`,
    { signal: AbortSignal.timeout(10_000) },
  ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!match?.usageKey || match.matchType === 'NONE') return undefined;
  const compte = await fetch(
    `https://api.gbif.org/v1/occurrence/search?limit=0&taxonKey=${match.usageKey}`,
    { signal: AbortSignal.timeout(10_000) },
  ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return typeof compte?.count === 'number' ? compte.count : undefined;
}

const lignes = await sql(`
  select distinct scientific_name
  from public.animal_captures
  where rarity is null
    and status in ('ready', 'needs_review')
    and scientific_name is not null
`);

console.log(`${lignes.length} espèce(s) sans rareté.\n`);

for (const ligne of lignes) {
  const nom = String(ligne.scientific_name);
  const compte = await occurrencesMondiales(nom);
  const rarete = rarityFromOccurrences(compte);
  if (!rarete) {
    console.log(`  ~ ${nom} — GBIF muet, laissée intacte`);
    continue;
  }
  console.log(`  ${ecrire ? '✓' : '·'} ${nom} — ${compte?.toLocaleString('fr-FR')} obs. → ${rarete}`);
  if (!ecrire) continue;
  await sql(
    `update public.animal_captures set rarity = '${rarete}' ` +
    `where rarity is null and scientific_name = '${nom.replace(/'/g, "''")}'`,
  );
}

if (!ecrire) console.log('\nRien écrit. Relance avec --write.');
