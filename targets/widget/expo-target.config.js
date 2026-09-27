/**
 * LA CIBLE WIDGET, GÉNÉRÉE AU PREBUILD.
 *
 * `@bacons/apple-targets` fabrique une extension Xcode à partir de ce dossier :
 * le Swift ci-contre, l'`Info.plist`, les entitlements et le catalogue d'assets.
 * Rien de tout ça ne vit dans `ios/`, qui reste jetable et régénérable.
 *
 * L'APP GROUP EST LE SEUL PONT. Une extension est un binaire SÉPARÉ : elle ne
 * partage ni la mémoire, ni le stockage, ni le bundle JS de l'app. Tout ce que
 * le widget sait vient de `UserDefaults(suiteName:)` sur ce groupe, écrit côté
 * app par `ExtensionStorage` (voir `src/lib/widget-storage.ts`).
 *
 * C'est le même groupe que l'extension de partage, déjà déclaré par le plugin
 * `expo-sharing` — pas d'identifiant en double à provisionner.
 *
 * @type {import('@bacons/apple-targets').ConfigPluginConfig}
 */
module.exports = () => ({
  type: 'widget',
  name: 'SafaRollWidget',
  icon: '../../assets/icon.png',
  entitlements: {
    'com.apple.security.application-groups': ['group.com.example.safaroll'],
  },
  // Le plugin fabrique l'`imageset` et l'expose en `Image("guepard")` côté
  // Swift. Une extension ne voit AUCUN asset de l'app : tout ce qu'elle affiche
  // doit soit être déclaré ici, soit arriver par l'App Group à l'exécution.
  images: {
    // ActivityKit needs a small source asset, not just a resized SwiftUI frame.
    'guepard-activity': {
      '1x': '../../assets/widget/activity-cheetah@1x.png',
      '2x': '../../assets/widget/activity-cheetah@2x.png',
      '3x': '../../assets/widget/activity-cheetah@3x.png',
    },
    // Le guépard en train de déclencher, généré pour ce widget. Cadré serré sur
    // la tête et l'objectif : à 158 pt, un plan large rend le personnage
    // illisible — vérifié à la taille réelle avant de choisir.
    //
    // LES TROIS ÉCHELLES SONT OBLIGATOIRES, ET C'EST LE PIÈGE DE CE PLUGIN.
    //
    // Une image donnée EN CHAÎNE est traduite en
    // `{ "1x": image, "2x": undefined, "3x": undefined }` — le catalogue sort
    // alors avec les cases 2x et 3x DÉCLARÉES MAIS VIDES. Sur un écran 3x, iOS
    // demande `guepard@3x`, trouve une case sans fichier, et le widget rend un
    // rectangle gris. Vérifié dans l'`Assets.car` compilé : `guepard` n'y
    // existait qu'en `Scale: 1`.
    //
    // Corriger le `Contents.json` à la main ne sert à rien : le plugin le
    // réécrit à chaque `prebuild`. C'est ici, et seulement ici.
    //
    // 200 / 400 / 600 px : un `systemSmall` fait 158 pt, soit 474 px en 3x.
    // Le 1024² d'origine coûtait 4 Mo de décodage dans une extension dont le
    // budget mémoire tient en une trentaine.
    guepard: {
      '1x': '../../assets/widget/camera@1x.png',
      '2x': '../../assets/widget/camera@2x.png',
      '3x': '../../assets/widget/camera@3x.png',
    },
    // LE MARK DE L'ÉCRAN VERROUILLÉ, ET IL NE PEUT PAS ÊTRE UNE PHOTO.
    //
    // iOS force le monochrome sur les accessoires : il ne garde que l'ALPHA de
    // l'image et la peint en blanc. Le guépard photographique y devenait une
    // tache blanche — vérifié, sa caméra, ses yeux et ses taches vivent dans la
    // couleur, pas dans la forme, donc tout disparaissait.
    //
    // Ce gabarit est tiré de l'icône de l'app : un disque plein dont les yeux,
    // le museau et les taches sont des TROUS. Un creux survit au monochrome,
    // un détail de couleur non. C'est la même raison qui fait que ChatGPT pose
    // son logo sur le verrou plutôt qu'une illustration.
    mark: {
      '1x': '../../assets/widget/mark@1x.png',
      '2x': '../../assets/widget/mark@2x.png',
      '3x': '../../assets/widget/mark@3x.png',
    },
  },
  colors: {
    // Repris de `src/unistyles.ts` : le widget ne peut pas lire le thème de
    // l'app, ces valeurs sont donc la seule source de vérité de son côté.
    $accent: '#E3A93C',
    // LE FOND EST UN DÉGRADÉ, EN DEUX TEINTES.
    //
    // Un aplat, quel qu'il soit, écrasait la tuile — vérifié sur les dix
    // couleurs du thème. Les widgets qui tiennent (Duolingo, Clucky) posent
    // soit un blanc, soit un dégradé : jamais une couleur pleine et saturée.
    //
    // Clair en haut pour que le titre respire, l'or montant du bas là où le
    // guépard le rejoint — le personnage semble alors posé sur quelque chose
    // plutôt que découpé sur du vide.
    $widgetBackground: '#fffdf8',
    $widgetBackgroundEnd: '#EED28B',
    // L'encre des libellés. `$accent` est un OR : posé sur le fond or, il
    // disparaît. C'est le `foreground` du thème clair, le même couple
    // encre-sur-or que la plaque des cartes.
    $widgetInk: '#2b2418',
    // LE QUATRIÈME OR, ET IL EXISTE POUR LA MÊME RAISON QUE LES TROIS AUTRES.
    //
    // Le paywall porte déjà `OR_BOUTON` pour les aplats et `OR_COCHE` pour les
    // marques posées dessus, parce qu'un or saturé se noie selon le fond.
    // Ici le fond est presque blanc : mesuré, `OR_BOUTON` tombe à 2,06:1 et
    // même `OR_COCHE` à 2,77:1 — sous le plancher de 3:1 d'un gros texte.
    // Celui-ci tient 3,92:1, même teinte, simplement assombri.
    $widgetTitle: '#a8761a',
  },
});
