import { useTranslation as useUiTranslation } from 'react-i18next';
import React, { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { KeyboardController } from 'react-native-keyboard-controller';
import { RecentsScreen } from './RecentsScreen';
import { ChatScreen } from './ChatScreen';
import { useSwipeMenu, SWIPE_MENU_RADIUS, SWIPE_MENU_WIDTH_RATIO } from '../hooks/use-swipe-menu';
import { useChatStore } from '../state/chat-store';
import { theme } from '../theme';

/**
 * Le tiroir du Guide, à la manière de ChatGPT.
 *
 * C'ÉTAIT UN `PagerView` À DEUX PAGES et c'est ce qui posait problème : les
 * discussions étaient une page à part entière, on y allait, et pour en sortir il
 * fallait balayer en sens inverse — un geste que rien n'annonçait.
 *
 * Ici les discussions sont posées DESSOUS, immobiles. La conversation coulisse
 * par-dessus et découvre le tiroir en se décalant. Elle ne quitte jamais
 * l'écran : il en reste 22 %, arrondis et ombrés, qu'un appui suffit à
 * repousser. La sortie est la chose qu'on voit.
 */
export function RootDrawer() {
  const { t: copy } = useUiTranslation();
  const { width: screenWidth } = useWindowDimensions();
  const menuWidth = screenWidth * SWIPE_MENU_WIDTH_RATIO;
  const {
    animateMenu,
    isMenuOpen,
    mainAnimatedStyle,
    menuContentAnimatedStyle,
    menuDockAnimatedStyle,
    swipeGesture,
  } = useSwipeMenu(menuWidth);

  const openMenu = useCallback(() => {
    // Le clavier part avec la conversation : la laisser coulisser sous un
    // clavier ouvert donnerait un tiroir à moitié couvert.
    KeyboardController.dismiss();
    animateMenu(true);
  }, [animateMenu]);
  const closeMenu = useCallback(() => animateMenu(false), [animateMenu]);

  const startNewChat = useChatStore((state) => state.newChat);
  const loadConversation = useChatStore((state) => state.loadConversation);
  const newChat = useCallback(() => {
    startNewChat();
    closeMenu();
  }, [closeMenu, startNewChat]);
  const openConversation = useCallback(
    (conversation: Parameters<typeof loadConversation>[0]) => {
      loadConversation(conversation);
      closeMenu();
    },
    [closeMenu, loadConversation],
  );

  return (
    <GestureDetector gesture={swipeGesture}>
      <View style={styles.root}>
        <View
          accessibilityElementsHidden={!isMenuOpen}
          importantForAccessibility={isMenuOpen ? 'auto' : 'no-hide-descendants'}
          pointerEvents={isMenuOpen ? 'auto' : 'none'}
          style={[styles.menu, { width: menuWidth }]}
        >
          <RecentsScreen
            active={isMenuOpen}
            contentStyle={menuContentAnimatedStyle}
            dockStyle={menuDockAnimatedStyle}
            onNewChat={newChat}
            onOpen={openConversation}
          />
        </View>

        {/* Deux couches et non une : l'ombre ne se dessine pas sur une vue qui
            rogne ses enfants, donc l'extérieure la porte et l'intérieure taille
            les coins. C'est le montage de la référence. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.shadow, mainAnimatedStyle]}>
          <View style={styles.surface}>
            <ChatScreen onOpenRecents={openMenu} />
            {/* Tiroir ouvert, la conversation entière devient le bouton de
                fermeture — c'est l'affordance de ChatGPT, et elle n'a besoin
                d'aucun libellé. */}
            {isMenuOpen ? (
              <Pressable
                accessibilityLabel={copy("ui_copy_135")}
                accessibilityRole="button"
                onPress={closeMenu}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
          </View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.drawerBackground, overflow: 'hidden' },
  menu: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  shadow: {
    zIndex: 2,
    backgroundColor: theme.background,
    borderRadius: SWIPE_MENU_RADIUS,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: -8, height: 0 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
      },
      default: { elevation: 16 },
    }),
  },
  surface: {
    flex: 1,
    backgroundColor: theme.background,
    borderRadius: SWIPE_MENU_RADIUS,
    overflow: 'hidden',
  },
});
