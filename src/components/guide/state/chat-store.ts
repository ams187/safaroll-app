import { plainT as translate } from '@/i18n/plain';
import { searchSafaRollKb } from '../rag/search-knowledge-base';
import { connectionManager } from '../openai/connection-manager';
import {
  buildFunctionCallOutput,
  buildResponseCreate,
  parseServerEvent,
} from '../openai/protocol';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { saveGuideConversation, type SavedConversation } from './guide-persistence';
import { suggestConversationTitle } from '../openai/title';
import { toast } from '@/lib/notify';

export type MessageRole = 'user' | 'assistant';
export type MessageStatus = 'streaming' | 'done' | 'error';
export type Attachment = { uri: string; dataUrl: string };
export type Message = {
  id: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  statusLabel?: string;
  attachments?: string[];
  feedback?: 'up' | 'down';
  reasoning?: string;
};

const MAX_MESSAGES = 500;
const MAX_TOOL_CALLS = 4;

const nextMessageId = () => Crypto.randomUUID();
let previousResponseId: string | undefined;
let streamingId: string | null = null;
let pendingToolCall: { callId: string; name: string; args: string } | null = null;
let toolCallCount = 0;
/**
 * LE FIL DU PROFIL, MIS DE CÔTÉ PENDANT UNE QUESTION DE FICHE.
 *
 * La feuille « Demander au Guide » d'une carte n'ouvre pas une deuxième
 * conversation : `connectionManager` n'a qu'UN emplacement de gestionnaire et
 * qu'UNE chaîne `previousResponseId` côté serveur, donc deux fils vivants en
 * même temps se marcheraient dessus — c'est exactement le bogue qu'on répare.
 *
 * Alors on parque : la question de fiche emprunte le magasin, seule, puis rend
 * le fil du profil intact en repartant. Rien de tout ça ne touche la base.
 */
let parked: {
  conversationId: string | null;
  messages: Message[];
  previousResponseId: string | undefined;
  title: string;
} | null = null;
let pendingText = '';
let pendingReasoning = '';
let flushHandle: number | null = null;

type ChatState = {
  conversationId: string | null;
  title: string;
  messages: Message[];
  isStreaming: boolean;
  /** Vrai pendant une question posée depuis une fiche : rien n'est sauvegardé. */
  ephemeral: boolean;
  /**
   * Le plafond quotidien est atteint. Tient jusqu'au prochain lancement de
   * l'app — pas jusqu'à minuit, faute de savoir quand le compteur du serveur
   * bascule. Se retromper au message suivant ne coûte rien : le relais refuse à
   * nouveau et ça se réarme.
   */
  paused: boolean;
  /**
   * Incrémenté chaque fois que la liste des messages est REMPLACÉE d'un bloc —
   * chargement d'une discussion, nouvelle discussion, emprunt d'une fiche et
   * retour. Jamais par `send`, qui ne fait qu'ajouter.
   *
   * Ce que ça sert : `ChatScreen` mémorise la position du message qu'on vient
   * d'envoyer pour le caler en haut. Cette position ne veut plus rien dire dès
   * que le contenu change sous elle, et l'identifiant du fil ne suffit pas à le
   * détecter — rouvrir LA MÊME discussion depuis les discussions récentes le
   * garde identique tout en remplaçant les messages.
   */
  epoch: number;
  loadConversation: (conversation: SavedConversation) => void;
  rate: (messageId: string, feedback: 'up' | 'down') => void;
  regenerate: (messageId: string) => void;
  send: (rawText: string, attachments?: Attachment[]) => void;
  stop: () => void;
  newChat: () => void;
  /** Emprunte le magasin pour une question de fiche, sans rien écrire. */
  startEphemeral: () => void;
  /** Rend le fil du profil. Sans effet si aucune question de fiche n'est en cours. */
  endEphemeral: () => void;
};

