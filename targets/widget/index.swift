import WidgetKit
import SwiftUI

// CE QUE LE BUNDLE EXPOSE, ET CE QU'IL RETIENT.
//
// LE WIDGET DECK EST COUPÉ POUR LA V1.
//
// Son rendu n'était pas au niveau : la pile ne ressemblait pas à celle de
// l'accueil, et un widget premium raté coûte plus cher qu'un widget absent —
// quelqu'un qui paie et découvre une tuile bancale se sent floué.
//
// IL N'EST PAS COMMENTÉ, ET C'EST LA MÊME RÈGLE QUE `launch-flags.ts` : du code
// commenté pourrit, il cesse de compiler et cesse d'être vérifié. `DeckWidget`
// reste dans la cible, compilé et typé à chaque build. Seul son point d'entrée
// est retiré — c'est ce qui le fait disparaître de la galerie d'iOS.
//
// La chaîne qui le nourrit reste elle aussi entière : `appGroupPath` côté
// natif, `DeckWidgetPainter` côté app, `setWidgetDeck` dans l'App Group. Rien
// à reconstruire le jour où on le rallume — il suffira d'ajouter la ligne.
@main
struct SafaRollWidgetBundle: WidgetBundle {
    var body: some Widget {
        CameraWidget()
        // La Live Activity d'expédition. `ActivityConfiguration` n'existe qu'à
        // partir d'iOS 16.2 ; la cible vise 17.0, donc pas de garde nécessaire.
        ExpeditionActivity()
    }
}
