-- LayerPitch — Projets, retours de l'essai réel du 28/09 (fin de soirée) et décisions prises dans la foulée.
--
--   1. PARADE au contournement des AdReels (décision du 28/09) : dans un Projet de COMPOSITEUR, une vitrine PUBLIQUE
--      publiée compte dans son quota d'AdReels (Rookie 3 / Warrior 10 / Boss illimité, matrice des paliers). Les vitrines
--      éditeur, les brouillons et les Projets de studio restent libres. Ce quota n'était jusqu'ici contrôlé NULLE PART côté
--      serveur (écrit dans la matrice, jamais vérifié) : upsert_ad_reel le vérifie désormais aussi, à la création d'un
--      AdReel (les AdReels existants ne sont jamais supprimés ni bloqués en modification). Bêta : tout le monde est Boss,
--      donc aucun effet tant que beta_program.full_access est actif.
--   2. Adresses des vitrines au nom du jeu : par défaut le titre du Projet (+ « -editeur » pour une vitrine éditeur) ;
--      les adresses en « v-<code> » issues de la reprise de l'ancienne vitrine sont renommées au nom du Projet.
--   3. Doublons : la taille des fichiers est renvoyée avec le contenu du Projet (même nom + même taille = déjà envoyé).
--   4. Image de fond d'une vitrine (bg_asset_id : une image du Projet, lisible avec la vitrine comme le logo).
--   5. Bloc Contact des vitrines : le message d'un visiteur arrive dans la DISCUSSION du Projet (auteur vide, en-tête
--      « Message reçu via la vitrine… »), donc dans la cloche de chaque membre. Sans compte, limité en fréquence.

-- ---- 1. Parade ----
-- Pages publiques d'un compositeur : ses AdReels + ses vitrines publiques publiées (Projets dont il est propriétaire).
create or replace function public.composer_public_pages_used(p_profile_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.ad_reels a join public.composer_profiles cp on cp.id = a.owner_id where cp.profile_id = p_profile_id)::int
       + (select count(*) from public.project_vitrines v join public.projects p on p.id = v.project_id
          where p.owner_kind = 'composer' and p.owner_profile_id = p_profile_id and v.published and v.audience = 'players')::int;
$$;

-- Lève une erreur si le propriétaire (compositeur) d'un Projet n'a plus de place pour une page publique de plus.
create or replace function public.assert_public_page_quota(p_project_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare p record; v_max numeric;
begin
  select * into p from public.projects where id = p_project_id;
  if p.owner_kind <> 'composer' then return; end if; -- Projets de studio : libres
  select amount into v_max from public.entitlement(p.owner_profile_id, 'ad_reels');
  if v_max is not null and public.composer_public_pages_used(p.owner_profile_id) >= v_max then
    raise exception 'Limite atteinte : % AdReels et vitrines publiques au total avec ce palier. Une vitrine publique compte comme un AdReel ; une vitrine éditeur (lien secret) reste libre.', v_max::int
      using hint = 'quota';
  end if;
end;
$$;

-- upsert_ad_reel : même contenu qu'en 20260927040000, plus le contrôle du quota à la CRÉATION d'un AdReel.
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
  v_profile jsonb := coalesce(payload->'profile', '{}'::jsonb);
  v_tier text;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_ad_reel_id is null or v_ad_reel_id = '' then raise exception 'payload.id manquant'; end if;
  -- Nouveau : un AdReel de plus doit tenir dans le quota (AdReels + vitrines publiques), jamais bloquant pour un AdReel
  -- qui existe déjà (modification, republication).
  if not exists (select 1 from public.ad_reels where owner_id = v_owner_id and id = v_ad_reel_id) then
    declare v_max numeric; v_profile_id uuid := (select profile_id from public.composer_profiles where id = v_owner_id);
    begin
      select amount into v_max from public.entitlement(v_profile_id, 'ad_reels');
      if v_max is not null and public.composer_public_pages_used(v_profile_id) >= v_max then
        raise exception 'Limite atteinte : % AdReels avec ce palier (les vitrines publiques de tes Projets comptent aussi).', v_max::int using hint = 'quota';
      end if;
    end;
  end if;
  perform public.assert_refs_owned('tracks', (select coalesce(array_agg(x), array[]::text[]) from jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb)) x), v_owner_id, 'morceau');
  perform public.assert_refs_owned('ad_reel_folders', array_remove(array[nullif(payload->>'folderId', '')], null), v_owner_id, 'dossier');

  -- Palier figé dans le contenu publié : décidé ICI, par le serveur, jamais lu tel quel dans le payload
  -- (avant le 23 septembre, la page l'envoyait dans profile.effectivePlan et rien ne le vérifiait : un
  -- compte Free pouvait s'attribuer "pro"). Palier RÉEL (composer_real_tier : bêta, admin, essai, plan),
  -- jamais l'aperçu admin. Seul un admin peut forcer le palier d'un AdReel (profile.adminTierOverride,
  -- vérifier son rendu public sous un autre palier) ; pour tout autre compte ce champ est retiré.
  v_tier := public.composer_real_tier(v_owner_id);
  if public.is_admin() and (v_profile->>'adminTierOverride') in ('free', 'starter', 'pro') then
    v_tier := v_profile->>'adminTierOverride';
  else
    v_profile := v_profile - 'adminTierOverride';
  end if;
  v_profile := jsonb_set(v_profile, '{effectivePlan}', to_jsonb(v_tier));

  insert into public.ad_reels (id, owner_id, folder_id, label, lang, profile, testimonials, blocks, track_overrides, allow_indexing, updated_at)
  values (
    v_ad_reel_id, v_owner_id, nullif(payload->>'folderId',''), coalesce(payload->>'label',''), coalesce(payload->>'lang','fr'),
    v_profile, coalesce(payload->'testimonials','[]'::jsonb),
    coalesce(payload->'blocks','[]'::jsonb), coalesce(payload->'trackOverrides','{}'::jsonb),
    coalesce((payload->>'allowIndexing')::boolean, true), now()
  )
  on conflict (owner_id, id) do update set
    folder_id = excluded.folder_id, label = excluded.label, lang = excluded.lang, profile = excluded.profile,
    testimonials = excluded.testimonials, blocks = excluded.blocks, track_overrides = excluded.track_overrides,
    allow_indexing = excluded.allow_indexing, updated_at = now();

  delete from public.ad_reel_tracks where owner_id = v_owner_id and ad_reel_id = v_ad_reel_id;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb))
  loop
    insert into public.ad_reel_tracks (owner_id, ad_reel_id, track_id, position) values (v_owner_id, v_ad_reel_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_ad_reel_id);
