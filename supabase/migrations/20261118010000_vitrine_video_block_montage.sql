-- Vitrines : le bloc « Vidéo » accepte aussi un MONTAGE (objet de Projet kind 'montage', avec son menu de versions).
-- Deux changements, rien d'autre :
--   1. save_project_vitrine : un bloc 'video' peut citer un objet 'video' OU 'montage' (contrôle d'appartenance au Projet inchangé).
--   2. get_vitrine : l'objet renvoyé porte maintenant montageId + montageTitle (le lecteur de versions lit ensuite le montage via
--      get_public_video_montage, déjà publique). On ne divulgue que l'identifiant du montage cité par la vitrine, rien d'autre.
-- Fonctions recopiées de 20260928220000_projet_retours_essai.sql, une seule ligne modifiée dans chacune.

create or replace function public.save_project_vitrine(p_project_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean; v_id uuid := nullif(p->>'id', '')::uuid; v_old_slug text; v_old_pub boolean := false; v_old_aud text; v_blocks jsonb := coalesce(p->'blocks', '[]'::jsonb);
  v_audience text := coalesce(p->>'audience', 'players'); v_slug text; v_pub boolean; v_b jsonb; v_l jsonb; v_bad int;
begin
  perform public.assert_project_role(p_project_id);
  v_admin := public.project_role(p_project_id, auth.uid()) = 'admin';
  if v_audience not in ('players', 'publisher') then raise exception 'Audience inconnue'; end if;
  if coalesce(p->>'display', 'page') not in ('page', 'slides') then raise exception 'Affichage inconnu'; end if;
  if jsonb_typeof(v_blocks) <> 'array' or jsonb_array_length(v_blocks) > 60 then raise exception 'Blocs invalides (60 au plus)'; end if;
  for v_b in select * from jsonb_array_elements(v_blocks) loop
    if coalesce(v_b->>'type', '') not in ('header', 'text', 'tracks', 'video', 'photo', 'packs', 'links', 'contact') then raise exception 'Type de bloc inconnu (%)', v_b->>'type'; end if;
    for v_l in select * from jsonb_array_elements(coalesce(v_b->'links', '[]'::jsonb)) loop
      if coalesce(v_l->>'url', '') !~* '^https?://[^\s]+$' then raise exception 'Lien invalide : %', v_l->>'url'; end if;
    end loop;
  end loop;
  -- Chaque objet cité doit appartenir à ce Projet, et être du bon type pour son bloc.
  select count(*) into v_bad from (
    select b->>'type' as t, x::uuid as aid from jsonb_array_elements(v_blocks) b, jsonb_array_elements_text(coalesce(b->'assetIds', '[]'::jsonb)) x
  ) c left join public.project_assets a on a.id = c.aid and a.project_id = p_project_id
  where a.id is null or not ((c.t = 'tracks' and a.kind in ('track', 'audio')) or (c.t = 'video' and a.kind in ('video', 'montage'))
    or (c.t = 'photo' and a.kind = 'image') or (c.t = 'packs' and a.kind = 'pack'));
  if v_bad > 0 then raise exception 'Un objet de la vitrine n''est pas dans ce Projet, ou pas du bon type pour son bloc'; end if;
  if nullif(p->>'logoAssetId', '') is not null and not exists (select 1 from public.project_assets where id = (p->>'logoAssetId')::uuid and project_id = p_project_id and kind = 'image') then
    raise exception 'Logo introuvable dans ce Projet';
  end if;
  if nullif(p->>'bgAssetId', '') is not null and not exists (select 1 from public.project_assets where id = (p->>'bgAssetId')::uuid and project_id = p_project_id and kind = 'image') then
    raise exception 'Image de fond introuvable dans ce Projet';
  end if;
  if v_id is not null then
    select slug, published, audience into v_old_slug, v_old_pub, v_old_aud from public.project_vitrines where id = v_id and project_id = p_project_id;
    if not found then raise exception 'Vitrine introuvable'; end if;
  end if;
  -- Adresse : celle demandée (si libre et non réservée), sinon tirée du titre.
  -- Par défaut : le nom du jeu (titre du Projet), suivi de « -editeur » pour une vitrine éditeur (retour du 28/09).
  v_slug := public.vitrine_slugify(coalesce(nullif(p->>'slug', ''),
    (select title from public.projects where id = p_project_id) || case when v_audience = 'publisher' then '-editeur' else '' end));
  if public.handle_is_reserved(v_slug) then v_slug := v_slug || '-vitrine'; end if;
  if exists (select 1 from public.project_vitrines where slug = v_slug and id is distinct from v_id) then
    if nullif(p->>'slug', '') is not null and (v_id is null or v_old_slug <> v_slug) then raise exception 'Cette adresse est déjà prise : %', v_slug; end if;
    v_slug := public.vitrine_free_slug(v_slug, v_id);
  end if;
  v_pub := case when v_admin then coalesce((p->>'published')::boolean, false) else coalesce(v_old_pub, false) end;
  -- Parade (28/09) : dans un Projet de compositeur, une vitrine PUBLIQUE qui passe en ligne compte comme un AdReel.
  if v_pub and v_audience = 'players' and not (coalesce(v_old_pub, false) and coalesce(v_old_aud, '') = 'players') then
    perform public.assert_public_page_quota(p_project_id);
  end if;
  if v_id is null then
    insert into public.project_vitrines (project_id, audience, display, title, subtitle, logo_asset_id, bg_asset_id, slug, published, secret_token, theme, blocks, created_by)
    values (p_project_id, v_audience, coalesce(p->>'display', 'page'), left(coalesce(p->>'title', ''), 200), left(coalesce(p->>'subtitle', ''), 300),
            nullif(p->>'logoAssetId', '')::uuid, nullif(p->>'bgAssetId', '')::uuid, v_slug, v_pub, case when v_audience = 'publisher' then replace(gen_random_uuid()::text, '-', '') end,
            coalesce(p->'theme', '{}'::jsonb), v_blocks, auth.uid())
    returning id into v_id;
  else
    update public.project_vitrines set audience = v_audience, display = coalesce(p->>'display', 'page'), title = left(coalesce(p->>'title', ''), 200),
      subtitle = left(coalesce(p->>'subtitle', ''), 300), logo_asset_id = nullif(p->>'logoAssetId', '')::uuid, bg_asset_id = nullif(p->>'bgAssetId', '')::uuid, slug = v_slug, published = v_pub,
      secret_token = case when v_audience = 'publisher' then coalesce(secret_token, replace(gen_random_uuid()::text, '-', '')) end,
      theme = coalesce(p->'theme', '{}'::jsonb), blocks = v_blocks, updated_at = now()
    where id = v_id;
  end if;
  perform public.log_project_activity(p_project_id, 'showcase_saved', jsonb_build_object('title', coalesce(p->>'title', ''), 'published', v_pub));
  return jsonb_build_object('id', v_id, 'slug', v_slug, 'published', v_pub);
end;
$$;

create or replace function public.get_vitrine(p_slug text default null, p_token text default null, p_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v record; v_ids uuid[];
begin
  select * into v from public.project_vitrines
  where (p_slug is not null and slug = lower(p_slug) and published and audience = 'players')
     or (p_token is not null and length(p_token) >= 16 and secret_token = p_token)
     or (p_id is not null and id = p_id and public.project_role(project_id, auth.uid()) is not null)
  limit 1;
  if not found then return null; end if;
  v_ids := public.vitrine_asset_ids(v.blocks, v.logo_asset_id) || coalesce(array[v.bg_asset_id], '{}') ;
  return jsonb_build_object('id', v.id, 'audience', v.audience, 'display', v.display, 'title', v.title, 'subtitle', v.subtitle,
    'logoAssetId', v.logo_asset_id, 'bgAssetId', v.bg_asset_id, 'slug', v.slug, 'published', v.published, 'theme', v.theme, 'blocks', v.blocks,
    'projectTitle', (select title from public.projects where id = v.project_id),
    'assets', (select coalesce(jsonb_object_agg(x.id, jsonb_build_object('kind', x.kind, 'title', x.title, 'url', x.url, 'fileId', x.file_id,
        'mimeType', f.mime_type, 'trackId', x.track_id, 'packId', x.pack_id, 'montageId', x.montage_id, 'montageTitle', vc.title, 'preview', x.preview)), '{}'::jsonb)
      from public.project_assets x left join public.project_files f on f.id = x.file_id left join public.video_captures vc on vc.id = x.montage_id where x.id = any(v_ids)));
end;
$$;
