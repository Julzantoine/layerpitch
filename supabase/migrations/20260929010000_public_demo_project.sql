-- Projet de démonstration public, en lecture seule (29/09, chantier « nouvelle landing » : la page Studio montre un vrai
-- Projet, sans compte). ÉCRITE MAIS PAS ENCORE APPLIQUÉE.
--
-- Principe (validé avec Jules-Antoine) :
--   * un seul Projet à la fois porte la marque projects.public_demo ; seuls les administrateurs et le compte de démo
--     (contact@layerpitch.com, membre du Projet) peuvent la poser ou la retirer ;
--   * UNE fonction de lecture, get_public_demo(), appelable sans compte, rend d'un coup ce Projet (contenu, messages, activité,
--     notes non privées, membres, vitrines publiées) et rien d'autre ; elle n'écrit jamais. Les fonctions des vrais Projets
--     (get_project, get_project_content, …) ne sont pas touchées ;
--   * les fichiers du Projet de démo sont lisibles sans compte, comme ceux d'une vitrine publiée (project_file_is_public) ;
--   * les adresses e-mail ne sont jamais rendues : seule la partie avant l'@ sert de nom affiché.
-- À vérifier avant d'ouvrir au public : project_activity.payload est rendu tel quel ; il ne doit contenir aucune donnée
-- personnelle réelle dans le Projet de démo (comptes fictifs uniquement).

alter table public.projects add column public_demo boolean not null default false;
create unique index projects_one_public_demo on public.projects (public_demo) where public_demo;

-- Nom affiché à la place de l'adresse e-mail : la partie avant l'@.
create or replace function public.demo_display_name(p_email text)
returns text
language sql
immutable
as $$ select nullif(split_part(coalesce(p_email, ''), '@', 1), '') $$;

