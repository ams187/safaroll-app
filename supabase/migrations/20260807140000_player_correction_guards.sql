-- Corriger une identification depuis la carte, sans en faire une machine à
-- fabriquer des légendaires.
--
-- LE BESOIN
--
-- Le modèle se trompe en étant sûr de lui. Sur un paresseux à crinière il a
-- rendu « paresseux à trois doigts » à 55 % contre 14 % au bon : écart bien
-- trop large pour déclencher la relecture. La correction n'existait que tant
-- que la capture était en `needs_review` — une fois la carte posée, plus aucun
-- recours. Ce verrou saute ici.
--
-- LE RISQUE QUE ÇA OUVRE
--
-- Si un joueur peut choisir l'espèce, il peut choisir la plus rare de la liste
-- sans l'avoir photographiée. Trois garde-fous, tous côté serveur — un contrôle
-- côté écran ne protège de rien :
--
--   1. LE CHOIX RESTE DANS LA LISTE DU MODÈLE. Déjà vrai, et c'est la barrière
--      principale : on ne peut réclamer qu'une espèce que le modèle a vue dans
--      CETTE photo, pas un légendaire arbitraire.
--
--   2. UN PLANCHER DE CONFIANCE. Le candidat doit peser au moins 5 %, et au
--      moins un cinquième du premier. Sans lui, on pouvait viser le 5ᵉ à 3 %
--      uniquement parce qu'il était légendaire. Avec, il faut que le modèle
--      ait vraiment hésité — ce qui est le cas quand il se trompe.
--
--   3. LA CORRECTION LAISSE UNE TRACE. `identification_issue` passe à
--      'player_corrected'. Le classement compte aujourd'hui les captures et
--      non la rareté, donc rien n'est faussé pour l'instant ; le jour où la
--      puissance de deck ou les duels arrivent, ils sauront quoi croire.
--
-- Ce qui reste possible : photographier un paresseux commun et réclamer le
-- légendaire de la même famille. Aucune règle serveur ne peut trancher — seule
-- la photo le dirait. La trace est là pour ça.

create or replace function public.confirm_capture_identification(
  target_capture_id uuid,
  target_scientific_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  candidate jsonb;
  best_confidence double precision;
  chosen_confidence double precision;
  entry public.species_catalog%rowtype;
  atlas_match boolean;
begin
  -- `ready` accepté en plus de `needs_review` : c'est tout l'objet de cette
  -- migration. Une carte posée reste corrigeable.
  select value into candidate
  from public.animal_captures c, jsonb_array_elements(c.candidates) value
  where c.id = target_capture_id and c.user_id = uid
    and c.status in ('ready', 'needs_review')
    and value->>'scientificName' = target_scientific_name
  limit 1;
  if candidate is null then raise exception 'Invalid candidate'; end if;

  select max((value->>'confidence')::double precision) into best_confidence
  from public.animal_captures c, jsonb_array_elements(c.candidates) value
  where c.id = target_capture_id and c.user_id = uid;

  chosen_confidence := (candidate->>'confidence')::double precision;
  if chosen_confidence < 0.05 or chosen_confidence < best_confidence / 5 then
    raise exception 'Candidate too unlikely';
  end if;

  select * into entry from public.species_catalog where scientific_name = target_scientific_name;
  atlas_match := found;
  update public.animal_captures set
    status = 'ready', scientific_name = candidate->>'scientificName',
    common_name = candidate->>'commonName',
    common_name_locale = coalesce(entry.vernacular_name, candidate->>'commonNameLocale'),
    in_atlas = atlas_match, rarity = entry.rarity,
    confidence = chosen_confidence,
    identification_issue = 'player_corrected',
    taxonomy = candidate - array['scientificName', 'commonName', 'commonNameLocale', 'confidence']
  where id = target_capture_id and user_id = uid;
end;
$$;

revoke execute on function public.confirm_capture_identification(uuid, text) from public, anon;
grant execute on function public.confirm_capture_identification(uuid, text) to authenticated;
