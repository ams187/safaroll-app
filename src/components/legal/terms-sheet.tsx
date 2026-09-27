import { useTranslation as useUiTranslation } from 'react-i18next';
// LES CONDITIONS, LISIBLES DANS L'APP.
//
// Directive Apple 1.2 : une app qui affiche du contenu publié par d'autres doit
// faire ACCEPTER des conditions avant usage, et ces conditions doivent poser une
// tolérance zéro pour les contenus répréhensibles et les comportements abusifs.
//
// L'écran de connexion portait déjà « En continuant, tu acceptes les Conditions
// d'utilisation » — en texte mort, sans rien derrière. Une acceptation qui ne
// renvoie à aucun texte n'est pas une acceptation.
//
// POURQUOI DANS L'APP ET PAS UNE URL : le domaine n'existe pas encore. Un lien
// mort dans une fiche App Store se fait rejeter ; un texte embarqué, non. Le
// jour où le site est en ligne, ce composant peut renvoyer vers lui — le
// contenu ci-dessous reste la version de référence.

import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** À remplacer par une adresse de support dès que le domaine existe. Apple
 *  exige un contact JOIGNABLE : une adresse sur un domaine non enregistré
 *  rebondit, ce qui est pire que pas d'adresse du tout. */
const CONTACT = 'contact@example.com';

const SECTIONS: { body: string; title: string }[] = [
  {
    body:
      'SafaRoll identifie les animaux que tu photographies et en fait des cartes à collectionner. ' +
      'Tu gardes la propriété de tes photos. En publiant un deck, tu acceptes qu’il soit visible ' +
      'par les autres joueurs, avec ton nom d’affichage et les cartes qu’il contient.',
    title: 'Ce que fait SafaRoll',
  },
  {
    body:
      'Tolérance zéro. Sont interdits : la nudité et le contenu sexuel, la violence, la haine, ' +
      'le harcèlement, l’usurpation d’identité, le spam, et toute photo qui n’est pas la tienne. ' +
      'Un contenu qui enfreint ces règles est retiré, et le compte qui l’a publié peut être ' +
      'suspendu sans préavis.',
    title: 'Ce que tu ne peux pas publier',
  },
  {
    body:
      'Chaque deck public et chaque profil peut être signalé — appui long sur un deck, bouton ⋯ ' +
      'sur une fiche de joueur. Tout signalement est examiné sous 24 heures, et le contenu ' +
      'concerné retiré s’il enfreint ces règles. Tu peux aussi bloquer un joueur : ses decks, ' +
      'son profil et son nom disparaissent alors de la communauté, et il ne peut plus t’ajouter. ' +
      'Les comptes bloqués se retrouvent dans ton profil, où tu peux les débloquer.',
    title: 'Signaler et bloquer',
  },
  {
    body:
      'Tes captures, ta collection et tes decks t’appartiennent. Supprimer ton compte depuis ton ' +
      'profil efface l’ensemble — photos comprises — sans conservation.',
    title: 'Tes données',
  },
  {
    body: `Une question, un signalement urgent, une demande de suppression : ${CONTACT}.`,
    title: 'Nous joindre',
  },
];

export function TermsSheet({ onClose, visible }: { onClose: () => void; visible: boolean }) {
  const { t: copy } = useUiTranslation();
  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <View style={styles.root}>
        <View style={styles.bar}>
          <Text style={styles.barTitle}>{copy("ui_copy_047")}</Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <Text style={styles.close}>{copy("reveal_close")}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {SECTIONS.map((section, index) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.title}>{copy(`terms_title_${index}`)}</Text>
              <Text style={styles.body}>{copy(`terms_body_${index}`, { contact: CONTACT })}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  barTitle: { color: theme.colors.foreground, fontFamily: theme.fonts.display, fontSize: 18 },
  close: { color: theme.colors.primary, fontFamily: theme.fonts.regular, fontSize: 15 },
  content: { padding: 20, paddingBottom: 60, gap: 22 },
  section: { gap: 7 },
  title: { color: theme.colors.foreground, fontFamily: theme.fonts.display, fontSize: 16 },
  body: { color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 14, lineHeight: 21 },
}));
