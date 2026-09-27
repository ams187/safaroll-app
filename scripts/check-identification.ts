// CE QUE BIOCLIP A VRAIMENT RÉPONDU.
//
// POURQUOI CE SCRIPT EXISTE
//
// Quand une identification paraît absurde — un chien beige rendu « loup gris »
// — il y a trois coupables possibles et ils ne se corrigent pas au même
// endroit : le modèle s'est trompé, nos seuils ont laissé passer un tirage au
// sort, ou le serveur a retenu autre chose que le meilleur candidat.
//
// La preuve est déjà en base : `identify-animal` écrit le TOP 5 COMPLET dans
// `animal_captures.candidates`, avec les scores. Ce script le relit, au lieu
// de raisonner sur ce que le modèle « devrait » faire.
//
// CE QU'IL FAUT REGARDER
//
//   · le retenu n'est PAS le meilleur score  → bug côté serveur, chez nous ;
//   · top-1 sous 0,45                        → `needs_review`, doute assumé ;
//   · les 5 candidats sont de la même famille → le modèle a vu le bon animal
//                                               mais n'a pas la bonne étiquette ;
//   · les 5 sont dispersés                   → il n'a rien reconnu du tout.
//
//   SUPABASE_SECRET_KEY=… bun scripts/check-identification.ts
//   SUPABASE_SECRET_KEY=… bun scripts/check-identification.ts --espece Canis
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  throw new Error('SUPABASE_SECRET_KEY manquante (Dashboard → Project Settings → API Keys → service_role).');
}
const db = createClient(url, secret, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const filtre = args[args.indexOf('--espece') + 1];
const combien = Number(args[args.indexOf('--n') + 1]) || 15;

type Candidat = { commonName?: string; confidence: number; scientificName: string };

let requete = db
  .from('animal_captures')
  .select('id, scientific_name, common_name_locale, confidence, in_atlas, status, identification_issue, candidates, captured_at')
  .not('candidates', 'is', null)
  .order('captured_at', { ascending: false })
  .limit(combien);
if (filtre && !filtre.startsWith('--')) requete = requete.ilike('scientific_name', `%${filtre}%`);

const { data, error } = await requete;
if (error) throw new Error(error.message);
if (!data?.length) { console.log('aucune capture avec candidats'); process.exit(0); }

for (const c of data) {
  const candidats = (c.candidates ?? []) as Candidat[];
  const meilleur = [...candidats].sort((a, b) => b.confidence - a.confidence)[0];
  // Le seul contrôle que ce script fait lui-même : le retenu est-il bien le
  // mieux noté ? Si non, le défaut est chez nous et nulle part ailleurs.
  const coherent = !meilleur || meilleur.scientificName === c.scientific_name;

  console.log(`\n${c.captured_at?.slice(0, 16) ?? '—'}  ${c.status}${c.identification_issue ? ` (${c.identification_issue})` : ''}`);
  console.log(`  retenu   ${c.scientific_name} — ${c.common_name_locale ?? '?'}`);
  console.log(`  score    ${c.confidence?.toFixed(3) ?? '?'}   catalogue: ${c.in_atlas ? 'oui' : 'non'}${coherent ? '' : '   ⚠ PAS le meilleur candidat'}`);
  for (const p of candidats) {
    const barre = '█'.repeat(Math.round(p.confidence * 30)).padEnd(30, '·');
    console.log(`    ${barre} ${p.confidence.toFixed(3)}  ${p.scientificName}${p.commonName ? ` (${p.commonName})` : ''}`);
  }
  const masse = candidats.reduce((s, p) => s + p.confidence, 0);
  console.log(`  masse top-5 ${masse.toFixed(3)}${masse < 0.3 ? '   ← dispersé : rien de reconnu' : ''}`);
}
