import { useRegion } from '@/lib/animals/use-region';
import { api } from '@/lib/supabase/api';
import { useBackendAuth, useQuery } from '@/lib/supabase/backend';
import { useEffect, useMemo } from 'react';
import { typesMuets } from '@/lib/animals/nudge-feedback';
import { pickDailyNudge, type SeasonCurve } from '@/lib/animals/season-nudges';
import { scheduleSeasonNudge, useNotificationRevision } from '@/lib/notifications';
import { syncEngagementTags, trackSeasonWindow } from '@/lib/onesignal';
import { useTranslation } from 'react-i18next';

/**
 * Schedules at most one seasonal reminder, once per app session, for the most
 * urgent species the player is still missing this month.
 *
 * Everything the decision needs is already in the client's cache — the
 * seasonal curves and the player's own captures — so no server round trip and
 * no push infrastructure. If notifications are denied or the native module
 * isn't linked yet, this quietly does nothing.
 *
 * La région était `'FR'` en dur, et c'était le pire des trois endroits où elle
 * l'était : une notification pousse le message hors de l'app, sur l'écran de
 * verrouillage. « Dernière semaine pour voir le martinet noir » envoyé à
 * quelqu'un qui n'en croisera jamais n'est pas une approximation, c'est une
 * raison de couper les notifications.
 */
export function useSeasonNudge() {
  const { isAuthenticated } = useBackendAuth();
  const { i18n } = useTranslation();
  const region = useRegion();
  const seasons = useQuery(
    api.seasons.inSeason,
    isAuthenticated ? { region: region.code } : 'skip',
  );
  // Le catalogue entier : il ne sert ici qu'à nommer les espèces, et un nom ne
  // dépend d'aucune région. C'est `seasons.inSeason` qui porte le lieu.
  const catalog = useQuery(api.catalog.listAll, isAuthenticated ? {} : 'skip');
  const captures = useQuery(api.animals.listCaptures, isAuthenticated ? {} : 'skip');
  const notificationRevision = useNotificationRevision();

  const nudge = useMemo(() => {
    if (!seasons || !catalog || !captures) return null;
    const names = new Map(
      catalog.map((entry) => [entry.canonicalName, entry.vernacularName ?? entry.canonicalName]),
    );
    const owned = new Set(
      captures
        .filter((capture) => capture.status === 'ready')
        .map((capture) => capture.scientificName)
        .filter((name): name is string => Boolean(name)),
    );
    const candidates = seasons
      .filter((season) => names.has(season.scientificName))
      .map((season) => ({
        commonName: names.get(season.scientificName)!,
        curve: {
          monthlyCounts: season.monthlyCounts,
          scientificName: season.scientificName,
        } satisfies SeasonCurve,
      }));
    return pickDailyNudge(candidates, owned, new Date().getMonth(), i18n.language === 'fr' ? 'fr' : 'en');
  }, [captures, catalog, i18n.language, seasons]);

  useEffect(() => {
    // La région de repli sert à dessiner l'UI, pas à envoyer une campagne.
    if (!isAuthenticated || region.declared === undefined || !seasons || !catalog || !captures) return;
    // Le résultat du calcul part en tags — l'espèce urgente d'aujourd'hui, ou
    // l'effacement de celle d'hier. La Journey saisonnière se déclenche
    // là-dessus ; le serveur n'apprend jamais le calcul, seulement sa sortie.
    // Les tags décrivent l'ÉTAT (pour cibler et segmenter) ; l'événement porte
    // l'ÉVÉNEMENT (pour déclencher et personnaliser). La copie voyage avec
    // l'événement, pas en tag : OneSignal conserve l'événement déclencheur et
    // ses propriétés sont lisibles en Liquid dans le message.
    syncEngagementTags({
      region: region.code,
      urgency_kind: nudge?.kind ?? null,
      urgent_species: nudge?.scientificName ?? null,
      // Le texte part avec, pour qu'une campagne unique puisse le substituer
      // au lieu de recalculer la saisonnalité de chaque joueur côté serveur.
      nudge_title: nudge?.title ?? null,
      nudge_body: nudge?.body ?? null,
      nudge_image: nudge ? imageEspece(nudge.scientificName) : null,
      // Les types réduits au silence. La campagne les exclut par filtre : le
      // serveur n'a pas à savoir POURQUOI, seulement à ne pas insister.
      nudge_muted: typesMuets().join(',') || null,
    });
    // LE SILENCE SE DÉCIDE À LA SOURCE, PAS AU CIBLAGE.
    //
    // La Journey saisonnière est déclenchée par l'ÉVÉNEMENT `season_window`,
    // pas par un segment : le filtre `nudge_muted` du segment ne s'y applique
    // donc pas. Un joueur réduit au silence recevrait quand même le message.
    //
    // On n'émet plus l'événement du tout. C'est plus sûr qu'un filtre — il n'y
    // a rien à exclure quand rien n'est dit — et ça vaut pour toute Journey
    // future branchée sur cet événement, y compris celles qu'on n'a pas encore
    // écrites.
    const muet = nudge !== null && typesMuets().includes(nudge.kind);
    trackSeasonWindow(
      muet ? null : nudge
        ? {
            body: nudge.body,
            kind: nudge.kind,
            locale: i18n.language === 'fr' ? 'fr' : 'en',
            scientificName: nudge.scientificName,
            title: nudge.title,
          }
        : null,
    );
    if (!nudge) return;
    void scheduleSeasonNudge(nudge);
  }, [notificationRevision, nudge, region.code, region.declared, isAuthenticated, seasons, catalog, captures, i18n.language]);

  return nudge;
}

/**
 * L'URL publique de la planche d'une espèce, en JPEG.
 *
 * Le nom de fichier se déduit du nom scientifique — pas de table de
 * correspondance à tenir, pas d'aller-retour réseau pour l'obtenir. Le bucket
 * est public : une notification est reçue par un appareil qui n'a aucun jeton,
 * l'URL doit donc valoir pour n'importe qui.
 */
function imageEspece(scientificName: string): string {
  const slug = scientificName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/notification-images/${slug}.jpg`;
}
