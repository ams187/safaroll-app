// « QUI EST-CE ? » — le chant d'un oiseau joint au push (ios_attachments).
//
// Le joueur appuie longuement sur la notification et entend l'enregistrement
// sans ouvrir l'app. En l'ouvrant, un in-app message (segment « Qui chante —
// réponse à révéler », tag `chant`) révèle l'espèce ; son bouton repasse le
// tag à `vu`.
//
// Les fichiers vivent dans le bucket public `notification-sounds/<slug>.mp3`
// (20 s, mono 64 kb/s). Enregistrements Wikimedia Commons sous licence libre :
// Photos iNaturalist, mêmes règles. Auteur et licence sont OBLIGATOIRES à l'affichage (CC BY / BY-SA), d'où leur
// présence ici et dans l'in-app message de révélation.

export type BirdSong = {
  slug: string;
  scientificName: string;
  fr: string;
  en: string;
  author: string;
  license: string;
  source: string;
  /** Photo shown in the reveal in-app message: `notification-images/oiseaux/<slug>.jpg`. */
  photoAuthor: string;
  photoLicense: string;
  photoSource: string;
};

export const BIRD_SONGS: BirdSong[] = [
  {"slug": "turdus-merula", "scientificName": "Turdus merula", "fr": "Merle noir", "en": "Eurasian Blackbird", "author": "Diana Tudor", "license": "CC BY 4.0", "source": "https://commons.wikimedia.org/wiki/File%3ACommon_Blackbird_song_%28Turdus_merula%29.ogg", "photoAuthor": "Luiz Lapa", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/356885346"},
  {"slug": "parus-major", "scientificName": "Parus major", "fr": "Mésange charbonnière", "en": "Great Tit", "author": "Gavin Vella", "license": "CC BY-SA 3.0", "source": "https://commons.wikimedia.org/wiki/File%3AParus_major_-_Great_Tit_XC129643.ogg", "photoAuthor": "hedera.baltica", "photoLicense": "CC BY-SA", "photoSource": "https://www.inaturalist.org/photos/452217076"},
  {"slug": "fringilla-coelebs", "scientificName": "Fringilla coelebs", "fr": "Pinson des arbres", "en": "Common Chaffinch", "author": "Benoît Van Hecke", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AFringilla_coelebs_-_Common_Chaffinch_XC582029.mp3", "photoAuthor": "William Stephens", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/112941859"},
  {"slug": "erithacus-rubecula", "scientificName": "Erithacus rubecula", "fr": "Rougegorge familier", "en": "European Robin", "author": "Jan Cibulka", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AErithacus_rubecula_-_European_Robin_XC441752.mp3", "photoAuthor": "Arjan Haverkamp", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/591732718"},
  {"slug": "cyanistes-caeruleus", "scientificName": "Cyanistes caeruleus", "fr": "Mésange bleue", "en": "Eurasian Blue Tit", "author": "Benoît Van Hecke", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3ACyanistes_caeruleus_-_Eurasian_Blue_Tit_XC539309.mp3", "photoAuthor": "Bengt Nyman", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/405357242"},
  {"slug": "columba-palumbus", "scientificName": "Columba palumbus", "fr": "Pigeon ramier", "en": "Common Wood-Pigeon", "author": "Oona Räisänen (Mysid)", "license": "Public domain", "source": "https://commons.wikimedia.org/wiki/File%3AColumba_palumbus_birdsong.ogg", "photoAuthor": "hedera.baltica", "photoLicense": "CC BY-SA", "photoSource": "https://www.inaturalist.org/photos/108521205"},
  {"slug": "passer-domesticus", "scientificName": "Passer domesticus", "fr": "Moineau domestique", "en": "House Sparrow", "author": "Jonathon Jongsma", "license": "CC BY-SA 3.0", "source": "https://commons.wikimedia.org/wiki/File%3APasser_domesticus_-_House_Sparrow_-_XC86749.ogg", "photoAuthor": "Esteban Poveda", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/136543105"},
  {"slug": "corvus-corone", "scientificName": "Corvus corone", "fr": "Corneille noire", "en": "Carrion Crow", "author": "Marie-Lan Taÿ Pamart", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3ACorvus_corone_-_Carrion_Crow_XC524681.mp3", "photoAuthor": "Luciano 95", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/1628225"},
  {"slug": "pica-pica", "scientificName": "Pica pica", "fr": "Pie bavarde", "en": "Eurasian Magpie", "author": "Benoît Van Hecke", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3APica_pica_-_Eurasian_Magpie_XC537413.mp3", "photoAuthor": "Andrejus Gaidamavičius", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/461634119"},
  {"slug": "streptopelia-decaocto", "scientificName": "Streptopelia decaocto", "fr": "Tourterelle turque", "en": "Eurasian Collared-Dove", "author": "Jonathon Jongsma", "license": "CC BY-SA 3.0", "source": "https://commons.wikimedia.org/wiki/File%3AStreptopelia_decaocto_-_Eurasian_Collared_Dove_-_XC82758.ogg", "photoAuthor": "Iruka", "photoLicense": "CC BY-SA", "photoSource": "https://www.inaturalist.org/photos/72298521"},
  {"slug": "sturnus-vulgaris", "scientificName": "Sturnus vulgaris", "fr": "Étourneau sansonnet", "en": "European Starling", "author": "Jochem verweij", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3ASturnus_vulgaris_-_Common_Starling_XC503745.mp3", "photoAuthor": "Timothy Lindsey", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/488854941"},
  {"slug": "larus-fuscus", "scientificName": "Larus fuscus", "fr": "Goéland brun", "en": "Lesser Black-backed Gull", "author": "Tanguy Loïs", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AGaviota_sombr%C3%ADa_%28Larus_fuscus%29.wav", "photoAuthor": "Cody Delano", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/97967534"},
  {"slug": "larus-argentatus", "scientificName": "Larus argentatus", "fr": "Goéland argenté", "en": "European Herring Gull", "author": "Sonothèque ADVL", "license": "CC0", "source": "https://commons.wikimedia.org/wiki/File%3AXC707075_-_European_Herring_Gull_-_Larus_argentatus.mp3", "photoAuthor": "Stu's Images", "photoLicense": "CC BY-SA", "photoSource": "https://www.inaturalist.org/photos/308158217"},
  {"slug": "carduelis-carduelis", "scientificName": "Carduelis carduelis", "fr": "Chardonneret élégant", "en": "European Goldfinch", "author": "Sander Pieterse", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3ACarduelis_carduelis_-_European_Goldfinch_XC101463.mp3", "photoAuthor": "Sylvain Montagner", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/339051672"},
  {"slug": "anas-platyrhynchos", "scientificName": "Anas platyrhynchos", "fr": "Canard colvert", "en": "Mallard", "author": "Ndalyrose", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AMallard_%28Anas_platyrhynchos%29_%28W1CDR0001518_BD17%29.ogg", "photoAuthor": "anonymous", "photoLicense": "CC BY-SA", "photoSource": "https://www.inaturalist.org/photos/95268822"},
  {"slug": "garrulus-glandarius", "scientificName": "Garrulus glandarius", "fr": "Geai des chênes", "en": "Eurasian Jay", "author": "Vladimir Yu. Arkhipov, Arkhivov", "license": "CC BY-SA 3.0", "source": "https://commons.wikimedia.org/wiki/File%3AGarrulus_glandarius_iphigenia.ogg", "photoAuthor": "Luc Viatour", "photoLicense": "CC BY-SA", "photoSource": "https://www.inaturalist.org/photos/168146456"},
  {"slug": "ardea-cinerea", "scientificName": "Ardea cinerea", "fr": "Héron cendré", "en": "Grey Heron", "author": "Joost van Bruggen", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AArdea_cinerea_-_Grey_Heron_XC432919.mp3", "photoAuthor": "Frank Sengpiel", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/73516715"},
  {"slug": "hirundo-rustica", "scientificName": "Hirundo rustica", "fr": "Hirondelle rustique", "en": "Barn Swallow", "author": "Jonathon Jongsma", "license": "CC BY-SA 3.0", "source": "https://commons.wikimedia.org/wiki/File%3AHirundo_rustica_-_Barn_Swallow_-_XC83449.ogg", "photoAuthor": "Donald Davesne", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/635249690"},
  {"slug": "falco-tinnunculus", "scientificName": "Falco tinnunculus", "fr": "Faucon crécerelle", "en": "Eurasian Kestrel", "author": "Pascal Christe", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AFalco_tinnunculus_-_Common_Kestrel_XC589714.mp3", "photoAuthor": "Frank Vassen", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/115746261"},
  {"slug": "picus-viridis", "scientificName": "Picus viridis", "fr": "Pic vert", "en": "Eurasian Green Woodpecker", "author": "Ndalyrose", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AGreen_Woodpecker_%28Picus_viridis%29_%28W1CDR0001497_BD6%29.ogg", "photoAuthor": "Andrea Poggi", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/242668015"},
  {"slug": "dendrocopos-major", "scientificName": "Dendrocopos major", "fr": "Pic épeiche", "en": "Great Spotted Woodpecker", "author": "Vladimir Yu. Arkhipov, Arkhivov", "license": "CC BY-SA 3.0", "source": "https://commons.wikimedia.org/wiki/File%3ADendrocopos_major.ogg", "photoAuthor": "Paolo Zucca", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/11783387"},
  {"slug": "chroicocephalus-ridibundus", "scientificName": "Chroicocephalus ridibundus", "fr": "Mouette rieuse", "en": "Black-headed Gull", "author": "Nikita Panfilov", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AChroicocephalus_ridibundus_-_Black-headed_Gull_XC571971.mp3", "photoAuthor": "Alexis Lours", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/372060792"},
  {"slug": "phalacrocorax-carbo", "scientificName": "Phalacrocorax carbo", "fr": "Grand Cormoran", "en": "Great Cormorant", "author": "Sonothèque ADVL", "license": "CC0", "source": "https://commons.wikimedia.org/wiki/File%3ACormor%C3%A1n_grande_%28Phalacrocorax_carbo%29.mp3", "photoAuthor": "Frank Vassen", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/132916240"},
  {"slug": "egretta-garzetta", "scientificName": "Egretta garzetta", "fr": "Aigrette garzette", "en": "Little Egret", "author": "Joost van Bruggen", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AEgretta_garzetta_-_Little_Egret_XC432219.mp3", "photoAuthor": "Bengt Nyman", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/205293169"},
  {"slug": "gallinula-chloropus", "scientificName": "Gallinula chloropus", "fr": "Gallinule poule-d'eau", "en": "Eurasian Moorhen", "author": "Luis Alvarez Menendez", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AGallinula_chloropus_-_Common_Moorhen_XC548464.mp3", "photoAuthor": "Alexis Lours", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/171773229"},
  {"slug": "larus-michahellis", "scientificName": "Larus michahellis", "fr": "Goéland leucophée", "en": "Yellow-legged Gull", "author": "Cedric MROCZKO", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AYellow-legged_Gull_-_Larus_michahellis_michahellis.ogg", "photoAuthor": "Jörg Hempel", "photoLicense": "CC BY-SA", "photoSource": "https://www.inaturalist.org/photos/12831"},
  {"slug": "cygnus-olor", "scientificName": "Cygnus olor", "fr": "Cygne tuberculé", "en": "Mute Swan", "author": "Alexander Kürthy", "license": "CC BY-SA 3.0", "source": "https://commons.wikimedia.org/wiki/File%3ACygnus_olor_-_Mute_Swan_XC307509.mp3", "photoAuthor": "Laura Mae", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/283242966"},
  {"slug": "ardea-alba", "scientificName": "Ardea alba", "fr": "Grande Aigrette", "en": "Great Egret", "author": "Stanislas Wroza", "license": "CC BY 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AGreat_Egret_%28Ardea_alba_alba%29_call.ogg", "photoAuthor": "Mike Baird", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/359167878"},
  {"slug": "cuculus-canorus", "scientificName": "Cuculus canorus", "fr": "Coucou", "en": "Common Cuckoo", "author": "Barracuda1983", "license": "CC BY-SA 3.0", "source": "https://commons.wikimedia.org/wiki/File%3ACuculus_canorus_song.ogg", "photoAuthor": "Юрий Носков", "photoLicense": "CC0", "photoSource": "https://www.inaturalist.org/photos/241715354"},
  {"slug": "alcedo-atthis", "scientificName": "Alcedo atthis", "fr": "Martin-pêcheur", "en": "Common Kingfisher", "author": "Marie-Lan Taÿ Pamart", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/wiki/File%3AAlcedo_atthis_-_Common_Kingfisher_XC476785.mp3", "photoAuthor": "Frank Sengpiel", "photoLicense": "CC BY", "photoSource": "https://www.inaturalist.org/photos/33183952"},
];

/** Au plus un « Qui est-ce ? » tous les trois jours : c'est un jeu, pas un rappel. */
export const INTERVALLE_JOURS = 3;

/**
 * Le chant à proposer, ou null.
 *
 * Seulement une espèce présente dans la région CE MOIS-CI (courbes GBIF) et
 * absente de la collection : deviner un oiseau qu'on possède déjà n'apprend
 * rien, et proposer un migrateur parti depuis août serait faux. Parmi les
 * candidates, on tourne d'un jour à l'autre pour ne pas reproposer la même.
 */
export function choisirChant(
  presenceCeMois: Map<string, number>,
  possedees: Set<string>,
  jour: number,
): BirdSong | null {
  const candidates = BIRD_SONGS
    .filter((s) => (presenceCeMois.get(s.scientificName) ?? 0) > 0 && !possedees.has(s.scientificName))
    .sort((a, b) => (presenceCeMois.get(b.scientificName)! - presenceCeMois.get(a.scientificName)!) || a.slug.localeCompare(b.slug));
  return candidates.length ? candidates[jour % candidates.length] : null;
}
