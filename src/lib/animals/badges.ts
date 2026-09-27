import { uiLanguage } from '@/i18n/current';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
// Les distinctions du carnet, dérivées de ce que la base sait déjà.
//
// AUCUNE TABLE, AUCUNE ÉCRITURE
//
// Un badge n'est pas un fait à stocker : c'est une LECTURE de la collection.
// Le persister obligerait à le recalculer à chaque capture, à gérer les
// corrections d'identification qui le retirent, et à réparer les lignes fausses
// quand la règle change. Ici, changer un seuil suffit — rien à migrer.
//
// LE SEUIL EST SUR LA VIGNETTE, PAS DANS UN ÉCRAN DE DÉTAIL
//
// « 25 » écrit sur une distinction verrouillée dit l'objectif sans qu'on ait à
// l'ouvrir. Une distinction qu'il faut toucher pour comprendre ne motive
// personne — elle demande un geste avant de promettre quoi que ce soit.
//
// TROIS FAMILLES, ET C'EST VOULU
//
//   ampleur    combien d'espèces en tout
//   flair      combien d'espèces rares — récompense l'œil, pas l'assiduité
//   règne      combien dans une branche du vivant — récompense la spécialité
//
// Trois axes indépendants : celui qui photographie tout, celui qui traque le
// rare, celui qui connaît ses oiseaux. Un seul axe ne récompenserait qu'un seul
// type de joueur.

import type { CardRarity } from './progression';

export type BadgeFamily = 'ampleur' | 'flair' | 'regne';

export type Badge = {
  family: BadgeFamily;
  /** L'icône SF Symbols, comme partout ailleurs dans l'app. */
  icon: string;
  key: string;
  label: string;
  /** Le nombre écrit sur la vignette. */
  threshold: number;
};

export type BadgeState = Badge & { earned: boolean; progress: number };

/** Les raretés qui comptent comme « une trouvaille » — la même liste que le
 *  classement du Registre, pour que les deux ne se contredisent jamais. */
export const FINDING_RARITIES: CardRarity[] = [
  'very_rare', 'ultra_rare', 'epic', 'mythic', 'legendary',
];

/**
 * A badge's display name in the UI language. Read from the locale files
 * directly (not i18next) because the `bun scripts/check-*` suites load this
 * module outside React Native. The French literal is only a fallback.
 */
function badgeName(key: string, fallback: string): string {
  const table: Record<string, string> = uiLanguage() === 'fr' ? fr : en;
  return table[`badge_${key}`] ?? fallback;
}

const BADGES: Badge[] = [
  { family: 'ampleur', icon: 'leaf.fill', key: 'ampleur-10', get label() { return badgeName('ampleur-10', 'Carnet entamé'); }, threshold: 10 },
  { family: 'ampleur', icon: 'leaf.fill', key: 'ampleur-50', get label() { return badgeName('ampleur-50', 'Collection'); }, threshold: 50 },
  { family: 'ampleur', icon: 'leaf.fill', key: 'ampleur-150', get label() { return badgeName('ampleur-150', 'Grand atlas'); }, threshold: 150 },
  { family: 'ampleur', icon: 'leaf.fill', key: 'ampleur-500', get label() { return badgeName('ampleur-500', 'Mémoire vive'); }, threshold: 500 },
  { family: 'flair', icon: 'sparkles', key: 'flair-1', get label() { return badgeName('flair-1', 'Première trouvaille'); }, threshold: 1 },
  { family: 'flair', icon: 'sparkles', key: 'flair-10', get label() { return badgeName('flair-10', 'Bon œil'); }, threshold: 10 },
  { family: 'flair', icon: 'sparkles', key: 'flair-40', get label() { return badgeName('flair-40', 'Chasseur de raretés'); }, threshold: 40 },
  { family: 'regne', icon: 'bird.fill', key: 'regne-oiseaux-25', get label() { return badgeName('regne-oiseaux-25', 'Ornithologue'); }, threshold: 25 },
  { family: 'regne', icon: 'hare.fill', key: 'regne-mammiferes-20', get label() { return badgeName('regne-mammiferes-20', 'Mammalogiste'); }, threshold: 20 },
  { family: 'regne', icon: 'ant.fill', key: 'regne-insectes-20', get label() { return badgeName('regne-insectes-20', 'Entomologiste'); }, threshold: 20 },
  { family: 'regne', icon: 'fish.fill', key: 'regne-poissons-12', get label() { return badgeName('regne-poissons-12', 'Ichtyologue'); }, threshold: 12 },
  { family: 'regne', icon: 'lizard.fill', key: 'regne-reptiles-12', get label() { return badgeName('regne-reptiles-12', 'Herpétologue'); }, threshold: 12 },
];

type Owned = { group?: string; rarity?: CardRarity; scientificName?: string };

/**
 * La classe taxonomique d'une capture → le groupe du catalogue.
 *
 * Une capture ne porte PAS `animal_group` : elle porte sa taxonomie GBIF
 * (`Aves`, `Mammalia`…), tandis que le catalogue range en français
 * (`oiseaux`, `mammiferes`…) et que les clés des distinctions suivent le
 * catalogue. Sans cette table, aucune distinction de règne ne s'allumerait
 * jamais — et en silence, ce qui est pire.
 *
 * Traduire ici plutôt que de chercher l'espèce dans le catalogue : la
 * traduction marche aussi pour les espèces HORS catalogue, celles que le
 * joueur découvre le premier. Ce sont justement celles qu'il faut compter.
 */
const GROUP_BY_CLASS: Record<string, string> = {
  Amphibia: 'amphibiens',
  Arachnida: 'arachnides',
  Actinopterygii: 'poissons',
  Aves: 'oiseaux',
  Chondrichthyes: 'poissons',
  Insecta: 'insectes',
  Mammalia: 'mammiferes',
  Reptilia: 'reptiles',
  Squamata: 'reptiles',
  Testudines: 'reptiles',
};

export function groupForClass(taxonClass: string | undefined): string | undefined {
  return taxonClass ? GROUP_BY_CLASS[taxonClass] : undefined;
}

/**
 * L'état de chaque distinction, depuis les espèces possédées.
 *
 * `owned` est une espèce par ligne, pas une capture : photographier dix fois le
 * même moineau ne fait avancer aucune distinction. C'est la même règle que
 * l'XP, et elle doit le rester — deux compteurs qui divergent se remarquent.
 */
export function badgeStates(owned: readonly Owned[]): BadgeState[] {
  const species = new Map<string, Owned>();
  for (const row of owned) {
    const key = row.scientificName;
    if (key && !species.has(key)) species.set(key, row);
  }
  const all = [...species.values()];

  const findings = all.filter((row) => row.rarity && FINDING_RARITIES.includes(row.rarity)).length;
  const byGroup = new Map<string, number>();
  for (const row of all) {
    if (row.group) byGroup.set(row.group, (byGroup.get(row.group) ?? 0) + 1);
  }

  return BADGES.map((badge) => {
    const count = badge.family === 'ampleur'
      ? all.length
      : badge.family === 'flair'
        ? findings
        // `regne-oiseaux-25` → le groupe est le segment du milieu.
        : byGroup.get(badge.key.split('-')[1]) ?? 0;
    return {
      ...badge,
      earned: count >= badge.threshold,
      progress: Math.min(1, count / badge.threshold),
    };
  });
}
