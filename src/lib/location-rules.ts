// Quand l'app a le droit de parler de position, et ce qu'elle a le droit de
// dire. Deux règles, pures, sans une seule dépendance native — c'est ce qui
// permet à `scripts/check-location-invite.ts` de les vérifier sans simulateur.
//
// Elles ne sont pas cosmétiques :
//
// - `shouldInvite` protège la cartouche unique du dialogue iOS. Refusé une
//   fois, il ne revient jamais.
// - `mapNotice` interdit de vendre Naturaliste vers une carte vide. C'est la
//   règle qui coûte le plus cher si elle saute : quelqu'un paie, ouvre la
//   carte, il n'y a rien, et il demande un remboursement.
//
// Le côté natif (lecture de l'autorisation, dialogue, MMKV, Réglages) vit dans
// `location-permission.ts`.

/**
 * Trois états actionnables, pas cinq :
 * - `ask` — le dialogue système marchera encore (jamais demandé, ou Android)
 * - `settings` — il ne marchera plus, seul le deep-link Réglages reste
 * - `granted`
 * `unknown` est le temps de la première lecture, et rien ne doit s'afficher
 * pendant : une bannière qui apparaît puis disparaît se lit comme un bug.
 */
export type LocationGate = 'unknown' | 'granted' | 'ask' | 'settings';

/** Deux invitations, espacées d'une semaine. Au-delà c'est du harcèlement. */
export const MAX_INVITES = 2;
export const INVITE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Peut-on présenter la feuille de pré-permission ? */
export function shouldInvite({
  gate,
  invites,
  lastInviteAt,
  now,
}: {
  gate: LocationGate;
  invites: number;
  lastInviteAt: number;
  now: number;
}): boolean {
  if (gate === 'granted' || gate === 'unknown') return false;
  if (invites >= MAX_INVITES) return false;
  // `lastInviteAt` à 0 = jamais invité : pas de délai à purger.
  if (lastInviteAt === 0) return true;
  return now - lastInviteAt >= INVITE_COOLDOWN_MS;
}

export type MapNotice =
  /** Des captures existent, aucune n'est située, et la position n'est pas donnée. */
  | { kind: 'location'; captureCount: number }
  /** La position est donnée mais tout le stock lui est antérieur — il est perdu. */
  | { kind: 'pending' }
  /** Il y a du stock situé, et la carte est payante. */
  | { kind: 'premium'; locatedCount: number }
  | null;

/**
 * Deux ventes se croisent sur la carte et il ne faut jamais les empiler : la
 * position (gratuite, vendue sur le lieu gardé avec la capture) et la carte
 * (premium, vendue sur le stock déjà situé). L'ordre des branches EST la règle
 * métier : si les captures n'ont pas de coordonnées, on répare la permission
 * d'abord — le paywall attendra qu'il y ait quelque chose à montrer.
 */
export function mapNotice({
  captureCount,
  gate,
  isPremium,
  locatedCount,
}: {
  captureCount: number;
  gate: LocationGate;
  isPremium: boolean;
  locatedCount: number;
}): MapNotice {
  // Rien capturé : il n'y a rien à vendre ni à réparer.
  if (captureCount === 0) return null;
  // Première lecture de l'autorisation en cours.
  if (gate === 'unknown') return null;

  if (locatedCount === 0) {
    if (gate !== 'granted') return { captureCount, kind: 'location' };
    // Autorisé, mais tout ce qui existe a été capturé avant. Le dire, sinon la
    // carte vide passe pour une panne.
    return { kind: 'pending' };
  }

  if (!isPremium) return { kind: 'premium', locatedCount };
  return null;
}

/**
 * Ce que le carton de la carte affiche réellement, verrou compris.
 *
 * Sans abonnement la carte est floutée, donc il y a TOUJOURS quelque chose à
 * dire — mais pas n'importe quoi : si la position manque, c'est elle qu'on
 * répare, même par-dessus le flou. Vendre Naturaliste à quelqu'un dont la carte
 * sera vide juste après l'achat, c'est le remboursement assuré.
 */
export function mapGate(input: {
  captureCount: number;
  gate: LocationGate;
  isPremium: boolean;
  locatedCount: number;
}): MapNotice {
  // Rien tant que l'autorisation n'est pas lue : un carton qui s'affiche puis
  // se remplace par un autre se lit comme un bug.
  if (input.gate === 'unknown') return null;
  const notice = mapNotice(input);
  if (notice?.kind === 'location') return notice;
  if (!input.isPremium) return { kind: 'premium', locatedCount: input.locatedCount };
  return notice;
}
