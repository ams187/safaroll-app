export type Id<Table extends string = string> = string & { readonly __table?: Table };
export type Empty = Record<string, never>;

export type Endpoint<Args = any, Result = any> = {
  key: string;
  __args?: Args;
  __result?: Result;
};

const endpoint = <Args = Empty, Result = null>(key: string) => ({ key }) as Endpoint<Args, Result>;
export type FunctionReturnType<T> = T extends Endpoint<any, infer Result> ? Result : never;

/** Les motifs qu'Apple attend de voir proposés — pas un champ libre : un texte
 *  libre seul ne se trie pas, et un signalement qu'on ne trie pas ne se traite
 *  pas dans les 24 h. La note reste possible en plus. */
export type ReportReason = 'offensive' | 'sexual' | 'violence' | 'harassment' | 'spam' | 'other';
export type BlockedUser = { userId: string; displayName: string | null; avatarUrl: string | null; blockedAt: number };

export type Capture = {
  _id: string; _creationTime: number; userId: string; status: 'processing' | 'ready' | 'needs_review' | 'failed';
  originalStorageId: string; stickerStorageId?: string; captureSource?: 'camera' | 'library'; aspectRatio: number;
  capturedAt: number; dominantColor?: string; expeditionId?: string; latitude?: number; longitude?: number;
  scientificName?: string; commonName?: string; commonNameLocale?: string;
  /** Noms courants par code de langue, ex. `{ fr: 'Lion', es: 'León' }`. */
  vernaculars?: Record<string, string>; inAtlas?: boolean; confidence?: number;
  identificationIssue?: 'no_animal_detected' | 'low_confidence' | 'service_unavailable' | 'invalid_image' | 'unsupported_capture';
  taxonomy?: { kingdom?: string; phylum?: string; class?: string; order: string; family: string; genus: string };
  candidates?: { scientificName: string; commonName: string; commonNameLocale?: string; confidence: number;
    kingdom?: string; phylum?: string; class?: string; order: string; family: string; genus: string }[];
  rarity?: 'common' | 'uncommon' | 'rare' | 'very_rare' | 'ultra_rare' | 'epic' | 'mythic' | 'legendary';
  localEncounterRarity?: 'common' | 'uncommon' | 'rare' | 'legendary'; localOccurrenceCount?: number;
  raritySource?: 'gbif'; originalUrl: string | null; stickerUrl: string | null;
  /** Le détourage réduit à 384 px — ce que la grille affiche. `undefined` tant
   *  qu'il n'a pas été produit ; l'appelant retombe sur `stickerUrl`. */
  stickerThumbUrl?: string;
  /** La planche de l'espèce, propre ou empruntée — résolue à la lecture par
   *  `scene_slugs`, jamais figée sur la capture. Voir `card-scenes.ts`. */
  sceneSlug?: string;
  /** Quand le recours « Identification Pro » a été joué. Défini = déjà relancé. */
};

export type CatalogEntry = {
  _id: string; _creationTime: number; gbifKey: number; scientificName: string; canonicalName: string;
  vernacularName?: string; vernacularNameEn?: string; kingdom?: string; phylum?: string; class?: string;
  order?: string; family?: string; genus?: string; group: string;
  rarity?: Capture['rarity'];
};


export type DeckSummary = {
  _id: string; name: string; description: string; authorName: string; isPublic: boolean;
  /** L'auteur, pour pouvoir le bloquer depuis la galerie. `null` sur ses propres decks. */
  authorId: string | null;
  authorAvatarUrl: string | null; cardCount: number; likeCount: number; liked: boolean;
  coverUrl: string | null; groups: string[];
  /** Le deck montré en premier sur le profil public de son auteur. */
  pinned: boolean;
};
export type DeckResult = { deck: DeckSummary; owner: boolean; captureIds: string[]; cards: Capture[] };

export type LeaderboardEntry = {
  rank: number; userId: string; displayName: string; avatarUrl: string | null;
  speciesCount: number; me: boolean;
};
/**
 * Les cinq mesures du Registre. Un classement unique ne nomme que ses vingt
 * premiers ; cinq donnent à chacun un endroit où exister.
 */
export type RegisterBoard =
  | 'semaine' | 'atlas' | 'saison' | 'trouvailles' | 'captures' | 'maitrise';
/** Global, ou seulement mon cercle scellé. */
export type RegisterScope = 'global' | 'friends';
/** `direction` dit quel bouton dessiner : 'in' attend ma réponse, 'out' attend
 *  la sienne, 'friend' est scellé. */
