-- LayerPitch — attribution automatique d'un handle à la création du profil compositeur (comblait un
-- trou documenté depuis le 3 septembre : 20260903120100_composer_handle.sql posait la colonne et la
-- résolution en lecture mais laissait explicitement "l'attribution réelle... à construire dans le
-- chantier flux d'inscription" -- jamais fait depuis, si bien que tout compositeur autre que
-- Jules-Antoine (handle mis à la main ce jour-là) n'avait jamais de lien public du tout, pas
-- seulement temporairement le temps du chargement (voir computeAdReelUrl(), layerpitch-backstage.html).
--
-- Slug dérivé de l'email (avant @), même esprit que slug() côté JS (layerpitch-backstage.html) mais
-- réimplémenté ici en SQL -- pas d'unaccent() supposé disponible, simplification acceptée (un email
-- reste presque toujours ASCII). Collision avec un handle déjà pris OU avec un mot réservé (même
-- liste que la contrainte CHECK existante) : suffixe numérique incrémental jusqu'à trouver un
-- candidat libre.
create or replace function public.ensure_composer_profile()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_email text;
  v_base text;
  v_candidate text;
  v_suffix int := 0;
  v_reserved constant text[] := array['pack','collection','index','video-test','admin-beta-console','admin-analytics','layerpitch-backstage','api','docs','scripts','supabase','404','u','data'];
begin
  if v_uid is null then
    raise exception 'Non autorisé : aucune session active';
  end if;

  select id into v_id from public.composer_profiles where profile_id = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  select email into v_email from auth.users where id = v_uid;
  v_base := trim(both '-' from lower(regexp_replace(split_part(coalesce(v_email, 'compositeur'), '@', 1), '[^a-zA-Z0-9]+', '-', 'g')));
  if v_base = '' then v_base := 'compositeur'; end if;

  v_candidate := v_base;
  while (v_candidate = any(v_reserved)) or exists (select 1 from public.composer_profiles where handle = v_candidate) loop
    v_suffix := v_suffix + 1;
    v_candidate := v_base || '-' || v_suffix;
  end loop;

  insert into public.composer_profiles (profile_id, handle) values (v_uid, v_candidate) returning id into v_id;
  return v_id;
end;
$$;

-- Rattrapage des 3 comptes déjà créés sans handle (tous des comptes de test de Jules-Antoine lui-même,
-- confirmé le 15/09 -- aucun vrai compositeur externe impacté), même logique de slug que ci-dessus,
-- appliquée une fois pour ces lignes précises.
do $$
declare
  v_row record;
  v_base text;
  v_candidate text;
  v_suffix int;
  v_reserved constant text[] := array['pack','collection','index','video-test','admin-beta-console','admin-analytics','layerpitch-backstage','api','docs','scripts','supabase','404','u','data'];
begin
  for v_row in
    select cp.id, u.email
    from public.composer_profiles cp
    join auth.users u on u.id = cp.profile_id
    where cp.handle is null
    order by cp.created_at
  loop
    v_base := trim(both '-' from lower(regexp_replace(split_part(coalesce(v_row.email, 'compositeur'), '@', 1), '[^a-zA-Z0-9]+', '-', 'g')));
    if v_base = '' then v_base := 'compositeur'; end if;
    v_candidate := v_base;
    v_suffix := 0;
    while (v_candidate = any(v_reserved)) or exists (select 1 from public.composer_profiles where handle = v_candidate) loop
      v_suffix := v_suffix + 1;
      v_candidate := v_base || '-' || v_suffix;
    end loop;
    update public.composer_profiles set handle = v_candidate where id = v_row.id;
  end loop;
end $$;
