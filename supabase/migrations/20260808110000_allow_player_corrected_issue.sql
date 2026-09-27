-- La correction par le joueur n'était pas dans la liste des valeurs permises.
--
-- CE QUI S'EST PASSÉ
--
-- `20260807140000_player_correction_guards.sql` a fait écrire
-- `identification_issue = 'player_corrected'` à `confirm_capture_identification`,
-- pour laisser une trace des cartes que le joueur a corrigées lui-même. Mais la
-- contrainte CHECK posée avec la table n'énumérait que les pannes
-- d'identification ('no_animal_detected', 'low_confidence', …) et n'a jamais
-- été élargie. Résultat : TOUTE correction manuelle échouait au commit, avec
-- une erreur de contrainte que rien dans l'app ne pouvait interpréter.
--
-- La trace est le bon comportement — le jour où la puissance de deck ou les
-- duels arrivent, ils doivent savoir quelles espèces viennent du modèle et
-- lesquelles du joueur. C'est donc la contrainte qu'on élargit, pas la trace
-- qu'on supprime.

alter table public.animal_captures
  drop constraint if exists animal_captures_identification_issue_check;

alter table public.animal_captures
  add constraint animal_captures_identification_issue_check
  check (identification_issue = any (array[
    -- Pannes et refus de l'identification.
    'no_animal_detected',
    'low_confidence',
    'service_unavailable',
    'invalid_image',
    'unsupported_capture',
    -- Pas une panne : le joueur a tranché lui-même parmi les candidats.
    'player_corrected'
  ]));
