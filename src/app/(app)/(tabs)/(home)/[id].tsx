import { uiLanguage } from '@/i18n/current';
import { identityFor } from '@/components/cards/card-identity';
import { MoltenBackdrop } from '@/components/cards/molten-backdrop';
import { SpeciesWiki } from '@/components/cards/species-wiki';
import { useState } from 'react';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { correctableCandidates } from '@/lib/animals/correctable-candidates';
import { speciesName } from '@/lib/animals/species-name';
import { animalGroupName } from '@/lib/animals/animal-group-name';
import { currentLanguage } from '@/i18n/languages';
import { AnimalCard } from '@/components/animals/animal-card';
import { CardShareButton, useCardShareRef } from '@/components/cards/card-share-button';
import { ThinkingLoader } from '@/components/ui/thinking-loader';
import { speciesMastery } from '@/lib/animals/progression';
import { useBackendAuth, useMutation, useQuery } from '@/lib/supabase/backend';
import { cardRarity, tierFor } from '@/lib/animals/rarity';
import { api } from '@/lib/supabase/api';
import type { Id } from '@/lib/supabase/api';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

export default function CaptureDetailScreen() {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: Id<'animalCaptures'> }>();
  const capture = useQuery(api.animals.getCapture, id ? { id } : 'skip');
  const allCaptures = useQuery(api.animals.listCaptures, {});
  const { isAuthenticated } = useBackendAuth();
  // La fiche cherche juste le nom et les notes de terrain d'une espèce déjà
  // capturée : `listAll` est le bon appel. `listRegion` avec 'FR' en dur ne
  // filtrait rien (l'argument était ignoré) et serait devenu faux maintenant
  // qu'il filtre — une espèce prise en voyage n'aurait plus eu de fiche.
  const atlas = useQuery(api.catalog.listAll, isAuthenticated ? {} : 'skip');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 42, 370);
  const cardRef = useCardShareRef();
  // La correction relance `identify-animal` derrière : l'espèce change, donc la
  // rareté, la carte et l'atlas doivent suivre. C'est la même mutation que la
  // caméra utilise pour les identifications douteuses.
  const correct = useMutation(api.animals.confirmIdentification);
  // LA CORRECTION EST REPLIÉE, ET LE RECOURS A DISPARU
  //
  // Le bloc « LE MODÈLE A HÉSITÉ » proposait aux abonnés de relancer sur un
  // modèle plus lourd. Il n'a plus rien à vendre : `base` et `pro` chargent
  // désormais le même BioCLIP 2.5 (voir `services/animal-id/modal_app.py`), donc
  // relancer rendrait exactement la même réponse. Le laisser serait facturer
  // un bouton qui ne fait rien.
  //
  // À noter : il n'avait jamais fonctionné. Il pointait déjà sur 2.5 avec une
  // version de pybioclip qui refuse ce modèle, et aurait planté à la première
  // utilisation. Personne ne s'en était aperçu — il fallait cumuler une
  // capture douteuse ET un abonnement pour l'atteindre.
  const [correcting, setCorrecting] = useState(false);
  const correctable = correctableCandidates(capture?.candidates, capture?.scientificName);

  if (capture === undefined) {
    return (
      <View style={styles.center}>
        <ThinkingLoader label={t('detail_loading')} state="shaping" />
      </View>
    );
  }

  if (capture === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.missing}>{copy("ui_copy_203")}</Text>
      </View>
    );
  }

  const rarity = cardRarity(capture);
  const mastery = speciesMastery(allCaptures ?? [capture], capture.scientificName ?? capture.commonName);
  const tier = tierFor(rarity);

  return (
    <View style={styles.screen}>
      {/* La pièce prend la couleur de la rareté — sauf pour une LÉGENDAIRE, qui
          mérite mieux qu'un aplat : la roche en fusion, teintée par la couleur
          dominante de la capture. Le lavis reste pour tout le reste ; faire
          tourner ce shader sur chaque moineau coûterait trois champs de bruit
          fractal par pixel et par image, pour un effet qui ne dirait plus rien
          à force d'être partout. */}
      {rarity === 'legendary' ? (
        <MoltenBackdrop color={identityFor(capture).body[1]} />
      ) : (
        <View style={[styles.rarityWash, { backgroundColor: tier.accent }]} pointerEvents="none" />
      )}
      <Pressable
        accessibilityLabel={t('collection_back')}
        onPress={() => router.back()}
        style={[styles.back, { top: insets.top + 8 }]}
      >
        <SymbolView name="chevron.left" size={17} tintColor="#fff" weight="semibold" />
      </Pressable>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 70, paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleBlock}>
          {capture.inAtlas === false ? (
            <Text style={[styles.eyebrow, { color: tier.accent }]}>{t('detail_bonus_badge')}</Text>
          ) : null}
          <Text style={styles.title}>{speciesName(capture) ?? capture.scientificName}</Text>
          <Text style={styles.subtitle}>{capture.scientificName}</Text>
        </View>

        <View collapsable={false} ref={cardRef}>
          {/* No aura wrapper here any more: the card carries its own edge,
              so the miniature in the grid and this one are the same object
              down to the frame. */}
          <AnimalCard data={{ ...capture, mastery }} width={cardWidth} />
        </View>

        <CardShareButton
          cardRef={cardRef}
          name={speciesName(capture) ?? capture.scientificName ?? (uiLanguage() === 'fr' ? 'carte' : 'card')}
        />

        {/* Seules les captures situées : celles d'avant l'autorisation de
            position n'ont pas de coordonnées et n'en auront jamais. */}
        {capture.latitude !== undefined && capture.longitude !== undefined ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/map', params: { capture: id } })}
            style={({ pressed }) => [styles.proButton, pressed && { opacity: 0.7 }]}
          >
            <SymbolView name="map" size={16} tintColor="#e6dfc4" weight="semibold" />
            <Text style={styles.proButtonText}>{copy("ui_copy_204")}</Text>
          </Pressable>
        ) : null}

        <View style={styles.details}>
          <Detail label={t('detail_mastery')} value={t('mastery_level', { level: mastery.level })} />
          <Detail label={t('detail_observation_days')} value={t('mastery_days', { count: mastery.observationDays })} />
          <Detail
            label={t('detail_next_level')}
            value={
              mastery.level === 5
                ? t('mastery_complete')
                : t('mastery_days_remaining', {
                    count: mastery.daysToNextLevel,
                  })
            }
          />
          <Detail label={copy("detail_class")} value={animalGroupName(capture.taxonomy, currentLanguage())} />
          <Detail label={copy("detail_family")} value={capture.taxonomy?.family ?? copy('detail_unknown_family')} />
          <Detail
            label={copy("ui_copy_205")}
            value={
              capture.confidence === undefined ? t('detail_to_confirm') : `${Math.round(capture.confidence * 100)} %`
            }
          />
          <Detail
            label="Source"
            value={capture.captureSource === 'library' ? t('detail_imported') : t('detail_field_capture')}
          />
        </View>

        <View style={styles.editorial}>
        <SpeciesWiki accent={tier.accent} scientificName={capture.scientificName} />
        </View>

        {capture.inAtlas === false ? (
          <View style={styles.editorial}>
            <Text style={styles.editorialTitle}>{t('detail_bonus_title')}</Text>
            <Text style={styles.editorialBody}>{t('detail_bonus_body')}</Text>
          </View>
        ) : null}

        {/* LA CORRECTION EXISTE, MAIS ELLE NE POSE PLUS DE QUESTION.
            Avant, la fiche listait d'office les trois autres candidats avec
            leur pourcentage. Or c'est demander « zèbre des plaines ou zèbre de
            Grévy ? » à quelqu'un qui a photographié l'animal PARCE QU'il ne
            sait pas ce que c'est. Sa seule stratégie était de reprendre le plus
            gros chiffre — donc de refaire le choix du modèle en croyant
            décider.
            Elle est maintenant repliée : une ligne discrète, ouverte à la
            demande. Celui qui sait garde son recours, les autres ne se voient
            plus poser une question sans réponse. */}
        {correctable.length > 0 && capture._id ? (
          <View style={styles.editorial}>
            <Pressable
              hitSlop={8}
              onPress={() => setCorrecting((open) => !open)}
              style={({ pressed }) => [styles.correctRow, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.editorialTitle}>{copy("ui_copy_206")}</Text>
              <SymbolView
                name={correcting ? 'chevron.up' : 'chevron.down'}
                size={12}
                tintColor="#8d8271"
                weight="bold"
              />
            </Pressable>
            {correcting
              ? correctable.slice(0, 3).map((candidate) => (
                  <Pressable
                    key={candidate.scientificName}
                    onPress={() =>
                      void correct({
                        id: capture._id as Id<'animalCaptures'>,
                        scientificName: candidate.scientificName,
                      })
                    }
                    style={({ pressed }) => [styles.candidate, pressed && { opacity: 0.6 }]}
                  >
                    <Text numberOfLines={1} style={styles.candidateName}>
                      {speciesName(candidate)}
                    </Text>
                  </Pressable>
                ))
              : null}
          </View>
        ) : null}

      </ScrollView>

    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: '#100b04',
  },
  rarityWash: {
    position: 'absolute',
    top: '-30%',
    right: '-20%',
    left: '-20%',
    height: '70%',
    borderRadius: 999,
    opacity: 0.13,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  missing: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.medium,
    fontSize: 15,
  },
  back: {
    position: 'absolute',
    left: 16,
    zIndex: 5,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  titleBlock: {
    alignItems: 'center',
    marginBottom: 22,
  },
  eyebrow: {
    color: '#2b2418',
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    letterSpacing: 1.7,
  },
  title: {
    marginTop: 5,
    color: '#fff8e5',
    fontFamily: theme.fonts.display,
    fontSize: 34,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.52)',
    fontFamily: theme.fonts.regular,
    fontSize: 12,
    fontStyle: 'italic',
  },
  details: {
    alignSelf: 'stretch',
    marginTop: 28,
    overflow: 'hidden',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  detail: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.09)',
  },
  detailLabel: {
    color: 'rgba(255,255,255,0.52)',
    fontFamily: theme.fonts.medium,
    fontSize: 12,
  },
  editorial: {
    alignSelf: 'stretch',
    marginTop: 14,
    borderRadius: 20,
    padding: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  editorialTitle: {
    color: 'rgba(255,255,255,0.42)',
    fontFamily: theme.fonts.bold,
    fontSize: 9,
    letterSpacing: 1.5,
  },
  proButton: {
    alignItems: 'center',
    backgroundColor: '#2b2418',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 46,
    paddingHorizontal: 18,
  },
  proButtonText: { color: '#e6dfc4', fontFamily: theme.fonts.bold, fontSize: 14 },
  candidate: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  candidateName: {
    color: '#fff8e5',
    flex: 1,
    fontFamily: theme.fonts.medium,
    fontSize: 14,
  },
  candidateScore: {
    color: 'rgba(255,255,255,0.45)',
    fontFamily: theme.fonts.bold,
    fontSize: 12,
  },
  editorialBody: {
    marginTop: 7,
    color: '#fff8e5',
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    lineHeight: 21,
  },
  detailValue: {
    flex: 1,
    color: '#fff8e5',
    fontFamily: theme.fonts.bold,
    fontSize: 13,
    textAlign: 'right',
    textTransform: 'capitalize',
  },
  // Last on the page, quiet, and outlined rather than filled: it is the only
  // irreversible control in the app, so it should be findable and never the
  // thing your thumb lands on by accident.
  delete: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 26,
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(224,122,88,0.4)',
  },
  correctRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  deleteText: {
    color: '#e07a58',
    fontFamily: theme.fonts.bold,
    fontSize: 13,
  },
}));
