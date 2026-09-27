// LES LIENS PROFONDS QUI ENTRENT DANS L'APP.
//
// `expo-sharing` lance l'app avec `<scheme>://expo-sharing` quand on partage
// quelque chose vers SafaRoll depuis une autre app. Le widget appareil photo
// lance `<scheme>://camera`. Tout le reste passe sans être touché.
import { requestExpandableCamera } from '@/components/navigation/expandable-camera-state';

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const hote = new URL(path).hostname;

    if (hote === 'expo-sharing') {
      return '/share';
    }

    // LE WIDGET NE POUSSE PAS VERS UNE ROUTE CAMÉRA — IL N'Y EN A PLUS.
    //
    // La vraie caméra est le viseur qui se déplie depuis la barre d'onglets,
    // pas un écran. On arme donc la même demande que l'action rapide de l'icône
    // et on rend l'accueil : la barre consomme le drapeau à son montage, y
    // compris au démarrage à froid où elle n'existe pas encore ici.
    if (hote === 'camera') {
      requestExpandableCamera();
      return '/';
    }

    // Le widget de deck VERROUILLÉ mène ici : c'est sa raison d'être visible
    // pour les non-abonnés.
    if (hote === 'paywall') {
      return '/paywall';
    }
  } catch {
    // Chemins relatifs ou malformés : ce ne sont pas des intentions système.
  }
  return path;
}
