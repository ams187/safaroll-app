import { useTranslation as useUiTranslation } from 'react-i18next';
import { EmptyState } from '@/components/empty-state';
import { ZooMapLayer } from '@/components/zoo-map-layer';
import { ZooMapSheet } from '@/components/zoo-map-sheet';
import { fetchZooMapSites, type ZooMapSite } from '@/lib/zoo-map';
import { useQuery as useServerQuery } from '@tanstack/react-query';
import { ShimmerPressableView } from '@/components/ui/shimmer-pressable-view';
import { Image as ExpoImage } from 'expo-image';
import { api } from '@/lib/supabase/api';
import type { FunctionReturnType } from '@/lib/supabase/api';
import Mapbox, {
  Animated as MapboxAnimated,
  Camera,
  CircleLayer,
  Images,
  MapView,
  RasterDemSource,
  ShapeSource,
  SkyLayer,
  StyleImport,
  SymbolLayer,
  Terrain,
} from '@rnmapbox/maps';
import { pinIconKey, usePinIcons } from '@/lib/animals/map-pins';
import { locationCallToAction } from '@/components/capture/location-invite';
import { useLocationGate } from '@/lib/location-permission';
import { mapGate, type LocationGate, type MapNotice } from '@/lib/location-rules';
import { usePremium } from '@/lib/premium';
import { useBackendAuth, useQuery } from '@/lib/supabase/backend';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated as RNAnimated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
Mapbox.setAccessToken(MAPBOX_TOKEN);

const AMBER = '#2b2418';
/**
 * Le beige du thème (`onPrimary` / `viewfinder`), pour les regroupements.
 *
 * `AMBER` porte mal son nom : `#2b2418` est l'ENCRE du thème, pas de l'ambre.
 * Les disques de cluster sortaient donc en brun quasi noir. Le compteur qui s'y
 * pose est en `#241a04` — de l'encre sur de l'encre, illisible. Le beige rend
 * le chiffre lisible et raccroche la carte à la palette du reste de l'app.
 */
const CLUSTER = '#e6dfc4';
const SOURCE_ID = 'captures';
/** De quoi passer au-dessus de la barre d'onglets quand la carte est une section du hub. */
const EMBEDDED_BOTTOM = 96;
/**
 * Assez pour que rien ne se lise, pas assez pour que rien ne se voie. Au-delà de
 * ~60 le dépoli devient une plaque grise et il n'y a plus rien à convoiter.
 */
const LOCK_BLUR = 34;

/** Ce que le carton de la carte a à dire. Voir `mapNotice`. */
type MapGate = NonNullable<MapNotice>;

/**
 * The camera moves the way VoyageMaker's agenda map moves.
 *
 * Selecting a pin does not just centre it: it drops into the street, tilts to
 * 65° so the extruded buildings actually read as buildings, and yaws by a small
 * random amount so two consecutive selections never look like the same shot.
 * Deselecting climbs back out. Both are `flyTo`, both fire a haptic on the same
 * frame as the move.
 */
const FOCUS = { duration: 1400, pitch: 65, zoom: 15.5 } as const;
const REST = { duration: 1000, pitch: 20 } as const;
/** The opening shot: a beat of stillness, then a slow drone push onto the pins. */
const OPENING = { delay: 400, duration: 3000, heading: 25, pitch: 55 } as const;
/**
 * L'entrée par une carte : `/map?capture=<id>`.
 *
 * Pas le même plan qu'une sélection d'épingle. On arrive de la fiche d'un
 * animal, donc la caméra part de l'orbite — la planète, l'épingle déjà au
 * centre — attend que les tuiles se posent, puis descend dessus. Aucun
 * déplacement latéral : c'est une chute, et c'est ce qui la rend lisible.
 *
 * Trois secondes et non 1,4 comme un `FOCUS` : quatorze niveaux de zoom pris
 * en 1,4 s, l'œil ne voit qu'un saut.
 */
const DIVE = { delay: 350, duration: 3200, from: 2.6, heading: 18, pitch: 68, zoom: 16.5 } as const;
/** Sonar under the selected pin — 1.5s out, then hard reset. */
const PULSE = { from: 20, fromOpacity: 0.4, to: 55, duration: 1500 } as const;

type MapCapture = FunctionReturnType<typeof api.animals.listCaptures>[number];
type LocatedCapture = MapCapture & { latitude: number; longitude: number };

function lightPresetForHour(hour: number): 'dawn' | 'day' | 'dusk' | 'night' {
  if (hour < 6 || hour >= 21) return 'night';
  if (hour < 9) return 'dawn';
  if (hour < 18) return 'day';
  return 'dusk';
}

