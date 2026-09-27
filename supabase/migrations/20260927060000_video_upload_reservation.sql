-- LayerPitch — quota vidéo vérifié AVANT l'envoi, sur la taille réelle (27 septembre).
--
-- Deux trous dans le quota de stockage vidéo (plan_quotas.max_video_storage_gb) : 1) la vidéo partait vers R2 avant
-- toute vérification (upsert_video n'était appelé qu'après) -- un compte sans quota pouvait remplir le stockage même si
-- l'enregistrement était ensuite refusé ; 2) la taille comptée était celle que le navigateur annonçait
-- (payload.sizeBytes), jamais vérifiée : envoyer 2 Go en déclarant 1 octet passait.
--
-- Désormais c'est create-media-signed-url qui, avant de signer l'envoi d'une vidéo, appelle reserve_video_upload() avec
-- la taille exacte qu'il verrouille dans la signature (R2 refuse un fichier d'une autre taille) : quota vérifié, puis
-- ligne composer_videos créée tout de suite en « envoi en cours » avec cette taille. upsert_video ne fait plus que
-- compléter cette ligne (titre, durée...) et la passer « prête » -- la taille et le fichier ne viennent plus jamais du
-- navigateur. Un envoi interrompu (onglet fermé) reste compté dans le quota et apparaît dans la bibliothèque du
-- Backstage comme « envoi interrompu », avec son bouton Supprimer (qui efface aussi le fichier).

alter table public.composer_videos
  add column if not exists upload_status text not null default 'ready' check (upload_status in ('uploading', 'ready'));

-- Appelée uniquement par create-media-signed-url (rôle service). Renvoie null si l'envoi est autorisé, sinon le message
-- à montrer au compositeur.
create or replace function public.reserve_video_upload(p_composer_id uuid, p_path text, p_size bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_file text;
  v_existing_owner uuid;
  v_quota_gb int;
  v_used bigint;
begin
  if p_composer_id is null then return 'Non autorisé.'; end if;
  if p_path is null or p_path !~ '^video/[^/]+/[^/]+$' then return 'Chemin vidéo invalide.'; end if;
  if p_size is null or p_size <= 0 then return 'Taille du fichier manquante.'; end if;
  v_id := split_part(p_path, '/', 2);
  v_file := split_part(p_path, '/', 3);

  -- Un envoi à la fois par compositeur pour ce calcul : deux envois simultanés ne peuvent pas passer chacun sous le
  -- quota en s'ignorant l'un l'autre.
  perform pg_advisory_xact_lock(hashtext('video-quota:' || p_composer_id::text));

  select owner_id into v_existing_owner from public.composer_videos where id = v_id;
  if v_existing_owner is not null and v_existing_owner <> p_composer_id then
    return 'Ce fichier ne t''appartient pas.';
  end if;

  select max_video_storage_gb into v_quota_gb from public.effective_plan_quotas(p_composer_id);
  if v_quota_gb is not null then
    if v_quota_gb = 0 then return 'La bibliothèque vidéo n''est pas incluse dans ton offre.'; end if;
    select coalesce(sum(size_bytes), 0) into v_used from public.composer_videos
      where owner_id = p_composer_id and id <> v_id;
    if v_used + p_size > v_quota_gb::bigint * 1024 * 1024 * 1024 then
      return format('Quota de stockage vidéo dépassé (%s Go).', v_quota_gb);
    end if;
  end if;

  insert into public.composer_videos (id, owner_id, kind, title, base, file, mime_type, size_bytes, upload_status, updated_at)
  values (v_id, p_composer_id, 'upload', '', 'https://media.layerpitch.com/video/' || v_id || '/', v_file, 'video/mp4',
          p_size, 'uploading', now())
  on conflict (id) do update set
    file = excluded.file, base = excluded.base, size_bytes = excluded.size_bytes, upload_status = 'uploading', updated_at = now();
  return null;
end;
$$;
revoke all on function public.reserve_video_upload(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.reserve_video_upload(uuid, text, bigint) to service_role;

-- Complète la ligne réservée à l'envoi. Fichier, adresse, taille et type restent ceux de la réservation.
create or replace function public.upsert_video(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_id text := payload->>'id';
  v_existing_owner uuid;
  v_pack_id text := nullif(payload->>'packId', '');
  v_pack_owner uuid;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_id is null or v_id = '' then raise exception 'id manquant'; end if;

  if v_pack_id is not null then
    select owner_id into v_pack_owner from public.packs where id = v_pack_id;
    if v_pack_owner is not null and v_pack_owner <> v_owner_id then
      raise exception 'Non autorisé : ce pack appartient à un autre compositeur';
    end if;
  end if;

  select owner_id into v_existing_owner from public.composer_videos where id = v_id;
  if v_existing_owner is null then
    raise exception 'Envoi vidéo introuvable : relance l''import';
  end if;
  if v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : cette vidéo appartient à un autre compositeur';
  end if;

  update public.composer_videos set
    kind = coalesce(payload->>'kind', kind), pack_id = v_pack_id, title = coalesce(payload->>'title', ''),
    original_name = payload->>'originalName', duration_seconds = nullif(payload->>'durationSeconds', '')::numeric,
    upload_status = 'ready', updated_at = now()
  where id = v_id and owner_id = v_owner_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Vidéos prêtes seulement dans « videos » (sélecteurs de vidéo, versioning...) ; envois interrompus à part, pour la
-- bibliothèque du Backstage ; usedBytes = tout ce qui compte dans le quota.
create or replace function public.list_my_videos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_videos jsonb;
  v_interrupted jsonb;
  v_used bigint;
  v_quota_gb int;
begin
  if v_owner_id is null then
    return jsonb_build_object('videos', '[]'::jsonb, 'interrupted', '[]'::jsonb, 'usedBytes', 0, 'quotaGb', null);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'packId', pack_id, 'title', title, 'base', base, 'file', file,
    'originalName', original_name, 'mimeType', mime_type, 'sizeBytes', size_bytes,
    'durationSeconds', duration_seconds, 'createdAt', created_at, 'updatedAt', updated_at
  ) order by created_at desc) filter (where upload_status = 'ready'), '[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'base', base, 'file', file, 'sizeBytes', size_bytes, 'updatedAt', updated_at
  ) order by created_at desc) filter (where upload_status = 'uploading'), '[]'::jsonb),
  coalesce(sum(size_bytes), 0)
  into v_videos, v_interrupted, v_used
  from public.composer_videos where owner_id = v_owner_id;

  select max_video_storage_gb into v_quota_gb from public.effective_plan_quotas(v_owner_id);

  return jsonb_build_object('videos', v_videos, 'interrupted', v_interrupted, 'usedBytes', v_used, 'quotaGb', v_quota_gb);
end;
$$;
