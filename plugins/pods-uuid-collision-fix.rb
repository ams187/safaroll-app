# LE GÉNÉRATEUR D'IDENTIFIANTS DE COCOAPODS N'EN VÉRIFIE AUCUN.
#
# `Pod::Project#generate_available_uuid_list` remplace celui d'Xcodeproj par
# un compteur séquentiel rapide — Expo le dit dans son propre code
# (`expo-modules-autolinking/scripts/ios/cocoapods/installer.rb`) : « a fast
# sequential counter that skips collision checks ».
#
# Ce compteur repart de zéro quand de nouveaux objets sont créés en cours
# d'installation — typiquement les dépendances Swift Package ajoutées par le
# helper `spm_dependency` de React Native, ici ClerkKit et ClerkKitUI via
# `ClerkExpo.podspec`. Ils réclament alors des identifiants DÉJÀ portés par
# d'autres objets et les écrasent dans le dictionnaire.
#
# LES VICTIMES SONT INVISIBLES AUX CONTRÔLES
#
# `objects_by_uuid` ne contient ni l'objet projet, ni son groupe racine.
# Aucun test d'unicité ne les voit — y compris celui d'Expo, qui tente déjà
# de corriger ce défaut mais construit son ensemble d'exclusion à partir de
# ce même dictionnaire, et arrive de toute façon APRÈS `post_install`, donc
# après la création des objets fautifs.
#
# CE QU'ON A VU EN COLMATANT VICTIME PAR VICTIME
#
# Chaque correction révélait la suivante, avec un message d'Xcode qui
# désignait à chaque fois un objet différent :
#
#   rootObject vide                             -> PBXProject volé
#   « wrong type assigned to rootGroup »         -> PBXGroup volé
#   « -[PBXShellScriptBuildPhase group] »        -> encore un autre
#
# Signe qu'il ne fallait pas réparer les victimes mais le tireur.
#
# LA CORRECTION
#
# On rend le générateur aléatoire dès le départ, au niveau de la CLASSE, donc
# avant que le moindre objet ne soit créé. Sur 24 caractères hexadécimaux
# (96 bits), deux tirages identiques sont hors de portée — et on exclut
# quand même explicitement ce qui est déjà attribué.
#
# C'est le remède d'Expo, appliqué assez tôt pour servir à quelque chose.
#
# LA VÉRIFICATION QUI COMPTE — celle d'Xcode, pas un grep :
#
#   xcodebuild -list -workspace ios/SafaRoll.xcworkspace
#
# Ne doit afficher ni « damaged » ni « Unable to open project file ».
require 'securerandom'
Pod::Project.class_eval do
  def generate_available_uuid_list(count = 100)
    neufs = (0..count).map { SecureRandom.hex(12).upcase }
    uniques = neufs.reject { |u| @generated_uuids.include?(u) || objects_by_uuid.key?(u) }
    @generated_uuids += uniques
    @available_uuids += uniques
  end
end
