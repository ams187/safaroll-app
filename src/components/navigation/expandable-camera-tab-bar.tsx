import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { useCardOverlayOpen } from '@/components/cards/card-overlay-state';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { SymbolView } from 'expo-symbols';
import { Image } from 'expo-image';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput, type CameraRef } from 'react-native-vision-camera';
import { useAnimalScout } from '@/components/camera/animal-scout';
import { WildlifeSoundCue } from '@/components/camera/wildlife-sound-cue';
import { scheduleOnRN } from 'react-native-worklets';
import type { Image as PreviewImage } from 'react-native-nitro-image';
import { writeUprightCapture } from '@/lib/animals/capture-photo';
import { remainingCaptureEnergy } from '@/lib/animals/capture-energy';
import { FlashButton } from '@/components/capture/flash-menu-button';
import { useFlashMode } from '@/lib/camera/flash';
import { readCaptureLocation, useLocationGate } from '@/lib/location-permission';
import { CAPTURE_PHOTO_OUTPUT, formatZoom, opticalZoomOptions, SAFARI_CAMERA_FILTER } from '@/lib/camera/optics';
import { Press3D } from '@/components/ui/press-3d';
import { api } from '@/lib/supabase/api';
import { useQuery as useBackendQuery } from '@/lib/supabase/backend';
import { usePremium } from '@/lib/premium';
import {
  consumeExpandableCameraRequest,
  stashPendingCapture,
  useExpandableCameraRequest,
} from './expandable-camera-state';
import { CurvedLiquidTabBar } from './curved-liquid-tab-bar';

const SPRING = { damping: 100, stiffness: 600 };
const VISIBLE_ROUTES = [
  { key: 'collection', name: '(home)' },
  { key: 'camera-action', name: 'camera' },
  { key: 'hub', name: '(spaces)' },
] as const;
/**
 * La hauteur de la barre au repos, HORS encart du bas — sa hauteur réelle est
 * `COLLAPSED_HEIGHT + insets.bottom`.
 *
 * Exportée parce qu'elle flotte au-dessus des écrans au lieu de leur prendre de
 * la place : chaque page qui défile doit réserver ce dégagement elle-même, et
 * jusqu'ici chacune le devinait avec un nombre en dur (140 ici, 170 là, 112
 * ailleurs). Le dernier bouton de la page passait sous la barre sur les
 * téléphones à encoche, où l'encart ajoute 34 points que personne ne comptait.
 */
export const TAB_BAR_COLLAPSED_HEIGHT = 92;
const COLLAPSED_HEIGHT = TAB_BAR_COLLAPSED_HEIGHT;

type CameraTabBarProps = Pick<BottomTabBarProps, 'navigation' | 'state'> & {
  onboarding?: { onCaptureComplete: (captureId?: string) => void; onClose: () => void };
};

export function OnboardingCamera({
  onCaptureComplete,
  onClose,
}: {
  onCaptureComplete: (captureId?: string) => void;
  onClose: () => void;
}) {
  return (
    <ExpandableCameraTabBar
      navigation={{} as BottomTabBarProps['navigation']}
      onboarding={{ onCaptureComplete, onClose }}
      state={{ index: 0, routes: [{ key: 'onboarding-home', name: '(home)' }] } as BottomTabBarProps['state']}
    />
  );
}

