-- LayerPitch — la matrice des droits devient des DONNÉES (chantier profils et permissions, étape 1,
-- 27 septembre ; référence : layerpitch-docs/2026-09-27-cadrage-profils-permissions.md, matrice figée).
--
-- Avant : les limites du compositeur vivaient en colonnes de plan_quotas (une colonne par limite), les
-- droits sans chiffre et les verrous « admin jusqu'au feu vert » étaient écrits un par un dans le code, et
-- le studio n'avait aucun palier. Après :
--   plans                        -- catalogue des paliers, compositeur ET studio (codes, prix)
--   features                     -- catalogue des fonctions de la matrice
--   plan_entitlements            -- une ligne = un palier × une fonction (+ variante « student »)
--   account_entitlement_overrides-- exceptions par compte (contrats AAA sur devis, gestes commerciaux)
--   feature_flags                -- feux verts : tant qu'une fonction n'est pas « released », seul l'admin y a droit
--   entitlement()                -- LA fonction unique : « ce compte a-t-il droit à X, et combien ? »
--   my_entitlements()            -- la même chose pour le compte connecté, toutes fonctions, lue par les pages
--
-- Compatibilité (rien ne doit changer pour les comptes existants, prouvé sur PGlite avant/après) :
--   * plan_quotas devient une VUE aux mêmes colonnes utiles (l'Edge Function create-subscription-checkout-session
--     y lit toujours les prix) ; les 4 colonnes jamais utilisées (max_tracks, max_packs, storage_mb,
--     price_usd_cents) disparaissent.
--   * effective_plan_quotas, composer_real_tier, composer_effective_tier : mêmes signatures, mêmes résultats,
--     réécrites sur la nouvelle résolution.
--   * get_trial_status : inchangée.
--   * Le quota vidéo à 0 Go pour les non-admins pendant la bêta (20260923040000) devient le feu vert
--     « video_upload » : même effet aujourd'hui ; AU LANCEMENT, il faudra le passer à released (sinon l'envoi
--     vidéo resterait réservé à l'admin même après la bêta).
--
-- Résolution du palier (profile_plan), dans cet ordre :
--   1. aperçu admin (« Voir en tant que »), seulement pour l'admin lui-même et seulement si demandé ;
--   2. compte admin        -> compositeur 'pro',  studio 'aaa' ;
--   3. interrupteur bêta   -> compositeur 'pro',  studio 'aa'  (décision du 27/09 : AAA est sur devis) ;
--   4. essai (reverse trial, compositeur seulement) -> 'pro' ;
--   5. palier enregistré sur le profil.
-- La variante « student » (Warrior étudiant) et les exceptions par compte ne s'appliquent qu'au cas 5,
-- exactement comme avant (un admin, un testeur bêta ou un compte en essai avaient déjà les valeurs Pro).
--
-- AAA « sur devis » : sans exception enregistrée pour le compte, AAA reçoit les valeurs d'AA pour ce qui
-- coûte de l'argent à LayerPitch (crédits) et l'illimité pour le reste ; le contrat réel se saisit dans
-- account_entitlement_overrides.
--
-- Rien n'est encore branché dans les pages : elles grisent comme avant. Elles liront my_entitlements() aux
-- étapes suivantes, et les contrôles serveur existants (is_admin() dans upsert_album, verrou pack en vente…)
-- migreront vers entitlement() au fil de l'eau — feature_flags les liste dès maintenant.

-- ============================================================================
-- 1. Catalogue des paliers
-- ============================================================================

create table public.plans (
  code text primary key,
  kind text not null check (kind in ('composer', 'studio')),
  public_name text not null,
  position int not null,
  price_eur_cents_monthly int,
  price_eur_cents_yearly int,
  unique (kind, code)
);
comment on table public.plans is 'Paliers d''abonnement, un catalogue par profil (compositeur : free/starter/pro = Rookie/Warrior/Boss ; studio : solodev/indie/aa/aaa). Prix NULL = gratuit ou sur devis.';

