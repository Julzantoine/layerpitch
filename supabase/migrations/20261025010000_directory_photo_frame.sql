-- LayerPitch — Annuaire des compositeurs : cadrage de la photo (25/10, demande de Jules-Antoine : « ma photo n'est pas centrée,
-- ce serait bien de pouvoir la recentrer à la main »). Le cadrage est propre à l'annuaire (la photo de l'AdReel n'est pas touchée) :
-- { x, y, zoom } = point de l'image (0–100 %) placé au centre du rond, et agrandissement (1–3). Aucun cadrage = centre, zoom 1.

alter table public.composer_profiles add column directory_photo_frame jsonb;
comment on column public.composer_profiles.directory_photo_frame is 'Cadrage de la photo dans l''annuaire : { x: 0-100, y: 0-100, zoom: 1-3 }. null = centrée.';

drop function public.composer_directory();
create function public.composer_directory()
returns table (handle text, name text, bio text, photo text, photo_frame jsonb, keywords text[], tier text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce((public.directory_status()->>'open')::boolean, false) then return; end if;
  return query
    select c.handle,
           coalesce(nullif(trim(r.profile->>'title'), ''), c.handle) as name,
           nullif(left(trim(coalesce(r.profile->>'bio', '')), 400), '') as bio,
           nullif(r.profile->>'photo', '') as photo,
           c.directory_photo_frame,
           c.directory_keywords,
           coalesce((select pp.plan from public.profile_plan(c.profile_id, 'composer', false) pp limit 1), 'free') as tier
    from public.composer_profiles c
    join public.profiles p on p.id = c.profile_id
    join public.ad_reels r on r.owner_id = c.id and r.id = 'main'
    where c.directory_opt_in and c.handle is not null
      and not p.suspended and p.deletion_requested_at is null and p.deleted_at is null
    order by case coalesce((select pp.plan from public.profile_plan(c.profile_id, 'composer', false) pp limit 1), 'free')
                  when 'pro' then 0 when 'starter' then 1 else 2 end,
             md5(c.handle || current_date::text);
end;
$$;
grant execute on function public.composer_directory() to anon, authenticated;

-- Réglages du compositeur connecté : s'ajoutent le nom et la photo de son AdReel principal (pour l'aperçu du cadrage) et le cadrage.
create or replace function public.get_my_directory()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('optIn', c.directory_opt_in, 'keywords', to_jsonb(c.directory_keywords),
                            'photoFrame', c.directory_photo_frame,
                            'photo', (select nullif(r.profile->>'photo', '') from public.ad_reels r where r.owner_id = c.id and r.id = 'main'))
  from public.composer_profiles c where c.profile_id = auth.uid();
$$;
revoke execute on function public.get_my_directory() from public, anon;
grant execute on function public.get_my_directory() to authenticated;

-- p_photo_frame : null = cadrage inchangé ; sinon { x, y, zoom } ramené dans les bornes ; { } ou zoom 1 centré = retour au centre.
drop function public.set_my_directory(boolean, text[]);
create function public.set_my_directory(p_opt_in boolean, p_keywords text[], p_photo_frame jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kw text[];
  v_frame jsonb;
  v_set_frame boolean := p_photo_frame is not null;
begin
  select coalesce(array_agg(k order by first_pos), '{}') into v_kw from (
    select left(trim(x.k), 30) as k, min(x.ord) as first_pos
    from unnest(coalesce(p_keywords, '{}')) with ordinality as x(k, ord)
    where trim(x.k) <> ''
    group by left(trim(x.k), 30)
    order by min(x.ord) limit 12
  ) s;
  if v_set_frame then
    if jsonb_typeof(p_photo_frame) <> 'object' or p_photo_frame = '{}'::jsonb then v_frame := null;
    else
      v_frame := jsonb_build_object(
        'x', round(least(100, greatest(0, coalesce((p_photo_frame->>'x')::numeric, 50))), 1),
        'y', round(least(100, greatest(0, coalesce((p_photo_frame->>'y')::numeric, 50))), 1),
        'zoom', round(least(3, greatest(1, coalesce((p_photo_frame->>'zoom')::numeric, 1))), 2));
    end if;
  end if;
  update public.composer_profiles
     set directory_opt_in = coalesce(p_opt_in, true), directory_keywords = v_kw,
         directory_photo_frame = case when v_set_frame then v_frame else directory_photo_frame end
   where profile_id = auth.uid();
  if not found then raise exception 'Aucun profil compositeur pour ce compte'; end if;
  return public.get_my_directory() || jsonb_build_object('optIn', coalesce(p_opt_in, true));
end;
$$;
revoke execute on function public.set_my_directory(boolean, text[], jsonb) from public, anon;
grant execute on function public.set_my_directory(boolean, text[], jsonb) to authenticated;
