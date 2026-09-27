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
}

private extension DefaultLiveActivityAttributes.ContentState {
    var especes: Int { data[Cle.especes]?.asInt() ?? 0 }
    var nouvelles: Int { data[Cle.nouvelles]?.asInt() ?? 0 }
    /// `nil` tant qu'aucune carte n'est née : on montre alors une invitation
    /// plutôt qu'une ligne vide, parce qu'une expédition qui commence est
    /// justement le moment où il ne s'est encore rien passé.
    var derniere: String? {
        guard let nom = data[Cle.derniere]?.asString(), !nom.isEmpty else { return nil }
        return nom
    }
}

struct ExpeditionActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DefaultLiveActivityAttributes.self) { contexte in
            // L'ÉCRAN VERROUILLÉ. Volontairement sobre : c'est la « loi de
            // l'écrin » du reste de l'app — le chrome ne décore pas, il laisse
            // la carte briller. Ici il n'y a pas de carte, donc rien à décorer.
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image("mark")
                        .resizable()
                        .frame(width: 18, height: 18)
                        .foregroundStyle(Color("$widgetTitle"))
                    Text(contexte.attributes.titre)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color("$widgetTitle"))
                    Spacer()
                    // Rendu par iOS, pas par nous : aucun push nécessaire pour
                    // que la durée continue d'avancer.
                    Text(contexte.attributes.debut, style: .timer)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Color("$widgetInk").opacity(0.7))
                }

                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(contexte.state.especes)")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(Color("$widgetInk"))
                    Text(contexte.state.especes > 1 ? "espèces" : "espèce")
                        .font(.subheadline)
                        .foregroundStyle(Color("$widgetInk").opacity(0.7))
                    if contexte.state.nouvelles > 0 {
                        Spacer()
                        Text("\(contexte.state.nouvelles) nouvelle\(contexte.state.nouvelles > 1 ? "s" : "")")
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color("$accent").opacity(0.22), in: Capsule())
                            .foregroundStyle(Color("$widgetTitle"))
                    }
                }

                Text(contexte.state.derniere ?? "Chaque capture rejoint la sortie")
                    .font(.footnote)
                    .foregroundStyle(Color("$widgetInk").opacity(0.6))
                    .lineLimit(1)
            }
            .padding(16)
            .activityBackgroundTint(Color("$widgetBackground"))
            .activitySystemActionForegroundColor(Color("$widgetTitle"))
        } dynamicIsland: { contexte in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("\(contexte.state.especes)", systemImage: "pawprint.fill")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Color("$widgetTitle"))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(contexte.attributes.debut, style: .timer)
                        .font(.title3.monospacedDigit())
                        .multilineTextAlignment(.trailing)
                        .foregroundStyle(Color("$widgetTitle"))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(contexte.state.derniere ?? "Chaque capture rejoint la sortie")
                        .font(.footnote)
                        .lineLimit(1)
                }
            } compactLeading: {
                // L'état compact est minuscule : une icône et un nombre, rien
                // de plus. Y mettre du texte le fait tronquer sans prévenir.
                Image(systemName: "pawprint.fill")
                    .foregroundStyle(Color("$widgetTitle"))
            } compactTrailing: {
                Text("\(contexte.state.especes)")
                    .foregroundStyle(Color("$widgetTitle"))
            } minimal: {
                Image(systemName: "pawprint.fill")
                    .foregroundStyle(Color("$widgetTitle"))
            }
        }
    }
}