insert into public.plans (code, kind, public_name, position, price_eur_cents_monthly, price_eur_cents_yearly)
select pq.plan, 'composer',
       case pq.plan when 'free' then 'Rookie' when 'starter' then 'Warrior' else 'Boss' end,
       case pq.plan when 'free' then 1 when 'starter' then 2 else 3 end,
       pq.price_eur_cents_monthly, pq.price_eur_cents_yearly
from public.plan_quotas pq;

insert into public.plans (code, kind, public_name, position, price_eur_cents_monthly, price_eur_cents_yearly) values
  ('solodev', 'studio', 'SoloDev', 1, null, null),
  ('indie',   'studio', 'Indie',   2, 3900, 39000),
  ('aa',      'studio', 'AA',      3, 12900, 129000),
  ('aaa',     'studio', 'AAA',     4, null, null);   -- sur devis (D16, D17)

alter table public.plans enable row level security;
create policy "public read" on public.plans for select using (true);

-- ============================================================================
-- 2. Feux verts
-- ============================================================================
-- Une fonction reliée à un feu vert non « released » (features.flag_key) n'est accordée qu'aux admins, quel que soit le palier.
-- Donner le feu vert = passer released à true (set_feature_released, admin seulement). Les clés reprennent
-- layerpitch-docs/feux-verts-admin.md ; une clé peut être plus fine qu'une ligne de la matrice (les sous-fonctions
-- d'audio_fx), lue alors par feature_released().

create table public.feature_flags (
  key text primary key,
  released boolean not null default false,
  released_at timestamptz,
  description text not null
);
alter table public.feature_flags enable row level security;
create policy "public read" on public.feature_flags for select using (true);

insert into public.feature_flags (key, description) values
  ('video_upload',    'Import de vidéos (bibliothèque vidéo compositeur). Réservé à l''admin pendant la bêta (20260923040000) : À OUVRIR AU LANCEMENT.'),
  ('versioning',      'Versioning vidéo (26/09) — barrière is_admin() dans les 4 RPC video_capture_versions.'),
  ('custom_address',  'Choisir son pseudo et les adresses de ses AdReels (27/09) — setters is_admin().'),
  ('sell_packs',      'Pack « en vente » — verrou bêta dans upsert_pack.'),
  ('sell_albums',     'Vente d''Adaptive OST — is_admin() dans upsert_album, claim_test_album, set_album_track_default_settings.'),
  ('audio_fx',        'Ensemble des fonctions audio en test (feux-verts-admin.md, lignes 1 à 5b).'),
  ('fx_per_voice',    'Effets par voix (volume, low/high cut, reverb, écho, bitcrusher).'),
  ('pitch',           'Pitch traditionnel et pitch « vitesse ».'),
  ('triggers',        'Triggers d''effets, relations, fondus.'),
  ('rtpc',            'Curseurs de paramètre (RTPC) et courbes libres.'),
  ('sfx_spatial',     'Spatialisation des Sfx, trajectoires, matrice publique.'),
  ('bulk_drop',       'Dépôts groupés, tempo/mesures lus dans les noms.'),
  ('alt_drag_delete', 'Alt + glisser pour dupliquer, touche Supprimer.'),
  ('projects',        'Projets (Moodboard, fil, invités) — étape 5 du chantier, pas encore construit.'),
  ('subscriber_catalog','Catalogue abonnés et crédits — étapes 2 et 6, pas encore construit.'),
  ('studio_space',    'Tout l''espace studio (étape 3 et suivantes) — pas encore construit.');

-- ============================================================================
-- 3. Catalogue des fonctions
-- ============================================================================
-- value_type : 'quota' (amount = nombre max, NULL = illimité), 'rate' (amount = taux), 'level' (level = mode),
-- 'switch' (seul allowed compte).

create table public.features (
  key text primary key,
  kind text not null check (kind in ('composer', 'studio')),
  value_type text not null check (value_type in ('quota', 'rate', 'level', 'switch')),
  description text not null,
  flag_key text references public.feature_flags(key)   -- feu vert qui conditionne cette fonction (NULL = aucun)
);
alter table public.features enable row level security;
create policy "public read" on public.features for select using (true);

