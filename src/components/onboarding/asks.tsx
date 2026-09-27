import { useTranslation as useUiTranslation } from 'react-i18next';
// Les deux demandes : la permission, puis l'attribution.
//
// POURQUOI ELLES SONT HORS DU CARROUSEL
//
// Elles ne racontent rien, elles PRENNENT quelque chose — un droit système,
// une réponse. Donc pas de points de progression, pas de flèche retour, et
// chacune porte son propre bouton : un écran qui demande ne doit pas
// ressembler à un écran qui explique.
//
// LE MOTIF, ET LA RÈGLE QUI VA AVEC
//
// On ne dit pas « activez les notifications pour ne rien manquer » : on MONTRE
// trois notifications, écrites et datées, telles qu'elles arriveront. On lit
// avant de dire oui.
//
// D'où la règle : les trois exemples doivent exister pour de vrai. Ceux-ci
// sont le rappel de fin de saison (`season-nudges.ts`), l'objectif du mois
// (`objectives.ts`) et le palier d'atlas (`progression.ts`). Une notification
// promise ici et jamais envoyée est un mensonge à retardement.

import { AnimatedView } from '@/components/ui/animated-view';
import { ensureNotificationPermission } from '@/lib/notifications';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { FadeInDown } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

const NOTIFICATIONS = [
  {
    body: "ui_copy_245",
    time: "ui_copy_246",
    title: "ui_copy_247",
  },
  {
    body: "ui_copy_248",
    time: "ui_copy_249",
    title: "ui_copy_250",
  },
  {
    body: "ui_copy_251",
    time: "ui_copy_252",
    title: "ui_copy_253",
  },
] as const;

