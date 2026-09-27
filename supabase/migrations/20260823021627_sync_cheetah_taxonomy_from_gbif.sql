-- Source : GBIF Species Match, usageKey 2435270, confiance 99.
-- https://api.gbif.org/v1/species/match?name=Acinonyx%20jubatus
update public.species_catalog
set kingdom = 'Animalia',
    phylum = 'Chordata',
    class = 'Mammalia',
    "order" = 'Carnivora',
    family = 'Felidae',
    genus = 'Acinonyx'
where scientific_name = 'Acinonyx jubatus'
  and gbif_key = 2435270;

-- Répercute la source catalogue sur les rencontres déjà enregistrées.
update public.animal_captures c
set taxonomy = coalesce(c.taxonomy, '{}'::jsonb) || jsonb_build_object(
  'kingdom', s.kingdom,
  'phylum', s.phylum,
  'class', s.class,
  'order', s."order",
  'family', s.family,
  'genus', s.genus
)
from public.species_catalog s
where c.scientific_name = s.scientific_name
  and s.scientific_name = 'Acinonyx jubatus'
  and s.gbif_key = 2435270;
