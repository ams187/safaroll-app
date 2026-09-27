// Whether something full-screen is running on top of a tab screen.
//
// The enlarged card and the burn are overlays inside a screen, not routes, so
// the tab navigator never learns about them: the route stays `(home)/index`
// and the tab bar — which the navigator renders ABOVE the screen — keeps
// drawing on top. `showTabBar` in the tab bar already hides it for real routes
// like `(home)/[id]`; this is the same signal for the overlays.
//
// Owners, not a boolean. The card and the fire OVERLAP: confirming a delete
// closes the card the instant it arms the burn, so a single flag went false on
// the way out of the card and the tab bar walked back in over the flames. A
// set holds the bar down until the last owner lets go.
//
// A module-level store rather than a context because the two ends are on
// opposite sides of the navigator: the owners live in screens, the tab bar is
// a sibling of every screen, and no provider sensibly wraps both without
// wrapping the entire app for one boolean.

import { useSyncExternalStore } from 'react';

export type CardOverlayOwner = 'card' | 'burn';

const owners = new Set<CardOverlayOwner>();
const listeners = new Set<() => void>();
let snapshot = false;

function publish() {
  const next = owners.size > 0;
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCardOverlayOpen(owner: CardOverlayOwner, open: boolean) {
  if (open) owners.add(owner);
  else owners.delete(owner);
  publish();
}

export function useCardOverlayOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
