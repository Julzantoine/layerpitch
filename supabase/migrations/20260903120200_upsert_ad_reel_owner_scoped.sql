-- LayerPitch — upsert_ad_reel adapté à la clé composite (owner_id, id) de ad_reels
-- (20260903120000_ad_reels_owner_scoped_id.sql).
--
-- Le bloc de vérification "cet AdReel appartient à un autre compositeur" (select owner_id into
-- v_existing_owner ... raise exception) est retiré : avec la clé composite, un insert ne peut plus
-- jamais entrer en conflit qu'avec une ligne du même owner_id (v_owner_id vient toujours de
-- current_composer_id(), jamais du client) — la situation que ce bloc empêchait est désormais
-- structurellement impossible, pas seulement improbable. Garder une vérification qui ne peut plus
-- jamais se déclencher serait du code mort, pas une prudence supplémentaire.

create or replace function public.upsert_ad_reel(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ad_reel_id text := payload->>'id';
  v_owner_id uuid := public.current_composer_id();
  v_idx int := 0;
  v_id text;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_ad_reel_id is null or v_ad_reel_id = '' then raise exception 'payload.id manquant'; end if;

  insert into public.ad_reels (id, owner_id, folder_id, label, lang, profile, testimonials, blocks, track_overrides, updated_at)
  values (
    v_ad_reel_id, v_owner_id, nullif(payload->>'folderId',''), coalesce(payload->>'label',''), coalesce(payload->>'lang','fr'),
    coalesce(payload->'profile','{}'::jsonb), coalesce(payload->'testimonials','[]'::jsonb),
    coalesce(payload->'blocks','[]'::jsonb), coalesce(payload->'trackOverrides','{}'::jsonb), now()
  )
  on conflict (owner_id, id) do update set
    folder_id = excluded.folder_id, label = excluded.label, lang = excluded.lang, profile = excluded.profile,
    testimonials = excluded.testimonials, blocks = excluded.blocks, track_overrides = excluded.track_overrides,
    updated_at = now();

  delete from public.ad_reel_tracks where owner_id = v_owner_id and ad_reel_id = v_ad_reel_id;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb))
  loop
    insert into public.ad_reel_tracks (owner_id, ad_reel_id, track_id, position) values (v_owner_id, v_ad_reel_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_ad_reel_id);
end;
$$;

grant execute on function public.upsert_ad_reel(jsonb) to authenticated;
