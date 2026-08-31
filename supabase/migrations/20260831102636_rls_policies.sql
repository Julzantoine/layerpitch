-- LayerPitch — policies RLS (Décision 2 : sécurité en deux niveaux, validation applicative + RLS)
--
-- Défaut retenu pour cette étape (aucune couche api/*.js de CRUD applicatif n'existe encore,
-- Décision 2) : lecture publique sur tout le contenu — cohérent avec le comportement actuel du
-- site (100% public, sans compte). Écriture réservée à service_role (le script de migration et,
-- plus tard, les RPC/Edge Functions) tant que la validation applicative n'est pas construite.
-- À resserrer une fois api/tracks.js, api/packs.js, api/adreels.js en place (RLS par propriétaire).

alter table public.profiles enable row level security;
alter table public.composer_profiles enable row level security;
alter table public.buyer_profiles enable row level security;
alter table public.plan_quotas enable row level security;
alter table public.settings enable row level security;
alter table public.socials enable row level security;
alter table public.track_folders enable row level security;
alter table public.tracks enable row level security;
alter table public.segment_slots enable row level security;
alter table public.segment_slot_transitions enable row level security;
alter table public.sfx_folders enable row level security;
alter table public.sfx_library enable row level security;
alter table public.track_sfx enable row level security;
alter table public.packs enable row level security;
alter table public.pack_tracks enable row level security;
alter table public.pack_sfx enable row level security;
alter table public.collections enable row level security;
alter table public.collection_packs enable row level security;
alter table public.albums enable row level security;
alter table public.album_tracks enable row level security;
alter table public.ad_reel_folders enable row level security;
alter table public.ad_reels enable row level security;
alter table public.ad_reel_tracks enable row level security;
alter table public.pack_purchases enable row level security;
alter table public.album_purchases enable row level security;

-- ---- Contenu public en lecture (anon + authenticated), écriture service_role uniquement ----
create policy "public read" on public.plan_quotas for select using (true);
create policy "public read" on public.settings for select using (true);
create policy "public read" on public.socials for select using (true);
create policy "public read" on public.track_folders for select using (true);
create policy "public read" on public.tracks for select using (true);
create policy "public read" on public.segment_slots for select using (true);
create policy "public read" on public.segment_slot_transitions for select using (true);
create policy "public read" on public.sfx_folders for select using (true);
create policy "public read" on public.sfx_library for select using (true);
create policy "public read" on public.track_sfx for select using (true);
create policy "public read" on public.packs for select using (true);
create policy "public read" on public.pack_tracks for select using (true);
create policy "public read" on public.pack_sfx for select using (true);
create policy "public read" on public.collections for select using (true);
create policy "public read" on public.collection_packs for select using (true);
create policy "public read" on public.albums for select using (true);
create policy "public read" on public.album_tracks for select using (true);
create policy "public read" on public.ad_reel_folders for select using (true);
create policy "public read" on public.ad_reels for select using (true);
create policy "public read" on public.ad_reel_tracks for select using (true);
-- (INSERT/UPDATE/DELETE : aucune policy pour anon/authenticated -> refusé par défaut ;
-- service_role contourne RLS de toute façon, aucune policy nécessaire pour lui.)

-- ---- Comptes : chacun voit/modifie uniquement sa propre ligne ----
create policy "own profile" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
create policy "own composer profile" on public.composer_profiles for select using (auth.uid() = profile_id);
create policy "own buyer profile" on public.buyer_profiles for select using (auth.uid() = profile_id);

-- ---- Achats : chacun voit uniquement ses propres achats (pas d'écriture client, Phase 1 pas commencée) ----
create policy "own pack purchases" on public.pack_purchases for select using (auth.uid() = buyer_id);
create policy "own album purchases" on public.album_purchases for select using (auth.uid() = buyer_id);
