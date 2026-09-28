-- LayerPitch — espace Projet, étape 6 (cadrage du 28/09 §4 et §8) : vitrines MULTIPLES en blocs, au format de l'AdReel.
--
--   * project_vitrines : plusieurs vitrines par Projet (illimité, Q8), audience players (publique) | publisher (éditeur,
--     lien secret sans compte, révocable : Q3), affichage page (défilement) | slides (une page par bloc, façon pitch.com),
--     adresse /vitrine/<nom> (unique, tirée du titre, modifiable), thème au format de ad_reels.profile.theme, blocs au
--     format des blocs d'AdReel mais qui pointent vers des objets de la réserve (assetIds) :
--       header { } (titre / sous-titre / logo de la vitrine) · text { title, content, align } · tracks { assetIds }
--       · video { assetIds } · photo { assetIds, align, caption } · packs { assetIds } · links { links: [{ label, url }] }.
--   * Fichiers privés (captures envoyées, ébauches audio) autorisés partout (Q7) : la page d'édition avertit. Lecture
--     publique d'un fichier = il figure dans une vitrine publiée, ou on présente le lien secret d'une vitrine éditeur.
--   * La vitrine unique d'avant (project_showcases) devient la première vitrine publique du Projet ; anciennes tables et
--     fonctions supprimées.
--   * « vitrine » ajouté aux noms réservés (adresses personnalisées) : /vitrine/<nom> mène à vitrine.html (404.html).

create or replace function public.handle_is_reserved(p_handle text)
returns boolean
language sql
immutable
as $$
  select p_handle = any(array[
    'index','pack','collection','admin','admin-beta-console','admin-analytics','bienvenue','landing','landing-en',
    'layerpitch-backstage','library','mes-albums','mon-compte','video-test','video-engine-prototype','404',
    'api','audio','images','fonts','video','vendor','sandbox','scripts','supabase','docs','data','u','landing-assets',
    'node_modules','assets','static','www','app','beta','layerpitch','help','aide','support','contact','login','signup',
    'vitrine','projet','projets','studio','catalogue','tarifs','invitation'
  ]);
$$;

