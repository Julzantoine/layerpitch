-- LayerPitch — le Projet de démonstration arrive dans les Projets de chaque bêta-testeur (18 novembre 2026).
--
-- Demande de Jules-Antoine : « on suit exactement le même principe que les morceaux de démo » (migration
-- 20261104020000_example_content_and_onboarding_profile.sql). Donc :
--   * chaque compte reçoit UNE FOIS, après l'accueil, une copie À LUI et modifiable du Projet marqué projects.public_demo
--     (aujourd'hui « Dernier Étage ») : discussion, sections, Moodboard, tâches, cartes de niveau, apparence, vitrines ;
--   * compositeur → Projet de compositeur, studio (propriétaire du studio) → Projet de studio ; le marqueur est sur le compte
--     (profiles.demo_project_seeded_at) : jamais rajouté, même après suppression ;
--   * RIEN de lourd n'est copié : le pack, les morceaux et le montage vidéo restent ceux de la source (le Projet n'en garde qu'un
--     lien), les fichiers déposés dans le Projet (images, audio…) ne sont pas repris ; supprimer la copie ne touche donc jamais
--     aux fichiers ni aux morceaux de la source ;
--   * la copie n'est jamais la démo publique, ses vitrines sont recopiées NON publiées (adresse libre, sans lien public) ;
--   * elle ne compte pas dans la limite de Projets du palier (une personne au quota peut créer son propre Projet) ;
--   * « Supprimer la démo » (remove_my_demo_project) l'efface d'un coup, avec une cloche explicative à l'arrivée.
-- Feu vert admin d'abord (fermé au départ) :
--   select public.set_feature_released('example_project', true);

alter table public.projects add column demo_source_id uuid;   -- Projet dont celui-ci est la copie de démonstration (pas de clé étrangère : la source peut changer ou disparaître)
alter table public.profiles add column demo_project_seeded_at timestamptz;

insert into public.feature_flags (key, description) values
  ('example_project', 'Projet de démonstration copié une fois dans les Projets de chaque compte (18/11) — admin seulement jusqu''à l''ouverture.')
on conflict (key) do nothing;

-- Message de la boîte de réception (brouillon à relire par Jules-Antoine : modifiable depuis le panneau admin).
insert into public.platform_message_templates (key, title, body) values (
  'demo_project',
  jsonb_build_object('fr', 'Un projet de démo dans tes Projets', 'en', 'A demo project in your Projects'),
  jsonb_build_object(
    'fr', $msg_fr$Salut, c'est Jules-Antoine.

Pour que tu puisses essayer l'espace Projet sans rien préparer, j'ai ajouté dans tes Projets un projet de démonstration : « Dernier Étage », un jeu d'horreur imaginé pour l'occasion. Tu y trouveras une discussion d'équipe, un Moodboard, des tâches, une carte de niveau, des sections et une vidéo avec deux versions de musique.

Il est à toi : modifie-le, essaie toutes les fonctions, casse tout si tu veux. Quand tu n'en as plus besoin, le bouton « Supprimer la démo » (en haut du projet, ou dans la liste de tes Projets) l'efface d'un coup, et il ne reviendra pas.

Le contenu de la démo est en français.$msg_fr$,
    'en', $msg_en$Hi, it's Jules-Antoine.

So you can try the Project space without preparing anything, I've added a demo project to your Projects: “Dernier Étage”, a horror game made up for the occasion. You'll find a team discussion, a Moodboard, tasks, a level map, sections and a video with two music versions.

It's yours: edit it, try every feature, break it if you like. When you no longer need it, the “Delete the demo” button (at the top of the project, or in your Projects list) wipes it in one go, and it won't come back.

The demo content is in French.$msg_en$
  )
) on conflict (key) do nothing;

