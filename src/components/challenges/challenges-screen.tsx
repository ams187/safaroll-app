import { uiLocaleTag } from '@/i18n/current';
// Quêtes.
//
// LA FORME VIENT DE LA RÉFÉRENCE, LE MONDE EST LE NÔTRE
//
// De haut en bas, exactement l'ordre de la maquette validée :
//
//   BANDEAU ILLUSTRÉ  le guépard suit sa carte vers un coffre : les objectifs
//                     deviennent une expédition plutôt qu'un tableau de bord.
//                     Le titre et l'échéance restent dans le calme à gauche.
//   CARTE FLOTTANTE   la carte blanche chevauche le bandeau. Ce recouvrement
//                     est ce qui donne la profondeur : sans lui, deux bandes
//                     empilées et rien qui dise laquelle est devant.
//   OBJECTIFS         une carte, des rangées à filets — et AUCUNE n'est une
//                     espèce nommée. « Trouve la Chouette hulotte » est une
//                     loterie : la chouette décide, pas le joueur. « Capture
//                     5 oiseaux, peu importe lesquels » se gagne par n'importe
//                     quelle sortie. Chaque rangée porte sa barre et son XP,
//                     et l'XP est réelle (`objectives.ts`, recalculée).
//   SUCCÈS            filtre à trois positions, puis la grille des écussons.
//                     Une seule fois : une section « collections » les montrait
//                     déjà, groupés par famille, juste au-dessus. Deux vitrines
//                     pour douze objets, c'est douze objets qu'on ne regarde
//                     plus — la grille filtrable dit la même chose et laisse
//                     choisir l'angle.
//
// CE QUI A ÉTÉ RETIRÉ, ET POURQUOI
//
// « À revoir demain » listait des espèces à recapturer pour l'étoile suivante.
// Même problème que les chasses nommées : c'est une consigne sur un animal
// précis. La fidélité se paie toute seule — revoir une espèce un autre jour
// rapporte son XP de maîtrise au moment de la capture, sans qu'un écran le
// demande. Le barème continue de tourner ; seule la liste de courses a disparu.
//
// CE QUI N'EST PAS REPRIS DE LA RÉFÉRENCE, ET POURQUOI
//
// Les quêtes QUOTIDIENNES à réinitialisation. Il n'y a pas de tâche journalière
// ici : la saison change au mois, la maîtrise au jour d'observation. Inventer
// un compte à rebours de 12 h obligerait à inventer les tâches qui vont avec,
// et une quête qu'on ne peut pas honorer un soir de pluie est une promesse en
// l'air. L'échéance affichée est vraie — les espèces visibles changent
// réellement à la fin du mois.
//
// Les boutons « NUDGE » et « GIFT » non plus : ils supposent une économie de
// jetons que cette app n'a pas.