insert into public.features (key, kind, value_type, description) values
  -- Compositeur (business plan §6.1.1 + décisions du 27/09)
  ('ad_reels',            'composer', 'quota',  'Nombre d''AdReels'),
  ('share_links',         'composer', 'quota',  'Liens de partage'),
  ('embeds',              'composer', 'quota',  'Lecteurs embarqués'),
  ('audio_tracks',        'composer', 'quota',  'Pistes de la bibliothèque audio'),
  ('video_blocks',        'composer', 'quota',  'Blocs vidéo (cumul tous AdReels)'),
  ('video_storage_gb',    'composer', 'quota',  'Stockage vidéo importée (Go)'),
  ('commission_rate',     'composer', 'rate',   'Commission LayerPitch sur les ventes (packs, albums)'),
  ('analytics',           'composer', 'level',  'Statistiques : teaser (aperçu flouté) / basic / advanced'),
  ('appearance',          'composer', 'level',  'Personnalisation : presets (AdReel entier) / full (bloc par bloc)'),
  ('no_watermark',        'composer', 'switch', 'Pas de filigrane LayerPitch (AdReel, export vidéo)'),
  ('custom_address',      'composer', 'switch', 'Choisir son pseudo et les adresses de ses AdReels'),
  ('audio_fx',            'composer', 'switch', 'Fonctions audio (effets, pitch, triggers, curseurs, spatialisation, dépôts groupés)'),
  ('test_in_game',        'composer', 'level',  'Test in game : capture / edit (non enregistré) / saved'),
  ('versioning',          'composer', 'level',  'Versioning vidéo : session / saved (absent = interdit)'),
  ('projects',            'composer', 'quota',  'Projets créés'),
  ('sell_packs',          'composer', 'switch', 'Vendre des packs'),
  ('subscriber_catalog',  'composer', 'switch', 'Inclure ses packs dans le catalogue abonnés (crédits)'),
  ('sell_albums',         'composer', 'switch', 'Vendre des albums (Adaptive OST), co-ayants droit'),
  -- Studio (D13, D14, D16, D20, D26)
  ('team_members',        'studio',   'quota',  'Membres de l''équipe'),
  ('monthly_credits',     'studio',   'quota',  'Crédits inclus par mois'),
  ('buy_packs',           'studio',   'switch', 'Acheter des packs à l''unité, bibliothèque'),
  ('custom_packs',        'studio',   'quota',  'Packs custom'),
  ('studio_test_in_game', 'studio',   'level',  'Test in game : capture / saved'),
  ('saved_montages',      'studio',   'quota',  'Montages enregistrés'),
  ('studio_versioning',   'studio',   'level',  'Versioning : saved (absent = interdit)'),
  ('studio_no_watermark', 'studio',   'switch', 'Pas de filigrane à l''export'),
  ('studio_projects',     'studio',   'quota',  'Projets créés (Moodboard inclus)'),
  ('studio_sell_albums',  'studio',   'switch', 'Vendre l''OST de son jeu, co-ayants droit'),
  ('studio_commission_rate','studio', 'rate',   'Commission LayerPitch sur la vente d''OST');

-- Feu vert de chaque fonction. Le test in game compositeur est ouvert à tous depuis le 16/09 (aucun feu vert).
update public.features set flag_key = 'video_upload'       where key = 'video_storage_gb';
update public.features set flag_key = 'versioning'         where key in ('versioning', 'studio_versioning');
update public.features set flag_key = 'custom_address'     where key = 'custom_address';
update public.features set flag_key = 'sell_packs'         where key = 'sell_packs';
update public.features set flag_key = 'sell_albums'        where key in ('sell_albums', 'studio_sell_albums');
update public.features set flag_key = 'audio_fx'           where key = 'audio_fx';
update public.features set flag_key = 'projects'           where key in ('projects', 'studio_projects');
update public.features set flag_key = 'subscriber_catalog' where key in ('subscriber_catalog', 'monthly_credits');
update public.features set flag_key = 'studio_space'       where kind = 'studio' and flag_key is null;

