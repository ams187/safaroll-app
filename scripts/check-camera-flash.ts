// LE FLASH DOIT ÊTRE ÉTEINT PAR DÉFAUT, ET IL DOIT PARTIR AVEC LA PHOTO.
//
// Deux erreurs muettes possibles, et aucune ne se voit à la relecture :
//
//   1. le réglage par défaut glisse sur 'auto' — l'app se met alors à
//      éblouir des animaux sans que personne ne l'ait demandé, ce que nos
//      propres conditions interdisent ;
//   2. le bouton s'affiche et fonctionne, mais `capturePhoto` est appelée
//      sans `flashMode` — le flash ne part jamais, et rien ne le signale.
//
// Les deux surfaces caméra sont vérifiées, parce que la seconde est celle
// qu'on oublie.
// Run: bun run check:flash
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check-camera-flash: ${message}`);
}

const RACINE = join(import.meta.dir, '..');
const lire = (p: string) => readFileSync(join(RACINE, p), 'utf8');

const store = lire('src/lib/camera/flash.ts');
assert(
  /return brut === 'auto' \|\| brut === 'on' \? brut : 'off'/.test(store),
  "le flash n'est plus éteint par défaut — l'app déclencherait sans qu'on le lui demande",
);
assert(
  /CYCLE: FlashMode\[\] = \['off', 'auto', 'on'\]/.test(store),
  "le cycle ne commence plus par 'auto' : le premier tap ne doit pas armer le flash à pleine puissance",
);

// L'INVARIANT SUIT LE CODE, PAS UNE ADRESSE.
//
// La version précédente exigeait `capturePhoto({ flashMode })` dans DEUX
// fichiers nommés. L'obturateur a déménagé dans la barre d'onglets — geste
// légitime — et le contrôle est devenu rouge alors que le flash marchait
// parfaitement. Pire : il bloquait toute la chaîne `bun run check` derrière
// lui, donc tous les garde-fous suivants cessaient de s'exécuter.
//
// Un garde-fou qui casse sur un déplacement de code n'encode pas un invariant,
// il encode une habitude. La règle réelle est double :
//
//   1. QUELQU'UN prend la photo avec `flashMode` — sinon le bouton est un
//      décor et personne ne s'en apercevrait ;
//   2. TOUT appelant de `capturePhoto` le transmet — un second obturateur
//      ajouté demain sans le flag serait le vrai défaut à attraper.
const SURFACES = [
  'src/app/(app)/camera.tsx',
  'src/components/navigation/expandable-camera-tab-bar.tsx',
];

const preneurs = SURFACES.filter((surface) => /capturePhoto\(/.test(lire(surface)));
assert(
  preneurs.length > 0,
  'aucune surface n appelle capturePhoto : le bouton flash n aurait plus rien à armer',
);
for (const surface of preneurs) {
  const src = lire(surface);
  assert(
    /capturePhoto\(\{ flashMode \}/.test(src),
    `${surface} prend la photo sans transmettre flashMode — le bouton serait décoratif`,
  );
  assert(
    /hasFlash/.test(src),
    `${surface} affiche le bouton sans vérifier device.hasFlash`,
  );
}


// LE VISEUR NE PORTE QUE DES COMMANDES.
//
// Le compteur de captures restantes a été sorti de la caméra : il y occupait
// une pastille permanente pour une information qu'on lit une fois par jour. Il
// vit maintenant dans la bannière du profil. Le remettre dans le viseur « juste
// pour dépanner » est la régression facile.
for (const surface of [
  'src/app/(app)/camera.tsx',
  'src/components/navigation/expandable-camera-tab-bar.tsx',
]) {
  assert(
    !/CollectionEnergyPopover|capturesRestantes/.test(lire(surface)),
    `${surface} réaffiche le compteur de captures — il appartient à la bannière du profil`,
  );
}

// …mais la GARDE, elle, doit rester : sans elle on déclenche au-delà du quota.
//
// Même raisonnement que pour le flash : on l'exige là où l'obturateur VIT,
// pas dans une liste de fichiers écrite un jour donné. `camera.tsx` ne
// déclenche plus rien — lui réclamer la garde reviendrait à protéger une porte
// qui n'existe plus.
for (const surface of preneurs) {
  assert(
    /remainingEnergy === 0/.test(lire(surface)),
    `${surface} ne bloque plus le déclencheur à zéro capture restante`,
  );
}

assert(
  /capturesRestantes/.test(lire('src/app/(app)/profile.tsx')),
  'le compteur a disparu du profil : sorti du viseur, il doit exister quelque part',
);

console.log('check-camera-flash: ok (flash éteint par défaut, compteur hors du viseur, garde intacte)');
