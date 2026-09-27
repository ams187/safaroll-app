const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/**
 * LE SOUS-SPEC LIVE ACTIVITIES SUR LA CIBLE WIDGET.
 *
 * POURQUOI UN PLUGIN ET PAS UNE ÉDITION À LA MAIN
 *
 * `ios/` est régénéré à chaque `prebuild`. Un bloc ajouté au Podfile à la main
 * disparaît au prochain build natif, et le widget cesse de compiler sans que
 * rien n'ait changé dans le dépôt.
 *
 * CE QUE LA DOC ONESIGNAL IMPOSE, ET QUI AVAIT ÉTÉ MANQUÉ
 *
 * Le widget a besoin du type `DefaultLiveActivityAttributes`, qui vit dans le
 * module `OneSignalLiveActivities`. Sans lui : `no such module`. Il faut donc
 * le SOUS-SPEC seul — surtout pas l'agrégat `pod 'OneSignalXCFramework'`, qui
 * résout `OneSignalComplete` et embarque le module de localisation dans une
 * extension qui n'en a que faire.
 *
 * Et pas de `use_frameworks!` sur cette cible : c'est lui qui fabrique une
 * seconde copie des XCFramework et produit
 * « Multiple commands produce OneSignalCore.framework ». Ce dépôt n'active pas
 * `ios.useFrameworks`, donc la liaison est statique — il n'y a rien à couper,
 * seulement à ne pas ajouter.
 */
const CIBLE = 'SafaRollWidget';

const BLOC = `

target '${CIBLE}' do
  pod 'OneSignalXCFramework/OneSignalLiveActivities', '>= 5.0.0', '< 6.0'
end
`;

/**
 * LE WIDGET LIE LES XCFRAMEWORK, IL NE LES RECOPIE PAS.
 *
 * CocoaPods crée une cible pod PAR cible applicative qui consomme le pod :
 * `OneSignalXCFramework` pour l'app, `OneSignalXCFramework-<hash>` pour le
 * widget. Chacune reçoit une phase « [CP] Copy XCFrameworks » qui écrit dans
 * le MÊME `BUILT_PRODUCTS_DIR/XCFrameworkIntermediates`. Xcode voit alors deux
 * tâches produisant le même fichier et refuse de planifier le build :
 *
 *   error: Multiple commands produce '.../OneSignalCore.framework'
 *
 * Les deux copies sont identiques et vont au même endroit : la seconde est
 * donc purement redondante. On retire la phase de la cible du widget ; l'app
 * dépose les frameworks, le widget les trouve par ses chemins de recherche.
 *
 * ON NE TOUCHE QU'À LA CIBLE SUFFIXÉE. La cible sans suffixe est celle de
 * l'app : lui retirer la phase priverait tout le monde des frameworks.
 */
const CORRECTIF = `
    # LE HASH N'EST PAS STABLE, L'APPARTENANCE L'EST.
    #
    # CocoaPods nomme la cible pod du widget \`OneSignalXCFramework-<hash>\`,
    # et celle de l'APP porte le même préfixe avec un autre hash. Filtrer sur le
    # préfixe retire la phase des DEUX et prive l'app de ses frameworks.
    # Chaque \`PodTarget\` sait à quelles cibles du Podfile il appartient :
    # c'est le seul lien qui ne dépend d'aucun hash.
    installer.pod_targets.each do |pod_cible|
      next unless pod_cible.name.start_with?('OneSignalXCFramework')
      appartient = pod_cible.target_definitions.map(&:name)
      next unless appartient.include?('${CIBLE}')
      native = installer.pods_project.targets.find { |t| t.name == pod_cible.label }
      next unless native
      retirees = native.build_phases.select do |phase|
        phase.respond_to?(:name) && phase.name.to_s.include?('Copy XCFrameworks')
      end
      retirees.each { |phase| native.build_phases.delete(phase) }
      Pod::UI.puts "[live-activities] #{native.name} : #{retirees.size} phase(s) Copy XCFrameworks retiree(s)"
    end
    installer.pods_project.save

    # LA SIGNATURE EN PARALLÈLE, COUPÉE.
    #
    # « [CP] Embed Pods Frameworks » lance \`codesign ... &\` quand
    # \`COCOAPODS_PARALLEL_CODE_SIGN\` vaut \`true\`. Il signe alors les
    # frameworks EN MÊME TEMPS que \`CopySwiftLibs\` signe le bundle qui les
    # contient — deux \`codesign\` concurrents sur la même app, et macOS rend :
    #
    #   SafaRoll.debug.dylib: internal error in Code Signing subsystem
    #
    # Le message ne nomme ni la course ni le fichier fautif. Signé à la main,
    # le même .dylib passe sans broncher : c'est ce qui a désigné la
    # concurrence plutôt que le fichier.
    #
    # Le dev client d'Expo pèse 282 Mo — la fenêtre de recouvrement est large,
    # donc la course se perd presque à chaque fois.
    installer.pods_project.targets.each do |cible|
      cible.build_configurations.each do |config|
        config.build_settings['COCOAPODS_PARALLEL_CODE_SIGN'] = 'false'
      end
    end
    installer.pods_project.save

`;

module.exports = function withWidgetLiveActivities(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const source = fs.readFileSync(podfile, 'utf8');
      if (source.includes(`target '${CIBLE}'`)) return cfg;

      // Le correctif se greffe DANS le `post_install` existant. Un second bloc
      // `post_install` au niveau racine ÉCRASE le premier — celui d'Expo, qui
      // appelle `react_native_post_install`. L'ancre est sa fermeture.
      const ANCRE = '      :ccache_enabled => ccache_enabled?(podfile_properties),\n    )\n  end';
      if (!source.includes(ANCRE)) {
        throw new Error(
          '[with-widget-live-activities] ancre `post_install` introuvable : ' +
            'le gabarit Expo a changé, ce plugin doit être mis à jour.',
        );
      }
      const avec = source.replace(ANCRE, ANCRE.slice(0, -5) + CORRECTIF + '  end');
      fs.writeFileSync(podfile, avec + BLOC);
      return cfg;
    },
  ]);
};
