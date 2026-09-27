import { useTranslation as useUiTranslation } from 'react-i18next';
import React, { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import type { LegendListRef } from '@legendapp/list/react-native';
import { KeyboardAwareLegendList, useKeyboardChatComposerInset, useKeyboardScrollToEnd } from '@legendapp/list/keyboard';
import { useChatStore, type Attachment, type Message } from '../state/chat-store';
import { ChatMessages } from '../components/ChatMessages';
import { MessageBubble } from '../components/MessageBubble';
import { GUIDE_HEADER_BAR, Header } from '../components/Header';
import { Composer } from '../components/Composer';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { ScrollToBottomButton } from '../components/ScrollToBottomButton';
import { theme } from '../theme';
import { usePremium } from '@/lib/premium';

const ANCHOR_MAX_SIZE = 2 * 21 + 32;
const PREMIUM_ACCENT = '#a97829';
const ReasoningSheet = React.lazy(() => import('../components/ReasoningSheet').then((module) => ({ default: module.ReasoningSheet })));

export const ChatScreen = React.memo(function ChatScreen({ onOpenRecents }: { onOpenRecents: () => void }) {
  const { t: copy } = useUiTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isPremium } = usePremium();
  const canUseGuide = isPremium;
  // Le bandeau est opaque et posé par-dessus la liste : tout ce qui passe sous
  // cette hauteur est invisible. Le retrait du contenu ET le point d'accroche
  // du message envoyé s'y alignent.
  const headerHeight = insets.top + GUIDE_HEADER_BAR;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const send = useChatStore((state) => state.send);
  const stop = useChatStore((state) => state.stop);
  const newChat = useChatStore((state) => state.newChat);
  const rate = useChatStore((state) => state.rate);
  const regenerate = useChatStore((state) => state.regenerate);
  const messagesLength = useChatStore((state) => state.messages.length);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const paused = useChatStore((state) => state.paused);
  const [composerHeight, setComposerHeight] = useState(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const listRef = useRef<LegendListRef>(null);
  const composerRef = useRef<View>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const hasOverflowedRef = useRef(false);
  const openReasoning = useCallback((text: string) => setReasoning(text), []);
  const renderMessage = useCallback(({ item }: { item: Message }) => (
    <MessageBubble message={item} onOpenReasoning={openReasoning} onRate={rate} onRegenerate={regenerate} />
  ), [openReasoning, rate, regenerate]);
  /**
   * LE POINT D'ACCROCHE DU MESSAGE QU'ON VIENT D'ENVOYER — ET LE FIL AUQUEL IL
   * APPARTIENT.
   *
   * `anchoredEndSpace` ajoute de l'espace en fin de liste pour que le message
   * n° `anchorIndex` puisse monter jusqu'en haut. C'est une mesure prise sur
   * UNE conversation : dès qu'on en ouvre une autre depuis les discussions, cet
   * indice désigne un message qui n'existe plus, et la liste calcule son espace
   * à partir de rien — d'où la mise en page qui se chevauche.
   *
   * L'`epoch` du magasin voyage donc avec l'indice, et l'ancre est DÉDUITE :
   * elle s'annule d'elle-même dès que les messages sont remplacés, sans effet à
   * écrire ni remise à zéro à ne pas oublier. L'identifiant du fil ne suffirait
   * pas — rouvrir la MÊME discussion le garde identique.
   */
  const epoch = useChatStore((state) => state.epoch);
  const [anchor, setAnchor] = useState<{ epoch: number; index: number } | null>(null);
  const anchorIndex = anchor?.epoch === epoch ? anchor.index : undefined;
  const anchorHasImage = useChatStore((state) => anchorIndex != null ? (state.messages[anchorIndex]?.attachments?.length ?? 0) > 0 : false);
  const { contentInsetEndAdjustment, onComposerLayout: reportComposerInset } = useKeyboardChatComposerInset(listRef, composerRef);
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });
  const onComposerLayout = useCallback((event: LayoutChangeEvent) => {
    setComposerHeight(event.nativeEvent.layout.height);
    reportComposerInset(event);
  }, [reportComposerInset]);
  const onSubmit = useCallback((text: string, attachments: Attachment[]) => {
    if (!canUseGuide) {
      router.push('/paywall');
      return;
    }
    const isFirstMessage = messagesLength === 0;
    hasOverflowedRef.current = false;
    setFollowing(false);
    send(text, attachments);
    setAnchor({ epoch: useChatStore.getState().epoch, index: messagesLength });
    scrollMessageToEnd({ animated: !isFirstMessage, closeKeyboard: true });
  }, [canUseGuide, messagesLength, router, send, scrollMessageToEnd]);
  const onEndVisible = useCallback((visible: boolean) => {
    setShowScrollDown(!visible);
    if (visible && hasOverflowedRef.current) setFollowing(true);
  }, []);
  const onScrollBeginDrag = useCallback(() => { if (hasOverflowedRef.current) setFollowing(false); }, []);
  const keyboardOffset = { opened: insets.bottom };
  /**
   * MÉMOÏSÉ, ET CE N'EST PAS DE L'ÉLÉGANCE.
   *
   * LegendList relit `contentContainerStyle` à chaque passe de mise en page
   * pour en extraire les marges (`getPadding`), et compare la valeur reçue
   * d'un rendu à l'autre. Un littéral écrit dans le JSX est un objet NEUF à
   * chaque fois : la liste croit que sa mise en page a changé, se recalcule,
   * ce qui provoque un rendu, qui fabrique un nouvel objet, et ainsi de suite.
   * Avant, c'était `styles.listContent` — une référence stable de bout en bout.
   */
  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingTop: headerHeight + 8 }],
    [headerHeight],
  );

  return (
    <View style={styles.container}>
      <ChatMessages>{(messages) => (
        <KeyboardAwareLegendList
          ref={listRef}
          style={styles.fill}
          data={messages}
          keyExtractor={(item: Message) => item.id}
          recycleItems
          renderItem={renderMessage}
          applyWorkaroundForContentInsetHitTestBug
          maintainVisibleContentPosition={Platform.OS !== 'android' ? undefined : anchorIndex != null && !following}
          keyboardLiftBehavior="whenAtEnd"
          keyboardOffset={insets.bottom}
          contentInsetEndAdjustment={contentInsetEndAdjustment}
          freeze={freeze}
          anchoredEndSpace={anchorIndex != null ? {
            anchorIndex,
            anchorMaxSize: anchorHasImage ? undefined : ANCHOR_MAX_SIZE,
            anchorOffset: headerHeight + 8,
            onSizeChanged: (size) => {
              if (size <= 0 && !hasOverflowedRef.current) {
                hasOverflowedRef.current = true;
                setFollowing(true);
              }
            },
          } : undefined}
          maintainScrollAtEnd={following ? { on: { dataChange: true, itemLayout: true } } : undefined}
          maintainScrollAtEndThreshold={1}
          estimatedItemSize={64}
          estimatedListSize={{ width: windowWidth, height: windowHeight }}
          onEndVisible={onEndVisible}
          onScrollBeginDrag={onScrollBeginDrag}
          contentContainerStyle={listContentStyle}
          keyboardDismissMode="interactive"
        />
      )}</ChatMessages>
      {messagesLength === 0 ? <EmptyState composerHeight={composerHeight} /> : null}
      <Header onNewChat={newChat} onOpenRecents={onOpenRecents} />
      <KeyboardStickyView offset={keyboardOffset} style={[styles.scrollDown, { bottom: composerHeight + 10 }]} pointerEvents="box-none">
        {showScrollDown ? <ScrollToBottomButton onPress={() => scrollMessageToEnd({ animated: true, closeKeyboard: false })} /> : null}
      </KeyboardStickyView>
      <KeyboardStickyView offset={keyboardOffset} style={styles.composer}>
        {/* Un champ de saisie actif qui refuse tout est un mensonge d'interface :
            quand le plafond du jour est atteint, le composeur cède la place à
            ce qui explique pourquoi. Même `ref` et même `onLayout` que lui —
            c'est ce couple qui donne à la liste son retrait bas, et le perdre
            laisserait le dernier message sous le bandeau. */}
        {!canUseGuide ? (
          <Pressable
            accessibilityRole="button"
            onLayout={onComposerLayout}
            onPress={() => router.push('/paywall')}
            ref={composerRef}
            style={styles.premiumNotice}
          >
            <Icon name="sparkles" size={17} color={PREMIUM_ACCENT} />
            <Text style={styles.premiumText}>{copy("ui_copy_136")}</Text>
            <Icon name="chevron.right" size={15} color={PREMIUM_ACCENT} />
          </Pressable>
        ) : paused ? (
          <View onLayout={onComposerLayout} ref={composerRef} style={styles.pausedNotice}>
            <Icon name="moon.zzz.fill" size={17} color={theme.textSecondary} />
            <Text style={styles.pausedText}>{copy("ui_copy_137")}</Text>
          </View>
        ) : (
          <Composer composerRef={composerRef} onLayout={onComposerLayout} onSubmit={onSubmit} onStop={stop} streaming={isStreaming} />
        )}
      </KeyboardStickyView>
      {reasoning != null ? <Suspense fallback={null}><ReasoningSheet reasoning={reasoning} onDismiss={() => setReasoning(null)} /></Suspense> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background }, fill: { flex: 1 },
  composer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  scrollDown: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  listContent: { paddingBottom: 4 },
  pausedNotice: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 22,
    backgroundColor: theme.glassFallbackBackground,
  },
  pausedText: { color: theme.textSecondary, flexShrink: 1, fontFamily: 'Satoshi-Medium', fontSize: 15 },
  premiumNotice: {
    alignItems: 'center',
    backgroundColor: theme.glassFallbackBackground,
    borderColor: PREMIUM_ACCENT,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginBottom: 12,
    marginHorizontal: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  premiumText: { color: theme.text, flexShrink: 1, fontFamily: 'Satoshi-Medium', fontSize: 15 },
});
