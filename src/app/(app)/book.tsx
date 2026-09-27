import { useTranslation as useUiTranslation } from 'react-i18next';
// Le Livre — le classeur de ta vie sauvage, tenu comme un vrai livre.
//
// TROIS OBJETS, TROIS RÔLES
//
//   ATLAS   compléter. Une espèce, une entrée, l'état d'aujourd'hui.
//   DECK    montrer. Les cartes qu'on choisit d'exposer.
//   LIVRE   se souvenir. Chronologique, double page, et les cartes y restent
//           DANS L'ÉTAT DE L'ÉPOQUE — la mésange ⭐⭐ d'avril reste ⭐⭐ dans la
//           page d'avril, même si elle est ⭐⭐⭐⭐⭐ aujourd'hui.
//
// UNE PAGE À LA FOIS, PLEIN ÉCRAN
//
// `PageTurner` : chaque feuille pivote sur la tranche du livre, montre son dos
// de papier passé 90°, prend l'ombre pendant le pli, et tirer la couverture
// vers la droite FERME le livre.
//
// La double page a été essayée et abandonnée : c'est la forme d'un livre, mais
// sur un téléphone elle donne deux demi-largeurs, des cartes minuscules et une
// reliure qui mange le milieu. Six poches par page pleine — un mois chargé
// prend plusieurs pages, un février à deux rencontres reste presque vide :
// dans trois ans, ce vide EST l'histoire.
//
// Toute la construction vient de `lib/animals/book.ts`, dérivée des captures :
// aucune table, rien à migrer.
//
// SAFAROLL+ : LE PASSÉ EST LA MATIÈRE PAYANTE
//
// Le mois courant est lisible par tout le monde — c'est le jeu. Les mois
// passés sont la mémoire, et c'est elle que l'abonnement achète. Rien de
// pay-to-win, rien qui touche aux cartes ni aux classements.

import { BookShelf } from '@/components/book/book-shelf';
import { BookMenu } from '@/components/book/book-menu';
import { PageTurner } from '@/components/book/page-turner';
import { cardSceneFor } from '@/components/cards/card-scenes';
import { CARD_RATIO, HoloCard } from '@/components/cards/holo-card';
import {
  buildBook,
  MONTH_NAMES,
  type BookEncounter,
  type BookMilestone,
  type BookMonth,
  type BookYear,
} from '@/lib/animals/book';
import { ProgressToast, type ToastState } from '@/components/ui/progress-toast';
import { announce, toast } from '@/lib/notify';
import { printBook, printingAvailable } from '@/lib/animals/book-pdf';
import { usePremium } from '@/lib/premium';
import { api } from '@/lib/supabase/api';
import { useBackendAuth, useQuery } from '@/lib/supabase/backend';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, Share, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/** Six poches par page — trois colonnes, deux rangées, comme un classeur. */
const POCKETS = 6;
const COLUMNS = 3;
/** Marges internes d'une page ; les poches s'y calent. */
const PAGE_PAD = 20;
const POCKET_GAP = 10;
/** Le jeu entre la carte et son plastique. */
const SLEEVE_INSET = 3;

