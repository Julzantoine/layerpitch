-- LayerPitch — les copies de la démo partagent les fichiers de la source, « comme pour les morceaux d'exemple » (19 novembre 2026).
--
-- Demande de Jules-Antoine : agir pour le projet d'exemple des bêta-testeurs comme pour les morceaux d'exemple. Les images, vidéos envoyées,
-- fichiers et vignettes choisies de la démo (ex. l'image « Disclaimer ») arrivent donc dans les copies, mais SANS être copiés : la copie pointe
-- vers les mêmes fichiers que la source (project_files de la source). Garde-fous :
--   * le testeur ne peut jamais supprimer ni remplacer un fichier de la source (delete_project_file exige un rôle dans le Projet du fichier) ;
--   * supprimer un objet d'une copie ne supprime PLUS le fichier que s'il appartient au même Projet et n'est plus utilisé nulle part
--     (avant : delete_project_asset effaçait la ligne du fichier, ce qui aurait détruit celui de la source) ;
--   * supprimer la copie ne touche pas aux fichiers (ils ne sont pas à elle) ; ils ne comptent pas dans son stockage ;
--   * lecture : project_file_is_public (Projet de démo, objets et vignettes) ; si la source supprime un fichier, l'objet disparaît des copies.

create or replace function public.delete_project_asset(p_asset_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_path text;
begin
  select * into r from public.project_assets where id = p_asset_id;
  if not found then raise exception 'Objet introuvable'; end if;
  perform public.assert_project_role(r.project_id);
  -- Le chemin n'est rendu (donc le fichier n'est effacé du stockage) que si le fichier est à CE Projet et qu'aucun autre objet ne l'utilise.
  select f.path into v_path from public.project_files f
    where f.id = r.file_id and f.project_id = r.project_id
      and not exists (select 1 from public.project_assets o where o.file_id = f.id and o.id <> r.id);
  delete from public.project_annotations where project_id = r.project_id and target_type = 'asset' and target_id = r.id::text;
  delete from public.project_assets where id = p_asset_id;
  if v_path is not null then delete from public.project_files where id = r.file_id; end if;
  perform public.log_project_activity(r.project_id, 'asset_removed', jsonb_build_object('kind', r.kind,
    'title', coalesce(nullif(r.title, ''), (select title from public.tracks where id = r.track_id), (select title from public.packs where id = r.pack_id), '')));
  return v_path;
end;
$$;

create or replace function public._copy_demo_project(v_uid uuid, v_src public.projects, v_studio uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid;
  v_ids jsonb := '{}'::jsonb;
  v_shift interval;
  v_txt text;
  v_k text;
  v_v text;
  r record;
begin
  insert into public.projects (title, description, owner_kind, owner_profile_id, owner_studio_id, created_by, demo_source_id)
  values (v_src.title, v_src.description, case when v_studio is not null then 'studio' else 'composer' end,
          case when v_studio is not null then null else v_uid end, v_studio, v_uid, v_src.id)
  returning id into v_new;
  insert into public.project_activity (project_id, actor_id, kind) values (v_new, v_uid, 'project_created');

  -- Nouveaux identifiants, tous réservés d'avance (les références croisées sont redirigées plus bas).
  for r in select id from public.project_sections where project_id = v_src.id loop
    v_ids := v_ids || jsonb_build_object(r.id::text, gen_random_uuid()::text);
  end loop;
  for r in select id from public.project_assets where project_id = v_src.id loop
    v_ids := v_ids || jsonb_build_object(r.id::text, gen_random_uuid()::text);
  end loop;
  for r in select id from public.project_maps where project_id = v_src.id loop
    v_ids := v_ids || jsonb_build_object(r.id::text, gen_random_uuid()::text);
  end loop;
  for r in select id from public.project_messages where project_id = v_src.id loop
    v_ids := v_ids || jsonb_build_object(r.id::text, gen_random_uuid()::text);
  end loop;

  -- Sections (l'arbre : le parent est rattaché une fois toutes les sections créées).
  insert into public.project_sections (id, project_id, parent_id, title, position, created_by, created_at)
    select (v_ids->>s.id::text)::uuid, v_new, null, s.title, s.position, v_uid, s.created_at
    from public.project_sections s where s.project_id = v_src.id;
  update public.project_sections n set parent_id = (v_ids->>s.parent_id::text)::uuid
    from public.project_sections s
    where s.project_id = v_src.id and s.parent_id is not null and n.id = (v_ids->>s.id::text)::uuid;

  -- Objets de la réserve : notes, liens, morceaux / packs / albums / montages (simples liens vers la source) ET objets à fichier (image, audio,
  -- fichier, vidéo envoyée, vignette choisie) : comme les morceaux d'exemple, les fichiers sont PARTAGÉS avec la source, jamais copiés (la copie
  -- pointe vers la même ligne project_files ; lecture ouverte par project_file_is_public, ni envoi ni suppression possibles par le testeur).
  insert into public.project_assets (id, project_id, kind, origin, title, body, url, file_id, cover_file_id, track_id, pack_id, album_id, montage_id, preview, created_by, created_at, updated_at)
    select (v_ids->>a.id::text)::uuid, v_new, a.kind, a.origin, a.title, a.body, a.url, a.file_id, a.cover_file_id, a.track_id, a.pack_id, a.album_id, a.montage_id, a.preview,
           v_uid, a.created_at, a.updated_at
    from public.project_assets a where a.project_id = v_src.id;
  insert into public.project_moodboard_pins (project_id, asset_id, position, starred, pinned_by, created_at)
    select v_new, (v_ids->>p.asset_id::text)::uuid, p.position, p.starred, v_uid, p.created_at
    from public.project_moodboard_pins p where p.project_id = v_src.id and v_ids ? p.asset_id::text;
  insert into public.project_section_assets (section_id, asset_id, added_by, created_at)
    select (v_ids->>sa.section_id::text)::uuid, (v_ids->>sa.asset_id::text)::uuid, v_uid, sa.created_at
    from public.project_section_assets sa
    where sa.section_id in (select id from public.project_sections where project_id = v_src.id) and v_ids ? sa.asset_id::text;
  insert into public.project_shared_packs (project_id, pack_id, shared_by, mode, created_at)
    select v_new, sp.pack_id, v_uid, 'share', sp.created_at from public.project_shared_packs sp where sp.project_id = v_src.id;

  -- Cartes de niveau, puis le lien section -> carte.
  insert into public.project_maps (id, project_id, title, data, created_by, created_at, updated_at)
    select (v_ids->>m.id::text)::uuid, v_new, m.title, m.data, v_uid, m.created_at, m.updated_at
    from public.project_maps m where m.project_id = v_src.id;
  update public.project_sections n set map_id = (v_ids->>s.map_id::text)::uuid
    from public.project_sections s
    where s.project_id = v_src.id and s.map_id is not null and n.id = (v_ids->>s.id::text)::uuid;

  -- Discussion : les messages (déjà signés par leur personnage dans le texte) sont à ton nom, datés de la veille.
  select (now() - interval '1 hour') - coalesce(max(created_at), now()) into v_shift from public.project_messages where project_id = v_src.id;
  insert into public.project_messages (id, project_id, author_id, body, created_at)
    select (v_ids->>m.id::text)::uuid, v_new, v_uid, m.body, m.created_at + v_shift
    from public.project_messages m where m.project_id = v_src.id;

  -- Notes de la timeline (non privées, sans destinataire).
  insert into public.project_annotations (project_id, author_id, addressee_id, target_type, target_id, at_seconds, at_part, body, resolved_at, resolved_by, created_at, private)
    select v_new, v_uid, null, a.target_type, coalesce(v_ids->>a.target_id, a.target_id), a.at_seconds, a.at_part, a.body, a.resolved_at,
           case when a.resolved_at is not null then v_uid end, a.created_at, false
    from public.project_annotations a
    where a.project_id = v_src.id and not a.private
      and (a.target_type not in ('asset', 'message') or v_ids ? a.target_id);

  -- Tâches (cases cochées conservées, personne assignée : aucune).
  insert into public.project_tasks (project_id, section_id, title, notes, done, done_at, done_by, assignee_id, due_date, link_type, link_id, link_sub, position, created_by, created_at, updated_at)
    select v_new, (v_ids->>t.section_id::text)::uuid, t.title, t.notes, t.done, t.done_at, case when t.done then v_uid end, null, t.due_date,
           case when t.link_id is not null and v_ids ? t.link_id::text then t.link_type end,
           case when t.link_id is not null and v_ids ? t.link_id::text then (v_ids->>t.link_id::text)::uuid end,
           case when t.link_id is not null and v_ids ? t.link_id::text then t.link_sub end,
           t.position, v_uid, t.created_at, t.updated_at
    from public.project_tasks t where t.project_id = v_src.id;

  -- Apparence (photo de fond) NON copiée : les testeurs arrivent sur un fond neutre, avec toute la place pour le contenu.

  -- Vitrines : recopiées NON publiées, adresse libre à chaque fois (l'adresse est unique sur tout le site) ; les objets cités dans
  -- les blocs sont redirigés vers les copies.
  for r in select * from public.project_vitrines where project_id = v_src.id loop
    v_txt := r.blocks::text;
    for v_k, v_v in select key, value from jsonb_each_text(v_ids) loop
      v_txt := replace(v_txt, '"' || v_k || '"', '"' || v_v || '"');
    end loop;
    insert into public.project_vitrines (project_id, audience, display, title, subtitle, logo_asset_id, bg_asset_id, slug, published, secret_token, theme, blocks, created_by)
    values (v_new, r.audience, r.display, r.title, r.subtitle, (v_ids->>r.logo_asset_id::text)::uuid, (v_ids->>r.bg_asset_id::text)::uuid,
            public.vitrine_free_slug(r.title), false, case when r.audience = 'publisher' then replace(gen_random_uuid()::text, '-', '') end,
            r.theme, v_txt::jsonb, v_uid);
  end loop;


  update public.projects set demo_source_version = v_src.demo_version where id = v_new;
  return v_new;
end;
$$;
