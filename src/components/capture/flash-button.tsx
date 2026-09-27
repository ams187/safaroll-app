// Le bouton de flash, dessiné comme la pastille d'énergie qu'il remplace en
// haut à droite du viseur : même hauteur, même rayon, même fond. Les deux
// surfaces caméra le montent, donc il vit ici plutôt qu'en double.
import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { flashLabelKey, flashSymbol, useFlashMode } from '@/lib/camera/flash';

export function FlashButton({ compact = false }: {
  compact?: boolean;
  onStakeoutChange?: (armed: boolean) => void;
  stakeoutArmed?: boolean;
}) {
  const { t } = useTranslation();
  const { cycle, mode } = useFlashMode();
  return (
    <Pressable
      accessibilityLabel={t(flashLabelKey(mode))}
      accessibilityRole="button"
      hitSlop={10}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        cycle();
      }}
      style={{
        alignItems: 'center',
        backgroundColor: '#f3eee2',
        borderRadius: 20,
        height: compact ? 28 : 40,
        justifyContent: 'center',
        width: compact ? 28 : 40,
      }}
    >
      <SymbolView
        name={flashSymbol(mode)}
        size={compact ? 13 : 17}
        // L'or de l'app quand il est armé, l'encre quand il dort : l'état se
        // lit sans avoir à déchiffrer lequel des trois éclairs est affiché.
        tintColor={mode === 'off' ? '#29242d' : '#b8892c'}
      />
    </Pressable>
  );
}
