// « Partager la carte » — un PNG, puis la feuille de partage native.
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { GlassPill } from '@/components/ui/glass-pill';
import { StyleSheet } from 'react-native-unistyles';
import { shareCard } from '@/lib/card-share';

export const useCardShareRef = () => useRef<View>(null);

/**
 * LE PARTAGE D'UNE CARTE — EN UN SEUL ENDROIT.
 *
 * `shareCard` a deux appelants : ce bouton, sur la fiche d'une carte, et le
 * menu de `card-morph-overlay`. Les deux passent ici pour partager gratuitement
 * le même PNG. SafaRoll+ garde l'enregistrement séparé dans la pellicule.
 */
export function useCardShare(name: string, cardRef: RefObject<View | null>) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const partager = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await shareCard({ name, ref: cardRef });
    } catch (error) {
      console.warn(t('detail_share_failed'), error);
    } finally {
      setBusy(false);
    }
  }, [busy, cardRef, name, t]);

  return { busy, partager };
}

export function CardShareButton({
  cardRef,
  name,
  ready = true,
}: {
  cardRef: RefObject<View | null>;
  name: string;
  /** Voir `GlassPill` : faux tant que la scène bouge, le flou tient la place. */
  ready?: boolean;
}) {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const { busy, partager } = useCardShare(name, cardRef);

  return (
    <GlassPill
      accessibilityLabel={copy("ui_copy_107")}
      contentStyle={styles.buttonContent}
      ready={ready}
      // L'export en cours ne se relance pas : le geste est coûteux et deux
      // rendus concurrents se disputeraient la même vue à photographier.
      onPress={busy ? () => undefined : () => void partager()}
      shape={styles.button}
    >
      {busy ? (
        <ActivityIndicator color="#fff8e5" size="small" />
      ) : (
        <SymbolView name="square.and.arrow.up" size={16} tintColor="#fff8e5" />
      )}
      <Text style={styles.label}>{t('detail_share_card')}</Text>
    </GlassPill>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Forme au verre, rembourrage au pressable — voir `GlassPill`.
  button: { alignSelf: 'center', borderRadius: 999, marginTop: 18 },
  buttonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  label: {
    color: '#fff8e5',
    fontFamily: theme.fonts.medium,
    fontSize: 14,
  },
}));