-- ============================================================================
-- 4. La matrice : un palier × une fonction
-- ============================================================================

create table public.plan_entitlements (
  plan text not null references public.plans(code) on delete cascade,
  feature text not null references public.features(key) on delete cascade,
  variant text not null default '' check (variant in ('', 'student')),
  allowed boolean not null,
  amount numeric,          -- quota (NULL = illimité) ou taux
  level text,              -- mode, pour les fonctions de type 'level'
  primary key (plan, feature, variant)
);
comment on table public.plan_entitlements is 'Matrice des droits (layerpitch-docs/2026-09-27-cadrage-profils-permissions.md). variant ''student'' = dérogation Warrior étudiant, lue seulement quand le compte a student_tier_declared et que son palier vient du profil.';
alter table public.plan_entitlements enable row level security;
create policy "public read" on public.plan_entitlements for select using (true);

-- Compositeur : quotas et commission recopiés depuis les VALEURS RÉELLES de plan_quotas (pas depuis la
-- grille écrite dans les migrations : une valeur modifiée à la main en base est conservée telle quelle).
insert into public.plan_entitlements (plan, feature, allowed, amount)
select pq.plan, f.feature, true, f.amount
from public.plan_quotas pq
cross join lateral (values
  ('ad_reels', pq.max_ad_reels::numeric), ('share_links', pq.max_share_links::numeric), ('embeds', pq.max_embeds::numeric),
  ('audio_tracks', pq.max_audio_tracks::numeric), ('video_blocks', pq.max_video_blocks::numeric),
  ('video_storage_gb', pq.max_video_storage_gb::numeric), ('commission_rate', pq.commission_rate)
) as f(feature, amount);

-- Dérogation étudiante (Warrior seulement, 20260903180000) : 200 pistes, 5 Go, 10 %.
insert into public.plan_entitlements (plan, feature, variant, allowed, amount) values
  ('starter', 'audio_tracks',     'student', true, 200),
  ('starter', 'video_storage_gb', 'student', true, 5),
  ('starter', 'commission_rate',  'student', true, 0.10);

insert into public.plan_entitlements (plan, feature, allowed, amount, level) values
  ('free',    'analytics',          true,  null, 'teaser'),
  ('starter', 'analytics',          true,  null, 'basic'),
  ('pro',     'analytics',          true,  null, 'advanced'),
  ('free',    'appearance',         true,  null, 'presets'),
  ('starter', 'appearance',         true,  null, 'full'),
  ('pro',     'appearance',         true,  null, 'full'),
  ('free',    'no_watermark',       false, null, null),
  ('starter', 'no_watermark',       false, null, null),
  ('pro',     'no_watermark',       true,  null, null),
  ('free',    'custom_address',     false, null, null),
  ('starter', 'custom_address',     true,  null, null),
  ('pro',     'custom_address',     true,  null, null),
  ('free',    'audio_fx',           true,  null, null),
  ('starter', 'audio_fx',           true,  null, null),
  ('pro',     'audio_fx',           true,  null, null),
  ('free',    'test_in_game',       true,  null, 'capture'),
  ('starter', 'test_in_game',       true,  null, 'edit'),
  ('pro',     'test_in_game',       true,  null, 'saved'),
  ('free',    'versioning',         false, null, null),
  ('starter', 'versioning',         true,  null, 'session'),
  ('pro',     'versioning',         true,  null, 'saved'),
  ('free',    'projects',           false, 0,    null),
  ('starter', 'projects',           true,  1,    null),
  ('pro',     'projects',           true,  5,    null),
  ('free',    'sell_packs',         true,  null, null),
  ('starter', 'sell_packs',         true,  null, null),
  ('pro',     'sell_packs',         true,  null, null),
  ('free',    'subscriber_catalog', true,  null, null),
  ('starter', 'subscriber_catalog', true,  null, null),
  ('pro',     'subscriber_catalog', true,  null, null),
  ('free',    'sell_albums',        true,  null, null),
  ('starter', 'sell_albums',        true,  null, null),
  ('pro',     'sell_albums',        true,  null, null);