export function ExpandableCameraTabBar({ navigation, onboarding, state }: CameraTabBarProps) {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const device = useCameraDevice('back', SAFARI_CAMERA_FILTER);
  const photoOutput = usePhotoOutput(CAPTURE_PHOTO_OUTPUT);
  const { mode: flashMode } = useFlashMode();
  const { canRequestPermission, hasPermission, requestPermission } = useCameraPermission();
  const { gate: locationGate } = useLocationGate();

  /**
   * LE BOUTON NE PEUT PLUS NE RIEN FAIRE.
   *
   * iOS n'ouvre sa boîte de dialogue QU'UNE FOIS. Après un « Ne pas
   * autoriser », `requestPermission()` retourne `false` immédiatement, sans
   * rien afficher : un bouton « Autoriser » mort, et un joueur enfermé dans le
   * viseur sans aucune sortie — c'est ce qui est arrivé.
   *
   * `canRequestPermission` sert à écrire le bon texte, jamais à décider : il
   * rapporte un état mis en cache par VisionCamera, et s'il se trompe le bouton
   * redevient mort. On tente donc, et si la demande revient sans avoir rien
   * affiché, on ouvre les Réglages — le seul endroit où le droit peut encore
   * être rendu.
   */
  const demanderOuReglages = useCallback(async () => {
    if (await requestPermission()) return;
    await Linking.openSettings().catch(() => undefined);
  }, [requestPermission]);
  const progress = useSharedValue(onboarding ? 1 : 0);
  const fullScreenProgress = useSharedValue(onboarding ? 1 : 0);
  const gestureStart = useSharedValue(0);
  const [expanded, setExpanded] = useState(onboarding !== undefined);
  /**
   * L'IMAGE FIGÉE À L'OUVERTURE.
   *
   * `isActive` ne bascule qu'au moment du tap, et démarrer une
   * `AVCaptureSession` prend quelques centaines de millisecondes — configurer
   * l'entrée, les sorties, lancer le flux. Pendant ce temps iOS laisse à
   * l'écran le DERNIER TAMPON de la session précédente : une photo figée de la
   * fois d'avant, qui saute brutalement au direct quand la première vraie image
   * arrive. On ne peut pas rendre le démarrage plus rapide ; on peut cesser de
   * montrer une image périmée en attendant.
   *
   * `onPreviewStarted` est le signal exact du natif : la prévisualisation
   * délivre. Avant lui, un voile couvre le viseur, et il se dissipe en 180 ms.
   */
  const previewVeil = useSharedValue(1);
  const veilStyle = useAnimatedStyle(() => ({ opacity: previewVeil.get() }));
  const [fullScreen, setFullScreen] = useState(onboarding !== undefined);
  const [onboardingAnimalVisible, setOnboardingAnimalVisible] = useState(false);
  const onboardingAnimalVisibleRef = useRef(false);
  const preparedLocation = useRef<ReturnType<typeof readCaptureLocation> | null>(null);
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);
  const [stakeoutArmed, setStakeoutArmed] = useState(false);
  const [trackerLocked, setTrackerLocked] = useState(false);
  const [zoom, setZoom] = useState(1);
  const captures = useBackendQuery(api.animals.listCaptures, {});
  const { isPremium } = usePremium();
  const reopenRequest = useExpandableCameraRequest();
  const cameraRef = useRef<CameraRef>(null);
  const scout = useAnimalScout(cameraRef, device?.supportsFocusMetering === true);
  const activeTab = state.routes[state.index];
  const nestedState = activeTab?.state;
  const nestedRoute = nestedState?.routes[nestedState.index ?? 0];
  // The enlarged card is an overlay inside a screen, so the route stays
  // `(home)/index` and none of the checks below can see it. Without this the
  // bar draws straight over the card it was opened from.
  const cardOpen = useCardOverlayOpen();
  const showTabBar =
    onboarding !== undefined || (!cardOpen &&
    (activeTab?.name === '(home)' || activeTab?.name === '(spaces)') &&
    (!nestedRoute || nestedRoute.name === 'index'));
  const expandedHeight = Math.min(windowHeight * 0.64, 620);
  const collapsedHeight = COLLAPSED_HEIGHT + insets.bottom;
  const travel = expandedHeight - collapsedHeight;
  const miniCabinetWidth = Math.max(0, windowWidth - 40);
  const miniCabinetHeight = expandedHeight - 56;
  const fullCabinetWidth = windowWidth - 16;
  const fullCabinetHeight = windowHeight - insets.top - insets.bottom - 16;
  const zoomOptions = useMemo(() => opticalZoomOptions(device), [device]);
  const unlimitedCaptures = __DEV__ || isPremium;
  const remainingEnergy = useMemo(
    () => unlimitedCaptures ? null : captures === undefined ? undefined : remainingCaptureEnergy(captures, false),
    [captures, unlimitedCaptures],
  );

  useEffect(() => {
    if (!expanded || locationGate !== 'granted') {
      preparedLocation.current = null;
      return;
    }
    preparedLocation.current ??= readCaptureLocation();
  }, [expanded, locationGate]);

  const focusCamera = (event: GestureResponderEvent, locked: boolean) => {
    if (!device?.supportsFocusMetering) return;
    const point = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
    setTrackerLocked(locked);
    void cameraRef.current
      ?.focusTo(point, {
        adaptiveness: locked ? 'locked' : 'continuous',
        autoResetAfter: locked ? null : 3,
        responsiveness: 'snappy',
      })
      .then(() => {
        if (process.env.EXPO_OS !== 'ios') return;
        return locked
          ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          : Haptics.selectionAsync();
      })
      .catch(() => setTrackerLocked(false));
  };

  const cycleZoom = () => {
    if (zoomOptions.length < 2) return;
    const currentZoom = cameraRef.current?.controller?.zoom ?? zoom;
    const nextZoom = zoomOptions.find((option) => option > currentZoom + 0.05) ?? zoomOptions[0] ?? zoom;
    setZoom(nextZoom);
    void cameraRef.current?.startZoomAnimation(nextZoom, 4).catch(() => undefined);
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
  };

  const setOpen = (open: boolean) => {
    if (!open) {
      setFullScreen(false);
      setTrackerLocked(false);
      setStakeoutArmed(false);
      fullScreenProgress.value = 0;
      void cameraRef.current?.resetFocus().catch(() => undefined);
    }
    setExpanded(open);
    progress.value = withSpring(open ? 1 : 0, SPRING);
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.selectionAsync();
    }
  };

  const setFullScreenOpen = (open: boolean) => {
    setFullScreen(open);
    fullScreenProgress.value = withSpring(open ? 1 : 0, SPRING);
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.selectionAsync();
    }
  };

  const reopenCamera = useEffectEvent(() => {
    setOpen(true);
    setFullScreenOpen(true);
  });

  useEffect(() => {
    if (!consumeExpandableCameraRequest()) return;
    queueMicrotask(reopenCamera);
  }, [reopenRequest]);

  const pan = Gesture.Pan()
    .enabled(!fullScreen)
    .activeOffsetY([-8, 8])
    .failOffsetX([-12, 12])
    .onBegin(() => {
      gestureStart.value = progress.value;
    })
    .onUpdate(({ translationY }) => {
      progress.set(Math.min(1, Math.max(0, gestureStart.value - translationY / travel)));
    })
    .onEnd(({ velocityY }) => {
      const open = velocityY < -250 || (velocityY < 250 && progress.value > 0.45);
      progress.set(withSpring(open ? 1 : 0, SPRING));
      scheduleOnRN(setExpanded, open);
    });

  const containerStyle = useAnimatedStyle(() => ({
    height: interpolate(
      progress.value,
      [0, 1],
      [collapsedHeight, interpolate(fullScreenProgress.value, [0, 1], [expandedHeight, windowHeight])],
    ),
    borderTopLeftRadius: interpolate(fullScreenProgress.value, [0, 1], [32, 0]),
    borderTopRightRadius: interpolate(fullScreenProgress.value, [0, 1], [32, 0]),
  }));

  const cabinetStyle = useAnimatedStyle(() => ({
    width: interpolate(fullScreenProgress.value, [0, 1], [miniCabinetWidth, fullCabinetWidth]),
    height: interpolate(fullScreenProgress.value, [0, 1], [miniCabinetHeight, fullCabinetHeight]),
  }));

  const tabsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.35], [1, 0]),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [0, 32]) }],
  }));

  const cameraStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.25, 0.7], [0, 1]),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [42, 0]) }],
  }));

  const cameraLayoutStyle = useAnimatedStyle(() => ({
    paddingTop: interpolate(fullScreenProgress.value, [0, 1], [36, insets.top + 8]),
    paddingRight: interpolate(fullScreenProgress.value, [0, 1], [20, 8]),
    paddingBottom: interpolate(fullScreenProgress.value, [0, 1], [20, insets.bottom + 8]),
    paddingLeft: interpolate(fullScreenProgress.value, [0, 1], [20, 8]),
  }));

  const expandedChromeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.18], [0, 1]),
  }));

  const openTab = (name: '(home)' | '(spaces)' | '(tidy)' | '(search)') => {
    const route = state.routes.find((candidate) => candidate.name === name);
    if (!route) return;
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) navigation.navigate(route.name, route.params);
  };

  const selectTab = (index: number) => {
    if (index === 1) {
      setOpen(true);
      return;
    }
    openTab(index === 0 ? '(home)' : '(spaces)');
  };

  /**
   * CE QUI DESCEND DANS LA BARRE DOIT AVOIR UNE IDENTITÉ IMMUABLE.
   *
   * `CurvedLiquidTabBar` termine son geste de glissement par
   * `scheduleOnRN(onSelect, index)` — un franchissement du thread UI vers le
   * thread JS. Worklets sérialise alors la fonction en « fonction distante » :
   * elle est inscrite sous un numéro dans `__remoteFunctionRegistry`, et le
   * geste ne transporte que ce numéro.
   *
   * `selectTab` juste au-dessus est déclarée en clair, donc RECRÉÉE À CHAQUE
   * RENDU. Et cette barre est montée sur TOUS les écrans, où elle rend sans
   * arrêt : état caméra, énergie restante, zoom, tiroir ouvert, progression des
   * gestes. Chaque rendu inscrivait donc une entrée de plus, et un geste parti
   * avec un ancien numéro allait le chercher dans un registre qui ne le
   * contenait plus :
   *
   *   JSIWorkletsModuleProxy.cpp:455
   *     remoteFunction->toJSValue(rt).getObject(rt)   ->   assert(isObject())
   *
   * Assertion C++, donc `abort()` : SIGABRT, pas une exception rattrapable.
   * C'est SAFAROLL-7, et comme le coupable est la barre et non l'écran, le
   * plantage tombait n'importe où — à l'ouverture d'une fiche aussi bien
   * qu'ailleurs.
   *
   * Le passage par une réf donne UNE fonction pour toute la vie de l'app, qui
   * appelle toujours la dernière version. Elle s'exécute sur le thread JS,
   * donc lire la réf y est sans danger.
   */
  const selectTabRef = useRef(selectTab);
  useEffect(() => {
    selectTabRef.current = selectTab;
  });
  const selectTabStable = useCallback((index: number) => selectTabRef.current(index), []);

  const takePhoto = async () => {
    if (!device || capturingRef.current) return;
    if (!onboarding && remainingEnergy === undefined) return;
    if (!onboarding && remainingEnergy === 0) {
      router.push('/paywall');
      return;
    }
    if (!hasPermission) {
      // Même impasse que le bouton : après un refus la demande ne montre plus
      // rien, et l'obturateur restait sans effet.
      await demanderOuReglages();
      return;
    }

    // `setCapturing` n'est visible qu'au rendu suivant. Le déclencheur manuel
    // et l'affût automatique pouvaient donc entrer ici sur la même frame,
    // déposer deux promesses puis pousser deux routes de révélation. La seconde
    // consommait la capture de la première et la première route se refermait.
    capturingRef.current = true;
    setCapturing(true);
    // Le tiroir passe en plein écran au moment même du déclenchement : la
    // capture prend quelques centaines de millisecondes, le ressort les met à
    // profit, et le modal du rituel arrive sur un écran déjà plein — pas de
    // petit panneau qui saute en plein écran à la coupe. Pas via
    // `setFullScreenOpen` : son tick haptique doublerait l'impact du
    // déclencheur sur la même frame.
    if (!fullScreen) {
      setFullScreen(true);
      fullScreenProgress.set(withSpring(1, SPRING));
    }
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    // L'écran bascule À L'APPUI, comme un vrai appareil photo. La capture et
    // l'écriture du fichier continuent ici pendant que l'écran de révélation
    // est déjà plein cadre ; il attend la promesse, pas l'inverse. Les chronos
    // restent : ce tronçon a déjà été accusé à l'aveugle une fois.
    const pressed = Date.now();
    const location = preparedLocation.current
      ?? (locationGate === 'granted' ? readCaptureLocation() : Promise.resolve(undefined));
    let deliverPreview: (image: PreviewImage | null) => void = () => {};
    const preview = new Promise<PreviewImage | null>((resolve) => { deliverPreview = resolve; });
    const shot = (async () => {
      const photo = await photoOutput.capturePhoto({ flashMode }, {
        // Le gel d'écran : livré dès le début de la capture, bien avant que
        // la photo soit écrite. C'est lui que la scène affiche en attendant.
        onPreviewImageAvailable: (image) => {
          if (__DEV__) console.log(`[shutter] preview ${Date.now() - pressed}ms`);
          deliverPreview(image);
        },
      });
      if (__DEV__) console.log(`[shutter] capturePhoto ${Date.now() - pressed}ms`);
      try {
        const written = Date.now();
        const written_ = await writeUprightCapture(photo);
        if (__DEV__) console.log(`[shutter] writeUpright ${Date.now() - written}ms (total ${Date.now() - pressed}ms)`);
        return written_;
      } finally {
        photo.dispose();
      }
    })();
    const demoSize = Math.min((fullCabinetWidth - 6) * 0.72, (fullCabinetHeight - 97) * 0.5);
    const demoWidth = fullCabinetWidth - 6;
    const demoHeight = fullCabinetHeight - 97;
    const demoLeft = (demoWidth - demoSize) / 2;
    const demoTop = (demoHeight - demoSize) / 2 - 22;
    stashPendingCapture({
      location,
      preview,
      shot,
      startedAt: pressed,
      onboarding: onboarding
        ? {
            complete: onboarding.onCaptureComplete,
            demoSubjectBounds: onboardingAnimalVisibleRef.current
              ? {
                  height: (demoSize * 0.82) / demoHeight,
                  imageHeight: demoHeight,
                  imageWidth: demoWidth,
                  stickerHeight: 0.82,
                  stickerWidth: 0.7,
                  stickerX: 0.06,
                  stickerY: 0.1,
                  width: (demoSize * 0.7) / demoWidth,
                  x: (demoLeft + demoSize * 0.06) / demoWidth,
                  y: (demoTop + demoSize * 0.1) / demoHeight,
                }
              : undefined,
          }
        : undefined,
    });
    router.push({
      pathname: '/camera',
      params: { cameraSource: onboarding ? 'onboarding' : 'expandable', pendingCapture: '1' },
    });
    // La caméra reste active sous le modal jusqu'à ce que le cliché soit
    // écrit : couper la session pendant une capture en vol peut l'annuler.
    // L'échec, lui, se signale sur l'écran de révélation — plus ici.
    void shot
      .catch(() => undefined)
      .finally(() => {
        // Capteur sans image de prévisualisation : libère l'attente de la
        // scène au lieu de la laisser pendre. No-op si elle est déjà livrée.
        deliverPreview(null);
        capturingRef.current = false;
        setCapturing(false);
        if (!onboarding) setOpen(false);
      });
  };

  const takePhotoFromStakeout = useEffectEvent(() => {
    setStakeoutArmed(false);
    void takePhoto();
  });
  useEffect(() => {
    if (!stakeoutArmed || scout.guidance !== 'ready' || capturing) return;
    const timer = setTimeout(takePhotoFromStakeout, 0);
    return () => clearTimeout(timer);
  }, [capturing, scout.guidance, stakeoutArmed]);

  const foreground = '#29242d';
  const muted = '#716873';

  if (!showTabBar) return null;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessibilityViewIsModal={expanded}
        style={[styles.container, containerStyle]}
      >
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.expandedChrome, expandedChromeStyle]}
        >
          <View style={styles.handleHitbox}>
            <View style={[styles.handle, { backgroundColor: muted }]} />
          </View>
        </Animated.View>

        <Animated.View
          pointerEvents={expanded ? 'auto' : 'none'}
          style={[styles.cameraContent, cameraStyle, cameraLayoutStyle]}
        >
          <Animated.View style={[styles.cameraCabinet, cabinetStyle]}>
            <View style={styles.cameraFrame}>
              <View style={styles.cameraViewport}>
                {device && hasPermission ? (
                  <>
                    <Camera
                      ref={cameraRef}
                      device={device}
                      enableNativeZoomGesture
                      isActive={expanded}
                      onPreviewStarted={() => {
                        previewVeil.set(withTiming(0, { duration: 180 }));
                      }}
                      // Reposé tout de suite, sans transition : la session
                      // s'arrête, il n'y a plus rien de vrai à montrer, et une
                      // dissipation à l'envers laisserait voir le tampon mort.
                      onPreviewStopped={() => {
                        previewVeil.set(1);
                      }}
                      outputs={scout.output ? [photoOutput, scout.output] : [photoOutput]}
                      resizeMode="cover"
                      style={StyleSheet.absoluteFill}
                    />
                    {/* Sous les commandes et le viseur, au-dessus de la
                        prévisualisation : le chrome reste lisible pendant que
                        la session démarre, ce qui fait lire l'attente comme
                        une ouverture plutôt que comme un gel. */}
                    <Animated.View
                      pointerEvents="none"
                      style={[StyleSheet.absoluteFill, styles.previewVeil, veilStyle]}
                    />
                    <Pressable
                      accessible={false}
                      delayLongPress={360}
                      onLongPress={(event) => focusCamera(event, true)}
                      onPress={(event) => focusCamera(event, false)}
                      style={StyleSheet.absoluteFill}
                    />
                    <MiniViewfinder
                      label={t(
                        scout.guidance === 'clipped'
                          ? 'camera_scout_clipped'
                          : scout.guidance === 'too_far'
                            ? 'camera_scout_too_far'
                            : stakeoutArmed && scout.guidance !== 'ready'
                              ? 'camera_stakeout_waiting'
                              : trackerLocked || scout.guidance === 'ready'
                          ? 'camera_tracker_locked'
                          : scout.guidance === 'moving'
                            ? 'camera_scout_spotted'
                            : 'camera_target_hint',
                      )}
                      locked={trackerLocked || scout.guidance === 'ready'}
                    />
                    <WildlifeSoundCue active={expanded} />
                    {/* LE VISEUR NE PORTE QUE DES COMMANDES.
                        Le compteur de captures restantes vivait ici en
                        permanence, pour une information qu'on lit une fois par
                        jour. Il est passé dans la bannière du profil, juste
                        au-dessus de la ligne d'abonnement — l'endroit où on se
                        demande où on en est, et où la réponse est à portée.
                        `remainingEnergy` reste calculé : il garde la porte du
                        déclencheur (voir plus bas, `remainingEnergy === 0`). */}
                    {device.hasFlash ? (
                      <View style={styles.cameraFlash}>
                        <FlashButton
                          compact
                          onStakeoutChange={setStakeoutArmed}
                          stakeoutArmed={stakeoutArmed}
                        />
                      </View>
                    ) : null}
                  </>
                ) : (
                  <View style={styles.permission}>
                    <SymbolView name="camera.fill" size={34} tintColor={foreground} />
                    <Text style={[styles.permissionTitle, { color: foreground }]}>
                      {!device ? t('camera_unavailable') : t('camera_permission_title')}
                    </Text>
                    {device && !canRequestPermission ? (
                      <Text style={[styles.permissionTitle, styles.permissionHint, { color: foreground }]}>
                        {t('camera_permission_blocked_body')}
                      </Text>
                    ) : null}
                    {device ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={demanderOuReglages}
                        style={[styles.permissionButton, { backgroundColor: foreground }]}
                      >
                        <Text style={[styles.permissionButtonText, { color: '#fff' }]}>
                          {canRequestPermission
                            ? t('camera_permission_action')
                            : t('camera_permission_blocked_action')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
                {onboarding ? (
                  <>
                    {onboardingAnimalVisible ? (
                      <OnboardingCheetah height={fullCabinetHeight - 97} width={fullCabinetWidth - 6} />
                    ) : null}
                    {/* LE SECOURS SE LIT AVEC LA CONSIGNE, PAS APRÈS L'ÉCHEC.
                        Il était en bas du viseur, contre l'obturateur : au moment
                        où l'œil cherche le déclencheur, pas les instructions. Et
                        il posait une question sans montrer sa réponse — rien ne
                        disait qu'un guépard attendait derrière.
                        Quelqu'un qui n'a pas d'animal sous la main et qui ne voit
                        pas cette ligne conclut que l'app ne sert à rien. C'est le
                        seul filet de l'onboarding : il doit être lu AVANT qu'on
                        parte en chasse. `box-none` pour que le bloc laisse passer
                        les gestes vers le viseur tout en gardant ce bouton
                        touchable. */}
                    <View pointerEvents="box-none" style={styles.onboardingCopy}>
                      <Text style={styles.onboardingTitle}>{copy("ui_copy_095")}</Text>
                      <Text style={styles.onboardingSubtitle}>
                        {copy("ui_copy_096")}</Text>
                      <Press3D
                        accessibilityLabel={onboardingAnimalVisible ? copy('onboarding_hide_animal') : copy("ui_copy_255")}
                        borderRadius={18}
                        faceStyle={styles.onboardingHelpFace}
                        onPress={() => {
                          const visible = !onboardingAnimalVisibleRef.current;
                          onboardingAnimalVisibleRef.current = visible;
                          setOnboardingAnimalVisible(visible);
                        }}
                        shadowColor="#CDBF9B"
                        style={styles.onboardingHelp}
                      >
                        <View style={styles.onboardingHelpContent}>
                          <SymbolView
                            name={onboardingAnimalVisible ? 'eye.slash.fill' : 'sparkles'}
                            size={15}
                            tintColor="#292219"
                          />
                          <Text style={styles.onboardingHelpText}>
                            {onboardingAnimalVisible ? copy('onboarding_hide_animal') : copy("ui_copy_255")}
                          </Text>
                        </View>
                      </Press3D>
                    </View>
                  </>
                ) : null}
              </View>
              <View style={styles.cameraControls}>
                <RoundButton
                  accessibilityLabel={t('camera_close')}
                  icon="chevron.left"
                  onPress={() => {
                    if (onboarding) onboarding.onClose();
                    else if (fullScreen) setFullScreenOpen(false);
                    else setOpen(false);
                  }}
                />
                <Press3D
                  accessibilityLabel={t('camera_take_photo')}
                  borderRadius={31}
                  disabled={capturing || !device}
                  faceStyle={styles.shutterFace}
                  onPress={takePhoto}
                  shadowColor="#29242d"
                  style={styles.shutter}
                >
                  {capturing ? (
                    <ActivityIndicator color="#29242d" />
                  ) : (
                    <SymbolView name="camera.fill" size={22} tintColor="#29242d" weight="semibold" />
                  )}
                </Press3D>
                {fullScreen ? (
                  <ZoomButton
                    disabled={zoomOptions.length < 2}
                    label={formatZoom(zoom)}
                    onPress={cycleZoom}
                  />
                ) : (
                  <RoundButton
                    accessibilityLabel={t('camera_open_full')}
                    icon="arrow.up.left.and.arrow.down.right"
                    onPress={() => setFullScreenOpen(true)}
                  />
                )}
              </View>
            </View>
          </Animated.View>
        </Animated.View>

        <Animated.View
          pointerEvents={expanded ? 'none' : 'auto'}
          style={[styles.tabs, { paddingBottom: insets.bottom }, tabsStyle]}
        >
          <CurvedLiquidTabBar
            activeIndex={
              expanded
                ? 1
                : state.routes[state.index]?.name === '(spaces)' ? 2 : 0
            }
            onSelect={selectTabStable}
            routes={VISIBLE_ROUTES}
          />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

function OnboardingCheetah({ height, width }: { height: number; width: number }) {
  const size = Math.min(width * 0.72, height * 0.5);

  return (
    <Image
      autoplay
      contentFit="contain"
      pointerEvents="none"
      source={require('../../../assets/onboarding/expedition/cheetah-loop.webp')}
      style={[
        styles.onboardingAnimal,
        {
          height: size,
          left: (width - size) / 2,
          top: (height - size) / 2 - 22,
          width: size,
        },
      ]}
    />
  );
}

function RoundButton({
  accessibilityLabel,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  icon: 'arrow.up.left.and.arrow.down.right' | 'chevron.left';
  onPress: () => void;
}) {
  return (
    <Press3D
      accessibilityLabel={accessibilityLabel}
      borderRadius={24}
      faceStyle={styles.roundButtonFace}
      onPress={onPress}
      shadowColor="#29242d"
      style={styles.roundButton}
    >
      <SymbolView name={icon} size={22} tintColor="#29242d" weight="bold" />
    </Press3D>
  );
}

function ZoomButton({
  disabled,
  label,
  onPress,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Press3D
      accessibilityLabel={`Zoom ${label}`}
      borderRadius={24}
      disabled={disabled}
      faceStyle={styles.roundButtonFace}
      onPress={onPress}
      shadowColor="#29242d"
      style={styles.roundButton}
    >
      <Text style={styles.zoomText}>{label}</Text>
    </Press3D>
  );
}

/** Le viseur du tiroir : même carré fixe, mêmes règles. Voir `ViewfinderGuide`. */
function MiniViewfinder({ label, locked }: { label: string; locked: boolean }) {
  return (
    <View pointerEvents="none" style={styles.viewfinderLayer}>
      <View style={styles.viewfinder}>
        <View style={[styles.viewfinderCorner, locked && styles.viewfinderCornerLocked, styles.viewfinderTopLeft]} />
        <View style={[styles.viewfinderCorner, locked && styles.viewfinderCornerLocked, styles.viewfinderTopRight]} />
        <View style={[styles.viewfinderCorner, locked && styles.viewfinderCornerLocked, styles.viewfinderBottomLeft]} />
        <View style={[styles.viewfinderCorner, locked && styles.viewfinderCornerLocked, styles.viewfinderBottomRight]} />
        <View style={[styles.targetLabel, locked && styles.targetLabelLocked]}>
          <Text style={styles.targetLabelText}>{label}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    overflow: 'hidden',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    elevation: 24,
  },
  expandedChrome: {
    overflow: 'hidden',
    backgroundColor: '#fff9e9',
  },
  handleHitbox: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    zIndex: 4,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.34,
  },
  tabs: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 14,
  },
  cameraFlash: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 4,
  },
  cameraContent: {
    flex: 1,
    paddingTop: 36,
    paddingHorizontal: 20,
    paddingBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraCabinet: {
    paddingBottom: 9,
    borderRadius: 30,
    backgroundColor: '#29242d',
    boxShadow: '0 8px 22px rgba(74,53,23,0.18)',
  },
  cameraFrame: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 28,
    borderWidth: 3,
    borderColor: '#29242d',
    backgroundColor: '#e6dfc4',
  },
  cameraViewport: { flex: 1, overflow: 'hidden', backgroundColor: '#171519' },
  onboardingAnimal: {
    position: 'absolute',
  },
  onboardingCopy: {
    alignItems: 'center',
    left: 18,
    position: 'absolute',
    right: 18,
    top: 22,
  },
  onboardingTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 5,
  },
  onboardingSubtitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 4,
  },
  onboardingHelp: {
    alignSelf: 'center',
    marginTop: 12,
  },
  onboardingHelpFace: {
    backgroundColor: '#FFF8E7',
    borderColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  onboardingHelpContent: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  onboardingHelpText: { color: '#292219', fontSize: 14, fontWeight: '800' },
  /** Le fond même du viseur : le voile doit être invisible en tant que voile. */
  previewVeil: { backgroundColor: '#171519' },
  permission: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
    backgroundColor: '#fffdf4',
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  /** La raison, sous le titre : sans elle, « Ouvrir les Réglages » n'explique rien. */
  permissionHint: {
    fontSize: 13,
    fontWeight: '400',
    opacity: 0.75,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
  permissionButton: {
    minHeight: 48,
    borderRadius: 24,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  cameraControls: {
    height: 88,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#e6dfc4',
  },
  roundButton: {
    width: 48,
    height: 48,
  },
  roundButtonFace: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffdf4',
    borderWidth: 2,
    borderColor: '#29242d',
  },
  zoomText: { color: '#29242d', fontSize: 12, fontWeight: '800' },
  shutter: {
    width: 62,
    height: 62,
  },
  shutterFace: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffdf4',
    borderWidth: 3,
    borderColor: '#29242d',
  },
  // Le viseur est un CARRÉ par construction, pas deux pourcentages
  // indépendants. Le plein écran ne gagne que 24 px en largeur mais ~250 px en
  // hauteur : avec une largeur figée à 56 %, le carré s'étirait en rectangle
  // vertical dès l'agrandissement. `aspectRatio` fait suivre la largeur à la
  // hauteur, à toutes les tailles de viseur.
  viewfinderLayer: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Le viseur est un CARRÉ par construction, pas deux pourcentages
  // indépendants. Le plein écran ne gagne que 24 px en largeur mais ~250 px en
  // hauteur : avec une largeur figée à 56 %, le carré s'étirait en rectangle
  // vertical dès l'agrandissement. `aspectRatio` fait suivre la largeur à la
  // hauteur, à toutes les tailles de viseur.
  viewfinder: {
    height: '48%',
    aspectRatio: 1,
    maxWidth: '86%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  viewfinderCorner: { position: 'absolute', width: 24, height: 24, borderColor: '#fff' },
  viewfinderCornerLocked: { borderColor: '#e6dfc4' },
  viewfinderTopLeft: { left: 0, top: 0, borderLeftWidth: 3, borderTopWidth: 3 },
  viewfinderTopRight: { right: 0, top: 0, borderRightWidth: 3, borderTopWidth: 3 },
  viewfinderBottomLeft: { left: 0, bottom: 0, borderLeftWidth: 3, borderBottomWidth: 3 },
  viewfinderBottomRight: { right: 0, bottom: 0, borderRightWidth: 3, borderBottomWidth: 3 },
  targetLabel: {
    marginBottom: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#29242d',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#fff',
  },
  targetLabelLocked: { backgroundColor: '#e6dfc4' },
  targetLabelText: { color: '#29242d', fontSize: 5, fontWeight: '800', letterSpacing: 0.9 },
});
