import { useTranslation as useUiTranslation } from 'react-i18next';
import React, { memo, useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, SlideInDown } from 'react-native-reanimated';
import { NitroImage } from 'react-native-nitro-image';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import type { Message } from '../state/chat-store';
import { Icon } from './Icon';
import { ThinkingText } from './ThinkingText';
import { markdownTokens, theme } from '../theme';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { guideMarkdownStyle } from '../markdown-style';
import { toast } from '@/lib/notify';
import { speechAvailable, useSpeech } from '../state/speech';

/** Le temps que la coche reste. Assez pour être vue, trop court pour qu'on doute. */
const COPIE_MS = 1600;
const REBOND = { effect: { type: 'bounce', wholeSymbol: true } } as const;

/**
 * Le bouton « copier », et sa preuve.
 *
 * Copier ne produit RIEN de visible : le presse-papier est invisible, l'annonce
 * VoiceOver n'existe que pour VoiceOver. Le pictogramme devient donc lui-même
 * l'accusé de réception — une coche verte qui rebondit, puis reprend sa place.
 *
 * L'état est monté sur `key={message.id}` par l'appelant : la liste des messages
 * recycle ses lignes, et sans ça une coche restée d'un message se retrouverait
 * affichée sur le suivant.
 */
function CopyButton({ text }: { text: string }) {
  const { t: copy } = useUiTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIE_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Pressable
      accessibilityLabel={copied ? copy("ui_copy_266") : copy("ui_copy_267")}
      hitSlop={6}
      onPress={() => void Clipboard.setStringAsync(text).then(() => {
        setCopied(true);
        AccessibilityInfo.announceForAccessibility(copy("ui_copy_266"));
      })}
    >
      <Icon
        animationSpec={copied ? REBOND : undefined}
        color={copied ? theme.success : theme.textSecondary}
        // Remonté à chaque bascule : `SymbolView` joue son effet à l'apparition,
        // et sans nouvelle identité la coche arriverait sans rebondir.
        key={copied ? 'copie' : 'copier'}
        name={copied ? 'checkmark' : 'square.on.square'}
        size={18}
      />
    </Pressable>
  );
}

/**
 * L'étape en cours, dite comme une phrase.
 *
 * Le serveur envoie des étiquettes courtes — « Réflexion », « Réponse » — qui
 * décrivent un état de machine. Sous une bulle vide, ce que le joueur attend
 * c'est de savoir que QUELQU'UN travaille.
 */
const PHRASE: Record<string, string> = {
  'Réflexion': 'guide_thinking',
  'Réponse': 'guide_answering',
  "Recherche dans l'atlas": 'guide_searching',
};

/**
 * Le bouton « écouter », et l'état de sa lecture.
 *
 * L'identifiant vient du magasin, pas d'un état local : il n'y a qu'un
 * synthétiseur pour toute l'app, donc une seule réponse peut être en lecture.
 * Un état par bulle laisserait deux boutons se croire tous les deux actifs.
 */
function SpeakButton({ messageId, text }: { messageId: string; text: string }) {
  const { t: copy } = useUiTranslation();
  const speaking = useSpeech((state) => state.speakingId === messageId);
  const toggle = useSpeech((state) => state.toggle);
  return (
    <Pressable
      accessibilityLabel={speaking ? copy("ui_copy_268") : copy("ui_copy_269")}
      hitSlop={6}
      onPress={() => {
        if (!speechAvailable) {
          toast.info(copy("ui_copy_264"), copy("ui_copy_265"));
          return;
        }
        toggle(messageId, text);
      }}
    >
      <Icon
        color={speaking ? theme.text : theme.textSecondary}
        // Remonté à la bascule pour que le pictogramme rebondisse en changeant,
        // comme la coche du bouton « copier ».
        key={speaking ? 'stop' : 'play'}
        name={speaking ? 'stop.fill' : 'play'}
        size={18}
      />
    </Pressable>
  );
}

const TITLE_BOLD_RE = /^(?:#+\s*)?\*\*(.+?)\*\*$/;
const TITLE_HEADING_RE = /^#+\s+(.+)$/;

function reasoningLabel(reasoning: string) {
  const firstLine = reasoning.trimStart().split('\n', 1)[0].trim();
  return TITLE_BOLD_RE.exec(firstLine)?.[1]?.trim() ?? TITLE_HEADING_RE.exec(firstLine)?.[1]?.trim();
}

/**
 * LES SOURCES S'OUVRENT PAR-DESSUS LA CONVERSATION, PAS AILLEURS.
 *
 * `Linking.openURL` éjectait le joueur dans Safari au milieu d'un échange avec
 * le Guide — il partait vérifier une source et devait revenir par le sélecteur
 * d'apps, en retrouvant, ou pas, le fil de sa question.
 *
 * `PAGE_SHEET` ouvre SFSafariViewController AU-DESSUS : la conversation reste
 * visible derrière et la page se referme d'un glissement. Même traitement que
 * l'article Wikipédia d'une fiche espèce et que les mentions du paywall.
 *
 * La barre prend `linkColor` : la couleur du lien qu'on vient de toucher.
 */
function ouvrirLien(url: string) {
  void WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    toolbarColor: theme.background,
    controlsColor: markdownTokens.linkColor,
    dismissButtonStyle: 'done',
  }).catch(() => undefined);
}

