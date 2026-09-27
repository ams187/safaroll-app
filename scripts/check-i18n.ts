// LES DEUX DICTIONNAIRES DOIVENT RESTER JUMEAUX, ET LES CLÉS DOIVENT EXISTER.
//
// Trois pannes silencieuses, aucune ne se voit à la relecture :
//
//   1. une clé ajoutée dans `fr.json` et oubliée dans `en.json` — l'anglophone
//      voit l'identifiant brut, `pay_row_guide`, en plein paywall ;
//   2. un `t('cle_qui_nexiste_pas')` — même symptôme, sans qu'aucun outil ne
//      l'ait signalé ;
//   3. une valeur identique dans les deux langues, qui trahit une traduction
//      oubliée plutôt qu'un mot réellement commun.
// Run: bun run check:i18n
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import ts from 'typescript';
import { createInstance } from 'i18next';
import { badgeStates } from '../src/lib/animals/badges';
import { getDeckProgress } from '../src/lib/animals/progression';
import { objectivesForMonth } from '../src/lib/animals/objectives';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check-i18n: ${message}`);
}

const RACINE = join(import.meta.dir, '..');
const fr = JSON.parse(readFileSync(join(RACINE, 'src/locales/fr.json'), 'utf8')) as Record<string, string>;
const en = JSON.parse(readFileSync(join(RACINE, 'src/locales/en.json'), 'utf8')) as Record<string, string>;
const bootstrap = readFileSync(join(RACINE, 'src/i18n.ts'), 'utf8');
const profile = readFileSync(join(RACINE, 'src/app/(app)/profile.tsx'), 'utf8');
assert(bootstrap.includes('lng: getDeviceLanguage()') && !bootstrap.includes('language-preference'), 'la langue native doit primer sur une ancienne préférence interne');
assert(profile.includes('Linking.openSettings()') && !profile.includes('setPickingLanguage'), 'le choix de langue doit ouvrir les réglages natifs');

const manqueEn = Object.keys(fr).filter((k) => !(k in en));
const manqueFr = Object.keys(en).filter((k) => !(k in fr));
assert(manqueEn.length === 0, `absentes de en.json : ${manqueEn.join(', ')}`);
assert(manqueFr.length === 0, `absentes de fr.json : ${manqueFr.join(', ')}`);

// Des mots réellement communs aux deux langues. Tout le reste qui coïncide est
// suspect : c'est presque toujours du français laissé dans en.json.
const COMMUNS = new Set([
  'atlas', 'Spam', 'Violence', 'Leaderboard', 'Actions', 'SafaRoll', 'captures',
  'Capture', 'capture', 'Captures', 'Source', 'Pirate', 'ZooSafari',
  // Nom d'un palier de rareté, identique dans les deux langues.
  'Rare',
]);
const identiques = Object.keys(fr).filter(
  (k) => fr[k] === en[k] && (fr[k] ?? '').length > 3 && !COMMUNS.has(fr[k] ?? ''),
);
assert(
  identiques.length === 0,
  `valeurs identiques fr/en, traduction probablement oubliée : ${identiques.join(', ')}`,
);

// Chaque `t('…')` du code doit pointer sur une clé qui existe.
const APPEL = /\b(?:t|copy|translate)\(\s*['"]([a-z0-9_]+)['"]/g;
const inconnues = new Set<string>();
const hardcoded = new Set<string>();
for (const rel of new Glob('src/**/*.{ts,tsx}').scanSync(RACINE)) {
  const src = readFileSync(join(RACINE, rel), 'utf8');
  for (const m of src.matchAll(APPEL)) {
    const cle = m[1]!;
    // i18next résout les pluriels par suffixe : `t('x', { count })` va chercher
    // `x_one` ou `x_other`, jamais `x`. Une clé qui n'existe qu'en pluriel est
    // donc valide — l'ignorer ferait de ce contrôle une source de faux positifs,
    // et un contrôle qui crie pour rien finit désactivé.
    const existe = cle in fr || (`${cle}_one` in fr && `${cle}_other` in fr);
    if (!existe) inconnues.add(`${cle} (${rel})`);
  }
  if (!rel.endsWith('.tsx')) continue;
  const tree = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    const literal = ts.isJsxText(node) ? node.text :
      ts.isJsxAttribute(node) && ts.isIdentifier(node.name) &&
      ['title', 'subtitle', 'label', 'placeholder', 'accessibilityLabel', 'accessibilityHint'].includes(node.name.text) &&
      node.initializer && ts.isStringLiteral(node.initializer) ? node.initializer.text : '';
    if (/[éèàùêçœ]/i.test(literal)) hardcoded.add(`${rel}: ${literal.trim()}`);
    ts.forEachChild(node, visit);
  };
  visit(tree);
}
assert(inconnues.size === 0, `clés appelées mais absentes : ${[...inconnues].join(', ')}`);
assert(hardcoded.size === 0, `français écrit directement dans le JSX : ${[...hardcoded].join('\n')}`);

const parameters = (value: string) => [...value.matchAll(/{{\s*([^},]+)(?:,[^}]+)?\s*}}/g)].map((m) => m[1]!.trim()).sort().join(',');
for (const key of Object.keys(fr)) assert(parameters(fr[key]!) === parameters(en[key]!), `paramètres différents : ${key}`);

const translator = createInstance();
await translator.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: en }, fr: { translation: fr } } });
assert(translator.t('museum_species', { count: 2 }) === '2 species on display', 'plural anglais incorrect');
assert(translator.t('count_discoveries', { count: 2 }) === '2 discoveries', 'discovery ne prend pas simplement un s');
for (const badge of badgeStates([])) assert(`badge_${badge.key}` in en, `badge non traduit : ${badge.key}`);
for (let month = 0; month < 12; month++) for (const objective of objectivesForMonth(2026, month)) {
  assert(`objective_${objective.key}` in en, `objectif non traduit : ${objective.key}`);
}
assert(getDeckProgress([]).titleKey in en, 'titre de progression non traduit');
await translator.changeLanguage('fr');
assert(translator.t('museum_species', { count: 2 }) === '2 espèces exposées', 'bascule française incorrecte');
await translator.changeLanguage('en');
assert(translator.t('museum_species', { count: 2 }) === '2 species on display', 'bascule anglaise incorrecte');

console.log(`check-i18n: ok (${Object.keys(fr).length} clés, fr et en alignés)`);
