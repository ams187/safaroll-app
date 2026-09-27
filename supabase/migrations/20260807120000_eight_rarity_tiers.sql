-- L'échelle de rareté passe de cinq paliers à huit.
--
-- POURQUOI
--
-- Cinq ne séparaient plus rien sur un catalogue de 5 693 espèces réparties sur
-- cinq décades d'observations mondiales : lion, guépard, zèbre et éléphant
-- d'Afrique tombaient au même palier que le tigre et la girafe, panda géant et
-- panthère des neiges aussi. Et le haut de l'échelle — celui qu'un joueur
-- convoite — n'avait que deux crans au-dessus de « rare ».
--
-- Huit est le nombre de décades naturelles de la distribution GBIF, et celui du
-- TCG moderne (Common → Hyper Rare). Les trois nouveaux paliers s'insèrent sans
-- déplacer les anciens :
--
--   commun      ≥ 1 000 000
--   peu commun  ≥   200 000
--   rare        ≥    50 000
--   très rare   ≥    10 000   ← nouveau
--   ultra rare  ≥     3 000
--   épique      ≥     1 000   ← nouveau
--   mythique    ≥       300   ← nouveau
--   légendaire  ≥         0
--
-- Les seuils vivent dans `supabase/functions/_shared/species-rarity.ts`, lu par
-- l'app ET par l'edge function. Cette contrainte ne fait qu'autoriser les
-- valeurs ; elle ne les décide pas.
--
-- Les raretés déjà en base restent valides : aucun nom n'est retiré, trois sont
-- ajoutés. `scripts/recompute-rarity.ts` les redistribue ensuite.

alter table public.species_catalog drop constraint if exists species_catalog_rarity_check;
alter table public.species_catalog add constraint species_catalog_rarity_check
  check (rarity in (
    'common', 'uncommon', 'rare', 'very_rare', 'ultra_rare', 'epic', 'mythic', 'legendary'
  ));

alter table public.animal_captures drop constraint if exists animal_captures_rarity_check;
alter table public.animal_captures add constraint animal_captures_rarity_check
  check (rarity in (
    'common', 'uncommon', 'rare', 'very_rare', 'ultra_rare', 'epic', 'mythic', 'legendary'
  ));
