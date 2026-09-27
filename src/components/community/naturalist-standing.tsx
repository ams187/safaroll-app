import { useTranslation as useUiTranslation } from 'react-i18next';
// Le niveau du joueur, enfin visible.
//
// Le calcul existait depuis le début — `getDeckProgress` — et n'était appelé
// par personne : une définition, zéro usage. Tout le barème était écrit, aucun
// écran ne le montrait.
//
// CE QUE LA CARTE DIT, ET DANS QUEL ORDRE
//
// Le titre d'abord, le chiffre ensuite. « Arpenteur des saisons » se retient et
// se raconte ; « niveau 11 » ne veut rien dire hors contexte. Le nombre reste,
// parce qu'il est comparable — c'est lui que le classement Maîtrise ordonne —
// mais il n'est pas ce qu'on lit en premier.
//
// La barre montre la marche EN COURS, pas la route entière. Un joueur qui voit
// « 3 % du chemin total » referme l'app ; « 240 XP jusqu'au palier suivant »
// est une soirée de sortie.

import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { getDeckProgress } from '@/lib/animals/progression';
import type { Capture } from '@/lib/supabase/api';

export function NaturalistStanding({ captures }: { captures: Capture[] | undefined }) {
  const { t: copy } = useUiTranslation();
  const progress = getDeckProgress(captures ?? []);
  // Bornée : un `progress` négatif ou supérieur à 1 sur une donnée aberrante
  // dessinerait une barre qui déborde de sa piste.
  const filled = Math.max(0, Math.min(1, progress.progress));

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.identity}>
          <Text style={styles.title}>{copy(progress.titleKey)}</Text>
          <Text style={styles.level}>{copy("ui_copy_053")}{' '}{progress.level}</Text>
        </View>
        <Text style={styles.xp}>{progress.totalXp.toLocaleString('fr-FR')} XP</Text>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${filled * 100}%` }]} />
      </View>
      <Text style={styles.toNext}>
        {progress.xpToNextLevel.toLocaleString('fr-FR')} {' '}{copy("ui_copy_054")}{' '}{progress.level + 1}
      </Text>

      {/* L'XP de fidélité mérite sa ligne : c'est la seule qui récompense le
          fait de RESSORTIR, et un joueur qui ne la voit pas nulle part ne sait
          pas qu'elle existe — donc ne revient pas pour elle. */}
      <View style={styles.stats}>
        <Stat label={copy("profile_stat_species")} value={progress.speciesCount} />
        <View style={styles.divider} />
        <Stat label={copy("profile_stat_captures")} value={progress.captureCount} />
        {progress.masteryXp > 0 ? (
          <>
            <View style={styles.divider} />
            <Stat label={copy("ui_copy_058")} value={progress.masteryXp} />
          </>
        ) : null}
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value.toLocaleString('fr-FR')}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderCurve: 'continuous',
    gap: 10,
    marginHorizontal: 20,
    padding: 18,
  },
  divider: {
    backgroundColor: theme.colors.border,
    width: 1,
  },
  fill: {
    backgroundColor: theme.colors.primary,
    borderRadius: 999,
    height: '100%',
  },
  head: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  identity: {
    flex: 1,
    gap: 2,
  },
  level: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 13,
  },
  stat: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
  },
  statLabel: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 11,
  },
  statValue: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  stats: {
    flexDirection: 'row',
    marginTop: 4,
  },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 20,
  },
  toNext: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 12,
  },
  // La piste garde la couleur du parchemin : la barre est de l'encre, et rien
  // ici ne porte de teinte — la couleur appartient aux animaux.
  track: {
    backgroundColor: theme.colors.primarySoft,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  xp: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
}));
