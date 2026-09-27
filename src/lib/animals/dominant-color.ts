import { getColors } from 'react-native-nitro-image-colors';

/**
 * The animal's own colour, sampled from its die-cut sticker.
 *
 * Read once at capture time and stored on the capture, never at render: the
 * collection grid draws dozens of cards and must not run native extraction per
 * cell. The card system rotates its foil to sit opposite this hue — see
 * `card-identity.ts`.
 *
 * `vibrant` first: on a cut-out the muted swatches drift towards the
 * transparent edge pixels, while `vibrant` locks onto the plumage or fur that
 * actually reads as "the animal's colour".
 */
export async function dominantColorFor(uri: string): Promise<string | undefined> {
  try {
    const colors = await getColors({ uri }, { cache: true, fallback: FALLBACK });
    const picked =
      colors.vibrant ?? colors.dominant ?? colors.darkVibrant ?? colors.average ?? colors.primary;
    // Extraction failures come back filled with the fallback rather than
    // throwing, so a fallback-coloured result means "no colour", not black.
    return picked && picked.toLowerCase() !== FALLBACK ? picked : undefined;
  } catch {
    return undefined;
  }
}

const FALLBACK = '#010101';