export default function BookScreen() {
  const { t: copy } = useUiTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useUnistyles();
  const { width: winWidth } = useWindowDimensions();
  const { isAuthenticated } = useBackendAuth();
  const { isPremium } = usePremium();
  const captures = useQuery(api.animals.listCaptures, isAuthenticated ? {} : 'skip');
  const book = useMemo(() => buildBook(captures ?? []), [captures]);

  /**
   * LE TOME SE CHARGE PENDANT QU'ON REGARDE SA COUVERTURE.
   *
   * Une carte tire DEUX images — la planche de l'espèce et l'animal détouré —
   * et une page en porte six. Chargées au fil des pages, elles se peignaient
   * sous les yeux ; chargées toutes au montage de l'écran, elles faisaient
   * ramer l'étagère avant même qu'on choisisse un livre.
   *
   * Le premier appui sur un volume l'amène au centre : entre ce geste et le
   * second, il y a le temps de regarder la couverture. C'est là que tout part,
   * pour CE tome seulement. Au second appui, le livre est en cache.
   *
   * Par paquets de douze plutôt qu'en bloc : le fil reste rendu entre deux, la
   * barre d'avancement avance vraiment, et un tome de trois cents cartes ne
   * lance pas six cents requêtes d'un coup.
   *
   * `memory-disk`, ET C'EST LE POINT. En `disk`, on ne garde que les OCTETS :
   * le décodage se refait à chaque montage de carte, et c'est lui qu'on voyait
   * — pas le téléchargement. Les cartes lisent en `memory-disk`
   * (`holo-card.tsx`), donc le préchargement doit remplir le même cache,
   * sinon il ne sert à rien.
   */
  const [prepared, setPrepared] = useState<Record<number, number>>({});

  const prepare = (target: number) => {
    if (prepared[target] !== undefined) return;
    const urls = new Set<string>();
    for (const capture of captures ?? []) {
      if (new Date(capture.capturedAt).getFullYear() !== target) continue;
      const scene = cardSceneFor(capture.scientificName, capture.rarity, {
        sceneSlug: capture.sceneSlug,
      });
      if (scene) urls.add(scene);
      if (capture.stickerUrl) urls.add(capture.stickerUrl);
    }
    const all = [...urls];
    if (!all.length) {
      setPrepared((current) => ({ ...current, [target]: 1 }));
      return;
    }
    setPrepared((current) => ({ ...current, [target]: 0 }));
    void (async () => {
      for (let at = 0; at < all.length; at += 12) {
        await Image.prefetch(all.slice(at, at + 12), { cachePolicy: 'memory-disk' }).catch(
          () => undefined,
        );
        const done = Math.min(1, (at + 12) / all.length);
        setPrepared((current) => ({ ...current, [target]: done }));
      }
    })();
  };
  const [year, setYear] = useState<number | null>(null);
  /**
   * La page posée. Elle et la SUIVANTE montent leurs cartes.
   *
   * Trois feuilles vivent en même temps, soit dix-huit cartes — dix-huit
   * canevas à allumer pour six qu'on regarde. N'en charger qu'une réglait le
   * coût mais déplaçait l'attente : on tournait la page et on regardait les
   * pochettes se remplir, parce que le chargement ne partait qu'une fois la
   * feuille posée.
   *
   * La suivante se remplit donc pendant qu'on lit la courante — le seul moment
   * où le fil est libre. Deux pages chargées, une seule regardée, et la page
   * d'après est prête avant qu'on la demande. Celle qu'on quitte garde les
   * siennes : elles sont déjà là, les jeter pour les reprendre au retour
   * coûterait deux fois.
   */
  const [current, setCurrent] = useState(0);
  /** Le tome pris en main sur l'étagère — celui dont on montre l'avancement. */
  const [picked, setPicked] = useState<number | null>(null);
  /**
   * L'étagère passe TOUJOURS avant le livre, même à une seule année.
   *
   * Elle sautait quand il n'y avait qu'un volume — logique en apparence, faux
   * en pratique : c'est là que vivent la couverture et le geste de fouille,
   * c'est-à-dire tout ce qui donne au Livre son poids d'objet. Un joueur de
   * première année n'aurait jamais rien vu de tout ça.
   */
  const open = year === null ? null : book.find((entry) => entry.year === year) ?? null;

  // La page occupe l'écran entier sous la barre.
  const pageWidth = winWidth;

  const [goTo, setGoTo] = useState<number | undefined>(undefined);

  /** Le sommaire : la première page de chaque mois du tome. */
  const sections = useMemo(() => {
    if (!open) return [];
    const marks: { label: string; month: number; page: number }[] = [];
    let at = 1; // 0 est la couverture
    for (const month of open.months) {
      const start = at + month.milestones.length;
      marks.push({
        label: `${month.encounters.length} carte${month.encounters.length > 1 ? 's' : ''}`,
        month: month.month,
        page: start,
      });
      at = start + Math.max(1, Math.ceil(month.encounters.length / POCKETS));
    }
    return marks;
  }, [open]);

  const pages = useMemo<ReactNode[]>(() => {
    if (!open) return [];
    const latest = book[0]?.months[book[0].months.length - 1];
    const pageNodes: ReactNode[] = [];
    for (const month of open.months) {
      const locked =
        !isPremium &&
        !(latest && latest.year === month.year && latest.month === month.month);
      for (const milestone of month.milestones) {
        const at = pageNodes.length + 1;
        pageNodes.push(
          <MilestonePage
            active={at === current || at === current + 1}
            encounter={month.encounters.find((e) => e.capture._id === milestone.captureId)}
            key={`jalon-${milestone.key}`}
            locked={locked}
            milestone={milestone}
            month={month}
            width={pageWidth}
          />,
        );
      }
      const sheetsCount = Math.max(1, Math.ceil(month.encounters.length / POCKETS));
      for (let part = 0; part < sheetsCount; part += 1) {
        const at = pageNodes.length + 1;
        pageNodes.push(
          <MonthPage
            active={at === current || at === current + 1}
            encounters={month.encounters.slice(part * POCKETS, (part + 1) * POCKETS)}
            key={`${month.year}-${month.month}-${part}`}
            locked={locked}
            month={month}
            part={part}
            parts={sheetsCount}
            width={pageWidth}
          />,
        );
      }
    }
    return [
      <Cover key="cover" year={open} />,
      ...pageNodes,
      <BackCover key="dos" year={open} />,
    ];
  }, [book, current, isPremium, open, pageWidth]);

  const share = () => {
    if (!open) return;
    void Share.share({
      message:
        `Mon année sauvage ${open.year} sur SafaRoll — ` +
        `${open.encounterCount} rencontres, ${open.speciesDiscovered} espèces découvertes.`,
    }).catch(() => undefined);
  };

  /**
   * Le tome, en PDF.
   *
   * Sur iOS il n'y a pas de « téléchargement » : la feuille de partage EST le
   * téléchargement — « Enregistrer dans Fichiers » y vit. On produit donc le
   * document et on l'y présente, plutôt que d'inventer un dossier à nous que
   * personne ne saurait retrouver.
   */
  /**
   * LA PILULE DIT CE QU'ELLE SAIT, ET RIEN DE PLUS.
   *
   * Composer le tome se fait en deux temps, et un seul se mesure : les
   * planches se comptent, la composition du document non — `printToFileAsync`
   * ne rend la main qu'à la fin. Plutôt qu'inventer un pourcentage pendant la
   * seconde moitié, chaque étape porte son nom et l'anneau s'arrête à ce qui
   * est réellement connu.
   */
  const [progress, setProgress] = useState<ToastState | null>(null);
  const [printing, setPrinting] = useState(false);

  const toPdf = () => {
    if (!open || printing) return;
    if (!printingAvailable) {
      toast.info('Bientôt', 'L’export PDF arrive avec la prochaine version de l’application.');
      return;
    }
    setPrinting(true);
    void (async () => {
      try {
        // 1. Les planches. Le document les charge par leur URL, donc les avoir
        //    en cache évite que l'impression les retélécharge une à une.
        const urls = new Set<string>();
        for (const capture of captures ?? []) {
          if (new Date(capture.capturedAt).getFullYear() !== open.year) continue;
          const scene = cardSceneFor(capture.scientificName, capture.rarity, {
            sceneSlug: capture.sceneSlug,
          });
          if (scene) urls.add(scene);
          if (capture.stickerUrl) urls.add(capture.stickerUrl);
        }
        const all = [...urls];
        for (let at = 0; at < all.length; at += 12) {
          setProgress({
            detail: `${Math.min(at + 12, all.length)} / ${all.length} planches`,
            progress: all.length ? Math.min(1, (at + 12) / all.length) * 0.6 : 0.6,
            title: copy("ui_copy_279"),
          });
          await Image.prefetch(all.slice(at, at + 12), { cachePolicy: 'memory-disk' }).catch(
            () => undefined,
          );
        }

        // 2. La composition. Aucun avancement à lire : l'anneau tient sa
        //    position et l'étape se nomme.
        setProgress({
          detail: `${open.months.length} mois · ${open.encounterCount} cartes`,
          progress: 0.75,
          title: 'Composition du document',
        });
        const uri = await printBook(open);

        setProgress({ done: true, progress: 1, title: copy("ui_copy_280") });
        if (uri && (await Sharing.isAvailableAsync())) {
          await Sharing.shareAsync(uri, { UTI: 'com.adobe.pdf', mimeType: 'application/pdf' });
        }
        setTimeout(() => setProgress(null), 900);
      } catch {
        setProgress(null);
        announce.fail('Export impossible', copy("ui_copy_281"));
      } finally {
        setPrinting(false);
      }
    })();
  };

  const close = () => {
    if (open) {
      setYear(null);
      setCurrent(0);
      setGoTo(undefined);
      setPicked(null);
    } else router.back();
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.bar}>
        <Pressable accessibilityLabel={copy("reveal_close")} hitSlop={14} onPress={close} style={styles.barButton}>
          <SymbolView
            name={open ? 'chevron.left' : 'xmark'}
            size={16}
            tintColor={theme.colors.muted}
            weight="semibold"
          />
        </Pressable>
        <Text style={styles.barTitle}>{open ? `${open.year}` : 'Mes Livres'}</Text>
        <View style={styles.barButton} />
      </View>

      {book.length === 0 ? (
        <View style={styles.empty}>
          <SymbolView name="book.closed.fill" size={44} tintColor={theme.colors.faint} />
          <Text style={styles.emptyTitle}>{copy("ui_copy_148")}</Text>
          <Text style={styles.emptyText}>
            {copy("ui_copy_149")}</Text>
        </View>
      ) : !open ? (
        <BookShelf
          book={book}
          onOpen={setYear}
          onPick={(target) => {
            setPicked(target);
            prepare(target);
          }}
          preparing={picked === null ? null : prepared[picked] ?? null}
        />
      ) : (
        <>
          <PageTurner
            goTo={goTo}
            key={open.year}
            onClosePull={close}
            onPage={setCurrent}
            pages={pages}
          />
          <BookMenu
            onGoTo={setGoTo}
            onPrint={toPdf}
            onShare={share}
            page={current}
            pages={pages.length}
            sections={sections}
            year={open}
          />
        </>
      )}

      <ProgressToast state={progress} />
    </View>
  );
}

