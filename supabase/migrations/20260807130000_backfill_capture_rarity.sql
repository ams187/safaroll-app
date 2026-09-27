-- Les captures existantes portaient encore l'ancienne échelle.
--
-- CE QUI CLOCHAIT
--
-- La rareté d'une carte est une propriété de l'ESPÈCE, la même pour tous les
-- joueurs du monde. Elle était pourtant recopiée sur la capture au moment de
-- l'identification, et deux choses l'ont fait diverger du catalogue :
--
--   1. l'échelle est passée de cinq paliers à huit ;
--   2. une espèce hors catalogue était notée par son abondance LOCALE — corrigé
--      depuis dans `identify-animal`, mais les lignes écrites avant restent.
--
-- Mesuré avant cette migration : 188 captures sur 261 en désaccord avec le
-- catalogue, dont 14 marquées « légendaire » pour une espèce que le catalogue
-- dit « peu commune ». Un joueur voyait une carte au foil arc-en-ciel pour un
-- animal banal, et son voisin la même espèce en carte grise.
--
-- CE QUI N'EST PAS TOUCHÉ
--
-- Les captures dont l'espèce n'est pas au catalogue (10 lignes) gardent leur
-- rareté : la recalculer demande une requête GBIF, que seule l'edge function
-- sait faire. Elles se corrigeront à la prochaine identification, ou resteront
-- telles quelles — elles ne mentent sur personne d'autre qu'elles-mêmes.
--
-- `local_encounter_rarity` n'est pas touché non plus : il décrit la RENCONTRE
-- (« 3ᵉ fois qu'on voit ça dans ta zone »), il est personnel, et il n'a jamais
-- eu vocation à noter une carte.

update public.animal_captures as c
set rarity = s.rarity
from public.species_catalog as s
where s.scientific_name = c.scientific_name
  and s.rarity is not null
  and c.rarity is distinct from s.rarity;
