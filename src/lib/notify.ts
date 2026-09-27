// Les notifications de SafaRoll, posées sur les éléments natifs d'iOS.
//
// ─────────────────────────────────────────────────────────────────────────
// TROIS REGISTRES, ET UN SEUL CRITÈRE POUR CHOISIR
//
// La question n'est jamais « est-ce grave ? » mais « qu'est-ce que le joueur
// est en train de faire ? ».
//
//   1. UNE DÉCISION EST ATTENDUE            →  `Alert.alert` natif, avec ses
//      boutons. Un seul endroit dans l'app : brûler une carte. Ni SPIndicator
//      ni AlertKit ne savent poser une question — ils annoncent, ils ne
//      demandent pas. Ne pas essayer de les y forcer.
//
//   2. LE JOUEUR ATTEND LE RÉSULTAT D'UN GESTE DÉLIBÉRÉ  →  `announce.*`
//      (AlertKit). Le bandeau central, celui du volume iOS. Il vole l'écran
//      une seconde et s'en va. Pour l'achat qui échoue, la photo qui rate :
//      des moments où le joueur regarde fixement l'endroit où la réponse doit
//      apparaître. Un bandeau en haut y passerait inaperçu.
//
//   3. TOUT LE RESTE                        →  `toast.*` (SPIndicator). La
//      capsule en haut, qu'on peut chasser du doigt. Ce qui arrive PENDANT
//      autre chose : une carte rangée dans un deck, un deck déjà plein, le
//      Guide qui perd le fil. Le joueur continue son geste par-dessus.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI DU NATIF PLUTÔT QUE LA PILE MAISON QUI ÉTAIT LÀ
//
// `toast-stack.tsx` dessinait ses capsules en React, dans l'arbre de vues de
// l'app — donc SOUS les modales natives. La caméra est une modale plein
// écran, le paywall une feuille : deux des trois écrans où un message a le
// plus de chances de devoir sortir, et les deux où il ne sortait pas. Burnt
// passe par une fenêtre UIKit séparée ; il se pose au-dessus de tout.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI FAIT QUE ÇA RESSEMBLE À SAFAROLL
//
// Le fond de la capsule appartient au système et ne se peint pas : c'est un
// matériau flou qui suit l'apparence de l'appareil. La seule chose que l'on
// tient, c'est le SYMBOLE et sa TEINTE — alors elle vient du thème, jamais
// d'un code en dur, et elle est relue à chaque appel parce que les thèmes
// sont adaptatifs et qu'une constante de module serait figée sur la couleur
// du lancement.
//
// Les trois teintes sont celles que le reste de l'app utilise déjà pour dire
// la même chose : le vert pour ce qui a abouti (rien d'autre ne le dit —
// voir la note de `unistyles.ts`), la rouille pour ce qui a échoué, et l'encre
// pour ce qui n'est ni l'un ni l'autre. Elles s'inversent toutes seules en
// thème sombre, et le matériau du système aussi : le contraste tient des deux
// côtés.

import * as Burnt from 'burnt';
import * as Haptics from 'expo-haptics';
import { UnistylesRuntime } from 'react-native-unistyles';

type Ton = 'done' | 'fail' | 'info';

const SIGNE = {
  done: {
    haptic: 'success',
    name: 'checkmark.circle.fill',
    role: 'success',
    seconds: 2.4,
  },
  fail: {
    haptic: 'warning',
    name: 'exclamationmark.triangle.fill',
    role: 'danger',
    seconds: 3.6,
  },
  /** L'étincelle : c'est déjà le glyphe de l'information partout ailleurs. */
  info: {
    haptic: 'none',
    name: 'sparkles',
    role: 'foreground',
    seconds: 2.8,
  },
} as const satisfies Record<
  Ton,
  { haptic: 'none' | 'success' | 'warning'; name: string; role: 'danger' | 'foreground' | 'success'; seconds: number }
>;

/** 22 pt : le symbole pèse autant que le titre sans écraser la capsule. */
const TAILLE = { height: 22, width: 22 };

const parure = (ton: Ton) => ({
  icon: { ios: { color: UnistylesRuntime.getTheme().colors[SIGNE[ton].role], name: SIGNE[ton].name } },
  layout: { iconSize: TAILLE },
  preset: 'custom' as const,
});

/**
 * La capsule en haut. Ce qui arrive pendant que le joueur fait autre chose.
 *
 * Sur Android, Burnt retombe sur `ToastAndroid` : le titre passe, le symbole
 * et la teinte non. Écrire des titres qui se suffisent à eux-mêmes.
 */
export const toast = {
  done: (title: string, message?: string) => pousser('done', title, message),
  fail: (title: string, message?: string) => pousser('fail', title, message),
  info: (title: string, message?: string) => pousser('info', title, message),
};

/**
 * Le bandeau central. Le résultat d'un geste que le joueur a fait exprès et
 * dont il attend la réponse.
 */
export const announce = {
  done: (title: string, message?: string) => poser('done', title, message),
  fail: (title: string, message?: string) => poser('fail', title, message),
};

function pousser(ton: Ton, title: string, message?: string) {
  Burnt.toast({
    ...parure(ton),
    duration: SIGNE[ton].seconds,
    from: 'top',
    haptic: SIGNE[ton].haptic,
    message,
    title,
  });
}

function poser(ton: Ton, title: string, message?: string) {
  // AlertKit n'a pas d'option haptique, contrairement à SPIndicator : le
  // bandeau central resterait muet au toucher là où la capsule vibre. On la
  // tire donc à la main, avec la même graduation que `haptic:` plus haut.
  if (process.env.EXPO_OS === 'ios') {
    void Haptics.notificationAsync(
      ton === 'done'
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    );
  }
  Burnt.alert({ ...parure(ton), duration: SIGNE[ton].seconds, message, title });
}
