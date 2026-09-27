import { useTranslation as useUiTranslation } from 'react-i18next';
// Les distinctions, enfin dessinées.
//
// `badges.ts` calculait les douze états depuis le début, avec son propre test
// (`check:badges`), et aucun écran ne les affichait — une définition, zéro
// usage. Le seuil est écrit SUR la vignette verrouillée, pas dans un écran de
// détail : « 25 » dit l'objectif sans qu'on ait à toucher quoi que ce soit,
// et une distinction qu'il faut ouvrir pour comprendre ne motive personne.
//
// TROIS FAMILLES, TROIS LIGNES
//
//   ampleur   combien d'espèces en tout
//   flair     combien d'espèces rares — récompense l'œil
//   règne     combien dans une branche — récompense la spécialité
//
// Elles restent séparées à l'écran parce qu'elles récompensent trois joueurs
// différents : celui qui photographie tout, celui qui traque le rare, celui
// qui connaît ses oiseaux. Mélangées, on ne verrait qu'une grille d'icônes.

import { SymbolView } from 'expo-symbols';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { badgeStates, groupForClass, type BadgeFamily, type BadgeState } from '@/lib/animals/badges';
import type { Capture } from '@/lib/supabase/api';

const FAMILIES: { key: BadgeFamily; label: string }[] = [
  { key: 'ampleur', label: 'AMPLEUR' },
  { key: 'flair', label: 'FLAIR' },
  { key: 'regne', label: 'RÈGNES' },
];

export function BadgeGrid({ captures }: { captures: Capture[] | undefined }) {
  const { t: copy } = useUiTranslation();
  // Une espèce par ligne, pas une capture : dix photos du même moineau ne font
  // avancer aucune distinction. Même règle que l'XP, et elle doit le rester —
  // deux compteurs qui divergent se remarquent tout de suite.
  const states = badgeStates(
    (captures ?? [])
      .filter((capture) => capture.status === 'ready' || capture.status === 'needs_review')
      .map((capture) => ({
        // La capture porte sa classe GBIF, les distinctions parlent le
        // vocabulaire du catalogue. `groupForClass` fait le pont.
        group: groupForClass(capture.taxonomy?.class),
        rarity: capture.rarity,
        scientificName: capture.scientificName ?? capture.commonName,
      })),
  );
  const earned = states.filter((badge) => badge.earned).length;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>{copy("ui_copy_048")}</Text>
        <Text style={styles.count}>
          {earned} / {states.length}
        </Text>
      </View>

      {FAMILIES.map((family) => {
        const rows = states.filter((badge) => badge.family === family.key);
        if (rows.length === 0) return null;
        return (
          <View key={family.key} style={styles.family}>
            <Text style={styles.familyLabel}>{copy(`badge_family_${family.key}`)}</Text>
            <View style={styles.row}>
              {rows.map((badge) => (
                <Badge badge={badge} key={badge.key} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Badge({ badge }: { badge: BadgeState }) {
  const { t: copy } = useUiTranslation();
  return (
    <View style={styles.badge}>
      <View style={[styles.medal, badge.earned && styles.medalEarned]}>
        <SymbolView
          name={badge.icon as never}
          size={20}
          tintColor={badge.earned ? '#e6dfc4' : '#b5aa97'}
          weight="semibold"
        />
        {/* Le seuil ne s'affiche que verrouillé : une fois gagnée, la vignette
            n'a plus rien à demander, elle porte son nom. */}
        {!badge.earned ? <Text style={styles.threshold}>{badge.threshold}</Text> : null}
      </View>
      {/* La piste de progression ne vit que sur les verrouillées, et seulement
          si quelque chose a commencé : une barre à zéro sous chaque vignette
          d'un carnet vide dessine un mur, pas un chemin. */}
      {!badge.earned && badge.progress > 0 ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.min(1, badge.progress) * 100}%` }]} />
        </View>
      ) : null}
      <Text numberOfLines={2} style={[styles.label, badge.earned && styles.labelEarned]}>
        {copy(`badge_${badge.key}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: { alignItems: 'center', gap: 5, width: 74 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderCurve: 'continuous',
    gap: 14,
    marginHorizontal: 20,
    padding: 18,
  },
  count: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.display,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  eyebrow: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    letterSpacing: 1.4,
  },
  family: { gap: 8 },
  familyLabel: {
    color: theme.colors.faint,
    fontFamily: theme.fonts.bold,
    fontSize: 9,
    letterSpacing: 1.2,
  },
  fill: { backgroundColor: theme.colors.primary, borderRadius: 999, height: '100%' },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  label: {
    color: theme.colors.faint,
    fontFamily: theme.fonts.regular,
    fontSize: 10,
    textAlign: 'center',
  },
  labelEarned: { color: theme.colors.foreground, fontFamily: theme.fonts.medium },
  medal: {
    alignItems: 'center',
    backgroundColor: theme.colors.primarySoft,
    borderRadius: 999,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  // Gagnée, la vignette passe à l'encre : c'est le contraste le plus fort de
  // la palette, et il n'emprunte aucune couleur — elles appartiennent aux
  // animaux.
  medalEarned: { backgroundColor: theme.colors.primary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  threshold: {
    bottom: 3,
    color: theme.colors.muted,
    fontFamily: theme.fonts.bold,
    fontSize: 9,
    fontVariant: ['tabular-nums'],
    position: 'absolute',
  },
  track: {
    backgroundColor: theme.colors.primarySoft,
    borderRadius: 999,
    height: 3,
    overflow: 'hidden',
    width: 40,
  },
}));