/** Frames every pin: bounding-box midpoint, zoomed so the widest span fits.
 * `log2(360 / span)` is the standard web-mercator zoom for a span in degrees. */
function fitCamera(captures: LocatedCapture[]) {
  if (captures.length === 0) {
    return { center: [2.35, 46.6] as [number, number], zoom: 4.5 };
  }
  const lats = captures.map((c) => c.latitude);
  const lons = captures.map((c) => c.longitude);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);
  const span = Math.max(latMax - latMin, lonMax - lonMin);
  const zoom = span === 0 ? 12 : Math.min(12, Math.max(2, Math.log2(360 / span) - 0.5));
  return {
    center: [(lonMin + lonMax) / 2, (latMin + latMax) / 2] as [number, number],
    zoom,
  };
}

/**
 * `embedded` is set when the map is a section of the hub tab rather than a
 * pushed route: there is nothing to go back to from a tab, so the back pill is
 * dropped and the sheet sits above the app's own tab bar.
 */
export default function MapScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const { t: copy } = useUiTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  /**
   * `/map?capture=<id>` — ouvert depuis la fiche d'une carte.
   *
   * En mode `embedded` la carte est une section de l'onglet Espaces : les
   * paramètres de route appartiennent à cet onglet-là et ne nous concernent
   * pas.
   */
  const { capture: focusId } = useLocalSearchParams<{ capture?: string }>();
  const focusCaptureId = embedded ? undefined : focusId;
  const insets = useSafeAreaInsets();
  const { isAuthenticated, userId } = useBackendAuth();
  const captures = useQuery(api.animals.listCaptures, isAuthenticated ? {} : 'skip');
  const { isPremium } = usePremium();
  const [zoo, setZoo] = useState<ZooMapSite | null>(null);
  const zoos = useServerQuery({ queryKey: ['zoo-map-sites'], queryFn: fetchZooMapSites,
    enabled: isAuthenticated && isPremium, staleTime: 15 * 60 * 1000, retry: 1 });
  const { ask, gate, openSettings } = useLocationGate();
  const mapRef = useRef<MapView>(null);
  const sourceRef = useRef<ShapeSource>(null);
  /**
   * `undefined` = le joueur n'a encore rien touché, donc l'épingle demandée par
   * l'URL fait foi ; `null` = il a lâché la sélection. Un état à trois valeurs
   * plutôt qu'un effet qui pose la sélection après coup : poser un `setState`
   * dans un effet relance un rendu en cascade, et le compilateur le refuse.
   */
  const [picked, setPicked] = useState<MapCapture | null | undefined>(undefined);
  const lightPreset = useMemo(() => lightPresetForHour(new Date().getHours()), []);

  const located = useMemo(
    () =>
      (captures ?? []).filter(
        (capture): capture is LocatedCapture =>
          capture.latitude !== undefined && capture.longitude !== undefined,
      ),
    [captures],
  );

  // Chaque capture porte son propre die-cut sur la carte. Les vignettes sont
  // fabriquées et mises en cache par `usePinIcons` ; tant qu'une n'est pas
  // prête, la feature n'a pas de propriété `icon` et retombe sur la pastille.
  //
  // C'est aussi le verrou premium, et il tient en une ligne : sans die-cut, la
  // couche `capture-pins` ne filtre plus rien et tout retombe sur `capture-points`,
  // la pastille ambre qui existait déjà pour l'attente. Un compte gratuit voit
  // donc son territoire — combien, où — mais pas ses animaux. Rien ne lui a été
  // retiré : ça n'a jamais été là. Et on ne fabrique pas quarante vignettes
  // pour quelqu'un qui ne les verra pas.
  const pinIcons = usePinIcons(isPremium ? located : []);

  const shape = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: 'FeatureCollection',
      features: located.map((capture) => {
        const icon = pinIconKey(capture._id);
        return {
          type: 'Feature' as const,
          id: capture._id,
          properties: {
            captureId: capture._id,
            ...(pinIcons[icon] ? { icon } : null),
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [capture.longitude, capture.latitude],
          },
        };
      }),
    }),
    [located, pinIcons],
  );

  const initialCamera = useMemo(() => fitCamera(located), [located]);
  /** L'épingle demandée par l'URL, dès que les captures sont là. */
  const requested = useMemo(
    () =>
      focusCaptureId
        ? located.find((capture) => capture._id === focusCaptureId) ?? null
        : null,
    [focusCaptureId, located],
  );
  const selected = picked === undefined ? requested : picked;
  /**
   * D'où la caméra part. `defaultSettings` n'est lu qu'au montage : si les
   * captures sont déjà en cache MMKV, l'épingle demandée est connue dès la
   * première frame et on démarre en orbite au-dessus d'elle. Sinon on garde le
   * cadrage d'ensemble et la descente se fera en biais — moins beau, jamais
   * cassé.
   */
  const startCamera = useMemo(
    () =>
      requested
        ? { center: [requested.longitude, requested.latitude] as [number, number], zoom: DIVE.from }
        : initialCamera,
    [initialCamera, requested],
  );
  /** Read by the layer expressions below. '' matches nothing, which is the point. */
  const selectedId = selected?._id ?? '';


  const cameraRef = useRef<Camera>(null);
  const zoomRef = useRef(initialCamera.zoom);
  const hadSelection = useRef(false);
  const [pulseRadius] = useState(() => new RNAnimated.Value(PULSE.from));
  const [pulseOpacity] = useState(() => new RNAnimated.Value(PULSE.fromOpacity));

  // The opening shot. A beat of stillness first: the map has to have drawn
  // something before it is worth flying over.
  useEffect(() => {
    // Sauf si on entre par une carte précise : le plan large partirait en même
    // temps que le plongeon sur l'épingle, et les deux vols se disputeraient la
    // caméra.
    if (focusCaptureId) return;
    const timer = setTimeout(() => {
      cameraRef.current?.setCamera({
        animationDuration: OPENING.duration,
        animationMode: 'flyTo',
        centerCoordinate: initialCamera.center,
        heading: OPENING.heading,
        pitch: OPENING.pitch,
        zoomLevel: Math.max(initialCamera.zoom, 5),
      });
    }, OPENING.delay);
    return () => clearTimeout(timer);
    // Once, on the way in — a later data load must not re-fly the camera out
    // from under a player who has already started panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** La descente d'entrée n'a lieu qu'une fois, pas à chaque sélection. */
  const dived = useRef(false);

  // Into the street on select, back out on deselect.
  useEffect(() => {
    if (selected?.latitude !== undefined && selected.longitude !== undefined) {
      const entrance = !dived.current && requested?._id === selected._id;
      if (entrance) {
        dived.current = true;
        // Capturés hors de la fermeture : TypeScript perd l'affinement du
        // `!== undefined` dès qu'on entre dans un `setTimeout`.
        const target: [number, number] = [selected.longitude, selected.latitude];
        // Le temps que les tuiles de la planète se dessinent : plonger sur un
        // globe encore gris ne montre rien de la descente.
        const timer = setTimeout(() => {
          cameraRef.current?.setCamera({
            animationDuration: DIVE.duration,
            animationMode: 'flyTo',
            centerCoordinate: target,
            heading: DIVE.heading,
            pitch: DIVE.pitch,
            zoomLevel: DIVE.zoom,
          });
        }, DIVE.delay);
        // Le tic à l'ATTERRISSAGE, pas au départ : c'est l'arrivée sur
        // l'animal qui est l'événement, le décollage n'est qu'une intention.
        const landing = setTimeout(() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
        }, DIVE.delay + DIVE.duration);
        hadSelection.current = true;
        return () => {
          clearTimeout(timer);
          clearTimeout(landing);
        };
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      cameraRef.current?.setCamera({
        animationDuration: FOCUS.duration,
        animationMode: 'flyTo',
        centerCoordinate: [selected.longitude, selected.latitude],
        // Never zoom back OUT to focus: if the player is already closer than
        // the focus level, respect where they got to.
        zoomLevel: Math.max(zoomRef.current, FOCUS.zoom),
        // A different yaw every time, so two selections in a row are not the
        // same shot twice.
        heading: (Math.random() - 0.5) * 40,
        pitch: FOCUS.pitch,
      });
    } else if (hadSelection.current) {
      cameraRef.current?.setCamera({
        animationDuration: REST.duration,
        animationMode: 'flyTo',
        heading: 0,
        pitch: REST.pitch,
      });
    }
    hadSelection.current = selected !== null;
  }, [requested, selected]);

  // Sonar under the selected pin. Legacy Animated on purpose: it drives a
  // Mapbox layer style, which is not a Reanimated surface.
  useEffect(() => {
    if (!selected?.latitude) return;
    pulseRadius.setValue(PULSE.from);
    pulseOpacity.setValue(PULSE.fromOpacity);
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.parallel([
          RNAnimated.timing(pulseRadius, { toValue: PULSE.to, duration: PULSE.duration, useNativeDriver: false }),
          RNAnimated.timing(pulseOpacity, { toValue: 0, duration: PULSE.duration, useNativeDriver: false }),
        ]),
        RNAnimated.parallel([
          RNAnimated.timing(pulseRadius, { toValue: PULSE.from, duration: 0, useNativeDriver: false }),
          RNAnimated.timing(pulseOpacity, { toValue: PULSE.fromOpacity, duration: 0, useNativeDriver: false }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseOpacity, pulseRadius, selected]);

  const selectCapture = useCallback((capture: MapCapture) => {
    setPicked(capture);
  }, []);

  /** Tapping the map itself lets go of the pin, and says so with a tap. */
  const clearSelection = useCallback(() => {
    // `selected`, pas la valeur précédente de `picked` : à l'ouverture depuis
    // une fiche, `picked` vaut encore `undefined` alors qu'une épingle est bel
    // et bien sélectionnée, et le lâcher mérite son tic.
    if (selected) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setPicked(null);
  }, [selected]);

  const onFeaturePress = useCallback(
    async (event: { features: GeoJSON.Feature[] }) => {
      const feature = event.features[0];
      if (!feature) return;

      // A single capture: select it, and let the camera drop into the street.
      if (!feature.properties?.point_count) {
        // La descente dans la rue EST la carte premium. Un gratuit peut plonger
        // dans ses grappes — voir la forme de son territoire — mais l'animal au
        // bout est ce qu'il achète.
        if (!isPremium) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          router.push('/paywall');
          return;
        }
        const id = feature.properties?.captureId;
        const capture = located.find((item) => item._id === id);
        if (capture) selectCapture(capture);
        return;
      }

      const zoom = await sourceRef.current?.getClusterExpansionZoom(feature);
      const [longitude, latitude] = (feature.geometry as GeoJSON.Point).coordinates;
      if (zoom === undefined) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      // Diving into a cluster tilts a little as it goes, so the split is a
      // move through the scene rather than a jump cut.
      cameraRef.current?.setCamera({
        animationDuration: 900,
        animationMode: 'flyTo',
        centerCoordinate: [longitude, latitude],
        pitch: 45,
        zoomLevel: zoom + 0.4,
      });
    },
    [isPremium, located, router, selectCapture],
  );

  /** Sans abonnement, la carte est là mais illisible. */
  const locked = !isPremium;
  const card = useMemo(
    () =>
      mapGate({
        captureCount: captures?.length ?? 0,
        gate,
        isPremium,
        locatedCount: located.length,
      }),
    [captures, gate, isPremium, located.length],
  );

  /**
   * La sortie. Une croix et non un chevron : la carte est un modal — elle se
   * ferme, elle ne se dépile pas.
   *
   * Elle existe malgré le glissement natif du modal parce que Mapbox pose son
   * propre gestionnaire de panoramique sur toute la vue : un glissement vers le
   * bas déplace la carte, il ne la referme pas. Sans cette croix il n'y a
   * aucune sortie.
   *
   * Encre noire sur verre clair : le verre prend la couleur de ce qu'il y a
   * dessous, et sous cette pastille il y a la carte en plein jour. Un chevron
   * blanc s'y perdait.
   */
  const backButton = (
    <GlassView
      isInteractive
      style={[styles.back, { left: insets.left + 20, top: Math.max(insets.top, 16) }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy("reveal_close")}
        style={styles.backTarget}
        onPress={() => navigation.goBack()}
      >
        <SymbolView name="xmark" size={17} tintColor="#0b0b0b" weight="semibold" />
      </Pressable>
    </GlassView>
  );

  if (!MAPBOX_TOKEN) {
    return (
      <View style={styles.screen}>
        {embedded ? null : backButton}
        <EmptyState
          message={
            'Ajoute EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN dans ton fichier .env\npour afficher la carte des captures.'
          }
          title={copy("ui_copy_160")}
        />
      </View>
    );
  }

  // MAPBOX N'EST PAS MONTÉ POUR UN NON-ABONNÉ, ET C'EST LA VRAIE CORRECTION.
  //
  // La carte était rendue pour tout le monde et le verrou n'était qu'un flou
  // PAR-DESSUS : les tuiles partaient quand même, facturées, pour un écran que
  // personne ne pouvait lire. Un fond déjà flou remplace la carte entièrement —
  // zéro requête, zéro coût, et le rendu ne dépend plus du réseau.
  //
  // Le flou est CUIT dans l'image plutôt qu'appliqué par `BlurView` : moins de
  // travail au rendu, et surtout un résultat garanti, là où l'intensité d'un
  // flou natif change avec l'appareil.
  if (locked) {
    return (
      <View style={[styles.screen, styles.lockedBackdrop]}>
        <ExpoImage
          contentFit="cover"
          source={require('../../../assets/map-locked-bg.jpg')}
          style={StyleSheet.absoluteFill}
          transition={220}
        />
        {embedded ? null : backButton}
        {card ? (
          <MapGateCard
            bottom={insets.bottom + (embedded ? EMBEDDED_BOTTOM : 24)}
            card={card}
            centered
            gate={gate}
            onLocation={() => (gate === 'settings' ? openSettings() : void ask())}
            onUnlock={() => router.push('/paywall')}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <MapView
        ref={mapRef}
        attributionEnabled={false}
        logoEnabled={false}
        // The gestures have to carry momentum, or every one of the camera
        // moves above lands on a map that stops dead when the finger lifts.
        gestureSettings={{
          doubleTapToZoomInEnabled: true,
          panDecelerationFactor: 0.99,
          pinchZoomDecelerationEnabled: true,
          rotateDecelerationEnabled: true,
          simultaneousRotateAndPinchZoomEnabled: true,
        }}
        onCameraChanged={(event) => {
          const zoom = event?.properties?.zoom;
          if (zoom !== undefined) zoomRef.current = zoom;
        }}
        onPress={clearSelection}
        pitchEnabled
        // A globe rather than a flat sheet: zoomed out, a collection scattered
        // over a continent should look like it is on a planet.
        projection="globe"
        rotateEnabled
        scaleBarEnabled={false}
        style={styles.map}
        styleURL="mapbox://styles/mapbox/standard"
      >
        <StyleImport config={{ lightPreset }} existing id="basemap" />

        {/* Real sky above the horizon — what makes a 55° pitch read as a
            landscape instead of a tilted map. */}
        <SkyLayer
          id="sky"
          style={{
            skyAtmosphereSun: [0.0, 45.0],
            skyAtmosphereSunIntensity: 15.0,
            skyType: 'atmosphere',
          }}
        />

        {/* Terrain. The exaggeration is deliberate: at 1.0 a real valley is
            almost flat on a phone. */}
        <RasterDemSource
          id="mapbox-dem"
          maxZoomLevel={14}
          tileSize={514}
          url="mapbox://mapbox.mapbox-terrain-dem-v1"
        >
          <Terrain style={{ exaggeration: 1.5 }} />
        </RasterDemSource>

        <Camera
          animationDuration={1200}
          animationMode="flyTo"
          defaultSettings={{
            centerCoordinate: startCamera.center,
            pitch: 0,
            zoomLevel: startCamera.zoom,
          }}
          ref={cameraRef}
        />
        {/* Sonar under the selected pin. Its own source: it has to sit under
            everything, and it is the only thing on the map that moves by
            itself. */}
        {selected?.latitude !== undefined && selected.longitude !== undefined ? (
          <MapboxAnimated.ShapeSource
            id="capture-pulse"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [selected.longitude, selected.latitude] },
            }}
          >
            <MapboxAnimated.CircleLayer
              id="capture-pulse-ring"
              style={{
                circleBlur: 0.6,
                circleColor: AMBER,
                circleOpacity: pulseOpacity,
                // Pinned to the map, not the screen: the ring lies on the
                // ground and skews with the pitch, like a real light would.
                circlePitchAlignment: 'map',
                circleRadius: pulseRadius,
              }}
            />
          </MapboxAnimated.ShapeSource>
        ) : null}

        {/* Les die-cuts, enregistrés comme images de style. Ce sont des
            vignettes de 128px écrites sur disque par `usePinIcons`, pas les
            originaux : un sticker fait 850x1050, et l'atlas de texture n'en
            supporterait pas quarante.

            `onImageMissing` est là parce que cette voie échoue en silence : le
            natif ignore purement et simplement une entrée qu'il ne sait pas
            lire, sans journaliser quoi que ce soit. Une couche qui réclame une
            image absente est le seul signal qui remonte. */}
        <Images
          images={pinIcons}
          onImageMissing={(key) => console.warn('map pin image manquante', key)}
        />

        <ShapeSource
          ref={sourceRef}
          cluster
          clusterRadius={48}
          id={SOURCE_ID}
          onPress={onFeaturePress}
          shape={shape}
        >
          {/* Four layers make a cluster, not one. Shadow, glow, disc, count —
              stacked bottom to top, exactly as the agenda map stacks them.
              A single flat circle on a tilted 3D map reads as a sticker; the
              shadow is what sets it down on the ground. */}
          <CircleLayer
            filter={['has', 'point_count']}
            id="capture-cluster-shadow"
            style={{
              circleBlur: 1,
              circleColor: 'rgba(0,0,0,0.2)',
              circlePitchAlignment: 'map',
              circleRadius: 32,
              // Offset in screen space, so the shadow stays under the disc
              // whatever the camera does.
              circleTranslate: [0, 3],
              circleTranslateAnchor: 'viewport',
            }}
          />
          <CircleLayer
            filter={['has', 'point_count']}
            id="capture-cluster-glow"
            style={{
              circleBlur: 0.6,
              circleColor: CLUSTER,
              // Mapbox Standard shades custom layers with the night light.
              // Emit the cluster colour so the beige stays identical to day.
              circleEmissiveStrength: 1,
              circleOpacity: 0.15,
              circlePitchAlignment: 'map',
              circleRadius: 42,
              // Transitions on radius are what makes a cluster grow into place
              // as the map settles instead of snapping between step values.
              circleRadiusTransition: { delay: 0, duration: 600 },
            }}
          />
          <CircleLayer
            filter={['has', 'point_count']}
            id="capture-clusters"
            style={{
              circleColor: CLUSTER,
              circleEmissiveStrength: 1,
              circlePitchAlignment: 'map',
              circleRadius: ['step', ['get', 'point_count'], 28, 5, 32, 10, 36],
              circleRadiusTransition: { delay: 0, duration: 400 },
              // Encre, pas blanc : un liseré blanc sur un disque beige ne
              // détache plus rien et le cluster se dilue dans la carte claire.
              circleStrokeColor: AMBER,
              circleStrokeWidth: 2.5,
            }}
          />
          {/* The individual captures, as REAL layers rather than floating
              MarkerViews. That is what makes them tappable at all: a
              ShapeSource only reports a press on a feature it actually draws,
              so a pin with no layer can never be hit.

              The shadow stays flat on the ground under every pin — it is what
              sets the animal down on the terrain instead of leaving it
              floating over a tilted map. */}
          <CircleLayer
            filter={['!', ['has', 'point_count']]}
            id="capture-shadow"
            style={{
              circleBlur: 1,
              circleColor: 'rgba(0,0,0,0.25)',
              circlePitchAlignment: 'map',
              circleRadius: ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 12, 14, 14],
              circleTranslate: [0, 3],
              circleTranslateAnchor: 'viewport',
            }}
          />
          <CircleLayer
            filter={['!', ['has', 'point_count']]}
            id="capture-glow"
            style={{
              circleBlur: 0.6,
              circleColor: AMBER,
              // The selected one keeps a brighter halo, so it stays findable
              // once the camera has tilted into the street.
              circleOpacity: ['case', ['==', ['get', 'captureId'], selectedId], 0.45, 0.2],
              circleOpacityTransition: { delay: 0, duration: 400 },
              circlePitchAlignment: 'map',
              circleRadius: ['interpolate', ['linear'], ['zoom'], 3, 18, 8, 22, 14, 26],
              circleRadiusTransition: { delay: 0, duration: 600 },
            }}
          />
          {/* La pastille de repli, uniquement là où la vignette n'est pas
              encore fabriquée : une capture ne doit jamais devenir invisible
              en attendant son image. */}
          <CircleLayer
            filter={['all', ['!', ['has', 'point_count']], ['!', ['has', 'icon']]]}
            id="capture-points"
            style={{
              circleColor: AMBER,
              circlePitchAlignment: 'map',
              // `zoom` may only be the input of a TOP-LEVEL step/interpolate —
              // it cannot sit inside a `case`. So the interpolation is on the
              // outside and the selection test is what each stop returns.
              circleRadius: [
                'interpolate',
                ['linear'],
                ['zoom'],
                3, ['case', ['==', ['get', 'captureId'], selectedId], 20, 12],
                8, ['case', ['==', ['get', 'captureId'], selectedId], 20, 14],
                14, ['case', ['==', ['get', 'captureId'], selectedId], 20, 16],
              ],
              circleRadiusTransition: { delay: 0, duration: 300 },
              circleStrokeColor: '#ffffff',
              circleStrokeWidth: 2.5,
            }}
          />
          {/* L'animal lui-même. `iconAnchor: 'bottom'` le fait tenir DEBOUT sur
              son point : ancré au centre il flotterait au-dessus, et son ombre
              au sol tomberait au milieu de son corps.

              Ni `iconPitchAlignment` ni `iconRotationAlignment` en `map` : le
              die-cut doit rester face à l'objectif quand la caméra s'incline à
              65°, sinon l'animal se couche par terre. L'ombre, elle, est bien
              collée au sol — c'est cette différence qui le fait tenir debout. */}
          <SymbolLayer
            filter={['all', ['!', ['has', 'point_count']], ['has', 'icon']]}
            id="capture-pins"
            style={{
              iconAllowOverlap: true,
              iconAnchor: 'bottom',
              iconIgnorePlacement: true,
              iconImage: ['get', 'icon'],
              // La vignette fait 128px de côté : 0.32 la rend à ~41pt, et la
              // sélectionnée passe à ~58pt.
              iconSize: [
                'interpolate',
                ['linear'],
                ['zoom'],
                3, ['case', ['==', ['get', 'captureId'], selectedId], 0.45, 0.26],
                8, ['case', ['==', ['get', 'captureId'], selectedId], 0.5, 0.32],
                14, ['case', ['==', ['get', 'captureId'], selectedId], 0.58, 0.38],
              ],
              // Décollé du sol de la moitié de l'ombre, pour que les pattes
              // posent dessus au lieu d'être dessus.
              iconTranslate: [0, 4],
              iconTranslateAnchor: 'viewport',
            }}
          />
          <SymbolLayer
            filter={['has', 'point_count']}
            id="capture-cluster-counts"
            style={{
              textAllowOverlap: true,
              textColor: '#241a04',
              textEmissiveStrength: 1,
              textField: ['get', 'point_count_abbreviated'],
              textIgnorePlacement: true,
              // Steps with the disc it sits on.
              textPitchAlignment: 'map',
              textSize: ['step', ['get', 'point_count'], 16, 5, 18, 10, 20],
            }}
          />
        </ShapeSource>
        <ZooMapLayer belowLayerID="capture-cluster-shadow" sites={zoos.data ?? []} onSelect={setZoo} onZoom={(centerCoordinate, zoomLevel) => {
          cameraRef.current?.setCamera({ centerCoordinate, zoomLevel, animationDuration: 700 });
        }} />
      </MapView>
      <ZooMapSheet key={userId} site={zoo} onClose={() => setZoo(null)} />

      {/* Le verrou. Un dépoli par-dessus la carte vivante, pas une image de
          remplacement : le globe tourne, le terrain se soulève, les pastilles
          de ses propres captures brillent dessous — il voit qu'il y a quelque
          chose et il ne peut rien lire. C'est ça qui se vend.

          Il mange aussi les gestes, donc la carte est bel et bien fermée : le
          garde-fou de `onFeaturePress` reste par sécurité si jamais la couche
          native laissait passer un tap. */}
      {locked ? <BlurView intensity={LOCK_BLUR} style={styles.lock} tint="dark" /> : null}

      {embedded ? null : backButton}

      {card ? (
        <MapGateCard
          bottom={insets.bottom + (embedded ? EMBEDDED_BOTTOM : 24)}
          card={card}
          centered={locked}
          gate={gate}
          onLocation={() => (gate === 'settings' ? openSettings() : void ask())}
          onUnlock={() => router.push('/paywall')}
        />
      ) : null}
    </View>
  );
}

/**
 * Le carton de la carte. Centré et frontal quand la carte est verrouillée —
 * c'est alors le sujet de l'écran ; posé en bas et passif quand elle est
 * ouverte — le joueur est venu voir ses captures, pas lire un message.
 *
 * Un seul carton, jamais deux : `mapNotice` a déjà tranché lequel, et la règle
 * qu'il applique tient toujours ici. Si la position manque, c'est ELLE qui
 * s'affiche même par-dessus le flou — on ne vend pas SafaRoll+ à quelqu'un
 * dont la carte sera vide après l'achat.
 */
function MapGateCard({
  bottom,
  card,
  centered,
  gate,
  onLocation,
  onUnlock,
}: {
  bottom: number;
  card: MapGate;
  centered: boolean;
  gate: LocationGate;
  onLocation: () => void;
  onUnlock: () => void;
}) {
  const { t: copy } = useUiTranslation();
  const noticeCopy =
    card.kind === 'location'
      ? {
          action: locationCallToAction(gate),
          body: copy("ui_copy_282"),
          onPress: onLocation,
          title: copy('map_missing_location', { count: card.captureCount }),
        }
      : card.kind === 'pending'
        ? {
            action: null,
            body: copy("ui_copy_283"),
            onPress: undefined,
            title: copy("ui_copy_284"),
          }
        : {
            action: copy("ui_copy_285"),
            body:
              card.locatedCount > 0
                ? copy("ui_copy_286")
                : copy("ui_copy_287"),
            onPress: onUnlock,
            title:
              card.locatedCount === 0
                ? copy('map_capture_map')
                : copy('map_waiting', { count: card.locatedCount }),
          };

  // LE VERROU PREMIUM A SON PROPRE CARTON, ET C'EST UNE DIFFÉRENCE DE SUJET.
  //
  // Les autres états parlent de la POSITION — une autorisation refusée, une
  // capture non située : ils commentent une carte VIVANTE, donc ils restent en
  // verre sombre, posés dessus. Le verrou, lui, EST l'écran : derrière il n'y a
  // plus qu'un fond flou, et un carton sombre s'y enfonce au lieu de s'en
  // détacher. Il passe donc au clair, centré, avec l'icône de l'app en tête —
  // ce qu'on vend n'est pas une fonctionnalité de la carte, c'est l'app en
  // entier.
  //
  // `premium` implique `centered` : `mapGate` ne rend cette branche que quand
  // `!isPremium`, et c'est exactement ce qui vaut `locked` aux deux appels.
  if (card.kind === 'premium') {
    return (
      <View style={styles.gate}>
        <View style={styles.gateIcon}>
          <ExpoImage
            contentFit="cover"
            source={require('../../../assets/map-premium-pirate-icon.png')}
            style={styles.gateIconImage}
          />
        </View>
        <Text style={styles.gateTitle}>{noticeCopy.title}</Text>
        <Text style={styles.gateBody}>{noticeCopy.body}</Text>
        <ShimmerPressableView
          accessibilityRole="button"
          backgroundColor="#E3A93C"
          borderRadius={27}
          containerStyle={styles.gateAction}
          height={54}
          onPress={onUnlock}
          shimmerConfig={{
            color: 'rgba(255, 255, 255, 0.55)',
            delay: 1200,
            duration: 900,
            stripeCount: 5,
          }}
        >
          <SymbolView name="lock.open.fill" size={15} tintColor="#ffffff" weight="semibold" />
          <Text style={styles.gateActionText}>{noticeCopy.action}</Text>
        </ShimmerPressableView>
      </View>
    );
  }

  return (
    <GlassView style={[styles.notice, centered ? styles.noticeCentered : { bottom }]}>
      <Text style={styles.noticeTitle}>{noticeCopy.title}</Text>
      <Text style={styles.noticeBody}>{noticeCopy.body}</Text>
      {noticeCopy.action ? (
        <Pressable
          accessibilityRole="button"
          onPress={noticeCopy.onPress}
          style={({ pressed }) => [styles.noticeAction, pressed && styles.noticePressed]}
        >
          <Text style={styles.noticeActionText}>{noticeCopy.action}</Text>
          <SymbolView name="arrow.right" size={14} tintColor="#241a04" />
        </Pressable>
      ) : null}
    </GlassView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: '#100b04',
  },
  lockedBackdrop: {
    backgroundColor: '#A9D7E9',
  },
  map: {
    flex: 1,
  },
  back: {
    position: 'absolute',
    zIndex: 5,
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 100,
  },
  backTarget: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerSelected: {
    transform: [{ scale: 1.18 }],
    borderColor: '#fff8e5',
  },
  // Le dépoli. `zIndex` 4 : sous le carton et sous le bouton retour (5), au-
  // dessus de la carte. Il est tappable exprès — c'est ce qui ferme la carte.
  lock: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 4,
  },
  notice: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 6,
    padding: 18,
    borderRadius: 24,
    gap: 8,
    // La carte n'a pas de thème : elle a un paysage derrière. L'encre y est
    // fixe, comme celle de la barre du hub.
    backgroundColor: 'rgba(16,11,4,0.55)',
  },
  // Verrouillée, la carte n'a plus de contenu à laisser voir : le carton monte
  // au centre et devient le sujet de l'écran au lieu d'un rappel en bas.
  noticeCentered: {
    top: '50%',
    transform: [{ translateY: '-50%' }],
    padding: 22,
  },
  // LE CARTON DU VERROU. Blanc opaque et non du verre : le fond est un flou
  // pastel: un verre teinté y prendrait la couleur du ciel et le texte
  // flotterait. L'ombre portée le décolle de la carte, sinon le blanc du carton
  // et le blanc des nuages se touchent sans frontière.
  gate: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '50%',
    transform: [{ translateY: '-50%' }],
    zIndex: 6,
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderRadius: 30,
    backgroundColor: '#ffffff',
    shadowColor: '#0b1220',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 30,
  },
  gateIcon: { marginBottom: 8 },
  gateIconImage: { width: 76, height: 76, borderRadius: 20 },
  gateTitle: {
    color: '#0b0b0b',
    fontFamily: theme.fonts.display,
    fontSize: 23,
    lineHeight: 28,
    textAlign: 'center',
  },
  gateBody: {
    color: 'rgba(11,11,11,0.52)',
    fontFamily: theme.fonts.regular,
    fontSize: 14.5,
    lineHeight: 21,
    textAlign: 'center',
  },
  gateAction: {
    marginTop: 14,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  gateActionText: {
    color: '#ffffff',
    fontFamily: theme.fonts.bold,
    fontSize: 16,
  },
  noticeTitle: {
    color: '#fff8e5',
    fontFamily: theme.fonts.display,
    fontSize: 19,
  },
  noticeBody: {
    color: 'rgba(255,248,229,0.68)',
    fontFamily: theme.fonts.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  noticeAction: {
    marginTop: 6,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 14,
    backgroundColor: '#e9b84d',
  },
  noticeActionText: {
    color: '#241a04',
    fontFamily: theme.fonts.bold,
    fontSize: 14,
  },
  noticePressed: { opacity: 0.75 },
}));
