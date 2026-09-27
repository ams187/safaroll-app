// La palette SAFARI : la seule couleur du chrome, et elle est assumée.
//
// POURQUOI ELLE EXISTE À CÔTÉ DU THÈME
//
// `unistyles.ts` a fait un choix fort et juste POUR LES CARTES : l'encre est le
// seul accent, parce qu'une carte LÉGENDAIRE est déjà dorée et que deux ors
// dans le même écran ne veulent plus rien dire. Cette règle protège le produit.
//
// Elle ne dit rien, en revanche, des écrans de PROGRESSION. Un profil et une
// page de quêtes ne montrent aucune carte : ils montrent ce qu'on a fait et ce
// qui reste à faire, et là, l'absence totale de couleur ne se lit pas comme de
// la retenue — elle se lit comme un tableur. Le jeu doit se voir.
//
// D'où deux régimes, et la frontière est nette :
//
//   LÀ OÙ IL Y A DES CARTES   encre et parchemin. Rien ne concurrence la carte.
//   LÀ OÙ IL Y A DES SCORES   la savane, à pleine saturation.
//
// LES CINQ FAMILLES SONT DES HEURES DE LA JOURNÉE, PAS DES TEINTES AU HASARD
//
// Chacune est un moment d'un safari, ce qui leur donne un ordre naturel et
// évite le nuancier d'école : on sait toujours laquelle vient après laquelle.

export type SafariHue = 'aube' | 'savane' | 'canopee' | 'riviere' | 'crepuscule';

export type SafariTone = {
  /** Le haut du dégradé. */
  from: string;
  /** Le bas du dégradé. */
  to: string;
  /** L'encre posée dessus. Toujours contrastée à 4.5:1 au moins. */
  on: string;
  /** L'aplat très pâle, pour un fond de vignette sur la page. */
  wash: string;
};

export const SAFARI: Record<SafariHue, SafariTone> = {
  /** 6 h. Le ciel rose avant que le soleil ne casse l'horizon. */
  aube: { from: '#FFB25E', to: '#F2704B', on: '#4A1D0B', wash: '#FFEBDA' },
  /** 11 h. L'herbe sèche et le soleil droit — la couleur de l'app. */
  savane: { from: '#FFC93D', to: '#F59A16', on: '#4A3208', wash: '#FFF2D4' },
  /** 14 h. L'ombre sous l'acacia. */
  canopee: { from: '#5FD08A', to: '#20955C', on: '#0A3D24', wash: '#DFF6E8' },
  /** 17 h. Le point d'eau. */
  riviere: { from: '#5EC6F5', to: '#2F86DB', on: '#08304F', wash: '#DDF0FE' },
  /** 21 h. La nuit, et ce qui sort à la nuit. */
  crepuscule: { from: '#A98BF0', to: '#6B45CE', on: '#25123F', wash: '#EDE5FE' },
};

export const SAFARI_HUES = Object.keys(SAFARI) as SafariHue[];

/**
 * La teinte d'une chose, dérivée de sa clé.
 *
 * Déterministe et volontairement : la distinction « Ornithologue » doit être
 * bleue aujourd'hui, demain, et sur le téléphone d'un autre joueur. Une couleur
 * qui change d'un lancement à l'autre empêche de reconnaître un badge de loin,
 * ce qui est pourtant la seule raison de lui en donner une.
 */
export function hueFor(key: string): SafariTone {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return SAFARI[SAFARI_HUES[Math.abs(hash) % SAFARI_HUES.length]];
}

/** Ce qu'on n'a pas encore mérité : de la pierre, pas une teinte éteinte. */
export const STONE: SafariTone = {
  from: '#D8D2C6',
  to: '#B3AB9C',
  on: '#FFFFFF',
  wash: '#EFEBE3',
};
