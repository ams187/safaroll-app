import { CardTile } from '@/components/cards/card-tile';
import { HoloCard, type HoloCardData } from '@/components/cards/holo-card';

export type AnimalCardData = HoloCardData;

/**
 * `compact` renders the cheap rarity tile used in grids and deck slots;
 * otherwise you get the full Skia card — rarity shader, holographic rim, band,
 * gloss and tilt. Both read the same rarity tier, so a legendary reads as
 * legendary at any size.
 */
export function AnimalCard({
  animated = true,
  compact = false,
  contentScale,
  data,
  onPress,
  width,
}: {
  animated?: boolean;
  compact?: boolean;
  contentScale?: number;
  data: AnimalCardData;
  onPress?: () => void;
  width: number;
}) {
  if (compact) return <CardTile data={data} onPress={onPress && (() => onPress())} width={width} />;
  return <HoloCard contentScale={contentScale} data={data} interactive={animated} width={width} />;
}
