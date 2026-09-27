import { createMMKV } from 'react-native-mmkv';

/**
 * LE RAPPEL QUI SE TAIT QUAND IL NE SERT PLUS.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Un moteur de rappels sait toujours combien il a envoyé, presque jamais ce
 * qu'il a produit. On règle alors la fréquence à l'intuition, et la seule
 * correction disponible est celle du joueur : couper les notifications — un
 * geste sans retour, qu'on ne défait pas.
 *
 * Ici la question est posée franchement : ce type de message fait-il SORTIR
 * quelqu'un ? Une capture après un clic est un signal d'utilité, pas une
 * preuve que le rappel a causé la sortie.
 *
 * LA RÈGLE, ET POURQUOI ELLE EST ASYMÉTRIQUE
 *
 * Trois clics sans une seule capture derrière : le message attire et ne sert à
 * rien. On se tait pour ce type-là. UNE capture suffit à tout remettre à zéro.
 *
 * L'asymétrie est voulue : se taire à tort coûte un rappel manqué, insister à
 * tort coûte la confiance — et la confiance ne se regagne pas par une
 * notification. Dans le doute, on se tait.
 *
 * LA FENÊTRE EST LONGUE EXPRÈS
 *
 * Six heures entre le clic et la capture. Un rappel saisonnier dit « sors
 * photographier » : on le lit au petit-déjeuner et on sort l'après-midi. Une
 * fenêtre d'une heure ne mesurerait que les gens déjà dehors, et conclurait
 * que le message ne marche jamais.
 */
const store = createMMKV({ id: 'nudge-feedback' });
let account: string | null = null;

/** Old unscoped keys cannot safely be assigned to a player. */
export function setNudgeAccount(userId: string | null | undefined): void {
  account = userId || null;
}

/** Trois occasions manquées avant de conclure. Deux serait du bruit. */
const SEUIL = 3;
/** Le temps qu'il faut pour lire un message, s'habiller et croiser un animal. */
const FENETRE_MS = 6 * 60 * 60 * 1000;

export type NudgeKind = 'leaving' | 'arriving' | 'peak';

const cleClics = (kind: string) => `${account}:${kind}.clics_sans_capture`;
const cleDernier = (kind: string) => `${account}:${kind}.dernier_clic`;

/** Le joueur a ouvert un rappel de ce type. */
export function noterClicRappel(kind: NudgeKind): void {
  if (!account) return;
  conclureRappelSansSuite(kind);
  store.set(cleDernier(kind), Date.now());
}

/**
 * Une capture vient d'avoir lieu. Elle crédite le dernier rappel ouvert, s'il
 * est encore dans la fenêtre — et remet son compteur à zéro.
 */
export function noterCaptureApresRappel(): void {
  if (!account) return;
  const maintenant = Date.now();
  let latest: { kind: NudgeKind; at: number } | undefined;
  for (const kind of ['leaving', 'arriving', 'peak'] as const) {
    const dernier = store.getNumber(cleDernier(kind));
    if (dernier === undefined || dernier > maintenant || maintenant - dernier > FENETRE_MS) continue;
    if (!latest || dernier > latest.at) latest = { kind, at: dernier };
    // Consume all eligible clicks so replaying the reveal cannot credit an older one.
    store.remove(cleDernier(kind));
  }
  if (latest) store.set(cleClics(latest.kind), 0);
}

/**
 * À appeler quand un rappel ouvert est resté sans suite. Rend `true` si ce
 * type doit désormais se taire.
 */
export function conclureRappelSansSuite(kind: NudgeKind): boolean {
  if (!account) return false;
  const dernier = store.getNumber(cleDernier(kind));
  if (dernier === undefined || Date.now() - dernier <= FENETRE_MS) return false;
  const clics = (store.getNumber(cleClics(kind)) ?? 0) + 1;
  store.set(cleClics(kind), clics);
  store.remove(cleDernier(kind));
  return clics >= SEUIL;
}

/** Les types réduits au silence, pour que le ciblage serveur les évite. */
export function typesMuets(): NudgeKind[] {
  if (!account) return [];
  for (const kind of ['leaving', 'arriving', 'peak'] as const) conclureRappelSansSuite(kind);
  return (['leaving', 'arriving', 'peak'] as const).filter(
    (kind) => (store.getNumber(cleClics(kind)) ?? 0) >= SEUIL,
  );
}

/** Utilisé par le contrôle de cohérence — voir `scripts/check-nudge-feedback.ts`. */
export const REGLE = { FENETRE_MS, SEUIL };
