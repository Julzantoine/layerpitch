-- LayerPitch — spatialisation d'un Sfx (matrice "salle + auditeur au centre", 23/09).
-- sfx_library.spatial = { enabled, room: 'room'|'hall'|'cathedral'|'outside', x, y, binaural } (JSONB, nullable).
-- Colonne dédiée plutôt que glissée dans `alternatives` : le réglage appartient au Sfx entier, pas à une variation.
-- Purement additif : les Sfx existants gardent spatial = NULL (= aucune spatialisation, comportement inchangé).
-- (Même piège que pour les fx de morceau, voir 20260923010000 : upsert_sfx n'écrit que des colonnes explicites,
-- donc un champ absent de la fonction serait perdu en silence à chaque publication.)

alter table public.sfx_library add column if not exists spatial jsonb;

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
    rr_mode, duck_main_track, base, alternatives, spatial, updated_at)
  values (
    v_sfx_id, v_owner_id, nullif(payload->>'folderId',''), coalesce(payload->>'title',''),
    coalesce(payload->>'descriptionFr',''), coalesce(payload->>'descriptionEn',''),
    payload->>'rrMode', coalesce((payload->>'duckMainTrack')::boolean,false),
    coalesce(payload->>'base',''), coalesce(payload->'alternatives','[]'::jsonb),
    nullif(payload->'spatial', 'null'::jsonb), now()
  )
  on conflict (id) do update set
    folder_id = excluded.folder_id, title = excluded.title, description_fr = excluded.description_fr,
    description_en = excluded.description_en, rr_mode = excluded.rr_mode,
    duck_main_track = excluded.duck_main_track, base = excluded.base, alternatives = excluded.alternatives,
    spatial = excluded.spatial, updated_at = now();

  return jsonb_build_object('ok', true, 'id', v_sfx_id);
end;
$$;

grant execute on function public.upsert_sfx(jsonb) to authenticated;