/** La couverture : le plat d'encre, l'année, rien d'autre à lire. */
function Cover({ year }: { year: BookYear }) {
  const { t: copy } = useUiTranslation();
  return (
    <View style={styles.cover}>
      <View style={styles.coverRule} />
      <Text style={styles.coverYear}>{year.year}</Text>
      <Text style={styles.coverTitle}>{copy("ui_copy_077")}{'\n'}{copy("ui_copy_078")}</Text>
      <View style={styles.coverRule} />
      <Text style={styles.coverStats}>
        {year.encounterCount} {' '}{copy("ui_copy_150")}{'\n'}{year.speciesDiscovered} {copy("profile_stat_species")}</Text>
      <Text style={styles.coverHint}>{copy("ui_copy_151")}</Text>
    </View>
  );
}

/**
 * LA QUATRIÈME DE COUVERTURE.
 *
 * Quand il n'y a plus de cartes, le livre se FERME — il ne continue pas sur du
 * papier vierge. Le dernier feuillet est donc le dos du volume : même plat
 * d'encre que la couverture, le résumé du tome, les mentions, et le code-barres
 * en pattes qu'un vrai dos porterait.
 *
 * C'est aussi ce qui donne à la pile son épaisseur : on sait qu'on est au bout
 * parce qu'on voit l'objet par-derrière, pas parce que le geste ne répond plus.
 */
