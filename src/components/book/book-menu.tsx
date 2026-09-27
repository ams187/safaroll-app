import { useTranslation as useUiTranslation } from 'react-i18next';
// Le menu du livre — porté d'Apple Books.
//
// LA MÉCANIQUE, RELEVÉE DANS LE BLOC
//
// Trois idées, et c'est tout ce qui fait la qualité de ce menu :
//
//   L'ORIGINE EST À DROITE      `transformOrigin: 'right'`. Les boutons ne
//                               grandissent pas depuis leur centre, ils
//                               SORTENT du déclencheur. C'est ce qui les
//                               rattache à lui.
//   LE DÉCALAGE S'INVERSE       à l'ouverture, chaque rangée part `index × 50 ms`
//                               après la précédente ; à la fermeture, l'ordre
//                               s'inverse ET s'accélère (×1,5). Le menu se
//                               déploie posément et se replie d'un coup.
//   LA SORTIE EST PROPORTIONNELLE  chaque rangée redescend d'une fraction de la
//                               hauteur du menu, calculée sur sa position. Les
//                               boutons du haut tombent de plus loin : ils se
//                               rangent DANS le déclencheur au lieu de
//                               disparaître sur place.
//
// CE QU'ON A CHANGÉ
//
//   PAS DE NATIVEWIND, PAS DE LUCIDE   le bloc tire `cn()` et une librairie
//                                      d'icônes. Ici, Unistyles et SF Symbols,
//                                      comme le reste de l'app.
//   DES ACTIONS RÉELLES                le bloc simule ses appuis. Les nôtres
//                                      partagent, impriment, sautent au mois —
//                                      un menu qui ne fait rien est un décor.

import type { BookYear } from '@/lib/animals/book';
import { MONTH_NAMES } from '@/lib/animals/book';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet as RNStyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Le pas du décalage entre deux rangées. */
const STEP = 50;
const RISE = { dampingRatio: 0.75, duration: 1500 };

function Row({
  children,
  containerHeight,
  index,
  open,
  rows,
}: {
  children: ReactNode;
  containerHeight: SharedValue<number>;
  index: number;
  open: boolean;
  rows: number;
}) {
  // Entrée dans l'ordre, sortie à rebours et plus vite : le menu se déploie
  // posément et se replie d'un coup.
  const delay = open ? index * STEP : rows * STEP - index * STEP * 1.5;

  const style = useAnimatedStyle(() => ({
    opacity: withDelay(delay, withTiming(open ? 1 : 0)),
    transform: [
      {
        translateY: withDelay(
          delay,
          withSpring(
            open
              ? 0
              : (containerHeight.get() - index * (containerHeight.get() / rows)) / 1.5,
            RISE,
          ),
        ),
      },
      { scale: withDelay(delay, withTiming(open ? 1 : 0.75)) },
    ],
  }));

  return <Animated.View style={[styles.row, style]}>{children}</Animated.View>;
}

function Action({
  icon,
  label,
  onPress,
  strong,
  trailing,
}: {
  icon?: SFSymbol;
  label?: string;
  onPress: () => void;
  strong?: boolean;
  trailing?: ReactNode;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.action,
        strong && styles.actionStrong,
        !label && styles.actionSquare,
        pressed && styles.pressed,
      ]}
    >
      {label ? <Text style={styles.actionText}>{label}</Text> : null}
      {trailing ??
        (icon ? <SymbolView name={icon} size={17} tintColor={theme.colors.onPrimary} /> : null)}
    </Pressable>
  );
}

