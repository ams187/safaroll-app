import type { Rarity } from '@/lib/animals/rarity';


/**
 * PERSONNE N'ATTEND SA PLANCHE.
 *
 * 1 736 planches sont peintes pour 5 576 espèces au catalogue, et le catalogue
 * ne couvre pas les espèces sauvages que BioCLIP reconnaît. Cette fonction
 * fabriquait pourtant une URL depuis le nom et la donnait à la carte sans
 * jamais demander si le fichier existait : deux cartes sur trois s'ouvraient
 * sur un décor vide, sans que rien ne le signale.
 *
 * Le serveur résout maintenant la planche de chaque espèce (`scene_slugs`) :
 * la sienne si elle existe, sinon celle d'une autre espèce de son groupe,
 * empruntée en attendant. La carte est complète dès la première seconde, et la
 * planche définitive prendra sa place sans qu'on migre quoi que ce soit — elle
 * reste COMPOSÉE à l'affichage (planche + sticker + couleur + rareté + texte),
 * donc changer le slug met à niveau toutes les cartes de l'espèce d'un coup.
 *
 * DEUX SOURCES, ET L'ORDRE EST UN CORRECTIF
 *
 *   1. `sceneSlug`   ce que le serveur a résolu. Couvre tout ce qui vient d'une
 *                    capture — c'est-à-dire tout le jeu.
 *   2. le nom        pour les cartes écrites à la main : l'éventail du paywall,
 *                    une démonstration, un aperçu. Elles n'ont pas de slug
 *                    serveur, et un repli PAR GROUPE leur avait fait perdre
 *                    leur planche alors qu'elles l'avaient déjà. La devinette
 *                    par le nom est exactement ce qui marchait avant : elle
 *                    tombe juste chaque fois que la planche existe.
 *
 * Il n'y a volontairement pas de troisième recours par groupe ici. C'est le
 * travail du serveur, qui sait ce que contient le bucket — le client, lui,
 * l'ignore, et un repli posé à l'aveugle remplace des planches correctes.
 */
function speciesKey(scientificName?: string) {
  return scientificName?.trim().toLowerCase().split(/\s+/).slice(0, 2).join(' ');
}

/**
 * DEUX TAILLES, ET C'EST TOUTE LA DIFFÉRENCE ENTRE UNE GRILLE FLUIDE ET UNE
 * GRILLE QUI RAME.
 *
 * Une planche est stockée en 768 × 1152. Dans la collection, une carte fait
 * 114 pt — 342 px sur un écran 3× — donc la planche y est 5,4× trop lourde en
 * pixels. `allowDownscaling` réduit bien le bitmap final, mais seulement après
 * avoir téléchargé et décodé l'image entière : le coût est déjà payé, et il est
 * payé pour les dizaines de cartes que la grille tient montées.
 *
 * `'grid'` sert donc une vignette de 448 px pré-générée (voir
 * `scripts/build-card-thumbs.ts`), ~4× plus légère. `'full'` — la valeur par
 * défaut, pour la carte ouverte et le PDF — garde la pleine résolution, seul
 * endroit où elle se voit.
 *
 * Le défaut reste `'full'` : un appelant qui n'a pas réfléchi à sa taille
 * obtient l'image juste mais lourde, jamais l'inverse.
 */
export type SceneSize = 'full' | 'grid';

const SCENE_BASE = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/card-scenes`;

export function cardSceneFor(
  scientificName?: string,
  _rarity?: Rarity | null,
  scene?: { sceneSlug?: string; size?: SceneSize },
): string | undefined {
  const slug = scene?.sceneSlug ?? speciesKey(scientificName)?.replaceAll(' ', '-');
  if (!slug) return undefined;
  return scene?.size === 'grid'
    ? `${SCENE_BASE}/thumb/${slug}.webp`
    : `${SCENE_BASE}/${slug}.webp`;
}

/**
 * La pleine planche correspondant à une URL de vignette.
 *
 * Les vignettes se produisent par lots ; le goal, lui, continue d'écrire de
 * nouvelles planches. Entre les deux, une espèce a sa planche mais pas encore
 * sa vignette — et sans ce repli, sa carte s'afficherait vide dans la grille.
 * Les appelants le branchent sur `onError`, ce qui rend l'ordre de déploiement
 * indifférent : on peut téléverser les vignettes après avoir livré le code.
 */
export function fullSceneFrom(thumbUrl: string): string {
  return thumbUrl.replace(`${SCENE_BASE}/thumb/`, `${SCENE_BASE}/`);
}

