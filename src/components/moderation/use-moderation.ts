// SIGNALER ET BLOQUER — LES DEUX OBLIGATIONS D'APPLE SUR LE CONTENU D'AUTRUI.
//
// Directive 1.2 : une app qui affiche ce que d'autres publient doit offrir un
// moyen de signaler un contenu ET de bloquer son auteur. SafaRoll montre les
// decks publics, les classements et les fiches de joueurs : les deux gestes
// doivent être atteignables partout où l'on croise quelqu'un.
//
// Ce module ne dessine rien. Il rend des actions prêtes à poser dans un
// `ContextMenuRow`, pour que l'appui long donne le même menu sur un deck de la
// galerie et sur la fiche d'un joueur.
//
// LA DOCTRINE DE `@/lib/notify` S'APPLIQUE :
//   décision attendue          -> `Alert.alert` natif (bloquer, choisir un motif)
//   résultat d'un acte voulu   -> `announce` (le signalement est parti)
import type { ContextMenuAction } from '@/components/ui/context-menu';
import { announce, toast } from '@/lib/notify';
import { api, type ReportReason } from '@/lib/supabase/api';
import { useMutation } from '@/lib/supabase/backend';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

/** Des motifs fermés, pas un champ libre : un signalement qu'on ne peut pas
 *  trier ne se traite pas sous 24 h, et c'est ce délai qu'Apple regarde. */
const MOTIFS: { key: string; reason: ReportReason }[] = [
  { key: 'mod_reason_offensive', reason: 'offensive' },
  { key: 'mod_reason_sexual', reason: 'sexual' },
  { key: 'mod_reason_violence', reason: 'violence' },
  { key: 'mod_reason_harassment', reason: 'harassment' },
  { key: 'mod_reason_spam', reason: 'spam' },
  { key: 'mod_reason_other', reason: 'other' },
];

export type ModerationTarget = {
  /** L'auteur, quand on le connaît — c'est lui qu'on bloque. Sans lui, seul le
   *  signalement est proposé : bloquer un fantôme ne protège de rien. */
  authorId?: string | null;
  authorName?: string | null;
  kind: 'deck' | 'profile' | 'capture';
  targetId: string;
};

export type Moderation = {
  /** À poser dans un `ContextMenuRow` : l'appui long d'iOS. */
  actions: ContextMenuAction[];
  /** À câbler sur un bouton VISIBLE. L'appui long est un geste caché ; un
   *  examinateur Apple qui ne le trouve pas conclut qu'il n'y a pas de
   *  signalement, et rejette. Chaque écran qui montre une personne doit donc
   *  offrir les deux chemins. */
  present: () => void;
};

export function useModeration(target: ModerationTarget): Moderation {
  const { t } = useTranslation();
  const report = useMutation(api.moderation.report);
  const block = useMutation(api.moderation.block);
  const nom = target.authorName?.trim() || t('mod_this_player');

  const envoyer = useCallback(
    (reason: ReportReason) => {
      void report({ kind: target.kind, targetId: target.targetId, reason })
        .then(() => announce.done(t('mod_report_sent'), t('mod_report_sent_body')))
        .catch(() => toast.fail(t('mod_report_failed')));
    },
    [report, t, target.kind, target.targetId],
  );

  const choisirMotif = useCallback(() => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          cancelButtonIndex: MOTIFS.length,
          message: t('mod_sheet_message'),
          options: [...MOTIFS.map((motif) => t(motif.key)), t('common_cancel')],
          title: t('mod_report'),
        },
        (index) => {
          const motif = MOTIFS[index];
          if (motif) envoyer(motif.reason);
        },
      );
      return;
    }
    // ponytail: Android n'accepte que trois boutons dans une Alert, et
    // react-native n'a pas de feuille d'actions portable. On garde les trois
    // motifs les plus fréquents ; à remplacer par une vraie feuille le jour où
    // Android est une cible de publication.
    Alert.alert(t('mod_report'), t('mod_sheet_message'), [
      { onPress: () => envoyer('offensive'), text: t('mod_reason_offensive') },
      { onPress: () => envoyer('harassment'), text: t('mod_reason_harassment') },
      { onPress: () => envoyer('other'), text: t('mod_reason_other') },
    ]);
  }, [envoyer, t]);

  const confirmerBlocage = useCallback(() => {
    const authorId = target.authorId;
    if (!authorId) return;
    Alert.alert(
      t('mod_block_title', { name: nom }),
      t('mod_block_body'),
      [
        { style: 'cancel', text: t('common_cancel') },
        {
          onPress: () => {
            void block({ userId: authorId })
              .then(() => announce.done(t('mod_blocked_done')))
              .catch(() => toast.fail(t('mod_block_failed')));
          },
          style: 'destructive',
          text: t('mod_block'),
        },
      ],
    );
  }, [block, nom, t, target.authorId]);

  const present = useCallback(() => {
    const bloquable = Boolean(target.authorId);
    const options = bloquable
      ? [t('mod_report'), t('mod_block'), t('common_cancel')]
      : [t('mod_report'), t('common_cancel')];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: bloquable ? 1 : undefined,
          options,
          title: target.authorName?.trim() || undefined,
        },
        (index) => {
          if (index === 0) choisirMotif();
          else if (bloquable && index === 1) confirmerBlocage();
        },
      );
      return;
    }
    Alert.alert(nom, undefined, [
      { onPress: choisirMotif, text: t('mod_report') },
      ...(bloquable
        ? [{ onPress: confirmerBlocage, style: 'destructive' as const, text: t('mod_block') }]
        : []),
      { style: 'cancel' as const, text: t('common_cancel') },
    ]);
  }, [choisirMotif, confirmerBlocage, nom, t, target.authorId, target.authorName]);

  return useMemo(() => {
    const actions: ContextMenuAction[] = [
      { icon: 'flag', label: t('mod_report'), onPress: choisirMotif },
    ];
    if (target.authorId) {
      actions.push({
        destructive: true,
        icon: 'hand.raised.slash',
        label: t('mod_block'),
        onPress: confirmerBlocage,
      });
    }
    return { actions, present };
  }, [choisirMotif, confirmerBlocage, present, t, target.authorId]);
}
