-- Où le joueur se situe, à l'échelle du pays.
--
-- Jusqu'ici : `species_seasons` n'avait qu'une région (`FR`), personne ne la
-- demandait, et le backend retombait sur un défaut codé en dur. Tout joueur,
-- où qu'il soit, recevait la saisonnalité française.
--
-- La colonne est nullable et le reste : ne pas répondre est un état valide,
-- pas un trou à combler. `resolveRegion` retombe alors sur la région de
-- l'appareil, qui ne coûte aucune permission.
--
-- `declined` est stocké tel quel plutôt qu'un NULL : « j'ai refusé » et « on ne
-- m'a pas encore demandé » ne se traitent pas pareil — le second se redemande,
-- le premier jamais.
alter table public.profiles
  add column if not exists region text
  check (region is null or region = 'declined' or region ~ '^[A-Z]{2}$');

comment on column public.profiles.region is
  'Code ISO 3166-1 alpha-2 déclaré à l''onboarding, ou ''declined''. NULL = jamais demandé.';
