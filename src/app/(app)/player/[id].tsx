import { useTranslation as useUiTranslation } from 'react-i18next';
// Le profil d'un autre joueur : sa vitrine, jamais ses données.
//
// Ce que l'écran REÇOIT trace la frontière de vie privée : le RPC ne donne que
// l'identité et des noms d'espèces, et la RLS ne laisse lire que les captures
// posées dans un deck public. Tout le reste — ses photos, ses lieux, ses
// brouillons — n'arrive jamais jusqu'ici.
//
// Ses decks sont montrés tels qu'il les a montés, sur le vrai plateau : il a
// publié pour ça. En dessous, la comparaison — une espèce que toi tu n'as pas
// encore capturée s'affiche en silhouette. Visiter un joueur plus fort que soi,
// c'est littéralement voir les trous de sa propre collection. La commu ramène à
// la caméra, pas au scroll.
//
// Toute carte s'ouvre, avec la transition de l'accueil : le die-cut se décolle
// de sa tuile et vole au centre. Une carte qui ne réagit pas au tap est une
// zone morte — le joueur la touche, rien ne bouge, il croit que c'est cassé.

import { CardMorphOverlay } from '@/components/cards/card-morph-overlay';
import { useModeration } from '@/components/moderation/use-moderation';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { CardTile } from '@/components/cards/card-tile';
import { speciesName } from '@/lib/animals/species-name';
import { HoloCard, type HoloCardData } from '@/components/cards/holo-card';
import { useCardMorph } from '@/components/cards/use-card-morph';
import { DeckBoard } from '@/components/decks/deck-board';
import { speciesMasteries, speciesMastery } from '@/lib/animals/progression';
import { GROUP_LABELS, silhouetteFor } from '@/lib/animals/silhouettes';
import { api, type Capture } from '@/lib/supabase/api';
import { useBackendAuth, useMutation, useQuery } from '@/lib/supabase/backend';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/** La taille du portrait sur la fiche, telle que `styles.avatar` la posait. */
const AVATAR_SIZE = 84;

