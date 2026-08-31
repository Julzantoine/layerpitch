-- LayerPitch — schéma initial Postgres (Décision 1, docs/infrastructure.md, Partie B)
-- Étape 3 de la bascule backend (Décision 5) — la plus délicate : ce schéma est peuplé depuis
-- data.json par scripts/migrate-data-to-postgres.js, sans faire dépendre le site public de cette
-- base tant qu'un AdReel de test servi depuis Postgres n'est pas vérifié identique à l'original.
--
-- Convention d'ID : les identifiants existants de data.json (ex. "bmrc8rec1wtahz", générés côté
-- backstage, pas des UUID) sont conservés tels quels comme clés primaires (type text) — migration
-- directe, aucune table de correspondance ancien/nouveau ID, cohérence avec les chemins R2 déjà
-- basés sur ces mêmes IDs (audio/<trackId>/...). Seules les entités qui n'avaient pas d'ID propre
-- dans data.json (segment_slot_transitions, achats) reçoivent un uuid généré.
--
-- Tables de liaison (pack_tracks, collection_packs, ad_reel_tracks, track_sfx, pack_sfx) plutôt que
-- des tableaux d'IDs bruts — décidé le 31 août (extension explicite du principe déjà acté par la
-- Décision 1 aux deux cas qu'elle ne citait pas nommément).

-- ============================================================================
-- Comptes (Décision 4 — un seul compte, plusieurs profils cumulables)
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Une ligne par compte (Décision 4), sans rôle figé — un compte peut cumuler composer_profile et/ou buyer_profile.';

create table public.composer_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.buyer_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Quotas par palier (table plutôt que valeurs codées en dur, Décision 1). Lignes créées ci-dessous
-- (free/starter/pro) mais colonnes de quota laissées NULL — ces valeurs ne sont PAS encore décidées,
-- ne pas les fabriquer : à renseigner explicitement une fois le modèle de pricing tranché.
create table public.plan_quotas (
  plan text primary key check (plan in ('free', 'starter', 'pro')),
  max_ad_reels int,
  max_tracks int,
  max_packs int,
  storage_mb int,
  price_usd_cents int
);
insert into public.plan_quotas (plan) values ('free'), ('starter'), ('pro');

-- ============================================================================
-- Réglages globaux (une seule ligne — Décision 1)
-- ============================================================================

create table public.settings (
  id boolean primary key default true,
  constraint settings_singleton check (id),
  published_at bigint,
  implementation_skills jsonb not null default '{}'::jsonb,
  no_ai_certified_global boolean not null default false,
  custom_fonts jsonb not null default '[]'::jsonb
);

create table public.socials (
  id text primary key,
  platform text not null,
  url text not null default '',
  position int not null default 0
);

-- ============================================================================
-- Morceaux (tracks) et dossiers
-- ============================================================================

create table public.track_folders (
  id text primary key,
  label text not null
);

