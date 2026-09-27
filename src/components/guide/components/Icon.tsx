import { type ColorValue, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView, type SFSymbol, type SymbolViewProps } from 'expo-symbols';
import { theme } from '../theme';

type IconProps = {
  /** Le rebond des SF Symbols, quand un pictogramme change pour dire quelque chose. */
  animationSpec?: SymbolViewProps['animationSpec'];
  name: SFSymbol;
  size?: number;
  color?: ColorValue;
  style?: StyleProp<ViewStyle>;
};

export function Icon({ animationSpec, name, size = 20, color = theme.text, style }: IconProps) {
  return <SymbolView animationSpec={animationSpec} name={name} tintColor={color} size={size} style={style} />;
}
