// The behavioural core of pokemon-cards-css' Card.svelte, extracted from
// pokemon-cards-rn's Card.tsx for SafaRoll: the three interact springs, the
// pointer drive and the delayed snap-back — everything that
// gives a real card its feel — minus the popover/showcase chrome (SafaRoll has
// its own open-card morph).
//
// Spring constants and the interact/orientate math are verbatim from the
// source; changing them changes the feel, so don't.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  runOnJS,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import type { CardUniforms } from './effects/types';
import { usePointer } from './hooks/usePointer';
import { clamp } from './lib/math';
import { useSvelteSpring } from './springs/svelteSpring';

const INTERACT = { stiffness: 0.066, damping: 0.25 };
const SNAP = { stiffness: 0.01, damping: 0.06 };

/** FNV-1a — the card's noise seed comes from the species, not a dice roll. */
function hash(seed: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export type CardFx = {
  gesture: ReturnType<typeof usePointer>;
  uniforms: CardUniforms;
  /** Degrees for the rotator: CSS rotateY(--rotate-x) rotateX(--rotate-y). */
  rotateX: SharedValue<number>;
  rotateY: SharedValue<number>;
};

export function useCardFx({
  height,
  live = true,
  seedKey,
  width,
}: {
  height: number;
  /**
   * Whether this card can actually move. A card in the collection grid cannot
   * be tilted and draws no foil, so its three springs would run a frame
   * callback each, every frame, to hold a value nobody reads. Off, they cost
   * nothing and keep their resting values — which is all a still card needs.
   */
  live?: boolean;
  /** Species name — same species, same holo noise offsets, Pokédex style. */
  seedKey: string;
  width: number;
}): CardFx {
  const springRotate = useSvelteSpring({ x: 0, y: 0 }, INTERACT, live);
  const springGlare = useSvelteSpring({ o: 0, x: 50, y: 50 }, INTERACT, live);
  const springBackground = useSvelteSpring({ x: 50, y: 50 }, INTERACT, live);

  const size = useSharedValue({ h: height, w: width });
  useEffect(() => {
    size.value = { h: height, w: width };
  }, [height, size, width]);
  const dragging = useSharedValue(false);

  const updateSprings = (
    background: { x: number; y: number },
    rotate: { x: number; y: number },
    glare: { o: number; x: number; y: number },
  ) => {
    'worklet';
    springBackground.setOpts(INTERACT);
    springRotate.setOpts(INTERACT);
    springGlare.setOpts(INTERACT);
    springBackground.set(background);
    springRotate.set(rotate);
    springGlare.set(glare);
  };

  // The single JS-thread snap-back path (Card.svelte:146-171): after the
  // finger lifts, the slack SNAP spring floats the card back to rest.
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * CETTE FONCTION DOIT GARDER LA MÊME IDENTITÉ D'UN RENDU À L'AUTRE.
   *
   * C'est le seul rappel de tout ce fichier qui repart vers le thread JS, donc
   * la seule chose que Worklets doit sérialiser en « fonction distante » : au
   * franchissement, elle est enregistrée sous un identifiant numérique dans
   * `__remoteFunctionRegistry`, et le geste ne transporte que ce numéro.
   *
   * Déclarée en clair dans le corps du composant, elle était RECRÉÉE À CHAQUE
   * RENDU — et la carte ouverte en rend beaucoup, les trois ressorts et leurs
   * valeurs dérivées y pourvoient. Chaque rendu inscrivait donc une nouvelle
   * entrée, et un geste parti avec l'ancien numéro se retrouvait à le chercher
   * dans un registre qui ne le contenait plus :
   *
   *   JSIWorkletsModuleProxy.cpp:455
   *     remoteFunction->toJSValue(rt).getObject(rt)   ->   assert(isObject())
   *
   * Une assertion C++, donc `abort()` immédiat : SIGABRT, pas une exception JS
   * qu'on aurait pu rattraper. C'est le plantage SAFAROLL-7 à l'ouverture
   * d'une fiche.
   *
   * Les ressorts passent par une réf parce qu'eux sont bel et bien recréés à
   * chaque rendu (`useSvelteSpring` rend un objet neuf) ; ils délèguent tous
   * aux mêmes valeurs partagées, mais leurs identités changent. Lire la réf
   * est sans danger ici : ce corps s'exécute sur le thread JS.
   */
  const springsRef = useRef({ springBackground, springGlare, springRotate });
  useEffect(() => {
    springsRef.current = { springBackground, springGlare, springRotate };
  }, [springBackground, springGlare, springRotate]);
  const jsInteractEnd = useCallback((delayMs: number) => {
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      const { springBackground: bg, springGlare: glare, springRotate: rotate } = springsRef.current;
      rotate.setOpts(SNAP);
      rotate.set({ x: 0, y: 0 }, { soft: 1 });
      glare.setOpts(SNAP);
      glare.set({ o: 0, x: 50, y: 50 }, { soft: 1 });
      bg.setOpts(SNAP);
      bg.set({ x: 50, y: 50 }, { soft: 1 });
    }, delayMs);
  }, []);
  useEffect(
    () => () => {
      if (snapTimer.current) clearTimeout(snapTimer.current);
    },
    [],
  );

  const gesture = usePointer(size, {
    onActivate: () => {
      'worklet';
    },
    onInteract: (p) => {
      'worklet';
      dragging.value = true;
      updateSprings(p.background, p.rotate, p.glare);
    },
    onInteractEnd: (delayMs) => {
      'worklet';
      dragging.value = false;
      runOnJS(jsInteractEnd)(delayMs);
    },
  });

  // Card.svelte:277-295 dynamicStyles, as derived values.
  const pointerX = useDerivedValue(() => springGlare.values.value.x);
  const pointerY = useDerivedValue(() => springGlare.values.value.y);
  const pointerFromCenter = useDerivedValue(() => {
    const g = springGlare.values.value;
    return clamp(Math.sqrt((g.y - 50) * (g.y - 50) + (g.x - 50) * (g.x - 50)) / 50, 0, 1);
  });
  const pointerFromTop = useDerivedValue(() => springGlare.values.value.y / 100);
  const pointerFromLeft = useDerivedValue(() => springGlare.values.value.x / 100);
  const backgroundX = useDerivedValue(() => springBackground.values.value.x);
  const backgroundY = useDerivedValue(() => springBackground.values.value.y);
  const cardOpacity = useDerivedValue(() => springGlare.values.value.o);

  const rotateX = useDerivedValue(() => springRotate.values.value.x);
  const rotateY = useDerivedValue(() => springRotate.values.value.y);

  const seed = useMemo(() => {
    const h = hash(seedKey);
    return { x: (h % 1000) / 1000, y: ((h >>> 10) % 1000) / 1000 };
  }, [seedKey]);

  const uniforms = useMemo<CardUniforms>(
    () => ({
      backgroundX,
      backgroundY,
      cardOpacity,
      // Card.svelte:31-34 cosmosPosition — the cosmos sheet's px offset.
      cosmosX: Math.floor(seed.x * 734),
      cosmosY: Math.floor(seed.y * 1280),
      h: height,
      pointerFromCenter,
      pointerFromLeft,
      pointerFromTop,
      pointerX,
      pointerY,
      rotate: rotateX,
      seedX: seed.x,
      seedY: seed.y,
      w: width,
    }),
    [
      backgroundX,
      backgroundY,
      cardOpacity,
      height,
      pointerFromCenter,
      pointerFromLeft,
      pointerFromTop,
      pointerX,
      pointerY,
      rotateX,
      seed,
      width,
    ],
  );

  return { gesture, rotateX, rotateY, uniforms };
}
