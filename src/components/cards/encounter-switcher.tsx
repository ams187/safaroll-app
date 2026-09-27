// LES AUTRES RENCONTRES D'UNE MÊME ESPÈCE.
//
// La grille n'affiche qu'une carte par espèce, et rien dans la v1 ne laissait
// atteindre les autres stickers : le Livre, qui les liste, est coupé
// (`LIVRE_ACTIF`). Épingler un sticker ne servait donc qu'à figer la dernière.
// Ce panneau ouvre l'accès qui manquait.
//
// LA FEUILLE NE MONTRE QUE DES VIGNETTES.
//
// Elle a porté un grand aperçu en tête, et c'était un doublon : la carte est
// juste au-dessus, à l'écran, et c'est ELLE qu'on est en train de changer. On
// regardait deux animaux, et le mauvais bougeait. Le morph gluant vit donc
// maintenant sur la carte (`card-sticker-morph`) ; ici il ne reste que le
// choix — des vignettes, et le geste qui tranche.
//
// LE PANNEAU NE CHOISIT RIEN TOUT SEUL
//
// Regarder n'est pas décider. On peut faire défiler ses trois perruches sans
// rien changer ; seul « Choisir ce sticker » épingle. Sans cette séparation,
// une simple curiosité repeindrait la collection.

import {
  getPinnedCaptureId,
  setPinnedCapture,
  speciesKey,
  usePinnedCapture,
} from '@/lib/animals/pinned-capture';
import { toast } from '@/lib/notify';
import { api } from '@/lib/supabase/api';
import { useMutation } from '@/lib/supabase/backend';
import { Image as ExpoImage } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native-unistyles';

export type Rencontre = {
  _id?: string;
  capturedAt?: number;
  scientificName?: string;
  commonName?: string;
  stickerUrl: string | null;
  stickerThumbUrl?: string;
};

/** La vignette : le thumb s'il existe, sinon le sticker plein. */
function vignette(r: Rencontre) {
  return r.stickerThumbUrl ?? r.stickerUrl ?? null;
}

