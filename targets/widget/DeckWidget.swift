import WidgetKit
import SwiftUI

// LE WIDGET DECK — RÉSERVÉ À SAFAROLL+, MAIS TOUJOURS VISIBLE.
//
// POURQUOI IL N'EST PAS MASQUÉ AUX NON-ABONNÉS
//
// Un widget masqué n'est jamais découvert. Un widget VERROUILLÉ est une
// vitrine : l'utilisateur le croise dans la galerie au moment exact où il
// cherche à personnaliser son écran d'accueil — le meilleur contexte d'achat
// du système. iOS ne permet d'ailleurs aucun cadenas sur le chrome de la
// galerie (c'est SpringBoard qui la dessine) : le seul levier est l'APERÇU,
// rendu par ce fichier. D'où un état verrouillé soigné plutôt qu'une absence.
//
// CE QU'IL SAIT, ET COMMENT
//
// Rien par lui-même. Une extension est un binaire séparé : ni session, ni
// jeton, ni réseau. Tout vient de l'App Group, écrit par l'app dans
// `src/lib/widget-storage.ts`. Si l'app oublie d'écrire après un achat, le
// widget reste verrouillé pour quelqu'un qui vient de payer.
//
// TROIS ÉTATS, ET LE TROISIÈME EST CELUI QU'ON OUBLIE
//
//   verrouillé   pas d'abonnement        → cadenas, appui = paywall
//   en attente   abonné, aucune image    → invite à ouvrir l'app
//   prêt         abonné + image          → le deck
//
// Sans le deuxième, un abonné qui pose le widget avant que l'app ait rendu son
// deck voit un cadre vide et croit que c'est cassé.

private let appGroupID = "group.com.example.safaroll"

struct DeckEntry: TimelineEntry {
    let date: Date
    let premium: Bool
    let image: UIImage?
    let deckName: String
}

struct DeckProvider: TimelineProvider {
    private func lire() -> DeckEntry {
        let defaults = UserDefaults(suiteName: appGroupID)
        let premium = defaults?.string(forKey: "safaroll.premium") == "1"
        let nom = defaults?.string(forKey: "safaroll.deckName") ?? ""
        let chemin = defaults?.string(forKey: "safaroll.deckImage") ?? ""
        // `UIImage(contentsOfFile:)` et pas `named:` — l'image est produite à
        // l'exécution par l'app, elle n'est dans aucun catalogue d'assets.
        let image = chemin.isEmpty ? nil : UIImage(contentsOfFile: chemin)
        return DeckEntry(date: Date(), premium: premium, image: image, deckName: nom)
    }

    // L'aperçu de la galerie passe par ici. On y montre l'état VERROUILLÉ :
    // c'est lui qui doit donner envie.
    func placeholder(in context: Context) -> DeckEntry {
        DeckEntry(date: Date(), premium: false, image: nil, deckName: "")
    }

    func getSnapshot(in context: Context, completion: @escaping (DeckEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : lire())
    }

    // `.never` : rien ne change tout seul. C'est l'app qui appelle
    // `reloadWidget()` quand le deck ou l'abonnement bouge — donc aucun budget
    // de rafraîchissement WidgetKit consommé.
    func getTimeline(in context: Context, completion: @escaping (Timeline<DeckEntry>) -> Void) {
        completion(Timeline(entries: [lire()], policy: .never))
    }
}

struct DeckWidgetView: View {
    var entry: DeckEntry

    // UN FOND FIXE INTERDIT LES COULEURS SÉMANTIQUES.
    //
    // Le conteneur du widget est or (`$widgetBackground`), quel que soit le
    // thème du téléphone. Or `.primary` et `.secondary` d'iOS BASCULENT avec ce
    // thème : en sombre, un `Text` sans couleur explicite sort en blanc — sur
    // de l'or. Et `$accent`, qui est lui-même un or, tombait à 1,42:1 contre le
    // fond, soit un glyphe invisible.
    //
    // Tout ce qui s'écrit ici prend donc l'encre, mesurée à 10,4:1.
    private var encre: Color { Color("$widgetInk") }

    var body: some View {
        if !entry.premium {
            verrouille
        } else if let image = entry.image {
            pret(image)
        } else {
            enAttente
        }
    }

    private var verrouille: some View {
        VStack(spacing: 7) {
            Image(systemName: "lock.fill")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(encre)
            Text("widget_deck_locked_title")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(encre)
            Text("widget_deck_locked_body")
                .font(.system(size: 11))
                .foregroundStyle(encre.opacity(0.62))
                .multilineTextAlignment(.center)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var enAttente: some View {
        VStack(spacing: 7) {
            Image(systemName: "rectangle.stack")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(encre)
            Text("widget_deck_waiting")
                .font(.system(size: 11))
                .foregroundStyle(encre.opacity(0.62))
                .multilineTextAlignment(.center)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func pret(_ image: UIImage) -> some View {
        // `scaledToFit` ET NON `Fill`, et c'est tout le sujet.
        //
        // L'image est une PILE : haute et étroite, deux fois plus haute que
        // large. `scaledToFill` la faisait remplir la tuile carrée par la
        // largeur, donc en rognant les trois quarts de la hauteur — on ne
        // voyait plus que le milieu de deux cartes, énormes.
        //
        // Ajustée à l'intérieur, la pile tient en entier ; le dégradé du
        // conteneur occupe ce qui reste de chaque côté, ce qui est exactement
        // ce qu'on veut : la pile est l'objet, le fond est le sous-main.
        VStack(spacing: 4) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if !entry.deckName.isEmpty {
                Text(entry.deckName)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(encre)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .padding(12)
    }
}

struct DeckWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SafaRollDeck", provider: DeckProvider()) { entry in
            DeckWidgetView(entry: entry)
                // Verrouillé, l'appui mène au paywall ; débloqué, à la collection.
                .widgetURL(URL(string: entry.premium ? "safaroll://" : "safaroll://paywall"))
                // Le même dégradé que le widget caméra : deux tuiles du même
                // jeu, côte à côte sur l'écran d'accueil, ne peuvent pas avoir
                // deux fonds différents.
                .containerBackground(fondSafaRoll, for: .widget)
        }
        // LES MARGES DU SYSTÈME SONT DÉSACTIVÉES, ET C'EST OBLIGATOIRE ICI.
        //
        // Depuis iOS 17, WidgetKit inset le contenu d'environ 16 pt sur
        // les quatre côtés. Un personnage censé DÉBORDER se fait alors
        // rogner par cette marge et non par le bord de la tuile : il
        // remonte, grossit dans la zone visible, et rejoint le texte —
        // exactement le défaut qu'on cherchait à éviter.
        //
        // En les désactivant, c'est le `.padding(16)` du contenu qui
        // porte la marge, une seule fois, et le débordement redevient
        // celui qui a été dessiné.
        .contentMarginsDisabled()
        .configurationDisplayName(LocalizedStringResource("widget_deck_name"))
        .description(LocalizedStringResource("widget_deck_description"))
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
