-- Decks publics pour les joueurs fictifs. Deuxieme moitie de
-- `seed-community.sql`, a jouer apres lui :
--
--   supabase db query --linked -f scripts/seed-community-decks.sql
--
-- Genere. Les cartes reprennent des especes REELLES du catalogue et pointent
-- sur des copies des vrais die-cuts, uploadees sous `<seed_uid>/<slot>.webp`
-- dans le bucket `capture-stickers` -- sans quoi le plateau afficherait huit
-- empreintes de patte. Espece et image vont donc ensemble, ce qu'un tirage
-- aleatoire ne garantissait pas.
--
-- Pour tout effacer : voir l'en-tete de `seed-community.sql` ; la cascade des
-- cles etrangeres emporte decks et deck_cards avec les profils.

delete from public.decks where user_id like 'seed_%';

with card_seed(uid, deck_name, slot, sci, common, rarity, color, ar) as (values
  ('seed_lea', 'Prédateurs', 0, 'Aquila chrysaetos', 'Golden Eagle', 'legendary', '#160A0B', 1.33333333333333::double precision),
  ('seed_lea', 'Prédateurs', 1, 'Aquila fasciata', 'Bonelli''s Eagle', 'rare', '#4E4E4A', 1.33333333333333::double precision),
  ('seed_lea', 'Prédateurs', 2, 'Aquila pomarina', 'Lesser Spotted Eagle', null, '#716E6D', 1.33333333333333::double precision),
  ('seed_lea', 'Prédateurs', 3, 'Canis lycaon', 'Canis lycaon', null, '#B4B0AC', 1.33333333333333::double precision),
  ('seed_lea', 'Prédateurs', 4, 'Castor canadensis', 'American Beaver', 'common', '#10AAFF', 0.75::double precision),
  ('seed_lea', 'Prédateurs', 5, 'Cygnus olor', 'Mute Swan', 'common', '#F5955B', 1.33333333333333::double precision),
  ('seed_lea', 'Prédateurs', 6, 'Equus caballus', 'Domestic Horse', 'common', '#D26839', 1.33333333333333::double precision),
  ('seed_lea', 'Prédateurs', 7, 'Equus quagga', 'Plains Zebra', 'common', '#6D6D6B', 0.75::double precision),
  ('seed_karim', 'Grandes ailes', 0, 'Canis lycaon', 'Canis lycaon', null, '#B4B0AC', 1.33333333333333::double precision),
  ('seed_karim', 'Grandes ailes', 1, 'Castor canadensis', 'American Beaver', 'common', '#10AAFF', 0.75::double precision),
  ('seed_karim', 'Grandes ailes', 2, 'Cygnus olor', 'Mute Swan', 'common', '#F5955B', 1.33333333333333::double precision),
  ('seed_karim', 'Grandes ailes', 3, 'Equus caballus', 'Domestic Horse', 'common', '#D26839', 1.33333333333333::double precision),
  ('seed_karim', 'Grandes ailes', 4, 'Equus quagga', 'Plains Zebra', 'common', '#6D6D6B', 0.75::double precision),
  ('seed_karim', 'Grandes ailes', 5, 'Erinaceus europaeus', 'Common Hedgehog', 'common', '#B0A797', 1.33333333333333::double precision),
  ('seed_karim', 'Grandes ailes', 6, 'Panthera leo', 'Lion', 'legendary', '#524A4D', 0.75::double precision),
  ('seed_karim', 'Grandes ailes', 7, 'Panthera pardus', 'Leopard', 'uncommon', '#D0B072', 1.33333333333333::double precision),
  ('seed_emma', 'Savane', 0, 'Equus caballus', 'Domestic Horse', 'common', '#D26839', 1.33333333333333::double precision),
  ('seed_emma', 'Savane', 1, 'Equus quagga', 'Plains Zebra', 'common', '#6D6D6B', 0.75::double precision),
  ('seed_emma', 'Savane', 2, 'Erinaceus europaeus', 'Common Hedgehog', 'common', '#B0A797', 1.33333333333333::double precision),
  ('seed_emma', 'Savane', 3, 'Panthera leo', 'Lion', 'legendary', '#524A4D', 0.75::double precision),
  ('seed_emma', 'Savane', 4, 'Panthera pardus', 'Leopard', 'uncommon', '#D0B072', 1.33333333333333::double precision),
  ('seed_emma', 'Savane', 5, 'Panthera tigris', 'Tiger', 'legendary', '#8C6C52', 0.75::double precision),
  ('seed_emma', 'Savane', 6, 'Phoenicopterus roseus', 'Greater Flamingo', 'legendary', '#DA9038', 0.75::double precision),
  ('seed_emma', 'Savane', 7, 'Ratufa indica', 'Indian Giant Squirrel', 'rare', '#516CAE', 1.33333333333333::double precision),
  ('seed_nico', 'Nocturnes', 0, 'Panthera leo', 'Lion', 'legendary', '#524A4D', 0.75::double precision),
  ('seed_nico', 'Nocturnes', 1, 'Panthera pardus', 'Leopard', 'uncommon', '#D0B072', 1.33333333333333::double precision),
  ('seed_nico', 'Nocturnes', 2, 'Panthera tigris', 'Tiger', 'legendary', '#8C6C52', 0.75::double precision),
  ('seed_nico', 'Nocturnes', 3, 'Phoenicopterus roseus', 'Greater Flamingo', 'legendary', '#DA9038', 0.75::double precision),
  ('seed_nico', 'Nocturnes', 4, 'Ratufa indica', 'Indian Giant Squirrel', 'rare', '#516CAE', 1.33333333333333::double precision),
  ('seed_nico', 'Nocturnes', 5, 'Sciurus vulgaris', 'Eurasian Red Squirrel', 'common', '#D1AD92', 1.33333333333333::double precision),
  ('seed_nico', 'Nocturnes', 6, 'Sus scrofa', 'Wild Boar', 'common', '#B1AAB4', 1.33333333333333::double precision),
  ('seed_nico', 'Nocturnes', 7, 'Testudo hermanni', 'Hermann''s Tortoise', 'uncommon', '#B3B1AB', 1.33333333333333::double precision),
  ('seed_sarah', 'Les géants', 0, 'Phoenicopterus roseus', 'Greater Flamingo', 'legendary', '#DA9038', 0.75::double precision),
  ('seed_sarah', 'Les géants', 1, 'Ratufa indica', 'Indian Giant Squirrel', 'rare', '#516CAE', 1.33333333333333::double precision),
  ('seed_sarah', 'Les géants', 2, 'Sciurus vulgaris', 'Eurasian Red Squirrel', 'common', '#D1AD92', 1.33333333333333::double precision),
  ('seed_sarah', 'Les géants', 3, 'Sus scrofa', 'Wild Boar', 'common', '#B1AAB4', 1.33333333333333::double precision),
  ('seed_sarah', 'Les géants', 4, 'Testudo hermanni', 'Hermann''s Tortoise', 'uncommon', '#B3B1AB', 1.33333333333333::double precision),
  ('seed_sarah', 'Les géants', 5, 'Vulpes vulpes', 'Red Fox', 'common', '#D07230', 1.33333333333333::double precision),
  ('seed_sarah', 'Les géants', 6, 'Aquila chrysaetos', 'Golden Eagle', 'legendary', '#160A0B', 1.33333333333333::double precision),
  ('seed_sarah', 'Les géants', 7, 'Aquila fasciata', 'Bonelli''s Eagle', 'rare', '#4E4E4A', 1.33333333333333::double precision),
  ('seed_tom', 'Plumes', 0, 'Sus scrofa', 'Wild Boar', 'common', '#B1AAB4', 1.33333333333333::double precision),
  ('seed_tom', 'Plumes', 1, 'Testudo hermanni', 'Hermann''s Tortoise', 'uncommon', '#B3B1AB', 1.33333333333333::double precision),
  ('seed_tom', 'Plumes', 2, 'Vulpes vulpes', 'Red Fox', 'common', '#D07230', 1.33333333333333::double precision),
  ('seed_tom', 'Plumes', 3, 'Aquila chrysaetos', 'Golden Eagle', 'legendary', '#160A0B', 1.33333333333333::double precision),
  ('seed_tom', 'Plumes', 4, 'Aquila fasciata', 'Bonelli''s Eagle', 'rare', '#4E4E4A', 1.33333333333333::double precision),
  ('seed_tom', 'Plumes', 5, 'Aquila pomarina', 'Lesser Spotted Eagle', null, '#716E6D', 1.33333333333333::double precision),
  ('seed_tom', 'Plumes', 6, 'Canis lycaon', 'Canis lycaon', null, '#B4B0AC', 1.33333333333333::double precision),
  ('seed_tom', 'Plumes', 7, 'Castor canadensis', 'American Beaver', 'common', '#10AAFF', 0.75::double precision),
  ('seed_ines', 'Première ligne', 0, 'Aquila chrysaetos', 'Golden Eagle', 'legendary', '#160A0B', 1.33333333333333::double precision),
  ('seed_ines', 'Première ligne', 1, 'Aquila fasciata', 'Bonelli''s Eagle', 'rare', '#4E4E4A', 1.33333333333333::double precision),
  ('seed_ines', 'Première ligne', 2, 'Aquila pomarina', 'Lesser Spotted Eagle', null, '#716E6D', 1.33333333333333::double precision),
  ('seed_ines', 'Première ligne', 3, 'Canis lycaon', 'Canis lycaon', null, '#B4B0AC', 1.33333333333333::double precision),
  ('seed_ines', 'Première ligne', 4, 'Castor canadensis', 'American Beaver', 'common', '#10AAFF', 0.75::double precision),
  ('seed_ines', 'Première ligne', 5, 'Cygnus olor', 'Mute Swan', 'common', '#F5955B', 1.33333333333333::double precision),
  ('seed_ines', 'Première ligne', 6, 'Equus caballus', 'Domestic Horse', 'common', '#D26839', 1.33333333333333::double precision),
  ('seed_ines', 'Première ligne', 7, 'Equus quagga', 'Plains Zebra', 'common', '#6D6D6B', 0.75::double precision),
  ('seed_hugo', 'Mes trophées', 0, 'Canis lycaon', 'Canis lycaon', null, '#B4B0AC', 1.33333333333333::double precision),
  ('seed_hugo', 'Mes trophées', 1, 'Castor canadensis', 'American Beaver', 'common', '#10AAFF', 0.75::double precision),
  ('seed_hugo', 'Mes trophées', 2, 'Cygnus olor', 'Mute Swan', 'common', '#F5955B', 1.33333333333333::double precision),
  ('seed_hugo', 'Mes trophées', 3, 'Equus caballus', 'Domestic Horse', 'common', '#D26839', 1.33333333333333::double precision),
  ('seed_hugo', 'Mes trophées', 4, 'Equus quagga', 'Plains Zebra', 'common', '#6D6D6B', 0.75::double precision),
  ('seed_hugo', 'Mes trophées', 5, 'Erinaceus europaeus', 'Common Hedgehog', 'common', '#B0A797', 1.33333333333333::double precision),
  ('seed_hugo', 'Mes trophées', 6, 'Panthera leo', 'Lion', 'legendary', '#524A4D', 0.75::double precision),
  ('seed_hugo', 'Mes trophées', 7, 'Panthera pardus', 'Leopard', 'uncommon', '#D0B072', 1.33333333333333::double precision)
),
made_decks as (
  insert into public.decks (user_id, name, is_public)
  select distinct s.uid, s.deck_name, true
  from card_seed s
  returning id, user_id, name
),
made_cards as (
  insert into public.animal_captures
    (user_id, status, original_path, sticker_path, capture_source, aspect_ratio,
     captured_at, scientific_name, common_name, in_atlas, confidence, rarity, dominant_color)
  select
    s.uid, 'ready',
    s.uid || '/deck-' || s.slot || '.jpg',
    s.uid || '/' || s.slot || '.webp',
    'camera', s.ar,
    now() - (s.slot * 6) * interval '1 hour',
    s.sci, s.common, true, 0.95, s.rarity, s.color
  from card_seed s
  returning id, user_id, sticker_path
)
insert into public.deck_cards (user_id, deck_id, capture_id, position)
select s.uid, d.id, c.id, s.slot
from card_seed s
join made_decks d on d.user_id = s.uid and d.name = s.deck_name
join made_cards c on c.user_id = s.uid and c.sticker_path = s.uid || '/' || s.slot || '.webp';