function BackCover({ year }: { year: BookYear }) {
  const { t: copy } = useUiTranslation();
  const first = year.months[0];
  const last = year.months[year.months.length - 1];
  const span =
    first && last
      ? first === last
        ? MONTH_NAMES[first.month].toLowerCase()
        : `${MONTH_NAMES[first.month].toLowerCase()} → ${MONTH_NAMES[last.month].toLowerCase()}`
      : '';
  return (
    <View style={styles.back}>
      <View style={styles.backBlurb}>
        <Text style={styles.backQuote}>
          {copy("ui_copy_152")}{'\n'}{copy("ui_copy_153")}{' '}{year.year}. »
        </Text>
        <View style={styles.coverRule} />
        <Text style={styles.backText}>
          {copy('count_encounters', { count: year.encounterCount })} ·{' '}
          {copy('book_species', { count: year.speciesDiscovered })}
          {span ? `\n${span}` : ''}
        </Text>
      </View>

      <View style={styles.backFoot}>
        {/* Le code-barres d'un vrai dos, en pattes plutôt qu'en chiffres. */}
        <View style={styles.barcode}>
          {BARCODE.map((wide, index) => (
            <View key={index} style={[styles.codeBar, wide ? styles.codeBarWide : null]} />
          ))}
        </View>
        <Text style={styles.backImprint}>{copy("ui_copy_156")}{' '}{year.year}</Text>
      </View>
    </View>
  );
}

