// Le tome, imprimé.
//
// DEUX VERSIONS RATÉES AVANT CELLE-CI, ET LEURS LEÇONS
//
//   LES FONDS NE S'IMPRIMENT PAS PAR DÉFAUT   WebKit les retire pour économiser
//     l'encre. Sans `print-color-adjust: exact`, un livre à pages d'encre sort
//     en pages BLANCHES.
//   `break-inside: avoid` NE MARCHE PAS EN FLEX   à l'impression, WebKit ne
//     l'honore pas sur les éléments d'une grille flex. Une carte se retrouvait
//     à cheval sur deux feuilles, coupée en son milieu.
//
// D'OÙ LE PRINCIPE : ON NE DEMANDE RIEN AU MOTEUR
//
// Les rencontres sont réparties SIX PAR SIX et chaque paquet est une feuille de
// hauteur fixe. Le moteur n'a plus aucune décision de pagination à prendre — il
// ne peut donc plus se tromper. C'est la seule façon fiable d'imprimer une
// grille depuis WebKit.
//
// LA GÉOMÉTRIE, ET POURQUOI CES NOMBRES
//
//   A4 = 210 × 297 mm, marges 14 → surface utile 182 × 269 mm.
//   Trois cartes de 54 mm plus deux gouttières de 4 = 170. Il reste 12.
//   Une carte = 75 mm d'illustration (proportions d'une carte à jouer sur 54 de
//   large) + 13 de plaque = 88. Deux rangées + gouttière + en-tête de mois =
//   22 + 180 = 202. Il reste 67 mm de garde.
//
// Une troisième rangée demanderait 290 mm et déborderait : c'est exactement ce
// qui coupait les cartes.
//
// LES IMAGES RESTENT DES URL
//
// Le moteur d'impression les charge lui-même. Les planches vivent dans un
// bucket public, les stickers derrière des URL signées valides 48 h. Encoder
// trois cents cartes en base64 ferait un document de plusieurs centaines de
// méga, et le téléphone mourrait avant de l'écrire.

import { cardSceneFor } from '@/components/cards/card-scenes';
import type { BookEncounter, BookMonth, BookYear } from '@/lib/animals/book';
import { MONTH_NAMES } from '@/lib/animals/book';
import { RARITY_TIERS } from '@/lib/animals/rarity';

type PrintModule = typeof import('expo-print');

let Print: PrintModule | null = null;
try {
  Print = require('expo-print') as PrintModule;
} catch {
  Print = null;
}

export const printingAvailable = Print !== null;

const CARD_W = 54; // mm
const CARD_H = 75; // mm — l'illustration seule
const PER_PAGE = 6;

