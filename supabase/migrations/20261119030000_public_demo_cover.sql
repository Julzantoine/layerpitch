-- LayerPitch — la démo publique montre les vignettes choisies (19 novembre 2026).
--
-- Une vignette choisie sur un objet (project_assets.cover_file_id, migration 20261119010000_project_asset_cover) n'apparaissait pas dans la démo
-- publique : get_public_demo() ne rendait pas coverFileId, et project_file_is_public() ne reconnaissait que les fichiers d'un objet (file_id).
-- Corrigé : la démo rend coverFileId, et le fichier d'une vignette du Projet de démo est lisible sans compte (comme ses autres fichiers).
-- Rien d'autre ne change : les vignettes d'un autre Projet restent privées ; les copies des testeurs ne sont pas concernées.

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
          'url', x.url, 'fileId', x.file_id, 'coverFileId', x.cover_file_id, 'fileName', f.original_name, 'mimeType', f.mime_type, 'trackId', x.track_id, 'packId', x.pack_id,
          'albumId', x.album_id, 'montageId', x.montage_id, 'montageTitle', vc.title, 'trackTitle', t.title, 'packTitle', k.title, 'albumTitle', al.title, 'preview', x.preview,
          'createdAt', x.created_at, 'authorName', public.demo_display_name((select u.email from auth.users u where u.id = x.created_by)),
          'pinned', pin.asset_id is not null, 'starred', coalesce(pin.starred, false),
          'notes', (select count(*) from public.project_annotations a where a.target_type = 'asset' and a.target_id = x.id::text and not a.private))
          order by x.created_at), '[]'::jsonb)
        from public.project_assets x
        left join public.project_files f on f.id = x.file_id left join public.tracks t on t.id = x.track_id
        left join public.packs k on k.id = x.pack_id left join public.albums al on al.id = x.album_id
        left join public.video_captures vc on vc.id = x.montage_id
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

create or replace function public.project_file_is_public(p_file_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.path from public.project_files f
  where f.id = p_file_id and f.status = 'ready' and (
    exists (select 1 from public.project_assets x join public.projects pr on pr.id = x.project_id
            where (x.file_id = f.id or x.cover_file_id = f.id) and pr.public_demo)
    or exists (
      select 1 from public.project_assets x join public.project_vitrines v on v.project_id = x.project_id
      where x.file_id = f.id and v.published and (x.id = any(public.vitrine_asset_ids(v.blocks, v.logo_asset_id)) or x.id = v.bg_asset_id)))
  limit 1;
$$;
