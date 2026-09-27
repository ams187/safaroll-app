-- L'appelant ne résout que les espèces de ses propres captures. Les politiques
-- RLS existantes couvrent donc toutes les lectures nécessaires ; aucun droit
-- élevé n'est requis pour servir des URL d'un bucket public.
alter function public.scene_slugs(text[]) security invoker;