export function BookMenu({
  onGoTo,
  onPrint,
  onShare,
  page,
  pages,
  sections,
  year,
}: {
  /** Sauter à une page — le sommaire s'en sert. */
  onGoTo: (page: number) => void;
  onPrint: () => void;
  onShare: () => void;
  page: number;
  pages: number;
  /** Les mois du tome, avec la page où chacun commence. */
  sections: { label: string; month: number; page: number }[];
  year: BookYear;
}) {
  const { t: copy } = useUiTranslation();
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  const [contents, setContents] = useState(false);
  const height = useSharedValue(0);

  const progress = pages > 1 ? Math.round((page / (pages - 1)) * 100) : 0;

  const trigger = useAnimatedStyle(() => ({
    opacity: withTiming(open ? 0 : 1),
    transform: [{ scale: withTiming(open ? 0.5 : 1) }],
  }));

  const close = () => {
    setOpen(false);
    setContents(false);
  };

  const rows: ReactNode[] = [
    <Action
      icon="list.bullet"
      key="sommaire"
      label={`Sommaire · ${progress} %`}
      onPress={() => setContents((current) => !current)}
      strong
    />,
    <Action
      icon="square.and.arrow.up"
      key="partager"
      label={copy("ui_copy_074")}
      onPress={() => {
        close();
        onShare();
      }}
    />,
    <Action
      icon="arrow.down.doc"
      key="pdf"
      label={copy("ui_copy_075")}
      onPress={() => {
        close();
        onPrint();
      }}
    />,
    <View key="raccourcis" style={styles.shortcuts}>
      <Action icon="chevron.left.2" onPress={() => onGoTo(0)} />
      <Action
        icon="arrow.uturn.backward"
        onPress={() => onGoTo(Math.max(0, page - 1))}
      />
      <Action
        icon="arrow.uturn.forward"
        onPress={() => onGoTo(Math.min(pages - 1, page + 1))}
      />
      <Action icon="chevron.right.2" onPress={() => onGoTo(pages - 1)} />
    </View>,
  ];

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      {open ? (
        <Pressable onPress={close} style={RNStyleSheet.absoluteFill} />
      ) : null}

      {/* Le sommaire, quand on le demande : la liste des mois du tome. */}
      {open && contents ? (
        <View style={styles.contents}>
          <Text style={styles.contentsTitle}>{year.year}</Text>
          <ScrollView showsVerticalScrollIndicator={false} style={styles.contentsList}>
            {sections.map((section) => (
              <Pressable
                key={section.page}
                onPress={() => {
                  onGoTo(section.page);
                  close();
                }}
                style={({ pressed }) => [styles.contentsRow, pressed && styles.pressed]}
              >
                <Text style={styles.contentsMonth}>{MONTH_NAMES[section.month]}</Text>
                <Text style={styles.contentsPage}>{section.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View
        onLayout={({ nativeEvent }) => height.set(nativeEvent.layout.height)}
        pointerEvents={open ? 'auto' : 'none'}
        style={styles.stack}
      >
        {rows.map((row, index) => (
          <Row containerHeight={height} index={index} key={index} open={open} rows={rows.length}>
            {row}
          </Row>
        ))}
      </View>

      <AnimatedPressable
        accessibilityLabel={copy("ui_copy_076")}
        accessibilityRole="button"
        onPress={() => {
          if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync().catch(() => undefined);
          setOpen(true);
        }}
        style={[styles.trigger, trigger]}
      >
        <SymbolView
          name="line.3.horizontal"
          size={18}
          tintColor={theme.colors.onPrimary}
          weight="semibold"
        />
      </AnimatedPressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  layer: {
    alignItems: 'flex-end',
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    paddingHorizontal: theme.gap(2),
    position: 'absolute',
    right: 0,
  },
  stack: { gap: 6 },
  // L'origine à droite : les boutons sortent du déclencheur au lieu de
  // grandir sur place. C'est tout le rattachement visuel du menu à son bouton.
  row: { transformOrigin: 'right' },
  action: {
    alignItems: 'center',
    backgroundColor: 'rgba(43,36,24,0.92)',
    borderCurve: 'continuous',
    borderRadius: 16,
    flexDirection: 'row',
    gap: theme.gap(2),
    justifyContent: 'space-between',
    paddingHorizontal: theme.gap(2.5),
    paddingVertical: theme.gap(1.5),
  },
  actionStrong: { backgroundColor: theme.colors.primary },
  actionSquare: {
    justifyContent: 'center',
    paddingHorizontal: theme.gap(2),
  },
  actionText: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.medium,
    fontSize: 16,
  },
  shortcuts: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'flex-end',
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    borderCurve: 'continuous',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    marginTop: 8,
    width: 40,
  },
  contents: {
    alignSelf: 'stretch',
    backgroundColor: theme.colors.primary,
    borderCurve: 'continuous',
    borderRadius: 20,
    marginBottom: 6,
    maxHeight: 280,
    paddingBottom: theme.gap(1),
    paddingTop: theme.gap(2),
  },
  contentsTitle: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.display,
    fontSize: 18,
    paddingBottom: theme.gap(1),
    paddingHorizontal: theme.gap(2.5),
  },
  contentsList: { paddingHorizontal: theme.gap(1) },
  contentsRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.gap(1.5),
    paddingVertical: theme.gap(1.25),
  },
  contentsMonth: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.medium,
    fontSize: 15,
  },
  contentsPage: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.regular,
    fontSize: 12,
    opacity: 0.55,
  },
  pressed: { opacity: 0.8 },
}));