export const MessageBubble = memo(function MessageBubble({ message, onOpenReasoning, onRate, onRegenerate }: {
  message: Message;
  onOpenReasoning: (reasoning: string) => void;
  onRate: (messageId: string, feedback: 'up' | 'down') => void;
  onRegenerate: (messageId: string) => void;
}) {
  const { t: copy } = useUiTranslation();
  if (message.role === 'user') {
    return (
      <Animated.View style={styles.userRow} entering={SlideInDown.easing(Easing.out(Easing.exp)).duration(700)}>
        {message.attachments?.length ? (
          <View style={styles.userImages}>
            {message.attachments.map((uri, index) => (
              <View key={`${uri}:${index}`} style={styles.userImageWrap}><NitroImage image={{ filePath: uri }} style={styles.userImage} /></View>
            ))}
          </View>
        ) : null}
        {message.text ? <View style={styles.userBubble}><Text style={styles.userText}>{message.text}</Text></View> : null}
      </Animated.View>
    );
  }

  const isWaiting = message.status === 'streaming' && message.text.length === 0;
  const showTrace = !!message.reasoning && !isWaiting;
  return (
    <View style={styles.assistantRow}>
      {showTrace ? (
        <Pressable style={styles.traceRow} hitSlop={6} onPress={() => onOpenReasoning(message.reasoning as string)}>
          <Icon name="clock" size={15} color={theme.textSecondary} />
          <Text style={styles.traceLabel} numberOfLines={1}>{reasoningLabel(message.reasoning as string) ?? copy('guide_reasoning')}</Text>
          <Icon name="chevron.right" size={13} color={theme.textSecondary} />
        </Pressable>
      ) : null}
      {isWaiting ? (
        <Animated.View style={styles.statusRow} entering={FadeIn.delay(450).duration(300)}>
          <Icon name={(message.statusLabel ?? 'Réflexion') === 'Réponse' ? 'text.bubble' : 'sparkles'} size={15} color={theme.textSecondary} />
          <ThinkingText text={`${copy(PHRASE[message.statusLabel ?? 'Réflexion'] ?? 'guide_thinking')}…`} />
        </Animated.View>
      ) : (
        <EnrichedMarkdownText
          markdown={message.text}
          markdownStyle={guideMarkdownStyle}
          flavor="github"
          streamingAnimation={message.status === 'streaming'}
          onLinkPress={({ url }) => ouvrirLien(url)}
        />
      )}
      {message.status === 'error' ? <Text style={styles.error}>{copy("ui_copy_125")}</Text> : null}
      {message.status === 'done' && message.text ? (
        <View style={styles.actionRow}>
          <CopyButton key={message.id} text={message.text} />
          <Pressable accessibilityLabel={copy("ui_copy_126")} hitSlop={6} onPress={() => void Share.share({ message: message.text })}><Icon name="square.and.arrow.up" size={18} color={theme.textSecondary} /></Pressable>
          <SpeakButton messageId={message.id} text={message.text} />
          <Pressable accessibilityLabel={copy("ui_copy_127")} hitSlop={6} onPress={() => onRate(message.id, 'up')}><Icon name="hand.thumbsup" size={18} color={message.feedback === 'up' ? theme.text : theme.textSecondary} /></Pressable>
          <Pressable accessibilityLabel={copy("ui_copy_128")} hitSlop={6} onPress={() => onRate(message.id, 'down')}><Icon name="hand.thumbsdown" size={18} color={message.feedback === 'down' ? theme.text : theme.textSecondary} /></Pressable>
          <Pressable accessibilityLabel={copy("ui_copy_129")} hitSlop={6} onPress={() => onRegenerate(message.id)}><Icon name="arrow.clockwise" size={18} color={theme.textSecondary} /></Pressable>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 4 },
  userImages: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, maxWidth: '82%', marginBottom: 4 },
  userImageWrap: { width: 180, height: 180, borderRadius: 18, overflow: 'hidden' },
  userImage: { width: 180, height: 180 },
  userBubble: { maxWidth: '82%', backgroundColor: theme.userBubbleBackground, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  userText: { color: theme.userBubbleText, fontFamily: 'Satoshi-Regular', fontSize: 16, lineHeight: 21 },
  assistantRow: { paddingHorizontal: 16, paddingVertical: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  traceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  traceLabel: { flex: 1, color: theme.textSecondary, fontFamily: 'Satoshi-Regular', fontSize: 16 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 22, paddingTop: 10, paddingBottom: 2 },
  error: { color: '#c05a3a', fontFamily: 'Satoshi-Regular', fontSize: 13, marginTop: 4 },
});