import { BadgeVitrine } from '@/components/challenges/badge-vitrine';
import { QuestBadge } from '@/components/challenges/quest-badge';
import { FLOATING_SIZE, useBadgeMorph, type BadgeRef } from '@/components/challenges/use-badge-morph';
import { requestExpandableCamera } from '@/components/navigation/expandable-camera-state';
import SegmentedControl from '@/components/ui/organisms/segmented-control';
import { badgeArt } from '@/lib/animals/badge-art';
import { badgeStates, groupForClass, type BadgeState } from '@/lib/animals/badges';
import { monthlyObjectives, type ObjectiveState } from '@/lib/animals/objectives';
import { regionLabel } from '@/lib/animals/region';
import { useRegion } from '@/lib/animals/use-region';
import { SAFARI } from '@/lib/safari-palette';
import { daysLeftInMonth } from '@/lib/animals/season-clock';
import { api } from '@/lib/supabase/api';
import { useBackendAuth, useQuery } from '@/lib/supabase/backend';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { memo, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/** Le mois en toutes lettres. Une table plutôt qu'`Intl` : Hermes ne garantit
 *  pas les données de locale, et un mois affiché en anglais dans une phrase
 *  française se remarque tout de suite. */
// Les mois portent une CLÉ : `MONTHS` est au niveau module, hors de `t()`.
const MONTHS = [
  'month_1', 'month_2', 'month_3', 'month_4', 'month_5', 'month_6',
  'month_7', 'month_8', 'month_9', 'month_10', 'month_11', 'month_12',
];

const FILTERS = ['all', 'earned', 'todo'] as const;
const FILTER_KEY: Record<Filter, string> = {
  all: 'quest_filter_all',
  earned: 'quest_filter_earned',
  todo: 'quest_filter_todo',
};
type Filter = (typeof FILTERS)[number];


export const ChallengesScreen = memo(function ChallengesScreen({
  bottomInset = 0,
  onRegionPress,
}: { bottomInset?: number; onRegionPress?: () => void } = {}) {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { isAuthenticated } = useBackendAuth();
  const captures = useQuery(api.animals.listCaptures, isAuthenticated ? {} : 'skip');
  const region = useRegion();
  const loading = captures === undefined;
  const [filter, setFilter] = useState<Filter>('all');
  const morph = useBadgeMorph<BadgeState>();
  // Figé au montage : un `new Date()` nu rendrait une référence neuve à chaque
  // rendu et relancerait tous les memos qui en dépendent.
  const [now] = useState(() => new Date());
  const daysLeft = daysLeftInMonth(now);
  const month = MONTHS[now.getMonth()];

  const badges = useMemo(
    () =>
      badgeStates(
        (captures ?? [])
          .filter((capture) => capture.status === 'ready' || capture.status === 'needs_review')
          .map((capture) => ({
            // La capture porte sa classe GBIF, les distinctions parlent le
            // vocabulaire du catalogue. `groupForClass` fait le pont.
            group: groupForClass(capture.taxonomy?.class),
            rarity: capture.rarity,
            scientificName: capture.scientificName ?? capture.commonName,
          })),
      ).map((badge) => ({ ...badge, label: t(`badge_${badge.key}`) })),
    [captures, t],
  );
  const earned = badges.filter((badge) => badge.earned).length;
  const objectives = useMemo(() => monthlyObjectives(captures ?? [], now), [captures, now]);
  const doneCount = objectives.filter((item) => item.done).length;

  /**
   * Ce que TU as fait ce mois-ci. Trois nombres exacts, dérivés des seules
   * captures — pas d'estimation, pas de dénominateur emprunté à une requête
   * tronquée.
   *
   * « Nouvelle espèce » se lit sur tout l'historique : une espèce revue en août
   * mais découverte en mars ne compte pas. C'est la même règle que dans
   * `objectives.ts`, et les deux doivent rester d'accord.
   */
  const thisMonth = useMemo(() => {
    const usable = (captures ?? []).filter(
      (capture) =>
        (capture.status === 'ready' || capture.status === 'needs_review') &&
        capture.capturedAt !== undefined &&
        !!(capture.scientificName ?? capture.commonName),
    );
    const firstSeen = new Map<string, number>();
    for (const capture of usable) {
      const key = (capture.scientificName ?? capture.commonName)!;
      if (capture.capturedAt! < (firstSeen.get(key) ?? Infinity)) firstSeen.set(key, capture.capturedAt!);
    }
    const sameMonth = (at: number) => {
      const date = new Date(at);
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    };
    const mine = usable.filter((capture) => sameMonth(capture.capturedAt!));
    const fresh = new Set(
      mine
        .filter((capture) => firstSeen.get((capture.scientificName ?? capture.commonName)!) === capture.capturedAt)
        .map((capture) => capture.scientificName ?? capture.commonName),
    );
    return {
      captures: mine.length,
      species: fresh.size,
      xp: objectives.filter((item) => item.done).reduce((sum, item) => sum + item.xp, 0),
    };
  }, [captures, now, objectives]);
  const shown = badges.filter((badge) =>
    filter === 'all' ? true : filter === 'earned' ? badge.earned : !badge.earned,
  );


  return (
    <>
      {/* `flex: 1` N'EST PAS DÉCORATIF ICI.
          Sans lui, un `ScrollView` prend la hauteur de son CONTENU : sa zone
          visible et sa zone défilante font alors exactement la même taille, il
          n'y a rien à faire défiler, et la page se contente de rebondir à
          chaque tirage. C'est le parent qui doit le borner — dans une feuille
          du système, ce parent existe et fait la hauteur de la feuille. */}
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset + 40 }}
        showsVerticalScrollIndicator={false}
        style={styles.grow}
      >
      {/* LE BANDEAU. Il déborde sous la carte qui suit — d'où le `paddingBottom`
          généreux : c'est ce que la carte recouvre. */}
      <View style={styles.banner}>
        <Image
          contentFit="cover"
          source={require('../../../assets/challenges/quests-treasure-hero.webp')}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.bannerRow}>
          <View style={styles.grow}>
            <Text style={[styles.bannerTitle, { color: SAFARI.aube.on }]}>{copy("ui_copy_097")}</Text>
            <Pressable
              hitSlop={8}
              onPress={onRegionPress ?? (() => router.push('/profile'))}
              style={({ pressed }) => [styles.bannerMetaRow, pressed && styles.pressed]}
            >
              <SymbolView name="clock.fill" size={12} tintColor={SAFARI.aube.on} />
              <Text style={[styles.bannerMeta, { color: SAFARI.aube.on }]}>
                {daysLeft} {' '}{copy("ui_copy_098")}{daysLeft > 1 ? 's' : ''} · {regionLabel(region.code)}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {/* LA CARTE FLOTTANTE — et son chiffre, qui a dû changer de source.
            Elle affichait « 0/34 espèces visibles ce mois-ci ». Le
            dénominateur n'était pas un fait : `seasons.inSeason` se termine par
            `.slice(0, limit ?? 12)`, et l'app demande 40. Le « 34 » n'était donc
            que la troncature d'affichage, jamais le nombre d'espèces trouvables
            — qui se compte en centaines. Une barre qui n'atteint jamais son
            bout parce que son bout est faux, c'est pire que pas de barre.

            Les trois nombres d'ici sont exacts et se dérivent des captures
            seules : ce que TU as fait ce mois-ci. Rien à croire sur parole. */}
        <View style={[styles.card, styles.floating]}>
          <Text style={styles.floatTitle}>
            {loading ? t('quest_loading') : t('quest_your_month', { month: t(month) })}
          </Text>
          <View style={styles.monthStats}>
            <MonthStat label={t('quest_stat_captures', { count: thisMonth.captures })} value={thisMonth.captures} />
            <View style={styles.monthDivider} />
            <MonthStat
              label={t('quest_stat_species', { count: thisMonth.species })}
              value={thisMonth.species}
            />
            <View style={styles.monthDivider} />
            <MonthStat label={t('quest_stat_xp')} value={thisMonth.xp} />
          </View>
          {/* « Repartent à zéro » se lisait comme une perte. Rien ne se perd :
              l'XP d'un objectif accompli est acquise pour toujours, et le même
              objectif se REGAGNE le mois suivant. La phrase doit donc annoncer
              une occasion, pas une échéance. */}
          <Text style={styles.floatFoot}>
            {copy("ui_copy_099")}{daysLeft} {' '}{copy("ui_copy_098")}{daysLeft > 1 ? 's' : ''}{copy("ui_copy_100")}</Text>
        </View>

        <SectionLabel right={`${doneCount}/${objectives.length}`} title={t('quest_section_objectives')} />
        <View style={styles.card}>
          {objectives.map((objective, index) => (
            <View key={objective.key}>
              {index > 0 ? <View style={styles.rowDivider} /> : null}
              <ObjectiveRow index={index} objective={objective} onPress={requestExpandableCamera} />
            </View>
          ))}
        </View>

        <SectionLabel right={`${earned}/${badges.length}`} title={t('quest_section_badges')} />
        <SegmentedControl
          activeSegmentBackgroundColor={theme.colors.surface}
          borderRadius={999}
          currentIndex={FILTERS.indexOf(filter)}
          dividerColor={theme.colors.border}
          onChange={(index) => setFilter(FILTERS[index])}
          segmentedControlBackgroundColor={theme.colors.surfaceMuted}
          width={width - theme.gap(5)}
        >
          {FILTERS.map((item) => (
            <Text key={item} style={[styles.segmentText, filter === item && styles.segmentTextOn]}>
              {t(FILTER_KEY[item])}
            </Text>
          ))}
        </SegmentedControl>

        <View style={styles.grid}>
          {shown.map((badge, index) => (
            <BadgeCell badge={badge} index={index} key={badge.key} onOpen={morph.ouvrir} />
          ))}
        </View>
        {shown.length === 0 ? (
          <Empty
            copy={
              filter === 'earned'
                ? t('quest_empty_earned')
                : t('quest_empty_todo')
            }
            icon="rosette"
          />
        ) : null}
        </View>
      </ScrollView>

      {/* Hors du défilement : la vitrine recouvre TOUT l'écran, bandeau compris.
          Née dans une case de la grille, elle aurait été rognée par le
          conteneur qui défile. */}
      <BadgeVitrine
        animation={morph.animation}
        // La `key` remonte la vitrine à chaque ouverture : sans elle, la page
        // de départ resterait figée sur le premier écusson touché de la session.
        key={morph.selection?.key ?? 'aucune'}
        badges={badges}
        onClose={morph.fermer}
        origine={morph.origine}
        selection={morph.selection}
      />
    </>
  );
});

