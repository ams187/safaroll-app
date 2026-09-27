import { useTranslation as useUiTranslation } from 'react-i18next';
// Le Leaderboard : cinq classements, et la ligne qui compte vraiment.
//
// SIX MESURES, ET LA SEMAINE EN PREMIER
//
// Un classement unique ne nomme que ses vingt premiers ; tous les autres sont
// anonymes, et un joueur anonyme ne revient pas. Six mesures donnent à chacun
// un endroit où exister — et celle qui s'ouvre en premier est la SEMAINE,
// parce que c'est la seule qu'un nouveau venu peut gagner. L'atlas récompense
// des mois de collection ; lundi matin, la semaine remet tout le monde à zéro.
//
// Le podium reste : c'est le bloc leaderboard-animation-reanimated déjà intégré
// à l'app, pas un emprunt. Les barres montent en spring, décalées, et le compte
// se révèle en fin de course.
//
// LE MOTEUR DU RETOUR N'EST PAS LE CLASSEMENT
//
// C'est la ligne ancrée en bas, qui ne quitte jamais l'écran. Elle ne dit pas
// « 3 128ᵉ » — un rang isolé décourage — mais la marche suivante : « 4 espèces
// pour passer 100ᵉ ». Et quand la marche est infranchissable, elle se tait

import { api, type RegisterEntry } from '@/lib/supabase/api';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { PodiumStage } from './podium-stage';
import { RegisterFilter } from './register-filter';
import { useBackendAuth, useQuery } from '@/lib/supabase/backend';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

/** Où j'en étais à ma dernière visite — par période, pour le ▲/▼. */
const store = createMMKV({ id: 'community-ranks' });

/**
 * Les cinq mesures du Registre.
 *
 * Un classement unique ne nomme que ses vingt premiers ; tous les autres sont
 * anonymes, et un joueur anonyme ne revient pas. Cinq mesures indépendantes
 * donnent à chacun un endroit où exister — celui qui n'a que quarante captures
 * peut mener aux TROUVAILLES, et la SAISON remet tout le monde à zéro le 1er du
 * mois, donc un nouveau venu n'affronte pas deux ans d'avance.
 *
 * `unit` est ce qu'on compte, au singulier : la ligne ancrée dit « 4 espèces
 * pour passer 2ᵉ », pas « 4 points ».
 */
const BOARDS = [
  // La semaine EN PREMIER, et ce n'est pas un détail d'ordre.
  //
  // C'est la seule fenêtre qu'un nouveau venu peut gagner. L'atlas récompense
  // des mois de collection : celui qui arrive aujourd'hui n'y rattrapera
  // personne, et un joueur qui ne peut pas gagner ne joue pas. Lundi matin,
  // tout le monde repart à zéro — c'est ce qui fait revenir.
  { key: 'semaine', label: 'Cette semaine', legend: 'Espèces vues depuis lundi. Tout le monde repart à zéro.', unit: 'espèce' },
  { key: 'atlas', label: 'Atlas', legend: 'Espèces distinctes de ta collection.', unit: 'espèce' },
  { key: 'saison', label: 'Saison', legend: 'Espèces vues depuis le 1er du mois.', unit: 'espèce' },
  { key: 'trouvailles', label: 'Trouvailles', legend: 'Espèces très rares ou mieux.', unit: 'trouvaille' },
  { key: 'captures', label: 'Captures', legend: 'Toutes tes photos validées.', unit: 'capture' },
  { key: 'maitrise', label: 'Maîtrise', legend: 'Chaque espèce pesée par sa rareté.', unit: 'point' },
] as const;
type BoardKey = (typeof BOARDS)[number]['key'];

/** Contre qui l'on se mesure. Être 3 128e sur Terre ne motive personne ; etre
 *  2e sur cinq amis, si. */
const SCOPES = [
  { key: 'global', label: 'Tout le monde' },
  { key: 'friends', label: 'Mon cercle' },
] as const;
type ScopeKey = (typeof SCOPES)[number]['key'];
const PODIUM_AVATAR = 52;

