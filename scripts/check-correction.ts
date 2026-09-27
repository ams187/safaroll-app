// Le filtre de correction, et son accord avec la base.
//
// La règle vit à DEUX endroits : dans `correctable-candidates.ts` pour ne pas
// proposer un bouton qui échouerait, et dans la fonction SQL
// `confirm_capture_identification` où elle protège vraiment. Un filtre d'écran
// n'empêche personne d'appeler la RPC directement.
//
// Ce check garde les deux copies d'accord, en lisant le SQL.
//
// Run: bun run check:correction

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  correctableCandidates,
  MIN_CANDIDATE_CONFIDENCE,
  MIN_CANDIDATE_RATIO,
} from '../src/lib/animals/correctable-candidates';

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) console.log(`✓ ${label}`);
  else { failures += 1; console.error(`✗ ${label}`); }
}

// Les candidats réels du paresseux — le cas qui a motivé la règle.
const SLOTH = [
  { confidence: 0.5544, scientificName: 'Bradypus tridactylus' },
  { confidence: 0.1452, scientificName: 'Bradypus torquatus' },
  { confidence: 0.0889, scientificName: 'Bradypus variegatus' },
  { confidence: 0.0632, scientificName: 'Choloepus didactylus' },
  { confidence: 0.0332, scientificName: 'Bradypus pygmaeus' },
];
const open = correctableCandidates(SLOTH, 'Bradypus tridactylus');
check('le bon paresseux reste corrigeable', open.some((c) => c.scientificName === 'Bradypus torquatus'));
check('le 3ᵉ à 8,9 % est écarté', !open.some((c) => c.scientificName === 'Bradypus variegatus'));
check('le 5ᵉ à 3,3 % est écarté', !open.some((c) => c.scientificName === 'Bradypus pygmaeus'));
check('l’espèce déjà retenue n’est pas reproposée', !open.some((c) => c.scientificName === 'Bradypus tridactylus'));

// Un modèle sûr de lui n'ouvre aucune correction : rien à rectifier.
check(
  'un candidat unique à 99 % n’ouvre rien',
  correctableCandidates([{ confidence: 0.99, scientificName: 'A' }], 'A').length === 0,
);
// Deux candidats proches : les deux doivent rester ouverts.
check(
  'deux candidats proches restent tous deux ouverts',
  correctableCandidates(
    [{ confidence: 0.4, scientificName: 'A' }, { confidence: 0.35, scientificName: 'B' }],
    'A',
  ).length === 1,
);
// Entrées dégénérées : rien, jamais une exception.
check('liste vide', correctableCandidates([], 'A').length === 0);
check('liste absente', correctableCandidates(undefined, 'A').length === 0);
check(
  'confiances toutes nulles',
  correctableCandidates([{ confidence: 0, scientificName: 'A' }], 'B').length === 0,
);

// --- L'accord avec la base ---------------------------------------------------
//
// Si l'écran est plus permissif que le SQL, le joueur voit un bouton qui lève
// une exception. S'il est plus strict, une correction légitime devient
// impossible sans que rien ne l'explique.
const sql = readFileSync('supabase/migrations/20260807140000_player_correction_guards.sql', 'utf8');
check(
  `le SQL porte le même plancher absolu (${MIN_CANDIDATE_CONFIDENCE})`,
  sql.includes(`chosen_confidence < ${MIN_CANDIDATE_CONFIDENCE}`),
);
check(
  `le SQL porte le même rapport au premier (1/${1 / MIN_CANDIDATE_RATIO})`,
  sql.includes(`best_confidence / ${1 / MIN_CANDIDATE_RATIO}`),
);
check(
  'le SQL accepte une capture déjà posée',
  sql.includes("status in ('ready', 'needs_review')"),
);
check(
  'le SQL laisse une trace de la correction',
  sql.includes("identification_issue = 'player_corrected'"),
);

// --- Aucun écran ne contourne le filtre ---------------------------------------
//
// La caméra a corrigé pendant des mois SANS plancher — normal, il n'existait
// pas. Le jour où il est apparu, elle a continué de proposer des candidats que
// la base refusait désormais : des boutons qui lèvent une exception. Tout écran
// qui sait corriger doit donc passer par la même porte.
{
  const screens = execSync(
    "grep -rl 'confirmIdentification' src || true",
    { encoding: 'utf8' },
  ).split('\n').filter((line) => line.endsWith('.tsx'));
  check('au moins un écran sait corriger', screens.length > 0);
  for (const screen of screens) {
    check(
      `${screen} passe par correctableCandidates`,
      readFileSync(screen, 'utf8').includes('correctableCandidates'),
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} règle(s) cassée(s).`);
  process.exit(1);
}
console.log('\nCorrection joueur : écran et base d’accord.');
