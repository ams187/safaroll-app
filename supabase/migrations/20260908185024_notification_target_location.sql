-- Collection ownership includes photos WITHOUT GPS. Location and latest
-- capture have separate timestamps: a new indoor photo cannot refresh an old
-- holiday location. Keep the existing view columns and append the new field.
create or replace view public.notification_targets
with (security_invoker = true) as
select
  c.user_id,
  loc.latitude,
  loc.longitude,
  max(c.captured_at) as last_capture_at,
  array_remove(array_agg(distinct c.scientific_name), null) as owned_species,
  p.region,
  loc.captured_at as last_location_at
from public.animal_captures c
left join public.profiles p on p.user_id = c.user_id
join lateral (
  select l.latitude, l.longitude, l.captured_at
  from public.animal_captures l
  where l.user_id = c.user_id
    and l.status in ('ready', 'needs_review')
    and l.latitude between -90 and 90
    and l.longitude between -180 and 180
  order by l.captured_at desc, l.id desc
  limit 1
) loc on true
where c.status in ('ready', 'needs_review')
group by c.user_id, p.region, loc.latitude, loc.longitude, loc.captured_at;

comment on view public.notification_targets is
  'All owned species and latest capture, with a separate timestamp for the last valid photographed location. A photographed location is not live GPS.';
