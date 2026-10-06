-- LayerPitch — suppression de compte (29/09, demande de Jules-Antoine : « une fonction de suppression de compte qui efface
-- toutes les données et musiques, sauf ce qui a déjà été vendu à des tiers »). Décisions du 29/09 : 30 jours d'annulation ;
-- les acheteurs gardent tout ce qu'ils ont acheté ; les factures sont conservées (obligation comptable).
--
-- PRINCIPE : on ne supprime pas la ligne du compte (profiles) — sa suppression ferait tomber en cascade les morceaux, packs
-- et albums déjà vendus, les factures et les versements. On SUPPRIME tout ce qui n'est pas vendu, et on ANONYMISE le
-- reste : la ligne du compte (et celles de son profil compositeur / studio) survit, vide de toute donnée personnelle, comme
-- propriétaire de ce que des tiers ont acheté ; l'identité de connexion est effacée par l'Edge Function
-- process-account-deletions (auth.admin.deleteUser en « suppression douce » : l'adresse e-mail disparaît).
--
-- ÉTAPES
--   1. request_account_deletion('SUPPRIMER') : réservé au feu vert 'account_deletion' (admin seulement pendant la bêta) ;
--      vérifie les blocages, arrête tout de suite les ventes (albums et packs), programme la suppression à J+30.
--   2. cancel_account_deletion() : jusqu'à la date prévue (les ventes arrêtées ne sont PAS remises en vente).
--   3. Tous les jours, process-account-deletions (à planifier) prend les comptes échus : résilie Stripe, appelle
--      finalize_account_deletion (base, en une transaction), efface les fichiers R2 mis en file (account_deletion_files),
--      puis supprime l'identité de connexion.
--
-- CE QUI EST GARDÉ (« vendu à des tiers »)
--   * albums ayant au moins un achat réel (non test), et packs achetés par un autre compte ; les morceaux de ce compte qui
--     figurent dans un album acheté (quel qu'en soit le vendeur) ou dans un pack acheté, et les Sfx de ces packs ou de ces
--     morceaux, AVEC leurs fichiers ; les pochettes de ces albums et packs ;
--   * factures (et leurs PDF), achats, versements et écritures de crédits (comptabilité) ;
--   * les messages écrits dans les Projets des autres, qui s'afficheront sans nom.
-- CE QUI EST SUPPRIMÉ : AdReels, collections, morceaux / Sfx / packs / albums non vendus (et leurs fichiers), vidéos,
--   captures, réglages, réseaux sociaux, statistiques, Projets dont le compte est propriétaire (sauf s'il y a un autre membre
--   actif : la propriété passe alors au plus ancien), adhésions aux Projets, ce que le compte a fait comme acheteur
--   (versions, réglages, listes de lecture), packs custom, profil fan, droits particuliers.
-- BLOCAGES : dernier administrateur ; studio avec des membres d'équipe actifs (transférer la propriété d'abord).

alter table public.profiles
  add column deletion_requested_at timestamptz,
  add column deletion_scheduled_for timestamptz,
  add column deleted_at timestamptz;
comment on column public.profiles.deleted_at is 'Compte supprimé (29/09) : la ligne survit, anonymisée, comme propriétaire de ce qui a été vendu à des tiers.';

insert into public.feature_flags (key, description) values
  ('account_deletion', 'Suppression de compte en libre-service (29/09) : demande, annulation sous 30 jours, effacement. Admin seulement pendant la bêta.')
on conflict (key) do nothing;

-- File des fichiers R2 à effacer (préfixes ; keep_keys = fichiers du préfixe à conserver, ex. pochettes d'albums vendus).
create table public.account_deletion_files (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  bucket text not null check (bucket in ('public', 'private')),
  prefix text not null,
  keep_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index account_deletion_files_todo_idx on public.account_deletion_files (created_at) where done_at is null;
alter table public.account_deletion_files enable row level security;
-- Aucune politique : lecture et écriture par les fonctions ci-dessous (service_role) seulement.

-- Ce qui empêche de supprimer ce compte (codes lus par l'écran).
create or replace function public.account_deletion_blockers(p_profile uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text[] := array[]::text[];
begin
  if exists (select 1 from public.profiles where id = p_profile and deleted_at is not null) then v := v || 'already_deleted'; end if;
  if exists (select 1 from public.admins where profile_id = p_profile) and (select count(*) from public.admins) = 1 then v := v || 'last_admin'; end if;
  if exists (select 1 from public.studio_profiles sp join public.studio_members m on m.studio_id = sp.id
             where sp.profile_id = p_profile and m.status = 'active' and m.profile_id is not null and m.profile_id <> p_profile) then v := v || 'studio_team'; end if;
  return v;
end;
$$;
revoke execute on function public.account_deletion_blockers(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_blockers(uuid) to service_role;

-- Ce qui est « vendu à des tiers » pour ce compte : { albums, packs, tracks, sfx } (identifiants).
create or replace function public.account_sold_ids(p_profile uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare c uuid; v_albums text[]; v_packs text[]; v_tracks text[]; v_sfx text[];
begin
  select id into c from public.composer_profiles where profile_id = p_profile;
  select coalesce(array_agg(a.id), array[]::text[]) into v_albums from public.albums a
    where a.seller_id = p_profile and exists (select 1 from public.album_purchases ap where ap.album_id = a.id and not ap.is_test);
  select coalesce(array_agg(k.id), array[]::text[]) into v_packs from public.packs k
    where k.owner_id = c and exists (select 1 from public.pack_purchases pp where pp.pack_id = k.id and pp.studio_id <> p_profile);
  select coalesce(array_agg(t.id), array[]::text[]) into v_tracks from public.tracks t
    where t.owner_id = c and (
      exists (select 1 from public.album_tracks at join public.album_purchases ap on ap.album_id = at.album_id and not ap.is_test where at.track_id = t.id)
      or exists (select 1 from public.pack_tracks pt join public.pack_purchases pp on pp.pack_id = pt.pack_id where pt.track_id = t.id and pp.studio_id <> p_profile));
  select coalesce(array_agg(s.id), array[]::text[]) into v_sfx from public.sfx_library s
    where s.owner_id = c and (
      exists (select 1 from public.pack_sfx ps join public.pack_purchases pp on pp.pack_id = ps.pack_id where ps.sfx_id = s.id and pp.studio_id <> p_profile)
      or exists (select 1 from public.track_sfx ts where ts.sfx_id = s.id and ts.track_id = any(v_tracks)));
  return jsonb_build_object('albums', to_jsonb(v_albums), 'packs', to_jsonb(v_packs), 'tracks', to_jsonb(v_tracks), 'sfx', to_jsonb(v_sfx));
end;
$$;
revoke execute on function public.account_sold_ids(uuid) from public, anon, authenticated;
grant execute on function public.account_sold_ids(uuid) to service_role;

-- ---- Demande, annulation, état (compte connecté) ----
create or replace function public.request_account_deletion(p_confirm text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_blockers text[]; v_when timestamptz; v_composer uuid;
begin
  if v_uid is null then raise exception 'Non autorisé : connexion requise'; end if;
  if not public.feature_released('account_deletion', v_uid) then raise exception 'La suppression de compte n''est pas encore ouverte'; end if;
  if coalesce(p_confirm, '') <> 'SUPPRIMER' then raise exception 'Confirmation incorrecte : tape SUPPRIMER'; end if;
  v_blockers := public.account_deletion_blockers(v_uid);
  if array_length(v_blockers, 1) > 0 then raise exception 'Suppression impossible : %', array_to_string(v_blockers, ', '); end if;
  select deletion_scheduled_for into v_when from public.profiles where id = v_uid;
  if v_when is not null then return v_when; end if; -- déjà demandée
  v_when := now() + interval '30 days';
  update public.profiles set deletion_requested_at = now(), deletion_scheduled_for = v_when where id = v_uid;
  -- Les ventes s'arrêtent tout de suite (les acheteurs existants gardent leurs achats).
  select id into v_composer from public.composer_profiles where profile_id = v_uid;
  update public.albums set buyable = false, updated_at = now() where seller_id = v_uid and buyable;
  if v_composer is not null then update public.packs set buyable = false where owner_id = v_composer and buyable; end if;
  return v_when;
end;
$$;

create or replace function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set deletion_requested_at = null, deletion_scheduled_for = null where id = auth.uid() and deleted_at is null;
end;
$$;

create or replace function public.account_deletion_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('requestedAt', p.deletion_requested_at, 'scheduledFor', p.deletion_scheduled_for,
    'blockers', to_jsonb(public.account_deletion_blockers(p.id)), 'open', public.feature_released('account_deletion', p.id))
  from public.profiles p where p.id = auth.uid();
$$;

revoke execute on function public.request_account_deletion(text), public.cancel_account_deletion(), public.account_deletion_status() from public, anon;
grant execute on function public.request_account_deletion(text), public.cancel_account_deletion(), public.account_deletion_status() to authenticated;

-- ---- Tâche planifiée (service_role) ----
create or replace function public.due_account_deletions()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles where deletion_scheduled_for <= now() and deleted_at is null order by deletion_scheduled_for;
$$;

-- Identifiants Stripe à résilier AVANT l'anonymisation (finalize_account_deletion les efface).
create or replace function public.account_deletion_stripe_ids(p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'customers', to_jsonb(array_remove(array[(select stripe_customer_id from public.composer_profiles where profile_id = p_profile),
                                             (select stripe_customer_id from public.studio_profiles where profile_id = p_profile)], null)),
    'subscriptions', to_jsonb(array_remove(array[(select stripe_subscription_id from public.composer_profiles where profile_id = p_profile),
                                                 (select stripe_subscription_id from public.studio_profiles where profile_id = p_profile)], null)));
$$;

-- Fichiers R2 encore à effacer (lot pour la tâche planifiée).
create or replace function public.pending_deletion_files(p_limit int default 200)
returns setof public.account_deletion_files
language sql
stable
security definer
set search_path = public
as $$
  select * from public.account_deletion_files where done_at is null order by created_at limit p_limit;
$$;
create or replace function public.mark_deletion_file_done(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.account_deletion_files set done_at = now() where id = p_id;
$$;

-- ---- L'effacement lui-même (une transaction) ----
create or replace function public.finalize_account_deletion(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c uuid; s uuid; v_sold jsonb;
  v_albums text[]; v_packs text[]; v_tracks text[]; v_sfx text[]; v_keep text[]; v_keep_studio text[];
  pr record; v_new uuid; v_queued int := 0;
begin
  if not exists (select 1 from public.profiles where id = p_profile and deletion_scheduled_for <= now() and deleted_at is null) then
    raise exception 'Suppression non échue pour ce compte';
  end if;
  if array_length(public.account_deletion_blockers(p_profile), 1) > 0 then raise exception 'Suppression bloquée : %', array_to_string(public.account_deletion_blockers(p_profile), ', '); end if;
  select id into c from public.composer_profiles where profile_id = p_profile;
  select id into s from public.studio_profiles where profile_id = p_profile;

  -- 0. Achats factices du vendeur (jamais « vendus ») : effacés pour libérer ses albums et packs non vendus.
  delete from public.album_purchases ap using public.albums a where ap.album_id = a.id and a.seller_id = p_profile and ap.is_test;
  delete from public.pack_purchases pp using public.packs k
    where pp.pack_id = k.id and k.owner_id = c and pp.studio_id = p_profile
      and not exists (select 1 from public.invoices i where i.purchase_id = pp.id) and not exists (select 1 from public.credit_payouts cp where cp.pack_purchase_id = pp.id);

  v_sold := public.account_sold_ids(p_profile);
  select coalesce(array_agg(x), array[]::text[]) into v_albums from jsonb_array_elements_text(v_sold->'albums') x;
  select coalesce(array_agg(x), array[]::text[]) into v_packs from jsonb_array_elements_text(v_sold->'packs') x;
  select coalesce(array_agg(x), array[]::text[]) into v_tracks from jsonb_array_elements_text(v_sold->'tracks') x;
  select coalesce(array_agg(x), array[]::text[]) into v_sfx from jsonb_array_elements_text(v_sold->'sfx') x;
  -- Pochettes et filigranes à garder (albums et packs vendus).
  select coalesce(array_agg('images/' || i), array[]::text[]) into v_keep from (
    select illustration i from public.albums where id = any(v_albums) and illustration is not null
    union select illustration from public.packs where id = any(v_packs) and illustration is not null
    union select watermark from public.packs where id = any(v_packs) and watermark is not null) k;

  -- 1. Projets dont le compte est propriétaire : transmis à un autre membre actif, sinon supprimés (fichiers mis en file).
  for pr in select id, owner_kind from public.projects where (owner_kind = 'composer' and owner_profile_id = p_profile) or (owner_kind = 'studio' and owner_studio_id = s) loop
    v_new := null;
    if pr.owner_kind = 'composer' then
      select m.profile_id into v_new from public.project_members m
        where m.project_id = pr.id and m.status = 'active' and m.profile_id is not null and m.profile_id <> p_profile
        order by m.joined_at nulls last, m.invited_at limit 1;
    end if;
    if v_new is not null then
      update public.projects set owner_profile_id = v_new where id = pr.id;
      delete from public.project_members where project_id = pr.id and profile_id = v_new; -- le propriétaire n'est pas aussi « membre »
    else
      insert into public.account_deletion_files (profile_id, bucket, prefix) select p_profile, 'private', f.path from public.project_files f where f.project_id = pr.id;
      get diagnostics v_queued = row_count;
      delete from public.projects where id = pr.id;
    end if;
  end loop;
  delete from public.project_members where profile_id = p_profile;
  delete from public.project_notifications where profile_id = p_profile;
  delete from public.project_reads where profile_id = p_profile;

  -- 2. Contenu du compositeur : tout ce qui n'est pas vendu.
  if c is not null then
    insert into public.account_deletion_files (profile_id, bucket, prefix)
      select p_profile, b.bucket, 'audio/' || t.id || '/' from public.tracks t, (values ('public'), ('private')) b(bucket) where t.owner_id = c and t.id <> all(v_tracks);
    insert into public.account_deletion_files (profile_id, bucket, prefix)
      select p_profile, b.bucket, 'audio/sfx-' || x.id || '/' from public.sfx_library x, (values ('public'), ('private')) b(bucket) where x.owner_id = c and x.id <> all(v_sfx);
    insert into public.account_deletion_files (profile_id, bucket, prefix) select p_profile, 'public', 'video/' || v.id || '/' from public.composer_videos v where v.owner_id = c;
    insert into public.account_deletion_files (profile_id, bucket, prefix, keep_keys) values (p_profile, 'public', 'images/' || c || '/', v_keep);
    insert into public.account_deletion_files (profile_id, bucket, prefix) values (p_profile, 'public', 'fonts/' || c || '/');
    delete from public.ad_reels where owner_id = c;
    delete from public.ad_reel_folders where owner_id = c;
    delete from public.collections where owner_id = c;
    delete from public.analytics_events where owner_id = c;
    delete from public.contact_messages where owner_id = c;
    delete from public.settings where owner_id = c;
    delete from public.socials where owner_id = c;
    delete from public.video_capture_versions where owner_id = c;
    delete from public.video_captures where owner_id = c;
    delete from public.composer_videos where owner_id = c;
    delete from public.composer_handle_aliases where composer_id = c;
    delete from public.admin_message_reads where composer_id = c;
    delete from public.albums where seller_id = p_profile and id <> all(v_albums);
    delete from public.packs where owner_id = c and id <> all(v_packs);
    delete from public.tracks where owner_id = c and id <> all(v_tracks);
    delete from public.sfx_library where owner_id = c and id <> all(v_sfx);
    delete from public.track_folders where owner_id = c;
    delete from public.sfx_folders where owner_id = c;
    -- Ce qui reste (vendu) n'est plus en vente ; le profil est vidé de toute donnée personnelle.
    update public.albums set buyable = false where seller_id = p_profile;
    update public.packs set buyable = false where owner_id = c;
    update public.composer_profiles set handle = null, directory_opt_in = false, plan = 'free', student_tier_declared = false, trial_ends_at = null,
      stripe_connect_account_id = null, stripe_connect_charges_enabled = false, stripe_connect_payouts_enabled = false,
      billing_status = null, billing_legal_name = null, billing_address = null, billing_siret = null, billing_vat_number = null, billing_vat_applicable = null,
      stripe_subscription_id = null, stripe_customer_id = null, subscription_status = 'none', subscription_cancel_at = null, bundle_discount_active = false
    where id = c;
  end if;

  -- 3. Studio : packs custom, pochettes d'albums de studio ; le profil est vidé.
  if s is not null then
    select coalesce(array_agg('images/' || i), array[]::text[]) into v_keep_studio from (
      select illustration i from public.albums where id = any(v_albums) and illustration like s::text || '/%') k;
    insert into public.account_deletion_files (profile_id, bucket, prefix, keep_keys) values (p_profile, 'public', 'images/' || s || '/', v_keep_studio);
    delete from public.studio_custom_packs where studio_id = s;
    delete from public.studio_members where studio_id = s;
    update public.studio_profiles set display_name = null, plan = 'solodev', stripe_connect_account_id = null, stripe_connect_charges_enabled = false,
      stripe_connect_payouts_enabled = false, billing_status = null, billing_legal_name = null, billing_address = null, billing_siret = null,
      billing_vat_number = null, billing_vat_applicable = null, subscription_status = 'none', subscription_period_end = null, stripe_customer_id = null,
      stripe_subscription_id = null, subscription_cancel_at = null
    where id = s;
  end if;
  delete from public.studio_members where profile_id = p_profile;

  -- 4. Ce que le compte a fait comme acheteur, invité ou fan.
  delete from public.album_track_versions where buyer_id = p_profile;
  delete from public.album_track_settings where buyer_id = p_profile;
  delete from public.playlists where buyer_id = p_profile;
  delete from public.fan_profiles where profile_id = p_profile;
  delete from public.account_entitlement_overrides where profile_id = p_profile;
  delete from public.admin_message_emails where profile_id = p_profile;
  delete from public.admins where profile_id = p_profile;
  delete from public.album_contributors where profile_id = p_profile;
  -- Co-ayant droit d'un album : l'identité de versement a disparu, le vendeur reverse lui-même la part.
  update public.album_rights_holders set status = 'self_pay' where holder_profile_id = p_profile and status in ('accepted', 'pending');
  delete from public.invites where user_id = p_profile;

  update public.profiles set deleted_at = now(), suspended = true, email_announcements = false where id = p_profile;
  select count(*) into v_queued from public.account_deletion_files where profile_id = p_profile and done_at is null;
  return jsonb_build_object('keptAlbums', to_jsonb(v_albums), 'keptPacks', to_jsonb(v_packs), 'keptTracks', to_jsonb(v_tracks), 'keptSfx', to_jsonb(v_sfx), 'filesQueued', v_queued);
end;
$$;

revoke execute on function public.due_account_deletions(), public.account_deletion_stripe_ids(uuid), public.pending_deletion_files(int),
  public.mark_deletion_file_done(uuid), public.finalize_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.due_account_deletions(), public.account_deletion_stripe_ids(uuid), public.pending_deletion_files(int),
  public.mark_deletion_file_done(uuid), public.finalize_account_deletion(uuid) to service_role;
