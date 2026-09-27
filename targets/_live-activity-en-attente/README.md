# Live Activity d'expédition — en attente

Ce dossier N'EST PAS une cible. `@bacons/apple-targets` ne découvre que les
dossiers de `targets/` contenant un `expo-target.config`, et seul
`targets/widget/` est compilé. Le Swift ci-joint est donc conservé, pas construit.

## Où ça a bloqué

Le widget ne voit pas le module :

    targets/widget/ExpeditionActivity.swift:2:8
    no such module 'OneSignalLiveActivities'

## Ce qui a déjà été écarté, avec la raison

1. **`liveActivities` du plugin OneSignal** (il fabrique sa propre cible) —
   `@bacons/apple-targets` tourne ensuite, ne trouve pas sa cible par nom de
   produit et retombe sur `targets[0]`, c'est-à-dire une cible OneSignal, puis
   tente de réécrire sa liste de configurations. Le prebuild meurt sur
   `Cannot read properties of undefined (reading 'removeFromProject')`
   (`with-xcode-changes.js:65`).

2. **`pod 'OneSignalXCFramework/OneSignalLiveActivities'` dans le bloc widget** —
   CocoaPods fabrique une seconde cible pod dont le script « Copy XCFrameworks »
   écrit vers le même dossier que celle de l'app :
   `error: Multiple commands produce '.../OneSignalCore.framework'`.
   Ajouter `inherit! :search_paths` ne l'annule pas : une ligne `pod` recrée la
   dépendance quoi qu'il arrive.

3. **`inherit! :search_paths` seul** — supprime bien le doublon (vérifié), mais
   les chemins hérités ne suffisent pas à exposer le MODULE Swift à l'extension.
   C'est l'état où ce dossier a été mis de côté.

## Pistes non essayées

- Ouvrir le projet dans Xcode et ajouter `OneSignalLiveActivities.xcframework`
  aux frameworks liés de la cible widget, puis reporter le réglage dans un
  plugin (l'édition manuelle de `ios/` est perdue au prebuild).
- Déclarer dans le widget une structure `ActivityAttributes` maison au lieu de
  `DefaultLiveActivityAttributes`, et abandonner `setupDefault()` côté JS pour
  des liaisons ActivityKit explicites. Plus de code, mais aucune dépendance de
  module dans l'extension.

## Côté JS

`startExpeditionActivity` et son appel dans `expedition-banner.tsx` ont été
retirés en même temps. `OneSignal.LiveActivities.setupDefault()` reste dans
`configureOneSignal` : sans widget il ne fait rien, et il sera nécessaire le
jour où celui-ci existera.
