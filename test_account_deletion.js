// Suppression de compte (migration 20260929070000) : demande, annulation, délai de 30 jours, ce qui est effacé, ce qui est
// gardé parce que vendu à des tiers, blocages, file des fichiers R2 — et garde-fou : chaque lien de clé étrangère vers un
// compte doit avoir une règle connue ici (sinon un futur ajout de table pourrait bloquer ou laisser des données).
// Base jetable PGlite.
(async () => {
  process.on('unhandledRejection', e => { console.log('FAIL - erreur inattendue : ' + (e && e.message)); process.exit(1); });
  let freshDb;
  try { ({ freshDb } = await import('./scripts/pglite-db.mjs')); }
  catch (e) { console.log('FAIL - PGlite absent : lancer « npm install » une fois (' + e.message + ')'); process.exit(1); }
  const db = await freshDb();
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const U = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const as = n => db.query(`select set_config('test.uid', $1, false)`, [n ? U(n) : '']);
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const one = async (sql, args) => Object.values((await q(sql, args))[0])[0];
  const count = (t, where, args) => one(`select count(*)::int from public.${t} ${where ? 'where ' + where : ''}`, args);
  const fails = async (sql, args, re) => { try { await db.query(sql, args); return false; } catch (e) { return re ? re.test(e.message) : true; } };
  const mk = async (n, email) => { await q(`insert into auth.users (id, email) values ($1, $2)`, [U(n), email]); await q(`insert into public.profiles (id) values ($1) on conflict do nothing`, [U(n)]); };

  // ---- Garde-fou : toute clé étrangère vers un compte a une règle connue ----
  const HANDLED = new Set(`
    account_entitlement_overrides.profile_id admin_message_emails.profile_id admin_messages.recipient_id admins.profile_id album_contributors.profile_id
    album_payouts.beneficiary_profile_id album_purchases.buyer_id album_rights_holders.holder_profile_id album_track_settings.buyer_id album_fan_prefs.buyer_id album_track_versions.buyer_id
    album_tracks.added_by albums.seller_id composer_profiles.profile_id fan_profiles.profile_id invites.user_id invites.invited_by invoices.beneficiary_profile_id
    pack_purchases.studio_id playlists.buyer_id project_activity.actor_id project_albums.linked_by project_annotations.resolved_by project_annotations.addressee_id
    project_annotations.author_id project_assets.created_by project_files.uploaded_by project_members.profile_id project_members.invited_by project_messages.author_id
    project_moodboard_pins.pinned_by project_notifications.profile_id project_reads.profile_id project_shared_packs.shared_by project_snapshots.created_by
    project_vitrines.created_by project_maps.created_by project_sections.created_by project_section_assets.added_by project_section_pins.pinned_by projects.owner_profile_id projects.created_by studio_credit_ledger.actor_id studio_members.profile_id studio_profiles.profile_id
    profiles.id
    ad_reel_folders.owner_id ad_reels.owner_id admin_message_reads.composer_id analytics_events.owner_id collections.owner_id composer_handle_aliases.composer_id
    composer_videos.owner_id contact_messages.owner_id credit_payouts.composer_id invoices.composer_id packs.owner_id settings.owner_id sfx_folders.owner_id
    sfx_library.owner_id socials.owner_id track_folders.owner_id tracks.owner_id video_capture_versions.owner_id video_captures.owner_id
    invoices.studio_id projects.owner_studio_id studio_credit_ledger.studio_id studio_custom_packs.studio_id studio_members.studio_id`.split(/\s+/).filter(Boolean));
  const fks = await q(`select c.conrelid::regclass::text as tbl, a.attname as col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.confrelid::regclass::text in ('profiles', 'auth.users', 'composer_profiles', 'studio_profiles')`);
  const unknown = fks.map(f => f.tbl + '.' + f.col).filter(k => !HANDLED.has(k));
  check('garde-fou : aucune clé étrangère vers un compte sans règle de suppression (' + (unknown.join(', ') || 'ok') + ')', unknown.length === 0);

  // ---- Jeu d'essai ----
  for (const [n, e] of [[1, 'vendeur'], [2, 'acheteur'], [3, 'membre'], [4, 'studio'], [5, 'admin'], [6, 'equipier']]) await mk(n, e + '@x.test');
  const c1 = (await q(`insert into public.composer_profiles (profile_id, handle, stripe_customer_id, stripe_subscription_id, billing_legal_name) values ($1, 'jean', 'cus_1', 'sub_1', 'Jean SARL') returning id`, [U(1)]))[0].id;
  const s4 = (await q(`insert into public.studio_profiles (profile_id, display_name) values ($1, 'Studio X') returning id`, [U(4)]))[0].id;
  await q(`insert into public.admins (profile_id) values ($1)`, [U(5)]);
  await q(`insert into public.tracks (id, owner_id, title, mode) values ('tS', $1, 'Vendu album', 'static'), ('tU', $1, 'Invendu', 'static'), ('tP', $1, 'Vendu pack', 'static')`, [c1]);
  await q(`insert into public.sfx_library (id, owner_id, title) values ('sfS', $1, 'Sfx vendu'), ('sfU', $1, 'Sfx invendu')`, [c1]);
  await q(`insert into public.albums (id, seller_id, seller_role, title, buyable, price_eur_cents, illustration) values ('alS', $1, 'composer', 'Album vendu', true, 500, $2), ('alU', $1, 'composer', 'Album invendu', true, 500, null), ('alT', $1, 'composer', 'Album test', true, 500, null)`, [U(1), c1 + '/album-alS.png']);
  await q(`insert into public.album_tracks (album_id, track_id, position) values ('alS', 'tS', 0), ('alU', 'tU', 0), ('alT', 'tU', 0)`);
  await q(`insert into public.album_purchases (buyer_id, album_id, price_paid, is_test) values ($1, 'alS', 5, false), ($2, 'alT', 0, true)`, [U(2), U(1)]);
  await q(`insert into public.packs (id, owner_id, title, buyable, price_eur_cents, illustration) values ('pkS', $1, 'Pack vendu', true, 500, $2), ('pkU', $1, 'Pack invendu', true, 500, null)`, [c1, c1 + '/pack-pkS.png']);
  await q(`insert into public.pack_tracks (pack_id, track_id, position) values ('pkS', 'tP', 0), ('pkU', 'tU', 0)`);
  await q(`insert into public.pack_sfx (pack_id, sfx_id, position) values ('pkS', 'sfS', 0)`);
  const pp = (await q(`insert into public.pack_purchases (studio_id, pack_id, price_paid) values ($1, 'pkS', 5) returning id`, [U(2)]))[0].id;
  await q(`insert into public.invoices (purchase_id, composer_id, invoice_number, document_type, pdf_storage_path, seller_snapshot, buyer_snapshot, amount_ttc) values ($1, $2, 'F-1', 'facture', 'invoices/f1.pdf', '{"nom":"Jean SARL"}'::jsonb, '{}'::jsonb, 5)`, [pp, c1]);
  await q(`insert into public.ad_reels (id, owner_id, label, profile, blocks) values ('r1', $1, 'R', '{}'::jsonb, '[]'::jsonb)`, [c1]);
  await q(`insert into public.ad_reel_tracks (ad_reel_id, track_id, position, owner_id) values ('r1', 'tU', 0, $1)`, [c1]);
  await q(`insert into public.socials (id, platform, owner_id) values ('so1', 'x', $1)`, [c1]);
  await q(`insert into public.composer_videos (id, owner_id, file) values ('v1', $1, 'a.mp4')`, [c1]);
  await q(`insert into public.contact_messages (owner_id, ad_reel_id, ad_reel_label, sender_name, sender_email) values ($1, 'r1', 'R', 'Bob', 'b@x.test')`, [c1]);
  await q(`insert into public.playlists (buyer_id) values ($1)`, [U(1)]);
  await q(`insert into public.fan_profiles (profile_id) values ($1) on conflict do nothing`, [U(1)]);
  // Projets : p1 (avec un membre actif -> transmis), p2 (seul -> supprimé, fichier en file), p3 (à quelqu'un d'autre, le compte y est membre)
  await q(`insert into public.projects (id, title, owner_kind, owner_profile_id, created_by) values ('11111111-1111-1111-1111-111111111111', 'P1', 'composer', $1, $1), ('22222222-2222-2222-2222-222222222222', 'P2', 'composer', $1, $1), ('33333333-3333-3333-3333-333333333333', 'P3', 'composer', $2, $2)`, [U(1), U(3)]);
  await q(`insert into public.project_members (project_id, email, profile_id, status, joined_at) values ('11111111-1111-1111-1111-111111111111', 'membre@x.test', $1, 'active', now()), ('33333333-3333-3333-3333-333333333333', 'vendeur@x.test', $2, 'active', now())`, [U(3), U(1)]);
  await q(`insert into public.project_files (project_id, path, mime_type, size_bytes, status) values ('22222222-2222-2222-2222-222222222222', 'projects/p2/f.png', 'image/png', 10, 'ready')`);
  await q(`insert into public.project_messages (project_id, author_id, body) values ('33333333-3333-3333-3333-333333333333', $1, 'coucou')`, [U(1)]);

  // ---- Demande ----
  await as(1);
  check('feu vert fermé : un compte ordinaire ne peut pas demander', await fails(`select public.request_account_deletion('SUPPRIMER')`, [], /pas encore ouverte/));
  await db.query(`update public.feature_flags set released = true where key = 'account_deletion'`);
  check('confirmation incorrecte refusée', await fails(`select public.request_account_deletion('supprimer')`, [], /Confirmation incorrecte/));
  const when = await one(`select public.request_account_deletion('SUPPRIMER')`);
  const days = (new Date(when) - Date.now()) / 86400000;
  check('demande : suppression programmée dans 30 jours', days > 29.9 && days < 30.1);
  check('demande : les ventes s\'arrêtent tout de suite (albums et packs)', (await count('albums', `seller_id = $1 and buyable`, [U(1)])) === 0 && (await count('packs', `owner_id = $1 and buyable`, [c1])) === 0);
  check('demande : rien n\'est encore effacé', (await count('tracks', `owner_id = $1`, [c1])) === 3 && (await count('ad_reels', `owner_id = $1`, [c1])) === 1);
  check('état : demandé, date, sans blocage', (await one(`select public.account_deletion_status()`)).scheduledFor && (await one(`select public.account_deletion_status()->'blockers'`)).length === 0);
  await db.query(`select public.cancel_account_deletion()`);
  check('annulation : plus de suppression prévue', (await one(`select public.account_deletion_status()->>'scheduledFor'`)) === null);
  await one(`select public.request_account_deletion('SUPPRIMER')`);
  check('finalize avant l\'échéance : refusé', await fails(`select public.finalize_account_deletion($1)`, [U(1)], /non échue/));

  // ---- Échéance ----
  await db.query(`update public.profiles set deletion_scheduled_for = now() - interval '1 day' where id = $1`, [U(1)]);
  check('tâche planifiée : le compte échu est listé', (await q(`select * from public.due_account_deletions()`)).length === 1);
  const ext = await one(`select public.account_deletion_stripe_ids($1)`, [U(1)]);
  check('identifiants Stripe à résilier lus avant l\'anonymisation', ext.customers[0] === 'cus_1' && ext.subscriptions[0] === 'sub_1');
  await q(`insert into public.album_fan_prefs (buyer_id, album_id, dice) values ($1, 'alS', true), ($2, 'alS', true)`, [U(1), U(2)]); // préférences du dé : celles du compte supprimé partent, celles de l'acheteur restent
  const res = await one(`select public.finalize_account_deletion($1)`, [U(1)]);
  check('EFFACÉ : préférences du dé du compte supprimé ; GARDÉ : celles de l\'acheteur', (await count('album_fan_prefs', `buyer_id = $1`, [U(1)])) === 0 && (await count('album_fan_prefs', `buyer_id = $1`, [U(2)])) === 1);

  check('GARDÉ : album vendu (achat réel), hors vente', (await count('albums', `id = 'alS' and not buyable`)) === 1);
  check('GARDÉ : pack vendu, hors vente', (await count('packs', `id = 'pkS' and not buyable`)) === 1);
  check('GARDÉ : morceau de l\'album vendu, morceau du pack vendu et Sfx du pack vendu', (await count('tracks', `id in ('tS', 'tP')`)) === 2 && (await count('sfx_library', `id = 'sfS'`)) === 1);
  check('GARDÉ : l\'acheteur garde son achat', (await count('album_purchases', `buyer_id = $1 and album_id = 'alS'`, [U(2)])) === 1 && (await count('pack_purchases', `studio_id = $1`, [U(2)])) === 1);
  check('GARDÉ : facture et son PDF référencé (obligation comptable)', (await count('invoices', `invoice_number = 'F-1' and pdf_storage_path = 'invoices/f1.pdf'`)) === 1);
  check('ANONYMISÉ : profil vidé (identifiants, facturation, adresse publique)', await (async () => { const r = (await q(`select handle, stripe_customer_id, stripe_subscription_id, billing_legal_name, plan from public.composer_profiles where id = $1`, [c1]))[0]; return r.handle === null && r.stripe_customer_id === null && r.stripe_subscription_id === null && r.billing_legal_name === null && r.plan === 'free'; })());
  check('ANONYMISÉ : compte marqué supprimé, plus de courriels', (await count('profiles', `id = $1 and deleted_at is not null and suspended and not email_announcements`, [U(1)])) === 1);
  check('EFFACÉ : morceau, Sfx, album et pack non vendus', (await count('tracks', `id = 'tU'`)) === 0 && (await count('sfx_library', `id = 'sfU'`)) === 0 && (await count('albums', `id = 'alU'`)) === 0 && (await count('packs', `id = 'pkU'`)) === 0);
  check('EFFACÉ : album avec achat factice seulement', (await count('albums', `id = 'alT'`)) === 0 && (await count('album_purchases', `album_id = 'alT'`)) === 0);
  check('EFFACÉ : AdReels, réseaux sociaux, vidéos, messages de contact, liste de lecture, profil fan', (await count('ad_reels')) === 0 && (await count('socials')) === 0 && (await count('composer_videos')) === 0 && (await count('contact_messages')) === 0 && (await count('playlists', `buyer_id = $1`, [U(1)])) === 0 && (await count('fan_profiles', `profile_id = $1`, [U(1)])) === 0);
  check('PROJETS : celui qui a un autre membre actif est transmis (et le membre en devient propriétaire)', (await one(`select owner_profile_id from public.projects where id = '11111111-1111-1111-1111-111111111111'`)) === U(3) && (await count('project_members', `project_id = '11111111-1111-1111-1111-111111111111'`)) === 0);
  check('PROJETS : celui où il était seul est supprimé', (await count('projects', `id = '22222222-2222-2222-2222-222222222222'`)) === 0 && (await count('project_files')) === 0);
  check('PROJETS : son adhésion au projet d\'un autre est retirée, son message reste sans nom', (await count('project_members', `profile_id = $1`, [U(1)])) === 0 && (await count('project_messages', `body = 'coucou'`)) === 1);
  const files = await q(`select bucket, prefix, keep_keys from public.account_deletion_files where profile_id = $1 order by bucket, prefix`, [U(1)]);
  const has = (b, p) => files.some(f => f.bucket === b && f.prefix === p);
  check('FICHIERS : audio du morceau invendu en file (seaux public ET privé), pas celui des morceaux vendus', has('public', 'audio/tU/') && has('private', 'audio/tU/') && !files.some(f => /audio\/(tS|tP|sfx-sfS)\//.test(f.prefix)));
  check('FICHIERS : Sfx invendu, vidéo, polices, fichier du Projet supprimé en file', has('public', 'audio/sfx-sfU/') && has('public', 'video/v1/') && has('public', 'fonts/' + c1 + '/') && has('private', 'projects/p2/f.png'));
  check('FICHIERS : images du compositeur en file SAUF les pochettes des albums et packs vendus', (files.find(f => f.prefix === 'images/' + c1 + '/') || { keep_keys: [] }).keep_keys.slice().sort().join() === ['images/' + c1 + '/album-alS.png', 'images/' + c1 + '/pack-pkS.png'].sort().join());
  check('résumé : ce qui est gardé', res.keptAlbums.join() === 'alS' && res.keptPacks.join() === 'pkS' && res.keptTracks.slice().sort().join() === 'tP,tS' && res.keptSfx.join() === 'sfS');
  check('le compte n\'est plus dans la liste des suppressions échues', (await q(`select * from public.due_account_deletions()`)).length === 0);
  check('finalize deux fois : refusé (déjà supprimé)', await fails(`select public.finalize_account_deletion($1)`, [U(1)], /non échue/));
  const todo = await q(`select id from public.pending_deletion_files(500)`);
  await db.query(`select public.mark_deletion_file_done($1)`, [todo[0].id]);
  check('file de fichiers : un fichier marqué fait sort de la liste à traiter', (await q(`select id from public.pending_deletion_files(500)`)).length === todo.length - 1);
  check('acheteur : peut encore lire l\'album vendu (droit d\'accès inchangé)', await (async () => { await as(2); return one(`select public.can_hear_track('tS')`); })());

  // ---- Blocages ----
  await as(5);
  check('dernier administrateur : suppression bloquée', await fails(`select public.request_account_deletion('SUPPRIMER')`, [], /last_admin/));
  await q(`insert into public.studio_members (studio_id, email, profile_id, status) values ($1, 'equipier@x.test', $2, 'active')`, [s4, U(6)]);
  await as(4);
  check('studio avec un équipier actif : bloqué jusqu\'au transfert de propriété', await fails(`select public.request_account_deletion('SUPPRIMER')`, [], /studio_team/));
  await as(2);
  check('acheteur simple (sans contenu) : peut demander', !!(await one(`select public.request_account_deletion('SUPPRIMER')`)));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
