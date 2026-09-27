import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { api, type ExpeditionSummary } from '@/lib/supabase/api';
import { useBackendAuth, useMutation, useQuery } from '@/lib/supabase/backend';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Press3D } from '@/components/ui/press-3d';
import { Pressable, Text, View } from 'react-native';
import { fermerLiveActivity, startExpeditionActivity } from '@/lib/onesignal';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

const WEEK_DAYS = 7;

export function ExpeditionBanner() {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const router = useRouter();
  const { theme } = useUnistyles();
  const { isAuthenticated } = useBackendAuth();
  const active = useQuery(api.expeditions.getActive, isAuthenticated ? {} : 'skip');
  const start = useMutation(api.expeditions.start);
  const end = useMutation(api.expeditions.end);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy || active === undefined) return;
    setBusy(true);
    try {
      if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
      if (active) {
        const id = await end();
        // La carte de l'écran verrouillé se ferme AVEC la sortie. Sans cet
        // appel, iOS la garde quatre heures de plus — et une expédition qu'on
        // vient de clore dans l'app qui reste affichée dehors se lit comme un
        // bug, pas comme une fonctionnalité.
        if (id) void fermerLiveActivity(String(id));
        if (id) router.push({ pathname: '/(app)/expedition/[id]', params: { id } });
      } else {
        const id = await start();
        // LA LIVE ACTIVITY SUIT L'EXPÉDITION, PAS L'INVERSE.
        //
        // On la démarre depuis l'app plutôt que par push-to-start : à cet
        // instant précis l'app EST au premier plan — c'est un appui sur un
        // bouton — donc `startDefault` suffit, et il ne dépend d'aucun jeton
        // qu'iOS pourrait ne pas avoir émis. Le push-to-start reste armé par
        // `setupDefault` pour ce que le serveur voudra pousser ensuite.
        if (process.env.EXPO_OS === 'ios' && id) startExpeditionActivity(String(id), t('expedition_start'));
      }
    } finally {
      setBusy(false);
    }
  };

  const running = Boolean(active);

  const ecoule = useEcoule(active?.startedAt ?? null);

  return (
    <View style={styles.wrapper}>
      {running ? (
        /* EN COURS : LA PAGE DEVIENT LA SESSION.
           Une sortie qui tourne n'est pas un état de bouton, c'est ce que le
           joueur est en train de FAIRE. Le compteur prend la place du titre,
           le chronomètre avance, et « Terminer » descend au rang d'action
           secondaire — on ne met pas en avant la fin de ce qu'on encourage. */
        <View style={styles.session}>
          <View style={styles.sessionPuce}>
            <View style={styles.pulse} />
            <Text style={styles.sessionEtat}>{t('expedition_running')}</Text>
            <Text style={styles.sessionTemps}>{ecoule}</Text>
          </View>

          <View style={styles.compteurs}>
            <View style={styles.compteur}>
              <Text style={styles.compteurValeur}>{active!.speciesCount}</Text>
              <Text style={styles.compteurLibelle}>
                {active!.speciesCount > 1 ? copy("profile_stat_species") : copy("ui_copy_055")}
              </Text>
            </View>
            <View style={styles.compteurSepare} />
            <View style={styles.compteur}>
              <Text style={[styles.compteurValeur, styles.compteurNeuf]}>
                {active!.newSpeciesCount}
              </Text>
              <Text style={styles.compteurLibelle}>
                {copy('unit_discovery', { count: active!.newSpeciesCount })}
              </Text>
            </View>
          </View>

          <Pressable
            accessibilityLabel={t('expedition_finish')}
            accessibilityRole="button"
            disabled={busy}
            onPress={toggle}
            style={({ pressed }) => [styles.terminer, pressed && styles.pressed]}
          >
            <SymbolView name="stop.fill" size={15} tintColor={theme.colors.muted} />
            <Text style={styles.terminerTexte}>{t('expedition_finish')}</Text>
          </Pressable>
        </View>
      ) : (
        /* AU REPOS : UNE SEULE CHOSE À FAIRE, ET ELLE SE VOIT.
           C'était une ligne de liste — même poids visuel qu'un réglage, sur une
           page qui n'existe que pour ça. Un bouton pleine largeur, doré,
           répond à la question « qu'est-ce que je fais ici ? » sans qu'on
           lise une phrase d'abord. */
        <Press3D
          accessibilityLabel={t('expedition_start')}
          borderRadius={20}
          disabled={busy || active === undefined}
          faceStyle={styles.demarrerFace}
          onPress={toggle}
          shadowColor="#a8761a"
          style={styles.demarrer}
        >
          <SymbolView name="figure.walk" size={19} tintColor="#33281a" />
          <Text style={styles.demarrerTexte}>
            {active === undefined ? t('expedition_loading') : t('expedition_start')}
          </Text>
        </Press3D>
      )}

    </View>
  );
}

/**
 * LE TEMPS ÉCOULÉ, RECALCULÉ CHAQUE SECONDE.
 *
 * Le chronomètre de la Live Activity est rendu par iOS depuis une date, sans
 * coût. Ici on est dans l'app : il faut un intervalle. Une seconde suffit —
 * on affiche des minutes, et un rafraîchissement plus fin ne changerait rien
 * à l'écran tout en réveillant le fil JS pour rien.
 */