end;
$$;


-- ---- 2 et 4. Vitrines : image de fond, adresses au nom du jeu, bloc Contact ----
alter table public.project_vitrines add column bg_asset_id uuid references public.project_assets(id) on delete set null;
update public.project_vitrines v set slug = public.vitrine_free_slug(p.title, v.id)
  from public.projects p where p.id = v.project_id and v.slug ~ '^v-[0-9a-f]{12}$' and coalesce(p.title, '') <> '';

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
  where a.id is null or not ((c.t = 'tracks' and a.kind in ('track', 'audio')) or (c.t = 'video' and a.kind = 'video')
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
        'mimeType', f.mime_type, 'trackId', x.track_id, 'packId', x.pack_id, 'preview', x.preview)), '{}'::jsonb)
      from public.project_assets x left join public.project_files f on f.id = x.file_id where x.id = any(v_ids)));
end;
$$;


create or replace function public.project_file_is_public(p_file_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.path from public.project_files f join public.project_assets x on x.file_id = f.id
  where f.id = p_file_id and f.status = 'ready' and exists (
    select 1 from public.project_vitrines v where v.project_id = x.project_id and v.published and (x.id = any(public.vitrine_asset_ids(v.blocks, v.logo_asset_id)) or x.id = v.bg_asset_id))
  limit 1;
$$;


create or replace function public.project_file_path_by_vitrine_token(p_file_id uuid, p_token text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.path from public.project_files f join public.project_assets x on x.file_id = f.id
  where f.id = p_file_id and f.status = 'ready' and length(coalesce(p_token, '')) >= 16 and exists (
    select 1 from public.project_vitrines v where v.project_id = x.project_id and v.secret_token = p_token and (x.id = any(public.vitrine_asset_ids(v.blocks, v.logo_asset_id)) or x.id = v.bg_asset_id))
  limit 1;
$$;


-- ---- 3. Taille des fichiers dans le contenu du Projet (détection des doublons) ----
create or replace function public.get_project_content(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_role(p_project_id);
  return jsonb_build_object(
    'assets', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'origin', x.origin, 'title', x.title, 'body', x.body,
        'url', x.url, 'fileId', x.file_id, 'fileName', f.original_name, 'fileSize', f.size_bytes, 'mimeType', f.mime_type, 'trackId', x.track_id, 'packId', x.pack_id,
        'albumId', x.album_id, 'trackTitle', t.title, 'packTitle', k.title, 'albumTitle', al.title, 'preview', x.preview,
        'createdAt', x.created_at, 'authorEmail', (select u.email from auth.users u where u.id = x.created_by),
        'pinned', pin.asset_id is not null, 'starred', coalesce(pin.starred, false),
        'notes', (select count(*) from public.project_annotations a where a.target_type = 'asset' and a.target_id = x.id::text
          and (not a.private or a.author_id = auth.uid())))
        order by x.created_at), '[]'::jsonb)
      from public.project_assets x
      left join public.project_files f on f.id = x.file_id left join public.tracks t on t.id = x.track_id
      left join public.packs k on k.id = x.pack_id left join public.albums al on al.id = x.album_id
      left join public.project_moodboard_pins pin on pin.asset_id = x.id and pin.project_id = x.project_id
      where x.project_id = p_project_id),
    'moodboard', (select coalesce(jsonb_agg(p.asset_id order by p.position, p.created_at), '[]'::jsonb)
      from public.project_moodboard_pins p where p.project_id = p_project_id),
    'packs', (select coalesce(jsonb_agg(jsonb_build_object('packId', s.pack_id, 'title', k.title, 'illustration', k.illustration, 'mode', s.mode,
        'priceEurCents', k.price_eur_cents, 'subscriberCredits', k.subscriber_credits, 'mine', s.shared_by = auth.uid(),
        'sharedByEmail', (select u.email from auth.users u where u.id = s.shared_by)) order by s.created_at), '[]'::jsonb)
      from public.project_shared_packs s join public.packs k on k.id = s.pack_id where s.project_id = p_project_id),
    'albums', (select coalesce(jsonb_agg(jsonb_build_object('albumId', a.id, 'title', a.title, 'illustration', a.illustration, 'buyable', a.buyable)), '[]'::jsonb)
      from public.project_albums pa join public.albums a on a.id = pa.album_id where pa.project_id = p_project_id),
    'openAnnotations', (select count(*) from public.project_annotations where project_id = p_project_id and resolved_at is null
      and (not private or author_id = auth.uid())),
    'autoSnapshot', (select auto_snapshot from public.projects where id = p_project_id)
  );