-- Le message devient modifiable depuis le panneau admin, comme 'welcome', 'welcome_studio' et 'examples'.
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
  if p_key is null or p_key not in ('welcome', 'welcome_studio', 'examples', 'demo_project') then
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
-- Une copie de démo ne compte pas dans la limite de Projets du palier (create_project : seule la ligne de comptage change).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.create_project(p_title text, p_description text default '', p_as_studio boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid;
  v_ent record;
  v_count int;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if p_as_studio then
    v_studio := public.account_studio_id(auth.uid());
    if v_studio is null then raise exception 'Aucun profil studio pour ce compte'; end if;
    select * into v_ent from public.entitlement(auth.uid(), 'studio_projects', false);
    select count(*) into v_count from public.projects where owner_studio_id = v_studio and archived_at is null and demo_source_id is null;
  else
    if public.current_composer_id() is null then raise exception 'Aucun profil compositeur pour ce compte'; end if;
    select * into v_ent from public.entitlement(auth.uid(), 'projects', false);
    select count(*) into v_count from public.projects where owner_kind = 'composer' and owner_profile_id = auth.uid() and archived_at is null and demo_source_id is null;
  end if;
  if not coalesce(v_ent.allowed, false) then raise exception 'Créer un Projet n''est pas inclus dans ton palier' using hint = 'plan'; end if;
  if v_ent.amount is not null and v_count >= v_ent.amount then
    raise exception 'Limite atteinte : % Projet(s) actif(s) pour ton palier', v_ent.amount::int using hint = 'quota';
  end if;
  insert into public.projects (title, description, owner_kind, owner_profile_id, owner_studio_id, created_by)
  values (coalesce(nullif(trim(p_title), ''), 'Projet sans nom'), coalesce(p_description, ''),
          case when p_as_studio then 'studio' else 'composer' end,
          case when p_as_studio then null else auth.uid() end, v_studio, auth.uid())
  returning id into v_id;
  insert into public.project_activity (project_id, actor_id, kind) values (v_id, auth.uid(), 'project_created');
  return v_id;
end;
$$;

-- La liste et la fiche d'un Projet disent si c'est une copie de démo (bouton « Supprimer la démo »).
create or replace function public.list_my_projects()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'description', p.description, 'ownerKind', p.owner_kind,
    'role', public.project_role(p.id, auth.uid()), 'archived', p.archived_at is not null, 'updatedAt', p.updated_at,
    'isDemo', p.demo_source_id is not null,
    'unread', (select count(*) from public.project_notifications n where n.project_id = p.id and n.profile_id = auth.uid() and n.read_at is null)
  ) order by p.updated_at desc), '[]'::jsonb)
  from public.projects p
  where auth.uid() is not null and public.feature_released('projects', auth.uid()) and public.project_role(p.id, auth.uid()) is not null;
$$;

