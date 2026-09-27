const { withXcodeProject } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/**
 * L'APP GROUP RETIRÉ DE LA SEULE NSE.
 *
 * LE BLOCAGE
 *
 * `onesignal-expo-plugin` pose `appGroupName` sur l'app ET sur son extension
 * de service. Sur l'extension, Xcode ne trouve pas de profil explicite et
 * retombe sur le joker `iOS Team Provisioning Profile: *` — qui, par règle
 * Apple, ne peut jamais porter d'App Group :
 *
 *   Provisioning profile "iOS Team Provisioning Profile: *" doesn't support
 *   the group.com.example.safaroll App Group.
 *
 * L'App ID explicite existe pourtant (GZ7ACN4RXM) et porte la CAPACITÉ
 * App Groups. Ce qui manque est le RATTACHEMENT du groupe à cet App ID, qui
 * se fait au portail développeur et que l'API App Store Connect n'expose pas.
 *
 * CE QU'ON PERD, ET POURQUOI C'EST ACCEPTABLE
 *
 * L'App Group ne sert à la NSE que pour les « confirmed deliveries », le
 * badge et les « influenced opens » — trois mesures. Il ne sert PAS aux
 * images : celles-ci passent par `UNNotificationAttachment`, que l'extension
 * télécharge elle-même sans rien partager avec l'app.
 *
 * On échange donc trois statistiques contre la fonctionnalité visible. Le jour
 * où le groupe sera rattaché au portail, supprimer ce plugin les rend.
 */
// `withXcodeProject` ET NON `withDangerousMod`, ET C'EST UNE QUESTION D'ORDRE.
//
// Expo exécute TOUS les mods « dangereux » avant de toucher au projet Xcode.
// Or `onesignal-expo-plugin` crée le dossier de la NSE pendant sa passe
// `withXcodeProject` : un mod dangereux, même enregistré après lui, s'exécute
// alors que le fichier d'entitlements n'existe pas encore, et repart sans
// rien faire. Vérifié — la première version de ce plugin ne modifiait rien.
module.exports = function withNseNoAppGroup(config) {
  return withXcodeProject(config, (cfg) => {
    {
      const dossier = path.join(
        cfg.modRequest.platformProjectRoot,
        'OneSignalNotificationServiceExtension',
      );
      const fichier = path.join(dossier, 'OneSignalNotificationServiceExtension.entitlements');
      if (!fs.existsSync(fichier)) return cfg;

      const source = fs.readFileSync(fichier, 'utf8');
      // On retire la clé ET son tableau, pas seulement la valeur : un
      // `application-groups` vide est lui aussi refusé par le profil joker.
      const nettoye = source.replace(
        /\s*<key>com\.apple\.security\.application-groups<\/key>\s*<array>[\s\S]*?<\/array>/,
        '',
      );
      if (nettoye !== source) fs.writeFileSync(fichier, nettoye);
      return cfg;
    }
  });
};
