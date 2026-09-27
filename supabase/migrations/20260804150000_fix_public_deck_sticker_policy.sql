-- `public decks read stickers` n'a jamais rien laissé passer.
--
-- La policy d'origine écrivait `where c.sticker_path = name`, en comptant sur
-- `name` pour désigner la ligne de `storage.objects` sur laquelle la policy
-- s'applique. Mais la sous-requête joint `decks`, qui a AUSSI une colonne
-- `name` — et la résolution de nom prend la table la plus proche. La condition
-- compilée était donc :
--
--   where c.sticker_path = d.name   -- le NOM DU DECK, ex. « Prédateurs »
--
-- Un chemin de stockage n'est jamais égal à un nom de deck, l'`exists` était
-- toujours faux, et la seule policy restante — `owners read private files` —
-- ne rend que ses propres fichiers. Résultat : les cartes d'un deck public
-- s'affichaient sans animal pour tout le monde sauf leur auteur, en silence,
-- puisqu'une URL signée est délivrée même pour un objet qu'on n'a pas le droit
-- de lire : c'est le GET qui échoue, après coup, dans le décodeur d'image.
--
-- La colonne est qualifiée maintenant. Le `select 1` d'origine devenait aussi
-- ambigu à lire ; la sous-requête part de `deck_cards` pour que le sens soit
-- celui qu'on veut : « ce fichier est-il le die-cut d'une carte posée dans un
-- deck public ? »

drop policy if exists "public decks read stickers" on storage.objects;

create policy "public decks read stickers" on storage.objects for select to authenticated
using (
  bucket_id = 'capture-stickers' and exists (
    select 1
    from public.deck_cards dc
    join public.decks d on d.id = dc.deck_id
    join public.animal_captures c on c.id = dc.capture_id
    where d.is_public and c.sticker_path = objects.name
  )
);
