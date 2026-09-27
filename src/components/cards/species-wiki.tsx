import { currentLanguage } from '@/i18n/languages';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';

/**
 * L'article Wikipédia de l'animal, ouvert dans le navigateur natif.
 *
 * CE QUE ÇA REMPLACE, ET POURQUOI C'EST MIEUX
 * -------------------------------------------
 * Avant : un script moissonnait Wikipédia, découpait les phrases, les stockait
 * en base, et la carte en affichait cinq. Trois pièces à maintenir pour une
 * pâle copie de la page — et jamais la photo, la carte de répartition, le chant,
 * la taxonomie, les sous-espèces. Ici on ouvre la vraie page : tout y est,
 * toujours à jour, et il n'y a plus rien à maintenir.
 *
 * POURQUOI CE BOUTON N'EST PAS RÉSERVÉ AUX ABONNÉS
 * ------------------------------------------------
 * Il l'a été une heure, et c'était une erreur. Wikipédia est public et gratuit :
 * un cadenas qu'on contourne par une recherche Google n'apprend au joueur qu'une
 * chose — que les cadenas de l'app sont arbitraires — et il abîme la crédibilité
 * de ceux qui protègent vraiment quelque chose.
 *
 * L'abonnement garde ce qui coûte de l'argent (l'Identification Pro, un appel
 * facturé) ou ce qu'on a fabriqué soi-même (la rétrospective, les épingles de la
 * carte, les captures illimitées). Lire sur son animal est au contraire une
 * boucle de rétention : le joueur gratuit qui apprend quelque chose revient, et
 * c'est ce retour qui alimente les captures — donc le vrai paywall.
 *
 * POURQUOI `openBrowserAsync` ET PAS `Linking.openURL`
 * ---------------------------------------------------
 * `openBrowserAsync` ouvre SFSafariViewController sur iOS et Custom Tabs sur
 * Android : la page s'affiche PAR-DESSUS l'app. `Linking` éjecterait le joueur
 * dans Safari, et revenir lui coûterait un aller-retour par le sélecteur
 * d'apps — dont beaucoup ne reviennent pas.
 *
 * POURQUOI `Special:Search…&go=Go` PLUTÔT QUE L'URL DIRECTE
 * --------------------------------------------------------
 * `/wiki/Icterus_galbula` tombe sur une page « cet article n'existe pas » quand
 * le nom scientifique n'a pas de redirection — et il n'y en a pas pour toutes
 * les espèces. `&go=Go` saute directement à l'article s'il existe, et retombe
 * sur les résultats de recherche sinon. Jamais de cul-de-sac.
 */
export function SpeciesWiki({ accent, scientificName }: { accent: string; scientificName?: string }) {
  const { t } = useTranslation();

  if (!scientificName) return null;

  const ouvrir = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // La langue de l'app, pas celle du téléphone : un joueur qui a mis SafaRoll en
    // français attend un article en français.
    const langue = currentLanguage().startsWith('fr') ? 'fr' : 'en';
    const url = `https://${langue}.wikipedia.org/wiki/Special:Search`
      + `?search=${encodeURIComponent(scientificName)}&go=Go`;
    void WebBrowser.openBrowserAsync(url, {
      // Une feuille, pas un plein écran. Par défaut expo-web-browser ouvre en
      // `OverFullScreen` : la page recouvre tout, la carte disparaît, et le
      // joueur a l'impression d'avoir quitté l'app. En `PAGE_SHEET` l'article
      // monte par-dessus en laissant voir la carte derrière, et se referme d'un
      // glissement vers le bas — le geste que tout le monde a déjà.
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      // La barre du navigateur prend la couleur de la rareté : on reste dans la
      // carte, on n'en sort pas.
      toolbarColor: '#1a1410',
      controlsColor: accent,
      dismissButtonStyle: 'done',
    }).catch(() => undefined);
  };

  return (
    <Pressable
      accessibilityLabel={t('wiki_open')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={ouvrir}
      style={[styles.bouton, { borderColor: accent }]}
    >
      <SymbolView name="book.fill" size={13} tintColor={accent} weight="bold" />
      <Text style={[styles.libelle, { color: accent }]}>{t('wiki_open')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bouton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    marginTop: 12,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  libelle: { fontSize: 11, letterSpacing: 0.4 },
});
