import { useTranslation as useUiTranslation } from 'react-i18next';
import { NativeSheet } from '@/components/ui/native-sheet';
import { MessageBubble } from '@/components/guide/components/MessageBubble';
import { useChatStore } from '@/components/guide/state/chat-store';
import { speciesName } from '@/lib/animals/species-name';
import { SymbolView } from 'expo-symbols';
import { memo, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { HoloCardData } from './holo-card';

const QUESTIONS = [
  "ui_copy_289",
  "ui_copy_290",
  "ui_copy_291",
  "ui_copy_292",
] as const;

export const CardGuideSheet = memo(function CardGuideSheet({ card, onClose, open }: { card: HoloCardData; onClose: () => void; open: boolean }) {
  const { t: copy } = useUiTranslation();
  const { theme } = useUnistyles();
  const [askedCardId, setAskedCardId] = useState<string | null>(null);
  const [detent, setDetent] = useState<'medium' | 'large'>('medium');
  const [value, setValue] = useState('');
  const send = useChatStore((state) => state.send);
  const rate = useChatStore((state) => state.rate);
  const regenerate = useChatStore((state) => state.regenerate);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const messages = useChatStore((state) => state.messages);
  const ephemeral = useChatStore((state) => state.ephemeral);
  const paused = useChatStore((state) => state.paused);
  const startEphemeral = useChatStore((state) => state.startEphemeral);
  const endEphemeral = useChatStore((state) => state.endEphemeral);
  const name = speciesName(card) ?? card.scientificName ?? copy("ui_copy_293");
  const cardId = card._id ?? card.scientificName ?? name;
  // `asked` ET `ephemeral` : le premier retient l'échange à SA fiche quand la
  // carte du dessous change sans fermer la feuille, le second garantit que ce
  // qu'on lit est bien l'emprunt et pas le fil du profil resté en mémoire.
  const asked = askedCardId === cardId && ephemeral;
  const ask = (question: string) => {
    if (!question.trim() || isStreaming || paused) return;
    // Emprunté au dernier moment : ouvrir la feuille sans rien demander ne doit
    // pas déranger le fil du profil. Sans effet si l'emprunt est déjà en cours.
    startEphemeral();
    // La feuille ouvre à mi-hauteur : la réponse tomberait sous le pli, et rien
    // ne dit au joueur qu'il faut tirer. On monte donc au moment où il y a
    // quelque chose à lire. Il peut redescendre au doigt — `onDetentChange`
    // remet la valeur à jour, sans quoi la question suivante ne remonterait pas.
    setDetent('large');
    setAskedCardId(cardId);
    send(copy('guide_about', { name, species: card.scientificName ?? copy('ui_copy_294'), question: question.trim() }));
    setValue('');
  };
  const close = () => {
    setAskedCardId(null);
    setDetent('medium');
    endEphemeral();
    onClose();
  };
  // Le filet : si la feuille disparaît sans passer par `close` — une navigation,
  // un démontage de la carte — le fil du profil resterait parqué et invisible.
  useEffect(() => endEphemeral, [endEphemeral]);

  return (
    <NativeSheet
      detent={detent}
      detents={['medium', 'large']}
      onClose={close}
      onDetentChange={setDetent}
      open={open}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View style={styles.guideMark}><SymbolView name="sparkles" size={18} tintColor={theme.colors.onPrimary} weight="semibold" /></View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{copy("ui_copy_104")}</Text>
            <Text numberOfLines={1} style={styles.title}>{name}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.prompt}>
            {paused
              ? copy("ui_copy_137")
              : copy("ui_copy_288")}
          </Text>
          <View style={styles.questions}>
            {QUESTIONS.map((question) => (
              <Pressable
                disabled={isStreaming || paused}
                key={question}
                onPress={() => ask(copy(question))}
                style={({ pressed }) => [styles.question, pressed && styles.pressed]}
              >
                <Text style={styles.questionText}>{copy(question)}</Text>
                <SymbolView name="arrow.up.right" size={12} tintColor={theme.colors.faint} weight="semibold" />
              </Pressable>
            ))}
          </View>

          {/* TOUT l'échange, question comprise. Avant, la feuille n'affichait
              que la dernière réponse de l'assistant : la question du joueur
              n'apparaissait nulle part, et pendant que la réponse se composait
              c'est une bulle VIDE qu'il regardait. `MessageBubble` sait déjà
              dessiner l'attente — il n'y a rien à ajouter autour.
              L'échange ne contient que cette fiche : `startEphemeral` a mis le
              fil du profil de côté. */}
          {asked && messages.length ? (
            <View style={styles.thread}>
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onOpenReasoning={() => {}}
                  onRate={rate}
                  onRegenerate={regenerate}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            editable={!isStreaming && !paused}
            multiline
            onChangeText={setValue}
            onSubmitEditing={() => ask(value)}
            placeholder={copy("ui_copy_105")}
            placeholderTextColor={theme.colors.faint}
            style={styles.input}
            value={value}
          />
          <Pressable
            accessibilityLabel={copy("ui_copy_106")}
            accessibilityRole="button"
            disabled={!value.trim() || isStreaming || paused}
            onPress={() => ask(value)}
            style={[styles.send, (!value.trim() || isStreaming || paused) && styles.sendDisabled]}
          >
            <SymbolView name="arrow.up" size={16} tintColor={theme.colors.onPrimary} weight="bold" />
          </Pressable>
        </View>
      </View>
    </NativeSheet>
  );
});

const styles = StyleSheet.create((theme) => ({
  sheet: { flex: 1, paddingBottom: theme.gap(1.5) },
  // `paddingTop` : la feuille ouvre juste sous l'indicateur de glissement, et
  // sans marge le pictogramme et « LE GUIDE SAFAROLL » viennent le toucher.
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.gap(1.5), paddingHorizontal: theme.gap(2.5), paddingTop: theme.gap(2.5), paddingBottom: theme.gap(1.5) },
  guideMark: { alignItems: 'center', backgroundColor: theme.colors.primary, borderRadius: 15, height: 46, justifyContent: 'center', width: 46 },
  headerCopy: { flex: 1 },
  eyebrow: { color: theme.colors.muted, fontFamily: theme.fonts.bold, fontSize: 10, letterSpacing: 1.3 },
  title: { color: theme.colors.foreground, fontFamily: theme.fonts.display, fontSize: 25, marginTop: 2 },
  content: { paddingBottom: theme.gap(2), paddingHorizontal: theme.gap(2.5) },
  prompt: { color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 14, lineHeight: 20, marginBottom: theme.gap(1.5) },
  questions: { gap: theme.gap(0.75) },
  question: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingHorizontal: theme.gap(2), paddingVertical: 13 },
  questionText: { color: theme.colors.foreground, flex: 1, fontFamily: theme.fonts.medium, fontSize: 14 },
  // Marges négatives : `MessageBubble` porte déjà ses 16 pt latéraux, qui
  // s'ajouteraient aux 20 pt de la feuille et décaleraient les bulles de tout
  // le reste du contenu.
  thread: { gap: theme.gap(0.5), marginHorizontal: -theme.gap(2.5), marginTop: theme.gap(2) },
  composer: { alignItems: 'flex-end', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: theme.gap(1), marginHorizontal: theme.gap(2), padding: 5, paddingLeft: theme.gap(2) },
  input: { color: theme.colors.foreground, flex: 1, fontFamily: theme.fonts.regular, fontSize: 15, maxHeight: 92, minHeight: 38, paddingVertical: 9 },
  send: { alignItems: 'center', backgroundColor: theme.colors.primary, borderRadius: 19, height: 38, justifyContent: 'center', width: 38 },
  sendDisabled: { opacity: 0.3 },
  pressed: { opacity: 0.66 },
}));
