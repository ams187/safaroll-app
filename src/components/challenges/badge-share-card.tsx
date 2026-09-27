// Le partage d'une distinction.
//
// C'est `useTresorShare` de Bloom, porté sur les écussons.
//
// POURQUOI ON NE PARTAGE PAS LE PNG NU
//
// L'illustration est un détourage sur fond transparent. Envoyée telle quelle,
// elle tombe en noir chez celui qui est en thème sombre et en blanc chez les
// autres, sans titre ni contexte : personne ne sait ce que c'est. On compose
// donc une vraie carte, peinte en Skia hors écran puis capturée.
//
// AUCUNE DÉPENDANCE AJOUTÉE
//
// Skia et `expo-file-system` sont déjà là. `makeImageSnapshotAsync` rend les
// octets, `File` les écrit dans le cache, `Share` prend l'URI.
//
// LA CARTE DOIT ÊTRE PEINTE POUR ÊTRE CAPTURÉE
//
// Elle est donc montée dans l'écran, aux vraies dimensions, mais à opacité
// nulle et sans toucher : hors champ, la couche de composition peut décider de
// ne rien dessiner du tout, et la capture rendrait une image vide.

import {
  Canvas,
  Image as SkiaImage,
  Rect,
  RoundedRect,
  Text as SkiaText,
  useCanvasRef,
  useFont,
  useImage,
} from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Share, StyleSheet } from 'react-native';

import { badgeArt } from '@/lib/animals/badge-art';
import type { BadgeState } from '@/lib/animals/badges';

const DISPLAY = require('../../../assets/fonts/ExposureTrial-0.otf');
const BODY = require('../../../assets/fonts/Satoshi-Medium.otf');

/** Format portrait pour les réseaux. La hauteur tient un texte sur trois lignes. */
const W = 320;
const H = 440;

const ART = 176;
const ART_Y = 56;

const TITRE = 30;
const TEXTE = 14;
const MARQUE = 11;

const TITRE_Y = 288;
const LARGEUR_TITRE = 268;
const LARGEUR_TEXTE = 244;
const TITRE_INTERLIGNE = 34;
const TEXTE_INTERLIGNE = 20;

const CREME = '#FFFBF0';
const ENCRE = '#2B2418';

/** Découpe en lignes qui tiennent dans la largeur, mesurées à la vraie police. */
function enLignes(
  texte: string,
  font: { measureText: (t: string) => { width: number } },
  largeur: number,
) {
  const lignes: string[] = [];
  let courante = '';
  for (const mot of texte.split(' ')) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (font.measureText(essai).width > largeur && courante) {
      lignes.push(courante);
      courante = mot;
    } else {
      courante = essai;
    }
  }
  if (courante) lignes.push(courante);
  return lignes;
}

export type ShareTarget = { badge: BadgeState; description: string; fond: string };

export function useBadgeShare(): {
  readonly carte: ReactNode;
  readonly partager: (target: ShareTarget) => void;
} {
  const ref = useCanvasRef();
  const [cible, setCible] = useState<ShareTarget | null>(null);

  const fontTitre = useFont(DISPLAY, TITRE);
  const fontTexte = useFont(BODY, TEXTE);
  const fontMarque = useFont(BODY, MARQUE);
  const art = useImage(cible ? (badgeArt(cible.badge.key) ?? null) : null);

  const partager = useCallback((target: ShareTarget) => setCible(target), []);

  useEffect(() => {
    if (!cible || !art || !fontTitre || !fontTexte || !fontMarque) return;

    let annule = false;
    // Une frame pour laisser Skia peindre avant de capturer.
    const minuteur = setTimeout(async () => {
      try {
        const capture = await ref.current?.makeImageSnapshotAsync();
        if (!capture) throw new Error('la carte ne s’est pas peinte à temps');
        if (annule) return;

        const fichier = new File(Paths.cache, `safaroll-${cible.badge.key}.png`);
        if (fichier.exists) fichier.delete();
        fichier.create();
        fichier.write(capture.encodeToBytes());

        await Share.share({
          message: `${cible.badge.label} — ${cible.description}`,
          url: fichier.uri,
        });
      } catch (erreur) {
        // Ne jamais rester muet : un partage qui échoue sans trace est indébogable.
        console.warn('[SafaRoll] partage de la distinction impossible :', erreur);
      } finally {
        if (!annule) setCible(null);
      }
    }, 80);

    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [art, cible, fontMarque, fontTexte, fontTitre, ref]);

  const pret = cible && fontTitre && fontTexte && fontMarque;

  const lignesTitre = pret ? enLignes(cible.badge.label, fontTitre, LARGEUR_TITRE).slice(0, 2) : [];
  const lignesTexte = pret ? enLignes(cible.description, fontTexte, LARGEUR_TEXTE).slice(0, 3) : [];
  const debutTexte = TITRE_Y + lignesTitre.length * TITRE_INTERLIGNE + 4;

  const carte = pret ? (
    <Canvas ref={ref} style={styles.horsChamp}>
      <Rect color={ENCRE} height={H} width={W} x={0} y={0} />
      {/* Le disque de la famille derrière l'écusson : c'est lui qui donne sa
          couleur à la carte, donc deux distinctions partagées ne se ressemblent
          pas. */}
      <RoundedRect color={cible.fond} height={ART + 40} r={28} width={W - 40} x={20} y={ART_Y - 20} />
      <SkiaImage
        fit="contain"
        height={ART}
        image={art}
        width={ART}
        x={(W - ART) / 2}
        y={ART_Y}
      />

      {lignesTitre.map((ligne, index) => (
        <SkiaText
          color={CREME}
          font={fontTitre}
          key={ligne}
          text={ligne}
          x={(W - fontTitre.measureText(ligne).width) / 2}
          y={TITRE_Y + index * TITRE_INTERLIGNE}
        />
      ))}

      {lignesTexte.map((ligne, index) => (
        <SkiaText
          color={CREME}
          font={fontTexte}
          key={ligne}
          opacity={0.75}
          text={ligne}
          x={(W - fontTexte.measureText(ligne).width) / 2}
          y={debutTexte + index * TEXTE_INTERLIGNE}
        />
      ))}

      <SkiaText
        color={CREME}
        font={fontMarque}
        opacity={0.55}
        text="S A F A R O L L"
        x={(W - fontMarque.measureText('S A F A R O L L').width) / 2}
        y={H - 24}
      />
    </Canvas>
  ) : null;

  return { carte, partager };
}

const styles = StyleSheet.create({
  horsChamp: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: W,
    height: H,
    opacity: 0,
    pointerEvents: 'none',
  },
});
