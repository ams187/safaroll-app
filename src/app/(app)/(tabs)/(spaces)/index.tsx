// The hub, rebuilt on Gotcha's shape: one bar at the top and the section itself
// underneath, instead of the list of six links this used to be.
//
// La barre a EXACTEMENT le rendu de la lentille expo-liquid-lens qu'elle
// remplace — mêmes cotes, même absence de plaque, même pilule qui épouse le
// seul item actif — mais en vues natives : la passe de réfraction WebGPU
// buggait, et elle tenait un contexte GPU vivant au-dessus d'un écran dont la
// section Carte porte déjà une surface Mapbox. Sa chorégraphie vient du bloc
// `fluid-tab-interaction`. Voir `fluid-lens-tabs.tsx`.
//
// Deux segments, et ils sont tous les deux des LIEUX : la carte et soi. Le
// Guide est une action du profil et s'ouvre en plein écran, sans être comprimé
// entre les deux navigations du hub.
//
// La section d'ouverture est le Profil : c'est la page que cet onglet porte,
// et la carte est ce qu'on regarde depuis elle.

import MapScreen from '@/app/(app)/map';
import ProfileScreen from '@/app/(app)/profile';
import { BAR_PADDING, FluidLensTabs } from '@/components/navigation/fluid-lens-tabs';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

const SECTIONS = [
  { icon: 'map', labelKey: 'hub_tab_map' },
  { icon: 'user', labelKey: 'hub_tab_profile' },
] as const;

/** L'index de Carte. Elle seule passe en plein écran sous la barre. */
const MAP_SECTION = 0;

/** L'index du Profil — la section d'ouverture depuis que Défis a quitté la barre. */
const PROFILE_SECTION = 1;

export default function HubScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const tabs = useMemo(() => SECTIONS.map(({ icon, labelKey }) => ({ icon, label: t(labelKey) })), [t]);
  const [section, setSection] = useState(PROFILE_SECTION);
  const immersive = section === MAP_SECTION;

  return (
    <View style={styles.screen}>
      {/* La barre est déclarée AVANT le corps, donc elle le recouvre par défaut
          dans l'ordre de peinture. En immersif elle sort du flux pour flotter
          au-dessus de la carte au lieu de lui manger le haut de l'écran. */}
      <View
        style={[
          // `BAR_PADDING` des deux côtés : la lentille occupait 84 points et
          // centrait sa pilule de 35 dedans. On lui rend la même bande, sinon
          // tout le contenu de l'écran remonte d'un cran.
          { paddingBottom: BAR_PADDING, paddingTop: insets.top + 8 + BAR_PADDING },
          immersive && styles.barFloating,
        ]}
      >
        <FluidLensTabs
          index={section}
          onChange={setSection}
          tabs={tabs}
        />
      </View>
      {/* Each section is mounted only while it is the one being looked at: the
          map holds a live Mapbox surface and the profile runs its own queries,
          and neither should be doing that from behind another section. */}
      <View style={[styles.body, immersive && styles.bodyFull]}>
        {section === MAP_SECTION ? <MapScreen embedded /> : null}
        {section === PROFILE_SECTION ? <ProfileScreen /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  body: {
    flex: 1,
    marginTop: 12,
  },
  // La carte prend tout : sous la barre du haut, sous la barre d'onglets, sous
  // la barre d'état. Un paysage recadré n'est plus un paysage.
  bodyFull: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    marginTop: 0,
    zIndex: 0,
  },
  barFloating: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    // Au-dessus de la carte, et au-dessus de son bouton retour (zIndex 5).
    zIndex: 10,
    paddingBottom: 10,
  },
}));
