import { uiLanguage } from '@/i18n/current';
import { useTranslation as useUiTranslation } from 'react-i18next';
// Animation source: AnimateReactNative — "Tarot Cards animation - Reanimated 3 + Gestures + Math".
// Only the demo artwork, card count and stage placement are adapted to SafaRoll.

import {
  AnimalCard,
  type AnimalCardData,
} from "@/components/animals/animal-card";
import { Image as ExpoImage, type ImageRef } from "expo-image";
import { useEffect, useState } from "react";
import { Dimensions, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { crantRoue } from "@/lib/haptics";

const { width } = Dimensions.get("window");
const numberOfCards = 30;
const minSize = 150;
const tarotCardSize = {
  width: minSize,
  height: minSize / 0.716,
  borderRadius: 12,
};
const TWO_PI = 2 * Math.PI;
const theta = TWO_PI / numberOfCards;
const tarotCardSizeVisiblePercentage = 0.9;
const tarotCardSizeOnCircle =
  tarotCardSizeVisiblePercentage * tarotCardSize.width;
const circleRadius = Math.max(
  (tarotCardSizeOnCircle * numberOfCards) / TWO_PI,
  width,
);
const circleCircumference = TWO_PI * circleRadius;
const changeFactor = circleCircumference / width;

type SafariCard = AnimalCardData & { key: string };

const STICKERS = {
  "aquila-chrysaetos": require("../../../assets/onboarding/mission-stickers/aquila-chrysaetos.webp"),
  "aquila-fasciata": require("../../../assets/onboarding/mission-stickers/aquila-fasciata.webp"),
  "cygnus-olor": require("../../../assets/onboarding/mission-stickers/cygnus-olor.webp"),
  "lynx-lynx": require("../../../assets/onboarding/mission-stickers/lynx-lynx.webp"),
  "phoenicopterus-roseus": require("../../../assets/onboarding/mission-stickers/phoenicopterus-roseus.webp"),
  "testudo-hermanni": require("../../../assets/onboarding/mission-stickers/testudo-hermanni.webp"),
} as const;

const SCENES = {
  "aquila-chrysaetos": require("../../../assets/onboarding/mission-scenes/aquila-chrysaetos.webp"),
  "aquila-fasciata": require("../../../assets/onboarding/mission-scenes/aquila-fasciata.webp"),
  "cygnus-olor": require("../../../assets/onboarding/mission-scenes/cygnus-olor.webp"),
  "lynx-lynx": require("../../../assets/onboarding/mission-scenes/lynx-lynx.webp"),
  "phoenicopterus-roseus": require("../../../assets/onboarding/mission-scenes/phoenicopterus-roseus.webp"),
  "testudo-hermanni": require("../../../assets/onboarding/mission-scenes/testudo-hermanni.webp"),
} as const;

const missionSources = Object.values(SCENES);
let loadedMissionArt = new Map<number, ImageRef>();
const missionArtReady = Promise.all(
  missionSources.map(
    async (source) =>
      [
        source,
        await ExpoImage.loadAsync(source, { maxHeight: 640, maxWidth: 450 }),
      ] as const,
  ),
)
  .then((entries) => {
    loadedMissionArt = new Map(entries);
    return loadedMissionArt;
  })
  .catch(() => loadedMissionArt);

const speciesCards: SafariCard[] = [
  {
    key: "phoenicopterus-roseus",
    get commonName() { return uiLanguage() === 'fr' ? 'Flamant rose' : 'Greater Flamingo'; },
    get commonNameLocale() { return uiLanguage() === 'fr' ? 'Flamant rose' : 'Greater Flamingo'; },
    dominantColor: "#D97B8A",
    inAtlas: true,
    rarity: "uncommon",
    sceneAsset: SCENES["phoenicopterus-roseus"],
    sceneSlug: "phoenicopterus-roseus",
    scientificName: "Phoenicopterus roseus",
    status: "ready",
    stickerAsset: STICKERS["phoenicopterus-roseus"],
    stickerUrl: null,
    taxonomy: {
      kingdom: "Animalia",
      phylum: "Chordata",
      class: "Aves",
      order: "Phoenicopteriformes",
      family: "Phoenicopteridae",
      genus: "Phoenicopterus",
    },
  },
  {
    key: "lynx-lynx",
    get commonName() { return uiLanguage() === 'fr' ? 'Lynx d’Europe' : 'Eurasian Lynx'; },
    get commonNameLocale() { return uiLanguage() === 'fr' ? 'Lynx d’Europe' : 'Eurasian Lynx'; },
    dominantColor: "#A9825B",
    inAtlas: true,
    rarity: "rare",
    sceneAsset: SCENES["lynx-lynx"],
    sceneSlug: "lynx-lynx",
    scientificName: "Lynx lynx",
    status: "ready",
    stickerAsset: STICKERS["lynx-lynx"],
    stickerUrl: null,
    taxonomy: {
      kingdom: "Animalia",
      phylum: "Chordata",
      class: "Mammalia",
      order: "Carnivora",
      family: "Felidae",
      genus: "Lynx",
    },
  },
  {
    key: "aquila-chrysaetos",
    get commonName() { return uiLanguage() === 'fr' ? 'Aigle royal' : 'Golden Eagle'; },
    get commonNameLocale() { return uiLanguage() === 'fr' ? 'Aigle royal' : 'Golden Eagle'; },
    dominantColor: "#8B673E",
    inAtlas: true,
    rarity: "uncommon",
    sceneAsset: SCENES["aquila-chrysaetos"],
    sceneSlug: "aquila-chrysaetos",
    scientificName: "Aquila chrysaetos",
    status: "ready",
    stickerAsset: STICKERS["aquila-chrysaetos"],
    stickerUrl: null,
    taxonomy: {
      kingdom: "Animalia",
      phylum: "Chordata",
      class: "Aves",
      order: "Accipitriformes",
      family: "Accipitridae",
      genus: "Aquila",
    },
  },
  {
    key: "testudo-hermanni",
    get commonName() { return uiLanguage() === 'fr' ? 'Tortue d’Hermann' : 'Hermann’s Tortoise'; },
    get commonNameLocale() { return uiLanguage() === 'fr' ? 'Tortue d’Hermann' : 'Hermann’s Tortoise'; },
    dominantColor: "#8C7A3C",
    inAtlas: true,
    rarity: "very_rare",
    sceneAsset: SCENES["testudo-hermanni"],
    sceneSlug: "testudo-hermanni",
    scientificName: "Testudo hermanni",
    status: "ready",
    stickerAsset: STICKERS["testudo-hermanni"],
    stickerUrl: null,
    taxonomy: {
      kingdom: "Animalia",
      phylum: "Chordata",
      class: "Reptilia",
      order: "Testudines",
      family: "Testudinidae",
      genus: "Testudo",
    },
  },
  {
    key: "cygnus-olor",
    get commonName() { return uiLanguage() === 'fr' ? 'Cygne tuberculé' : 'Mute Swan'; },
    get commonNameLocale() { return uiLanguage() === 'fr' ? 'Cygne tuberculé' : 'Mute Swan'; },
    dominantColor: "#BFC9CE",
    inAtlas: true,
    rarity: "common",
    sceneAsset: SCENES["cygnus-olor"],
    sceneSlug: "cygnus-olor",
    scientificName: "Cygnus olor",
    status: "ready",
    stickerAsset: STICKERS["cygnus-olor"],
    stickerUrl: null,
    taxonomy: {
      kingdom: "Animalia",
      phylum: "Chordata",
      class: "Aves",
      order: "Anseriformes",
      family: "Anatidae",
      genus: "Cygnus",
    },
  },
  {
    key: "aquila-fasciata",
    get commonName() { return uiLanguage() === 'fr' ? 'Aigle de Bonelli' : 'Bonelli’s Eagle'; },
    get commonNameLocale() { return uiLanguage() === 'fr' ? 'Aigle de Bonelli' : 'Bonelli’s Eagle'; },
    dominantColor: "#7A6248",
    inAtlas: true,
    rarity: "rare",
    sceneAsset: SCENES["aquila-fasciata"],
    sceneSlug: "aquila-fasciata",
    scientificName: "Aquila fasciata",
    status: "ready",
    stickerAsset: STICKERS["aquila-fasciata"],
    stickerUrl: null,
    taxonomy: {
      kingdom: "Animalia",
      phylum: "Chordata",
      class: "Aves",
      order: "Accipitriformes",
      family: "Accipitridae",
      genus: "Aquila",
    },
  },
];

// The original wheel has 30 evenly-spaced positions. Keeping those positions
// is what creates the fan instead of a six-card pile; the six requested
// species simply repeat around the full circle.
const tarotCards = Array.from({ length: numberOfCards }, (_, index) => {
  const card = speciesCards[index % speciesCards.length];
  return { ...card, key: `${card.key}-${index}` };
});

function TarotCard({
  card,
  cardIndex,
  index,
  loadedArt,
}: {
  card: SafariCard;
  index: SharedValue<number>;
  cardIndex: number;
  loadedArt: Map<number, ImageRef>;
}) {
  const mounted = useSharedValue(0);

  useEffect(() => {
    mounted.set(withTiming(1, { duration: 500 }));
  }, [mounted]);

  const animatedStyle = useAnimatedStyle(() => {
    const current =
      ((index.get() % numberOfCards) + numberOfCards) % numberOfCards;
    const rawDistance = Math.abs(current - cardIndex);
    const circularDistance = Math.min(rawDistance, numberOfCards - rawDistance);

    return {
      // L'ordre JSX ne doit jamais recouvrir la carte sélectionnée : au
      // premier affichage, c'est donc bien le Flamant rose qui domine la pile.
      zIndex: numberOfCards - Math.round(circularDistance),
      transform: [
        {
          rotate: `${interpolate(mounted.get(), [0, 1], [0, theta * cardIndex])}rad`,
        },
        {
          translateY:
            (-tarotCardSize.height / 2) *
            Math.max(0, 1 - circularDistance),
        },
      ],
    };
  });

  return (
    <Animated.View style={[styles.cardOrbit, animatedStyle]}>
      <AnimalCard
        animated={false}
        contentScale={0.76}
        data={{
          ...card,
          sceneAsset:
            typeof card.sceneAsset === "number"
              ? (loadedArt.get(card.sceneAsset) ?? card.sceneAsset)
              : card.sceneAsset,
        }}
        width={tarotCardSize.width}
      />
    </Animated.View>
  );
}

function TarotWheel({
  loadedArt,
  onCardChange,
}: {
  loadedArt: Map<number, ImageRef>;
  onCardChange: (cardIndex: number) => void;
}) {
  const distance = useSharedValue(0);
  const angle = useDerivedValue(() => distance.get() / circleCircumference);
  const interpolatedIndex = useDerivedValue(() => {
    const value = Math.abs((angle.get() % TWO_PI) / theta);
    return angle.get() < 0 ? value : numberOfCards - value;
  });
  const activeIndex = useDerivedValue(() =>
    Math.round(interpolatedIndex.get()),
  );

  // LE POIDS DE LA ROUE.
  //
  // `onCardChange` ne parle qu'à l'ARRÊT : il dit quelle carte a gagné, une
  // fois tout immobile. Ce qui manquait, c'est le trajet — chaque carte qui
  // passe devant soi pendant qu'on fait tourner, y compris pendant l'inertie.
  //
  // `activeIndex` est l'indice ARRONDI : il ne change qu'au franchissement du
  // milieu, ce qui est exactement l'instant du cran. Lire une valeur dérivée
  // plutôt que la position brute évite d'avoir à choisir un seuil.
  useAnimatedReaction(
    () => activeIndex.get(),
    (courant, precedent) => {
      if (precedent !== null && courant !== precedent) runOnJS(crantRoue)();
    },
  );

  const pan = Gesture.Pan()
    .onChange((event) => {
      distance.set(distance.get() + event.changeX * changeFactor);
    })
    .onFinalize((event) => {
      distance.set(
        withDecay(
          {
            velocity: event.velocityX,
            velocityFactor: changeFactor,
          },
          () => {
            const newAngleFloat = -interpolatedIndex.get() * theta;
            const newAngle = -activeIndex.get() * theta;
            distance.set(newAngleFloat * circleCircumference);
            distance.set(withSpring(newAngle * circleCircumference));
            runOnJS(onCardChange)(activeIndex.get() % numberOfCards);
          },
        ),
      );
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angle.get()}rad` }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.wheel, animatedStyle]}>
        {tarotCards.map((card, cardIndex) => (
          <TarotCard
            card={card}
            cardIndex={cardIndex}
            index={interpolatedIndex}
            key={card.key}
            loadedArt={loadedArt}
          />
        ))}
      </Animated.View>
    </GestureDetector>
  );
}

export function MissionCardsStep() {
  const { t: copy } = useUiTranslation();
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [loadedArt, setLoadedArt] = useState(loadedMissionArt);

  useEffect(() => {
    if (loadedArt.size === missionSources.length) return;
    void missionArtReady.then(setLoadedArt);
  }, [loadedArt.size]);

  return (
    <View
      accessibilityLabel={copy('tarot_a11y', { name: tarotCards[activeCardIndex].commonName })}
      style={styles.root}
    >
      <View style={styles.stage}>
        <TarotWheel
          loadedArt={loadedArt}
          onCardChange={setActiveCardIndex}
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{copy("ui_copy_039")}</Text>
        <Text style={styles.subtitle}>
          {copy("ui_copy_040")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, justifyContent: "center", gap: 16 },
  // La page d'onboarding a 22 px de marge de chaque côté. Cette scène est le
  // seul visuel qui doit aller bord à bord, et sa hauteur garde les cartes
  // inclinées entières au lieu de leur couper le bas.
  stage: { height: 360, marginHorizontal: -22, overflow: "hidden", width },
  wheel: {
    alignItems: "center",
    alignSelf: "center",
    height: circleRadius * 2,
    justifyContent: "center",
    position: "absolute",
    top: 125,
    width: circleRadius * 2,
  },
  cardOrbit: {
    elevation: 4,
    height: circleRadius * 2,
    position: "absolute",
    shadowColor: "#000000",
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    width: tarotCardSize.width,
  },
  copy: { alignItems: "center", gap: 8, width: "100%" },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.brand,
    fontSize: 32,
    letterSpacing: -0.7,
    lineHeight: 37,
    paddingHorizontal: 8,
    textAlign: "center",
    width: "100%",
  },
  subtitle: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 340,
    textAlign: "center",
  },
}));