export type Friend = {
  userId: string; displayName: string; avatarUrl: string | null;
  status: 'pending' | 'accepted'; direction: 'in' | 'out' | 'friend';
};
export type RegisterEntry = {
  rank: number; userId: string; displayName: string; avatarUrl: string | null;
  score: number; me: boolean;
  /** Abonné SafaRoll+ — porte le sceau dans le Registre. */
  isPremium: boolean;
};
/** A species another player owns, as names only — never their photos. */
export type CommunitySpecies = {
  scientificName: string; commonName: string | null; rarity: Capture['rarity'] | null; firstSeenAt: number;
};
export type CommunityProfile = {
  userId: string; displayName: string; avatarUrl: string | null; bio: string; joinedAt: number;
  captureCount: number; species: CommunitySpecies[]; decks: DeckResult[];
  isPremium: boolean;
};

export type ExpeditionSummary = {
  _id: string; startedAt: number; endedAt: number | null; captureCount: number; speciesCount: number; newSpeciesCount: number;
};

export type Intent = {
  kind: 'open_url' | 'copy' | 'web_search' | 'open_maps' | 'call' | 'email' | 'message' | 'add_event';
  label: string; value: string;
};
export type Item = {
  _id: string; _creationTime: number; userId: string; type: 'image' | 'link' | 'note'; status: 'processing' | 'ready' | 'failed';
  title?: string; description?: string; url?: string; storageId?: string; aspectRatio?: number; capturedAt?: number;
  latitude?: number; longitude?: number; isSticker?: boolean; tags: string[]; content?: string; siteName?: string;
  heroImageUrl?: string; note?: string; intents?: Intent[]; products?: any[]; productsStatus?: string;
  searchText: string; imageUrl: string | null; spaces?: { _id: string; name: string }[]; spaceIntents?: Intent[];
};

export type SpaceSummary = {
  _id: string; _creationTime: number; userId: string; name: string; description?: string; dynamic?: boolean;
  itemCount: number; suggestionCount: number; previews: { url: string; type: Item['type']; aspectRatio?: number; suggested: boolean }[];
};
export type SpaceDetail = Omit<SpaceSummary, 'itemCount' | 'suggestionCount' | 'previews'> & { items: Item[]; suggestions: Item[] };

