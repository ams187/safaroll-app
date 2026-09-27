-- Les noms d'une espèce, dans toutes les langues qu'on pourrait servir un jour.
--
-- Jusqu'ici deux colonnes fixes : `common_name` (anglais) et
-- `common_name_locale` (français). Ça marche tant que l'app ne parle que ces
-- deux langues. Le jour où elle en ouvre une troisième, il faut une colonne de
-- plus, une migration, ET une reprise de toutes les lignes existantes — parce
-- que le nom est figé à l'identification, pas relu à l'affichage.
--
-- Donc une carte par langue, écrite une seule fois. Ouvrir l'espagnol ou le
-- japonais devient un changement de client, sans toucher aux données.
--
-- Pourquoi ne pas tout garder : GBIF rend jusqu'à 107 langues pour une espèce
-- connue. En stocker autant sur CHAQUE capture pèserait pour des langues que
-- personne ne lira. L'edge function se limite aux grandes langues de diffusion
-- — voir `VERNACULAR_LANGUAGES` — ce qui tient en moins d'un kilo-octet.
--
-- Les deux colonnes d'origine restent : elles sont le repli quand la carte est
-- vide, et tout ce qui existe déjà les remplit.
alter table public.animal_captures
  add column if not exists vernaculars jsonb not null default '{}'::jsonb;

alter table public.species_catalog
  add column if not exists vernaculars jsonb not null default '{}'::jsonb;

comment on column public.animal_captures.vernaculars is
  'Noms courants par code ISO 639-1, ex. {"fr":"Lion","es":"León"}. Figé à l''identification.';
comment on column public.species_catalog.vernaculars is
  'Noms courants par code ISO 639-1. Source de vérité quand l''espèce est au catalogue.';
