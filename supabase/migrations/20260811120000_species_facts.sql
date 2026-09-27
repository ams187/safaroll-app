-- Les faits d'espèce : ce qu'on lit au dos de la carte.
--
-- POURQUOI UNE LISTE ET PAS UN TEXTE
--
-- Le dos de carte n'a pas la place d'un paragraphe, et le premier fait doit
-- pouvoir vivre seul — c'est celui que tout le monde voit. Les suivants sont
-- réservés aux Naturalistes. Un seul champ texte obligerait à redécouper à
-- l'affichage, et un découpage sur les points casse « 15 cm. » et « M. ».
-- La liste est donc découpée UNE fois, à la source, par le script qui la
-- fabrique.
--
-- D'OÙ VIENT LE TEXTE
--
-- `scripts/build-species-descriptions.ts` : Wikidata donne le titre localisé,
-- Wikipédia l'article, un filtre garde les phrases qui décrivent l'animal —
-- pas ses mensurations, pas son élevage, pas sa démographie. Les phrases sont
-- reprises MOT POUR MOT, jamais réécrites : une sélection de citations est une
-- collection au sens de CC BY-SA, pas une œuvre dérivée, donc la clause de
-- partage à l'identique ne contamine rien.
--
-- En échange, l'attribution est obligatoire. `facts_source_url` n'est pas
-- décoratif : sans lui, l'affichage est en infraction.

alter table public.species_catalog
  add column if not exists facts jsonb,
  add column if not exists facts_source_url text;

comment on column public.species_catalog.facts is
  'Phrases descriptives citées de Wikipédia, la plus parlante en premier. Voir scripts/build-species-descriptions.ts.';

comment on column public.species_catalog.facts_source_url is
  'Article source. OBLIGATOIRE à l''affichage : CC BY-SA impose le lien + la mention de licence.';