/**
 * Un objectif du mois.
 *
 * Accompli, la rangée ne disparaît pas : elle reste, cochée, barre pleine.
 * C'est la moitié du plaisir — une liste qui efface ce qu'on a fait ne montre
 * jamais que du travail restant.
 */
function ObjectiveRow({
  index,
  objective,
  onPress,
}: {
  index: number;
  objective: ObjectiveState;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const ratio = objective.count / objective.target;

  return (
    <Animated.View entering={FadeInDown.delay(index * 40).duration(240)}>
      <Pressable
        disabled={objective.done}
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={[styles.thumb, objective.done && styles.thumbDone]}>
          <SymbolView
            name={(objective.done ? 'checkmark' : objective.icon) as SFSymbol}
            size={20}
            tintColor={objective.done ? SAFARI.canopee.on : theme.colors.muted}
            weight={objective.done ? 'bold' : 'regular'}
          />
        </View>

        <View style={styles.rowBody}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {t(`objective_${objective.key}`)}
          </Text>
          <View style={styles.smallTrack}>
            <View
              style={[
                styles.smallFill,
                {
                  width: `${Math.max(ratio * 100, 5)}%`,
                  backgroundColor: objective.done ? SAFARI.canopee.to : SAFARI.aube.to,
                },
              ]}
            />
          </View>
          <Text style={styles.rowSub}>
            {objective.count}/{objective.target}
          </Text>
        </View>

        <View style={[styles.xpPill, objective.done && styles.xpPillDone]}>
          <Text style={[styles.xpValue, objective.done && styles.xpTextDone]}>+{objective.xp}</Text>
          <Text style={[styles.xpUnit, objective.done && styles.xpTextDone]}>XP</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function BadgeCell({
  badge,
  index,
  onOpen,
}: {
  badge: BadgeState;
  index: number;
  onOpen: (ref: BadgeRef, badge: BadgeState) => void;
}) {
  const { t } = useTranslation();
  // La référence porte sur l'ÉCUSSON seul, pas sur la case : c'est lui que le
  // clone doit recouvrir, et la case inclut le nom et le pourcentage sous lui.
  const art = useRef<View>(null);

  return (
    <Animated.View entering={FadeInDown.delay(index * 30).duration(240)} style={styles.cell}>
      <Pressable
        onPress={() => {
          void Haptics.selectionAsync().catch(() => undefined);
          onOpen(art, badge);
        }}
        ref={art}
        style={({ pressed }) => (pressed ? styles.pressedBadge : null)}
      >
        <QuestBadge
          art={badgeArt(badge.key)}
          earned={badge.earned}
          label={String(badge.threshold)}
          size={FLOATING_SIZE}
        />
      </Pressable>
      <Text numberOfLines={2} style={styles.cellTitle}>
        {badge.label}
      </Text>
      <Text style={styles.cellState}>
        {badge.earned ? t('quest_badge_earned') : `${Math.round(badge.progress * 100)} %`}
      </Text>
    </Animated.View>
  );
}

/** Un des trois nombres du mois. Le chiffre en display, l'unité sous lui. */
function MonthStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.monthStat}>
      <Text adjustsFontSizeToFit numberOfLines={1} style={styles.monthValue}>
        {value.toLocaleString(uiLocaleTag())}
      </Text>
      <Text numberOfLines={2} style={styles.monthLabel}>
        {label}
      </Text>
    </View>
  );
}