export default function PlayerScreen() {
  const { t: copy } = useUiTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAuthenticated } = useBackendAuth();
  const { theme } = useUnistyles();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const profile = useQuery(api.community.profile, isAuthenticated && id ? { userId: id } : 'skip');
  const captures = useQuery(api.animals.listCaptures, isAuthenticated ? {} : 'skip');
  // `listAll`, et pas la région du visiteur : on lit la collection de QUELQU'UN
  // D'AUTRE, qui vit peut-être sur un autre continent. Filtrer sur sa région à
  // soi effacerait le nom de la moitié de ses cartes.
  const catalog = useQuery(api.catalog.listAll, isAuthenticated ? {} : 'skip');
  const toggleLike = useMutation(api.decks.toggleLike);
  // Le lien d'amitié : la liste dit déjà dans quel sens il va, donc l'écran n'a
  // qu'un bouton à dessiner au lieu de recouper deux requêtes.
  const friends = useQuery(api.community.friends, isAuthenticated ? {} : 'skip');
  const requestFriend = useMutation(api.community.requestFriend);
  const respondFriend = useMutation(api.community.respondFriend);
  const link = friends?.find((friend) => friend.userId === id);
  const [deckIndex, setDeckIndex] = useState(0);
  const morph = useCardMorph();

  /** Mes espèces — ce qui décide silhouette ou pas, partout sur l'écran. */
  const mySpecies = useMemo(
    () =>
      new Set(
        (captures ?? [])
          .filter((c) => c.status === 'ready' || c.status === 'needs_review')
          .map((c) => c.scientificName)
          .filter(Boolean),
      ),
    [captures],
  );
  const catalogByName = useMemo(() => {
    const map = new Map<
      string,
      { family?: string; group: string; rarity?: Capture['rarity']; vernacularName?: string; vernacularNameEn?: string }
    >();
    for (const entry of catalog ?? []) map.set(entry.scientificName, entry);
    return map;
  }, [catalog]);

  /**
   * Le même enrichissement que « Ma collection » (`enrichCard`) : noms du
   * catalogue, rareté, maîtrise. Sans lui, ses cartes s'afficheraient plus
   * pauvres que les miennes — même espèce, carte différente.
   */
  const enrich = useCallback(
    (card: Capture): HoloCardData => {
      const entry = card.scientificName ? catalogByName.get(card.scientificName) : undefined;
      const key = card.scientificName ?? card.commonName;
      const mastery = speciesMastery([card], key);
      if (!entry) return { ...card, mastery } as HoloCardData;
      return {
        ...card,
        commonName: entry.vernacularNameEn ?? card.commonName,
        commonNameLocale: entry.vernacularName ?? card.commonNameLocale,
        inAtlas: true,
        mastery,
        rarity: entry.rarity ?? card.rarity,
      } as HoloCardData;
    },
    [catalogByName],
  );
  /** Ma carte par espèce — sa collection est dessinée avec MES cartes. */
  const myCardBySpecies = useMemo(() => {
    const map = new Map<string, Capture>();
    for (const capture of captures ?? []) {
      if (
        capture.scientificName &&
        (capture.status === 'ready' || capture.status === 'needs_review') &&
        !map.has(capture.scientificName)
      ) {
        map.set(capture.scientificName, capture);
      }
    }
    return map;
  }, [captures]);
  /** Mes maîtrises réelles — mes cartes portent MES étoiles, comme chez moi. */
  const myMasteries = useMemo(() => speciesMasteries(captures ?? []), [captures]);

  // `DeckBoard` rend (carte, ref) et la transition attend (ref, carte).
  // Dépendance sur `morph.open`, pas sur `morph` : le hook renvoie un objet
  // littéral neuf à chaque rendu, ce qui recréerait ce callback en permanence.
  const openCard = useCallback(
    (card: HoloCardData, cardRef: RefObject<View | null>) => morph.open(cardRef, card),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- voir ci-dessus
    [morph.open],
  );

  // Appelé AVANT les retours anticipés : `profile` peut être indéfini, un hook
  // ne peut pas l'être. Le nom sert seulement de titre à la feuille d'actions.
  const moderation = useModeration({
    authorId: id ?? null,
    authorName: profile?.displayName ?? null,
    kind: 'profile',
    targetId: id ?? '',
  });

  if (profile === undefined) return <View style={styles.screen} />;
  if (profile === null) {
    return (
      <View style={[styles.screen, styles.gone]}>
        <SymbolView name="person.slash.fill" size={40} tintColor={theme.colors.faint} />
        <Text style={styles.goneText}>{copy("ui_copy_189")}</Text>
      </View>
    );
  }

  const missing = profile.species.filter((s) => !mySpecies.has(s.scientificName)).length;
  const collectionTile = (width - 40 - 2 * 8) / 3;
  const activeDeck = profile.decks[Math.min(deckIndex, profile.decks.length - 1)];

  return (
    // Même ossature que l'accueil : une racine en flex qui contient la liste ET
    // la transition. La transition mesure en coordonnées PAGE et se positionne
    // en absolu dans cette racine — les deux ne coïncident que si la racine
    // part du coin de l'écran.
    <View style={styles.screen}>
    <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 56 }]}
      // Explicite, pas « automatic » : c'est le recalcul d'encart automatique
      // qui faisait sauter la page en haut dès que la hauteur du header
      // changeait. Ici rien ne bouge au-dessus du scroll.
      contentInsetAdjustmentBehavior="never"
      showsVerticalScrollIndicator={false}
    >
      <Animated.View entering={FadeInDown.duration(280)} style={styles.hero}>
        <PlayerAvatar
          name={profile.displayName}
          premium={profile.isPremium}
          size={AVATAR_SIZE}
          url={profile.avatarUrl}
        />
        {/* Le portrait portait `marginBottom: 4` dans son style ; il vit ici
            maintenant que le composant est partagé. */}
        <View style={styles.avatarGap} />
        <Text style={styles.name}>{profile.displayName}</Text>
        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        <Text style={styles.joined}>
          {`Explore depuis ${new Date(profile.joinedAt).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`}
        </Text>
        {id ? (
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              // Un lien reçu s'accepte ; tout le reste demande ou retire. Le
              // sens vient de la liste, pas d'un état local qui pourrait
              // diverger de la base.
              if (link?.direction === 'in') void respondFriend({ accept: true, userId: id });
              else if (link) void respondFriend({ accept: false, userId: id });
              else void requestFriend({ userId: id });
            }}
            style={({ pressed }) => [
              styles.friendButton,
              link?.direction === 'friend' && styles.friendButtonOn,
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text
              style={[styles.friendText, link?.direction === 'friend' && styles.friendTextOn]}
            >
              {link?.direction === 'friend'
                ? 'Dans ton cercle'
                : link?.direction === 'in'
                  ? copy("ui_copy_071")
                  : link?.direction === 'out'
                    ? copy("ui_copy_262")
                    : copy("ui_copy_263")}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.statRow}>
          <Stat label={copy("ui_copy_056")} value={profile.species.length} />
          <Stat label={copy("ui_copy_057")} value={profile.captureCount} />
          {missing > 0 ? <Stat accent label={copy("ui_copy_190")} value={missing} /> : null}
        </View>
      </Animated.View>

      {/* Ses decks sur LE plateau — cadre parchemin, numéros Clash, huit
          emplacements. Un deck se lit sur son plateau ou pas du tout : la même
          grille de cartes posée à plat n'est plus un deck, c'est une planche
          contact. */}
      {profile.decks.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(80).duration(280)} style={styles.section}>
          <View style={styles.deckHead}>
            <Text style={styles.sectionTitle}>{copy("ui_copy_191")}</Text>
            <Pressable
              accessibilityLabel={activeDeck?.deck.liked ? 'Retirer le like' : 'Liker ce deck'}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => {
                if (!activeDeck) return;
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                void toggleLike({ id: activeDeck.deck._id });
              }}
              style={styles.likeChip}
            >
              <SymbolView
                name={activeDeck?.deck.liked ? 'heart.fill' : 'heart'}
                size={15}
                tintColor={activeDeck?.deck.liked ? '#c05a3a' : theme.colors.muted}
              />
              <Text style={styles.likeCount}>{activeDeck?.deck.likeCount ?? 0}</Text>
            </Pressable>
          </View>
          <DeckBoard
            activeIndex={Math.min(deckIndex, profile.decks.length - 1)}
            decks={profile.decks.map((result) => ({
              cards: result.cards.map(enrich),
              name: result.deck.name,
            }))}
            onEnlarge={openCard}
            onSelect={setDeckIndex}
            width={width - 40}
          />
        </Animated.View>
      ) : null}

      {/* Son tableau de chasse, mesuré contre le mien.

          Le titre dit « face à ta collection » et non « sa collection », parce
          que les cartes pleines sont les MIENNES : la RLS ne donne ses captures
          que dans un deck public, donc une espèce qu'on partage est dessinée
          avec ma carte, mes étoiles. Sous un titre possessif, taper son lynx
          aurait ouvert ma fiche.

          Les tuiles en pointillés ne veulent PAS dire la même chose que dans
          l'atlas. Là-bas, un pointillé est une espèce que personne n'a ; ici
          c'est une espèce que LUI a et pas moi. Même dessin, sens inverse —
          d'où la ligne d'explication et le nom de l'espèce en clair sur la
          tuile plutôt que le libellé de groupe. Sans ça on lit « des cartes
          vides », ce qui n'apprend rien. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{copy("ui_copy_192")}</Text>
        <Text style={styles.sectionLede}>
          {missing > 0
            ? `Ses ${profile.species.length} espèces. Les ${missing} en pointillés te manquent encore.`
            : `Ses ${profile.species.length} espèces — tu les as toutes.`}
        </Text>
        <View style={styles.speciesGrid}>
          {profile.species.map((species) => {
            const mine = myCardBySpecies.get(species.scientificName);
            const entry = catalogByName.get(species.scientificName);
            if (!mine) {
              // La silhouette du groupe, mais l'espèce NOMMÉE : c'est une piste
              // de chasse précise, pas une case à remplir un jour.
              return (
                <CardTile
                  key={species.scientificName}
                  locked
                  lockedHint={
                    // `speciesName` : `commonName` est la colonne anglaise, et
                    // cette piste s'affiche au milieu d'une interface française.
                    speciesName(species) ??
                    GROUP_LABELS[entry?.group ?? ''] ??
                    species.scientificName
                  }
                  lockedShape={silhouetteFor(entry?.group, entry?.family)}
                  width={collectionTile}
                />
              );
            }
            // Ma carte, avec MA maîtrise réelle — la même face que dans « Ma
            // collection », étoiles comprises, et la même ouverture.
            const key = mine.scientificName ?? mine.commonName;
            const mastery = key ? myMasteries.get(key) : undefined;
            const data = enrich(mine);
            return (
              <OpenableCard
                card={mastery ? { ...data, mastery } : data}
                key={species.scientificName}
                onOpen={openCard}
                width={collectionTile}
              />
            );
          })}
        </View>
      </View>
    </ScrollView>

    {/* Le retour, dessiné par l'écran. Déclaré AVANT l'overlay, donc peint
        dessous : la carte ouverte le recouvre d'elle-même. */}
    <Pressable
      accessibilityLabel={copy("safari_return")}
      accessibilityRole="button"
      hitSlop={16}
      onPress={() => router.back()}
      style={({ pressed }) => [styles.back, { top: insets.top + 6 }, pressed && { opacity: 0.7 }]}
    >
      <SymbolView name="chevron.backward" size={19} tintColor={theme.colors.foreground} weight="semibold" />
    </Pressable>

    {/* Signaler et bloquer, en bouton VISIBLE et non en appui long. Directive
        Apple 1.2 : le mécanisme doit exister ET se trouver. Un menu caché
        derrière un geste se fait rejeter comme s'il n'existait pas. */}
    <Pressable
      accessibilityLabel={copy("ui_copy_193")}
      accessibilityRole="button"
      hitSlop={16}
      onPress={moderation.present}
      style={({ pressed }) => [styles.more, { top: insets.top + 6 }, pressed && { opacity: 0.7 }]}
    >
      <SymbolView name="ellipsis" size={19} tintColor={theme.colors.foreground} weight="semibold" />
    </Pressable>

    {/* Ni supprimer ni partager : ce ne sont pas mes cartes. Partager celle
        d'un autre joueur reviendrait à m'attribuer sa rencontre, et une
        capture ne vaut que comme preuve que SON auteur y était. Reste le
        retournement — le seul endroit où se lit la maîtrise. */}
    <CardMorphOverlay
      animation={morph.animation}
      cardTop={morph.layout.cardTop}
      cardWidth={morph.layout.cardWidth}
      onClose={morph.close}
      origin={morph.origin}
      selection={morph.selection}
      settled={morph.settled}
      shareable={false}
    />

    </View>
  );
}