function escape(text: string) {
  return text.replace(/[&<>"]/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;',
  );
}

function carteHtml({ capture, discovery, mastery }: BookEncounter) {
  const tier = capture.rarity ? RARITY_TIERS[capture.rarity] : undefined;
  const scene = cardSceneFor(capture.scientificName, capture.rarity, {
    sceneSlug: capture.sceneSlug,
  });
  const nom = escape(
    capture.commonNameLocale ?? capture.commonName ?? capture.scientificName ?? '—',
  );
  const latin = escape(capture.scientificName ?? '');
  const jour = new Date(capture.capturedAt).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
  return `<div class="carte" style="--accent:${tier?.accent ?? '#4b525e'};--base:${tier?.base ?? '#1b1e24'}">
    <div class="art">
      ${scene ? `<img class="planche" src="${scene}" />` : ''}
      ${capture.stickerUrl ? `<img class="bete" src="${capture.stickerUrl}" />` : ''}
      ${discovery ? '<span class="neuf">NOUVEAU</span>' : ''}
    </div>
    <div class="plaque">
      <div class="nom">${nom}</div>
      <div class="latin">${latin}</div>
      <div class="pied">
        <span class="rarete">${tier?.label ?? ''}</span>
        <span class="etoiles">${mastery ? '★'.repeat(mastery.level) : ''}</span>
        <span class="jour">${jour}</span>
      </div>
    </div>
  </div>`;
}

/** Un mois devient une ou plusieurs feuilles de six cartes. */
function moisHtml(month: BookMonth) {
  const paquets: BookEncounter[][] = [];
  for (let at = 0; at < month.encounters.length; at += PER_PAGE) {
    paquets.push(month.encounters.slice(at, at + PER_PAGE));
  }
  if (!paquets.length) paquets.push([]);

  const jalons = month.milestones
    .map((m) => `<li><b>${escape(m.title)}</b>${m.detail ? ` — ${escape(m.detail)}` : ''}</li>`)
    .join('');

  return paquets
    .map((paquet, index) => {
      const suite = paquets.length > 1 ? ` <span class="suite">${index + 1}/${paquets.length}</span>` : '';
      return `<div class="feuille">
        <header>
          <h2>${MONTH_NAMES[month.month]}${suite}</h2>
          ${
            index === 0
              ? `<p>${month.encounters.length} rencontre${month.encounters.length > 1 ? 's' : ''}
                  · ${month.speciesDiscovered} découverte${month.speciesDiscovered > 1 ? 's' : ''}</p>`
              : ''
          }
        </header>
        ${index === 0 && jalons ? `<ul class="jalons">${jalons}</ul>` : ''}
        <div class="grille">${paquet.map(carteHtml).join('')}</div>
      </div>`;
    })
    .join('');
}

export function bookHtml(year: BookYear): string {
  const sommaire = year.months
    .map(
      (month) => `<li>
        <span>${MONTH_NAMES[month.month]}</span>
        <b>${month.encounters.length}</b>
      </li>`,
    )
    .join('');

  const feuilles = year.months.map(moisHtml).join('');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<style>
  /* Sans ça, WebKit retire tous les fonds à l'impression et le livre sort
     blanc. C'est la ligne qui manquait à la première version. */
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 14mm; }
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; color: #2b2418; }

  /* CHAQUE FEUILLE FAIT EXACTEMENT LA PAGE, ET SE TERMINE PAR UNE COUPE.
     La règle overflow:hidden est la ceinture : si un jour un contenu dépassait,
     il serait rogné proprement plutôt que de pousser une carte sur la
     feuille suivante. */
  .feuille, .couverture, .sommaire, .dos {
    height: 269mm; overflow: hidden; break-after: page; page-break-after: always;
  }
  /* ---- couverture ---------------------------------------------------- */
  .couverture {
    background: #2b2418; color: #e6dfc4; text-align: center;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 4mm;
  }
  .couverture .marque { font-size: 9pt; letter-spacing: 4pt; opacity: .65; }
  .couverture h1 { font-size: 60pt; margin: 0; letter-spacing: -2pt; }
  .couverture h2 { font-size: 17pt; font-weight: 500; margin: 0; }
  .filet { width: 24mm; height: .4mm; background: #e6dfc4; opacity: .45; }
  .couverture p { font-size: 11pt; opacity: .75; margin: 0; }

  /* ---- sommaire ------------------------------------------------------- */
  .sommaire { padding-top: 6mm; }
  .sommaire h3 { font-size: 22pt; margin: 0 0 6mm; }
  .sommaire ul { list-style: none; margin: 0; padding: 0; }
  .sommaire li {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 2.4mm 0; border-bottom: .25mm dotted #cfc6b2; font-size: 12pt;
  }
  .sommaire b { font-variant-numeric: tabular-nums; color: #8d8271; font-weight: 600; }

  /* ---- une feuille de mois -------------------------------------------- */
  .feuille header { border-bottom: .5mm solid #2b2418; padding-bottom: 2mm; margin-bottom: 4mm; }
  .feuille h2 { font-size: 26pt; margin: 0; }
  .suite { font-size: 12pt; color: #8d8271; font-weight: 500; }
  .feuille header p { margin: 1mm 0 0; color: #8d8271; font-size: 10pt; }
  .jalons { list-style: none; margin: 0 0 5mm; padding: 0; }
  .jalons li {
    font-size: 9.5pt; color: #4a4032; padding: 1.6mm 3mm;
    background: #f3ecdd; border-radius: 1.5mm; margin-bottom: 1.5mm;
  }

  /* La grille est en inline-block, pas en flex : six cartes tiennent par
     construction, et rien ne dépend d'un calcul de pagination du moteur. */
  .grille { font-size: 0; }
  .carte {
    display: inline-block; vertical-align: top;
    width: ${CARD_W}mm; margin: 0 4mm 4mm 0;
    background: var(--base); border: .5mm solid var(--accent);
    border-radius: 2.5mm; overflow: hidden;
  }
  .carte:nth-child(3n) { margin-right: 0; }
  .art { position: relative; width: 100%; height: ${CARD_H}mm; overflow: hidden; }
  .planche { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }
  /* La bête est CENTRÉE dans le cadre, jamais étirée : c'est un détourage,
     l'écraser le trahirait. */
  .bete {
    position: absolute; left: 8%; top: 8%; width: 84%; height: 84%; object-fit: contain;
  }
  .neuf {
    position: absolute; top: 2mm; right: 2mm; background: #e6dfc4; color: #2b2418;
    font-size: 5.5pt; font-weight: 800; letter-spacing: .4pt;
    padding: .6mm 1.4mm; border-radius: 1mm;
  }
  .plaque { padding: 2mm 2.4mm 2.4mm; color: #e6dfc4; }
  .nom { font-size: 8.5pt; font-weight: 700; line-height: 1.1; }
  .latin { font-size: 6pt; font-style: italic; opacity: .55; margin-top: .4mm; }
  .pied {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 1.4mm; font-size: 5.5pt;
  }
  .rarete { color: var(--accent); font-weight: 800; letter-spacing: .3pt; }
  .etoiles { color: var(--accent); }
  .jour { opacity: .5; }

  /* ---- quatrième de couverture ---------------------------------------- */
  .dos {
    background: #2b2418; color: #e6dfc4; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 5mm; text-align: center;
    break-after: auto; page-break-after: auto;
  }
  .dos .citation { font-size: 20pt; line-height: 1.35; margin: 0; }
  .dos .imprint { font-size: 7.5pt; letter-spacing: 1.6pt; opacity: .5; margin: 0; }
</style></head><body>

  <div class="couverture">
    <div class="marque">SAFAROLL</div>
    <h1>${year.year}</h1>
    <h2>Mon année sauvage</h2>
    <div class="filet"></div>
    <p>${year.encounterCount} rencontres · ${year.speciesDiscovered} espèces découvertes</p>
  </div>

  <div class="sommaire">
    <h3>Sommaire</h3>
    <ul>${sommaire}</ul>
  </div>

  ${feuilles}

  <div class="dos">
    <p class="citation">« Tout ce que j’ai croisé<br />en ${year.year}. »</p>
    <div class="filet"></div>
    <p class="imprint">SAFAROLL · ATLAS VIVANT · TOME ${year.year}</p>
  </div>

</body></html>`;
}

/** Écrit le PDF et rend son chemin local. `null` si le module n'est pas là. */
export async function printBook(year: BookYear): Promise<string | null> {
  if (!Print) return null;
  const { uri } = await Print.printToFileAsync({ html: bookHtml(year) });
  return uri;
}