export const api = {
  animalId: {
    warmup: endpoint<Empty, null>('animalId.warmup'),
  },
  animals: {
    attachArtwork: endpoint<{ captureId: string; stickerStorageId?: string; dominantColor?: string }, null>('animals.attachArtwork'),
    confirmIdentification: endpoint<{ id: string; scientificName: string }, null>('animals.confirmIdentification'),
    createCapture: endpoint<any, string>('animals.createCapture'), deleteCapture: endpoint<{ id: string }, null>('animals.deleteCapture'),
    generateUploadUrl: endpoint<Empty, string>('animals.generateUploadUrl'),
    getCapture: endpoint<{ id: string }, Capture | null>('animals.getCapture'),
    listCaptures: endpoint<Empty, Capture[]>('animals.listCaptures'),
  },
  catalog: {
    listAll: endpoint<Empty, CatalogEntry[]>('catalog.listAll'),
  },
  community: {
    leaderboard: endpoint<{ period: 'month' | 'all' }, LeaderboardEntry[]>('community.leaderboard'),
    register: endpoint<{ board: RegisterBoard; scope?: RegisterScope }, RegisterEntry[]>('community.register'),
    friends: endpoint<Empty, Friend[]>('community.friends'),
    findExplorer: endpoint<{ handle: string }, Friend | null>('community.findExplorer'),
    myHandle: endpoint<Empty, string | null>('community.myHandle'),
    requestFriend: endpoint<{ userId: string }, string>('community.requestFriend'),
    respondFriend: endpoint<{ accept: boolean; userId: string }, string>('community.respondFriend'),
    myVisibility: endpoint<Empty, boolean>('community.myVisibility'),
    profile: endpoint<{ userId: string }, CommunityProfile | null>('community.profile'),
    setVisible: endpoint<{ visible: boolean }, null>('community.setVisible'),
  },
  profile: {
    /** Le code ISO déclaré à l'onboarding, `'declined'`, ou null si jamais demandé. */
    /** `profiles.is_premium`, lu par la RPC `is_premium()`. La vérité. */
    isPremium: endpoint<Empty, boolean>('profile.isPremium'),
    myRegion: endpoint<Empty, string | null>('profile.myRegion'),
    /** Le canal déclaré à l'onboarding. `null` quand l'écran a été sauté. */
    setAcquisitionSource: endpoint<{ source: string | null }, null>('profile.setAcquisitionSource'),
    setRegion: endpoint<{ region: string | null }, null>('profile.setRegion'),
  },
  decks: {
    ensureDefaults: endpoint<Empty, null>('decks.ensureDefaults'), get: endpoint<{ id: string }, DeckResult | null>('decks.get'),
    listCommunity: endpoint<Empty, DeckSummary[]>('decks.listCommunity'), listMine: endpoint<Empty, DeckSummary[]>('decks.listMine'),
    listMineWithCards: endpoint<Empty, DeckResult[]>('decks.listMineWithCards'),
    /** Épingle ce deck sur le profil. `null` dépingle. */
    pin: endpoint<{ deckId: string | null }, null>('decks.pin'),
    placeCard: endpoint<{ deckId: string; captureId: string; position: number }, null>('decks.placeCard'),
    reorderCards: endpoint<{ deckId: string; captureIds: string[] }, null>('decks.reorderCards'),
    toggleCard: endpoint<{ deckId: string; captureId: string }, boolean>('decks.toggleCard'),
    toggleLike: endpoint<{ id: string }, boolean>('decks.toggleLike'), togglePublic: endpoint<{ id: string }, boolean>('decks.togglePublic'),
  },
  expeditions: {
    end: endpoint<Empty, string | null>('expeditions.end'),
    get: endpoint<{ id: string }, { summary: ExpeditionSummary; captures: Capture[] } | null>('expeditions.get'),
    getActive: endpoint<Empty, ExpeditionSummary | null>('expeditions.getActive'),
    listMine: endpoint<Empty, ExpeditionSummary[]>('expeditions.listMine'), start: endpoint<Empty, string>('expeditions.start'),
  },
  items: {
    createImageItem: endpoint<any, string>('items.createImageItem'), createLinkItem: endpoint<{ url: string; spaceId?: string }, string>('items.createLinkItem'),
    createNoteItem: endpoint<{ text: string; spaceId?: string }, string>('items.createNoteItem'), deleteItem: endpoint<{ id: string }, null>('items.deleteItem'),
    findLinks: endpoint<{ id: string }, null>('items.findLinks'), generateUploadUrl: endpoint<Empty, string>('items.generateUploadUrl'),
    getItem: endpoint<{ id: string }, Item | null>('items.getItem'), listItems: endpoint<Empty, Item[]>('items.listItems'),
    searchItems: endpoint<{ query: string }, Item[]>('items.searchItems'), similarItems: endpoint<{ id: string }, Item[]>('items.similarItems'),
  },
  moderation: {
    block: endpoint<{ userId: string }, null>('moderation.block'),
    blocked: endpoint<Empty, BlockedUser[]>('moderation.blocked'),
    report: endpoint<{ kind: 'deck' | 'profile' | 'capture'; targetId: string; reason: ReportReason; note?: string }, null>('moderation.report'),
    unblock: endpoint<{ userId: string }, null>('moderation.unblock'),
  },
  reports: { reportIdentification: endpoint<{ captureId: string; claimedName: string; note?: string }, null>('reports.reportIdentification') },
  seasons: { inSeason: endpoint<{ region?: string; month?: number; limit?: number }, { scientificName: string; share: number; monthlyCounts: number[] }[]>('seasons.inSeason') },
  spaces: {
    acceptAllSuggestions: endpoint<{ spaceId: string }, null>('spaces.acceptAllSuggestions'), acceptSuggestion: endpoint<{ itemId: string; spaceId: string }, null>('spaces.acceptSuggestion'),
    addItemToSpace: endpoint<{ itemId: string; spaceId: string }, null>('spaces.addItemToSpace'), createSpace: endpoint<{ name: string; description?: string; dynamic?: boolean }, string>('spaces.createSpace'),
    deleteSpace: endpoint<{ id: string }, null>('spaces.deleteSpace'), dismissSuggestion: endpoint<{ itemId: string; spaceId: string }, null>('spaces.dismissSuggestion'),
    getSpace: endpoint<{ id: string }, SpaceDetail | null>('spaces.getSpace'), listSpaces: endpoint<Empty, SpaceSummary[]>('spaces.listSpaces'),
    removeItemFromSpace: endpoint<{ itemId: string; spaceId: string }, null>('spaces.removeItemFromSpace'), updateSpace: endpoint<{ id: string; name?: string; dynamic?: boolean }, null>('spaces.updateSpace'),
  },
} as const;