function useEcoule(depuis: number | null): string {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (depuis === null) return;
    const tic = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(tic);
  }, [depuis]);
  if (depuis === null) return '';
  const secondes = Math.max(0, Math.floor((maintenant - depuis) / 1000));
  const h = Math.floor(secondes / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

const styles = StyleSheet.create((theme) => ({
  wrapper: {
    gap: 14,
  },

  // AU REPOS — un seul geste, et il occupe la largeur.
  demarrer: { width: '100%' },
  demarrerFace: {
    alignItems: 'center',
    backgroundColor: '#E3A93C',
    flexDirection: 'row',
    gap: 10,
    height: 62,
    justifyContent: 'center',
  },
  demarrerTexte: { color: '#33281a', fontFamily: theme.fonts.bold, fontSize: 17 },

  // EN COURS — la sortie prend la page.
  session: {
    backgroundColor: theme.colors.surfaceMuted,
    borderCurve: 'continuous',
    borderRadius: 22,
    gap: 16,
    padding: 20,
  },
  sessionPuce: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  sessionEtat: {
    color: theme.colors.muted,
    flex: 1,
    fontFamily: theme.fonts.bold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sessionTemps: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bold,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  compteurs: { alignItems: 'center', flexDirection: 'row' },
  compteur: { alignItems: 'center', flex: 1, gap: 2 },
  compteurSepare: { backgroundColor: theme.colors.border, height: 34, width: 1 },
  // Le nombre porte l'information ; le libellé n'est là que pour l'accorder.
  compteurValeur: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.brand,
    fontSize: 38,
    letterSpacing: -1,
    lineHeight: 42,
  },
  compteurNeuf: { color: '#a8761a' },
  compteurLibelle: { color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 13 },
  terminer: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  terminerTexte: { color: theme.colors.muted, fontFamily: theme.fonts.bold, fontSize: 14 },
  banner: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.surface,
  },
  bannerActive: {
    borderColor: theme.colors.primary,
  },
  pressed: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySoft,
  },
  iconActive: {
    backgroundColor: theme.colors.primary,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 16,
  },
  description: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13,
  },
  pulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
  },
  challenge: {
    minHeight: 120,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderRadius: 24,
    borderCurve: 'continuous',
    padding: 14,
    backgroundColor: theme.colors.surfaceMuted,
  },
  calendar: {
    width: 86,
    borderRadius: 17,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  calendarHeader: {
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  calendarHeaderText: {
    color: theme.colors.primaryText,
    fontFamily: theme.fonts.bold,
    fontSize: 11,
    letterSpacing: 1.8,
  },
  calendarBody: {
    height: 72,
    position: 'relative',
    backgroundColor: theme.colors.surface,
  },
  staticHalf: {
    height: 36,
    width: 86,
    position: 'absolute',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  staticTop: {
    top: 0,
  },
  staticBottom: {
    top: 36,
  },
  flipPage: {
    position: 'absolute',
    top: 36,
    width: 86,
    height: 36,
    transformOrigin: ['50%', '0%', 0.005],
  },
  flipFace: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  flipNumber: {
    height: 72,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 48,
    lineHeight: 68,
    textAlign: 'center',
  },
  topNumber: {
    transform: [{ translateY: 18 }],
  },
  bottomNumber: {
    transform: [{ translateY: -18 }],
  },
  flipNumberFront: {
    transform: [
      { translateY: -18 },
      { rotate: '180deg' },
      { scaleX: -1 },
      { scaleY: -1 },
    ],
  },
  flipNumberBack: {
    transform: [{ translateY: -18 }, { rotate: '180deg' }, { scaleX: -1 }],
  },
  foldLine: {
    position: 'absolute',
    top: 35.5,
    left: 0,
    right: 0,
    height: 1,
    zIndex: 30,
    backgroundColor: theme.colors.border,
  },
  challengeCopy: {
    flex: 1,
    gap: 3,
  },
  challengeLabel: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 16,
  },
  challengeValue: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
    fontSize: 14,
  },
  challengeHint: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 12,
    lineHeight: 16,
  },
}));

/**
 * LES JOURS DE SORTIE DE LA SEMAINE ÉCOULÉE.
 *
 * Le calcul vit ici parce que c'est ici qu'on connaît la règle — un jour
 * compte s'il porte une expédition TERMINÉE — mais son rendu appartient à
 * l'écran, qui a choisi sept pastilles plutôt que le calendrier feuilleté.
 * Séparer les deux évite de dupliquer la règle le jour où un autre écran
 * voudra l'afficher autrement.
 */
export function useSemaineExpedition(history: ExpeditionSummary[] | undefined): number {
  const debut = new Date();
  debut.setHours(0, 0, 0, 0);
  debut.setDate(debut.getDate() - (WEEK_DAYS - 1));
  return new Set(
    history
      ?.filter((expedition) => expedition.endedAt !== null && expedition.endedAt >= debut.getTime())
      .map((expedition) => new Date(expedition.endedAt!).toDateString()),
  ).size;
}