-- Studio. AAA sans contrat saisi : crédits = ceux d'AA (ils coûtent de l'argent), le reste illimité.
insert into public.plan_entitlements (plan, feature, allowed, amount, level) values
  ('solodev', 'team_members',          true,  1,    null),
  ('indie',   'team_members',          true,  3,    null),
  ('aa',      'team_members',          true,  10,   null),
  ('aaa',     'team_members',          true,  null, null),
  ('solodev', 'monthly_credits',       false, 0,    null),
  ('indie',   'monthly_credits',       true,  2,    null),
  ('aa',      'monthly_credits',       true,  8,    null),
  ('aaa',     'monthly_credits',       true,  8,    null),
  ('solodev', 'buy_packs',             true,  null, null),
  ('indie',   'buy_packs',             true,  null, null),
  ('aa',      'buy_packs',             true,  null, null),
  ('aaa',     'buy_packs',             true,  null, null),
  ('solodev', 'custom_packs',          true,  2,    null),
  ('indie',   'custom_packs',          true,  20,   null),
  ('aa',      'custom_packs',          true,  null, null),
  ('aaa',     'custom_packs',          true,  null, null),
  ('solodev', 'studio_test_in_game',   true,  null, 'capture'),
  ('indie',   'studio_test_in_game',   true,  null, 'saved'),
  ('aa',      'studio_test_in_game',   true,  null, 'saved'),
  ('aaa',     'studio_test_in_game',   true,  null, 'saved'),
  ('solodev', 'saved_montages',        false, 0,    null),
  ('indie',   'saved_montages',        true,  10,   null),
  ('aa',      'saved_montages',        true,  null, null),
  ('aaa',     'saved_montages',        true,  null, null),
  ('solodev', 'studio_versioning',     false, null, null),
  ('indie',   'studio_versioning',     true,  null, 'saved'),
  ('aa',      'studio_versioning',     true,  null, 'saved'),
  ('aaa',     'studio_versioning',     true,  null, 'saved'),
  ('solodev', 'studio_no_watermark',   false, null, null),
  ('indie',   'studio_no_watermark',   true,  null, null),
  ('aa',      'studio_no_watermark',   true,  null, null),
  ('aaa',     'studio_no_watermark',   true,  null, null),
  ('solodev', 'studio_projects',       false, 0,    null),
  ('indie',   'studio_projects',       true,  1,    null),
  ('aa',      'studio_projects',       true,  5,    null),
  ('aaa',     'studio_projects',       true,  null, null),
  ('solodev', 'studio_sell_albums',    true,  null, null),
  ('indie',   'studio_sell_albums',    true,  null, null),
  ('aa',      'studio_sell_albums',    true,  null, null),
  ('aaa',     'studio_sell_albums',    true,  null, null),
  ('solodev', 'studio_commission_rate',true,  0.15, null),
  ('indie',   'studio_commission_rate',true,  0.05, null),
  ('aa',      'studio_commission_rate',true,  0.01, null),
  ('aaa',     'studio_commission_rate',true,  0.01, null);

-- Exceptions par compte (contrat AAA, geste commercial). Écriture admin / service_role uniquement.
create table public.account_entitlement_overrides (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null references public.features(key) on delete cascade,
  allowed boolean not null,
  amount numeric,
  level text,
  note text not null default '',
  created_at timestamptz not null default now(),
  primary key (profile_id, feature)
);
alter table public.account_entitlement_overrides enable row level security;
-- Aucune policy : lue par entitlement() (security definer), écrite par SQL direct / service_role.

-- ============================================================================
-- 5. Palier du profil studio
-- ============================================================================

alter table public.composer_profiles drop constraint composer_profiles_plan_fkey;
alter table public.composer_profiles add column plan_kind text generated always as ('composer') stored;
alter table public.composer_profiles
  add constraint composer_profiles_plan_fkey foreign key (plan_kind, plan) references public.plans(kind, code);