function SectionLabel({ right, title }: { right?: string; title: string }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.grow} />
      {right ? <Text style={styles.sectionRight}>{right}</Text> : null}
    </View>
  );
}

function Empty({ copy, icon }: { copy: string; icon: SFSymbol }) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.empty}>
      <SymbolView name={icon} size={28} tintColor={theme.colors.faint} />
      <Text style={styles.emptyCopy}>{copy}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },

  banner: {
    aspectRatio: 2,
    justifyContent: 'center',
    paddingTop: theme.gap(2.5),
    // Ce que la carte flottante vient recouvrir.
    paddingBottom: theme.gap(6),
    paddingHorizontal: theme.gap(2.5),
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5) },
  bannerTitle: {
    fontFamily: theme.fonts.display,
    fontSize: 38,
    letterSpacing: -0.8,
    lineHeight: 42,
  },
  bannerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  bannerMeta: { fontFamily: theme.fonts.bold, fontSize: 13, opacity: 0.85 },

  body: {
    paddingHorizontal: theme.gap(2.5),
    marginTop: -theme.gap(4),
    gap: theme.gap(1.5),
  },

  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderCurve: 'continuous',
    padding: theme.gap(2.25),
    shadowColor: '#2b2418',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 2,
  },
  floating: { gap: theme.gap(1.25) },
  floatTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 17,
  },
  monthStats: { flexDirection: 'row', alignItems: 'center' },
  monthStat: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 2 },
  monthValue: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 26,
  },
  monthLabel: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 11,
    textAlign: 'center',
  },
  monthDivider: {
    width: 1,
    height: 30,
    backgroundColor: theme.colors.border,
  },
  floatFoot: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 12,
  },

  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.gap(1.5),
    paddingHorizontal: theme.gap(0.5),
  },
  sectionTitle: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bold,
    fontSize: 12,
    letterSpacing: 1.2,
  },
  sectionRight: {
    color: theme.colors.faint,
    fontFamily: theme.fonts.bold,
    fontSize: 12,
    letterSpacing: 1.2,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1.5),
    paddingVertical: theme.gap(1.25),
  },
  rowDivider: {
    height: 1,
    marginLeft: 48 + theme.gap(1.5),
    backgroundColor: theme.colors.border,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbDone: { backgroundColor: SAFARI.canopee.wash },
  thumbImage: { width: '80%', height: '80%' },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 15.5,
  },
  rowSub: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 12,
  },
  smallTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surfaceMuted,
    overflow: 'hidden',
  },
  smallFill: { height: '100%', borderRadius: 3 },

  xpPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: SAFARI.savane.wash,
  },
  xpValue: {
    color: SAFARI.savane.on,
    fontFamily: theme.fonts.display,
    fontSize: 14,
  },
  xpUnit: {
    color: SAFARI.savane.on,
    opacity: 0.6,
    fontFamily: theme.fonts.bold,
    fontSize: 10,
  },
  // Accomplie, la pastille passe au vert canopée : la récompense est tombée,
  // elle n'est plus une promesse.
  xpPillDone: { backgroundColor: SAFARI.canopee.wash },
  xpTextDone: { color: SAFARI.canopee.on },

  segmentText: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 14,
  },
  segmentTextOn: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: theme.gap(2.5),
  },
  pressedBadge: { opacity: 0.75, transform: [{ scale: 0.94 }] },
  cell: {
    width: '33.333%',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  cellTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 12.5,
    // DEUX LIGNES TOUJOURS RÉSERVÉES, MÊME QUAND LE NOM TIENT SUR UNE.
    //
    // Sur trois colonnes, « Collection » ou « Ornithologue » tiennent sur une
    // ligne, « Première trouvaille » et « Chasseur de raretés » en prennent
    // deux. Le nom poussait donc l'état (« Obtenue », « 40 % ») d'une ligne
    // vers le bas sur ces cases-là, et la rangée n'avait plus de ligne de base
    // commune. `lineHeight` est posé explicitement : sans lui la hauteur
    // réservée dépendrait de la métrique de la police, donc du système.
    lineHeight: 16,
    minHeight: 32,
    textAlign: 'center',
  },
  cellState: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 11,
  },

  empty: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: theme.gap(4),
    paddingHorizontal: theme.gap(2),
  },
  emptyCopy: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
  },
}));
