-- LayerPitch — « Voir en tant que » complet pour l'admin (28 septembre, demande de Jules-Antoine : « passer d'une
-- manière fluide d'une casquette à l'autre et d'un palier à l'autre, pour pouvoir tout tester »).
--
-- Existait déjà : palier compositeur simulé (admins.preview_tier) et palier studio simulé (admins.preview_studio_plan).
-- Ajouté :
--   - la CASQUETTE simulée (admins.preview_role) : 'composer' (compositeur seul), 'studio' (studio seul), 'fan' (ni
--     l'un ni l'autre) ; NULL = toutes ses casquettes réelles. Effet d'AFFICHAGE : les pages masquent le profil
--     écarté (LayerPitchAuth.getMyComposerId / getMyStudioId renvoient null) ; le serveur, lui, ne change rien ;
--   - « masquer ce qui n'est pas encore ouvert » (admins.preview_hide_unreleased) : un admin voit toujours toutes les
--     fonctions réservées (feux verts) ; avec cette case, ses propres feux verts se comportent comme pour un compte
--     ordinaire, pour voir exactement ce que voit un vrai utilisateur. Les outils admin (dont ce sélecteur) restent
--     accessibles : ils dépendent de is_admin(), pas des feux verts.
-- Tout est mémorisé côté serveur (survit au rechargement et suit l'admin de page en page) et ne concerne QUE sa
-- propre session.

alter table public.admins
  add column preview_role text check (preview_role is null or preview_role in ('composer', 'studio', 'fan')),
  add column preview_hide_unreleased boolean not null default false;

create or replace function public.feature_released(p_key text, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select f.released from public.feature_flags f where f.key = p_key), true)
      or exists (select 1 from public.admins a where a.profile_id = p_profile_id
                 and not (a.preview_hide_unreleased and p_profile_id = auth.uid()));
$$;

-- État de l'aperçu de l'admin connecté (null pour un compte ordinaire).
create or replace function public.my_admin_preview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('role', a.preview_role, 'composerTier', a.preview_tier, 'studioPlan', a.preview_studio_plan,
                            'hideUnreleased', a.preview_hide_unreleased)
  from public.admins a where a.profile_id = auth.uid();
$$;
revoke execute on function public.my_admin_preview() from public, anon;
grant execute on function public.my_admin_preview() to authenticated;

-- Réglage en une fois (valeurs vides = retour à l'accès admin normal pour ce réglage).
create or replace function public.set_my_admin_preview(p_role text, p_composer_tier text, p_studio_plan text, p_hide_unreleased boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Non autorisé : réservé aux admins'; end if;
  if nullif(p_role, '') is not null and p_role not in ('composer', 'studio', 'fan') then
    raise exception 'p_role doit valoir composer, studio, fan (ou vide)';
  end if;
  if nullif(p_composer_tier, '') is not null and p_composer_tier not in ('free', 'starter', 'pro') then
    raise exception 'p_composer_tier doit valoir free, starter, pro (ou vide)';
  end if;
  if nullif(p_studio_plan, '') is not null and p_studio_plan not in ('solodev', 'indie', 'aa', 'aaa') then
    raise exception 'p_studio_plan doit valoir solodev, indie, aa, aaa (ou vide)';
  end if;
  update public.admins set preview_role = nullif(p_role, ''), preview_tier = nullif(p_composer_tier, ''),
    preview_studio_plan = nullif(p_studio_plan, ''), preview_hide_unreleased = coalesce(p_hide_unreleased, false)
  where profile_id = auth.uid();
end;
$$;
revoke execute on function public.set_my_admin_preview(text, text, text, boolean) from public, anon;
grant execute on function public.set_my_admin_preview(text, text, text, boolean) to authenticated;
