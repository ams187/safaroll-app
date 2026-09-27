import { monthlyObjectives } from '@/lib/animals/objectives';
import {
  notifyAtlasMilestone,
  scheduleObjectiveReminder,
  useNotificationRevision,
} from '@/lib/notifications';
import { setInAppTriggers, syncEngagementTags } from '@/lib/onesignal';
import { api } from '@/lib/supabase/api';
import { useBackendAuth, useQuery } from '@/lib/supabase/backend';
import { useEffect, useMemo } from 'react';

export function useProgressNotifications() {
  const { isAuthenticated, userId } = useBackendAuth();
  const captures = useQuery(api.animals.listCaptures, isAuthenticated ? {} : 'skip');
  const notificationRevision = useNotificationRevision();
  const progress = useMemo(() => {
    if (!captures) return null;
    const objective = monthlyObjectives(captures)
      .filter((item) => !item.done)
      .map((item) => item.target - item.count)
      .filter((remaining) => remaining > 0 && remaining <= 2)
      .sort((a, b) => a - b)[0];
    const species = new Set(
      captures
        .filter((capture) => capture.status === 'ready' || capture.status === 'needs_review')
        .map((capture) => capture.scientificName ?? capture.commonName)
        .filter(Boolean),
    ).size;
    const lastCaptureAt = captures.reduce((max, capture) => Math.max(max, capture.capturedAt), 0);
    return { lastCaptureAt, objective: objective ?? 0, species };
  }, [captures]);

  useEffect(() => {
    if (!progress || !userId) return;
    // La progression, résumée en faits pour les Journeys : la relance
    // « l'atlas t'attend » lit `last_capture_at`, la « ligne d'arrivée » lit
    // `objective_remaining`. Calcul local, le serveur ne voit que le résultat.
    syncEngagementTags({
      atlas_tier: Math.floor(progress.species / 50) * 50,
      last_capture_at: progress.lastCaptureAt,
      objective_remaining: progress.objective,
      species_count: progress.species,
    });
    // LES MÊMES FAITS, EN DÉCLENCHEURS DE SESSION.
    //
    // Un tag sert au ciblage d'un envoi ; un déclencheur sert à parler PENDANT
    // qu'on joue. Ce sont deux moments différents, et le second n'a le droit
    // d'exister que s'il dit quelque chose que l'écran ne montre pas — « il te
    // manque une seule prise pour boucler ton objectif » n'est affiché nulle
    // part.
    //
    // On pose des FAITS, pas des décisions : le tableau de bord choisit s'il y
    // a un message à en tirer. Coder ce choix ici obligerait à publier une
    // version de l'app pour changer d'avis sur une phrase.
    setInAppTriggers({
      objective_remaining: String(progress.objective),
      species_count: String(progress.species),
      // Les jours depuis la dernière capture : un message d'encouragement n'a
      // pas le même sens le lendemain d'une sortie et trois semaines après.
      days_since_capture: String(
        progress.lastCaptureAt
          ? Math.floor((Date.now() - progress.lastCaptureAt) / 86_400_000)
          : 999,
      ),
    });
    void scheduleObjectiveReminder(progress.objective);
    void notifyAtlasMilestone(userId, progress.species);
  }, [notificationRevision, progress, userId]);
}
