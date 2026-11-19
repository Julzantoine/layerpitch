-- LayerPitch — mises à jour du Projet de démonstration chez les testeurs (19 novembre 2026).
--
-- Demande de Jules-Antoine : la démo va évoluer avec les retours ; les comptes qui l'ont déjà la reçoivent à jour
-- AUTOMATIQUEMENT, avec un message « le projet d'exemple a été mis à jour ».
--   * Tu publies une version quand tu veux (publish_demo_update, bouton à côté de « Démo publique ») : tes retouches en cours
--     ne partent pas toutes seules ;
--   * à leur prochaine ouverture (Backstage, espace studio, page Projets), les copies plus anciennes sont REMPLACÉES par la
--     version publiée (leurs modifications sont perdues, le message le dit) ; une démo supprimée ne revient pas ;
--   * un compte qui reçoit la démo pour la première fois a directement la version publiée.
-- Mêmes garde-fous que 20261118020000 (rien de lourd copié, jamais publique, hors quota).

alter table public.projects add column demo_version int not null default 1;       -- sur la source : version publiée aux copies
alter table public.projects add column demo_source_version int;                    -- sur une copie : version de la source au moment de la copie

insert into public.platform_message_templates (key, title, body) values (
  'demo_project_updated',
  jsonb_build_object('fr', 'Le projet de démo a été mis à jour', 'en', 'The demo project has been updated'),
  jsonb_build_object(
    'fr', $msg_fr$Salut, c'est Jules-Antoine.

Le projet d'exemple a été mis à jour : j'y ai apporté des améliorations suite aux retours des testeurs. Ta copie de « Dernier Étage » a été remplacée par la nouvelle version (les modifications que tu y avais faites n'ont donc pas été conservées).

Tu peux toujours la supprimer avec le bouton « Supprimer la démo » si tu n'en as plus besoin.$msg_fr$,
    'en', $msg_en$Hi, it's Jules-Antoine.

The example project has been updated: I've made improvements following testers' feedback. Your copy of “Dernier Étage” has been replaced with the new version (so the changes you had made to it were not kept).

You can still delete it with the “Delete the demo” button if you no longer need it.$msg_en$
  )
) on conflict (key) do nothing;

create or replace function public.admin_update_native_message(p_key text, p_body jsonb, p_title jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  if p_key is null or p_key not in ('welcome', 'welcome_studio', 'examples', 'demo_project', 'demo_project_updated') then
    raise exception 'Message natif inconnu : %', p_key;
  end if;
  if jsonb_typeof(p_body) is distinct from 'object' then
    raise exception 'p_body doit être un objet JSON (une clé par code langue)';
  end if;
  if p_title is not null and jsonb_typeof(p_title) is distinct from 'object' then
    raise exception 'p_title doit être un objet JSON (une clé par code langue) ou null';
  end if;
  insert into public.platform_message_templates (key, body, title)
    values (p_key, p_body, coalesce(p_title, '{}'::jsonb))
  on conflict (key) do update
    set body = excluded.body, title = excluded.title, updated_at = now();
end;
$$;
grant execute on function public.admin_update_native_message(text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Copie d'un Projet de démo dans un compte (interne : ni droits ni message ici). v_studio : copie dans l'espace de ce studio.
-- ---------------------------------------------------------------------------------------------------------------------
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
  for r in select id from public.project_assets where project_id = v_src.id and file_id is null loop
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

  -- Objets de la réserve : notes, liens, morceaux / packs / albums / montages (simples liens vers la source). Les objets qui
  -- reposent sur un fichier déposé dans le Projet (image, audio, fichier, vidéo envoyée) ne sont pas repris.
  insert into public.project_assets (id, project_id, kind, origin, title, body, url, track_id, pack_id, album_id, montage_id, preview, created_by, created_at, updated_at)
    select (v_ids->>a.id::text)::uuid, v_new, a.kind, a.origin, a.title, a.body, a.url, a.track_id, a.pack_id, a.album_id, a.montage_id, a.preview,
           v_uid, a.created_at, a.updated_at
    from public.project_assets a where a.project_id = v_src.id and a.file_id is null;
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
revoke execute on function public._copy_demo_project(uuid, public.projects, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Mise à jour des copies plus anciennes que la version publiée : remplacées (même espace : compositeur ou studio), un seul message.
-- Une copie supprimée ne revient pas (rien à remplacer).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._sync_demo_copies(v_uid uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.projects%rowtype;
  r record;
  v_n int := 0;
  v_tpl record;
begin
  select * into v_src from public.projects where public_demo limit 1;
  if not found then return 0; end if;
  for r in select id, owner_studio_id from public.projects
           where demo_source_id is not null and created_by = v_uid and not public_demo
             and (demo_source_id <> v_src.id or coalesce(demo_source_version, 0) < v_src.demo_version)
  loop
    delete from public.projects where id = r.id;
    perform public._copy_demo_project(v_uid, v_src, r.owner_studio_id);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    select * into v_tpl from public.platform_message_templates where key = 'demo_project_updated';
    if found then
      insert into public.admin_messages (body, title, recipient_id) values (v_tpl.body, v_tpl.title, v_uid);
    end if;
  end if;
  return v_n;
end;
$$;
revoke execute on function public._sync_demo_copies(uuid) from public, anon, authenticated;

-- Publier une version de la démo aux copies : réservé aux administrateurs, sur le Projet marqué démo publique.
create or replace function public.publish_demo_update()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_ver int;
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  update public.projects set demo_version = demo_version + 1 where public_demo returning id, demo_version into v_id, v_ver;
  if v_id is null then raise exception 'Aucun Projet n''est marqué comme démo publique'; end if;
  return jsonb_build_object('projectId', v_id, 'version', v_ver);
end;
$$;
revoke execute on function public.publish_demo_update() from public, anon;
grant execute on function public.publish_demo_update() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- seed_my_demo_project : ajout la première fois, MISE À JOUR ensuite (mêmes appels côté pages).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.seed_my_demo_project(p_as_studio boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_src public.projects%rowtype;
  v_studio uuid;
  v_seeded timestamptz;
  v_new uuid;
  v_tpl record;
begin
  if v_uid is null then return jsonb_build_object('skipped', 'auth'); end if;
  if not public.feature_released('example_project', v_uid) then return jsonb_build_object('skipped', 'flag'); end if;
  if not coalesce((select onboarding_completed from public.profiles where id = v_uid), false) then
    return jsonb_build_object('skipped', 'onboarding');
  end if;
  select demo_project_seeded_at into v_seeded from public.profiles where id = v_uid for update;
  if v_seeded is not null then
    return jsonb_build_object('skipped', 'done', 'updated', public._sync_demo_copies(v_uid));
  end if;

  select * into v_src from public.projects where public_demo limit 1;
  if not found then return jsonb_build_object('skipped', 'no_source'); end if;
  if v_src.created_by = v_uid then return jsonb_build_object('skipped', 'source_owner'); end if;
  if p_as_studio then
    select id into v_studio from public.studio_profiles where profile_id = v_uid;
    if v_studio is null then return jsonb_build_object('skipped', 'no_studio'); end if;
  elsif public.current_composer_id() is null then
    return jsonb_build_object('skipped', 'no_composer');
  end if;

  update public.profiles set demo_project_seeded_at = now() where id = v_uid;
  v_new := public._copy_demo_project(v_uid, v_src, v_studio);

  select * into v_tpl from public.platform_message_templates where key = 'demo_project';
  if found then
    insert into public.admin_messages (body, title, recipient_id) values (v_tpl.body, v_tpl.title, v_uid);
  end if;

  return jsonb_build_object('seeded', true, 'projectId', v_new);
end;
$$;
revoke execute on function public.seed_my_demo_project(boolean) from public, anon;
grant execute on function public.seed_my_demo_project(boolean) to authenticated;

-- Les copies déjà faites (migration 20261118020000) perdent leur photo de fond : même arrivée pour tout le monde.
delete from public.project_appearance where project_id in (select id from public.projects where demo_source_id is not null);
