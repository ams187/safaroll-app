import WidgetKit
import SwiftUI

// LE WIDGET APPAREIL PHOTO — GRATUIT, ET C'EST DÉLIBÉRÉ.
//
// La capture est la boucle qui alimente tout le reste : collection, decks,
// Guide. Faire payer le raccourci qui y mène reviendrait à faire payer pour
// réduire son propre entonnoir. Et comme l'offre gratuite est PLAFONNÉE en
// captures quotidiennes, un raccourci qui fait atteindre ce plafond plus vite
// est le meilleur déclencheur de paywall qui soit.
//
// IL N'A AUCUNE DONNÉE. Pas de `UserDefaults`, pas d'App Group, pas de réseau :
// une icône et un lien profond. C'est ce qui le rend indestructible — rien à
// synchroniser, donc rien qui puisse se désynchroniser.
//
// CE QU'IL NE FAIT PAS. Depuis l'écran verrouillé, iOS n'autorise AUCUNE app
// tierce à ouvrir sa caméra par-dessus le verrou : seul l'appareil photo
// d'Apple a ce privilège. Le parcours réel est appui → Face ID → viseur. Ne
// jamais promettre « capture depuis l'écran verrouillé » dans un texte
// marketing. (Le seul emplacement qui contourne ça est un `ControlWidget`
// posé sur les boutons du verrou — une autre cible, à faire plus tard.)

/// Le même groupe que l'app et l'extension de partage.
private let appGroupID = "group.com.example.safaroll"

struct CameraEntry: TimelineEntry {
    let date: Date
    let titre: String
    let sousTitre: String
}

struct CameraProvider: TimelineProvider {
    /*
     LES LIBELLÉS VIENNENT DE L'APP, LES `.lproj` SONT LE FILET.

     Les fichiers de langue de cette extension suivent la langue du SYSTÈME.
     Mais SafaRoll a son propre sélecteur, dont la préférence vit en MMKV côté
     JavaScript et ne touche jamais le natif : forcer l'anglais dans l'app
     laissait ce widget en français sur un iPhone français.

     L'app dépose donc les libellés déjà traduits dans l'App Group. On les
     préfère quand ils existent, et on retombe sur les chaînes compilées sinon —
     c'est-à-dire au tout premier lancement, avant que l'app n'ait rien écrit.

     Ce que l'App Group ne peut PAS traduire : le nom et la description de la
     galerie, lus par iOS avant que cette extension ne tourne. Eux restent aux
     `.lproj`, et suivent donc le système. C'est assumé — on visite la galerie
     une fois, on regarde la tuile tous les jours.
     */
    private func lire() -> CameraEntry {
        let defaults = UserDefaults(suiteName: appGroupID)
        let titre = defaults?.string(forKey: "safaroll.widget.cameraTitle") ?? ""
        let sousTitre = defaults?.string(forKey: "safaroll.widget.cameraSubtitle") ?? ""
        return CameraEntry(date: Date(), titre: titre, sousTitre: sousTitre)
    }

    func placeholder(in context: Context) -> CameraEntry {
        CameraEntry(date: Date(), titre: "", sousTitre: "")
    }

    func getSnapshot(in context: Context, completion: @escaping (CameraEntry) -> Void) {
        completion(lire())
    }

    // Une seule entrée, jamais renouvelée : le contenu est statique, donc on ne
    // consomme aucun budget de rafraîchissement WidgetKit.
    func getTimeline(in context: Context, completion: @escaping (Timeline<CameraEntry>) -> Void) {
        completion(Timeline(entries: [lire()], policy: .never))
    }
}

struct CameraWidgetView: View {
    @Environment(\.widgetFamily) private var family
    var entry: CameraEntry

    /// Le libellé de l'app s'il existe, la chaîne compilée sinon.
    private func texte(_ depuisApp: String, repli: LocalizedStringKey) -> Text {
        depuisApp.isEmpty ? Text(repli) : Text(depuisApp)
    }

    var body: some View {
        switch family {
        // Écran verrouillé : monochrome imposé par le système, donc AUCUNE
        // couleur — iOS les écraserait en blanc. Un glyphe, rien d'autre.
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                // `renderingMode(.template)` : iOS ne garde de toute façon que
                // l'alpha, mais le dire évite qu'un futur passage en couleur
                // sorte une bouillie au lieu d'un glyphe.
                Image("mark")
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .padding(5)
            }
        case .accessoryRectangular:
            HStack(spacing: 6) {
                Image("mark")
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(width: 20, height: 20)
                texte(entry.titre, repli: "widget_camera_title").font(.headline)
            }
        // Écran d'accueil : UNE MISE EN PAGE, PAS UNE DIAPOSITIVE.
        //
        // Trois versions ont précédé celle-ci et chacune ratait la même chose :
        // image centrée, titre dessous, marges partout. C'est une diapositive.
        // Les widgets qui tiennent — Duolingo, Clucky — font l'inverse et le
        // font tous les deux pareil :
        //
        //   · le texte est EN HAUT À GAUCHE, jamais centré sous l'image ;
        //     la lecture commence là, et un titre centré en bas fait redescendre
        //     l'œil pour rien ;
        //   · le personnage DÉBORDE du cadre au lieu d'y être posé avec des
        //     marges — c'est ce qui le rend vivant plutôt que collé ;
        //   · le fond n'est jamais un aplat saturé.
        //
        // Le guépard est donc dessiné plus grand que la tuile et ancré en bas à
        // droite : il sort de 11 pt à droite et de 32 pt en bas, et le
        // conteneur du widget le rogne. La moitié gauche reste au texte.
        default:
            ZStack(alignment: .bottomTrailing) {
                Image("guepard")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 135, height: 135)
                    .offset(x: 11, y: 32)

                VStack(alignment: .leading, spacing: 1) {
                    texte(entry.titre, repli: "widget_camera_title")
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(Color("$widgetTitle"))
                    // La seconde ligne dit l'ACTION, là où la première nomme le
                    // widget. Clucky fait exactement ça : « Next wakeup », puis
                    // l'état en dessous.
                    texte(entry.sousTitre, repli: "widget_camera_subtitle")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(Color("$widgetInk").opacity(0.55))
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(16)
            }
        }
    }
}

/// Le fond commun aux deux widgets. Clair en haut, or en bas.
let fondSafaRoll = LinearGradient(
    colors: [Color("$widgetBackground"), Color("$widgetBackgroundEnd")],
    startPoint: .top,
    endPoint: .bottom
)

struct CameraWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SafaRollCamera", provider: CameraProvider()) { entry in
            CameraWidgetView(entry: entry)
                // `widgetURL` ouvre l'app sur ce lien. `+native-intent.ts` le
                // reconnaît et déplie le viseur de la barre d'onglets — la
                // MÊME bascule que l'action rapide de l'icône.
                .widgetURL(URL(string: "safaroll://camera"))
                // Obligatoire depuis iOS 17 : sans conteneur déclaré, le widget
                // est rejeté à la compilation.
                // Dégradé, pas aplat : voir `expo-target.config.js`.
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
        .configurationDisplayName(LocalizedStringResource("widget_camera_name"))
        .description(LocalizedStringResource("widget_camera_description"))
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}