export function CommunityScreen() {
  const { t: copy } = useUiTranslation();
  const boards = BOARDS.map((item) => ({
    ...item,
    label: copy(`community_board_${item.key}`),
    legend: copy(`community_legend_${item.key}`),
  }));
  const scopes = SCOPES.map((item) => ({ ...item, label: copy(`community_scope_${item.key}`) }));
  const router = useRouter();
  const { isAuthenticated } = useBackendAuth();
  const { width } = useWindowDimensions();
  const [board, setBoard] = useState<BoardKey>('semaine');
  // Global ou cercle. Être 3 128ᵉ sur la Terre ne motive personne ; être 2ᵉ sur
  // cinq amis, si.
  const [scope, setScope] = useState<ScopeKey>('global');
  const entries = useQuery(api.community.register, isAuthenticated ? { board, scope } : 'skip');
  const active = boards.find((item) => item.key === board)!;

  // Ta ligne vit DANS la liste, à sa place, et se répète ancrée en bas — les
  // deux ne se contredisent jamais puisqu'elles lisent la même donnée.
  const rows = entries ?? [];
  const podium = rows.filter((entry) => entry.rank <= 3).slice(0, 3);
  // Ta ligne vit DANS la liste, à sa place. Elle flottait au-dessus avant, ce
  // qui la dédoublait dès que tu étais sur le podium — deux « toi » à l'écran.
  const rest = rows.filter((entry) => entry.rank > 3);
  const mine = rows.find((entry) => entry.me);

  // Le delta se lit contre la visite PRÉCÉDENTE : la référence est figée au
  // montage (MMKV est synchrone), puis le rang courant est persisté à part —
  // comme ça le ▲2 ne s'efface pas sous tes yeux quand la sauvegarde passe.
  const [baseline] = useState(() =>
    Object.fromEntries(BOARDS.map((item) => [item.key, store.getNumber(`rank:${item.key}`)])),
  );
  const myRank = mine?.rank;
  useEffect(() => {
    if (myRank !== undefined) store.set(`rank:${board}`, myRank);
  }, [board, myRank]);
  const delta = baseline[board] === undefined || !mine ? null : baseline[board]! - mine.rank;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Le titre et le filtre sur la MÊME ligne : le filtre n'est pas une
            étape avant la page, c'est une propriété du titre — « Le Registre,
            vu par l'atlas ». Sur sa propre ligne il devenait un contrôle de
            plus à franchir avant le podium. */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>{copy("ui_copy_052")}</Text>
            <Text numberOfLines={1} style={styles.title}>
              Leaderboard
            </Text>
          </View>
          <RegisterFilter
            board={board}
            boards={boards}
            onBoard={(key) => {
              setBoard(key);
              void Haptics.selectionAsync().catch(() => undefined);
            }}
            onScope={(key) => {
              setScope(key);
              void Haptics.selectionAsync().catch(() => undefined);
            }}
            scope={scope}
            scopes={scopes}
          />
        </View>

        <Text style={styles.legend}>{active.legend}</Text>

        {entries === undefined ? null : rows.length === 0 ? (
          <View style={styles.empty}>
            <SymbolView name="binoculars.fill" size={40} tintColor="#b5aa97" />
            <Text style={styles.emptyText}>
              {scope === 'friends'
                ? copy('community_empty_friends')
                : board === 'saison'
                ? copy('community_empty_month')
                  : copy('community_empty')}
            </Text>
          </View>
        ) : (
          <>
            {/* 2-1-3 : l'or au centre, comme tout podium. `key` sur la mesure
                pour que les barres remontent au changement d'onglet. */}
            {/* La scène : nuit de savane, rayons, marches 3:2:1. `key` sur la
                mesure pour que le podium remonte au changement d'onglet. */}
            <PodiumStage
              entries={podium}
              key={board}
              onOpen={(entry) => router.push(`/player/${entry.userId}`)}
              unit={active.unit}
              width={width}
            />

            <View style={styles.list}>
              {rest.map((entry, index) => (
              <Animated.View
                entering={FadeInDown.delay(Math.min(index, 12) * 24).duration(240)}
                key={entry.userId}
              >
                <Row
                  delta={entry.me ? delta : undefined}
                  entry={entry}
                  onPress={() => router.push(`/player/${entry.userId}`)}
                  unit={active.unit}
                />
                </Animated.View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

    </View>
  );
}
function Row({
  delta,
  entry,
  onPress,
  unit,
}: {
  delta?: number | null;
  entry: RegisterEntry;
  onPress: () => void;
  unit: string;
}) {
  const { t: copy } = useUiTranslation();
  const me = entry.me;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.row, me && styles.rowMe]}>
      <Text style={[styles.rank, me && styles.inkText]}>{entry.rank}</Text>
      <PlayerAvatar
        name={entry.displayName}
        premium={entry.isPremium}
        size={34}
        url={entry.avatarUrl}
      />
      <Text numberOfLines={1} style={[styles.rowName, me && styles.inkText]}>
        {me ? copy('community_you') : entry.displayName}
      </Text>
      {me && delta != null && delta !== 0 ? (
        <Text style={[styles.delta, delta > 0 ? styles.deltaUp : styles.deltaDown]}>
          {delta > 0 ? `▲${delta}` : `▼${-delta}`}
        </Text>
      ) : null}
      <View style={styles.countCell}>
        <Text style={[styles.rowCount, me && styles.inkText]}>{entry.score}</Text>
        <Text style={[styles.rowUnit, me && styles.inkText]}>
          {copy(`community_unit_${unit === 'espèce' ? 'species' : unit === 'trouvaille' ? 'find' : unit === 'capture' ? 'capture' : 'point'}`, { count: entry.score })}
        </Text>
      </View>
    </Pressable>
  );
}

/** Avatar, ou l'initiale sur parchemin quand le joueur n'en a pas. */
const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
    paddingTop: 4,
    gap: 20,
  },
  header: {
    flexDirection: 'row',
    // Le menu s'aligne sur la ligne de base du titre, pas au centre du bloc :
    // l'exergue au-dessus décalerait le bouton vers le haut.
    alignItems: 'flex-end',
    gap: 12,
    paddingHorizontal: 20,
  },
  headerText: { flex: 1, gap: 4 },
  eyebrow: {
    color: theme.colors.primaryText,
    fontFamily: theme.fonts.bold,
    fontSize: 12,
    letterSpacing: 1.4,
  },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 40,
    letterSpacing: -0.8,
    lineHeight: 42,
  },
  legend: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13,
    paddingHorizontal: 20,
  },
  rowUnit: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 11,
  },
  podium: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  place: {
    alignItems: 'center',
    gap: 6,
  },
  bar: {
    marginTop: -PODIUM_AVATAR / 2,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 10,
  },
  barCount: {
    color: '#2b2418',
    fontFamily: theme.fonts.display,
    fontSize: 24,
    fontVariant: ['tabular-nums'],
  },
  placeName: {
    maxWidth: 104,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 13,
  },
  placeRank: {
    marginTop: -4,
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 11,
  },
  list: {
    paddingHorizontal: 20,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  // Ta ligne : encre pleine, à sa place dans la liste. Le contraste suffit à
  // la retrouver d'un coup d'œil sans la sortir du classement.
  rowMe: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  inkText: {
    color: theme.colors.onPrimary,
  },
  rank: {
    minWidth: 26,
    color: theme.colors.muted,
    fontFamily: theme.fonts.display,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  rowName: {
    flex: 1,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 15,
  },
  delta: {
    fontFamily: theme.fonts.bold,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  deltaUp: {
    color: '#8fd1a8',
  },
  deltaDown: {
    color: '#e0a58e',
  },
  countCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rowCount: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  avatar: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: 14,
    paddingVertical: 48,
    paddingHorizontal: 40,
  },
  emptyText: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
}));
