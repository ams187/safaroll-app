import ActivityKit
import OneSignalLiveActivities
import SwiftUI
import WidgetKit

// L'EXPÉDITION SUR L'ÉCRAN VERROUILLÉ.
//
// Une sortie dure une heure, téléphone en poche. C'est le seul moment où
// SafaRoll a quelque chose à dire EN CONTINU sans mériter qu'on ouvre l'app :
// depuis quand on marche, combien d'espèces croisées, laquelle vient de
// naître. Le verrou et la Dynamic Island sont faits exactement pour ça.
//
// POURQUOI `DefaultLiveActivityAttributes` ET PAS UNE STRUCTURE À NOUS
//
// Cette structure vient du SDK OneSignal. En l'utilisant, le SDK possède tout
// le cycle de vie — démarrage, jeton push-to-start, mises à jour distantes,
// fin — et il ne reste, côté natif, que ce fichier. Une structure maison
// obligerait à écrire les liaisons ActivityKit ↔ JS à la main, pour une seule
// Live Activity : la doc de OneSignal recommande explicitement cette voie
// quand il n'y en a qu'une.
//
// LE PRIX À PAYER, ET IL EST VISIBLE ICI : les champs ne sont pas typés. Le
// SDK transporte des dictionnaires libres (`data`), donc chaque lecture passe
// par une clé en chaîne et un repli. D'où les accesseurs en haut du fichier
// plutôt que des `String` disséminés dans la vue.
//
// LES CLÉS SONT UN CONTRAT AVEC `src/lib/onesignal.ts`. Elles y sont écrites
// par `startExpeditionActivity`, et le serveur les réécrit à chaque capture.
// Renommer d'un côté sans l'autre ne casse rien à la compilation : ça affiche
// simplement des zéros. C'est pour ça qu'elles sont regroupées ici.

private enum Cle {
    static let debut = "startedAt"
    static let titre = "title"
    static let especes = "speciesCount"
    static let nouvelles = "newSpeciesCount"
    static let derniere = "lastSpecies"
}

private extension DefaultLiveActivityAttributes {
    /// Le début de la marche. Le chronomètre est rendu par iOS à partir de
    /// cette date : il continue de tourner sans aucune mise à jour poussée,
    /// alors qu'un compteur de minutes envoyé par le serveur coûterait un push
    /// par minute et serait vite étranglé par le système.
    var debut: Date {
        guard let brut = data[Cle.debut]?.asDouble() else { return Date() }
        return Date(timeIntervalSince1970: brut)
    }

    var titre: String { data[Cle.titre]?.asString() ?? "Expédition" }
    var fin: Date? {
        guard let value = data["endsAt"]?.asDouble() else { return nil }
        return Date(timeIntervalSince1970: value)
    }
}

private extension DefaultLiveActivityAttributes.ContentState {
    var especes: Int { data[Cle.especes]?.asInt() ?? 0 }
    var nouvelles: Int { data[Cle.nouvelles]?.asInt() ?? 0 }
    var objectifs: Int { data["targetCount"]?.asInt() ?? 0 }
    var prochain: String { data["nextTarget"]?.asString() ?? "" }
    /// `nil` tant qu'aucune carte n'est née : on montre alors une invitation
    /// plutôt qu'une ligne vide, parce qu'une expédition qui commence est
    /// justement le moment où il ne s'est encore rien passé.
    var derniere: String? {
        guard let nom = data[Cle.derniere]?.asString(), !nom.isEmpty else { return nil }
        return nom
    }
}

struct ExpeditionActivity: Widget {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let ink = Color("$widgetInk")
    private let gold = Color("$accent")

    private func timer(_ attributes: DefaultLiveActivityAttributes) -> some View {
        Group {
            if let end = attributes.fin {
                Text(timerInterval: attributes.debut...max(attributes.debut, end), countsDown: true)
            } else {
                Text(attributes.debut, style: .timer)
            }
        }
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .frame(width: 64)
    }

    private func mark(_ size: CGFloat) -> some View {
        Image("mark")
            .resizable()
            .renderingMode(.template)
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }

