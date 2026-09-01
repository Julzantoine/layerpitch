-- LayerPitch — remplace la vérification ADMIN_EMAIL en dur d'`invite-tester` par une vraie
-- vérification de rôle admin, maintenant que `profiles`/`composer_profiles` existent réellement
-- (Décision 4, docs/infrastructure.md — annotée dès l'origine comme un intérim "en l'absence de
-- profiles/rôle", même intérim que celui déjà retiré des RPC upsert_* le 31 août, 20260831231500).
--
-- Table `admins` séparée plutôt qu'une colonne `is_admin`/`role` sur `profiles` (choix de
-- Jules-Antoine) : suit le même principe déjà en place pour composer_profiles/buyer_profiles —
-- une capacité = une table dédiée, `profiles` reste "sans rôle figé" (comment sur la table,
-- 20260831102635). Une seule ligne aujourd'hui (Jules-Antoine), extensible plus tard sans
-- migration de schéma si d'autres admins sont ajoutés.

create table public.admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.admins is 'Comptes admin LayerPitch (droits internes type invite-tester) — distinct de composer_profiles/buyer_profiles, qui sont des capacités produit, pas des droits d''administration.';

alter table public.admins enable row level security;
-- Aucune policy de lecture directe : la table n'est consultable que via is_admin() (security
-- definer), jamais directement par un client authenticated/anon.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where profile_id = auth.uid());
$$;

grant execute on function public.is_admin() to authenticated;

-- Seed : compte de Jules-Antoine, identifié par email plutôt qu'un uuid en dur (portable d'un
-- environnement Supabase à l'autre). Sans effet si le compte n'existe pas encore à cette adresse.
insert into public.admins (profile_id)
select id from auth.users where email = 'julzantoine@yahoo.com'
on conflict (profile_id) do nothing;