export const useChatStore = create<ChatState>((set, get) => {
  const setMessages = (updater: (previous: Message[]) => Message[]) =>
    set((state) => ({ messages: updater(state.messages) }));

  const cancelFlush = () => {
    if (flushHandle != null) cancelAnimationFrame(flushHandle);
    flushHandle = null;
  };
  /** Tout ce qui appartient à une réponse en cours, et rien d'autre. */
  const resetTransient = () => {
    cancelFlush();
    pendingText = '';
    pendingReasoning = '';
    streamingId = null;
    pendingToolCall = null;
    toolCallCount = 0;
  };
  const persistCurrent = () => {
    const state = get();
    // Une question posée depuis une fiche est jetable : elle ne rejoint jamais
    // `guide_conversations`, donc jamais l'historique du profil.
    if (state.ephemeral) return;
    if (!state.conversationId || state.messages.length === 0) return;
    void saveGuideConversation({
      id: state.conversationId,
      messages: state.messages,
      previousResponseId,
      title: state.title,
    }).catch((error) => {
      if (__DEV__) console.warn('[guide] sauvegarde impossible :', error);
    });
  };
  /**
   * LE NOM DE LA DISCUSSION, EN ARRIÈRE-PLAN.
   *
   * Le titre de repli est posé tout de suite — le premier message tronqué —
   * pour que le tiroir n'affiche jamais une ligne vide. Puis on demande mieux
   * au modèle, et on remplace si la réponse arrive.
   *
   * Les deux gardes ne sont pas décoratives : la requête met une seconde ou
   * deux, pendant lesquelles le joueur peut ouvrir une autre discussion,
   * démarrer une nouvelle ou poser une question depuis une fiche. `epoch`
   * refuse un titre qui atterrirait sur le mauvais fil ; `ephemeral` refuse de
   * nommer une question de fiche, qui n'est jamais sauvegardée.
   */
  const nommerLaDiscussion = (premierMessage: string) => {
    const epoch = get().epoch;
    void suggestConversationTitle(premierMessage).then((titre) => {
      if (!titre) return;
      const state = get();
      if (state.epoch !== epoch || state.ephemeral) return;
      set({ title: titre });
      persistCurrent();
    }).catch(() => undefined);
  };
  const flushDeltas = () => {
    flushHandle = null;
    const id = streamingId;
    const text = pendingText;
    const reasoning = pendingReasoning;
    pendingText = '';
    pendingReasoning = '';
    if (!id || (!text && !reasoning)) return;
    setMessages((previous) => previous.map((message) => message.id === id
      ? {
          ...message,
          text: message.text + text,
          reasoning: reasoning ? (message.reasoning ?? '') + reasoning : message.reasoning,
        }
      : message));
  };
  const scheduleFlush = () => {
    if (flushHandle == null) flushHandle = requestAnimationFrame(flushDeltas);
  };
  const appendDelta = (text: string) => {
    if (!streamingId) return;
    pendingText += text;
    scheduleFlush();
  };
  const appendReasoning = (text: string) => {
    if (!streamingId) return;
    pendingReasoning += text;
    scheduleFlush();
  };
  const setStatusLabel = (statusLabel: string) => {
    const id = streamingId;
    if (!id) return;
    setMessages((previous) => previous.map((message) =>
      message.id === id ? { ...message, statusLabel } : message));
  };
  const finishStreaming = (status: MessageStatus) => {
    const id = streamingId;
    if (!id) return;
    cancelFlush();
    const text = pendingText;
    const reasoning = pendingReasoning;
    pendingText = '';
    pendingReasoning = '';
    setMessages((previous) => previous.map((message) => message.id === id
      ? {
          ...message,
          text: message.text + text,
          reasoning: reasoning ? (message.reasoning ?? '') + reasoning : message.reasoning,
          status,
        }
      : message));
    streamingId = null;
    set({ isStreaming: false });
    queueMicrotask(persistCurrent);
  };

  const runToolCall = async (
    toolCall: { callId: string; name: string; args: string },
    responseId: string,
  ) => {
    toolCallCount += 1;
    let output: string;
    if (toolCall.name !== 'search_safaroll_kb') {
      output = `Unknown tool: ${toolCall.name}`;
    } else if (toolCallCount > MAX_TOOL_CALLS) {
      output = 'Tool call limit reached; answer from the context already available.';
    } else {
      try {
        const args = JSON.parse(toolCall.args || '{}') as { query?: string };
        output = await searchSafaRollKb(args.query ?? '', 5);
        if (!output) output = "Aucune entrée correspondante n'a été trouvée dans l'atlas SafaRoll.";
      } catch (error) {
        output = `La recherche dans l'atlas a échoué : ${String(error)}`;
      }
    }
    if (!connectionManager.send(buildFunctionCallOutput(toolCall.callId, output, responseId))) {
      finishStreaming('error');
      toast.fail(translate('guide_connection_lost_title'), translate('guide_connection_lost_body'));
    }
  };

  connectionManager.setHandlers({
    onServerEvent: (raw) => {
      const parsed = parseServerEvent(raw);
      switch (parsed.kind) {
        case 'status': setStatusLabel(parsed.label); break;
        case 'delta': appendDelta(parsed.text); break;
        case 'reasoning': appendReasoning(parsed.text); break;
        case 'tool_call':
          pendingToolCall = { callId: parsed.callId, name: parsed.name, args: parsed.args };
          setStatusLabel("Recherche dans l'atlas");
          break;
        case 'completed': {
          const toolCall = pendingToolCall;
          if (toolCall) {
            pendingToolCall = null;
            void runToolCall(toolCall, parsed.responseId);
          } else {
            if (parsed.responseId) previousResponseId = parsed.responseId;
            finishStreaming('done');
          }
          break;
        }
        case 'error':
          previousResponseId = undefined;
          if (parsed.code === 'websocket_connection_limit_reached') {
            finishStreaming('done');
            connectionManager.forceReconnect();
          } else if (parsed.code === 'guide_daily_limit') {
            // PAS `finishStreaming('error')`. Elle laisserait la bulle vide du
            // Guide dans le fil, sous-titrée « Le Guide a perdu le fil.
            // Réessaie. » — un texte générique qui invite à un geste qui ne peut
            // pas aboutir avant demain. Le message n'a atteint personne : sa
            // bulle n'a pas lieu d'être, on la retire.
            const vide = streamingId;
            cancelFlush();
            pendingText = '';
            pendingReasoning = '';
            streamingId = null;
            setMessages((previous) => previous.filter((message) => message.id !== vide));
            set({ isStreaming: false, paused: true });
            // Un plafond atteint n'est pas une panne : `toast.info` porte
            // l'étincelle, pas le triangle rouge.
            toast.info(translate('guide_paused_title'), parsed.message);
          } else {
            finishStreaming('error');
            toast.fail(translate('guide_unavailable_title'), parsed.message);
          }
          break;
        case 'ignored': break;
      }
    },
    onDisconnect: () => {
      previousResponseId = undefined;
      if (streamingId) finishStreaming('error');
    },
  });

  return {
    conversationId: null,
    title: 'Nouvelle discussion',
    messages: [],
    isStreaming: false,
    ephemeral: false,
    epoch: 0,
    paused: false,
    loadConversation: (conversation) => {
      cancelFlush();
      previousResponseId = conversation.previousResponseId;
      streamingId = null;
      pendingToolCall = null;
      set({
        conversationId: conversation.id,
        epoch: get().epoch + 1,
        isStreaming: false,
        messages: conversation.messages.map((message) => message.status === 'streaming' ? { ...message, status: 'done' } : message),
        title: conversation.title,
      });
    },
    rate: (messageId, feedback) => {
      setMessages((previous) => previous.map((message) => message.id === messageId
        ? { ...message, feedback: message.feedback === feedback ? undefined : feedback }
        : message));
      queueMicrotask(persistCurrent);
    },
    regenerate: (messageId) => {
      if (get().isStreaming) return;
      const messages = get().messages;
      const assistantIndex = messages.findIndex((message) => message.id === messageId && message.role === 'assistant');
      const user = assistantIndex > 0 ? messages[assistantIndex - 1] : undefined;
      if (!user || user.role !== 'user' || !user.text.trim()) return;
      previousResponseId = undefined;
      pendingToolCall = null;
      toolCallCount = 0;
      const assistant: Message = {
        id: nextMessageId(), role: 'assistant', text: '', status: 'streaming', statusLabel: 'Réflexion',
      };
      if (!connectionManager.send(buildResponseCreate(user.text, undefined, []))) {
        toast.info(translate('guide_connecting_title'), translate('guide_connecting_body'));
        return;
      }
      streamingId = assistant.id;
      set({ messages: [...messages.slice(0, assistantIndex), assistant], isStreaming: true });
      queueMicrotask(persistCurrent);
    },
    send: (rawText, attachments = []) => {
      const text = rawText.trim();
      if (!text && attachments.length === 0) return;
      // La garde de dernier recours. Les deux composeurs se ferment déjà quand
      // `paused`, mais tant que rien ne l'empêche ici, chaque tentative ferait
      // un aller-retour jusqu'au serveur pour se faire refuser — et gonflerait
      // le compteur au passage.
      if (get().paused) return;
      if (!connectionManager.send(buildResponseCreate(
        text,
        previousResponseId,
        attachments.map((attachment) => attachment.dataUrl),
      ))) {
        toast.info(translate('guide_connecting_title'), translate('guide_connecting_body'));
        return;
      }
      pendingToolCall = null;
      toolCallCount = 0;
      const user: Message = {
        id: nextMessageId(), role: 'user', text, status: 'done',
        attachments: attachments.length ? attachments.map(({ uri }) => uri) : undefined,
      };
      const assistant: Message = {
        id: nextMessageId(), role: 'assistant', text: '', status: 'streaming', statusLabel: 'Réflexion',
      };
      streamingId = assistant.id;
      const current = get();
      const premierMessage = current.messages.length === 0;
      set({
        conversationId: current.conversationId ?? Crypto.randomUUID(),
        isStreaming: true,
        messages: [...current.messages, user, assistant].slice(-MAX_MESSAGES),
        title: premierMessage ? text.slice(0, 120) || translate('guide_default_title') : current.title,
      });
      queueMicrotask(persistCurrent);
      if (premierMessage && text && !current.ephemeral) nommerLaDiscussion(text);
    },
    stop: () => finishStreaming('done'),
    newChat: () => {
      resetTransient();
      previousResponseId = undefined;
      parked = null;
      set({ conversationId: null, ephemeral: false, epoch: get().epoch + 1, messages: [], isStreaming: false, title: 'Nouvelle discussion' });
    },
    startEphemeral: () => {
      if (get().ephemeral) return;
      const current = get();
      parked = {
        conversationId: current.conversationId,
        messages: current.messages,
        previousResponseId,
        title: current.title,
      };
      resetTransient();
      // La chaîne serveur aussi est mise de côté : sans cette ligne la question
      // de fiche repartait sur le `previous_response_id` du profil, donc avec
      // tout son contexte — le fil se croisait côté modèle avant même l'affichage.
      previousResponseId = undefined;
      set({ conversationId: null, ephemeral: true, epoch: get().epoch + 1, isStreaming: false, messages: [], title: 'Question de fiche' });
    },
    endEphemeral: () => {
      if (!get().ephemeral) return;
      // La réponse en vol est abandonnée : ses deltas visaient un message qui
      // n'existe plus, et les laisser courir les ferait atterrir sur le fil
      // rendu au profil.
      resetTransient();
      const rendu = parked;
      parked = null;
      previousResponseId = rendu?.previousResponseId;
      set({
        conversationId: rendu?.conversationId ?? null,
        ephemeral: false,
        epoch: get().epoch + 1,
        isStreaming: false,
        messages: rendu?.messages ?? [],
        title: rendu?.title ?? 'Nouvelle discussion',
      });
    },
  };
});
