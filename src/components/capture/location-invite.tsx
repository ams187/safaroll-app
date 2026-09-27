import { useTranslation as useUiTranslation } from 'react-i18next';
import { translate } from '@/i18n';
// La feuille de pré-permission.
//
// Elle existe pour une seule raison : intercepter le dialogue système avant
// qu'il ne se joue. Sur iOS il n'y a qu'une cartouche, et la brûler à froid au
// montage de la caméra — ce que faisait l'app — la dépensait avant que
// l'utilisateur ait vu une seule carte.
//
// Elle s'affiche donc APRÈS la première révélation, quand la carte est encore à
// l'écran : c'est le seul instant où « où tu l'as vu » est une question qui a du
// sens plutôt qu'une formalité.
//
// Elle parlait rareté locale. Cet argument est mort : la rareté locale a été
// retirée de l'app parce qu'elle mentait en captivité — un flamant rose au zoo
// de Vincennes compte 3 observations sauvages autour de Paris, un lion zéro.
//
// Elle parle donc lieu, et surtout PERTE. La carte des captures est premium,
// et une permission ne se demande jamais au nom d'une fonctionnalité payante —
// sinon un joueur gratuit n'a aucune raison d'accepter, et le stock qui vaudra
// le paywall plus tard ne se constitue jamais. Ce qui reste gratuit et vrai :
// l'endroit est gravé sur la capture, pour toujours, et ne se rattrape pas.
//
// « Plus tard » n'est pas « Non » : il ne dépense rien et se rattrape (deux
// invitations, une semaine d'écart — voir `shouldInvite`).

import { useLocationGate } from '@/lib/location-permission';
import type { LocationGate } from '@/lib/location-rules';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

/** Le temps de lire la confirmation avant que la feuille s'efface. */
const CONFIRM_MS = 1600;

export function LocationInvite({ accent, onDismiss }: { accent: string; onDismiss: () => void }) {
  const { t: copy } = useUiTranslation();
  const { ask, gate, openSettings } = useLocationGate();
  const [asking, setAsking] = useState(false);

  // Vaut aussi bien pour un oui au dialogue que pour un retour des Réglages :
  // dans les deux cas `gate` bascule et la feuille se referme d'elle-même. Sans
  // cet accusé de réception, activer depuis les Réglages ne produit rien de
  // visible, et le joueur croit que ça n'a pas marché.
  const granted = gate === 'granted';
  useEffect(() => {
    if (!granted) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    const timer = setTimeout(onDismiss, CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [granted, onDismiss]);

  const blocked = gate === 'settings';

  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={styles.scrim}>
      {/* Avant la demande, le choix appartient uniquement au dialogue iOS. */}
      {blocked ? <Pressable accessibilityLabel={copy("reveal_close")} onPress={onDismiss} style={StyleSheet.absoluteFill} /> : null}

      <Animated.View entering={SlideInDown.springify().damping(20).mass(0.5)} style={styles.sheet}>
        {granted ? (
          <View style={styles.confirm}>
            <SymbolView name="checkmark.circle.fill" size={34} tintColor={accent} />
            <Text style={styles.confirmText}>
              {copy("ui_copy_113")}</Text>
          </View>
        ) : (
          <>
            <Text style={[styles.eyebrow, { color: accent }]}>{copy("ui_copy_114")}</Text>
            <Text style={styles.title}>{copy("ui_copy_115")}</Text>

            <Text style={styles.body}>
              {copy("ui_copy_116")}</Text>

            {blocked ? (
              <Text style={styles.body}>
                {copy("ui_copy_118")}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={asking}
              onPress={async () => {
                if (blocked) {
                  openSettings();
                  return;
                }
                setAsking(true);
                try {
                  if (!await ask()) onDismiss();
                } finally {
                  setAsking(false);
                }
              }}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: accent },
                pressed && styles.pressed,
              ]}
            >
              <SymbolView
                name={blocked ? 'gear' : 'location.fill'}
                size={16}
                tintColor="#05060a"
              />
              <Text style={styles.primaryText}>
                {blocked ? copy("camera_permission_blocked_action") : copy('auth_continue')}
              </Text>
            </Pressable>

            {blocked ? <Pressable
              accessibilityRole="button"
              onPress={onDismiss}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>{copy("ui_copy_004")}</Text>
            </Pressable> : null}
          </>
        )}
      </Animated.View>
    </Animated.View>
  );
}

/** Le libellé du rappel passif, pour la carte. Exporté ici pour qu'il n'existe
 *  qu'une seule formulation du même argument dans l'app. */
export function locationCallToAction(gate: LocationGate) {
  return translate(gate === 'settings' ? 'camera_permission_blocked_action' : 'detail_place_enable');
}

/**
 * L'accroche posée sous la carte qui vient d'être révélée.
 *
 * C'est le chemin principal vers la feuille, et il est volontairement passif :
 * l'utilisateur ouvre la demande lui-même. Ça vaut mieux qu'une feuille qui
 * monte toute seule, parce qu'un tap est déjà un oui — la feuille n'a plus qu'à
 * confirmer. Elle continue de s'ouvrir seule de temps en temps (`shouldInvite`)
 * pour ceux qui ne toucheront jamais cette ligne.
 */
/**
 * Le libellé dit ce que CETTE capture a perdu ; l'action dit ce qu'elle change
 * — et elle ne change rien pour celle-ci. La ligne est déjà écrite sans
 * coordonnées, la caméra n'a pas mis de GPS dans l'EXIF, et rien ne patche une
 * capture après coup. « Ajouter le lieu » promettait donc un rattrapage qui
 * n'existe pas. Le bouton nomme l'interrupteur, pas un sauvetage.
 */
export const LOCATION_PROMPT_LABEL = 'Cette capture n’a pas de lieu';
export const LOCATION_PROMPT_ACTION = 'Activer la position';

const styles = StyleSheet.create((theme) => ({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(5,6,10,0.78)',
  },
  sheet: {
    margin: 12,
    padding: 24,
    borderRadius: 28,
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#14161d',
  },
  eyebrow: { fontFamily: theme.fonts.bold, fontSize: 10, letterSpacing: 1.8 },
  title: { color: '#fffdf3', fontFamily: theme.fonts.display, fontSize: 26, lineHeight: 30 },
  body: {
    color: 'rgba(255,255,255,0.66)',
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    lineHeight: 21,
  },
  warning: {
    paddingLeft: 12,
    borderLeftWidth: 2,
  },
  warningText: { color: '#fffdf3', fontFamily: theme.fonts.medium, fontSize: 14, lineHeight: 20 },
  hint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  hintText: {
    flex: 1,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: theme.fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
  hintStrong: { color: '#fffdf3', fontFamily: theme.fonts.bold },
  primary: {
    marginTop: 4,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
  },
  primaryText: { color: '#05060a', fontFamily: theme.fonts.bold, fontSize: 15 },
  secondary: { height: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: theme.fonts.medium,
    fontSize: 14,
  },
  pressed: { opacity: 0.72 },
  confirm: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  confirmText: {
    color: '#fffdf3',
    fontFamily: theme.fonts.medium,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
}));
