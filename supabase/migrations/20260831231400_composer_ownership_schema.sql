-- LayerPitch — owner_id sur le contenu compositeur (correction d'un oubli de la Décision 1,
-- signalé le 31 août : le schéma initial (20260831102635) a créé composer_profiles mais a omis
-- de rattacher tracks/packs/collections/ad_reels/sfx_library (et leurs dossiers) à un propriétaire.
-- Sans ça, rien ne distingue le contenu d'un compositeur de celui d'un autre — bloquant pour
-- l'ouverture de la bêta à plusieurs compositeurs (Décision 4) et le backstage en ligne à venir.
-- Pas une extension : LayerPitch est multi-compositeur depuis la conception (business plan, et
-- déjà en vigueur dans la Partie A où chaque testeur bêta a son propre repo isolé).
--
-- Aucun composer_profile n'existe encore en base (le flux d'inscription compositeur n'est pas
-- construit — c'est justement l'objet du backstage en ligne à venir). On crée donc ici celui de
-- Jules-Antoine, seul auteur de tout le contenu migré depuis data.json à ce jour, et on lui
-- rattache l'existant avant de rendre owner_id obligatoire.

insert into public.composer_profiles (profile_id)
select id from public.profiles where id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c'
on conflict (profile_id) do nothing;

-- ---- Colonnes (nullable d'abord, pour permettre le backfill ci-dessous) ----
alter table public.track_folders add column owner_id uuid references public.composer_profiles(id) on delete cascade;
alter table public.tracks add column owner_id uuid references public.composer_profiles(id) on delete cascade;
alter table public.sfx_folders add column owner_id uuid references public.composer_profiles(id) on delete cascade;
alter table public.sfx_library add column owner_id uuid references public.composer_profiles(id) on delete cascade;
alter table public.packs add column owner_id uuid references public.composer_profiles(id) on delete cascade;
alter table public.collections add column owner_id uuid references public.composer_profiles(id) on delete cascade;
alter table public.albums add column owner_id uuid references public.composer_profiles(id) on delete cascade;
alter table public.ad_reel_folders add column owner_id uuid references public.composer_profiles(id) on delete cascade;
alter table public.ad_reels add column owner_id uuid references public.composer_profiles(id) on delete cascade;

-- ---- Backfill : tout le contenu existant appartient à Jules-Antoine ----
update public.track_folders set owner_id = (select id from public.composer_profiles where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c') where owner_id is null;
update public.tracks set owner_id = (select id from public.composer_profiles where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c') where owner_id is null;
update public.sfx_folders set owner_id = (select id from public.composer_profiles where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c') where owner_id is null;
update public.sfx_library set owner_id = (select id from public.composer_profiles where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c') where owner_id is null;
update public.packs set owner_id = (select id from public.composer_profiles where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c') where owner_id is null;
update public.collections set owner_id = (select id from public.composer_profiles where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c') where owner_id is null;
update public.albums set owner_id = (select id from public.composer_profiles where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c') where owner_id is null;
update public.ad_reel_folders set owner_id = (select id from public.composer_profiles where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c') where owner_id is null;
update public.ad_reels set owner_id = (select id from public.composer_profiles where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c') where owner_id is null;

-- ---- NOT NULL désormais que tout est rempli ----
alter table public.track_folders alter column owner_id set not null;
alter table public.tracks alter column owner_id set not null;
alter table public.sfx_folders alter column owner_id set not null;
alter table public.sfx_library alter column owner_id set not null;
alter table public.packs alter column owner_id set not null;
alter table public.collections alter column owner_id set not null;
alter table public.albums alter column owner_id set not null;
alter table public.ad_reel_folders alter column owner_id set not null;
alter table public.ad_reels alter column owner_id set not null;

-- ---- Index (chaque page backstage listera "mes morceaux/packs/...") ----
create index track_folders_owner_id_idx on public.track_folders(owner_id);
create index tracks_owner_id_idx on public.tracks(owner_id);
create index sfx_folders_owner_id_idx on public.sfx_folders(owner_id);
create index sfx_library_owner_id_idx on public.sfx_library(owner_id);
create index packs_owner_id_idx on public.packs(owner_id);
create index collections_owner_id_idx on public.collections(owner_id);
create index albums_owner_id_idx on public.albums(owner_id);
create index ad_reel_folders_owner_id_idx on public.ad_reel_folders(owner_id);
create index ad_reels_owner_id_idx on public.ad_reels(owner_id);

-- Note : les tables de liaison (pack_tracks, pack_sfx, collection_packs, album_tracks,
-- ad_reel_tracks, track_sfx) et segment_slots/segment_slot_transitions n'ont pas besoin de leur
-- propre owner_id — elles héritent de la propriété de leur table parente (un pack_tracks n'existe
-- que rattaché à un pack qui a déjà un propriétaire).
--
-- Lecture publique inchangée (policies "public read" de 20260831102636) : ce correctif porte sur
-- l'écriture, pas sur la visibilité du contenu déjà public sur le site aujourd'hui. Le contrôle
-- d'accès en écriture est appliqué dans les fonctions RPC (voir 20260831231500), pas via des
-- policies RLS supplémentaires : c'est déjà le seul chemin d'écriture qui existe (Décision 2).
