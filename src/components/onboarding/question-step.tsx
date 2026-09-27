import { useTranslation } from 'react-i18next';
import { FontAwesome6 } from '@expo/vector-icons';
import { toucheLegere } from '@/lib/haptics';
import { Image, type ImageSource } from 'expo-image';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

export type OnboardingChoice = {
  brandIcon?: 'app-store-ios' | 'instagram' | 'tiktok' | 'youtube';
  icon: ImageSource;
  label: string;
  value: string;
};

export function QuestionStep({
  choices,
  multiple = false,
  onChange,
  selected,
  title,
}: {
  choices: readonly OnboardingChoice[];
  multiple?: boolean;
  onChange: (values: string[]) => void;
  selected: readonly string[];
  title: string;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const choose = (value: string) => {
    // LE SEUL RETOUR HAPTIQUE DE L'ONBOARDING QUI SE RÉPÈTE, donc le plus léger
    // qui existe. Trois écrans, une dizaine de touches : n'importe quoi de plus
    // appuyé devient du bruit au troisième tap. Et rien sur « Continuer », qui
    // reviendrait quatorze fois — c'est là que la vibration cesse d'informer.
    toucheLegere();
    if (!multiple) {
      onChange([value]);
      return;
    }
    if (value === 'everything') {
      onChange(selected.includes(value) ? [] : [value]);
      return;
    }
    const withoutEverything = selected.filter((item) => item !== 'everything');
    onChange(
      withoutEverything.includes(value)
        ? withoutEverything.filter((item) => item !== value)
        : [...withoutEverything, value],
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.choices}>
        {choices.map((choice) => {
          const active = selected.includes(choice.value);
          return (
            <Pressable
              accessibilityRole={multiple ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: active }}
              key={choice.value}
              onPress={() => choose(choice.value)}
              style={({ pressed }) => [
                styles.choice,
                active && styles.choiceActive,
                pressed && styles.pressed,
              ]}
            >
              {choice.brandIcon ? (
                <View style={styles.brandSticker}>
                  <FontAwesome6
                    color={active ? BRAND_COLORS[choice.brandIcon] : theme.colors.faint}
                    name={choice.brandIcon}
                    size={17}
                  />
                </View>
              ) : (
                <Image
                  contentFit="contain"
                  source={choice.icon}
                  style={styles.icon}
                  tintColor={active ? undefined : theme.colors.faint}
                />
              )}
              <Text style={styles.label}>{t(choice.label, { defaultValue: choice.label })}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: 28,
    paddingBottom: 12,
    paddingTop: 30,
  },
  title: {
    alignSelf: 'center',
    color: theme.colors.foreground,
    fontFamily: theme.fonts.brand,
    fontSize: 31,
    letterSpacing: -0.7,
    // 36 ET NON 32. La référence mesurait 30 pt d'interligne, mais avec SA
    // police. ExposureTrial a des hampes plus hautes : sous ~1,15 × la taille,
    // React Native rogne le haut des majuscules. Le chiffre relevé ne se
    // transporte pas d'une fonte à l'autre.
    lineHeight: 36,
    maxWidth: 330,
    textAlign: 'center',
  },
  choices: { gap: 12 },
  // LES PROPORTIONS VIENNENT D'UNE RÉFÉRENCE MESURÉE, PAS D'UN RÉGLAGE À L'ŒIL.
  //
  // Relevé sur la maquette fournie, ramené à une largeur d'écran de 402 pt :
  // ligne 61 pt, icône 28, écart icône–texte 20, rayon 18, écart entre lignes
  // 12. On était à 80 de haut avec une icône de 54 — c'est elle qui gonflait
  // tout le reste, la ligne ne faisait que suivre.
  //
  // `minHeight` et non `height` : une réponse à deux lignes doit pouvoir
  // pousser plutôt que de se faire couper.
  choice: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceMuted,
    borderColor: 'transparent',
    borderCurve: 'continuous',
    borderRadius: 18,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 16,
    minHeight: 60,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  choiceActive: {
    backgroundColor: '#F6E2B7',
    borderColor: '#E3A93C',
  },
  icon: { height: 30, width: 30 },
  // La pastille de marque suit l'icône : à 30 pt, une bordure de 2 et un rayon
  // de 16 mangeaient tout l'intérieur.
  brandSticker: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#EEEAE5',
    borderRadius: 9,
    borderWidth: 1.5,
    height: 30,
    justifyContent: 'center',
    shadowColor: '#1E1812',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 0,
    width: 30,
  },
  label: {
    color: theme.colors.foreground,
    flex: 1,
    fontFamily: theme.fonts.bold,
    fontSize: 17,
    lineHeight: 21,
  },
  pressed: { opacity: 0.78 },
}));

const BRAND_COLORS = {
  'app-store-ios': '#0D96F6',
  instagram: '#D62976',
  tiktok: '#111111',
  youtube: '#FF0033',
} as const;
