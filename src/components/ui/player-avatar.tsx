// Le portrait d'un joueur, et le sceau de son abonnement.
//
// POURQUOI LE SCEAU EXISTE
//
// Un abonnement qui ne se voit que de son porteur ne distingue personne. Ce
// badge n'est pas une décoration : c'est la seule chose que SafaRoll+ rend
// VISIBLE des autres, dans le Registre et sur les fiches publiques. D'où la
// migration `20260812110000_naturalist_visible` — sans elle, `is_premium`
// ne sortait que pour soi et le badge n'aurait rien distingué du tout.
//
// Le contour reste aussi léger qu'un anneau de profil classique ; son dégradé
// froid et ses quatre micro-facettes suffisent à rappeler le diamant SafaRoll.

import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

function PremiumRing({ size }: { size: number }) {
  const gap = Math.max(2, Math.round(size * 0.05));
  const ringSize = size + gap * 2;

  return (
    <Svg
      height={ringSize}
      pointerEvents="none"
      style={{ left: -gap, position: 'absolute', top: -gap }}
      viewBox="0 0 100 100"
      width={ringSize}
    >
      <Defs>
        <LinearGradient id="diamond-ring" x1="0" x2="1" y1="0" y2="1">
          <Stop offset="0" stopColor="#EAFBFF" />
          <Stop offset="0.45" stopColor="#8ED8F8" />
          <Stop offset="1" stopColor="#DDF7FF" />
        </LinearGradient>
      </Defs>
      <Circle cx="50" cy="50" fill="none" r="47.5" stroke="url(#diamond-ring)" strokeWidth="3" />
      <Circle cx="50" cy="50" fill="none" opacity="0.75" r="45.8" stroke="#FFFFFF" strokeWidth="0.7" />
      <Polygon fill="#FFFFFF" opacity="0.82" points="50,1 53,4 50,7 47,4" />
      <Polygon fill="#D9F6FF" opacity="0.8" points="99,50 96,53 93,50 96,47" />
      <Polygon fill="#FFFFFF" opacity="0.72" points="50,99 47,96 50,93 53,96" />
      <Polygon fill="#BCEAFF" opacity="0.76" points="1,50 4,47 7,50 4,53" />
    </Svg>
  );
}

export function PlayerAvatar({
  name,
  premium = false,
  ring,
  size,
  url,
}: {
  name: string;
  /** Abonné SafaRoll+ : sceau discret. */
  premium?: boolean;
  /** Anneau imposé par l'appelant — le podium colore par rang. Il gagne sur
   *  l'anneau d'abonnement : sur une marche, le rang prime. */
  ring?: string;
  size: number;
  url: string | null;
}) {
  const { theme } = useUnistyles();
  // Proportionnel, pas fixe : à 34 points un sceau de 20 mangerait le visage,
  // à 92 un sceau de 12 serait un grain de poussière.
  const seal = Math.max(20, Math.round(size * 0.32));

  return (
    <View style={{ height: size, width: size }}>
      <View
        style={[
          styles.portrait,
          {
            backgroundColor: theme.colors.primarySoft,
            borderColor: ring,
            borderRadius: size / 2,
            borderWidth: ring ? 2.5 : 0,
          },
        ]}
      >
        {url ? (
          <Image
            cachePolicy="memory-disk"
            contentFit="cover"
            source={{ uri: url }}
            style={{ borderRadius: size / 2, height: '100%', width: '100%' }}
            transition={120}
          />
        ) : (
          <Text style={[styles.initial, { fontSize: size * 0.42 }]}>
            {name.slice(0, 1).toUpperCase()}
          </Text>
        )}
      </View>

      {premium && !ring ? <PremiumRing size={size} /> : null}

      {premium ? (
        <Image
          contentFit="contain"
          source={require('../../../assets/premium-diamond.png')}
          style={{
            bottom: -3,
            height: seal,
            position: 'absolute',
            right: -3,
            width: seal,
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  portrait: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  initial: {
    color: theme.colors.primaryText,
    fontFamily: theme.fonts.bold,
  },
}));
