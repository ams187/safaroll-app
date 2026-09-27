/**
 * "That looks like a screen."
 *
 * A photo of a photo is not a catch. Detecting it keeps the collection
 * honest — the whole premise is that you were actually there.
 *
 * UN SEUL SIGNAL : LE MOIRÉ. Photographier une grille de pixels avec une autre
 * grille fait battre les deux fréquences en bandes régulières. On échantillonne
 * des lignes de la vignette et on cherche une composante périodique forte — un
 * animal en lumière réelle n'a pas cette ondulation.
 *
 * IL Y EN A EU UN DEUXIÈME, ET IL EST PARTI POUR DEUX RAISONS.
 *
 * L'EXIF : une capture d'écran ne porte aucune donnée d'objectif — ni ouverture,
 * ni focale, ni temps de pose. Le test existait, il était même le plus lourd du
 * score (+0,6 sur un seuil de 0,6). Mais `assessScreenCapture` n'a jamais reçu
 * d'EXIF : `lumaSampleFor` ne rend que `{ height, luma, width }`, donc la
 * première ligne sortait sur `undefined` à chaque capture. Il passait au vert
 * dans `check-screen-guard.ts` parce que le test l'appelait directement.
 *
 * Et même branché, il n'aurait rien attrapé : il ne vise que la capture d'écran
 * IMPORTÉE, or rien n'importe. Aucun chemin de l'app n'appelle la capture avec
 * `captureSource: 'library'` — seule la caméra alimente une rencontre, et une
 * photo prise à l'appareil porte toujours ses optiques.
 *
 * Le jour où un import existe, ce signal redevient utile : il est dans
 * l'historique de ce fichier.
 *
 * Le moiré reste une heuristique, donc un AVERTISSEMENT. Se tromper sur une
 * vraie rencontre coûte plus cher que laisser passer un écran.
 */

export type ScreenSuspicion = {
  /** 0..1 — how much this looks like a picture of a display. */
  score: number;
  reasons: string[];
};

/**
 * Moiré detector over a greyscale row buffer (already downscaled, e.g. 64px
 * wide). Returns the strongest normalised periodic energy in the 3..16 px
 * band — the range a phone camera produces when it sees an LCD subpixel grid.
 */
export function moireEnergy(luma: number[], width: number, height: number): number {
  if (width < 24 || height < 8) return 0;
  let peak = 0;
  for (let row = 0; row < height; row += Math.max(1, Math.floor(height / 12))) {
    const offset = row * width;
    let mean = 0;
    for (let x = 0; x < width; x += 1) mean += luma[offset + x];
    mean /= width;

    let energy = 0;
    for (let period = 3; period <= 16; period += 1) {
      let real = 0;
      let imaginary = 0;
      for (let x = 0; x < width; x += 1) {
        const value = luma[offset + x] - mean;
        const phase = (2 * Math.PI * x) / period;
        real += value * Math.cos(phase);
        imaginary += value * Math.sin(phase);
      }
      energy = Math.max(energy, Math.sqrt(real * real + imaginary * imaginary) / width);
    }
    peak = Math.max(peak, energy);
  }
  // Empirically a natural photo sits under ~6, a screen shot well over ~12.
  return Math.min(1, peak / 18);
}

/**
 * RGBA entrelacé → luminance perçue (Rec. 601).
 *
 * Vit ici, avec le reste du raisonnement, plutôt qu'à côté du décodeur Skia :
 * une inversion de canaux (BGRA lu comme RGBA) rendrait une luminance fausse
 * et désarmerait le garde EN SILENCE — jamais une erreur, juste des tricheurs
 * qui passent. C'est le genre de bug qui a besoin d'un test, et un test ne peut
 * pas importer Skia.
 *
 * Le vert pèse six fois le bleu parce que l'œil le voit six fois mieux, et le
 * moiré d'un écran vit surtout dans ce canal.
 */
export function lumaFromRgba(pixels: ArrayLike<number>, pixelCount: number): number[] {
  const luma = new Array<number>(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const at = index * 4;
    luma[index] = 0.299 * pixels[at] + 0.587 * pixels[at + 1] + 0.114 * pixels[at + 2];
  }
  return luma;
}

export function assessScreenCapture({
  luma,
  height,
  width,
}: {
  height?: number;
  luma?: number[];
  width?: number;
}): ScreenSuspicion {
  const reasons: string[] = [];
  let score = 0;

  if (luma && width && height) {
    const moire = moireEnergy(luma, width, height);
    if (moire > 0.55) {
      score += moire * 0.7;
      reasons.push('un moiré régulier trahit une grille de pixels');
    }
  }

  return { reasons, score: Math.min(1, score) };
}

/** Above this, the app asks the player to point at the real animal. */
export const SCREEN_WARN_THRESHOLD = 0.6;