-- Poser / retirer la marque. Poser la marque sur un Projet la retire à l'ancien (un seul à la fois).
create or replace function public.set_public_demo(p_project_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_email text;
begin
  select u.email into v_email from auth.users u where u.id = auth.uid();
  if not (public.is_admin() or (lower(coalesce(v_email, '')) = 'contact@layerpitch.com' and public.project_role(p_project_id, auth.uid()) is not null)) then
    raise exception 'Réservé aux administrateurs et au compte de démonstration';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then raise exception 'Projet introuvable'; end if;
  if p_on then update public.projects set public_demo = false where public_demo and id <> p_project_id; end if;
  update public.projects set public_demo = coalesce(p_on, false) where id = p_project_id;
end;
$$;

-- État de la démo pour l'interrupteur de la page Projet (7/10, « construire la démo depuis mon profil admin ») : { eligible, projectId }.
-- eligible = administrateur ou compte de démo ; projectId = le Projet actuellement marqué (null s'il n'y en a pas). Lecture seule ;
-- un compte ordinaire reçoit { eligible: false } et jamais le numéro du Projet.
create or replace function public.get_public_demo_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_email text;
begin
  select u.email into v_email from auth.users u where u.id = auth.uid();
  if not (public.is_admin() or lower(coalesce(v_email, '')) = 'contact@layerpitch.com') then
    return jsonb_build_object('eligible', false);
  end if;
  return jsonb_build_object('eligible', true, 'projectId', (select p.id from public.projects p where p.public_demo limit 1));
end;
$$;

-- Lecture publique du Projet de démonstration. Rend null s'il n'y en a pas.
create or replace function public.get_public_demo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare p record;
begin
  select * into p from public.projects where public_demo limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'project', jsonb_build_object('id', p.id, 'title', p.title, 'description', p.description, 'ownerKind', p.owner_kind,
      'createdAt', p.created_at, 'updatedAt', p.updated_at),
    'members', (
      select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
        select jsonb_build_object('name', public.demo_display_name(u.email), 'role', public.project_role(p.id, a.profile_id)) x
        from public.studio_accounts(p.owner_studio_id) a join auth.users u on u.id = a.profile_id where p.owner_kind = 'studio'
        union all
        select jsonb_build_object('name', public.demo_display_name(u.email), 'role', 'admin')
        from auth.users u where u.id = p.created_by and p.owner_kind = 'composer'
        union all
        select jsonb_build_object('name', public.demo_display_name(m.email), 'role', 'member')
        from public.project_members m where m.project_id = p.id and m.status = 'active'
      ) s(x)),
    'content', jsonb_build_object(
      'assets', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'origin', x.origin, 'title', x.title, 'body', x.body,
          'url', x.url, 'fileId', x.file_id, 'fileName', f.original_name, 'mimeType', f.mime_type, 'trackId', x.track_id, 'packId', x.pack_id,
          'albumId', x.album_id, 'trackTitle', t.title, 'packTitle', k.title, 'albumTitle', al.title, 'preview', x.preview,
          'createdAt', x.created_at, 'authorName', public.demo_display_name((select u.email from auth.users u where u.id = x.created_by)),
          'pinned', pin.asset_id is not null, 'starred', coalesce(pin.starred, false),
          'notes', (select count(*) from public.project_annotations a where a.target_type = 'asset' and a.target_id = x.id::text and not a.private))
          order by x.created_at), '[]'::jsonb)
        from public.project_assets x
        left join public.project_files f on f.id = x.file_id left join public.tracks t on t.id = x.track_id
        left join public.packs k on k.id = x.pack_id left join public.albums al on al.id = x.album_id
        left join public.project_moodboard_pins pin on pin.asset_id = x.id and pin.project_id = x.project_id
        where x.project_id = p.id),
      'moodboard', (select coalesce(jsonb_agg(pn.asset_id order by pn.position, pn.created_at), '[]'::jsonb)
        from public.project_moodboard_pins pn where pn.project_id = p.id),
      'packs', (select coalesce(jsonb_agg(jsonb_build_object('packId', s.pack_id, 'title', k.title, 'illustration', k.illustration, 'mode', s.mode,
          'priceEurCents', k.price_eur_cents) order by s.created_at), '[]'::jsonb)
        from public.project_shared_packs s join public.packs k on k.id = s.pack_id where s.project_id = p.id),
      'albums', (select coalesce(jsonb_agg(jsonb_build_object('albumId', a.id, 'title', a.title, 'illustration', a.illustration)), '[]'::jsonb)
        from public.project_albums pa join public.albums a on a.id = pa.album_id where pa.project_id = p.id)),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'createdAt', m.created_at,
        'authorName', public.demo_display_name((select u.email from auth.users u where u.id = m.author_id)),
        'attachments', (select coalesce(jsonb_agg(jsonb_build_object('assetId', x.id, 'kind', x.kind, 'title', x.title, 'fileId', x.file_id,
            'fileName', f.original_name, 'mimeType', f.mime_type) order by ma.position), '[]'::jsonb)
          from public.project_message_assets ma join public.project_assets x on x.id = ma.asset_id
          left join public.project_files f on f.id = x.file_id where ma.message_id = m.id))
        order by m.created_at desc), '[]'::jsonb)
      from (select * from public.project_messages where project_id = p.id order by created_at desc limit 100) m),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('kind', a.kind, 'payload', a.payload, 'createdAt', a.created_at,
        'actorName', public.demo_display_name((select u.email from auth.users u where u.id = a.actor_id))) order by a.created_at desc), '[]'::jsonb)
      from (select * from public.project_activity where project_id = p.id order by created_at desc limit 100) a),
    'annotations', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'targetType', a.target_type, 'targetId', a.target_id,
        'atSeconds', a.at_seconds, 'atPart', a.at_part, 'body', a.body, 'resolved', a.resolved_at is not null, 'createdAt', a.created_at,
        'authorName', public.demo_display_name((select u.email from auth.users u where u.id = a.author_id)))
        order by a.at_seconds nulls last, a.created_at), '[]'::jsonb)
      from public.project_annotations a where a.project_id = p.id and not a.private),
    -- Seules les vitrines publiques et publiées (jamais le lien secret d'une vitrine éditeur).
    'vitrines', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'subtitle', v.subtitle, 'slug', v.slug,
        'display', v.display) order by v.created_at), '[]'::jsonb)
      from public.project_vitrines v where v.project_id = p.id and v.published and v.audience = 'players')
  );
end;
$$;

-- Fichiers : lisibles sans compte s'ils figurent dans une vitrine publiée (blocs, logo ou image de fond, comme dans la
-- version de 20260928220000, dont on repart) OU appartiennent au Projet de démo.
create or replace function public.project_file_is_public(p_file_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.path from public.project_files f join public.project_assets x on x.file_id = f.id
  where f.id = p_file_id and f.status = 'ready' and (
    exists (select 1 from public.projects pr where pr.id = x.project_id and pr.public_demo)
    or exists (
      select 1 from public.project_vitrines v where v.project_id = x.project_id and v.published and (x.id = any(public.vitrine_asset_ids(v.blocks, v.logo_asset_id)) or x.id = v.bg_asset_id)))
  limit 1;
$$;

revoke execute on function public.set_public_demo(uuid, boolean), public.get_public_demo(), public.get_public_demo_status() from public, anon;
grant execute on function public.set_public_demo(uuid, boolean), public.get_public_demo_status() to authenticated;
grant execute on function public.get_public_demo() to anon, authenticated;