/**
 * Une carte qui s'ouvre. Elle existe pour posséder un ref : la transition
 * MESURE cette vue pour savoir d'où faire voler le die-cut — exactement comme
 * la cellule de l'accueil, qui pose son ref sur un `View collapsable={false}`
 * autour de la `HoloCard`.
 */
function OpenableCard({
  card,
  onOpen,
  width,
}: {
  card: HoloCardData;
  onOpen: (card: HoloCardData, cardRef: RefObject<View | null>) => void;
  width: number;
}) {
  const cardRef = useRef<View | null>(null);
  return (
    <Pressable accessibilityRole="button" onPress={() => onOpen(card, cardRef)}>
      <View collapsable={false} ref={cardRef}>
        <HoloCard data={card} interactive={false} width={width} />
      </View>
    </Pressable>
  );
}

function Stat({ accent, label, value }: { accent?: boolean; label: string; value: number }) {
  return (
    <View style={[styles.stat, accent && styles.statAccent]}>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
      <Text style={[styles.statLabel, accent && styles.statValueAccent]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
  },
  gone: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 48,
  },
  goneText: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    textAlign: 'center',
  },
  content: {
    padding: 20,
    paddingBottom: 60,
    gap: 28,
  },
  hero: {
    alignItems: 'center',
    gap: 6,
  },
  avatarGap: { height: 4 },
  name: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 28,
    letterSpacing: -0.4,
  },
  bio: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    textAlign: 'center',
  },
  joined: {
    color: theme.colors.faint,
    fontFamily: theme.fonts.medium,
    fontSize: 12,
  },
  friendButton: {
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    borderRadius: 999,
    marginTop: 14,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  friendButtonOn: {
    backgroundColor: theme.colors.primarySoft,
  },
  friendText: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.bold,
    fontSize: 14,
  },
  friendTextOn: {
    color: theme.colors.foreground,
  },
  statRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  stat: {
    minWidth: 92,
    alignItems: 'center',
    gap: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: theme.radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  // « Te manquent » en encre pleine : c'est le chiffre qui doit démanger.
  statAccent: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  statValue: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 20,
    fontVariant: ['tabular-nums'],
  },
  statValueAccent: {
    color: theme.colors.onPrimary,
  },
  statLabel: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 11,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 22,
    letterSpacing: -0.2,
  },
  more: {
    position: 'absolute',
    right: 16,
    zIndex: 5,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  back: {
    position: 'absolute',
    left: 16,
    zIndex: 5,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  sectionLede: {
    marginTop: -6,
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  deckHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  likeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceMuted,
  },
  likeCount: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  speciesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
}));
