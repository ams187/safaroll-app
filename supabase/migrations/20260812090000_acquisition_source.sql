-- D'où vient le joueur, demandé une fois à la fin de l'onboarding.
--
-- Une colonne libre et nullable plutôt qu'un enum : la liste des canaux change
-- au rythme du marketing, et une migration par réseau social n'a pas de sens.
-- `null` couvre les deux cas qui se ressemblent sans être pareils — le joueur
-- a sauté l'écran, ou il s'est inscrit avant que l'écran existe.

alter table public.profiles
  add column if not exists acquisition_source text;

comment on column public.profiles.acquisition_source is
  'Canal déclaré à l''onboarding (app_store, tiktok, instagram, friend, x, other). Null si sauté.';