export function NotificationsStep({ onDone }: { onDone: () => void }) {
  const { t: copy } = useUiTranslation();
  const [asking, setAsking] = useState(false);

  const allow = () => {
    if (asking) return;
    setAsking(true);
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync().catch(() => undefined);
    // Le refus système n'est pas un échec de l'étape : dans les deux cas on
    // avance. Insister ne rouvrirait pas la boîte de dialogue de toute façon.
    void ensureNotificationPermission().finally(onDone);
  };

  return (
    <View style={styles.ask}>
      <AnimatedView entering={FadeInDown.duration(450)} style={styles.askHead}>
        <Image
          accessibilityIgnoresInvertColors
          autoplay
          contentFit="contain"
          source={require('../../../assets/onboarding/expedition/notification-bell-loop.webp')}
          style={styles.notificationMascot}
        />
        <Text style={styles.title}>{copy("ui_copy_001")}</Text>
        <Text style={styles.subtitle}>
          {copy("ui_copy_002")}</Text>
      </AnimatedView>

      <View style={styles.previews}>
        {NOTIFICATIONS.map((notification, index) => (
          <AnimatedView
            entering={FadeInDown.delay(160 + index * 110).duration(420)}
            key={notification.title}
          >
            <View style={styles.preview}>
              <View style={styles.previewIcon}>
                <Image
                  accessibilityIgnoresInvertColors
                  contentFit="cover"
                  source={require('../../../assets/icon.png')}
                  style={styles.previewAppIcon}
                />
              </View>
              <View style={styles.previewText}>
                <View style={styles.previewTop}>
                  <Text style={styles.previewTitle}>{copy(notification.title)}</Text>
                  <Text style={styles.previewTime}>{copy(notification.time)}</Text>
                </View>
                <Text style={styles.previewBody}>{copy(notification.body)}</Text>
              </View>
            </View>
          </AnimatedView>
        ))}
      </View>

      <View style={styles.askFoot}>
        <Pressable
          accessibilityRole="button"
          onPress={allow}
          style={({ pressed }) => [styles.cta, styles.notificationCta, pressed && styles.pressed]}
        >
          <Text style={[styles.ctaText, styles.notificationCtaText]}>{copy("ui_copy_003")}</Text>
          <SymbolView name="bell.fill" size={15} tintColor="#FFFFFF" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>{copy("ui_copy_004")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * D'où vient le joueur.
 *
 * La seule question de l'onboarding qui ne sert pas au joueur mais à l'app —
 * donc la dernière, et sautable d'un mot. Elle est stockée pour de vrai
 * (`profiles.acquisition_source`) : une question posée dont la réponse tombe
 * dans le vide ne vaut pas l'écran qu'elle coûte.
 *
 * Le bouton reste éteint tant que rien n'est choisi. Ce n'est pas une brimade :
 * un bouton actif au-dessus d'une liste vierge invite à passer sans lire, et
 * une réponse au hasard vaut moins qu'un « Passer » assumé.
 */
const SOURCES: { icon: SFSymbol; label: string; value: string }[] = [
  { icon: 'magnifyingglass', label: 'App Store', value: 'app_store' },
  { icon: 'music.note', label: 'TikTok', value: 'tiktok' },
  { icon: 'camera.fill', label: 'Instagram', value: 'instagram' },
  { icon: 'play.rectangle.fill', label: 'YouTube', value: 'youtube' },
  { icon: 'person.2.fill', label: "ui_copy_254", value: 'friend' },
  { icon: 'ellipsis', label: "ui_copy_229", value: 'other' },
];

export function SourceStep({ onDone }: { onDone: (source: string | null) => void }) {
  const { t: copy } = useUiTranslation();
  const { theme } = useUnistyles();
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <View style={styles.ask}>
      <AnimatedView entering={FadeInDown.duration(450)} style={styles.askHead}>
        <Text style={styles.title}>{copy("ui_copy_005")}</Text>
        <Text style={styles.subtitle}>
          {copy("ui_copy_006")}</Text>
      </AnimatedView>

      <View style={styles.sources}>
        {SOURCES.map((source, index) => (
          <AnimatedView entering={FadeInDown.delay(90 + index * 50).duration(340)} key={source.value}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: picked === source.value }}
              onPress={() => {
                if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync().catch(() => undefined);
                setPicked(source.value);
              }}
              style={({ pressed }) => [
                styles.source,
                picked === source.value && styles.sourceOn,
                pressed && styles.pressed,
              ]}
            >
              <SymbolView
                name={source.icon}
                size={17}
                tintColor={picked === source.value ? theme.colors.primary : theme.colors.muted}
              />
              <Text style={styles.sourceLabel}>{copy(source.label, { defaultValue: source.label })}</Text>
            </Pressable>
          </AnimatedView>
        ))}
      </View>

      <View style={styles.askFoot}>
        <Pressable
          accessibilityRole="button"
          disabled={picked === null}
          onPress={() => onDone(picked)}
          style={({ pressed }) => [styles.cta, picked === null && styles.ctaOff, pressed && styles.pressed]}
        >
          <Text style={styles.ctaText}>{copy("auth_continue")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onDone(null)}
          style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
        >
          <Text style={styles.skipText}>{copy("ui_copy_007")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  ask: {
    flex: 1,
    gap: theme.gap(3),
    justifyContent: 'center',
  },
  askHead: {
    alignItems: 'center',
    gap: theme.gap(1),
  },
  askFoot: { gap: theme.gap(0.5) },
  notificationMascot: { height: 162, width: 108 },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 30,
    letterSpacing: -0.6,
    lineHeight: 36,
    textAlign: 'center',
  },
  subtitle: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },

  previews: { gap: 10 },
  preview: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderCurve: 'continuous',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  previewIcon: {
    borderRadius: 11,
    height: 34,
    overflow: 'hidden',
    width: 34,
  },
  previewAppIcon: { height: '100%', width: '100%' },
  previewText: { flex: 1, gap: 2 },
  previewTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  previewTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 14,
  },
  previewTime: {
    color: theme.colors.faint,
    fontFamily: theme.fonts.regular,
    fontSize: 11,
  },
  previewBody: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },


  sources: { gap: 8 },
  source: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceMuted,
    borderColor: 'transparent',
    borderCurve: 'continuous',
    borderRadius: 15,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sourceOn: {
    backgroundColor: theme.colors.primarySoft,
    borderColor: theme.colors.primary,
  },
  sourceLabel: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.medium,
    fontSize: 15,
  },

  cta: {
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    borderCurve: 'continuous',
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: theme.gap(2),
  },
  notificationCta: { backgroundColor: '#E3A93C' },
  notificationCtaText: { color: '#FFFFFF' },
  ctaOff: { opacity: 0.35 },
  ctaText: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.bold,
    fontSize: 17,
  },
  skip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.gap(1.5),
  },
  skipText: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 14,
  },
  pressed: { opacity: 0.8 },
}));
