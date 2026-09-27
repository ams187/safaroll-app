import { useTranslation } from 'react-i18next';
// La scène du podium.
//
// LE FOND EST CELUI DE L'APP, PAS CELUI DE LA RÉFÉRENCE
//
// La maquette d'origine est noire parce que son app l'est. Ici tout est crème
// et parchemin : importer une plaque noire aurait fait un trou au milieu du
// produit. Le soleil de savane fait le même travail — rayons chauds sur le
// papier, et un halo qui désigne la première marche. Les rayons partent du
// sommet du bloc central, jamais du centre de l'image : c'est ce qui fait que
// l'œil trouve le premier AVANT d'avoir lu un chiffre.
//
// LE VOLUME SE FAIT À TROIS FACES, PAS À UNE OMBRE
//
// Un rectangle avec un liseré clair reste un rectangle. Ce qu'il faut, c'est la
// FACE DE DESSUS : un parallélogramme décalé en isométrie, plus une joue à
// droite. Trois quadrilatères, trois valeurs — le dessus le plus clair, la joue
// la plus sombre — et le bloc devient une caisse qu'on pourrait soulever.
//
// Le décalage isométrique est constant (`DEPTH`) pour les trois marches :
// c'est ce qui donne un point de fuite commun. Un décalage proportionnel à la
// hauteur donnerait trois perspectives différentes côte à côte.
//
// TOUT BOUGE, ET CHAQUE MOUVEMENT DIT QUELQUE CHOSE
//
//   LES RAYONS   tournent en continu, très lentement. C'est ce qui empêche la
//                scène d'être une image : elle respire.
//   LES MARCHES  poussent du sol en spring, décalées par rang. L'ordre de
//                départ EST le classement — on voit qui gagne avant de lire.
//   LES TÊTES    arrivent après leur marche, en rebond. Elles sont posées
//                DESSUS, donc elles ne peuvent pas arriver avant.
//
// Le rapport 3:2:1 est celui du CIO (540 / 360 / 180 mm). C'est lui qui rend la
// hiérarchie lisible d'un coup d'œil.

import {
  Canvas,
  Group,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { RegisterEntry } from '@/lib/supabase/api';

/** Or, argent, bronze. L'ordre est celui des rangs. */
const MEDALS = [
  { top: '#F5C653', face: '#E0AE3C', cheek: '#B98A26', ink: '#4A3208' },
  { top: '#D6D0C2', face: '#BFB8A8', cheek: '#9C9585', ink: '#2E2B25' },
  { top: '#D8A272', face: '#C18A5A', cheek: '#9E6E44', ink: '#432714' },
] as const;

/** 3:2:1, appliqué à la marche du milieu. */
const STEP_HEIGHTS = [104, 152, 76];
/** Position visuelle → rang réel. Le 1er au centre, comme tout podium. */
const SLOT_RANK = [1, 0, 2];
/** Le décalage isométrique, commun aux trois marches — le point de fuite. */
const DEPTH = 13;

const STAGE_HEIGHT = 330;
const FLOOR = 26;
const RAYS = 24;

/**
 * Le soleil. Un rayon sur deux dessiné, les vides laissés au papier.
 *
 * Tracé une fois pour un rayon très supérieur à la boîte : la rotation se fait
 * ensuite par transformation, donc rien n'est recalculé par image.
 */
function raysPath(reach: number) {
  const path = Skia.Path.Make();
  for (let index = 0; index < RAYS; index += 2) {
    const a0 = (index / RAYS) * Math.PI * 2;
    const a1 = ((index + 1) / RAYS) * Math.PI * 2;
    path.moveTo(0, 0);
    path.lineTo(reach * Math.cos(a0), reach * Math.sin(a0));
    path.lineTo(reach * Math.cos(a1), reach * Math.sin(a1));
    path.close();
  }
  return path;
}

export function PodiumStage({
  entries,
  onOpen,
  unit,
  width,
}: {
  /** Dans l'ordre des rangs : 1er, 2e, 3e. */
  entries: RegisterEntry[];
  onOpen: (entry: RegisterEntry) => void;
  unit: string;
  width: number;
}) {
  const { theme } = useUnistyles();
  const slotWidth = Math.min(104, (width - 48) / 3);
  const focusY = STAGE_HEIGHT - FLOOR - STEP_HEIGHTS[1];
  const reach = Math.hypot(width, STAGE_HEIGHT) * 1.2;

  // Le soleil tourne, très lentement. Un tour en quatre-vingt-dix secondes :
  // on ne le voit pas bouger, on sent que la scène est vivante.
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.set(
      withRepeat(withTiming(360, { duration: 90_000, easing: Easing.linear }), -1, false),
    );
  }, [spin]);
  const raysTransform = useDerivedValue(() => [{ rotate: (spin.get() * Math.PI) / 180 }]);

  return (
    <View style={[styles.stage, { height: STAGE_HEIGHT }]}>
      <Canvas style={StyleSheet.absoluteFill}>
        {/* EXACTEMENT le papier de la page, aux deux bouts.
            Il était en `surface` (#fffdf8) quand la page est en `background`
            (#faf6ee) : neuf points d'écart, invisibles seuls, mais suffisants
            pour dessiner deux arêtes horizontales et faire lire un bloc collé
            par-dessus l'écran. La scène doit être un ENDROIT de la page, pas un
            encart posé dessus — donc elle part et revient à sa couleur, et le
            réchauffement ne vit qu'au milieu.

            Le ton du milieu est `surfaceMuted`, pas un crème écrit en dur : en
            thème sombre, une valeur claire figée aurait posé une bande lumineuse
            au travers d'une page noire. Le jeton, lui, s'écarte du fond dans le
            bon sens des deux côtés. */}
        <Rect height={STAGE_HEIGHT} width={width} x={0} y={0}>
          <LinearGradient
            colors={[theme.colors.background, theme.colors.surfaceMuted, theme.colors.background]}
            end={vec(0, STAGE_HEIGHT)}
            positions={[0, 0.58, 1]}
            start={vec(0, 0)}
          />
        </Rect>

        <Group origin={vec(width / 2, focusY)} transform={raysTransform}>
          <Group transform={[{ translateX: width / 2 }, { translateY: focusY }]}>
            <Path color="#E8C77A" opacity={0.3} path={raysPath(reach)} />
          </Group>
        </Group>

        {/* Le halo : c'est lui qui désigne la première marche. Sans lui, trois
            blocs alignés et rien qui dise lequel regarder. */}
        <Rect height={STAGE_HEIGHT} width={width} x={0} y={0}>
          <RadialGradient
            c={vec(width / 2, focusY)}
            colors={['rgba(255,201,61,0.34)', 'rgba(255,201,61,0)']}
            r={width * 0.5}
          />
        </Rect>
      </Canvas>

      <View style={styles.slots}>
        {SLOT_RANK.map((rankIndex, slot) => {
          const entry = entries[rankIndex];
          if (!entry) return <View key={`empty-${slot}`} style={{ width: slotWidth }} />;
          return (
            <PodiumSlot
              entry={entry}
              key={entry.userId}
              onPress={() => onOpen(entry)}
              rankIndex={rankIndex}
              slot={slot}
              unit={unit}
              width={slotWidth}
            />
          );
        })}
      </View>
    </View>
  );
}

