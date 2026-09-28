/* ---------------- Connexion Postgres (lien magique) — minimum nécessaire pour débloquer les RPC
 * upsert_* (current_composer_id() exige un appelant authentifié depuis le 31 août), pas le grand
 * chantier de remplacement de l'auth des testeurs bêta (toujours réservé à une session dédiée).
 * Réutilise api/auth.js tel quel, testé de bout en bout le 31 août (auth-test.html).
 */
// Handle public du compositeur connecté (docs/infrastructure.md, chantier backstage hébergé) —
// mis en cache à chaque changement de session plutôt que refait à la demande, pour que
// computeAdReelUrl() reste synchrone (huit points d'appel, dont plusieurs hors contexte async).
let myComposerHandle = null;
async function refreshMyComposerHandle(session) {
  if (!session || !session.user) { myComposerHandle = null; return; }
  const { handle } = await window.LayerPitchAuth.getMyComposerHandle();
  myComposerHandle = handle || null;
  // computeAdReelUrl() dépend de myComposerHandle, chargé de façon asynchrone ici -- si le lien public
  // a déjà été affiché avant que cet appel réseau revienne (course avec loadData()), le rafraîchir
  // maintenant pour ne pas laisser affiché un lien absent/périmé (bug remonté le 11 septembre).
  if (adReels.length) { renderAdReelSelect(); fillAdReelSlugField(adReels.find(a => a.id === currentAdReelId)); }
}

// Palier effectif du compositeur pour le gating de l'apparence (Chantier Apparence Phase 3, 4
// septembre) : pas une lecture brute de composer_profiles.plan -- un essai reverse trial actif doit
// débloquer les réglages Starter/Pro, pas seulement Free. effective_plan_quotas() (SQL) ne renvoie
// jamais un plan boosté (son champ `plan` reste toujours le palier brut, même en essai) -- get_trial_status(),
// déjà câblé ci-dessous pour le panneau "Mon abonnement", est le seul mécanisme qui expose trial_ends_at
// côté client, donc réutilisé ici plutôt que d'ajouter une fonction SQL de plus. Le rôle admin n'est pas
// pris en compte ici -- chantier de gating admin séparé, pas encore fini ailleurs dans le backstage.
function effectiveTierFromTrialStatus(status) {
  if (!status) return 'free';
  // Aperçu admin actif ("Voir en tant que") : le serveur renvoie déjà le palier simulé dans `plan`.
  if (status.previewActive) return status.plan || 'free';
  const trialEndsAt = status.trialEndsAt ? new Date(status.trialEndsAt) : null;
  if (trialEndsAt && trialEndsAt > new Date()) return 'pro';
  return status.plan || 'free';
}
// Palier RÉEL (jamais simulé) : sert uniquement à figer le palier dans ce qui est PUBLIÉ -- une
// publication faite pendant un aperçu admin garde le vrai palier (décision du 23 septembre).
function realTierFromTrialStatus(status) {
  if (!status) return 'free';
  const trialEndsAt = status.trialEndsAt ? new Date(status.trialEndsAt) : null;
  if (trialEndsAt && trialEndsAt > new Date()) return 'pro';
  return status.realPlan || status.plan || 'free';
}
// Optimiste avant la première résolution (évite un flash de galerie Free le temps que la
// session/RPC réponde) -- recalculé par renderSubscriptionPanel() à chaque connexion/changement de
// session, et par publishAll() indépendamment (résolution fraîche à chaque publication, jamais mise
// en cache pour ça -- voir plan de chantier).
let currentEffectivePlan = 'starter';

// Calcule le palier effectif du compositeur connecté (docs/infrastructure.md, chantier 4b —
// décisions du 3 septembre : essai reverse trial de 30 jours sans carte, retombée automatique sur
// Free à l'expiration) -- currentEffectivePlan gate l'apparence par palier, l'onglet Analytics et le
// style de forme d'onde (voir plus bas), donc calculé ici même sans plus aucun panneau "Mon
// abonnement" dans le backstage (retiré le 5 septembre, remplacé par mon-compte.html) : ne JAMAIS
// faire dépendre ce calcul de l'existence d'un élément du DOM.
async function renderSubscriptionPanel(session) {
  if (!session || !session.user) return;
  await loadPostgresReadScripts();
  const { status, error } = await window.LayerPitchSubscriptions.getTrialStatus();
  if (error) return;
  if (!status) {
    currentEffectivePlan = 'free';
    renderAppearancePanelForTier();
    renderAnalyticsPanelForTier();
    return;
  }
  currentEffectivePlan = effectiveTierFromTrialStatus(status);
  syncAdminPreviewUi(status);
  renderAppearancePanelForTier();
  renderAnalyticsPanelForTier();
}