export function EncounterSwitcher({
  onApercu,
  onClose,
  rencontres,
}: {
  /**
   * L'image pleine de la rencontre visée. La carte, au-dessus, s'en sert pour
   * jouer le morph — c'est le SEUL retour visuel du choix en cours.
   *
   * Le sticker plein et non la vignette : la carte dessine le plein, et deux
   * résolutions différentes se verraient au raccord de fin d'animation.
   */
  onApercu: (uri: string) => void;
  onClose: () => void;
  /** Déjà filtrées sur une seule espèce, plus récente en tête. */
  rencontres: Rencontre[];
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [suppression, setSuppression] = useState(false);
  const [cibleAConfirmer, setCibleAConfirmer] = useState<string | null>(null);
  const supprimerCapture = useMutation(api.animals.deleteCapture);

  // L'INDEX EST BORNÉ, PARCE QUE LA LISTE PEUT RÉTRÉCIR SOUS LUI.
  //
  // Supprimer la dernière vignette laisse un index au-delà du tableau, et le
  // rendu suivant lirait `undefined` — bouton mort, aperçu figé. On regarde
  // donc toujours la position VALIDE la plus proche : après une suppression,
  // c'est la rencontre qui vient de prendre la place, ou la précédente si on
  // était en bout de bande.
  const position = Math.min(index, Math.max(0, rencontres.length - 1));
  const espece = rencontres[0] ? speciesKey(rencontres[0]) : null;
  const courante = rencontres[position];
  const { epingle } = usePinnedCapture(espece, courante?._id ?? null);

  /**
   * UN SEUL ENDROIT DÉCLENCHE L'APERÇU, ET C'EST CE QUI ÉVITE LE DOUBLE MORPH.
   *
   * Prévenir la carte depuis `choisir` ET depuis un effet la faisait basculer
   * deux fois pour un seul tap : le morph partait puis revenait. On observe
   * donc la rencontre RÉELLEMENT regardée, quelle que soit la raison pour
   * laquelle elle a changé — un tap, ou une suppression qui a décalé la bande.
   *
   * Le premier passage ne prévient personne : le parent a déjà armé le morph
   * sur le sticker en place à l'ouverture, et le rejouer ici ferait clignoter
   * la carte pour rien.
   */
  const dernierApercu = useRef<string | null>(null);
  useEffect(() => {
    const id = courante?._id ? String(courante._id) : null;
    if (!id || dernierApercu.current === id) return;
    const premier = dernierApercu.current === null;
    dernierApercu.current = id;
    if (premier) return;
    const pleine = courante?.stickerUrl ?? courante?.stickerThumbUrl;
    if (pleine) onApercu(pleine);
  }, [courante, onApercu]);

  const choisir = (suivant: number) => {
    setCibleAConfirmer(null);
    setIndex(suivant);
  };

  /**
   * SUPPRIMER UNE RENCONTRE, PAS LA CARTE.
   *
   * Le menu de la carte a déjà une suppression, et elle brûle : elle détruit
   * l'ESPÈCE dans la collection, cérémonie comprise. Ici on retire un doublon —
   * la carte reste, elle changera juste de visage. Deux gestes différents, deux
   * poids différents ; leur donner la même mise en scène brouillerait lequel
   * est irréversible pour la collection.
   *
   * LE DERNIER STICKER NE PEUT PAS PARTIR D'ICI. Le panneau ne s'ouvre qu'à
   * partir de deux rencontres, et le bouton se retire dès qu'il n'en reste
   * qu'une : vider une espèce depuis un sélecteur de stickers serait une
   * suppression de carte déguisée, sans l'alerte qui va avec.
   */
  const demanderSuppression = () => {
    if (!courante?._id || rencontres.length < 2 || suppression) return;
    setCibleAConfirmer(String(courante._id));
  };

  const executerSuppression = async (cible: string) => {
    setSuppression(true);
    try {
      await supprimerCapture({ id: cible });
      // UNE ÉPINGLE QUI DÉSIGNE UN MORT NE DÉSIGNE PLUS RIEN, et elle survivrait
      // à la capture dans MMKV. La grille retomberait silencieusement sur la
      // plus récente — le bon rendu, par accident. On la retire pour de vrai,
      // et seulement APRÈS la réussite du serveur : une suppression refusée ne
      // doit pas avoir défait le choix de l'utilisateur.
      if (espece && getPinnedCaptureId(espece) === cible) setPinnedCapture(espece, null);
      toast.done(t('encounters_deleted'));
    } catch {
      toast.fail(t('encounters_delete_failed'));
    } finally {
      setSuppression(false);
      setCibleAConfirmer(null);
    }
  };

  return (
    <View style={styles.panneau}>
      <Text style={styles.titre}>{t('encounters_title', { count: rencontres.length })}</Text>

      <ScrollView
        contentContainerStyle={styles.bandeContenu}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bande}
      >
        {rencontres.map((r, i) => {
          const url = vignette(r);
          return (
            <Pressable key={r._id ?? i} onPress={() => choisir(i)} style={styles.vignette}>
              {url ? (
                <ExpoImage
                  cachePolicy="memory-disk"
                  contentFit="contain"
                  source={{ uri: url }}
                  style={[styles.image, i === position && styles.imageActive]}
                />
              ) : (
                <View style={[styles.image, styles.imageVide]} />
              )}
              <Text style={styles.date}>
                {r.capturedAt ? new Date(r.capturedAt).toLocaleDateString() : '—'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* DÉJÀ CHOISIE : UN ÉTAT, PAS UN GESTE.
          Le bouton a proposé « Ne plus choisir ce sticker », et ça ne voulait
          rien dire : une espèce montre TOUJOURS un sticker. Retirer le choix
          n'aurait rendu la case à personne — le geste inverse, c'est d'en
          choisir une autre, et il se fait en tapant une autre vignette. Quand
          on regarde celle qui est déjà en place, il n'y a donc rien à presser :
          on le dit, et on s'arrête là. */}
      <View style={styles.actions}>
        {cibleAConfirmer === String(courante?._id ?? '') ? (
          <>
            <Pressable
              disabled={suppression}
              onPress={() => setCibleAConfirmer(null)}
              style={({ pressed }) => [styles.valider, styles.annuler, pressed && styles.presse]}
            >
              <Text style={styles.validerTexte}>{t('encounters_delete_cancel')}</Text>
            </Pressable>
            <Pressable
              disabled={suppression}
              onPress={() => void executerSuppression(cibleAConfirmer)}
              style={({ pressed }) => [styles.valider, styles.confirmer, pressed && styles.presse]}
            >
              {suppression ? (
                <ActivityIndicator color="#a3391f" size="small" />
              ) : (
                <Text style={styles.confirmerTexte}>{t('card_menu_delete')}</Text>
              )}
            </Pressable>
          </>
        ) : epingle ? (
          <View style={[styles.valider, styles.validee]}>
            <SymbolView name="checkmark" size={15} tintColor="#2b2418" weight="bold" />
            <Text style={styles.validerTexte}>{t('card_selected')}</Text>
          </View>
        ) : (
          <Pressable
            disabled={suppression}
            onPress={() => {
              if (!espece || !courante?._id) return;
              setPinnedCapture(espece, courante._id);
              toast.done(t('card_pinned'));
              onClose();
            }}
            style={({ pressed }) => [styles.valider, pressed && styles.presse]}
          >
            <SymbolView name="checkmark.circle" size={15} tintColor="#2b2418" weight="bold" />
            <Text style={styles.validerTexte}>{t('card_menu_pin')}</Text>
          </Pressable>
        )}

        {/* LA CORBEILLE EST À CÔTÉ, PAS SUR LA VIGNETTE.
            Posée sur chaque miniature, elle transformait une bande qu'on
            parcourt du doigt en champ de mines : 84 pt de large, on vise une
            vignette et on détruit la voisine. Ici elle agit sur celle qu'on
            REGARDE — la même que le bouton d'à côté — donc on sait toujours ce
            qu'on supprime, et elle disparaît quand il ne reste plus qu'une
            rencontre à protéger. */}
        {rencontres.length > 1 && cibleAConfirmer !== String(courante?._id ?? '') ? (
          <Pressable
            accessibilityLabel={t('card_menu_delete')}
            accessibilityRole="button"
            disabled={suppression}
            onPress={demanderSuppression}
            style={({ pressed }) => [styles.jeter, pressed && styles.presse]}
          >
            {suppression ? (
              <ActivityIndicator color="#a3391f" size="small" />
            ) : (
              <SymbolView name="trash" size={17} tintColor="#a3391f" weight="semibold" />
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  panneau: {
    backgroundColor: theme.colors.surface,
    borderRadius: 22,
    gap: theme.gap(1.25),
    padding: theme.gap(2),
  },
  titre: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 15 },
  bande: { marginHorizontal: -theme.gap(2) },
  bandeContenu: { gap: theme.gap(1), paddingHorizontal: theme.gap(2) },
  vignette: { alignItems: 'center', gap: 5, width: 84 },
  image: { borderRadius: 14, height: 84, width: 84 },
  imageActive: { borderColor: theme.colors.primary, borderWidth: 2 },
  imageVide: { backgroundColor: theme.colors.surfaceMuted },
  date: { color: theme.colors.muted, fontFamily: theme.fonts.medium, fontSize: 11 },
  actions: { alignItems: 'stretch', flexDirection: 'row', gap: theme.gap(1) },
  jeter: {
    alignItems: 'center',
    // Un carré, pas une seconde pilule : deux boutons de même poids se
    // disputeraient le regard, et le geste principal est de CHOISIR.
    aspectRatio: 1,
    backgroundColor: 'rgba(163, 57, 31, 0.12)',
    borderRadius: 14,
    justifyContent: 'center',
  },
  valider: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#EED28B',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  validerTexte: { color: '#2b2418', fontFamily: theme.fonts.bold, fontSize: 14 },
  annuler: { backgroundColor: theme.colors.surfaceMuted },
  confirmer: { backgroundColor: 'rgba(163, 57, 31, 0.12)' },
  confirmerTexte: { color: '#a3391f', fontFamily: theme.fonts.bold, fontSize: 14 },
  presse: { opacity: 0.7 },
  // Posé, pas éteint : c'est une confirmation, pas un bouton désactivé.
  validee: { opacity: 0.55 },
}));
