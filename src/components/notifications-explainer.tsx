import { typesMuets, type NudgeKind } from '@/lib/animals/nudge-feedback';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/**
 * POURQUOI CES MESSAGES — ET COMMENT ILS SE TAISENT.
 *
 * CE QUE ÇA RÉPARE
 *
 * Une notification arrive sans contexte. Le joueur ne sait ni pourquoi elle a
 * été choisie, ni ce qui la déclenchera à nouveau, ni si l'app l'écoute quand
 * il n'y répond pas. Faute de réponse, la seule action disponible est brutale :
 * tout couper, dans les réglages d'iOS, sans retour possible.
 *
 * Ce panneau donne la règle en clair. Il ne cherche pas à convaincre — il
 * DÉCRIT, y compris ce que l'app a décidé de ne plus envoyer. C'est ce qui le
 * rend crédible : une app qui avoue s'être tue est une app qui mesure.
 *
 * POURQUOI CE N'EST PAS UN RÉGLAGE
 *
 * Il n'y a rien à cocher. Les interrupteurs existent déjà — notifications,
 * activités en direct — et en ajouter un par type de message transformerait
 * une promesse simple en tableau de bord. Ici on explique ; la boucle de
 * silence agit toute seule, et le joueur peut vérifier qu'elle agit.
 */
export function NotificationsExplainer() {
  const { t } = useTranslation();
  const muets = typesMuets();

  // `as const` : `SymbolView` exige un nom de symbole SF connu, pas une chaîne
  // libre. Un nom inventé rendrait une icône vide, sans erreur de compilation.
  const REGLES = [
    { icone: 'calendar.badge.exclamationmark', kind: 'leaving', texte: t('notif_why_leaving') },
    { icone: 'sunrise.fill', kind: 'peak', texte: t('notif_why_dawn') },
    { icone: 'arrow.down.left.circle.fill', kind: 'arriving', texte: t('notif_why_arriving') },
  ] as const satisfies readonly { icone: string; kind: NudgeKind; texte: string }[];

  return (
    <View style={styles.bloc}>
      <Text style={styles.titre}>{t('notif_why_title')}</Text>

      {REGLES.map((regle) => {
        const muet = muets.includes(regle.kind);
        return (
          <View key={regle.kind} style={styles.ligne}>
            <SymbolView name={regle.icone} size={15} tintColor={muet ? '#B7AE9F' : '#a8761a'} />
            <Text style={[styles.texte, muet && styles.texteMuet]}>{regle.texte}</Text>
            {/* L'aveu est la partie utile : on montre ce qu'on n'envoie PLUS. */}
            {muet ? <Text style={styles.etiquette}>{t('notif_why_muted')}</Text> : null}
          </View>
        );
      })}

      <Text style={styles.regle}>{t('notif_why_rule')}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bloc: {
    backgroundColor: theme.colors.surfaceMuted,
    borderCurve: 'continuous',
    borderRadius: 18,
    gap: 11,
    padding: 16,
  },
  titre: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 15 },
  ligne: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  texte: { color: theme.colors.foreground, flex: 1, fontFamily: theme.fonts.regular, fontSize: 13.5, lineHeight: 19 },
  texteMuet: { color: theme.colors.muted, textDecorationLine: 'line-through' },
  etiquette: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bold,
    fontSize: 10.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  regle: {
    borderTopColor: theme.colors.border,
    borderTopWidth: 1,
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 12.5,
    lineHeight: 18,
    paddingTop: 10,
  },
}));