// Sélecteur admin "Voir en tant que" (23 septembre) : le palier simulé est mémorisé côté serveur
// (admins.preview_tier) et appliqué par get_trial_status / composer_effective_tier /
// effective_plan_quotas pour le SEUL compte admin concerné. Bandeau permanent tant qu'il est actif.
function syncAdminPreviewUi(status) {
  const active = !!(status && status.previewActive);
  const select = document.getElementById('adminPreviewTier');
  const banner = document.getElementById('adminPreviewBanner');
  const label = document.getElementById('adminPreviewBannerLabel');
  if (select) select.value = active ? status.plan : '';
  if (banner) banner.hidden = !active;
  if (label && active) label.textContent = tr('adminPreviewBanner', { plan: (ACCOUNT_MENU_PLAN_LABELS[status.plan] || status.plan) });
}
async function setAdminPreviewTier(tier) {
  if (typeof hasUnsavedEdits !== 'undefined' && hasUnsavedEdits && !(await window.LayerPitchNotify.confirm(tr('adminPreviewUnsavedConfirm'), { danger: true }))) {
    const { session } = await window.LayerPitchAuth.getSession();
    await renderSubscriptionPanel(session); // remet le sélecteur sur l'état réel
    return;
  }
  await loadPostgresReadScripts();
  const { ok, error } = await window.LayerPitchSubscriptions.setMyPreviewTier(tier);
  if (!ok) { window.LayerPitchNotify.error(tr('adminPreviewError') + ' ' + error); return; }
  // Rechargement : tout ce qui dépend du palier (apparence, forme d'onde, quotas, analytique...) est
  // évalué à des dizaines d'endroits -- plus fiable que de tous les redessiner un par un. Le choix
  // est mémorisé côté serveur, il survit au rechargement.
  location.reload();
}
// Masque les panneaux de debug/admin (outils de test, connexion de secours, invitation testeur,
// lien vers le panneau admin) pour tout compte non-admin -- trouvé le 4 septembre, jamais
// filtré jusqu'ici (seule la liste d'emails Cloudflare Access limitait qui atteint la page du
// tout, docs/infrastructure.md). Confort d'affichage uniquement, comme dans admin.html : la vraie
// barrière reste is_admin() côté serveur (RPC SECURITY DEFINER, RLS) sur chaque action, jamais
// cette vérification client seule.
const ADMIN_ONLY_PANEL_IDS = ['panelAdminTools', 'panelPgWrite', 'panelAccessRequests', 'panelInviteTester', 'panelInvitesSent', 'panelAdminLink', 'adminPreviewMenuWrap', 'appAdminTierOverrideWrap'];
// La bibliothèque vidéo / capture (navItemVideoLibrary, panelVideoLibrary) avait été ouverte à tout
// compositeur connecté le 16 septembre (voir
// supabase/migrations/20260916040000_open_capture_video_to_composers.sql, toujours en place côté
// RPC) puis regrisée pour tout le monde SAUF l'admin le même jour, une fois la compression vidéo
// côté navigateur confirmée trop lente pour un vrai usage (moteur multi-coeur essayé et abandonné,
// voir layerpitch_video_compression_single_thread_limit.md) -- pas une régression de sécurité, un
// simple bouton nav désactivé (navVideoLibraryBadge) ; le RPC reste ouvert, donc à re-durcir en base
// aussi si jamais ça devait rester fermé pour de bon. Prévu : rouvrir la compression côté serveur
// avant de rouvrir cette zone à tout le monde.
// Statut admin mis en cache une fois par session (7 septembre) -- lu par renderPacks() pour
// désactiver la case "en vente" (voir plus bas, un compositeur ordinaire ne doit pas pouvoir mettre
// son propre pack en vente). Confort d'affichage uniquement : la vraie barrière est désormais
// dans upsert_pack lui-même (supabase/migrations/20260907090000_upsert_pack_buyable_admin_only.sql),
// pas cette variable -- un appel RPC direct contournant l'UI reste bloqué même si ce flag est faux
// à tort.
let currentUserIsAdmin = false;
// Droits du compte connecté lus dans la matrice (chantier profils et permissions, 27-28/09) : my_entitlements()
// renvoie, pour chaque fonction de chaque profil du compte, { allowed, amount, level } avec les feux verts déjà
// appliqués. Remplace peu à peu les grisages fondés sur currentUserIsAdmin. Tant que la réponse n'est pas arrivée,
// can() répond « non » : rien ne s'ouvre par erreur, et le serveur refuse de toute façon (même matrice).
let myEntitlements = {};
function can(feature) { const e = myEntitlements[feature]; return !!(e && e.allowed); }
// Feux verts (feature_flags) vus par le compte connecté : ouvert si le feu vert est donné OU si le compte est admin.
let myFlags = {};
function flagOpen(key) { return !!myFlags[key]; }
// Fonctions audio : le feu vert global 'audio_fx' ouvre tout, sinon chaque sous-clé (pitch, triggers, rtpc…) séparément.
function fxOpen(key) { return flagOpen('audio_fx') || flagOpen(key); }
function entitlementLevel(feature) { const e = myEntitlements[feature]; return e && e.allowed ? e.level : null; }
async function loadMyEntitlements() {
  const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('my_entitlements');
  if (error) { console.warn('my_entitlements() en erreur, droits inchangés :', error.message || error); return; }
  const next = {};
  (data || []).forEach(r => { next[r.feature] = { allowed: r.allowed, amount: r.amount == null ? null : Number(r.amount), level: r.level, plan: r.plan, source: r.source }; });
  myEntitlements = next;
  const flags = await window.LayerPitchSupabaseClient.getClient().rpc('my_feature_flags');
  if (flags.error) { console.warn('my_feature_flags() en erreur, feux verts inchangés :', flags.error.message || flags.error); return; }
  const nf = {};
  (flags.data || []).forEach(r => { nf[r.key] = !!r.allowed; });
  myFlags = nf;
}
async function renderAdminOnlyPanels(session) {
  let isAdmin = false;
  if (session && session.user) {
    await loadPostgresReadScripts();
    // Plusieurs événements d'auth arrivent au chargement (session en cache, puis jeton rafraîchi) et
    // lancent chacun cette vérification en parallèle. Un appel parti avec un jeton expiré répond en
    // ERREUR (data null) -- auparavant lu comme "pas admin", et s'il se résolvait en dernier il
    // regrisait tout pour l'admin (constaté le 25/09 par Jules-Antoine, connecté admin). Désormais :
    // un nouvel essai, puis une erreur ne change jamais le statut déjà connu.
    const client = window.LayerPitchSupabaseClient.getClient();
    let res = await client.rpc('is_admin');
    if (res.error) {
      await new Promise(r => setTimeout(r, 1500));
      res = await client.rpc('is_admin');
    }
    if (res.error) {
      console.warn('is_admin() en erreur, statut admin inchangé :', res.error.message || res.error);
      return;
    }
    isAdmin = !!res.data;
  }
  currentUserIsAdmin = isAdmin;
  if (session && session.user) await loadMyEntitlements();
  if (adReels.length) fillAdReelSlugField(adReels.find(a => a.id === currentAdReelId)); // champ d'adresse : admin seulement
  ADMIN_ONLY_PANEL_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !isAdmin;
  });
  const videoNavBtn = document.getElementById('navItemVideoLibrary');
  const videoNavBadge = document.getElementById('navVideoLibraryBadge');
  if (videoNavBtn) videoNavBtn.disabled = !flagOpen('video_upload');
  if (videoNavBadge) videoNavBadge.hidden = flagOpen('video_upload');
  // Onglet Albums : admin seulement pendant la bêta (à rouvrir aux compositeurs au lancement, voir
  // le verrou jumeau dans upsert_album / claim_test_album).
  const studioLink = document.getElementById('accountMenuStudio');
  if (studioLink) studioLink.hidden = !flagOpen('studio_space');
  const projectsLink = document.getElementById('accountMenuProjects');
  if (projectsLink) projectsLink.hidden = !flagOpen('projects');
  // Navigation commune de la barre (28/09) : Projets selon le feu vert ; rubrique Studio si le compte a un studio
  // (le sien ou celui de son équipe, casquette non masquée par « Voir en tant que ») et que l'espace studio est ouvert.
  const navProjects = document.getElementById('navLinkProjects');
  if (navProjects) navProjects.hidden = !flagOpen('projects');
  if (window.LayerPitchAuth && window.LayerPitchAuth.getMyStudioId) {
    window.LayerPitchAuth.getMyStudioId().then(({ studioId }) => {
      const show = !!studioId && flagOpen('studio_space');
      ['navSectionStudio', 'navLinkStudioLibrary', 'navLinkCatalog', 'navLinkStudioTeam', 'navLinkStudioPlan'].forEach(id => {
        const el = document.getElementById(id); if (el) el.hidden = !show;
      });
    });
  }
  const albumsNavBtn = document.getElementById('navItemAlbums');
  if (albumsNavBtn) albumsNavBtn.hidden = !can('sell_albums');
  if (isAdmin) { renderAccessRequestsList(); renderInvitesSentList(); }
  // Le statut admin peut se résoudre après un premier rendu de la Bibliothèque (session déjà en cache
  // vs RPC is_admin() encore en vol) -- redessine pour refléter le grisage pitch correctement, sans quoi
  // un admin verrait le pitch grisé jusqu'au prochain clic (renderLibrary() no-op si le panneau n'est pas
  // monté, voir sa garde en tête de fonction).
  renderLibrary();
  const sfxDrop = document.getElementById('sfxLibraryDrop');
  if (sfxDrop) sfxDrop.classList.toggle('is-disabled', !flagOpen('bulk_drop'));
  const sfxDropHint = document.getElementById('sfxBatchDropAdminHint');
  if (sfxDropHint) sfxDropHint.textContent = flagOpen('bulk_drop') ? '' : tr('fxAdminOnlyHint');
  if (typeof renderSfxLibrary === 'function') renderSfxLibrary(); // même raison : l'entrée "Espace" des Sfx est réservée à l'admin
  if (typeof renderPacks === 'function') renderPacks(); // prix et catalogue abonnés : droits lus dans la matrice
}
// Demandes d'accès en attente (bloc "Inviter un testeur" ci-dessous, 6 septembre) -- une seule
// fonction de rendu réutilisée après chaque invitation réussie pour retirer la ligne traitée.
async function renderAccessRequestsList() {
  const listEl = document.getElementById('accessRequestsList');
  if (!listEl) return;
  const { requests, error } = await window.LayerPitchAccessRequests.getPendingAccessRequests();
  if (error) { listEl.textContent = 'Erreur : ' + error; return; }
  if (!requests.length) { listEl.textContent = 'Aucune demande en attente pour l\'instant.'; return; }
  const sourceLabel = (r) => r.source === 'blocked_signin'
    ? 'connexion refusée (pas encore invité)'
    : (r.intent === 'waitlist' ? 'landing — "Tenez-moi au courant"' : 'landing — "Rejoindre la bêta"');
  listEl.innerHTML = requests.map((r) => `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid #e2e2e6;">
      <div style="flex:1;">
        <div>${escapeHtml(r.email)}</div>
        <div style="font-size:11px;color:var(--text-dimmer);">${sourceLabel(r)} — ${new Date(r.created_at).toLocaleString('fr-FR')}</div>
        ${r.message ? `<div style="font-size:12px;margin-top:4px;padding:6px 8px;background:#f4f4f6;border-radius:6px;white-space:pre-wrap;">${escapeHtml(r.message)}</div>` : ''}
      </div>
      <button class="btn btn-small" type="button" data-request-id="${r.id}" data-request-email="${escapeAttr(r.email)}">Inviter</button>
      <button class="btn btn-small" type="button" data-delete-request-id="${r.id}" title="Écarter sans inviter">Supprimer</button>
    </div>`).join('');
  listEl.querySelectorAll('button[data-request-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const emailField = document.getElementById('inviteTesterEmail');
      emailField.value = btn.dataset.requestEmail;
      emailField.dataset.pendingRequestId = btn.dataset.requestId;
      emailField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      emailField.focus();
    });
  });
  // Écarte une demande sans l'inviter (doublon, spam, déjà traitée autrement) -- retour de
  // Jules-Antoine le 11 septembre : sans ça, la liste ne fait que grossir.
  listEl.querySelectorAll('button[data-delete-request-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { ok, error } = await window.LayerPitchAccessRequests.deleteAccessRequest(Number(btn.dataset.deleteRequestId));
      if (!ok) { window.LayerPitchNotify.error('Erreur : ' + error); btn.disabled = false; return; }
      renderAccessRequestsList();
    });
  });
}
// Invitations envoyées (bloc "Invitations envoyées" ci-dessous, 16 septembre) -- réutilisée après
// chaque invitation réussie pour faire apparaître la nouvelle ligne sans recharger la page.
async function renderInvitesSentList() {
  const listEl = document.getElementById('invitesSentList');
  if (!listEl) return;
  const { invites, error } = await window.LayerPitchInvites.getInvites();
  if (error) { listEl.textContent = 'Erreur : ' + error; return; }
  if (!invites.length) { listEl.textContent = 'Aucune invitation envoyée pour l\'instant.'; return; }
  listEl.innerHTML = invites.map((inv) => {
    const status = inv.accepted_at
      ? 'Inscrit·e le ' + new Date(inv.accepted_at).toLocaleString('fr-FR')
      : 'En attente';
    const langBadge = (inv.lang === 'en' ? 'EN' : 'FR');
    return `
    <div style="position:relative;display:flex;align-items:center;gap:10px;padding:6px 22px 6px 0;border-top:1px solid #e2e2e6;">
      <div style="flex:1;">
        <div>${escapeHtml(inv.email)} <span style="font-size:10px;color:var(--text-dimmer);border:1px solid #e2e2e6;border-radius:3px;padding:0 4px;">${langBadge}</span></div>
        <div style="font-size:11px;color:var(--text-dimmer);">Invité·e le ${new Date(inv.created_at).toLocaleString('fr-FR')}</div>
      </div>
      <div style="font-size:12px;${inv.accepted_at ? 'color:var(--text-dim);' : 'color:var(--text-dimmer);'}">${status}</div>
      <button type="button" class="btn-invite-delete" data-invite-id="${inv.id}" title="Effacer" aria-label="Effacer" style="position:absolute;top:4px;right:0;border:none;background:none;color:var(--text-dimmer);font-size:14px;line-height:1;cursor:pointer;padding:2px 4px;">×</button>
    </div>`;
  }).join('');
  // Petite croix de suppression (17 septembre, demande de Jules-Antoine) -- suppression libre
  // (pending ou inscrit·e), voir supabase/migrations/20260917010000_delete_invite.sql.
  listEl.querySelectorAll('.btn-invite-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { ok, error } = await window.LayerPitchInvites.deleteInvite(Number(btn.dataset.inviteId));
      if (!ok) { window.LayerPitchNotify.error('Erreur : ' + error); btn.disabled = false; return; }
      renderInvitesSentList();
    });
  });
}
function renderPgAuthStatus(session) {
  const el = document.getElementById('pgAuthStatus');
  const signOutBtn = document.getElementById('btnPgSignOut');
  if (!el) return;
  if (session && session.user) {
    el.textContent = 'Connecté en tant que ' + session.user.email;
    if (signOutBtn) signOutBtn.style.display = '';
  } else {
    el.textContent = 'Non connecté.';
    if (signOutBtn) signOutBtn.style.display = 'none';
  }
}
// Libellés courts, même mapping que planLabel() dans mon-compte.html -- pas mutualisé dans un
// module partagé pour un objet de trois entrées utilisé à un seul endroit ici.
const ACCOUNT_MENU_PLAN_LABELS = { free: 'Free', starter: 'Starter', pro: 'Pro' };
async function renderAccountMenu(session) {
  const emailEl = document.getElementById('accountMenuEmail');
  const planEl = document.getElementById('accountMenuPlan');
  const avatarEl = document.getElementById('accountMenuAvatar');
  const signOutBtn = document.getElementById('btnAccountSignOut');
  if (!emailEl) return;
  if (session && session.user) {
    emailEl.textContent = session.user.email;
    if (avatarEl) avatarEl.textContent = (session.user.email || '?').trim().charAt(0).toUpperCase() || '?';
    if (signOutBtn) signOutBtn.hidden = false;
    // Langue du backstage enregistrée sur le compte (21/09) : l'email d'annonce (notify-admin-message)
    // part dans cette langue -- jusqu'ici elle n'existait que dans localStorage, illisible côté
    // serveur. Fire-and-forget : jamais bloquant pour l'ouverture du backstage.
    loadPostgresReadScripts().then(() => window.LayerPitchNotificationPrefs.syncMyLang(currentLang())).catch(() => {});
    // Palier affiché directement dans le menu (15/09, chantier de regroupement des réglages de
    // compte) : évite d'ouvrir "Mon compte" juste pour savoir où on en est.
    if (planEl) {
      await loadPostgresReadScripts();
      const { status } = await window.LayerPitchSubscriptions.getTrialStatus();
      if (status && status.plan) {
        planEl.textContent = tr('accountMenuPlanLabel', { plan: ACCOUNT_MENU_PLAN_LABELS[status.plan] || status.plan });
        planEl.hidden = false;
      } else {
        planEl.hidden = true;
      }
    }
  } else {
    emailEl.textContent = tr('accountMenuNotConnected');
    if (avatarEl) avatarEl.textContent = '?';
    if (signOutBtn) signOutBtn.hidden = true;
    if (planEl) planEl.hidden = true;
  }
}
function initAccountMenuUi() {
  const menuBtn = document.getElementById('btnAccountMenu');
  const dropdown = document.getElementById('accountMenuDropdown');
  const signOutBtn = document.getElementById('btnAccountSignOut');
  if (!menuBtn || !dropdown) return;
  const closeMenu = () => { dropdown.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dropdown.hidden;
    dropdown.hidden = !willOpen;
    menuBtn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) document.dispatchEvent(new CustomEvent('lp-header-menu-open', { detail: 'account' }));
  });
  // stopPropagation() ci-dessus empêche le clic sur ce bouton d'atteindre le gestionnaire "clic
  // ailleurs" de la boîte de réception : les deux menus s'excluent donc via cet événement dédié.
  document.addEventListener('lp-header-menu-open', (e) => { if (e.detail !== 'account' && !dropdown.hidden) closeMenu(); });
  document.addEventListener('click', (e) => {
    if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== menuBtn) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      closeMenu();
      await loadPostgresReadScripts();
      await window.LayerPitchAuth.signOut();
      window.location.replace('bienvenue.html');
    });
  }
  const feedbackBtn = document.getElementById('btnAccountFeedback');
  if (feedbackBtn) feedbackBtn.addEventListener('click', () => { closeMenu(); openFeedbackModal(); });
}
// Boîte de réception unique (15 septembre, fusion des deux cloches précédentes "Messages de
// LayerPitch" et "Notifications" — Jules-Antoine les trouvait redondantes côte à côte). Les deux
// sources de données restent distinctes en base (admin_messages/admin_message_reads pour les
// annonces plateforme -- lecture publique + lignes de lecture propres au compositeur, un message
// n'a pas un seul destinataire ; contact_messages pour les messages du bloc "Contact" public --
// simple flag seen_at, un message ici a exactement un destinataire) : seule la présentation est
// unifiée. Depuis le 21 septembre (retour direct : "s'inspirer de YT"), une seule liste
// chronologique mêle les deux sources au lieu de deux sections empilées.
const INBOX_ICON_ANNOUNCEMENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M18 6.5a8 8 0 0 1 0 11"/></svg>';
const INBOX_ICON_MESSAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9.5l-4 4V16H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z"/></svg>';
const INBOX_ICON_COLLAPSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
function formatRelativeTime(iso) {
  const lang = currentLang() === 'en' ? 'en' : 'fr';
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 30 * 86400) return rtf.format(Math.round(diffSec / 86400), 'day');
  return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR');
}
async function renderInboxBell(session) {
  const badge = document.getElementById('inboxBellBadge');
  const emptyEl = document.getElementById('inboxEmpty');
  const listEl = document.getElementById('inboxList');
  if (!badge || !emptyEl || !listEl) return;
  if (!session || !session.user) {
    badge.hidden = true;
    listEl.innerHTML = ''; emptyEl.hidden = false;
    return;
  }
  await loadPostgresReadScripts();
  const client = window.LayerPitchSupabaseClient.getClient();
  const [{ data: adminMessages, error: adminError }, { data: adminReads }, { data: contactMessages, error: contactError }] = await Promise.all([
    client.from('admin_messages').select('id, body, title, created_at').order('created_at', { ascending: false }).limit(20),
    client.from('admin_message_reads').select('message_id'),
    client.from('contact_messages').select('id, ad_reel_label, sender_name, sender_email, created_at, seen_at').order('created_at', { ascending: false }).limit(20),
  ]);
  const seenIds = new Set((adminReads || []).map(r => r.message_id));
  // title/text sont déjà du HTML sûr : tout contenu venant d'un visiteur ou d'un admin passe par
  // escapeHtml() avant d'arriver ici. Titre d'une annonce : celui saisi par l'admin (admin.html) dans
  // la langue du compositeur, sinon le titre générique.
  const items = [];
  if (!adminError && adminMessages) {
    adminMessages.forEach(m => items.push({
      kind: 'announcement', createdAt: m.created_at, unread: !seenIds.has(m.id),
      title: escapeHtml((m.title && (m.title[currentLang()] || m.title.fr)) || tr('inboxAnnouncementTitle')),
      text: escapeHtml((m.body && (m.body[currentLang()] || m.body.fr)) || ''),
    }));
  }
  if (!contactError && contactMessages) {
    contactMessages.forEach(m => items.push({
      kind: 'contact', createdAt: m.created_at, unread: !m.seen_at,
      title: tr('inboxContactTitle', { name: escapeHtml(m.sender_name) }),
      text: tr('inboxContactBody', { adreel: escapeHtml(m.ad_reel_label), email: escapeHtml(m.sender_email) }),
    }));
  }
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const shown = items.slice(0, 20);
  listEl.innerHTML = shown.map(it => `
    <div class="inbox-item${it.unread ? ' unread' : ''}">
      <div class="inbox-icon">${it.kind === 'announcement' ? INBOX_ICON_ANNOUNCEMENT : INBOX_ICON_MESSAGE}</div>
      <div class="inbox-body">
        <div class="inbox-title-row">
          <div class="inbox-title">${it.title}</div>
          <button class="inbox-collapse" type="button" hidden title="${tr('inboxReadLess')}" aria-label="${tr('inboxReadLess')}">${INBOX_ICON_COLLAPSE}</button>
        </div>
        <div class="inbox-text">${it.text}</div>
        <button class="inbox-more" type="button" hidden>${tr('inboxReadMore')}</button>
        <div class="inbox-time">${formatRelativeTime(it.createdAt)}</div>
      </div>
      <div class="inbox-dot"></div>
    </div>`).join('');
  emptyEl.hidden = shown.length > 0;
  badge.hidden = !shown.some(it => it.unread);
}
function initInboxBellUi() {
  const bellBtn = document.getElementById('btnInboxBell');
  const dropdown = document.getElementById('inboxBellDropdown');
  if (!bellBtn || !dropdown) return;
  // Le bouton "Lire la suite" n'a de sens que si le texte est réellement tronqué : mesurable
  // seulement une fois le menu affiché (hidden = aucune dimension), donc à chaque ouverture.
  const refreshClamps = () => {
    dropdown.querySelectorAll('.inbox-item').forEach(item => {
      const text = item.querySelector('.inbox-text');
      const more = item.querySelector('.inbox-more');
      const collapse = item.querySelector('.inbox-collapse');
      if (!text || !more) return;
      const expanded = text.classList.contains('expanded');
      more.hidden = !(expanded || text.scrollHeight > text.clientHeight + 1);
      more.textContent = tr(expanded ? 'inboxReadLess' : 'inboxReadMore');
      // Bouton de repli en haut du message (21/09) : un long message déplié met "Réduire" tout en
      // bas, hors de vue -- la flèche à côté du titre reste toujours à portée.
      if (collapse) collapse.hidden = !expanded;
    });
  };
  const closeMenu = () => {
    dropdown.hidden = true; bellBtn.setAttribute('aria-expanded', 'false');
    // Les points "non lu" ont servi pendant cette ouverture (les messages sont marqués vus à
    // l'ouverture) : plus la peine de les remontrer si on rouvre sans recharger la page.
    dropdown.querySelectorAll('.inbox-item.unread').forEach(el => el.classList.remove('unread'));
  };
  dropdown.addEventListener('click', (e) => {
    const more = e.target.closest('.inbox-more');
    const collapse = e.target.closest('.inbox-collapse');
    if (!more && !collapse) return;
    const item = (more || collapse).closest('.inbox-item');
    const text = item.querySelector('.inbox-text');
    if (collapse) text.classList.remove('expanded'); else text.classList.toggle('expanded');
    refreshClamps();
    // Après un repli, le message peut se retrouver hors de vue (la liste défile dans le menu).
    if (!text.classList.contains('expanded')) item.scrollIntoView({ block: 'nearest' });
  });
  bellBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const willOpen = dropdown.hidden;
    if (!willOpen) { closeMenu(); return; }
    dropdown.hidden = false;
    bellBtn.setAttribute('aria-expanded', 'true');
    document.dispatchEvent(new CustomEvent('lp-header-menu-open', { detail: 'inbox' }));
    refreshClamps();
    requestAnimationFrame(refreshClamps);
    // Marqué vu à l'ouverture (pas avant) : le badge doit rester visible tant que le compositeur n'a
    // pas effectivement regardé la boîte, même s'il a rechargé la page entretemps. Les deux RPC de
    // "vu" restent séparées (une par source) même si le badge, lui, est désormais commun.
    const badge = document.getElementById('inboxBellBadge');
    if (badge && !badge.hidden) {
      await loadPostgresReadScripts();
      const client = window.LayerPitchSupabaseClient.getClient();
      await Promise.all([
        client.rpc('mark_admin_messages_seen'),
        client.rpc('mark_contact_messages_seen'),
      ]);
      badge.hidden = true;
    }
  });
  document.addEventListener('lp-header-menu-open', (e) => { if (e.detail !== 'inbox' && !dropdown.hidden) closeMenu(); });
  document.addEventListener('click', (e) => {
    if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== bellBtn) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dropdown.hidden) closeMenu(); });
}
async function initPgAuthUi() {
  const sendBtn = document.getElementById('btnPgSendMagicLink');
  const signOutBtn = document.getElementById('btnPgSignOut');
  if (!sendBtn) return;
  sendBtn.addEventListener('click', async () => {
    const email = document.getElementById('pgAuthEmail').value.trim();
    if (!email) { window.LayerPitchNotify.info('Renseigne ton email.'); return; }
    sendBtn.disabled = true;
    try {
      await loadPostgresReadScripts();
      const { ok, error } = await window.LayerPitchAuth.signInWithMagicLink(email, window.location.href);
      if (ok) window.LayerPitchNotify.success('Lien envoyé — vérifie ta boîte mail.'); else window.LayerPitchNotify.error('Erreur : ' + error);
    } catch (e) { window.LayerPitchNotify.error('Erreur : ' + e.message); }
    sendBtn.disabled = false;
  });
  const verifyCodeBtn = document.getElementById('btnPgVerifyCode');
  if (verifyCodeBtn) {
    verifyCodeBtn.addEventListener('click', async () => {
      const email = document.getElementById('pgAuthEmail').value.trim();
      const code = document.getElementById('pgAuthCode').value.trim();
      if (!email || !code) { window.LayerPitchNotify.info('Renseigne ton email et le code reçu.'); return; }
      verifyCodeBtn.disabled = true;
      try {
        await loadPostgresReadScripts();
        const { ok, error } = await window.LayerPitchAuth.verifyEmailOtp(email, code);
        if (!ok) window.LayerPitchNotify.error('Erreur : ' + error);
      } catch (e) { window.LayerPitchNotify.error('Erreur : ' + e.message); }
      verifyCodeBtn.disabled = false;
    });
  }
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await loadPostgresReadScripts();
      await window.LayerPitchAuth.signOut();
      window.location.replace('bienvenue.html');
    });
  }
  const inviteBtn = document.getElementById('btnInviteTester');
  if (inviteBtn) {
    inviteBtn.addEventListener('click', async () => {
      const email = document.getElementById('inviteTesterEmail').value.trim();
      const lang = document.getElementById('inviteTesterLang').value === 'en' ? 'en' : 'fr';
      const personalMessage = document.getElementById('inviteTesterMessage').value.trim();
      if (!email) { window.LayerPitchNotify.info('Renseigne l\'email du testeur.'); return; }
      inviteBtn.disabled = true;
      try {
        await loadPostgresReadScripts();
        // Redirige vers bienvenue.html (flux d'inscription, docs/infrastructure.md), pas vers le
        // backstage lui-même -- sinon tout nouvel invité atterrit directement dans l'outil
        // compositeur sans jamais voir l'écran d'accueil. ?lang= : bienvenue.html le lit et le
        // propage à localStorage.layerpitch_lang (voir currentLang() plus haut dans ce fichier),
        // donc à l'écran d'accueil ET au message de bienvenue personnel -- sans ce paramètre,
        // tout le monde recevait la version française par défaut (11 septembre).
        const emailFieldForRequestId = document.getElementById('inviteTesterEmail');
        const pendingRequestId = emailFieldForRequestId.dataset.pendingRequestId
          ? Number(emailFieldForRequestId.dataset.pendingRequestId) : null;
        const { ok, error, actionLink } = await window.LayerPitchAuth.inviteTester(email, window.location.origin + '/bienvenue.html?lang=' + lang, personalMessage, pendingRequestId, lang);
        if (ok) {
          window.LayerPitchNotify.success('Invitation envoyée à ' + email + '.');
          // Si cette invitation part d'une demande d'accès en attente (bouton "Inviter" de la
          // liste ci-dessus), la marquer traitée maintenant que l'envoi a réellement réussi --
          // jamais avant, pour ne pas perdre une demande si l'envoi avait échoué.
          const emailField = document.getElementById('inviteTesterEmail');
          if (emailField.dataset.pendingRequestId) {
            await window.LayerPitchAccessRequests.markAccessRequestInvited(Number(emailField.dataset.pendingRequestId));
            delete emailField.dataset.pendingRequestId;
            renderAccessRequestsList();
          }
          renderInvitesSentList();
          emailField.value = '';
          document.getElementById('inviteTesterMessage').value = '';
          document.getElementById('inviteTesterLang').value = 'fr';
        } else if (actionLink) {
          // Compte créé mais email jamais parti (Resend en échec) -- le lien de secours doit être
          // transmis à la main plutôt que de perdre l'invitation.
          window.LayerPitchNotify.error('Erreur : ' + error + '\n\nLien à transmettre toi-même à ' + email + ' :\n' + actionLink);
        } else {
          window.LayerPitchNotify.error('Erreur : ' + error);
        }
      } catch (e) { window.LayerPitchNotify.error('Erreur : ' + e.message); }
      inviteBtn.disabled = false;
    });
  }
  // Presets de période + période personnalisée du tableau de bord Analytics (refonte du 23
  // septembre). Un preset plus long que la rétention du palier est grisé (cadenas) et ne fait rien.
  document.querySelectorAll('#analyticsPresets .analytics-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('locked')) return;
      analyticsPreset = btn.dataset.preset;
      analyticsCustomRange = null;
      renderAnalyticsPresets();
      loadAnalyticsDashboard();
    });
  });
  const analyticsFilterBtn = document.getElementById('btnAnalyticsFilterApply');
  if (analyticsFilterBtn) {
    analyticsFilterBtn.addEventListener('click', () => {
      const fromEl = document.getElementById('analyticsFromInput');
      const toEl = document.getElementById('analyticsToInput');
      if (!(fromEl && fromEl.value) && !(toEl && toEl.value)) return;
      analyticsCustomRange = {
        from: fromEl && fromEl.value ? new Date(fromEl.value + 'T00:00:00').toISOString() : new Date(Date.now() - analyticsRetentionDays() * 864e5).toISOString(),
        to: toEl && toEl.value ? new Date(toEl.value + 'T23:59:59').toISOString() : new Date().toISOString(),
      };
      renderAnalyticsPresets();
      loadAnalyticsDashboard();
    });
  }
  const analyticsRawDetails = document.getElementById('analyticsRawDetails');
  if (analyticsRawDetails) {
    analyticsRawDetails.addEventListener('toggle', () => {
      if (analyticsRawDetails.open && analyticsRawLoadedForTier !== currentEffectivePlan) loadAnalyticsRawSessions();
    });
  }
  // Si la page vient d'un lien magique (fragment #access_token=...), le SDK Supabase détecte et
  // établit la session automatiquement dès sa création (detectSessionInUrl, comportement par défaut) —
  // il suffit de charger les scripts et de s'abonner pour le refléter dans l'UI.
  await loadPostgresReadScripts();
  if (window.LayerPitchAuth) {
    window.LayerPitchAuth.onAuthStateChange((_event, session) => {
      renderPgAuthStatus(session); refreshMyComposerHandle(session); renderSubscriptionPanel(session);
      renderAdminOnlyPanels(session); renderAccountMenu(session); renderInboxBell(session);
    });
  }
}