    private func nextTarget(_ state: DefaultLiveActivityAttributes.ContentState) -> Text {
        if state.objectifs > 0 {
            if state.especes >= state.objectifs { return Text("activity_complete") }
            return state.prochain.isEmpty ? Text("activity_start") : Text("activity_next \(state.prochain)")
        }
        return state.derniere.map { Text($0) } ?? Text("activity_start")
    }

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DefaultLiveActivityAttributes.self) { contexte in
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 7) {
                    mark(17)
                    Text(contexte.attributes.titre)
                        .font(.system(.subheadline, design: .serif, weight: .semibold))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    timer(contexte.attributes)
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(ink.opacity(0.07), in: Capsule())
                }
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("\(contexte.state.especes)")
                                .font(.system(size: 32, weight: .bold, design: .rounded))
                                .monospacedDigit()
                                .contentTransition(.numericText())
                                .animation(reduceMotion ? nil : .easeInOut(duration: 0.4), value: contexte.state.especes)
                            if contexte.state.objectifs > 0 {
                                Text("/ \(contexte.state.objectifs)")
                                    .font(.system(size: 20, weight: .medium, design: .rounded))
                                    .foregroundStyle(ink.opacity(0.65))
                            }
                            Spacer(minLength: 0)
                            if contexte.state.nouvelles > 0 {
                                Label("+\(contexte.state.nouvelles)", systemImage: "sparkles")
                                    .font(.caption.weight(.bold))
                                    .padding(6)
                                    .background(gold.opacity(0.25), in: Capsule())
                                    .accessibilityLabel(Text("activity_new \(contexte.state.nouvelles)"))
                            }
                        }
                        Text(LocalizedStringKey(contexte.state.objectifs > 0 ? "activity_objectives" : "activity_species"))
                            .font(.caption.weight(.medium))
                            .foregroundStyle(ink.opacity(0.75))
                    }
                    .fixedSize(horizontal: true, vertical: false)
                    SafariTrail(found: contexte.state.especes, total: contexte.state.objectifs)
                }
                HStack(spacing: 7) {
                    Image(systemName: "viewfinder")
                    nextTarget(contexte.state)
                        .contentTransition(.opacity)
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: contexte.state.prochain)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.bold))
                }
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(ink, in: RoundedRectangle(cornerRadius: 11))
                .foregroundStyle(Color("$widgetBackground"))
            }
            .foregroundStyle(ink)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(LinearGradient(colors: [Color("$widgetBackground"), Color("$widgetBackgroundEnd")], startPoint: .topLeading, endPoint: .bottomTrailing))
            .activityBackgroundTint(Color("$widgetBackgroundEnd"))
            .activitySystemActionForegroundColor(ink)
            .widgetURL(URL(string: "safaroll://safari"))
        } dynamicIsland: { contexte in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        mark(22)
                        Text(contexte.state.objectifs > 0 ? "\(contexte.state.especes)/\(contexte.state.objectifs)" : "\(contexte.state.especes)")
                    }
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(gold)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    timer(contexte.attributes)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(gold)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 5) {
                        SafariTrail(found: contexte.state.especes, total: contexte.state.objectifs, onDark: true)
                        nextTarget(contexte.state)
                            .font(.footnote)
                            .foregroundStyle(Color("$widgetBackground"))
                            .lineLimit(1)
                            .contentTransition(.opacity)
                            .animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: contexte.state.prochain)
                    }
                }
            } compactLeading: {
                // L'état compact est minuscule : une icône et un nombre, rien
                // de plus. Y mettre du texte le fait tronquer sans prévenir.
                mark(20).foregroundStyle(gold)
            } compactTrailing: {
                Text(contexte.state.objectifs > 0 ? "\(contexte.state.especes)/\(contexte.state.objectifs)" : "\(contexte.state.especes)")
                    .foregroundStyle(gold)
                    .contentTransition(.numericText())
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.4), value: contexte.state.especes)
            } minimal: {
                mark(18).foregroundStyle(gold)
            }
            .keylineTint(gold)
            .widgetURL(URL(string: "safaroll://safari"))
        }
    }
}
