// LA GARDE SAFAROLL+ VIT SUR LA ROUTE, PAS CHEZ L'APPELANT.
//
// Elle était posée dans la ligne de profil : `router.push(isPremium ? '/guide'
// : '/paywall')`. Ça tenait tant qu'il n'y avait qu'une porte. Une action
// rapide depuis l'icône de l'app en ouvre une deuxième, hors de toute vue
// React — et elle serait entrée gratuitement.
//
// Une route payante se protège elle-même : un seul endroit à relire, et le
// prochain appelant est couvert sans y penser.
//
// PAS DE COURT-CIRCUIT `__DEV__`. Il y en avait un ici et sur les trois
// appelants : en dev, le Guide s'ouvrait gratuitement, donc le chemin
// réellement testé n'était jamais celui du joueur non abonné. Pour
// essayer le Guide, ouvrir Profil > Réglages et basculer l'abonnement
// (`devToggle`, déjà sous `__DEV__`) : ça passe par la vraie garde.
import { RootDrawer } from '@/components/guide/screens/RootDrawer';
import { usePremium } from '@/lib/premium';
import { Redirect } from 'expo-router';

export default function GuideScreen() {
  const { isPremium } = usePremium();
  // FILET, PAS PORTAIL. Les appelants gardent déjà l'entrée (ligne du profil,
  // menu d'une carte) et envoient au paywall SANS ouvrir le Guide — un
  // non-abonné ne doit jamais monter cet écran. Cette redirection ne sert qu'au
  // jour où un troisième appelant oubliera de vérifier.
  if (!isPremium) return <Redirect href="/paywall" />;
  return <RootDrawer />;
}
