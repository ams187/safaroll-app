import type { SpeciesMastery } from '@/lib/animals/progression';
import { Button, Host, HStack, Image, Popover, RNHostView, Text } from '@expo/ui/swift-ui';
import { buttonStyle, fixedSize, font, frame, padding, presentationBackground } from '@expo/ui/swift-ui/modifiers';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function MasteryStarsPopover({ children, mastery }: { children: ReactElement; mastery: SpeciesMastery }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const complete = mastery.daysToNextLevel === 0;
  const message = complete
    ? t('mastery_rephotograph_complete')
    : t('mastery_rephotograph_hint', { count: mastery.daysToNextLevel, level: mastery.level + 1 });

  return (
    <Host matchContents>
      <Popover attachmentAnchor="bottom" isPresented={open} onIsPresentedChange={setOpen}>
        <Popover.Trigger>
          <Button onPress={() => setOpen(true)} modifiers={[buttonStyle('plain')]}>
            <RNHostView matchContents>{children}</RNHostView>
          </Button>
        </Popover.Trigger>
        <Popover.Content>
          <HStack
            alignment="center"
            spacing={10}
            modifiers={[
              frame({ width: 290 }),
              padding({ all: 16 }),
              presentationBackground('#f7f3e9ee'),
            ]}
          >
            <Image systemName={complete ? 'star.fill' : 'camera.fill'} size={18} color="#a97829" />
            <Text modifiers={[font({ size: 14, weight: 'semibold', design: 'rounded' }), fixedSize({ horizontal: false, vertical: true })]}>
              {message}
            </Text>
          </HStack>
        </Popover.Content>
      </Popover>
    </Host>
  );
}