function PodiumSlot({
  entry,
  onPress,
  rankIndex,
  slot,
  unit,
  width,
}: {
  entry: RegisterEntry;
  onPress: () => void;
  rankIndex: number;
  slot: number;
  unit: string;
  width: number;
}) {
  const { t, i18n } = useTranslation();
  const medal = MEDALS[rankIndex];
  const full = STEP_HEIGHTS[slot];
  const avatar = rankIndex === 0 ? 82 : 66;

  // Le délai appartient à la PLACE, pas au parent : le premier part en premier,
  // les côtés suivent. L'ordre de départ est le classement.
  const rise = useSharedValue(0);
  const pop = useSharedValue(0);
  useEffect(() => {
    const delay = rankIndex * 110;
    rise.set(withDelay(delay, withSpring(1, { damping: 15, stiffness: 110 })));
    // La tête arrive APRÈS sa marche : elle est posée dessus, elle ne peut pas
    // la précéder. Le rebond est plus vif — c'est le moment qu'on regarde.
    pop.set(withDelay(delay + 190, withSpring(1, { damping: 11, stiffness: 180 })));
  }, [pop, rankIndex, rise]);

  const head = useAnimatedStyle(() => ({
    opacity: pop.get(),
    transform: [{ scale: 0.7 + pop.get() * 0.3 }, { translateY: (1 - pop.get()) * 14 }],
  }));
  const blockBox = useAnimatedStyle(() => ({ height: full * rise.get() + DEPTH }));

  return (
    <View style={[styles.slot, { width }]}>
      <Animated.View style={[styles.head, head]}>
        <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.pressed : null)}>
          <View
            style={[
              styles.avatarRing,
              {
                width: avatar,
                height: avatar,
                borderRadius: avatar / 2,
                borderColor: medal.top,
                shadowColor: medal.cheek,
              },
            ]}
          >
            {entry.avatarUrl ? (
              <Image contentFit="cover" source={{ uri: entry.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={[styles.avatarInitial, { fontSize: avatar * 0.4 }]}>
                {entry.displayName.charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
          {/* La médaille sur le bord de l'anneau : elle nomme le rang sans
              ajouter un chiffre de plus à l'écran. */}
          <View style={[styles.medal, { backgroundColor: medal.top }]}>
            <SymbolView
              name={rankIndex === 0 ? 'crown.fill' : 'rosette'}
              size={12}
              tintColor={medal.ink}
            />
          </View>
        </Pressable>

        <Text numberOfLines={1} style={styles.name}>
          {entry.displayName}
        </Text>
        <View style={[styles.scorePill, { backgroundColor: medal.top }]}>
          <Text style={[styles.scoreValue, { color: medal.ink }]}>
            {entry.score.toLocaleString(i18n.language)}
          </Text>
          <Text style={[styles.scoreUnit, { color: medal.ink }]}>
            {t(`community_unit_${unit === 'espèce' ? 'species' : unit === 'trouvaille' ? 'find' : unit === 'capture' ? 'capture' : 'point'}`, { count: entry.score })}
          </Text>
        </View>
      </Animated.View>

      <Animated.View style={[styles.blockBox, blockBox]}>
        <Block medal={medal} rise={rise} total={full} width={width} />
        {/* Le chiffre est un filigrane sur la façade : il confirme la marche, il
            ne remplace pas le nom — qui est ce qu'on est venu lire. Posé en RN
            et pas dans le canevas, parce que la police maison vit ici. */}
        <Text style={[styles.stepNumber, { color: medal.ink, right: DEPTH }]}>
          {rankIndex + 1}
        </Text>
      </Animated.View>
    </View>
  );
}

/**
 * La marche, en trois faces.
 *
 * Le dessus est un parallélogramme décalé de `DEPTH` vers le haut et la droite,
 * la joue relie ses deux arêtes droites, la façade est le rectangle de devant.
 * Trois valeurs de la même teinte : le dessus le plus clair parce qu'il prend
 * la lumière, la joue la plus sombre parce qu'elle s'en détourne.
 */
function Block({
  medal,
  rise,
  total,
  width,
}: {
  medal: (typeof MEDALS)[number];
  rise: { get: () => number };
  total: number;
  width: number;
}) {
  const boxHeight = total + DEPTH;
  const faceWidth = width - DEPTH;

  // Les trois faces sont reconstruites par image : la hauteur change, donc la
  // géométrie change. Trois quadrilatères, c'est moins cher qu'un `Group`
  // transformé qui écraserait la perspective du dessus en même temps.
  const top = useDerivedValue(() => {
    const h = total * rise.get();
    const y = boxHeight - h;
    const path = Skia.Path.Make();
    path.moveTo(0, y);
    path.lineTo(DEPTH, y - DEPTH);
    path.lineTo(faceWidth + DEPTH, y - DEPTH);
    path.lineTo(faceWidth, y);
    path.close();
    return path;
  });

  const cheek = useDerivedValue(() => {
    const h = total * rise.get();
    const y = boxHeight - h;
    const path = Skia.Path.Make();
    path.moveTo(faceWidth, y);
    path.lineTo(faceWidth + DEPTH, y - DEPTH);
    path.lineTo(faceWidth + DEPTH, boxHeight - DEPTH);
    path.lineTo(faceWidth, boxHeight);
    path.close();
    return path;
  });

  const face = useDerivedValue(() => {
    const h = total * rise.get();
    const y = boxHeight - h;
    const path = Skia.Path.Make();
    path.moveTo(0, y);
    path.lineTo(faceWidth, y);
    path.lineTo(faceWidth, boxHeight);
    path.lineTo(0, boxHeight);
    path.close();
    return path;
  });

  return (
    <Canvas style={{ width, height: boxHeight }}>
      <Path color={medal.face} path={face} />
      <Path color={medal.cheek} path={cheek} />
      <Path color={medal.top} path={top} />
    </Canvas>
  );
}

const styles = StyleSheet.create((theme) => ({
  stage: {
    marginHorizontal: -theme.gap(2.5),
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  pressed: { opacity: 0.7 },
  slots: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    paddingBottom: FLOOR,
    paddingHorizontal: theme.gap(2),
  },
  slot: { alignItems: 'center' },

  head: { alignItems: 'center', gap: 5, paddingBottom: 9 },
  avatarRing: {
    borderWidth: 3,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: { color: theme.colors.foreground, fontFamily: theme.fonts.display },
  medal: {
    position: 'absolute',
    right: -3,
    top: -3,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.surface,
  },
  name: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 12.5,
    textAlign: 'center',
    maxWidth: '100%',
  },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  scoreValue: { fontFamily: theme.fonts.display, fontSize: 13 },
  scoreUnit: { opacity: 0.65, fontFamily: theme.fonts.medium, fontSize: 9 },

  blockBox: { alignSelf: 'stretch', justifyContent: 'flex-end', overflow: 'hidden' },
  stepNumber: {
    position: 'absolute',
    bottom: 6,
    left: 0,
    textAlign: 'center',
    opacity: 0.22,
    fontFamily: theme.fonts.display,
    fontSize: 52,
    lineHeight: 56,
  },
}));
