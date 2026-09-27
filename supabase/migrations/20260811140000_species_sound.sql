-- Le cri de l'animal : une URL, jamais les octets.
--
-- LA LIGNE EST PARTAGÉE, C'EST TOUT L'INTÉRÊT
--
-- iNaturalist accepte 100 requêtes/minute pour l'application ENTIÈRE, pas par
-- joueur. Si chaque téléphone cherchait lui-même, mille joueurs ouvrant une
-- mésange le même soir feraient mille requêtes et l'app serait coupée — et
-- couper une association qui héberge gratuitement serait mérité.
--
-- Donc le premier joueur qui ouvre une espèce paie la recherche, écrit la
-- ligne, et tous les suivants la lisent. Une requête, jamais mille.
--
-- ON NE STOCKE PAS LES FICHIERS
--
-- 264 espèces sonores × ~500 ko ≈ 130 Mo qui grandissent à chaque expansion du
-- catalogue, pour un gain nul : le fichier se télécharge une fois sur le
-- téléphone et y reste en cache. Ici on ne garde que l'adresse, ~150 octets.
--
-- POURQUOI `sound_checked_at` EXISTE SÉPARÉMENT DE `sound_url`
--
-- Sept espèces sur dix n'ont aucun enregistrement — les poissons, les reptiles
-- et les mollusques n'en ont aucun. Sans cette colonne, « pas encore cherché »
-- et « cherché, rien trouvé » sont le même NULL, et on relancerait la recherche
-- à chaque ouverture de fiche pour les 620 espèces muettes. La date tranche.
--
-- Elle sert aussi de péremption : une URL peut mourir si l'observation est
-- supprimée chez iNaturalist. Au 404 le client redemande, la fonction relance
-- la recherche et met la ligne à jour. La base se répare toute seule.

alter table public.species_catalog
  add column if not exists sound_url text,
  add column if not exists sound_credit text,
  add column if not exists sound_license text,
  add column if not exists sound_source_url text,
  add column if not exists sound_checked_at timestamptz;

comment on column public.species_catalog.sound_url is
  'Fichier audio distant. NULL avec sound_checked_at renseigné = espèce muette, ne plus chercher.';

comment on column public.species_catalog.sound_credit is
  'Nom de l''enregistreur. OBLIGATOIRE à l''affichage : les licences CC-BY imposent de le citer.';

comment on column public.species_catalog.sound_license is
  'Code de licence (cc-by, cc-by-sa, cc0). Seules les licences libres sont retenues à la collecte.';

comment on column public.species_catalog.sound_source_url is
  'Page de l''observation. Le lien de retour vers la source, exigé par CC-BY.';

comment on column public.species_catalog.sound_checked_at is
  'Date de la dernière recherche. Distingue « jamais cherché » de « cherché, rien trouvé ».';

-- Les colonnes suivent les règles de lecture déjà posées sur species_catalog :
-- le catalogue est public en lecture, et aucune policy d'écriture n'existe. La
-- fonction edge écrit avec `service_role`, qui les contourne. Un joueur capable
-- d'écrire l'URL pourrait faire jouer n'importe quel fichier à tous les autres.
