// Répare la collision d'identifiants entre la dépendance Swift Package de Clerk
// et l'objet projet du workspace Pods.
//
// LE DÉFAUT
//
// CocoaPods attribue les identifiants du projet Pods avec un compteur
// séquentiel « that skips collision checks » — ce sont les mots d'Expo, dans
// `expo-modules-autolinking/scripts/ios/cocoapods/installer.rb`, qui connaît le
// problème et tente de le corriger. Mais son garde-fou lit `objects_by_uuid`,
// et l'objet PROJET n'y figure pas : c'est exactement le trou par lequel
// ClerkKit passe.
//
// ClerkKit reçoit alors l'identifiant du projet et le REMPLACE dans le
// dictionnaire. `root_object` renvoie toujours un `PBXProject` — l'objet Ruby
// existe — mais il n'est plus dans le dictionnaire, donc jamais sérialisé. Le
// fichier écrit n'a plus d'objet projet et son `rootObject` pointe dans le
// vide. Xcode répond :
//
//   The project 'Pods' is damaged and cannot be opened.
//   -[XCSwiftPackageProductDependency _setSavedArchiveVersion:]: unrecognized selector
//
// Plus aucun pod ne se construit, et ce qui s'affiche ensuite n'a aucun rapport
// avec la cause : un xcconfig introuvable, un modulemap manquant, ou un symbole
// `RNMBXRainProps` absent parce que `ReactCodegen` n'a jamais été compilé.
//
// LE DÉCLENCHEUR EST UNE LOTERIE
//
// Ajouter ou retirer n'importe quelle dépendance native décale le compteur,
// donc l'index sur lequel ClerkKit atterrit. Le projet a construit des mois
// avant de tomber dessus, et ça peut recommencer au prochain `bun add`.
//
// CE QU'ON NE FAIT PAS
//
// Passer CocoaPods en identifiants déterministes règle CE défaut mais en crée
// un autre : les identifiants deviennent des MD5 et les huit `Props.cpp`
// homonymes du codegen s'écrasent — un seul est compilé, sept jeux de symboles
// manquent au link. Mesuré. On ne touche donc pas au mode global.
//
// LE CORRECTIF VIT DANS UN .rb À CÔTÉ
//
// C'est du Ruby injecté dans le Podfile ; le garder en Ruby le laisse lisible
// et évite d'échapper ses backticks dans une chaîne JavaScript.
//
// LA VÉRIFICATION, APRÈS TOUT `pod install`
//
//   grep -c "isa = PBXProject" ios/Pods/Pods.xcodeproj/project.pbxproj   -> 1
//   grep "Props.cpp in Sources" ... | grep -c "fileRef ="                -> 8

const { withDangerousMod } = require('expo/config-plugins');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Juste après les `require` du haut : le correctif doit s'appliquer AVANT
// que le moindre objet de projet ne soit créé. Placé dans `post_install`, il
// arrivait trop tard — c'est exactement le défaut du correctif d'Expo.
const ANCRE = "require 'json'";
const MARQUEUR = "LE GÉNÉRATEUR D'IDENTIFIANTS";

module.exports = function withPodsUuidCollisionFix(config) {
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const chemin = join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      const podfile = readFileSync(chemin, 'utf8');

      if (podfile.includes(MARQUEUR)) return modConfig;
      if (!podfile.includes(ANCRE)) {
        // On ne patche pas à l'aveugle : sans l'ancre, on ignore où le
        // correctif doit vivre, et un Podfile mal formé casse tout le build.
        throw new Error(
          '[with-pods-uuid-collision-fix] ancre introuvable dans le Podfile : ' +
            'le gabarit Expo a changé, ce plugin doit être mis à jour.',
        );
      }

      const correctif = readFileSync(join(__dirname, 'pods-uuid-collision-fix.rb'), 'utf8');
      writeFileSync(chemin, podfile.replace(ANCRE, `${ANCRE}\n\n${correctif}`));
      return modConfig;
    },
  ]);
};
