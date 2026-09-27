import {
  Button,
  Host,
  HStack,
  Image,
  Popover,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  padding,
  presentationBackground,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'expo-symbols';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

// AUCUN DÉNOMINATEUR ICI, NI EN HAUT NI PAR GROUPE.
//
// La pastille a dit « 3 / 5576 », et chaque groupe « 3 / 1661 oiseaux ». Les
// deux mesuraient une progression contre le CATALOGUE, et le catalogue n'est
// pas un total : c'est une liste ouverte.
//
//   BioCLIP 2.5 classe contre ~500 000 noms d'espèces (TreeOfLife-200M) ;
//   le catalogue en compte 5 576, soit 1,1 % de ce que le modèle sait nommer.
//   17 espèces déjà photographiées n'y figurent PAS (25 captures), et
//   `world_species` existe précisément pour l'agrandir après confirmation.
//
// Un dénominateur suppose un ensemble fermé. Celui-ci grandit quand on joue —
// donc la fraction était fausse, et déjà démentie par les captures en base.
// Reste le nombre : un fait sur ce qu'on possède, qui ne peut que monter.

export type CollectionCategory = {
  discovered: number;
  icon: SFSymbol;
  key: string;
  label: string;
};

type Props = {
  categories: CollectionCategory[];
  discovered: number;
  onSelect: (key: string) => void;
  selected: string;
};

const CELL_WIDTH = 156;
const CELL_HEIGHT = 60;

export const CollectionCategoryPicker = memo(function CollectionCategoryPicker({ categories, discovered, onSelect, selected }: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const items: CollectionCategory[] = [
    { discovered, icon: 'square.grid.2x2.fill', key: 'Tous', label: t('quest_filter_all') },
    ...categories,
  ];

  const select = (key: string) => {
    onSelect(key);
    setOpen(false);
  };

  return (
    <Host matchContents>
      <Popover
        attachmentAnchor="bottom"
        isPresented={open}
        onIsPresentedChange={setOpen}
      >
        <Popover.Trigger>
          <Button
            onPress={() => setOpen(true)}
            modifiers={[buttonStyle('plain')]}
          >
            <HStack
              alignment="center"
              spacing={8}
              modifiers={[
                frame({ height: 40 }),
                padding({ horizontal: 13 }),
                glassEffect({
                  glass: { interactive: true, tint: '#f7f3e9cc', variant: 'regular' },
                  shape: 'capsule',
                }),
              ]}
            >
              <Image systemName="square.grid.2x2.fill" size={14} color="#29242d" />
              {/* `fixedSize` sur les deux compteurs, et ce n'est pas cosmétique.
                  L'hôte SwiftUI est en `matchContents` : sa largeur est mesurée
                  UNE fois au montage, quand l'atlas n'est pas encore chargé et
                  que le dénominateur n'est qu'un « … ». Quand le vrai nombre
                  arrive, il ne tient plus dans la largeur déjà figée, et SwiftUI
                  tronque — le compteur de gauche devenait « … », d'où le
                  « …/1000 » qu'on lisait. `fixedSize` interdit à ces textes de
                  rétrécir : c'est la pastille qui s'élargit, pas le chiffre qui
                  disparaît. */}
              <Text modifiers={[font({ size: 14, weight: 'bold', design: 'rounded' }), fixedSize({ horizontal: true })]}>
                {discovered}
              </Text>
              <Image systemName="chevron.down" size={11} color="#716873" />
            </HStack>
          </Button>
        </Popover.Trigger>

        <Popover.Content>
          <VStack
            alignment="leading"
            spacing={4}
            modifiers={[
              presentationBackground('#f7f3e9cc'),
              padding({ all: 12 }),
            ]}
          >
            {Array.from({ length: Math.ceil(items.length / 2) }, (_, row) => (
              <HStack key={row} spacing={4}>
                {items.slice(row * 2, row * 2 + 2).map((item) => (
                  <CategoryButton
                    item={item}
                    key={item.key}
                    onPress={() => select(item.key)}
                    selected={item.key === selected}
                  />
                ))}
                {row * 2 + 1 >= items.length ? (
                  <Spacer modifiers={[frame({ height: CELL_HEIGHT, width: CELL_WIDTH })]} />
                ) : null}
              </HStack>
            ))}
          </VStack>
        </Popover.Content>
      </Popover>
    </Host>
  );
});

function CategoryButton({
  item,
  onPress,
  selected,
}: {
  item: CollectionCategory;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Button
      onPress={onPress}
      modifiers={[buttonStyle('plain')]}
    >
      <HStack
        alignment="center"
        spacing={12}
        modifiers={[
          frame({ height: CELL_HEIGHT, width: CELL_WIDTH, alignment: 'leading' }),
          padding({ horizontal: 10 }),
          ...(selected ? [background('#e7e7e7', shapes.roundedRectangle({ cornerRadius: 18 }))] : []),
        ]}
      >
        <Image
          color={selected ? '#29242d' : '#929292'}
          size={24}
          systemName={item.icon}
        />
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: 15, weight: 'semibold', design: 'rounded' })]}>
            {item.label}
          </Text>
          {/* Le libellé au-dessus dit déjà le groupe : « Oiseaux » puis « 12 »
              se lit sans qu'on ait à répéter le mot ni à inventer un total. */}
          <Text modifiers={[font({ size: 14, weight: 'semibold', design: 'rounded' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
            {item.discovered}
          </Text>
        </VStack>
      </HStack>
    </Button>
  );
}
