-- LayerPitch — chantier profils et permissions, étape 2b (28 septembre) : les verrous « admin jusqu'au feu vert »
-- écrits en dur (is_admin()) passent par la matrice des droits (20260927070000). Même effet aujourd'hui (feux verts
-- fermés = admin seulement ; bêta = tout le monde Boss), mais au feu vert il suffit d'appeler set_feature_released,
-- et après la bêta chaque palier reçoit exactement ce que dit la matrice.
--   * set_my_handle / set_my_ad_reel_slug        -> custom_address (Warrior et Boss, feu vert 'custom_address')
--   * versions vidéo (4 RPC du 26/09)             -> versioning au niveau 'saved' (Boss ; Warrior = session seulement,
--                                                    rien d'enregistré côté serveur ; feu vert 'versioning')
--   * save_video_capture                           -> test_in_game au niveau 'saved' (Boss, échelle du 15/09) :
--                                                    NOUVEAU contrôle — aujourd'hui sans effet (bêta = Boss pour tous).
-- i_level(fonction) : le mode accordé au compte connecté (NULL si refusé), pendant de i_can().

create or replace function public.i_level(p_feature text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select e.level from public.entitlement(auth.uid(), p_feature, false) e where e.allowed;
$$;
revoke execute on function public.i_level(text) from public, anon, authenticated;
grant execute on function public.i_level(text) to service_role;


create or replace function public.set_my_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_composer_id();
  v_new text := lower(trim(coalesce(p_handle, '')));
  v_old text;
begin
  if v_me is null then raise exception 'Non autorisé : aucun profil compositeur associé à ce compte'; end if;
  -- VERROU BÊTA (27/09) : à retirer au feu vert de Jules-Antoine.
  if not public.i_can('custom_address') then raise exception 'Non autorisé : adresse personnalisée réservée aux paliers Warrior et Boss'; end if;
  if v_new !~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$' then
    raise exception 'Nom invalide : 3 à 30 caractères, lettres minuscules, chiffres et tirets (pas au début ni à la fin)' using hint = 'invalid';
  end if;
  if public.handle_is_reserved(v_new) then raise exception 'Ce nom est réservé par LayerPitch' using hint = 'reserved'; end if;
  select handle into v_old from public.composer_profiles where id = v_me;
  if v_old = v_new then return v_new; end if;
  if exists (select 1 from public.composer_profiles where handle = v_new and id <> v_me)
     or exists (select 1 from public.composer_handle_aliases where handle = v_new and composer_id <> v_me) then
    raise exception 'Ce nom est déjà pris' using hint = 'taken';
  end if;
  -- Son propre ancien nom redevient le nom actuel : il quitte les anciens noms.
  delete from public.composer_handle_aliases where handle = v_new and composer_id = v_me;
  update public.composer_profiles set handle = v_new where id = v_me;
  if v_old is not null then
    insert into public.composer_handle_aliases (handle, composer_id) values (v_old, v_me) on conflict (handle) do nothing;
  end if;
  return v_new;
end;
$$;

create or replace function public.set_my_ad_reel_slug(p_ad_reel_id text, p_slug text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_composer_id();
  v_new text := nullif(lower(trim(coalesce(p_slug, ''))), '');
  v_old text;
  v_alias_owner text;
begin
  if v_me is null then raise exception 'Non autorisé : aucun profil compositeur associé à ce compte'; end if;
  -- VERROU BÊTA (27/09) : à retirer au feu vert de Jules-Antoine.
  if not public.i_can('custom_address') then raise exception 'Non autorisé : adresse personnalisée réservée aux paliers Warrior et Boss'; end if;
  if p_ad_reel_id = 'main' then raise exception 'L''AdReel principal est à la racine de ton adresse' using hint = 'main'; end if;
  if not exists (select 1 from public.ad_reels where owner_id = v_me and id = p_ad_reel_id) then
    raise exception 'AdReel introuvable : publie-le d''abord' using hint = 'unpublished';
  end if;
  if v_new is not null and v_new !~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$' then
    raise exception 'Nom invalide : lettres minuscules, chiffres et tirets (pas au début ni à la fin), 60 caractères au plus' using hint = 'invalid';
  end if;
  select slug into v_old from public.ad_reels where owner_id = v_me and id = p_ad_reel_id;
  if v_old is not distinct from v_new then return v_new; end if;
  if v_new is not null then
    if exists (select 1 from public.ad_reels where owner_id = v_me and slug = v_new and id <> p_ad_reel_id) then
      raise exception 'Un autre de tes AdReels porte déjà ce nom' using hint = 'taken';
    end if;
    select ad_reel_id into v_alias_owner from public.ad_reel_slug_aliases where owner_id = v_me and slug = v_new;
    if v_alias_owner is not null and v_alias_owner <> p_ad_reel_id then
      raise exception 'Ce nom mène déjà à un autre de tes AdReels (ancienne adresse gardée pour les liens partagés)' using hint = 'alias';
    end if;
    delete from public.ad_reel_slug_aliases where owner_id = v_me and slug = v_new;
  end if;
  update public.ad_reels set slug = v_new where owner_id = v_me and id = p_ad_reel_id;
  if v_old is not null then
    insert into public.ad_reel_slug_aliases (owner_id, slug, ad_reel_id) values (v_me, v_old, p_ad_reel_id) on conflict do nothing;
  end if;
  return v_new;
end;
$$;

create or replace function public.save_video_capture_version(
  p_id text,
  p_capture_id text,
  p_title text,
  p_substitutions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_capture_owner uuid;
  v_existing public.video_capture_versions;
  v_now timestamptz := now();
begin
  if v_owner_id is null or coalesce(public.i_level('versioning'), '') <> 'saved' then
    raise exception 'Non autorisé';
  end if;
  if p_id is null or p_id = '' then raise exception 'id manquant'; end if;
  if jsonb_typeof(coalesce(p_substitutions, '{}'::jsonb)) <> 'object' then raise exception 'substitutions invalides'; end if;

  select owner_id into v_capture_owner from public.video_captures where id = p_capture_id;
  if v_capture_owner is null or v_capture_owner <> v_owner_id then
    raise exception 'Montage introuvable';
  end if;

  select * into v_existing from public.video_capture_versions where id = p_id;
  if v_existing.id is not null and (v_existing.owner_id <> v_owner_id or v_existing.capture_id <> p_capture_id) then
    raise exception 'Non autorisé : cette version appartient à un autre montage';
  end if;

  insert into public.video_capture_versions (id, capture_id, owner_id, title, substitutions, updated_at)
  values (p_id, p_capture_id, v_owner_id, coalesce(p_title, ''), coalesce(p_substitutions, '{}'::jsonb), v_now)
  on conflict (id) do update set
    title = excluded.title, substitutions = excluded.substitutions, updated_at = v_now;

  return jsonb_build_object('ok', true, 'id', p_id, 'updatedAt', v_now);
end;
$$;

create or replace function public.list_video_capture_versions(p_capture_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_result jsonb;
begin
  if v_owner_id is null or coalesce(public.i_level('versioning'), '') <> 'saved' then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'captureId', capture_id, 'title', title, 'substitutions', substitutions,
    'lastExportVideoId', last_export_video_id, 'createdAt', created_at, 'updatedAt', updated_at
  ) order by created_at), '[]'::jsonb)
  into v_result
  from public.video_capture_versions
  where capture_id = p_capture_id and owner_id = v_owner_id;
  return v_result;
end;
$$;

create or replace function public.set_video_capture_version_export(p_id text, p_video_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null or coalesce(public.i_level('versioning'), '') <> 'saved' then
    raise exception 'Non autorisé';
  end if;
  if p_video_id is not null and not exists (select 1 from public.composer_videos where id = p_video_id and owner_id = v_owner_id) then
    raise exception 'Vidéo introuvable';
  end if;
  update public.video_capture_versions set last_export_video_id = p_video_id, updated_at = now()
  where id = p_id and owner_id = v_owner_id;
end;
$$;

create or replace function public.delete_video_capture_version(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null or coalesce(public.i_level('versioning'), '') <> 'saved' then
    raise exception 'Non autorisé';
  end if;
  delete from public.video_capture_versions where id = p_id and owner_id = v_owner_id;
end;
$$;

create or replace function public.save_video_capture(
  p_id text,
  p_pack_id text,
  p_title text,
  p_video_filename text,
  p_events jsonb,
  p_lane_overrides jsonb default '{}'::jsonb,
  p_collapsed_groups jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
  v_pack_owner uuid;
  v_now timestamptz := now();
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  -- Enregistrer un montage = palier Boss (échelle du 15/09 : Rookie capture seule, Warrior modifiable sans enregistrement).
  if coalesce(public.i_level('test_in_game'), '') <> 'saved' then
    raise exception 'Non autorisé : enregistrer un montage est réservé au palier Boss';
  end if;
  if p_id is null or p_id = '' then raise exception 'id manquant'; end if;
  if p_pack_id is null or p_pack_id = '' then raise exception 'pack_id manquant'; end if;

  select owner_id into v_pack_owner from public.packs where id = p_pack_id;
  if v_pack_owner is not null and v_pack_owner <> v_owner_id then
    raise exception 'Non autorisé : ce pack appartient à un autre compositeur';
  end if;

  select owner_id into v_existing_owner from public.video_captures where id = p_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : cette prise appartient à un autre compositeur';
  end if;

  insert into public.video_captures (id, owner_id, pack_id, title, video_filename, events, lane_overrides, collapsed_groups, updated_at)
  values (p_id, v_owner_id, p_pack_id, coalesce(p_title, ''), p_video_filename,
    coalesce(p_events, '[]'::jsonb), coalesce(p_lane_overrides, '{}'::jsonb), coalesce(p_collapsed_groups, '{}'::jsonb), v_now)
  on conflict (id) do update set
    title = excluded.title, video_filename = excluded.video_filename,
    events = excluded.events, lane_overrides = excluded.lane_overrides, collapsed_groups = excluded.collapsed_groups,
    updated_at = v_now;

  return jsonb_build_object('ok', true, 'id', p_id, 'updatedAt', v_now);
end;
$$;
