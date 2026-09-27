create function public.chorus_activity_state(p_activity text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'speciesCount', count(distinct c.scientific_name),
    'newSpeciesCount', count(distinct c.scientific_name) filter (where not exists (
      select from public.animal_captures old
      where old.user_id=a.user_id and old.scientific_name=c.scientific_name
        and old.status in ('ready','needs_review') and old.captured_at<a.started_at
    )),
    'lastSpecies', coalesce((array_agg(c.scientific_name order by c.captured_at desc)
      filter (where c.scientific_name is not null))[1], '')
  )
  from public.chorus_activities a
  left join public.animal_captures c on c.user_id=a.user_id
    and c.captured_at>=a.started_at and c.captured_at<a.expires_at
    and c.status='ready' and c.capture_source='camera'
    and not coalesce(c.is_onboarding_capture,false)
  where a.id=p_activity
  group by a.id;
$$;
revoke all on function public.chorus_activity_state(text) from public, anon, authenticated;
grant execute on function public.chorus_activity_state(text) to service_role;