alter table public.studio_profiles add column plan text not null default 'solodev';
alter table public.studio_profiles add column plan_kind text generated always as ('studio') stored;
alter table public.studio_profiles
  add constraint studio_profiles_plan_fkey foreign key (plan_kind, plan) references public.plans(kind, code);
comment on column public.studio_profiles.plan is 'Palier studio (solodev/indie/aa/aaa). Écrit par le webhook Stripe une fois l''offre studio payante ouverte (étape 6) ; à la main d''ici là.';

alter table public.admins add column preview_studio_plan text references public.plans(code)
  check (preview_studio_plan is null or preview_studio_plan in ('solodev', 'indie', 'aa', 'aaa'));
comment on column public.admins.preview_studio_plan is '« Voir en tant que » côté studio, NULL = accès admin normal. Même règle que preview_tier : lu seulement pour son propre compte.';

-- ============================================================================
-- 6. plan_quotas devient une vue (compatibilité)
-- ============================================================================

drop table public.plan_quotas;

create view public.plan_quotas as
select p.code as plan,
       (select amount from public.plan_entitlements e where e.plan = p.code and e.feature = 'ad_reels'         and e.variant = '')::int as max_ad_reels,
       (select amount from public.plan_entitlements e where e.plan = p.code and e.feature = 'share_links'      and e.variant = '')::int as max_share_links,
       (select amount from public.plan_entitlements e where e.plan = p.code and e.feature = 'embeds'           and e.variant = '')::int as max_embeds,
       (select amount from public.plan_entitlements e where e.plan = p.code and e.feature = 'audio_tracks'     and e.variant = '')::int as max_audio_tracks,
       (select amount from public.plan_entitlements e where e.plan = p.code and e.feature = 'video_blocks'     and e.variant = '')::int as max_video_blocks,
       (select amount from public.plan_entitlements e where e.plan = p.code and e.feature = 'video_storage_gb' and e.variant = '')::int as max_video_storage_gb,
       (select amount from public.plan_entitlements e where e.plan = p.code and e.feature = 'commission_rate'  and e.variant = '') as commission_rate,
       p.price_eur_cents_monthly,
       p.price_eur_cents_yearly
from public.plans p
where p.kind = 'composer';
comment on view public.plan_quotas is 'COMPATIBILITÉ (27/09) : ancienne table, désormais vue en lecture seule sur plans + plan_entitlements (paliers compositeur). Ne plus écrire ici : modifier plan_entitlements.';
grant select on public.plan_quotas to anon, authenticated, service_role;

-- ============================================================================
-- 7. Résolution
-- ============================================================================

-- Palier d'un compte pour un profil, et d'où il vient ('preview' | 'admin' | 'beta' | 'trial' | 'plan').
-- NULL si le compte n'a pas ce profil.
create or replace function public.profile_plan(p_profile_id uuid, p_kind text, p_with_preview boolean default true)
returns table (plan text, source text)
language sql
stable
security definer
set search_path = public
as $$
  with prof as (
    select cp.plan as stored, cp.trial_ends_at, cp.profile_id
    from public.composer_profiles cp where p_kind = 'composer' and cp.profile_id = p_profile_id
    union all
    select sp.plan, null::timestamptz, sp.profile_id
    from public.studio_profiles sp where p_kind = 'studio' and sp.profile_id = p_profile_id
  ),
  adm as (select a.* from public.admins a where a.profile_id = p_profile_id)
  select
    case
      when p_with_preview and auth.uid() = p_profile_id and p_kind = 'composer' and (select preview_tier from adm) is not null then (select preview_tier from adm)
      when p_with_preview and auth.uid() = p_profile_id and p_kind = 'studio' and (select preview_studio_plan from adm) is not null then (select preview_studio_plan from adm)
      when exists (select 1 from adm) then case p_kind when 'composer' then 'pro' else 'aaa' end
      when public.beta_full_access() then case p_kind when 'composer' then 'pro' else 'aa' end
      when prof.trial_ends_at > now() then 'pro'
      else prof.stored
    end,
    case
      when p_with_preview and auth.uid() = p_profile_id and p_kind = 'composer' and (select preview_tier from adm) is not null then 'preview'
      when p_with_preview and auth.uid() = p_profile_id and p_kind = 'studio' and (select preview_studio_plan from adm) is not null then 'preview'
      when exists (select 1 from adm) then 'admin'
      when public.beta_full_access() then 'beta'
      when prof.trial_ends_at > now() then 'trial'
      else 'plan'
    end
  from prof;
