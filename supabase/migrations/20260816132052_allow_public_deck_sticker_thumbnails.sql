-- A public deck exposes its card sticker, and therefore the 384 px derivative
-- used by every miniature. The old policy only matched the full-size path;
-- visitors silently fell back to decoding the 1400 px source in grids.
drop policy if exists "public decks read stickers" on storage.objects;

create policy "public decks read stickers"
on storage.objects for select to authenticated
using (
  bucket_id = 'capture-stickers'
  and exists (
    select 1
    from public.deck_cards dc
    join public.decks d on d.id = dc.deck_id
    join public.animal_captures c on c.id = dc.capture_id
    where d.is_public
      and objects.name in (
        c.sticker_path,
        regexp_replace(c.sticker_path, '(\.[a-z0-9]+)$', '-thumb\1', 'i')
      )
  )
);