create or replace function public.get_project(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text := public.assert_project_role(p_project_id);
begin
  return (select jsonb_build_object(
    'id', p.id, 'title', p.title, 'description', p.description, 'ownerKind', p.owner_kind, 'role', v_role,
    'archived', p.archived_at is not null, 'createdAt', p.created_at, 'updatedAt', p.updated_at,
    'isDemo', p.demo_source_id is not null,
    'members', (
      select coalesce(jsonb_agg(x order by x->>'email'), '[]'::jsonb) from (
        select jsonb_build_object('profileId', a.profile_id, 'email', (select u.email from auth.users u where u.id = a.profile_id),
               'status', 'active', 'source', 'team', 'role', public.project_role(p.id, a.profile_id), 'me', a.profile_id = auth.uid()) x
        from public.studio_accounts(p.owner_studio_id) a where p.owner_kind = 'studio'
        union all
        select jsonb_build_object('profileId', p.created_by, 'email', (select u.email from auth.users u where u.id = p.created_by),
               'status', 'active', 'source', 'owner', 'role', 'admin', 'me', p.created_by = auth.uid())
        where p.owner_kind = 'composer'
        union all
        select jsonb_build_object('id', m.id, 'profileId', m.profile_id, 'email', m.email, 'status', m.status, 'source', 'guest',
               'role', case when m.status = 'active' then 'member' end, 'me', m.profile_id = auth.uid())
        from public.project_members m where m.project_id = p.id
      ) s(x))
  ) from public.projects p where p.id = p_project_id);
end;
$$;

-- Une copie de démo ne devient jamais la démo publique (celle de la landing) : seule la source l'est.
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
  if p_on and exists (select 1 from public.projects where id = p_project_id and demo_source_id is not null) then
    raise exception 'Une copie de démonstration ne peut pas devenir la démo publique';
  end if;
  if p_on then update public.projects set public_demo = false where public_demo and id <> p_project_id; end if;
  update public.projects set public_demo = coalesce(p_on, false) where id = p_project_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Ajout : appelé par le Backstage (compositeur), l'accueil studio et la page Projets. Le serveur décide de tout.
-- p_as_studio : copie dans l'espace du studio (propriétaire du studio seulement) au lieu de celui du compositeur.
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
  v_ids jsonb := '{}'::jsonb;       -- ancien id -> nouvel id (sections, objets, cartes, messages)
  v_shift interval;
  v_txt text;
  v_k text;
  v_v text;
  r record;
  v_tpl record;
begin
  if v_uid is null then return jsonb_build_object('skipped', 'auth'); end if;
  if not public.feature_released('example_project', v_uid) then return jsonb_build_object('skipped', 'flag'); end if;
  -- Après l'accueil seulement (même raison que les exemples : le message de bienvenue passe en premier).
  if not coalesce((select onboarding_completed from public.profiles where id = v_uid), false) then
    return jsonb_build_object('skipped', 'onboarding');
  end if;
  -- Verrou de la ligne : deux onglets ouverts en même temps ne copient pas deux fois.
  select demo_project_seeded_at into v_seeded from public.profiles where id = v_uid for update;
  if v_seeded is not null then return jsonb_build_object('skipped', 'done'); end if;

  select * into v_src from public.projects where public_demo limit 1;
  if not found then return jsonb_build_object('skipped', 'no_source'); end if;
  -- Le propriétaire de la démo ne s'en fait pas une copie de son propre Projet.
  if v_src.created_by = v_uid then return jsonb_build_object('skipped', 'source_owner'); end if;
  if p_as_studio then
    select id into v_studio from public.studio_profiles where profile_id = v_uid;
    if v_studio is null then return jsonb_build_object('skipped', 'no_studio'); end if;
  elsif public.current_composer_id() is null then
    return jsonb_build_object('skipped', 'no_composer');
  end if;

  update public.profiles set demo_project_seeded_at = now() where id = v_uid;

  insert into public.projects (title, description, owner_kind, owner_profile_id, owner_studio_id, created_by, demo_source_id)
  values (v_src.title, v_src.description, case when p_as_studio then 'studio' else 'composer' end,
          case when p_as_studio then null else v_uid end, v_studio, v_uid, v_src.id)
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

  insert into public.project_appearance (project_id, data, updated_by)
    select v_new, ap.data, v_uid from public.project_appearance ap where ap.project_id = v_src.id;

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

  -- Message de la boîte de réception (personnel, sans e-mail).
  select * into v_tpl from public.platform_message_templates where key = 'demo_project';
  if found then
    insert into public.admin_messages (body, title, recipient_id) values (v_tpl.body, v_tpl.title, v_uid);
  end if;

  return jsonb_build_object('seeded', true, 'projectId', v_new);
end;
$$;
revoke execute on function public.seed_my_demo_project(boolean) from public, anon;
grant execute on function public.seed_my_demo_project(boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Suppression en un clic : toutes les copies de démo de la personne, d'un coup. Les fichiers, morceaux, packs et montages de la
-- source ne sont jamais touchés (la copie n'en garde que des liens). L'ajout ne se refait pas ensuite.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.remove_my_demo_project()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  delete from public.projects where demo_source_id is not null and created_by = auth.uid() and not public_demo;
  get diagnostics v_n = row_count;
  return jsonb_build_object('removed', v_n);
end;
$$;
revoke execute on function public.remove_my_demo_project() from public, anon;
grant execute on function public.remove_my_demo_project() to authenticated;