$$;

-- Feu vert d'une clé pour un compte : vrai si la clé n'existe pas, si elle est released, ou si le compte est admin.
create or replace function public.feature_released(p_key text, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select f.released from public.feature_flags f where f.key = p_key), true)
      or exists (select 1 from public.admins a where a.profile_id = p_profile_id);
$$;

-- LA fonction unique. Renvoie une ligne (plan, allowed, amount, level) ; aucune ligne si le compte n'a pas
-- le profil de cette fonction. Fonction non listée dans la matrice pour ce palier = interdite.
create or replace function public.entitlement(p_profile_id uuid, p_feature text, p_with_preview boolean default true)
returns table (plan text, allowed boolean, amount numeric, level text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_plan text;
  v_source text;
  v_student boolean := false;
  r record;
begin
  select f.kind into v_kind from public.features f where f.key = p_feature;
  if v_kind is null then raise exception 'Fonction inconnue : %', p_feature; end if;

  select pp.plan, pp.source into v_plan, v_source from public.profile_plan(p_profile_id, v_kind, p_with_preview) pp;
  if v_plan is null then return; end if;

  if v_source = 'plan' and v_kind = 'composer' then
    select cp.student_tier_declared into v_student from public.composer_profiles cp where cp.profile_id = p_profile_id;
  end if;

  select e.allowed, e.amount, e.level into r
  from public.plan_entitlements e
  where e.plan = v_plan and e.feature = p_feature
    and e.variant in ('', case when v_student then 'student' else '' end)
  order by e.variant desc   -- la variante 'student' passe avant la ligne de base
  limit 1;

  plan := v_plan;
  if found then allowed := r.allowed; amount := r.amount; level := r.level;
  else allowed := false; amount := 0; level := null;
  end if;

  if v_source = 'plan' then
    select o.allowed, o.amount, o.level into r from public.account_entitlement_overrides o
    where o.profile_id = p_profile_id and o.feature = p_feature;
    if found then allowed := r.allowed; amount := r.amount; level := r.level; end if;
  end if;

  if (select f.flag_key from public.features f where f.key = p_feature) is not null
     and not public.feature_released((select f.flag_key from public.features f where f.key = p_feature), p_profile_id) then
    allowed := false;
    if (select f.value_type from public.features f where f.key = p_feature) = 'quota' then amount := 0; end if;
    level := null;
  end if;

  return next;
end;
$$;

-- Toute la matrice pour le compte connecté (les pages la lisent une fois au chargement).
create or replace function public.my_entitlements()
returns table (kind text, feature text, plan text, source text, allowed boolean, amount numeric, level text)
language sql
stable
security definer
set search_path = public
as $$
  select f.kind, f.key, e.plan, pp.source, e.allowed, e.amount, e.level
  from public.features f
  cross join lateral public.profile_plan(auth.uid(), f.kind, true) pp
  cross join lateral public.entitlement(auth.uid(), f.key, true) e
  where auth.uid() is not null
  order by f.kind, f.key;
$$;

-- Feux verts vus par le compte connecté (sous-fonctions d'audio_fx comprises).
create or replace function public.my_feature_flags()
returns table (key text, released boolean, allowed boolean)
language sql
stable
security definer
set search_path = public
as $$
  select f.key, f.released, public.feature_released(f.key, auth.uid())
  from public.feature_flags f
  where auth.uid() is not null
  order by f.key;
$$;

-- Donner (ou retirer) un feu vert. Admin seulement.
create or replace function public.set_feature_released(p_key text, p_released boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Non autorisé : réservé aux admins'; end if;
  update public.feature_flags
     set released = p_released, released_at = case when p_released then now() else null end
   where key = p_key;
  if not found then raise exception 'Feu vert inconnu : %', p_key; end if;
end;
$$;

-- « Voir en tant que » côté studio (admin seulement, pour son propre compte).
create or replace function public.set_my_studio_preview_plan(p_plan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Non autorisé : réservé aux admins'; end if;
  if p_plan is not null and p_plan <> '' and p_plan not in ('solodev', 'indie', 'aa', 'aaa') then
    raise exception 'p_plan doit valoir solodev, indie, aa, aaa (ou vide pour revenir à admin)';
  end if;
  update public.admins set preview_studio_plan = nullif(p_plan, '') where profile_id = auth.uid();
end;
$$;

-- ============================================================================
-- 8. Anciennes fonctions réécrites sur la nouvelle résolution (mêmes signatures, mêmes résultats)
-- ============================================================================

create or replace function public.composer_real_tier(p_composer_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pp.plan
  from public.composer_profiles cp
  cross join lateral public.profile_plan(cp.profile_id, 'composer', false) pp
  where cp.id = p_composer_id;
$$;

create or replace function public.composer_effective_tier(p_composer_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pp.plan
  from public.composer_profiles cp
  cross join lateral public.profile_plan(cp.profile_id, 'composer', true) pp
  where cp.id = p_composer_id;
$$;

-- Colonne plan : palier enregistré (ou palier simulé en aperçu admin), jamais le palier « boosté » — comme avant.
create or replace function public.effective_plan_quotas(p_composer_id uuid)
returns table (
  plan text, max_ad_reels int, max_share_links int, max_embeds int,
  max_audio_tracks int, max_video_blocks int, max_video_storage_gb int, commission_rate numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when pp.source = 'preview' then pp.plan else cp.plan end,
    (select amount from public.entitlement(cp.profile_id, 'ad_reels'))::int,
    (select amount from public.entitlement(cp.profile_id, 'share_links'))::int,
    (select amount from public.entitlement(cp.profile_id, 'embeds'))::int,
    (select amount from public.entitlement(cp.profile_id, 'audio_tracks'))::int,
    (select amount from public.entitlement(cp.profile_id, 'video_blocks'))::int,
    (select amount from public.entitlement(cp.profile_id, 'video_storage_gb'))::int,
    (select amount from public.entitlement(cp.profile_id, 'commission_rate'))
  from public.composer_profiles cp
  cross join lateral public.profile_plan(cp.profile_id, 'composer', true) pp
  where cp.id = p_composer_id;
$$;

-- ============================================================================
-- 9. Droits d'exécution (même durcissement que 20260924230000 : les fonctions internes ne sont pas appelables
--    par un client ; seules les fonctions « my_* » et les réglages admin le sont)
-- ============================================================================

revoke execute on function public.profile_plan(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.feature_released(text, uuid) from public, anon, authenticated;
revoke execute on function public.entitlement(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.composer_real_tier(uuid) from public, anon, authenticated;
revoke execute on function public.composer_effective_tier(uuid) from public, anon, authenticated;
revoke execute on function public.effective_plan_quotas(uuid) from public, anon, authenticated;
grant execute on function public.profile_plan(uuid, text, boolean) to service_role;
grant execute on function public.feature_released(text, uuid) to service_role;
grant execute on function public.entitlement(uuid, text, boolean) to service_role;
grant execute on function public.composer_real_tier(uuid) to service_role;
grant execute on function public.composer_effective_tier(uuid) to service_role;
grant execute on function public.effective_plan_quotas(uuid) to service_role;

revoke execute on function public.my_entitlements() from public, anon;
revoke execute on function public.my_feature_flags() from public, anon;
revoke execute on function public.set_feature_released(text, boolean) from public, anon;
revoke execute on function public.set_my_studio_preview_plan(text) from public, anon;
grant execute on function public.my_entitlements() to authenticated;
grant execute on function public.my_feature_flags() to authenticated;
grant execute on function public.set_feature_released(text, boolean) to authenticated;
grant execute on function public.set_my_studio_preview_plan(text) to authenticated;