-- Nom d'adresse tiré d'un titre : minuscules, sans accents, tirets.
create or replace function public.vitrine_slugify(p_title text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(left(trim(both '-' from regexp_replace(lower(translate(coalesce(p_title, ''),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŒÆ', 'aaaaaaceeeeiiiinooooouuuuyyoaAAAAAACEEEEIIIINOOOOOUUUUYOA')), '[^a-z0-9]+', '-', 'g')), 60), ''), 'vitrine')
$$;

create table public.project_vitrines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  audience text not null default 'players' check (audience in ('players', 'publisher')),
  display text not null default 'page' check (display in ('page', 'slides')),
  title text not null default '',
  subtitle text not null default '',
  logo_asset_id uuid references public.project_assets(id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
  published boolean not null default false,
  secret_token text unique,
  theme jsonb not null default '{}'::jsonb,
  blocks jsonb not null default '[]'::jsonb,
  from_snapshot_id uuid references public.project_snapshots(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_vitrines_project_idx on public.project_vitrines(project_id, created_at);
alter table public.project_vitrines enable row level security;

-- Adresse libre : le nom demandé, sinon suivi de -2, -3…
create or replace function public.vitrine_free_slug(p_wanted text, p_except uuid default null)
returns text
language plpgsql
stable
as $$
declare v_base text := public.vitrine_slugify(p_wanted); v text := v_base; i int := 1;
begin
  while exists (select 1 from public.project_vitrines where slug = v and id is distinct from p_except) loop
    i := i + 1; v := left(v_base, 56) || '-' || i;
  end loop;
  return v;
end;
$$;

-- Identifiants d'objets cités par des blocs.
create or replace function public.vitrine_asset_ids(p_blocks jsonb, p_logo uuid default null)
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct x::uuid), '{}') from (
    select jsonb_array_elements_text(coalesce(b->'assetIds', '[]'::jsonb)) as x from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) b
    union all select p_logo::text where p_logo is not null
  ) t where x ~ '^[0-9a-f-]{36}$';
$$;

-- ---- Reprise de la vitrine unique d'avant ----
insert into public.project_vitrines (project_id, audience, title, slug, published, blocks, created_at, updated_at)
select s.project_id, 'players', s.title, 'v-' || left(replace(s.project_id::text, '-', ''), 12), s.published,
  (select coalesce(jsonb_agg(b order by o, op), '[]'::jsonb) from (
    select 1 as o, 0 as op, jsonb_build_object('id', 'b1', 'type', 'header') as b
    union all select 2, 0, jsonb_build_object('id', 'b2', 'type', 'text', 'content', s.intro, 'align', 'left') where coalesce(s.intro, '') <> ''
    union all select 3, 0, jsonb_build_object('id', 'b3', 'type', 'links', 'links', jsonb_build_array(jsonb_build_object('label', 'Steam', 'url', s.steam_url))) where s.steam_url is not null
    union all select 4, k.p, jsonb_build_object('id', 'b4-' || k.type, 'type', k.type, 'assetIds', k.ids) from (
      select case x.kind when 'track' then 'tracks' when 'video' then 'video' else 'photo' end as type,
             jsonb_agg(x.id order by a.position) as ids, min(a.position) as p
      from public.project_showcase_assets a join public.project_assets x on x.id = a.asset_id
      where a.project_id = s.project_id group by 1) k
  ) blocks),
  s.updated_at, s.updated_at
from public.project_showcases s;
update public.project_vitrines set slug = public.vitrine_free_slug(title, id) where title <> '';

drop function public.save_project_showcase(uuid, jsonb);
drop function public.get_project_showcase(uuid);
drop function public.project_asset_publishable(uuid);
drop table public.project_showcase_assets;
drop table public.project_showcases;

-- ---- Lecture (membres) ----
create or replace function public.list_project_vitrines(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_admin boolean;
begin
  perform public.assert_project_role(p_project_id);
  v_admin := public.project_role(p_project_id, auth.uid()) = 'admin';
  return (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'audience', v.audience, 'display', v.display, 'title', v.title, 'subtitle', v.subtitle,
      'logoAssetId', v.logo_asset_id, 'slug', v.slug, 'published', v.published, 'secretToken', case when v_admin then v.secret_token end,
      'theme', v.theme, 'blocks', v.blocks, 'fromSnapshotId', v.from_snapshot_id, 'createdAt', v.created_at, 'updatedAt', v.updated_at) order by v.created_at), '[]'::jsonb)
    from public.project_vitrines v where v.project_id = p_project_id);
end;
$$;

-- ---- Création / enregistrement ----
-- p : { id?, audience, display, title, subtitle, logoAssetId, slug, published, theme, blocks }. Tous les membres préparent ;
-- seuls les administrateurs publient ou dépublient (Q6) : pour un membre simple, « published » garde sa valeur.
create or replace function public.save_project_vitrine(p_project_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean; v_id uuid := nullif(p->>'id', '')::uuid; v_old_slug text; v_old_pub boolean := false; v_blocks jsonb := coalesce(p->'blocks', '[]'::jsonb);
  v_audience text := coalesce(p->>'audience', 'players'); v_slug text; v_pub boolean; v_b jsonb; v_l jsonb; v_bad int;
begin
  perform public.assert_project_role(p_project_id);
  v_admin := public.project_role(p_project_id, auth.uid()) = 'admin';
  if v_audience not in ('players', 'publisher') then raise exception 'Audience inconnue'; end if;
  if coalesce(p->>'display', 'page') not in ('page', 'slides') then raise exception 'Affichage inconnu'; end if;
  if jsonb_typeof(v_blocks) <> 'array' or jsonb_array_length(v_blocks) > 60 then raise exception 'Blocs invalides (60 au plus)'; end if;
  for v_b in select * from jsonb_array_elements(v_blocks) loop
    if coalesce(v_b->>'type', '') not in ('header', 'text', 'tracks', 'video', 'photo', 'packs', 'links') then raise exception 'Type de bloc inconnu (%)', v_b->>'type'; end if;
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
  if v_id is not null then
    select slug, published into v_old_slug, v_old_pub from public.project_vitrines where id = v_id and project_id = p_project_id;
    if not found then raise exception 'Vitrine introuvable'; end if;
  end if;
  -- Adresse : celle demandée (si libre et non réservée), sinon tirée du titre.
  v_slug := public.vitrine_slugify(coalesce(nullif(p->>'slug', ''), p->>'title', 'vitrine'));
  if public.handle_is_reserved(v_slug) then v_slug := v_slug || '-vitrine'; end if;
  if exists (select 1 from public.project_vitrines where slug = v_slug and id is distinct from v_id) then
    if nullif(p->>'slug', '') is not null and (v_id is null or v_old_slug <> v_slug) then raise exception 'Cette adresse est déjà prise : %', v_slug; end if;
    v_slug := public.vitrine_free_slug(v_slug, v_id);
  end if;
  v_pub := case when v_admin then coalesce((p->>'published')::boolean, false) else coalesce(v_old_pub, false) end;
  if v_id is null then
    insert into public.project_vitrines (project_id, audience, display, title, subtitle, logo_asset_id, slug, published, secret_token, theme, blocks, created_by)
    values (p_project_id, v_audience, coalesce(p->>'display', 'page'), left(coalesce(p->>'title', ''), 200), left(coalesce(p->>'subtitle', ''), 300),
            nullif(p->>'logoAssetId', '')::uuid, v_slug, v_pub, case when v_audience = 'publisher' then replace(gen_random_uuid()::text, '-', '') end,
            coalesce(p->'theme', '{}'::jsonb), v_blocks, auth.uid())
    returning id into v_id;
  else
    update public.project_vitrines set audience = v_audience, display = coalesce(p->>'display', 'page'), title = left(coalesce(p->>'title', ''), 200),
      subtitle = left(coalesce(p->>'subtitle', ''), 300), logo_asset_id = nullif(p->>'logoAssetId', '')::uuid, slug = v_slug, published = v_pub,
      secret_token = case when v_audience = 'publisher' then coalesce(secret_token, replace(gen_random_uuid()::text, '-', '')) end,
      theme = coalesce(p->'theme', '{}'::jsonb), blocks = v_blocks, updated_at = now()
    where id = v_id;
  end if;
  perform public.log_project_activity(p_project_id, 'showcase_saved', jsonb_build_object('title', coalesce(p->>'title', ''), 'published', v_pub));
  return jsonb_build_object('id', v_id, 'slug', v_slug, 'published', v_pub);
end;
$$;

create or replace function public.delete_project_vitrine(p_vitrine_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_vitrines where id = p_vitrine_id;
  if not found then raise exception 'Vitrine introuvable'; end if;
  perform public.assert_project_role(r.project_id, r.published); -- une vitrine publiée : administrateur seulement
  delete from public.project_vitrines where id = p_vitrine_id;
  perform public.log_project_activity(r.project_id, 'showcase_deleted', jsonb_build_object('title', r.title));
end;
$$;

-- Nouveau lien secret (l'ancien cesse de fonctionner). Administrateur seulement.
create or replace function public.renew_vitrine_token(p_vitrine_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare r record; v text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into r from public.project_vitrines where id = p_vitrine_id;
  if not found or r.audience <> 'publisher' then raise exception 'Vitrine éditeur introuvable'; end if;
  perform public.assert_project_role(r.project_id, true);
  update public.project_vitrines set secret_token = v, updated_at = now() where id = p_vitrine_id;
  return v;
end;
$$;

-- « En faire une vitrine » depuis une version du Moodboard : un brouillon, un bloc par sorte d'objet (épingles dans l'ordre).
create or replace function public.vitrine_from_snapshot(p_snapshot_id uuid, p_audience text default 'publisher')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s record; v_blocks jsonb; v_links jsonb; v_res jsonb;
begin
  select * into s from public.project_snapshots where id = p_snapshot_id;
  if not found then raise exception 'Version introuvable'; end if;
  perform public.assert_project_role(s.project_id);
  with pins as (
    select (e->>'assetId')::uuid as aid, o from jsonb_array_elements(s.data) with ordinality t(e, o)
  ), a as (select x.*, pins.o from pins join public.project_assets x on x.id = pins.aid and x.project_id = s.project_id)
  select coalesce(jsonb_agg(blk order by ord), '[]'::jsonb) into v_blocks from (
    select 0 as ord, jsonb_build_object('id', 'h', 'type', 'header') as blk
    union all select min(o), jsonb_build_object('id', 'k-' || grp, 'type', grp, 'assetIds', jsonb_agg(id order by o)) from (
      select id, o, case when kind in ('track', 'audio') then 'tracks' when kind = 'video' then 'video' when kind = 'image' then 'photo' when kind = 'pack' then 'packs' end as grp from a
    ) g where grp is not null group by grp
  ) z;
  select jsonb_agg(jsonb_build_object('label', coalesce(nullif(x.title, ''), x.preview->>'title', x.url), 'url', x.url) order by pins.o) into v_links
  from (select (e->>'assetId')::uuid as aid, o from jsonb_array_elements(s.data) with ordinality t(e, o)) pins
  join public.project_assets x on x.id = pins.aid where x.kind = 'link';
  if v_links is not null then v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('id', 'links', 'type', 'links', 'links', v_links)); end if;
  v_res := public.save_project_vitrine(s.project_id, jsonb_build_object('audience', coalesce(p_audience, 'publisher'), 'title', s.label, 'published', false, 'blocks', v_blocks));
  update public.project_vitrines set from_snapshot_id = s.id where id = (v_res->>'id')::uuid;
  return v_res;
end;
$$;

-- ---- Lecture PUBLIQUE (sans compte) ----
-- Par adresse (vitrine publiée), par lien secret (vitrine éditeur, publiée ou non), ou par identifiant pour un membre
-- (aperçu d'un brouillon). Renvoie la vitrine et les objets cités, rien d'autre du Projet.
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
  v_ids := public.vitrine_asset_ids(v.blocks, v.logo_asset_id);
  return jsonb_build_object('id', v.id, 'audience', v.audience, 'display', v.display, 'title', v.title, 'subtitle', v.subtitle,
    'logoAssetId', v.logo_asset_id, 'slug', v.slug, 'published', v.published, 'theme', v.theme, 'blocks', v.blocks,
    'projectTitle', (select title from public.projects where id = v.project_id),
    'assets', (select coalesce(jsonb_object_agg(x.id, jsonb_build_object('kind', x.kind, 'title', x.title, 'url', x.url, 'fileId', x.file_id,
        'mimeType', f.mime_type, 'trackId', x.track_id, 'packId', x.pack_id, 'preview', x.preview)), '{}'::jsonb)
      from public.project_assets x left join public.project_files f on f.id = x.file_id where x.id = any(v_ids)));
end;
$$;

-- Un fichier du Projet est-il lisible sans compte ? Oui s'il figure dans une vitrine publiée (Q7 : tous types), ou dans
-- la vitrine éditeur dont on présente le lien secret.
create or replace function public.project_file_is_public(p_file_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.path from public.project_files f join public.project_assets x on x.file_id = f.id
  where f.id = p_file_id and f.status = 'ready' and exists (
    select 1 from public.project_vitrines v where v.project_id = x.project_id and v.published and x.id = any(public.vitrine_asset_ids(v.blocks, v.logo_asset_id)))
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
    select 1 from public.project_vitrines v where v.project_id = x.project_id and v.secret_token = p_token and x.id = any(public.vitrine_asset_ids(v.blocks, v.logo_asset_id)))
  limit 1;
$$;

revoke execute on function public.list_project_vitrines(uuid), public.save_project_vitrine(uuid, jsonb), public.delete_project_vitrine(uuid),
  public.renew_vitrine_token(uuid), public.vitrine_from_snapshot(uuid, text) from public, anon;
grant execute on function public.list_project_vitrines(uuid), public.save_project_vitrine(uuid, jsonb), public.delete_project_vitrine(uuid),
  public.renew_vitrine_token(uuid), public.vitrine_from_snapshot(uuid, text) to authenticated;
revoke execute on function public.get_vitrine(text, text, uuid) from public;
grant execute on function public.get_vitrine(text, text, uuid) to anon, authenticated;
revoke execute on function public.project_file_is_public(uuid), public.project_file_path_by_vitrine_token(uuid, text) from public, anon, authenticated;
grant execute on function public.project_file_is_public(uuid), public.project_file_path_by_vitrine_token(uuid, text) to service_role;