create table public.tracks (
  id text primary key,
  folder_id text references public.track_folders(id) on delete set null,
  title text not null default '',
  description text not null default '',
  mode text not null,
  loopable boolean,
  implementation_note text,
  no_ai_override boolean,
  loop_engine text,
  bpm numeric,
  beats_per_bar int,
  loop_grid_unit text,
  loop_in_beat numeric,
  loop_out_beat numeric,
  start_track_beat numeric,
  max_loops int,
  max_chain_loops int,
  normalize_volume boolean not null default false,
  duration numeric not null default 0,
  base text not null default '',
  randomize_sections boolean,
  -- JSONB : structures propres au mode, sans intégrité référentielle critique (Décision 1)
  layers jsonb not null default '[]'::jsonb,       -- mode vertical
  intro jsonb,                                      -- mode sequential
  outro jsonb,                                       -- mode sequential
  loops jsonb not null default '[]'::jsonb,          -- mode embranchement-vertical
  sections jsonb not null default '[]'::jsonb,       -- mode vertical-random (pools[] imbriqués)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tracks_folder_id_idx on public.tracks(folder_id);

-- Spécifique au mode sequential (Décision 1, correction du 29 août) — segment_slots/
-- segment_slot_transitions recentrées sur ce seul mode ; embranchement-vertical utilise `loops`
-- (JSONB) et n'a pas de structure de graphe à valider ici.
create table public.segment_slots (
  id text primary key,
  track_id text not null references public.tracks(id) on delete cascade,
  label text not null default '',
  avoid_immediate_repeat boolean not null default false,
  references_slot_id text references public.segment_slots(id) on delete set null,
  repeat_count int not null default 1,
  quantization text not null default 'bar',
  cut_style text,
  description_fr text not null default '',
  description_en text not null default '',
  alternatives jsonb not null default '[]'::jsonb,  -- pas de graphe, propre à l'emplacement (Décision 1)
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index segment_slots_track_id_idx on public.segment_slots(track_id);

create table public.segment_slot_transitions (
  id uuid primary key default gen_random_uuid(),
  from_slot_id text not null references public.segment_slots(id) on delete cascade,
  target_slot_id text not null references public.segment_slots(id) on delete cascade,
  label text not null default '',
  transition jsonb,  -- détails du fichier de transition éventuel, pas de graphe (analogue à `alternatives`)
  position int not null default 0
);
create index segment_slot_transitions_from_idx on public.segment_slot_transitions(from_slot_id);
create index segment_slot_transitions_target_idx on public.segment_slot_transitions(target_slot_id);

-- ============================================================================
-- Sfx et dossiers
-- ============================================================================

create table public.sfx_folders (
  id text primary key,
  label text not null
);

create table public.sfx_library (
  id text primary key,
  folder_id text references public.sfx_folders(id) on delete set null,
  title text not null default '',
  description_fr text not null default '',
  description_en text not null default '',
  rr_mode text,
  duck_main_track boolean not null default false,
  base text not null default '',
  alternatives jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sfx_library_folder_id_idx on public.sfx_library(folder_id);

create table public.track_sfx (
  track_id text not null references public.tracks(id) on delete cascade,
  sfx_id text not null references public.sfx_library(id) on delete cascade,
  position int not null default 0,
  primary key (track_id, sfx_id)
);

-- ============================================================================
-- Packs, collections et albums
-- ============================================================================

create table public.packs (
  id text primary key,
  title text not null default '',
  illustration text,
  illustration_original_name text,
  watermark text,
  watermark_original_name text,
  presentation_fr text not null default '',
  presentation_en text not null default '',
  buyable boolean not null default false,
  buy_url text not null default '',
  free_download_enabled boolean not null default false,
  video_test_mode_enabled boolean not null default false,
  bg_color text,
  text_color text,
  font text,
  linked_ad_reel_id text,  -- FK ajoutée après création de ad_reels plus bas (référence circulaire)
  tags text[] not null default '{}',  -- provisionné vide (Décision 1) : vraie Marketplace, Phase 2
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pack_tracks (
  pack_id text not null references public.packs(id) on delete cascade,
  track_id text not null references public.tracks(id) on delete cascade,
  position int not null default 0,
  primary key (pack_id, track_id)
);

create table public.pack_sfx (
  pack_id text not null references public.packs(id) on delete cascade,
  sfx_id text not null references public.sfx_library(id) on delete cascade,
  position int not null default 0,
  primary key (pack_id, sfx_id)
);

create table public.collections (
  id text primary key,
  title text not null default '',
  illustration text,
  illustration_original_name text,
  presentation_fr text not null default '',
  presentation_en text not null default '',
  bg_color text,
  text_color text,
  font text,
  buyable boolean not null default false,
  buy_url text not null default '',
  free_download_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collection_packs (
  collection_id text not null references public.collections(id) on delete cascade,
  pack_id text not null references public.packs(id) on delete cascade,
  position int not null default 0,
  primary key (collection_id, pack_id)
);

-- Provisionnée (Décision 1 — vente d'OST façon Bandcamp), pas de données à migrer pour l'instant
-- (aucun album existant dans data.json). Mécanique de lecture auditeur (playlists, "Figer") non
-- provisionnée — conception incomplète à ce stade (extensions-roadmap.md 5.5).
create table public.albums (
  id text primary key,
  title text not null default '',
  illustration text,
  illustration_original_name text,
  presentation_fr text not null default '',
  presentation_en text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.album_tracks (
  album_id text not null references public.albums(id) on delete cascade,
  track_id text not null references public.tracks(id) on delete cascade,
  position int not null default 0,
  primary key (album_id, track_id)
);

-- ============================================================================
-- AdReels et dossiers
-- ============================================================================

create table public.ad_reel_folders (
  id text primary key,
  label text not null
);

create table public.ad_reels (
  id text primary key,
  folder_id text references public.ad_reel_folders(id) on delete set null,
  label text not null default '',
  lang text not null default 'fr',
  -- JSONB : pas de graphe/intégrité critique (Décision 1)
  profile jsonb not null default '{}'::jsonb,
  testimonials jsonb not null default '[]'::jsonb,
  blocks jsonb not null default '[]'::jsonb,
  track_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ad_reels_folder_id_idx on public.ad_reels(folder_id);

alter table public.packs
  add constraint packs_linked_ad_reel_id_fkey
  foreign key (linked_ad_reel_id) references public.ad_reels(id) on delete set null;

create table public.ad_reel_tracks (
  ad_reel_id text not null references public.ad_reels(id) on delete cascade,
  track_id text not null references public.tracks(id) on delete cascade,
  position int not null default 0,
  primary key (ad_reel_id, track_id)
);

-- ============================================================================
-- Achats (Phase 1 — colonnes provisionnées, aucune donnée à migrer)
-- ============================================================================

create table public.pack_purchases (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id),
  pack_id text not null references public.packs(id),
  purchased_at timestamptz not null default now(),
  price_paid numeric,
  stripe_payment_intent_id text
);

create table public.album_purchases (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id),
  album_id text not null references public.albums(id),
  purchased_at timestamptz not null default now(),
  price_paid numeric,
  stripe_payment_intent_id text
);
