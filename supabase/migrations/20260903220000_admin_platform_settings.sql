-- LayerPitch — panneau admin (docs/infrastructure.md, "Décision complémentaire — Rôle admin,
-- panneau analytique, suspension de compte, bandeau d'annonce", actée le 3 septembre, corrigée le
-- même jour : réutilise admins/is_admin() déjà existants (20260901190000_admin_role.sql), pas de
-- nouvelle colonne profiles.is_admin).
--
-- Cette migration pose le schéma seul (colonnes + table + RLS) ; les RPC de lecture/écriture sont
-- dans 20260903220100_admin_rpcs.sql (même découpage que composer_ownership_schema/rpc).

-- ---- Suspension de compte (réversible, jamais "ban" dans l'UI) ----
alter table public.profiles add column suspended boolean not null default false;
comment on column public.profiles.suspended is 'Reflet local du bannissement temporaire Supabase Auth (banned_until sur auth.users) — écrit par l''Edge Function suspend-account, jamais directement par le client. Purement informatif côté lecture : la vraie barrière est le ban Supabase Auth lui-même (empêche la connexion).';

-- ---- Bandeau d'annonce bêta ----
alter table public.profiles add column notice_dismissed_at timestamptz;
comment on column public.profiles.notice_dismissed_at is 'Horodatage du dernier "J''ai vu" du compte sur le bandeau d''annonce (platform_settings.notice_message). Un nouveau message (notice_updated_at plus récent) réaffiche le bandeau même si dismissed_at existe déjà.';

-- Singleton global (même idiome que `settings` à l'origine, 20260831102635) — table réellement
-- globale ici, contrairement à `settings`/`socials` qui ont dû migrer vers un modèle par owner_id
-- le 1er septembre.
create table public.platform_settings (
  id boolean primary key default true,
  constraint platform_settings_singleton check (id),
  notice_message text,
  notice_updated_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.platform_settings is 'Réglages globaux de plateforme (admin uniquement) — aujourd''hui limité au bandeau d''annonce bêta. Ligne unique (id=true), écriture via set_platform_notice() (security definer), jamais un GRANT UPDATE direct.';
insert into public.platform_settings (id) values (true);

alter table public.platform_settings enable row level security;
-- Lecture publique (comme settings/socials, 20260831102636) : le bandeau doit être visible par
-- tout compositeur connecté au backstage, contrairement à `admins` qui n'a volontairement aucune
-- policy de lecture directe (nature différente : texte d'annonce public vs liste admin sensible).
create policy "public read" on public.platform_settings for select using (true);
-- Aucune policy INSERT/UPDATE/DELETE pour anon/authenticated : écriture uniquement via
-- set_platform_notice() (security definer, gated is_admin()) ou service_role.
