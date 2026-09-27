// The Clash Royale deck screen's colour language, named once.
//
// Not theme colours: these do not follow light/dark, because the thing being
// reproduced does not either. Clash's deck tabs are the same blue at 3am as at
// noon, and half of what makes them read as a game control rather than a
// segmented list is that they never negotiate with the surrounding UI.
//
// The structure of every Clash control is three tones of one hue: a lit top
// bevel, the face, and a darker lip under it that reads as thickness. Miss the
// lip and the button goes flat and cheap, which is most of the difference
// between "inspired by" and "the same".
//
// There is deliberately no board colour here, and no label colours either. The
// deck sits straight on the page and its frame comes from the app's own theme,
// because that screen is normally read in LIGHT mode — a fixed palette put a
// near-white line on a near-white page and called it a frame.

export const CLASH = {
  /** An empty slot: a hole punched in the page, not a pale card. */
  slotWell: 'rgba(8, 32, 72, 0.5)',
  slotWellEdge: 'rgba(255, 255, 255, 0.22)',

  /**
   * Unselected deck tab: white paper, black outline.
   *
   * No top bevel. The three-tone plastic structure — lit bevel, face, dark lip
   * — needs headroom above the face to put a highlight in, and white has none.
   * A white line on a near-white face over a cream page is not a bevel, it is
   * a gap: the top of the button reads as missing.
   *
   * The depth is a real thing here anyway. `Press3D` puts a solid shadow view
   * under the face and springs the face down onto it, so the button has an
   * actual side — it does not need a border pretending to be one.
   */
  tabFace: '#ffffff',
  /**
   * Black, on BOTH states, all the way round. The outline is the one thing
   * that does not change when a tab is selected, and that is what makes the
   * row read as five buttons with one lit rather than five different buttons —
   * the ink is constant, the paper is what changes colour.
   */
  tabLip: '#141210',
  /**
   * Selected deck tab: parchment.
   *
   * No accent colour, and no inversion either — the active tab is a warmer,
   * deeper paper than the four beside it, held by the same black outline. The
   * row reads as five sheets with one of them raised, which is what the 3D
   * press was always describing.
   *
   * The values are what make it legible, and they were nearly identical at
   * first: a `#f0ebd8` parchment against `#f2efe8` tabs on a `#faf6ee` page is
   * four points of luminance across the whole row, which the eye simply does
   * not resolve. So the room was opened from both sides — the quiet tabs went
   * to pure white and the parchment went deeper. Same hue, thirteen points of
   * separation instead of two.
   *
   * Yellow had to go because it was already spoken for: `rarity.ts` gives
   * LÉGENDAIRE `#ffca4b`, near enough the same swatch. One colour cannot mean
   * both "this control is active" and "this card is legendary". And with the
   * chrome down to ink and paper, the only colour left on screen belongs to
   * the animals and their foils, which is where it was always meant to be.
   */
  tabFaceOn: '#e6dfc4',
  tabLipOn: '#141210',
  /** Ink on paper — and now on parchment too, since both faces are light. */
  tabInk: '#141210',
  tabInkOn: '#141210',
  /** The frame around the whole deck section, the same parchment. */
  deckFrame: '#e6dfc4',
} as const;
