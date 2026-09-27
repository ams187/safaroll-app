// La lecture à voix haute d'une réponse.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI N'ALLAIT PAS
//
//   void Speech.isSpeakingAsync().then((speaking) =>
//     speaking ? Speech.stop() : Speech.speak(message.text, { language: 'fr-FR' }));
//
// Quatre problèmes dans une ligne :
//
//   1. `isSpeakingAsync` répond pour LE SYNTHÉTISEUR, pas pour un message. Si
//      la réponse A est en cours et qu'on appuie sur « écouter » de la réponse
//      B, la condition voit « ça parle » et ARRÊTE A. Le bouton de B faisait
//      exactement le contraire de ce qu'il annonçait.
//   2. Rien ne changeait à l'écran. Même pictogramme au repos et en lecture,
//      donc aucun moyen de savoir si l'appui a pris.
//   3. `fr-FR` en dur, alors que le Guide répond dans la langue du joueur : une
//      réponse en anglais était lue avec une voix française.
//   4. Le texte passé au synthétiseur est du MARKDOWN. L'affichage le rend
//      proprement, la voix prononçait les astérisques, les dièses et les URL.
//
// Ici l'état vit à UN endroit — l'identifiant du message en cours de lecture —
// et le synthétiseur en découle. Une seule lecture à la fois par construction.

import { currentLanguage } from '@/i18n/languages';
import { create } from 'zustand';
import { spokenText } from './spoken-text';

let Speech: typeof import('expo-speech') | null = null;
try {
  Speech = require('expo-speech') as typeof import('expo-speech');
} catch {
  Speech = null;
}

let Audio: typeof import('react-native-audio-api') | null = null;
try {
  Audio = require('react-native-audio-api') as typeof import('react-native-audio-api');
} catch {
  Audio = null;
}

export const speechAvailable = Speech != null;

/**
 * LE SILENCE QUI N'ÉTAIT PAS UN BUG DE CODE.
 *
 * `AVSpeechSynthesizer` parle dans la session audio de l'app. Par défaut celle
 * d'une app iOS est `soloAmbient` : muette dès que l'interrupteur de la tranche
 * est sur silencieux. Le bouton passait bien en ■, la lecture démarrait bien —
 * et rien ne sortait. Aucune erreur à attraper, puisqu'il n'y a pas d'erreur.
 *
 * `playback` est la catégorie de ce qui doit s'entendre malgré l'interrupteur ;
 * c'est celle des podcasts et des livres audio, et lire une réponse à voix
 * haute en fait partie. `spokenAudio` est le mode qu'Apple réserve à la parole :
 * il met en PAUSE les autres contenus parlés au lieu de les baisser — deux voix
 * simultanées ne s'écoutent pas — et `duckOthers` se contente de baisser la
 * musique.
 *
 * ON REND LA SESSION À LA FIN. La session est globale : `playback` interdit
 * l'entrée micro, et la laisser armée casserait l'enregistrement vidéo de la
 * caméra. `iosNotifyOthersOnDeactivation` prévient la musique qu'elle peut
 * reprendre son volume.
 */
const POUR_LA_VOIX: import('react-native-audio-api').SessionOptions = {
  iosCategory: 'playback',
  iosMode: 'spokenAudio',
  iosNotifyOthersOnDeactivation: true,
  iosOptions: ['duckOthers'],
};

const armerLaSession = () => {
  if (process.env.EXPO_OS !== 'ios' || !Audio) return;
  Audio.AudioManager.setAudioSessionOptions(POUR_LA_VOIX);
  void Audio.AudioManager.setAudioSessionActivity(true).catch(() => undefined);
};

const rendreLaSession = () => {
  if (process.env.EXPO_OS !== 'ios' || !Audio) return;
  void Audio.AudioManager.setAudioSessionActivity(false).catch(() => undefined);
};

export { spokenText } from './spoken-text';

/** `AppLanguage` ne connaît que la langue ; une voix veut une région. */
const VOIX: Record<string, string> = { en: 'en-US', fr: 'fr-FR' };

type SpeechState = {
  /** L'identifiant du message lu, ou `null`. Le seul état de tout le module. */
  speakingId: string | null;
  toggle: (id: string, markdown: string) => void;
  stop: () => void;
};

export const useSpeech = create<SpeechState>((set, get) => ({
  speakingId: null,
  stop: () => {
    Speech?.stop();
    rendreLaSession();
    set({ speakingId: null });
  },
  toggle: (id, markdown) => {
    if (!Speech) return;
    const enCours = get().speakingId;
    // `stop()` déclenche l'`onStopped` de la lecture précédente ; les rappels
    // plus bas ne remettent à zéro que SI l'identifiant est encore le leur,
    // sinon l'arrêt de A effacerait le départ de B.
    Speech.stop();
    if (enCours === id) {
      rendreLaSession();
      set({ speakingId: null });
      return;
    }
    const texte = spokenText(markdown);
    if (!texte) {
      set({ speakingId: null });
      return;
    }
    const fini = () => set((state) => {
      if (state.speakingId !== id) return state;
      rendreLaSession();
      return { speakingId: null };
    });
    armerLaSession();
    set({ speakingId: id });
    Speech.speak(texte, {
      language: VOIX[currentLanguage()] ?? 'en-US',
      onDone: fini,
      onError: fini,
      onStopped: fini,
      rate: 0.95,
    });
  },
}));
