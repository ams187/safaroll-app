// AUCUN TOTAL D'ESPÈCES DANS LES TEXTES.
//
// CE QUE ÇA PROTÈGE
//
// Le catalogue relu compte 5 576 espèces. Le modèle, lui, en reconnaît des
// centaines de milliers : une capture hors catalogue devient une découverte
// sauvage, nommée par GBIF, et rejoint la collection comme les autres.
//
// Écrire « il t'en reste 5 400 » ou « sans modifier les 884 » fige donc une
// borne qui n'existe pas. Le joueur qui la lit croit voir la taille du jeu ;
// il voit la taille d'une TABLE, qui grandit à chaque ajout au catalogue et
// qui ne dit rien de ce qu'il peut réellement photographier.
//
// Pire : un total affiché transforme une collection sans fin en une barre de
// progression — et une barre de progression qui n'avance jamais décourage
// plus qu'elle ne motive.
//
// CE QUI RESTE AUTORISÉ : ce que le joueur a FAIT (« 43 espèces »), et les
// bornes qui lui appartiennent vraiment — l'énergie du jour, un objectif
// mensuel qu'il s'est fixé, les 7 jours d'une semaine.
import { readFileSync } from 'node:fs';

const LANGUES = ['fr', 'en'] as const;
/** Un nombre à quatre chiffres, ou trois si suivi d'un mot de totalité. */
const SUSPECT = /\b\d{4,}\b|\b\d{3}\b(?=[^.]*\b(esp[èe]ces?|species|total|encyclop|catalogue|catalog)\b)/i;
/** Ces clés parlent d'un quota qui appartient au joueur, pas du catalogue. */
const EXEMPTES = /^(collection_energy|profile_quota|pay_|expedition_days)/;

let fautes = 0;
for (const langue of LANGUES) {
  const textes = JSON.parse(readFileSync(`src/locales/${langue}.json`, 'utf8')) as Record<string, string>;
  for (const [cle, valeur] of Object.entries(textes)) {
    if (EXEMPTES.test(cle)) continue;
    const trouve = valeur.match(SUSPECT);
    if (!trouve) continue;
    console.error(`error: ${langue}.${cle} annonce un total (« ${trouve[0]} ») : ${valeur.slice(0, 70)}…`);
    fautes += 1;
  }
}

if (fautes) {
  console.error(
    '\nUn total d’espèces fige une borne qui n’existe pas : le modèle en reconnaît\n' +
    'des centaines de milliers, le catalogue n’est qu’une table. Dis ce que le\n' +
    'joueur a fait, jamais ce qu’il lui « reste ».',
  );
  process.exit(1);
}
console.log('check-no-species-total: ok (aucun total d’espèces annoncé)');