/** Les barres du code : figées, pas tirées au hasard — un dos ne change pas. */
const BARCODE = [
  true, false, false, true, false, true, true, false, false, false,
  true, false, true, false, false, true, false, true, true, false,
  false, true, false, false, true, true, false, true, false, false,
];

/**
 * LA POCHETTE PLASTIQUE.
 *
 * Ce qui fait lire « classeur de cartes » et pas « grille d'images », c'est le
 * plastique : une pellicule un peu plus claire que la page, un bord net, et un
 * reflet en biais qui prouve qu'il y a une surface entre l'œil et la carte.
 *
 * Le reflet est une simple barre blanche inclinée, coupée par `overflow`. Un
 * dégradé Skia par poche coûterait six canevas par page pour un liseré.
 *
 * La carte est RENTRÉE de deux points : dans un vrai classeur elle flotte dans
 * sa poche, elle n'est pas collée aux bords.
 */
function Sleeve({
  children,
  height,
  width,
}: {
  children?: ReactNode;
  height: number;
  width: number;
}) {
  return (
    <View style={[styles.sleeve, { height, width }]}>
      {children}
      <View pointerEvents="none" style={styles.sleeveSheen} />
      <View pointerEvents="none" style={styles.sleeveLip} />
    </View>
  );
}

function MonthPage({
  active,
  encounters,
  locked,
  month,
  part,
  parts,
  width,
}: {
  active: boolean;
  encounters: BookEncounter[];
  locked: boolean;
  month: BookMonth;
  part: number;
  parts: number;
  width: number;
}) {
  const { t: copy } = useUiTranslation();
  const slot = Math.floor(
    (width - PAGE_PAD * 2 - POCKET_GAP * (COLUMNS - 1) - SLEEVE_INSET * 2 * COLUMNS) / COLUMNS,
  );
  return (
    <View style={styles.page}>
      <View style={styles.pageHead}>
        <Text style={styles.monthName}>
          {MONTH_NAMES[month.month].toUpperCase()}
          {parts > 1 ? ` · ${part + 1}/${parts}` : ''}
        </Text>
        {part === 0 ? (
          <Text style={styles.monthStats}>
            {copy('count_encounters', { count: month.encounters.length })} ·{' '}
            {copy('count_discoveries', { count: month.speciesDiscovered })}
          </Text>
        ) : null}
      </View>

      <View style={[styles.pockets, locked && styles.veiled]}>
        {Array.from({ length: POCKETS }, (_, index) => {
          const encounter = encounters[index];
          const sleeveHeight = slot / CARD_RATIO + SLEEVE_INSET * 2;
          return encounter ? (
            <View key={encounter.capture._id}>
              <Sleeve height={sleeveHeight} width={slot + SLEEVE_INSET * 2}>
                {active ? (
                  <HoloCard
                    data={{ ...encounter.capture, mastery: encounter.mastery }}
                    width={slot}
                  />
                ) : null}
              </Sleeve>
              {encounter.discovery ? (
                <View style={styles.discovery}>
                  <Text style={styles.discoveryText}>{copy("ui_copy_157")}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            // La poche vide montre le fond du classeur à travers son plastique.
            <Sleeve
              height={sleeveHeight}
              key={`poche-${index}`}
              width={slot + SLEEVE_INSET * 2}
            />
          );
        })}
      </View>

      {locked ? <Lock /> : null}
    </View>
  );
}

function MilestonePage({
  active,
  encounter,
  locked,
  milestone,
  month,
  width,
}: {
  active: boolean;
  encounter?: BookEncounter;
  locked: boolean;
  milestone: BookMilestone;
  month: BookMonth;
  width: number;
}) {
  const { theme } = useUnistyles();
  const cardWidth = Math.min(width * 0.46, 190);
  return (
    <View style={styles.page}>
      <View style={[styles.milestoneBody, locked && styles.veiled]}>
        <View style={styles.milestoneSeal}>
          <SymbolView
            name={milestone.icon as SFSymbol}
            size={24}
            tintColor={theme.colors.onPrimary}
          />
        </View>
        <Text style={styles.milestoneTitle}>{milestone.title}</Text>
        {milestone.detail ? <Text style={styles.milestoneDetail}>{milestone.detail}</Text> : null}
        <Text style={styles.milestoneWhen}>
          {MONTH_NAMES[month.month]} {month.year}
        </Text>
        {encounter && active ? (
          <HoloCard
            data={{ ...encounter.capture, mastery: encounter.mastery }}
            width={cardWidth}
          />
        ) : null}
      </View>
      {locked ? <Lock /> : null}
    </View>
  );
}

/** Le voile des mois passés, pour les comptes gratuits. */
function Lock() {
  const { t: copy } = useUiTranslation();
  const router = useRouter();
  const { theme } = useUnistyles();
  return (
    <View pointerEvents="box-none" style={styles.lock}>
      <View style={styles.lockBadge}>
        <SymbolView name="lock.fill" size={17} tintColor={theme.colors.onPrimary} />
      </View>
      <Text style={styles.lockTitle}>{copy("ui_copy_158")}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/paywall')}
        style={({ pressed }) => [styles.lockCta, pressed && styles.pressed]}
      >
        <Text style={styles.lockCtaText}>{copy("ui_copy_159")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  bar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.gap(2),
  },
  barButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  barTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 17,
  },

  empty: {
    alignItems: 'center',
    flex: 1,
    gap: theme.gap(1.5),
    justifyContent: 'center',
    paddingHorizontal: theme.gap(4),
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 24,
    textAlign: 'center',
  },
  emptyText: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },


  // La couverture remplit sa feuille : c'est le plat du livre, pas une page.
  cover: {
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    flex: 1,
    gap: theme.gap(1.5),
    justifyContent: 'center',
    paddingHorizontal: PAGE_PAD,
  },
  coverRule: {
    backgroundColor: theme.colors.onPrimary,
    height: 1,
    opacity: 0.35,
    width: 44,
  },
  coverYear: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.display,
    fontSize: 46,
    letterSpacing: -1,
  },
  coverTitle: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.display,
    fontSize: 19,
    lineHeight: 24,
    textAlign: 'center',
  },
  coverStats: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.medium,
    fontSize: 12,
    lineHeight: 17,
    opacity: 0.8,
    textAlign: 'center',
  },
  coverHint: {
    bottom: 14,
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.medium,
    fontSize: 11,
    opacity: 0.55,
    position: 'absolute',
  },

  back: {
    backgroundColor: theme.colors.primary,
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: theme.gap(4),
    paddingVertical: theme.gap(7),
  },
  backBlurb: {
    alignItems: 'center',
    flex: 1,
    gap: theme.gap(2),
    justifyContent: 'center',
  },
  backQuote: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.display,
    fontSize: 26,
    lineHeight: 34,
    textAlign: 'center',
  },
  backText: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    opacity: 0.7,
    textAlign: 'center',
  },
  backFoot: {
    alignItems: 'center',
    gap: theme.gap(1.5),
  },
  barcode: {
    alignItems: 'flex-end',
    backgroundColor: theme.colors.onPrimary,
    borderRadius: 3,
    flexDirection: 'row',
    gap: 2,
    height: 44,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  codeBar: {
    backgroundColor: theme.colors.primary,
    height: '100%',
    width: 2,
  },
  codeBarWide: { width: 4 },
  backImprint: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.bold,
    fontSize: 9,
    letterSpacing: 1.4,
    opacity: 0.55,
    textAlign: 'center',
  },
  // La page d'un classeur est SOMBRE, et ce n'est pas un caprice : c'est ce
  // qui fait ressortir les cartes. Un feuillet crème les noierait — le foil
  // d'une légendaire a besoin d'un fond qui ne lui dispute rien.
  page: {
    backgroundColor: theme.colors.primary,
    flex: 1,
    paddingHorizontal: PAGE_PAD,
    paddingTop: PAGE_PAD,
  },
  sleeve: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.20)',
    borderCurve: 'continuous',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Le reflet du plastique : une barre claire en biais, coupée par la poche.
  sleeveSheen: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    height: '260%',
    left: '-40%',
    position: 'absolute',
    top: '-80%',
    transform: [{ rotate: '24deg' }],
    width: '34%',
  },
  // L'ouverture de la poche, en haut : le bord replié attrape la lumière.
  sleeveLip: {
    backgroundColor: 'rgba(255,255,255,0.28)',
    height: 1,
    left: 6,
    position: 'absolute',
    right: 6,
    top: 3,
  },
  pageHead: {
    gap: 1,
    paddingBottom: theme.gap(1.25),
  },
  monthName: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.display,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  monthStats: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.regular,
    fontSize: 11,
    opacity: 0.65,
  },
  pockets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: POCKET_GAP,
  },
  discovery: {
    alignSelf: 'center',
    backgroundColor: theme.colors.onPrimary,
    borderRadius: 4,
    marginTop: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  discoveryText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
    fontSize: 7,
    letterSpacing: 0.5,
  },

  milestoneBody: {
    alignItems: 'center',
    flex: 1,
    gap: theme.gap(0.75),
    justifyContent: 'center',
  },
  milestoneSeal: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderCurve: 'continuous',
    borderRadius: 18,
    height: 52,
    justifyContent: 'center',
    marginBottom: theme.gap(0.5),
    width: 52,
  },
  milestoneTitle: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.display,
    fontSize: 18,
    textAlign: 'center',
  },
  milestoneDetail: {
    color: theme.colors.onPrimary,
    opacity: 0.72,
    fontFamily: theme.fonts.medium,
    fontSize: 12,
  },
  milestoneWhen: {
    color: theme.colors.onPrimary,
    opacity: 0.45,
    fontFamily: theme.fonts.regular,
    fontSize: 11,
    marginBottom: theme.gap(1),
  },

  veiled: { opacity: 0.12 },
  // Le verrou porte SA propre plaque : il se pose sur des pages de classeur
  // sombres, où l'encre du thème serait illisible.
  lock: {
    alignItems: 'center',
    backgroundColor: 'rgba(20,15,8,0.55)',
    gap: theme.gap(1),
    justifyContent: 'center',
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: PAGE_PAD,
  },
  lockBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 15,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  lockTitle: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.display,
    fontSize: 15,
    textAlign: 'center',
  },
  lockCta: {
    backgroundColor: theme.colors.onPrimary,
    borderCurve: 'continuous',
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.gap(2),
    paddingVertical: theme.gap(1),
  },
  lockCtaText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
    fontSize: 13,
  },
  pressed: { opacity: 0.85 },
}));