end;
$$;


-- ---- 5. Bloc Contact d'une vitrine ----
create or replace function public.submit_vitrine_message(p_vitrine_id uuid, p_name text, p_email text, p_message text, p_token text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v record; v_ip text; v_bucket text; v_count int;
begin
  select * into v from public.project_vitrines where id = p_vitrine_id
    and (published or (length(coalesce(p_token, '')) >= 16 and secret_token = p_token));
  if not found then raise exception 'Vitrine introuvable'; end if;
  if not exists (select 1 from jsonb_array_elements(v.blocks) b where b->>'type' = 'contact') then raise exception 'Cette vitrine n''a pas de formulaire de contact'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'Nom manquant'; end if;
  if coalesce(p_email, '') !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p_email) > 200 then raise exception 'Adresse e-mail invalide'; end if;
  if length(trim(coalesce(p_message, ''))) not between 1 and 5000 then raise exception 'Message vide ou trop long'; end if;
  v_ip := coalesce(nullif(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1), ''), 'inconnu');
  v_bucket := 'vc:' || v_ip || ':' || floor(extract(epoch from now()) / 600)::text;
  insert into public.analytics_write_rate_limit (bucket_key, event_count) values (v_bucket, 1)
    on conflict (bucket_key) do update set event_count = analytics_write_rate_limit.event_count + 1
    returning event_count into v_count;
  if v_count > 5 then raise exception 'Trop de messages envoyés : réessaie dans quelques minutes'; end if;
  insert into public.project_messages (project_id, author_id, body)
  values (v.project_id, null, '📨 Message reçu via la vitrine « ' || coalesce(nullif(v.title, ''), v.slug) || ' » — ' || trim(p_name) || ' (' || trim(p_email) || ') :' || E'\n\n' || trim(p_message));
  update public.projects set updated_at = now() where id = v.project_id;
end;
$$;

revoke execute on function public.composer_public_pages_used(uuid), public.assert_public_page_quota(uuid) from public, anon, authenticated;
revoke execute on function public.submit_vitrine_message(uuid, text, text, text, text) from public;
grant execute on function public.submit_vitrine_message(uuid, text, text, text, text) to anon, authenticated;
