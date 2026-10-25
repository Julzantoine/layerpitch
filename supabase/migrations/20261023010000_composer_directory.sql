-- LayerPitch — Annuaire des compositeurs (23/10, demande de Jules-Antoine). Une page publique (sans compte) qui liste les
-- compositeurs : photo, nom, bio courte, mots-clés ; un clic mène à leur AdReel principal (/<identifiant>/) ; un bouton
-- « Contacter » écrit au compositeur sans jamais révéler son adresse (Edge Function submit-contact-message, { handle }).
--
--   * Décisions : visible par défaut pour tout le monde (case « directory_opt_in » cochée d'office, y compris pour les comptes
--     existants — le compositeur peut la décocher) ; les mots-clés sont remplis par le compositeur ; tous au même niveau pour
--     l'instant MAIS l'ordre met déjà les paliers payants en tête (Boss, puis Warrior, puis Rookie), puis un ordre qui change
--     chaque jour (équitable). Pendant la bêta tout le monde est « Boss » (beta_full_access) : la liste est donc mélangée.
--   * Feu vert 'composer_directory' (admin seulement pendant la bêta : À OUVRIR AU LANCEMENT). directory_status() dit si
--     l'annuaire est ouvert POUR L'APPELANT ; composer_directory() renvoie une liste vide tant qu'il ne l'est pas.
--   * N'apparaît que le compositeur avec un identifiant public, un AdReel principal, un compte actif (ni suspendu ni en
--     cours de suppression) et la case cochée.

alter table public.composer_profiles alter column directory_opt_in set default true;
update public.composer_profiles set directory_opt_in = true where directory_opt_in is distinct from true;

alter table public.composer_profiles add column directory_keywords text[] not null default '{}';
comment on column public.composer_profiles.directory_keywords is 'Mots-clés choisis par le compositeur pour l''annuaire (styles, genres, instruments…) : 12 au plus, 30 caractères chacun.';

insert into public.feature_flags (key, description) values
  ('composer_directory', 'Annuaire des compositeurs public (23/10). Admin seulement pendant la bêta : À OUVRIR AU LANCEMENT (puis prévenir les compositeurs).')
on conflict (key) do nothing;

create or replace function public.directory_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('open', coalesce((select f.released from public.feature_flags f where f.key = 'composer_directory'), false)
                                    or (auth.uid() is not null and exists (select 1 from public.admins a where a.profile_id = auth.uid())));
$$;
grant execute on function public.directory_status() to anon, authenticated;

create or replace function public.composer_directory()
returns table (handle text, name text, bio text, photo text, keywords text[], tier text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce((public.directory_status()->>'open')::boolean, false) then return; end if;
  return query
    select c.handle,
           coalesce(nullif(trim(r.profile->>'title'), ''), c.handle) as name,
           nullif(left(trim(coalesce(r.profile->>'bio', '')), 400), '') as bio,
           nullif(r.profile->>'photo', '') as photo,
           c.directory_keywords,
           coalesce((select pp.plan from public.profile_plan(c.profile_id, 'composer', false) pp limit 1), 'free') as tier
    from public.composer_profiles c
    join public.profiles p on p.id = c.profile_id
    join public.ad_reels r on r.owner_id = c.id and r.id = 'main'
    where c.directory_opt_in and c.handle is not null
      and not p.suspended and p.deletion_requested_at is null and p.deleted_at is null
    order by case coalesce((select pp.plan from public.profile_plan(c.profile_id, 'composer', false) pp limit 1), 'free')
                  when 'pro' then 0 when 'starter' then 1 else 2 end,
             md5(c.handle || current_date::text);
end;
$$;
grant execute on function public.composer_directory() to anon, authenticated;

-- Réglages du compositeur connecté (case + mots-clés).
create or replace function public.get_my_directory()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('optIn', c.directory_opt_in, 'keywords', to_jsonb(c.directory_keywords))
  from public.composer_profiles c where c.profile_id = auth.uid();
$$;
revoke execute on function public.get_my_directory() from public, anon;
grant execute on function public.get_my_directory() to authenticated;

create or replace function public.set_my_directory(p_opt_in boolean, p_keywords text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kw text[];
begin
  select coalesce(array_agg(k order by first_pos), '{}') into v_kw from (
    select left(trim(x.k), 30) as k, min(x.ord) as first_pos
    from unnest(coalesce(p_keywords, '{}')) with ordinality as x(k, ord)
    where trim(x.k) <> ''
    group by left(trim(x.k), 30)
    order by min(x.ord) limit 12
  ) s;
  update public.composer_profiles set directory_opt_in = coalesce(p_opt_in, true), directory_keywords = v_kw
  where profile_id = auth.uid();
  if not found then raise exception 'Aucun profil compositeur pour ce compte'; end if;
  return jsonb_build_object('optIn', coalesce(p_opt_in, true), 'keywords', to_jsonb(v_kw));
end;
$$;
revoke execute on function public.set_my_directory(boolean, text[]) from public, anon;
grant execute on function public.set_my_directory(boolean, text[]) to authenticated;

-- Adresses réservées : /compositeurs et /composers (la page), /annuaire et /directory par prudence.
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
    'vitrine','projet','projets','studio','catalogue','tarifs','invitation','album','shop',
    'compositeurs','composers','annuaire','directory'
  ]);
$$;
