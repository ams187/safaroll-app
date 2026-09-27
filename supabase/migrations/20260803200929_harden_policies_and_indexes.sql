revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create index species_seasons_scientific_name_idx
on public.species_seasons (scientific_name);

drop policy "owners read captures" on public.bird_captures;
drop policy "public deck readers read captures" on public.bird_captures;
create policy "owners and public deck readers read captures"
on public.bird_captures for select to authenticated
using (
  user_id = (select public.current_user_id())
  or exists (
    select 1 from public.bird_deck_cards dc
    join public.bird_decks d on d.id = dc.deck_id
    where dc.capture_id = bird_captures.id and d.is_public
  )
);

drop policy "owners read decks" on public.bird_decks;
drop policy "community reads public decks" on public.bird_decks;
create policy "owners and community read decks"
on public.bird_decks for select to authenticated
using (user_id = (select public.current_user_id()) or is_public);
