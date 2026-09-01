-- LayerPitch — fan_profiles, 3ᵉ table du modèle de comptes à profils multiples (Décision 4)
--
-- Le modèle réel (extensions-roadmap.md 5.4, acté le 30 juillet) prévoit trois profils, pas deux :
-- Fan (nom provisoire) + Compositeur + Game dev. Le schéma initial (31 août) n'avait construit que
-- composer_profiles/buyer_profiles — oubli confirmé et corrigé ici le 1er septembre, décision de
-- Jules-Antoine : table séparée plutôt qu'une fusion avec buyer_profiles.
--
-- Différence de nature avec composer_profiles/buyer_profiles : ces deux-là sont optionnels,
-- activables à la demande ("un compte peut cumuler plusieurs profils"). Le profil Fan est
-- "toujours présent par défaut sur tout compte, quel que soit le reste" (extensions-roadmap.md
-- 5.4) — il porte l'entité Album (vente d'OST façon Bandcamp, Adaptive Edition), destinée à
-- rester accessible à quelqu'un qui n'a AUCUN des deux autres profils. D'où la création
-- automatique à l'inscription plutôt qu'une activation manuelle comme pour les deux autres.
--
-- UI acheteur (bibliothèque Album, lecteur, playlists, bouton "Figer") explicitement PAS traitée
-- ici, actée avec Jules-Antoine comme un chantier à part entière à construire plus tard — cette
-- migration ne pose que le socle de compte, rien côté produit.

create table public.fan_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.fan_profiles enable row level security;
create policy "own fan profile" on public.fan_profiles for select using (auth.uid() = profile_id);

-- Étend handle_new_user() (20260831193231) : un fan_profile est créé automatiquement en même
-- temps que profiles, jamais une étape d'activation séparée — contrairement à
-- composer_profiles/buyer_profiles, qui restent optionnels et non touchés par ce trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.fan_profiles (profile_id) values (new.id) on conflict (profile_id) do nothing;
  return new;
end;
$$;

-- Backfill des comptes déjà existants (Jules-Antoine, et le compte de test créé le 1er septembre
-- pour vérifier l'isolation multi-compositeur).
insert into public.fan_profiles (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;
