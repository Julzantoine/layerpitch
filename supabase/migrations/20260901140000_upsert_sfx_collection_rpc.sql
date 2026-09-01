-- LayerPitch — RPC upsert_sfx / upsert_collection (Session C du séquençage, docs/infrastructure.md)
--
-- Manquantes jusqu'ici : seules upsert_track/upsert_pack/upsert_ad_reel avaient été construites le
-- 31 août (Décision 2). Même schéma exact que upsert_pack : vérification de propriété via
-- current_composer_id() (Décision 1, correction owner_id du 31 août), owner_id ne change jamais
-- après création, sfx_library/collections déjà dotées de owner_id not null.

create or replace function public.upsert_sfx(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sfx_id text := payload->>'id';
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_sfx_id is null or v_sfx_id = '' then raise exception 'payload.id manquant'; end if;

  select owner_id into v_existing_owner from public.sfx_library where id = v_sfx_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : ce Sfx appartient à un autre compositeur';
  end if;

  insert into public.sfx_library (id, owner_id, folder_id, title, description_fr, description_en,
    rr_mode, duck_main_track, base, alternatives, updated_at)
  values (
    v_sfx_id, v_owner_id, nullif(payload->>'folderId',''), coalesce(payload->>'title',''),
    coalesce(payload->>'descriptionFr',''), coalesce(payload->>'descriptionEn',''),
    payload->>'rrMode', coalesce((payload->>'duckMainTrack')::boolean,false),
    coalesce(payload->>'base',''), coalesce(payload->'alternatives','[]'::jsonb), now()
  )
  on conflict (id) do update set
    folder_id = excluded.folder_id, title = excluded.title, description_fr = excluded.description_fr,
    description_en = excluded.description_en, rr_mode = excluded.rr_mode,
    duck_main_track = excluded.duck_main_track, base = excluded.base, alternatives = excluded.alternatives,
    updated_at = now();

  return jsonb_build_object('ok', true, 'id', v_sfx_id);
end;
$$;

create or replace function public.upsert_collection(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_collection_id text := payload->>'id';
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
  v_idx int := 0;
  v_id text;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_collection_id is null or v_collection_id = '' then raise exception 'payload.id manquant'; end if;

  select owner_id into v_existing_owner from public.collections where id = v_collection_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : cette collection appartient à un autre compositeur';
  end if;

  insert into public.collections (id, owner_id, title, illustration, illustration_original_name,
    presentation_fr, presentation_en, bg_color, text_color, font, buyable, buy_url,
    free_download_enabled, updated_at)
  values (
    v_collection_id, v_owner_id, coalesce(payload->>'title',''), payload->>'illustration',
    payload->>'illustrationOriginalName', coalesce(payload->>'presentationFr',''),
    coalesce(payload->>'presentationEn',''), payload->>'bgColor', payload->>'textColor', payload->>'font',
    coalesce((payload->>'buyable')::boolean,false), coalesce(payload->>'buyUrl',''),
    coalesce((payload->>'freeDownloadEnabled')::boolean,false), now()
  )
  on conflict (id) do update set
    title = excluded.title, illustration = excluded.illustration,
    illustration_original_name = excluded.illustration_original_name, presentation_fr = excluded.presentation_fr,
    presentation_en = excluded.presentation_en, bg_color = excluded.bg_color, text_color = excluded.text_color,
    font = excluded.font, buyable = excluded.buyable, buy_url = excluded.buy_url,
    free_download_enabled = excluded.free_download_enabled, updated_at = now();

  delete from public.collection_packs where collection_id = v_collection_id;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'packIds', '[]'::jsonb))
  loop
    insert into public.collection_packs (collection_id, pack_id, position) values (v_collection_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_collection_id);
end;
$$;

grant execute on function public.upsert_sfx(jsonb) to authenticated;
grant execute on function public.upsert_collection(jsonb) to authenticated;
