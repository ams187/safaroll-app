-- CE QUE LES MOTEURS DE NOTIFICATION ONT BESOIN DE SAVOIR, CALCULÉ EN BASE.
--
-- LE DÉFAUT QUE ÇA RÉPARE
--
-- `dawn-chorus` et `after-rain` rapatriaient les 2 000 dernières captures pour
-- en déduire, en JavaScript, la position de chaque joueur et les espèces qu'il
-- possède déjà. Trois problèmes, tous invisibles à dix joueurs :
--
--   1. la limite tronque — au-delà de 2 000 captures, les joueurs les moins
--      actifs disparaissent de la liste et cessent d'être notifiés, sans que
--      rien ne le signale ;
--   2. le volume transféré croît avec l'app entière, pas avec le nombre de
--      destinataires ;
--   3. deux fonctions refaisaient le même calcul, et pouvaient diverger.
--
-- Postgres sait faire ça mieux : un DISTINCT ON par utilisateur rend la
-- dernière position en un balayage d'index, sans transférer une seule capture
-- inutile.

create or replace view public.notification_targets
with (security_invoker = true) as
select
  c.user_id,
  -- La dernière position connue. On ne demande jamais la position au joueur :
  -- on se sert de là où il a DÉJÀ photographié, qui est aussi l'endroit où il
  -- recommencera.
  (array_agg(c.latitude order by c.captured_at desc))[1]  as latitude,
  (array_agg(c.longitude order by c.captured_at desc))[1] as longitude,
  max(c.captured_at)                                      as last_capture_at,
  -- Les espèces déjà obtenues : ce qu'il ne faut PAS lui proposer.
  -- `array_remove` plutôt que `filter` : Postgres refuse de combiner DISTINCT
  -- et FILTER dans un même agrégat. Le NULL que DISTINCT laisse passer se
  -- retire après coup, ce qui revient au même et compile.
  array_remove(array_agg(distinct c.scientific_name), null) as owned_species,
  p.region
from public.animal_captures c
left join public.profiles p on p.user_id = c.user_id
where c.latitude is not null
  and c.status in ('ready', 'needs_review')
group by c.user_id, p.region;

comment on view public.notification_targets is
  'Position, dernière capture et espèces possédées par joueur. Alimente dawn-chorus et after-rain.';

-- `security_invoker` : la vue s'exécute avec les droits de l'appelant, donc le
-- RLS de `animal_captures` s'applique. Un client authentifié n'y verrait que ses
-- propres lignes ; seules les fonctions serveur, avec la clé de service, voient
-- l'ensemble. Sans cette option, la vue contournerait le RLS pour tout le monde.
