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
  if (adReels.length) fillAdReelSlugField(adReels.find(a => a.id === currentAdReelId)); // champ d'adresse : admin seulement
  ADMIN_ONLY_PANEL_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !isAdmin;
  });
  const videoNavBtn = document.getElementById('navItemVideoLibrary');
  const videoNavBadge = document.getElementById('navVideoLibraryBadge');
  if (videoNavBtn) videoNavBtn.disabled = !isAdmin;
  if (videoNavBadge) videoNavBadge.hidden = isAdmin;
  // Onglet Albums : admin seulement pendant la bêta (à rouvrir aux compositeurs au lancement, voir
  // le verrou jumeau dans upsert_album / claim_test_album).
  const albumsNavBtn = document.getElementById('navItemAlbums');
  if (albumsNavBtn) albumsNavBtn.hidden = !isAdmin;
  if (isAdmin) { renderAccessRequestsList(); renderInvitesSentList(); }
  // Le statut admin peut se résoudre après un premier rendu de la Bibliothèque (session déjà en cache
  // vs RPC is_admin() encore en vol) -- redessine pour refléter le grisage pitch correctement, sans quoi
  // un admin verrait le pitch grisé jusqu'au prochain clic (renderLibrary() no-op si le panneau n'est pas
  // monté, voir sa garde en tête de fonction).
  renderLibrary();
  const sfxDrop = document.getElementById('sfxLibraryDrop');
  if (sfxDrop) sfxDrop.classList.toggle('is-disabled', !isAdmin);
  const sfxDropHint = document.getElementById('sfxBatchDropAdminHint');
  if (sfxDropHint) sfxDropHint.textContent = isAdmin ? '' : tr('fxAdminOnlyHint');
  if (typeof renderSfxLibrary === 'function') renderSfxLibrary(); // même raison : l'entrée "Espace" des Sfx est réservée à l'admin
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
function pushEvent(entry) {
  try {
    if (entry.context === 'test' || !window.umami || typeof window.umami.track !== 'function') return;
    window.umami.track('backstage_' + entry.type, Object.assign({ name: String(entry.name).slice(0, 200) }, entry.detail));
  } catch (e) { /* jamais bloquant pour l'utilisateur */ }
}
function trackBackstageEvent(name, detail) {
  pushEvent({ type: 'action', name, ts: new Date().toISOString(), context: isModeTest() ? 'test' : 'real', detail: detail || {} });
}
function trackBackstageError(message, detail) {
  pushEvent({ type: 'error', name: message, ts: new Date().toISOString(), context: isModeTest() ? 'test' : 'real', detail: detail || {} });
}
window.addEventListener('error', (e) => {
  trackBackstageError(e.message, { source: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  trackBackstageError((e.reason && e.reason.message) || String(e.reason), { unhandledRejection: true });
});

function switchTab(tabName) {
  document.querySelectorAll('.backstage-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tabName));
  document.querySelectorAll('.nav-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
}
document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!btn.disabled) {
      switchTab(btn.dataset.tab);
      trackBackstageEvent('tab_switch', { tab: btn.dataset.tab });
      // Chargement à la demande (appel RPC get_my_analytics()) -- jamais au chargement du
      // backstage, seulement quand le compositeur ouvre vraiment l'onglet.
      if (btn.dataset.tab === 'analytics') loadAnalyticsIfNeeded();
      if (btn.dataset.tab === 'videoLibrary') renderVideoLibrary();
      if (btn.dataset.tab === 'albums') loadAlbums();
    }
  });
});

const BLOCK_LABELS = { header: tr('blockLabelHeader'), bio: tr('blockLabelBio'), testimonials: tr('blockLabelTestimonials'), tracks: tr('blockLabelTracks'), text: tr('blockLabelText'), photo: tr('blockLabelPhoto'), video: tr('blockLabelVideo'), packs: tr('blockLabelPacks'), collections: tr('blockLabelCollections'), sfx: tr('blockLabelSfx'), contact: tr('blockLabelContact') };
const SINGLETON_TYPES = ['header', 'bio', 'testimonials', 'tracks'];
const KNOWN_TYPES = ['header', 'bio', 'testimonials', 'tracks', 'text', 'photo', 'video'];

// Thème général d'un AdReel : remplace les anciens champs profile.bgColor/textColor (gardés en lecture
// seule pour la rétrocompatibilité — jamais réécrits, seul profile.theme est publié désormais).
const DEFAULT_THEME = { bgColor: '#f6f5f3', titleColor: '#262521', contentColor: '#262521', sectionLabelColor: '#c9713c', font: 'default', bgImage: null, bgImageOpacity: 1 };
// Liste de polices Google Fonts pré-intégrées — mélange délibéré sans-serif/serif/display pour couvrir
// différents styles de pitch (neutre/technique vs plus éditorial), sans imposer d'upload personnalisé.
const GOOGLE_FONTS_PRESET = [
  'Inter', 'Space Grotesk', 'Poppins', 'Sora', 'Manrope',
  'Playfair Display', 'Fraunces', 'DM Serif Display', 'Spectral', 'Zilla Slab',
  'IBM Plex Mono', 'JetBrains Mono'
];
// Champs d'apparence personnalisables, partagés entre le réglage général (profile.theme) et les
// réglages par bloc (block.appearance) — un seul et même jeu de champs, une seule UI générique.
// type 'color' -> <input type=color> ; type 'font' -> sélecteur (buildFontSelectOptionsHtml).
const APPEARANCE_FIELDS = [
  { key: 'bgColor', label: 'themeBgColorLabel', type: 'color' },
  { key: 'titleColor', label: 'themeTitleColorLabel', type: 'color' },
  { key: 'contentColor', label: 'themeContentColorLabel', type: 'color' },
  { key: 'sectionLabelColor', label: 'themeSectionLabelColorLabel', type: 'color' },
  { key: 'font', label: 'themeFontLabel', type: 'font' },
  { key: 'bgImage', label: 'themeBgImageLabel', type: 'image' },
  { key: 'bgImageOpacity', label: 'themeBgImageOpacityLabel', type: 'opacity' }
];
// Presets Free (Chantier Apparence Phase 3, 4 septembre) : le palier Free n'a plus accès aux réglages
// fins (couleurs/police/séparateurs libres) -- seulement le choix d'un des 6 presets ci-dessous, qui
// fige tout (fond, titres, contenu, police, séparateur) en un clic. Stocké comme un identifiant
// (profile.theme.presetId / pack.presetId / collection.presetId), jamais dupliqué en valeurs de
// couleur dans les données du compositeur -- la résolution id -> valeurs se fait ici et, à l'identique
// (copié tel quel), côté chacune des 3 pages publiques. Contraste vérifié WCAG AA (voir changelog) :
// pire ratio observé 4.29:1 (titre Ambre, réservé au grand texte du header -> seuil AA 3:1, large marge).
const THEME_PRESETS = [
  { id: 'default', labelKey: 'themePresetDefault', bgColor: '#FAFAF8', titleColor: '#1A1A1A', contentColor: '#333333', font: 'default', separator: { visible: true, color: '#E0E0DC', thickness: 1 } },
  { id: 'night', labelKey: 'themePresetNight', bgColor: '#121212', titleColor: '#FFFFFF', contentColor: '#C9C9CE', font: 'default', separator: { visible: true, color: '#3A3A40', thickness: 1 } },
  { id: 'amber', labelKey: 'themePresetAmber', bgColor: '#F5EDE0', titleColor: '#A85C1E', contentColor: '#5C4530', font: 'google:Fraunces', separator: { visible: true, color: '#C99A6B', thickness: 3 } },
  { id: 'neon', labelKey: 'themePresetNeon', bgColor: '#1B1035', titleColor: '#FF3EA5', contentColor: '#D9CFFF', font: 'google:Space Grotesk', separator: { visible: true, color: '#7A5FFF', thickness: 1 } },
  { id: 'forest', labelKey: 'themePresetForest', bgColor: '#16321F', titleColor: '#D4AF37', contentColor: '#EDE6D6', font: 'google:Zilla Slab', separator: { visible: true, color: '#8C7A3D', thickness: 1 } },
  { id: 'minimal', labelKey: 'themePresetMinimal', bgColor: '#FFFFFF', titleColor: '#000000', contentColor: '#4D4D4D', font: 'google:Manrope', separator: { visible: false, color: '#E0E0DC', thickness: 1 } }
];
function resolveThemePreset(presetId) {
  return THEME_PRESETS.find(p => p.id === presetId) || THEME_PRESETS[0];
}
// 6 thèmes supplémentaires, réservés au départ rapide du palier Pro (10 septembre) -- jamais proposés
// dans la galerie Free, jamais résolus par resolveThemePreset() ci-dessus (qui reste la lecture utilisée
// par le rendu public pour le palier Free, inchangée). Contraste WCAG AA vérifié via contrastRatio()
// ci-dessous, pire ratio observé 4.22:1 (titre Sakura, grand texte du header -> seuil AA 3:1, large
// marge) ; tous les autres ratios de contenu ≥ 4.5:1 (texte normal, seuil le plus strict).
const THEME_PRESETS_PRO = [
  { id: 'ocean', labelKey: 'themePresetOcean', bgColor: '#0A2E36', titleColor: '#4ECDC4', contentColor: '#B8E3E0', font: 'google:Sora', separator: { visible: true, color: '#1F5A63', thickness: 1 } },
  { id: 'crimson', labelKey: 'themePresetCrimson', bgColor: '#1A0A0A', titleColor: '#E63946', contentColor: '#D9B8B8', font: 'google:DM Serif Display', separator: { visible: true, color: '#5C1A1A', thickness: 2 } },
  { id: 'sakura', labelKey: 'themePresetSakura', bgColor: '#FDF2F4', titleColor: '#D6336C', contentColor: '#6B4650', font: 'google:Poppins', separator: { visible: true, color: '#F3C6D3', thickness: 1 } },
  { id: 'steel', labelKey: 'themePresetSteel', bgColor: '#1C1F26', titleColor: '#A8B5C4', contentColor: '#8E9AAC', font: 'google:IBM Plex Mono', separator: { visible: true, color: '#3A4150', thickness: 1 } },
  { id: 'royal', labelKey: 'themePresetRoyal', bgColor: '#2E0F1D', titleColor: '#D4AF37', contentColor: '#E8DCC8', font: 'google:Playfair Display', separator: { visible: true, color: '#6B4A8C', thickness: 2 } },
  { id: 'dune', labelKey: 'themePresetDune', bgColor: '#EDE0C8', titleColor: '#A64B2A', contentColor: '#6B5842', font: 'google:Spectral', separator: { visible: true, color: '#C9A876', thickness: 1 } }
];
// Résolution pour le départ rapide Pro uniquement : cherche dans les 12 (6 Free + 6 Pro). Ne remplace
// PAS resolveThemePreset() -- celle-ci reste la lecture Free/rendu public, jamais étendue aux 6 Pro
// puisque le palier Pro ne stocke jamais de presetId (voir applyThemePresetQuickFill).
function resolveAnyThemePreset(presetId) {
  return THEME_PRESETS.concat(THEME_PRESETS_PRO).find(p => p.id === presetId) || THEME_PRESETS[0];
}
// Réglage des séparateurs entre blocs/sections, indépendant du reste du thème général -- palier Starter
// et au-dessus uniquement (le palier Free suit le séparateur imposé par son preset). Absent tant que le
// compositeur n'y touche pas -> aucun changement visuel pour les AdReels/Packs/Collections déjà publiés
// (il n'existe aucun séparateur visuel aujourd'hui, seulement du margin entre blocs/sections).
const DEFAULT_SEPARATOR = { visible: false, color: '#E4E1DA', thickness: 1 };

// ---- Utilitaires couleur (Chantier Apparence, réglage par élément, palier Pro, 05/09) --------------
// Contraste WCAG AA (formule officielle W3C) -- aucune fonction de ce genre n'existait avant ce chantier
// dans tout le projet (la vérification des 6 THEME_PRESETS avait été faite via un script Node ponctuel,
// jamais committé, voir docs/LAYERPITCH_CHANGELOG.md). Utilisée ici pour un avertissement EN DIRECT
// pendant l'édition (pas un blocage : le compositeur reste libre de son choix, juste informé).
function hexToRgb(hex) {
  const clean = (hex || '').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (full.length !== 6 || isNaN(num)) return { r: 0, g: 0, b: 0 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function relativeLuminance({ r, g, b }) {
  const chan = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lA, lB), darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}
const WCAG_AA_TEXT_RATIO = 4.5; // seuil AA texte normal (le plus strict des deux seuils AA -- volontairement pas 3:1 "grand texte", plus prudent sans distinguer la taille réelle de chaque élément)
// Variante atténuée d'une couleur -- mélange à 55% vers un gris neutre (148,148,148). Utilisée comme
// couleur "à jouer" par défaut (forme d'onde/barre de progression) avant toute personnalisation : point
// d'architecture 2 du chantier ("ne pas livrer un état visuellement cassé tant que le compositeur n'a
// rien réglé").
function mutedVariant(hex) {
  const { r, g, b } = hexToRgb(hex);
  const mix = c => Math.round(c * 0.45 + 148 * 0.55);
  return '#' + [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Registre déclaratif des éléments personnalisables par type de bloc -- copie exacte de celui d'index.html
// (même principe de duplication que THEME_PRESETS/DEFAULT_SEPARATOR déjà dupliqués entre backstage et
// pages publiques, pas de module JS partagé dans ce projet). `selector` n'est pas utilisé ici (l'UI
// d'édition ne rend pas le DOM public), gardé pour éviter toute divergence de structure entre les deux
// copies. type 'text' -> {color, font} ; 'simple' -> {color} ; 'twostate' -> {playedColor, unplayedColor}.
const ELEMENT_APPEARANCE_REGISTRY = {
  header: [
    { key: 'title', type: 'text', labelKey: 'elHeaderTitle', selector: '.header-title' },
    { key: 'subtitle', type: 'text', labelKey: 'elHeaderSubtitle', selector: '.header-subtitle' },
    { key: 'logo', type: 'simple', simpleKind: 'frame', labelKey: 'elHeaderLogo', selector: '.logo-img' }
  ],
  bio: [
    { key: 'title', type: 'text', labelKey: 'elBioTitle', selector: '.section-label' },
    { key: 'body', type: 'text', labelKey: 'elBioBody', selector: '.bio-text p' }
  ],
  testimonials: [
    { key: 'quote', type: 'text', labelKey: 'elTestimonialQuote', selector: '.testimonial p' },
    { key: 'author', type: 'text', labelKey: 'elTestimonialAuthor', selector: '.testimonial cite' },
    { key: 'role', type: 'text', labelKey: 'elTestimonialRole', selector: '.testimonial-role' },
    { key: 'avatar', type: 'simple', simpleKind: 'frame', labelKey: 'elTestimonialAvatar', selector: '.testimonial-avatar' }
  ],
  tracks: [
    { key: 'title', type: 'text', labelKey: 'elTrackTitle', selector: '.track-row-title .name' },
    { key: 'description', type: 'text', labelKey: 'elTrackDescription', selector: '.track-desc' },
    { key: 'tags', type: 'text', labelKey: 'elTrackTags', selector: '.track-tags .tag' },
    { key: 'waveform', type: 'twostate', labelKey: 'elTrackWaveform' },
    { key: 'progressBar', type: 'twostate', labelKey: 'elTrackProgressBar' },
    { key: 'playButton', type: 'simple', simpleKind: 'icon', labelKey: 'elTrackPlayButton', selector: '.play-btn' }
  ],
  text: [
    { key: 'title', type: 'text', labelKey: 'elTextTitle', selector: '.text-block-title' },
    { key: 'body', type: 'text', labelKey: 'elTextBody', selector: '.text-block p' }
  ],
  photo: [
    { key: 'caption', type: 'text', labelKey: 'elPhotoCaption', selector: '.photo-block-caption' },
    { key: 'border', type: 'simple', simpleKind: 'border', labelKey: 'elPhotoBorder', selector: '.photo-block-single img, .photo-grid img' }
  ],
  video: [
    { key: 'title', type: 'text', labelKey: 'elVideoTitle', selector: '.vt' },
    { key: 'caption', type: 'text', labelKey: 'elVideoCaption', selector: '.video-comment' }
  ],
  packs: [
    { key: 'title', type: 'text', labelKey: 'elPacksTitle', selector: '.packs-list-item-title' },
    { key: 'presentation', type: 'text', labelKey: 'elPacksPresentation', selector: '.block-presentation' },
    { key: 'illustration', type: 'simple', simpleKind: 'border', labelKey: 'elPacksIllustration', selector: '.packs-list-item-thumb' }
  ],
  collections: [
    { key: 'title', type: 'text', labelKey: 'elCollectionsTitle', selector: '.packs-list-item-title' },
    { key: 'presentation', type: 'text', labelKey: 'elCollectionsPresentation', selector: '.block-presentation' },
    { key: 'illustration', type: 'simple', simpleKind: 'border', labelKey: 'elCollectionsIllustration', selector: '.packs-list-item-thumb' }
  ],
  sfx: [
    { key: 'title', type: 'text', labelKey: 'elSfxTitle', selector: '.track-row-title .name' },
    { key: 'tag', type: 'text', labelKey: 'elSfxTag', selector: '.track-tags .tag' }
  ],
  contact: [
    { key: 'buttonLabel', type: 'text', labelKey: 'elContactButtonLabel', selector: '.contact-form button' },
    { key: 'formFields', type: 'simple', simpleKind: 'border', labelKey: 'elContactFormFields', selector: '.contact-form input, .contact-form textarea' }
  ]
};

// Reconstruit un thème complet à partir d'un profil quelconque : profile.theme s'il existe déjà, sinon
// dérivé des anciens champs bgColor/textColor s'ils existent (une seule teinte de texte à l'époque,
// reprise à la fois pour titleColor et contentColor faute de mieux), sinon les valeurs par défaut.
function migrateProfileTheme(rawProfile) {
  if (rawProfile && rawProfile.theme) return Object.assign({}, DEFAULT_THEME, rawProfile.theme);
  if (rawProfile && (rawProfile.bgColor || rawProfile.textColor)) {
    return {
      bgColor: rawProfile.bgColor || DEFAULT_THEME.bgColor,
      titleColor: rawProfile.textColor || DEFAULT_THEME.titleColor,
      contentColor: rawProfile.textColor || DEFAULT_THEME.contentColor,
      font: DEFAULT_THEME.font,
      bgImage: DEFAULT_THEME.bgImage,
      bgImageOpacity: DEFAULT_THEME.bgImageOpacity
    };
  }
  return Object.assign({}, DEFAULT_THEME);
}

let blocks = [];        // [{id, type, ...content pour text/photo/video}] — de l'AdReel en cours d'édition
let blockCards = {};    // id -> DOM element (card)
let profile = { title: '', subtitle: '', bio: '', contactEmail: '', contactUrl: '', logo: null, photo: null, theme: Object.assign({}, DEFAULT_THEME) };
let logoPendingFile = null, photoPendingFile = null;
// Image de fond générale de l'AdReel en cours d'édition — même principe de va-et-vient que logo/photo
// (fichier en attente hors de profile.theme lui-même, pour ne jamais contaminer la sérialisation de
// profile.theme avec un objet File non publiable ; mirroré vers/depuis ar.themeBgImagePendingFile au
// changement d'AdReel, uploadé à la publication).
let themeBgImagePendingFile = null;
let testimonials = [];
let trackIds = [];      // sélection ordonnée de morceaux (ids) pour l'AdReel en cours d'édition
// Surcharges de texte par morceau, propres à cet AdReel (jamais aux Packs) : { [trackId]: { title?, description?, layers?: {[li]: label}, stingers?: {[si]: label} } }.
// Absent = on garde le texte de la Bibliothèque tel quel. Permet par ex. une version anglaise d'un AdReel
// sans toucher aux textes français de référence dans la Bibliothèque.
let trackOverrides = {};
let library = [];       // bibliothèque de morceaux, partagée entre tous les AdReels et Packs
// Dossiers de la bibliothèque de morceaux (20/08, même mécanisme générique que les dossiers d'AdReel/Sfx).
let libraryFolders = [];
const collapsedLibraryFolderIds = new Set();
// Quel morceau est affiché dans le panneau de détail à droite de la bibliothèque -- par défaut, le
// premier de la liste.
let manageLibrarySelectedId = null;
// Bibliothèque de Sfx, partagée comme la bibliothèque de morceaux — chaque entrée : { id, title,
// description, rrMode: 'random'|'sequential', duckMainTrack, alternatives: [{label, remoteFile, pendingFile}] }.
// Note de session : la migration automatique des anciens stingers (upload direct par morceau) vers cette
// bibliothèque est délibérément différée à la phase où le bouton du morceau change de mécanisme (Phase 3)
// plutôt que faite ici — migrer les données maintenant sans encore relire depuis la bibliothèque casserait
// la lecture publique des Sfx déjà publiés, le temps qu'entre les deux phases. Rien n'est perdu, juste reporté.
let sfxLibrary = [];
// Dossiers de la bibliothèque Sfx (20/08, même mécanisme générique que les dossiers d'AdReel) : { id, label }.
let sfxFolders = [];
const collapsedSfxFolderIds = new Set();
// Quel Sfx est affiché dans le panneau de détail à droite de la bibliothèque Sfx -- par défaut, le premier
// de la liste (pas de notion de "Sfx en cours d'édition" comparable au currentAdReelId des AdReels).
let manageSfxSelectedId = null;
// Disposition maître-détail à l'intérieur d'un Sfx sélectionné (20/08) : quelle entrée (identity/behavior/
// variations) est affichée, par Sfx (clé = sfx.id). Même principe que packSelectedEntry.
const sfxSelectedEntry = new Map();
// Réseaux sociaux du compositeur — portée globale comme le reste des bibliothèques, réutilisable depuis
// n'importe quel pack/collection. { id, platform, url }. Seules les plateformes de PUBLISHABLE_SOCIAL_PLATFORMS
// proposent un vrai bouton "Publier" pré-rempli (URL de partage publique existante côté plateforme) — les
// autres (Instagram, TikTok, YouTube, SoundCloud) n'offrent aucun mécanisme de ce genre, gardées en simple
// aide-mémoire de lien.
let socials = [];
const SOCIAL_PLATFORMS = ['twitter', 'facebook', 'linkedin', 'whatsapp', 'telegram', 'instagram', 'tiktok', 'youtube', 'soundcloud', 'website'];
const PUBLISHABLE_SOCIAL_PLATFORMS = ['twitter', 'facebook', 'linkedin', 'whatsapp', 'telegram'];
// Construit l'URL de partage pré-rempli propre à chaque plateforme — ouverte dans un nouvel onglet, le
// texte et le lien sont déjà prêts, il ne reste qu'à valider la publication chez eux (aucune plateforme
// perso ne permet de publier sans passer par leur propre interface, cf. discussion avec Jules-Antoine).
function buildSocialShareUrl(platform, pageUrl, text) {
  const u = encodeURIComponent(pageUrl), t = encodeURIComponent(text);
  switch (platform) {
    case 'twitter': return `https://twitter.com/intent/tweet?text=${t}&url=${u}`;
    case 'facebook': return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case 'linkedin': return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case 'whatsapp': return `https://wa.me/?text=${t}%20${u}`;
    case 'telegram': return `https://t.me/share/url?url=${u}&text=${t}`;
    default: return null;
  }
}
// Ouvre une fenêtre de publication en popup centrée plutôt qu'en plein onglet (20/08, retour visuel :
// WordPress fait ça très bien) -- le compositeur reste sur le backstage pendant que la fenêtre de
// publication (LinkedIn, X, etc.) s'ouvre à côté. Dimensions proches de celles des boutons de partage
// officiels de ces plateformes. Même nom de fenêtre ('layerpitch-share') à chaque appel : un second clic
// pendant que la première popup est encore ouverte réutilise la même fenêtre plutôt que d'en empiler une
// nouvelle.
function openSharePopup(url) {
  const width = 600, height = 600;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2) + (window.screenLeft || window.screenX || 0));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2) + (window.screenTop || window.screenY || 0));
  window.open(url, 'layerpitch-share', `width=${width},height=${height},left=${left},top=${top},noopener,noreferrer,scrollbars=yes,resizable=yes`);
}
// Rangée de boutons "Publier", un par réseau configuré parmi ceux qui proposent un vrai mécanisme de
// partage pré-rempli — réutilisée à l'identique pour les packs et les collections. dataAction distingue
// les deux contextes (le pack et la collection ont chacun leur propre délégation d'événements).
function publishButtonsHtml(dataAction, idxAttrName, idxValue) {
  const publishable = socials.filter(s => PUBLISHABLE_SOCIAL_PLATFORMS.includes(s.platform));
  if (!publishable.length) return `<div class="hint-inline">${tr('noPublishableSocial')}</div>`;
  return publishable.map(s => `<button class="btn btn-small" data-action="${dataAction}" data-social-id="${s.id}" data-${idxAttrName}="${idxValue}" type="button">${tr('socialPlatform_' + s.platform)}</button>`).join('');
}
// Item de liste maître générique pour une disposition à entrées fixes (Pack/Collection, 20/08 -- relecture
// de nettoyage) : packMasterItem et collMasterItem n'en étaient que deux copies quasi identiques, seuls
// l'action déléguée et le nom/valeur de l'attribut d'index changeaient. Pas réutilisé pour modeMasterItem/
// seqMasterItem (morceau) : ceux-là portent une logique propre (indentation enfant, drag id) qui les
// distingue au-delà d'une simple différence de nom d'attribut.
function simpleMasterItemEl(action, idxAttrName, idxValue, key, active, labelHtml) {
  const item = document.createElement('div');
  item.className = 'seq-master-item' + (active ? ' active' : '');
  item.dataset.action = action;
  item.dataset[idxAttrName] = idxValue;
  item.dataset.entry = key;
  item.innerHTML = labelHtml;
  return item;
}
// Point d'entrée unique pour les 3 boutons "Partager" du backstage (AdReel, Pack, Collection) -- remplace
// l'appel direct à shareOrCopy() (20/08). La Web Share API native reste tentée en premier (fonctionne bien
// sur mobile et sur Safari desktop, menu système complet) ; si elle est indisponible ou échoue (Chrome/
// Firefox desktop, cas majoritaire signalé par Jules-Antoine), on se rabat sur les réseaux publiables déjà
// configurés plutôt que sur une copie presse-papier silencieuse et sans retour visible : un seul réseau
// configuré -> ouverture directe de sa fenêtre de publication pré-remplie ; plusieurs -> une fenêtre de
// dialogue à cocher pour laisser le compositeur choisir où publier cette fois-ci. Aucun réseau publiable
// configuré -> repli sur le comportement d'origine (copie presse-papier via shareOrCopy).
let pendingShareContext = null; // { url, title } en attente pendant que la modale à cocher est ouverte
async function shareViaSocialsOrFallback(url, title) {
  if (navigator.share) {
    try {
      await navigator.share({ url, title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // Autre échec (rare) : on continue vers le repli plutôt que de laisser le clic sans effet.
    }
  }
  const publishable = socials.filter(s => PUBLISHABLE_SOCIAL_PLATFORMS.includes(s.platform));
  if (publishable.length === 1) {
    const shareUrl = buildSocialShareUrl(publishable[0].platform, url, title);
    if (shareUrl) { openSharePopup(shareUrl); return 'shared-social'; }
  } else if (publishable.length >= 2) {
    openShareSocialsModal(url, title, publishable);
    return 'dialog-opened';
  }
  return window.LayerPlayerCore.shareOrCopy(url, title);
}
function openShareSocialsModal(url, title, publishable) {
  pendingShareContext = { url, title };
  const list = document.getElementById('shareSocialsList');
  list.innerHTML = publishable.map(s => `
    <label style="display:flex;align-items:center;gap:8px;margin-top:8px;">
      <input type="checkbox" class="share-social-checkbox" data-platform="${s.platform}" checked style="width:auto;margin:0;">
      <span style="font-size:12px;color:var(--text-dim);">${tr('socialPlatform_' + s.platform)}</span>
    </label>
  `).join('');
  document.getElementById('shareSocialsModalOverlay').style.display = 'flex';
}
document.getElementById('shareSocialsCancel').addEventListener('click', () => {
  document.getElementById('shareSocialsModalOverlay').style.display = 'none';
  pendingShareContext = null;
});
document.getElementById('shareSocialsOk').addEventListener('click', () => {
  if (!pendingShareContext) return;
  const { url, title } = pendingShareContext;
  document.getElementById('shareSocialsList').querySelectorAll('.share-social-checkbox:checked').forEach(cb => {
    const shareUrl = buildSocialShareUrl(cb.dataset.platform, url, title);
    if (shareUrl) openSharePopup(shareUrl);
  });
  document.getElementById('shareSocialsModalOverlay').style.display = 'none';
  pendingShareContext = null;
});
// Disposition maître-détail du séquentiel (18/08, incrément 1) : quel emplacement (index) est affiché en
// détail dans la colonne de droite, par morceau (clé = track.id). Purement un état d'affichage local à la
// session -- jamais persisté, jamais publié, aucun impact sur les données du morceau lui-même.
const seqSelectedSlotIndex = new Map();
const collapsedPackIds = new Set();
const collapsedBlockIds = new Set();
// Pour un pool de variations interchangeables (alternatives d'un groupe/segment, variations d'un Sfx) :
// UN SEUL bouton déplie tout le pool d'un coup, plutôt qu'un repli individuel par ligne — approprié ici
// car chaque ligne n'est qu'une variation parmi d'autres du même contenu, pas un élément distinct à
// retrouver individuellement (contrairement aux couches fixes/classiques, qui gardent leur repli par
// ligne : chacune y est un son différent qu'on veut pouvoir ouvrir une par une).
const expandedAltPoolKeys = new Set();
function altPoolToggleHtml(key, count) {
  const expanded = expandedAltPoolKeys.has(key);
  return `<button type="button" class="btn btn-small alt-pool-toggle" data-role="altPoolToggle" data-key="${key}"><span data-role="caret">${expanded ? '▾' : '▸'}</span> ${tr('viewVariationsBtn', { n: count })}</button>`;
}
// Branche le clic du bouton ci-dessus sur le corps du pool juste à côté — lien direct plutôt que délégué,
// pour ne pas avoir à toucher aux gestionnaires de clic partagés (#libraryContainer/#sfxLibraryContainer).
function wireAltPoolToggle(hostEl) {
  const btn = hostEl.querySelector('[data-role="altPoolToggle"]');
  const poolBody = hostEl.querySelector('[data-role="altPoolBody"]');
  if (!btn || !poolBody) return;
  btn.addEventListener('click', () => {
    const collapsed = poolBody.classList.toggle('collapsed');
    btn.querySelector('[data-role="caret"]').textContent = collapsed ? '▸' : '▾';
    if (collapsed) expandedAltPoolKeys.delete(btn.dataset.key); else expandedAltPoolKeys.add(btn.dataset.key);
  });
}
let packs = []; // { id, title, illustration, presentationFr, presentationEn, buyable, buyUrl, pendingIllustration, trackIds, bgColor, textColor, font }
// Disposition maître-détail des Packs (20/08, extension du principe du morceau ; réorganisée le même jour
// après retour visuel -- fusion Identité+Présentation) : quelle entrée (presentation/content/appearance/
// distribution) est affichée en détail à droite, par pack (clé = pack.id). Même principe que
// seqSelectedSlotIndex -- purement un état d'affichage local à la session, jamais persisté, jamais
// publié, aucun impact sur les données du pack lui-même.
const packSelectedEntry = new Map();
// Repli/dépli d'un bloc isolé (Intro/Outro du séquentiel, replié par défaut) — même principe et même Set
// que altPoolToggleHtml/expandedAltPoolKeys juste au-dessus (persiste tant que la page reste ouverte),
// mais un bouton+corps par appel plutôt qu'un data-role partagé : intro et outro cohabitent dans la même
// carte de morceau, `querySelector` sur un data-role commun n'attraperait que le premier des deux.
function collapsibleBlockToggleHtml(key, label, toggleRole, helpKey) {
  const expanded = expandedAltPoolKeys.has(key);
  return `<button type="button" class="btn btn-small alt-pool-toggle" data-role="${toggleRole}" ${helpKey ? `data-help="${helpKey}"` : ''}><span data-role="caret">${expanded ? '▾' : '▸'}</span> ${label}</button>`;
}
function wireCollapsibleBlockToggle(btn, body, key) {
  if (!btn || !body) return;
  btn.addEventListener('click', () => {
    const collapsed = body.classList.toggle('collapsed');
    btn.querySelector('[data-role="caret"]').textContent = collapsed ? '▸' : '▾';
    if (collapsed) expandedAltPoolKeys.delete(key); else expandedAltPoolKeys.add(key);
  });
}
// Collections : regroupement de packs (au-dessus des packs, qui eux regroupent des morceaux). Ex. usage
// futur : vente groupée avec ristourne sur les morceaux déjà possédés — pas encore construit, cf. doc.
let collections = []; // { id, title, illustration, presentationFr, presentationEn, pendingIllustration, packIds, bgColor, textColor, font }
const collapsedCollectionIds = new Set();
// Disposition maître-détail des Collections (20/08, réorganisée le même jour après retour visuel), même
// principe que packSelectedEntry -- 4 entrées (presentation/content/appearance/distribution), symétriques
// à celles du Pack depuis l'ajout des couleurs/police à l'entrée Apparence.
const collectionSelectedEntry = new Map();
// Polices personnalisées uploadées par le compositeur — portée globale (pas par AdReel), comme la
// bibliothèque de morceaux : une police uploadée une fois est réutilisable depuis n'importe quel AdReel
// ou bloc. { id, name, pendingFile, remoteFile }
let customFonts = [];
let adReels = []; // { id, label, blocks, profile, testimonials, trackIds, logoPendingFile, photoPendingFile, folderId }
// Dossiers d'AdReel (20/08) : simple regroupement organisationnel pour la section "Gérer les AdReels" --
// { id, label }. Chaque AdReel porte son propre folderId (null = racine, hors de tout dossier). Aucune
// notion d'ordre au sein d'un dossier ou de la racine : seule l'appartenance au groupe est modélisée,
// l'ordre d'affichage suit celui du tableau `adReels` lui-même.
let adReelFolders = [];
// Repli visuel des dossiers dans la liste maître -- affichage local à la session, jamais persisté (même
// principe que collapsedPackIds).
const collapsedAdReelFolderIds = new Set();
// Quel AdReel est affiché dans le panneau de détail à droite de "Gérer les AdReels" -- par défaut,
// l'AdReel actuellement en cours d'édition (voir renderManageAdreels).
let manageAdreelsSelectedId = null;
// Réglage global (pas par AdReel, pas par pack) : logiciels d'implémentation que le compositeur
// maîtrise, affiché sur chaque page publique de pack si au moins une case est cochée.
let implementationSkills = { wwise: false, fmod: false, unity: false, unreal: false };
// Réglage global (pas par AdReel, pas par pack) : certification "sans IA" par défaut pour tout le
// catalogue — chaque morceau peut individuellement suivre ce réglage (track.noAiOverride === null,
// valeur par défaut) ou faire explicitement exception (true/false), voir effectiveNoAiCertified().
let noAiCertifiedGlobal = false;
// Réglage global (pas par AdReel, pas par bloc), palier Pro uniquement (Chantier Apparence, 05/09) :
// style de la forme d'onde partout où elle apparaît (lecteur de morceau, Sfx, boutons de boucle en
// embranchement-vertical). Stocké au même endroit que implementationSkills/customFonts (table settings,
// une ligne par compositeur) -- pas dans profile.theme, qui est par-AdReel. Valeurs valides :
// window.LayerPlayerCore.WAVEFORM_STYLES ('bars' par défaut/repli).
let waveformStyle = 'bars';
// Réglage global (pas par AdReel, pas par bloc), palier Pro uniquement (Chantier Apparence, 06/09) :
// thème (Clair/Sombre) de la carte des chemins, même principe que waveformStyle ci-dessus. Valeurs
// valides : window.LayerPlayerCore.SEQ_MAP_THEMES ('light' par défaut/repli).
let seqMapTheme = 'light';
// Réglage global (pas par pack/collection/AdReel), tous paliers : autorise ou non les VISITEURS des
// pages publiques (pack.html/collection.html/index.html) à générer eux-mêmes un code d'intégration
// depuis un bouton public -- ne bloque jamais un lien ?embed=1 déjà généré par le compositeur lui-même
// ici, dans le backstage, toujours disponible quel que soit ce réglage. Faux par défaut (opt-in).
let allowEmbedding = false;
function effectiveNoAiCertified(track) {
  return (track.noAiOverride === true || track.noAiOverride === false) ? track.noAiOverride : noAiCertifiedGlobal;
}
let currentAdReelId = 'main';
let blockTracksRefresh = null;    // fonction de re-rendu du sélecteur de morceaux du bloc "tracks" (singleton par AdReel)
let packTracksRefreshers = [];    // fonctions de re-rendu des sélecteurs de morceaux de chaque pack
let packSfxRefreshers = [];       // fonctions de re-rendu des sélecteurs de Sfx de chaque pack
let oggEncoder = null;
let hasUnsavedEdits = false;
// Garde-fou (24/09) : un trigger ou un réglage non publié disparaissait au rechargement de la page (aucun brouillon
// automatique) -- le navigateur demande maintenant confirmation avant de quitter/recharger tant que des modifications
// n'ont pas été enregistrées. Depuis le 27/09, un brouillon automatique garde aussi ces modifications (voir « Brouillon
// automatique ») : ce garde-fou reste, un brouillon n'étant qu'un filet de sécurité propre à ce navigateur.
window.addEventListener('beforeunload', e => { if (hasUnsavedEdits) { e.preventDefault(); e.returnValue = ''; } });
// dataLoadOk (29/08, garde-fou contre une publication "en mode panique" après un échec de chargement --
// scénario réel vécu par Jules-Antoine : erreur 403 au chargement automatique, puis clic sur Publier sur
// une bibliothèque restée vide, écrasant les vraies données sur GitHub). Vrai UNE FOIS un chargement
// réussi (contenu existant OU absence légitime de data.json, premier lancement) -- et RESTE vrai ensuite,
// même si un rechargement manuel ultérieur échoue à son tour : dans ce cas les données en mémoire sont
// toujours les bonnes (le chargement raté n'y a pas touché, voir catch de loadData()), publier reste donc
// sûr. Seul le tout premier chargement resté en échec bloque réellement Publier.
let dataLoadOk = false;

// Suppressions réellement envoyées à la base (25/09). Avant ce correctif, publishAll() ne faisait que des upsert_* :
// un morceau/Sfx/pack/collection/AdReel retiré ici restait en base et revenait au chargement suivant (vécu sur le
// compte tuto : deux "My first adaptive track" supprimés qui réapparaissaient sans cesse). publishedCatalog retient
// ce qui est en base (id -> titre) au dernier chargement ou à la dernière publication réussie ; à la publication,
// tout ce qui y figure mais n'est plus dans le Backstage est supprimé en base. null tant qu'aucun chargement n'a
// réussi : rien n'est alors jamais supprimé (même esprit que le garde-fou dataLoadOk).
let publishedCatalog = null;
// Fichiers R2 d'un morceau/Sfx retiré : effacés seulement une fois la suppression en base faite -- les effacer au
// clic (ancien comportement) laissait un morceau muet si on rechargeait sans publier, ou si la base refusait la
// suppression (élément déjà acheté). Clé 'tracks:<id>' / 'sfx:<id>' -> liste de chemins R2.
const pendingR2Deletes = new Map();
// Même principe pour un morceau de morceau (slot, section, pool, couche, boucle, variation, transition) ou une
// variation de Sfx retirés (25/09) : avant, leurs fichiers partaient au clic -- un rechargement sans publier
// laissait la version en ligne muette, et depuis la duplication (Alt + glisser) une copie partage les fichiers
// de l'original. Effacés à la publication, et seulement si plus rien ne les utilise (allReferencedR2Keys).
const pendingOrphanR2Keys = new Set();
function queueR2Delete(key) { pendingOrphanR2Keys.add(key); }
function queueTrackFileDelete(track, obj) { if (obj && obj.remoteFile) queueR2Delete(`audio/${track.id}/${obj.remoteFile}`); }
function allReferencedR2Keys() {
  const keys = new Set();
  library.forEach(t => trackRemoteFileKeys(t).forEach(k => keys.add(k)));
  sfxLibrary.forEach(sfx => sfxRemoteFileKeys(sfx).forEach(k => keys.add(k)));
  return keys;
}
function currentCatalog() {
  const byId = (items, labelOf) => new Map(items.map(x => [x.id, labelOf(x) || x.id]));
  return {
    collections: byId(collections, c => c.title),
    packs: byId(packs, p => p.title),
    adReels: byId(adReels, a => a.label),
    tracks: byId(library, t => t.title),
    sfx: byId(sfxLibrary, s => s.title),
  };
}
function rememberPublishedCatalog() { publishedCatalog = currentCatalog(); }
// Ordre : d'abord ce qui référence (collections -> packs -> AdReels), puis ce qui est référencé (morceaux, Sfx).
const CATALOG_DELETE_KINDS = [
  { kind: 'collections', api: () => window.LayerPitchCollections.deleteCollection },
  { kind: 'packs', api: () => window.LayerPitchPacks.deletePack, blockedKey: 'deleteBlockedPack' },
  { kind: 'adReels', api: () => window.LayerPitchAdReels.deleteAdReel },
  { kind: 'tracks', api: () => window.LayerPitchTracks.deleteTrack, blockedKey: 'deleteBlockedTrack', retiredKey: 'deleteRetiredTrack' },
  { kind: 'sfx', api: () => window.LayerPitchSfx.deleteSfx, retiredKey: 'deleteRetiredSfx' },
];
function removedCatalogItems() {
  if (!publishedCatalog) return [];
  const current = currentCatalog();
  const removed = [];
  CATALOG_DELETE_KINDS.forEach(k => {
    publishedCatalog[k.kind].forEach((title, id) => { if (!current[k.kind].has(id)) removed.push({ ...k, id, title }); });
  });
  return removed;
}
// Supprime en base tout ce qui a été retiré depuis le dernier chargement/publication. Une panne (réseau, droits)
// lève une erreur qui arrête la publication, comme les écritures upsert -- rien n'est oublié, la prochaine
// publication réessaie. Un refus volontaire (élément déjà acheté) n'arrête rien : il est renvoyé dans `blocked`.
// Un morceau ou Sfx obtenu par des fans est RETIRÉ (27/09) : hors du catalogue, gardé pour eux avec ses fichiers --
// renvoyé dans `retired`.
async function deleteRemovedCatalogItems() {
  const removed = removedCatalogItems();
  const blocked = [], retired = [], errors = [];
  for (const item of removed) {
    const { ok, blocked: isBlocked, retired: isRetired, error } = await item.api()(item.id);
    if (ok && isRetired) {
      retired.push(tr(item.retiredKey, { title: item.title }));
      pendingR2Deletes.delete(item.kind + ':' + item.id); // les fans en ont besoin : ses fichiers restent
    } else if (ok) {
      (pendingR2Deletes.get(item.kind + ':' + item.id) || []).forEach(r2DeleteFileLogged);
      pendingR2Deletes.delete(item.kind + ':' + item.id);
    } else if (isBlocked) {
      blocked.push(tr(item.blockedKey, { title: item.title }));
      pendingR2Deletes.delete(item.kind + ':' + item.id); // l'élément reste en ligne : ses fichiers aussi
    } else {
      errors.push(`${item.title} : ${error}`);
    }
  }
  if (errors.length) {
    throw new Error('Suppression en base échouée pour ' + errors.length + ' élément(s) — publication arrêtée :\n' + errors.join('\n'));
  }
  // Fichiers d'éléments jamais arrivés en base (ajoutés puis retirés, publication précédente interrompue après
  // l'envoi R2) : rien à supprimer en base, leurs fichiers peuvent partir tout de suite.
  pendingR2Deletes.forEach(keys => keys.forEach(r2DeleteFileLogged));
  pendingR2Deletes.clear();
  // Fichiers d'éléments retirés à l'intérieur d'un morceau/Sfx : les morceaux viennent d'être publiés sans eux.
  const referenced = allReferencedR2Keys();
  pendingOrphanR2Keys.forEach(k => { if (!referenced.has(k)) r2DeleteFileLogged(k); });
  pendingOrphanR2Keys.clear();
  return { deleted: removed.length - blocked.length - retired.length, blocked, retired };
}

function log(msg, cls) {
  const el = document.getElementById('log');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
function slug(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
}
// Échappement complet (& < > " ') valable à la fois pour le texte et pour les attributs HTML (revue du 24/09 : l'ancienne
// version n'échappait pas les guillemets, et escapeAttr ne protégeait que les attributs). escapeAttr garde son nom
// historique (100+ appels) mais fait désormais exactement la même chose.
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function extOf(filename) { const m = /\.([a-zA-Z0-9]+)$/.exec(filename || ''); return m ? m[1].toLowerCase() : 'jpg'; }
// Content-Type pour l'upload R2 des images (S3/R2 le
// veut pour servir le bon en-tête -- voir MIME dans scripts/migrate-media-to-r2.js pour la même liste).
function imageContentType(ext) {
  const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', svg: 'image/svg+xml' };
  return map[(ext || '').toLowerCase()] || 'application/octet-stream';
}
function genId() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

const UPLOAD_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15.5V4M8 8l4-4 4 4"/><path d="M4 15.5v3.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3.5"/></svg>';
const TRASH_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5h16"/><path d="M8.5 6.5V4.8a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1V6.5"/><path d="M6.5 6.5l.9 12.7a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-12.7"/><path d="M10.2 10.5v6M13.8 10.5v6"/></svg>';
// basenameOf (29/08) : extrait le nom de fichier affichable d'un chemin distant publié (ex.
// "audio/ev1/ref.wav" -> "ref.wav") -- remoteFile est toujours un simple chemin/nom en chaîne partout
// dans ce fichier (jamais un objet), donc réutilisable tel quel pour tous les contrôles de fichier.
function basenameOf(path) {
  if (!path) return '';
  const parts = String(path).split('/');
  return parts[parts.length - 1];
}
// deleteBtnHtml (optionnel) : bouton de suppression icône déjà construit par l'appelant (avec ses propres
// data-action/data-*), injecté dans la même ligne que le contrôle de fichier — pour les listes de
// variations (Sfx, groupes, segments, couches), où avoir "Choisir un fichier" + "Supprimer" en icônes
// côte à côte économise la place et allège une liste souvent longue, plutôt qu'un bouton texte en dessous.
function fileCtrlHtml(label, deleteBtnHtml) {
  const pickLabel = label || tr('chooseFileDefault');
  // Icône + libellé texte visible (29/08, retour de Jules-Antoine : une icône seule n'est pas assez
  // explicite) — plus de bouton "icône seule" (btn-icon) pour ce contrôle précis.
  return `
    <div class="file-ctrl">
      <button type="button" class="btn btn-small" data-role="pickBtn">${UPLOAD_ICON_SVG}<span>${pickLabel}</span></button>
      <span class="file-status" data-role="fileStatus">${tr('noFileStatus')}</span>
      ${deleteBtnHtml || ''}
      <input type="file" data-role="fileInput" style="display:none">
    </div>
  `;
}
// Poignée de glisser-déposer (18/08) -- même SVG que celle des blocs de contenu (16/08), factorisée ici
// pour être réutilisée par les listes maître de couches/sections/boucles nommées sans dupliquer le markup.
// extraClass optionnel (20/08) : permet de distinguer deux systèmes de glisser-déposer coexistant dans un
// même conteneur (ex. dossiers d'AdReel vs AdReel eux-mêmes) tout en gardant le même style visuel -- le
// sélecteur d'armement de chaque système cible sa propre classe plutôt que la classe de base partagée.
function dragHandleHtml(extraClass) {
  const cls = extraClass ? `block-drag-handle ${extraClass}` : 'block-drag-handle';
  return `<span class="${cls}" aria-hidden="true" title="${tr('dragHandleTitle')}"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>`;
}
function deleteIconBtnHtml(action, dataAttrs, label) {
  const attrs = Object.entries(dataAttrs).map(([k, v]) => `data-${k}="${v}"`).join(' ');
  return `<button type="button" class="btn btn-icon btn-danger" data-action="${action}" ${attrs} title="${label}" aria-label="${label}">${TRASH_ICON_SVG}</button>`;
}
// Réglages posés à l'activation d'un effet (data-fx-param="enabled") -- valeurs de départ raisonnables,
// pas des zéros muets, pour qu'activer une case coche produise un effet audible immédiatement.
const FX_DEFAULTS = {
  lowcut: () => ({ frequency: 150, slope: 24 }),
  highcut: () => ({ frequency: 3000, slope: 24 }),
  reverb: () => ({ decay: 2, wet: 0.3 }),
  delay: () => ({ time: 0.3, feedback: 0.35, wet: 0.25 }),
  bitcrush: () => ({ bits: 6, reduction: 6 }), // départ nettement audible (8 bits sans réduction ne s'entendait presque pas, 24/09)
  volume: () => ({ db: 0 }),
  // "rate" retiré des valeurs par défaut par élément (22/09) : devenu un réglage de morceau entier, voir
  // FX_TRACK_DEFAULTS ci-dessous et trackPitchFxHtml() -- ici, "shift" reste le seul mode par couche/
  // boucle/emplacement/pool, puisqu'il ne pose pas de problème de synchro (durée inchangée).
  pitch: () => ({ mode: 'shift', semitones: 3 }) // départ audible (0 demi-ton ne changeait rien, 25/09)
};
// Pitch de morceau entier (mode "rate" implicite, pas de champ mode -- un seul sens possible à ce niveau).
const FX_TRACK_DEFAULTS = { pitch: () => ({ semitones: 0 }) };
// Effets audio par couche (chantier "effets dynamiques", 22/09) -- filtre/reverb/écho/bitcrusher,
// réglages fixes pour l'instant (pas d'automatisation/déclenchement -- prévu dans un second temps,
// cf. discussion produit). Un seul point de vérité pour ne pas dupliquer le markup entre le mode
// statique (une seule couche, li=null) et le mode vertical (une couche par li).
// fxBlockHtml : cœur générique, indépendant du mode de lecture -- extraAttrs porte les data-* qui disent
// à quel objet appliquer le réglage (couche, boucle, emplacement séquentiel, pool vertical-random). Les
// 4 fonctions fooFxHtml ci-dessous ne sont que des façades qui fixent extraAttrs pour chaque cas, pour
// ne jamais dupliquer le markup des 4 effets à chaque nouveau mode qui les gagne.
function fxBlockHtml(fx, extraAttrs) {
  fx = fx || {};
  const lc = fx.lowcut, hc = fx.highcut, r = fx.reverb, d = fx.delay, b = fx.bitcrush;
  // Pitch grisé pour tout compte non-admin (22/09, demande de Jules-Antoine) tant que la synchro
  // "vitesse" avec le planificateur n'a pas été testée en conditions réelles -- même patron que la
  // bibliothèque vidéo (currentUserIsAdmin, confort d'affichage client, cf. renderAdminOnlyPanels()).
  // Pas de barrière serveur pour l'instant (à durcir dans upsert_track si un jour nécessaire) : un
  // réglage qualité propre au compositeur, pas un enjeu de sécurité/business comme "pack en vente".
  // 23/09 (demande de Jules-Antoine) : TOUS les effets (volume, filtre, reverb, écho, bitcrusher, pitch) sont
  // désormais grisés pour tout compte non-admin, en attendant son feu vert -- pas seulement le pitch.
  const pitchDisabled = !currentUserIsAdmin;
  const gated = !currentUserIsAdmin;
  // Dans la carte d'un TRIGGER, le fondu se règle par les deux champs « entrée / sortie » du trigger lui-même : les champs de
  // fondu propres au filtre (utiles à l'apparition d'une voix, pas à l'appui d'un bouton) sont masqués pour éviter la confusion.
  const isTriggerBlock = /data-fx-target="trigger"/.test(extraAttrs || '');
  function num(effect, param, value, labelKey, step, min, max, disabled) {
    if (disabled === undefined) disabled = gated;
    return `<div style="margin-top:4px"><label style="font-size:0.85em">${tr(labelKey)}</label>
      <input type="number" step="${step}" min="${min}" max="${max}" ${disabled ? 'disabled' : ''}
        data-field="fx" data-fx-effect="${effect}" data-fx-param="${param}" ${extraAttrs} value="${value}"></div>`;
  }
  // Champ de fondu optionnel (filtre/pitch) : vide par défaut (= pas de fondu), pas de min/max forcé --
  // une case vidée par le compositeur redevient "pas de fondu" (voir le handler, qui stocke null plutôt
  // que NaN dans ce cas), pas une valeur à zéro.
  function numOptional(effect, param, value, labelKey, step, disabled) {
    if (disabled === undefined) disabled = gated;
    return `<div style="margin-top:4px"><label style="font-size:0.85em">${tr(labelKey)}</label>
      <input type="number" step="${step}" ${disabled ? 'disabled' : ''}
        data-field="fx" data-fx-effect="${effect}" data-fx-param="${param}" ${extraAttrs} value="${value != null ? value : ''}"></div>`;
  }
  function toggle(effect, enabled, labelKey, extraFields, disabled) {
    if (disabled === undefined) disabled = gated;
    return `
      <div style="margin-top:8px;padding:8px;border:1px solid var(--border);border-radius:6px${disabled ? ';opacity:0.55' : ''}">
        <label style="display:flex;align-items:center;gap:6px;margin:0">
          <input type="checkbox" data-field="fx" data-fx-effect="${effect}" data-fx-param="enabled" ${extraAttrs} ${enabled ? 'checked' : ''} ${disabled ? 'disabled' : ''} style="width:auto;margin:0">
          ${tr(labelKey)}${disabled ? `<span class="hint-inline" style="margin:0 0 0 6px">${tr('fxAdminOnlyHint')}</span>` : ''}
        </label>
        ${enabled ? `<div style="margin-top:6px">${extraFields}</div>` : ''}
      </div>
    `;
  }
  // Panneau repliable (25/09, demande de Jules-Antoine : la liste des 7 effets allonge beaucoup chaque
  // couche/pool/boucle) -- replié par défaut, le nombre d'effets actifs reste visible sur le bouton.
  // L'état ouvert est mémorisé dans expandedAltPoolKeys (clé dérivée de extraAttrs, qui identifie
  // l'objet porteur) pour survivre aux re-rendus. Pas de repli dans la carte d'un trigger, où les
  // effets sont le contenu même de la carte.
  const fxKey = 'fx:' + (extraAttrs || '').replace(/\s+/g, ' ').trim();
  const expanded = isTriggerBlock || expandedAltPoolKeys.has(fxKey);
  const activeCount = ['volume', 'lowcut', 'highcut', 'pitch', 'reverb', 'delay', 'bitcrush'].filter(k => fx[k]).length;
  return `
    <div style="margin-top:10px">
      ${isTriggerBlock ? '' : `<button type="button" class="btn btn-small alt-pool-toggle" data-role="fxBlockToggle" data-fx-key="${escapeAttr(fxKey)}"><span data-role="caret">${expanded ? '▾' : '▸'}</span> ${tr('fxSectionTitle')}${activeCount ? ` <span class="hint-inline" style="margin:0">(${tr('fxActiveCount', { n: activeCount })})</span>` : ''}</button>`}
      <div class="list-block-body${expanded ? '' : ' collapsed'}" data-role="fxBlockBody">
      ${toggle('volume', !!fx.volume, 'fxVolumeLabel', `
        ${num('volume', 'db', fx.volume ? fx.volume.db : 0, 'fxVolumeDbLabel', 0.5, -60, 12)}
        <div class="hint-inline">${tr('fxVolumeHint')}</div>
      `)}
      ${['lowcut', 'highcut'].map(k => {
        const c = k === 'lowcut' ? lc : hc;
        const slopeVal = c && (+c.slope === 12 || +c.slope === 48) ? +c.slope : 24;
        return toggle(k, !!c, k === 'lowcut' ? 'fxLowcutLabel' : 'fxHighcutLabel', `
        <div class="hint-inline">${tr(k === 'lowcut' ? 'fxLowcutHint' : 'fxHighcutHint')}</div>
        ${num(k, 'frequency', c ? c.frequency : (k === 'lowcut' ? 150 : 3000), 'fxFrequencyLabel', 10, 20, 20000)}
        <div style="margin-top:4px"><label style="font-size:0.85em">${tr('fxSlopeLabel')}</label>
          <select data-field="fx" data-fx-effect="${k}" data-fx-param="slope" ${extraAttrs} ${gated ? 'disabled' : ''}>
            ${[12, 24, 48].map(v => `<option value="${v}" ${slopeVal === v ? 'selected' : ''}>${tr('fxSlopeOption', { db: v })}</option>`).join('')}
          </select></div>
        ${isTriggerBlock ? '' : numOptional(k, 'fadeFromFrequency', c ? c.fadeFromFrequency : null, 'fxFadeFromFreqLabel', 10)}
        ${isTriggerBlock ? '' : numOptional(k, 'fadeDurationSec', c ? c.fadeDurationSec : null, 'fxFadeDurationLabel', 0.1)}
      `);
      }).join('')}
      ${toggle('pitch', !!fx.pitch, 'fxPitchLabel', `
        ${isTriggerBlock ? `
        <div style="margin-top:4px"><label style="font-size:0.85em">${tr('fxPitchModeLabel')}</label>
          <select data-field="fx" data-fx-effect="pitch" data-fx-param="mode" ${extraAttrs} ${pitchDisabled ? 'disabled' : ''}>
            <option value="shift" ${!fx.pitch || fx.pitch.mode !== 'rate' ? 'selected' : ''}>${tr('fxPitchModeShift')}</option>
            <option value="rate" ${fx.pitch && fx.pitch.mode === 'rate' ? 'selected' : ''}>${tr('fxPitchModeRate')}</option>
          </select></div>
        <div class="hint-inline">${tr(fx.pitch && fx.pitch.mode === 'rate' ? 'fxPitchModeRateTriggerHint' : 'fxPitchModeShiftHint')}</div>` : `<div class="hint-inline">${tr('fxPitchModeShiftHint')}</div>`}
        ${num('pitch', 'semitones', fx.pitch ? fx.pitch.semitones : 0, 'fxSemitonesLabel', 1, -24, 24, pitchDisabled)}
      `, pitchDisabled)}
      ${toggle('reverb', !!r, 'fxReverbLabel', `
        ${num('reverb', 'decay', r ? r.decay : 2, 'fxDecayLabel', 0.1, 0.1, 10)}
        ${num('reverb', 'wet', r ? r.wet : 0.3, 'fxWetLabel', 0.05, 0, 1)}
      `)}
      ${toggle('delay', !!d, 'fxDelayLabel', `
        ${num('delay', 'time', d ? d.time : 0.3, 'fxDelayTimeLabel', 0.01, 0.01, 2)}
        ${num('delay', 'feedback', d ? d.feedback : 0.35, 'fxFeedbackLabel', 0.05, 0, 0.9)}
        ${num('delay', 'wet', d ? d.wet : 0.25, 'fxWetLabel', 0.05, 0, 1)}
      `)}
      ${toggle('bitcrush', !!b, 'fxBitcrushLabel', `
        ${num('bitcrush', 'bits', b ? b.bits : 8, 'fxBitsLabel', 1, 1, 16)}
        ${num('bitcrush', 'reduction', b ? b.reduction : 1, 'fxReductionLabel', 1, 1, 50)}
      `)}
      </div>
    </div>
  `;
}
// Bouton de repli du panneau d'effets (fxBlockHtml) -- délégation unique plutôt qu'un câblage par
// appelant, le markup étant produit à 4 endroits (couche, boucle, emplacement, pool).
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-role="fxBlockToggle"]');
  if (!btn) return;
  const body = btn.parentElement.querySelector(':scope > [data-role="fxBlockBody"]');
  if (!body) return;
  const collapsed = body.classList.toggle('collapsed');
  btn.querySelector('[data-role="caret"]').textContent = collapsed ? '▸' : '▾';
  if (collapsed) expandedAltPoolKeys.delete(btn.dataset.fxKey); else expandedAltPoolKeys.add(btn.dataset.fxKey);
});
// Couche (mode vertical) ou l'unique couche du mode statique (li=null).
function layerFxHtml(layer, ti, li) {
  const liAttr = li != null ? `data-li="${li}"` : '';
  return fxBlockHtml(layer.fx, `data-fx-target="layer" data-ti="${ti}" ${liAttr}`);
}
// Boucle nommée (mode embranchement-vertical) -- fx par boucle, exact équivalent d'une couche.
function loopFxHtml(loop, ti, li) {
  return fxBlockHtml(loop.fx, `data-fx-target="loop" data-ti="${ti}" data-li="${li}"`);
}
// Emplacement séquentiel (mode séquentiel) -- fx porté par l'EMPLACEMENT, pas par chaque alternative :
// un emplacement est une position fixe de la timeline, l'effet doit s'appliquer quel que soit le tirage
// qui le remplit (anti-répétition), pas être reconfiguré alternative par alternative.
function slotFxHtml(slot, ti, si) {
  return fxBlockHtml(slot.fx, `data-fx-target="slot" data-ti="${ti}" data-si="${si}"`);
}
// Pool (mode vertical-random) -- même raisonnement que l'emplacement séquentiel : le pool est la "voix"
// fixe (façon Wwise Voice Graph), l'effet lui appartient plutôt qu'à l'alternative tirée au sort.
function poolFxHtml(pool, ti, si, pi) {
  return fxBlockHtml(pool.fx, `data-fx-target="pool" data-ti="${ti}" data-si="${si}" data-pi="${pi}"`);
}
// Intro, outro et transitions (27/09, proposition d'Antoine B.2) : leurs propres effets, comme une couche ou une
// boucle ; les triggers du morceau entier s'y appliquent aussi (lecteur et export vidéo).
function stageFxHtml(stageFx, target, attrs) {
  return fxBlockHtml(stageFx, `data-fx-target="${target}" ${attrs}`);
}
// Pitch "vitesse" de morceau ENTIER (22/09) -- distinct de fxBlockHtml/layerFxHtml & co, volontairement
// pas un simple appel à fxBlockHtml : un seul effet ici (pas de filtre/reverb/écho/bitcrush au niveau
// morceau), pas de champ mode (toujours "rate", implicite -- voir buildLayerFxChain/applyTrackPitchRate
// dans player.js). Rendu une fois dans le panneau "Infos du morceau", commun à tous les modes.
function trackPitchFxHtml(track, ti) {
  const pitchDisabled = !currentUserIsAdmin;
  const p = (track.fx && track.fx.pitch) || null;
  const attrs = `data-fx-target="track" data-ti="${ti}"`;
  // Fondu de pitch : seulement avec le moteur simple (statique/vertical sans boucle quantifiée), voir
  // applyTrackPitchRate() dans player.js.
  const fadeSupported = (track.mode === 'static' || track.mode === 'vertical') && track.loopEngine !== 'quantized';
  return `
    <div style="margin-top:14px">
      <div style="font-weight:600;font-size:0.9em;margin-bottom:2px">${tr('fxPitchLabel')}</div>
      <div style="padding:8px;border:1px solid var(--border);border-radius:6px${pitchDisabled ? ';opacity:0.55' : ''}">
        <label style="display:flex;align-items:center;gap:6px;margin:0">
          <input type="checkbox" data-field="fx" data-fx-effect="pitch" data-fx-param="enabled" ${attrs} ${p ? 'checked' : ''} ${pitchDisabled ? 'disabled' : ''} style="width:auto;margin:0">
          ${tr('fxPitchModeRate')}${pitchDisabled ? `<span class="hint-inline" style="margin:0 0 0 6px">${tr('fxAdminOnlyHint')}</span>` : ''}
        </label>
        <div class="hint-inline">${tr('fxTrackPitchHint')}</div>
        ${p ? `
          <div style="margin-top:4px"><label style="font-size:0.85em">${tr('fxSemitonesLabel')}</label>
            <input type="number" step="1" min="-24" max="24" ${pitchDisabled ? 'disabled' : ''} data-field="fx" data-fx-effect="pitch" data-fx-param="semitones" ${attrs} value="${p.semitones || 0}"></div>
          ${fadeSupported ? `
          <div style="margin-top:4px"><label style="font-size:0.85em">${tr('fxFadeFromSemitonesLabel')}</label>
            <input type="number" step="1" ${pitchDisabled ? 'disabled' : ''} data-field="fx" data-fx-effect="pitch" data-fx-param="fadeFromSemitones" ${attrs} value="${p.fadeFromSemitones != null ? p.fadeFromSemitones : ''}"></div>
          <div style="margin-top:4px"><label style="font-size:0.85em">${tr('fxFadeDurationLabel')}</label>
            <input type="number" step="0.1" ${pitchDisabled ? 'disabled' : ''} data-field="fx" data-fx-effect="pitch" data-fx-param="fadeDurationSec" ${attrs} value="${p.fadeDurationSec != null ? p.fadeDurationSec : ''}"></div>
          ` : `<div class="hint-inline">${tr('fxTrackPitchNoFadeHint')}</div>`}
        ` : ''}
      </div>
    </div>
  `;
}
// ---- Triggers d'effets (23/09) -- réservés à l'admin pour l'instant, comme le pitch ----
// Un trigger = { id, label, target:{type,li|si|pi}, fx:{...}, visible, fadeSec } : un jeu d'effets qui se
// fusionne par-dessus ceux de sa cible tant qu'il est actif (voir initTrackPlayer() dans player.js). Actionné
// par un bouton public (visible) ou par des embranchements (fxActions sur une option de bascule séquentielle
// ou sur une boucle d'embranchement-vertical).
function fxTriggerTargetChoices(track) {
  const out = [];
  if (track.mode === 'static') out.push({ value: 'layer:0', label: tr('fxTargetStaticTrack') });
  else if (track.mode === 'vertical') (track.layers || []).forEach((l, i) => out.push({ value: 'layer:' + i, label: l.label || tr('layerFallback', { n: i + 1 }) }));
  else if (track.mode === 'embranchement-vertical') (track.loops || []).forEach((l, i) => out.push({ value: 'loop:' + i, label: l.label || tr('embrLoopFallback', { n: i + 1 }) }));
  else if (track.mode === 'sequential') (track.segmentSlots || []).forEach((sl, i) => out.push({ value: 'slot:' + i, label: '#' + (i + 1) + ' ' + (sl.label || tr('slotFallback', { n: i + 1 })) }));
  else if (track.mode === 'vertical-random') (track.sections || []).forEach((sec, si) => (sec.pools || []).forEach((p, pi) => out.push({ value: 'pool:' + si + ':' + pi, label: (sec.label || ('S' + (si + 1))) + ' / ' + (p.label || ('P' + (pi + 1))) })));
  return out;
}
function fxTriggerTargetToValue(t) {
  if (!t) return '';
  if (t.type === 'track') return 'track';
  if (t.type === 'sfx') return 'sfx:' + t.id;
  if (t.type === 'layer') return 'layer:' + (t.li || 0);
  if (t.type === 'loop') return 'loop:' + t.li;
  if (t.type === 'slot') return 'slot:' + t.si;
  if (t.type === 'pool') return 'pool:' + t.si + ':' + t.pi;
  return '';
}
function parseFxTriggerTarget(v) {
  if (v === 'track') return { type: 'track' };
  const p = String(v || '').split(':');
  if (p[0] === 'sfx') return { type: 'sfx', id: p.slice(1).join(':') };
  if (p[0] === 'layer') return { type: 'layer', li: parseInt(p[1], 10) || 0 };
  if (p[0] === 'loop') return { type: 'loop', li: parseInt(p[1], 10) || 0 };
  if (p[0] === 'slot') return { type: 'slot', si: parseInt(p[1], 10) || 0 };
  if (p[0] === 'pool') return { type: 'pool', si: parseInt(p[1], 10) || 0, pi: parseInt(p[2], 10) || 0 };
  return null;
}
// Relations entre triggers (24/09) : { activates:[{triggerId, delaySec}], cuts:[id], requires:[id], autoOffSec } --
// nettoyées à la sérialisation (rien d'inutile n'est publié). Règles décrites dans createTriggerRuleEngine (player.js).
function fxRelationsClean(rel) {
  if (!rel) return null;
  const out = {};
  if (rel.activates && rel.activates.length) out.activates = rel.activates.map(a => ({ triggerId: a.triggerId, delaySec: +a.delaySec > 0 ? +a.delaySec : 0 }));
  if (rel.cuts && rel.cuts.length) out.cuts = rel.cuts.slice();
  if (rel.requires && rel.requires.length) out.requires = rel.requires.slice();
  if (+rel.autoOffSec > 0) out.autoOffSec = +rel.autoOffSec;
  return Object.keys(out).length ? out : null;
}
function fxRelationsEditorHtml(triggers, i, trg, attrs) {
  const rel = trg.relations || {};
  const others = triggers.filter((o, j) => j !== i && o && o.id);
  const rows = others.map(o => {
    const rAttrs = `data-field="fxRel" ${attrs} data-rel-other="${escapeAttr(o.id)}"`;
    const act = (rel.activates || []).find(a => a.triggerId === o.id);
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:4px;font-size:12px">
      <span style="min-width:110px;font-weight:600">${escapeAttr(o.label) || tr('fxTriggerLabelPlaceholder')}</span>
      <label style="display:flex;align-items:center;gap:4px;margin:0"><input type="checkbox" ${rAttrs} data-rel-kind="activates" ${act ? 'checked' : ''} style="width:auto;margin:0"> ${tr('fxRelActivates')}</label>
      ${act ? `<label style="display:flex;align-items:center;gap:4px;margin:0">${tr('fxRelDelay')} <input type="number" step="0.1" min="0" ${rAttrs} data-rel-kind="delay" value="${act.delaySec || 0}" style="width:64px"> s</label>` : ''}
      <label style="display:flex;align-items:center;gap:4px;margin:0"><input type="checkbox" ${rAttrs} data-rel-kind="cuts" ${(rel.cuts || []).indexOf(o.id) >= 0 ? 'checked' : ''} style="width:auto;margin:0"> ${tr('fxRelCuts')}</label>
      <label style="display:flex;align-items:center;gap:4px;margin:0"><input type="checkbox" ${rAttrs} data-rel-kind="requires" ${(rel.requires || []).indexOf(o.id) >= 0 ? 'checked' : ''} style="width:auto;margin:0"> ${tr('fxRelRequires')}</label>
    </div>`;
  }).join('');
  return `
    <div style="margin-top:10px;padding:8px;border:1px solid var(--border);border-radius:6px">
      <div style="font-weight:600;font-size:0.85em">${tr('fxRelTitle')}</div>
      <div class="hint-inline">${tr('fxRelHint')}</div>
      ${rows || `<div class="hint-inline">${tr('fxRelNoOthers')}</div>`}
    </div>`;
}
// Volet « Effets » d'un trigger : ouvert par défaut, repliable ; l'état (par identifiant de trigger) survit aux
// reconstructions de la liste, le temps que la page reste ouverte.
// Bornes proposées (curseur à 0 % -> 100 %) quand on choisit un paramètre pour une liaison de curseur.
const FX_SLIDER_DEFAULT_RANGE = {
  'lowcut.frequency': [20, 400], 'highcut.frequency': [400, 20000], 'volume.db': [-30, 0], 'reverb.wet': [0, 0.6],
  'delay.wet': [0, 0.5], 'delay.feedback': [0.2, 0.7], 'bitcrush.bits': [16, 4], 'bitcrush.reduction': [1, 20],
  'pitch.semitones': [0, 7], 'pitch.speed': [0, -12],
  'spatial.x': [-5, 5], 'spatial.y': [0, 10], 'spatial.distance': [2, 20], 'spatial.angle': [-90, 90], 'spatial.reverbDb': [-12, 0]
};
const fxTriggerEffectsCollapsed = new Set();
document.addEventListener('toggle', e => {
  const d = e.target, k = d && d.dataset && d.dataset.fxtEffectsKey;
  if (!k) return;
  if (d.open) fxTriggerEffectsCollapsed.delete(k); else fxTriggerEffectsCollapsed.add(k);
}, true);
function fxTriggersEditorHtml(track, ti) {
  const triggers = track.fxTriggers || [];
  if (!currentUserIsAdmin) {
    return `
      <div style="margin-top:14px;opacity:0.55">
        <div style="font-weight:600;font-size:0.9em;margin-bottom:2px">${tr('fxTriggersTitle')}</div>
        <div class="hint-inline">${tr('fxTriggersAdminOnly')}${triggers.length ? ' (' + triggers.length + ')' : ''}</div>
      </div>`;
  }
  const choices = fxTriggerTargetChoices(track);
  const cards = triggers.map((trg, i) => {
    const curValue = fxTriggerTargetToValue(trg.target);
    const opts = choices.map(c => `<option value="${escapeAttr(c.value)}" ${c.value === curValue ? 'selected' : ''}>${escapeAttr(c.label)}</option>`).join('');
    const attrs = `data-ti="${ti}" data-tri="${i}"`;
    return `
      <div class="list-block" style="margin-top:8px">
        <div class="row">
          <div><label>${tr('labelFieldLabel')}</label><input type="text" placeholder="${tr('fxTriggerLabelPlaceholder')}" data-field="fxTrigger" data-fxt-prop="label" ${attrs} value="${escapeAttr(trg.label)}"></div>
          <button class="btn btn-icon btn-danger" data-action="remove-fx-trigger" ${attrs} title="${tr('removeFxTriggerBtn')}" style="align-self:flex-end">×</button>
        </div>
        ${trg.target && trg.target.type !== 'track' ? `
          <div class="hint-inline" style="margin-top:6px">${tr('fxTriggerLegacyTarget', { name: escapeAttr((choices.find(c => c.value === curValue) || {}).label || curValue) })}
            <button class="btn btn-small" type="button" data-action="fx-trigger-to-track" ${attrs}>${tr('fxTriggerToWholeTrackBtn')}</button></div>
        ` : `<div class="hint-inline" style="margin-top:6px">${tr('fxTriggerWholeTrackNote')}</div>`}
        <details data-fxt-effects-key="${escapeAttr(trg.id)}" ${fxTriggerEffectsCollapsed.has(trg.id) ? '' : 'open'} style="margin-top:10px">
          <summary style="cursor:pointer;font-weight:600;font-size:0.9em">${tr('fxSectionTitle')} <span class="hint-inline" style="margin:0 0 0 6px;font-weight:400">${tr('fxTriggerEffectsCount', { n: Object.keys(trg.fx || {}).length })}</span></summary>
  ${fxBlockHtml(trg.fx, `data-fx-target="trigger" ${attrs}`)}
        </details>
        <label class="switch-row" style="margin-top:8px">
          <input type="checkbox" data-field="fxTrigger" data-fxt-prop="visible" ${attrs} ${trg.visible ? 'checked' : ''}>
          <span class="switch-row-label">${tr('fxTriggerVisibleLabel')}</span>
        </label>
        <div class="hint-inline">${tr('fxTriggerVisibleHint')}</div>
        <div class="row" style="margin-top:6px">
          <div><label style="font-size:0.85em">${tr('fxTriggerFadeLabel')}</label>
            <input type="number" step="0.05" min="0" max="10" data-field="fxTrigger" data-fxt-prop="fadeSec" style="width:100%" ${attrs} value="${trg.fadeSec != null ? trg.fadeSec : ''}"></div>
          <div><label style="font-size:0.85em">${tr('fxTriggerFadeOutLabel')}</label>
            <input type="number" step="0.05" min="0" max="10" placeholder="${tr('fxTriggerFadeOutPlaceholder')}" data-field="fxTrigger" data-fxt-prop="fadeOutSec" style="width:100%" ${attrs} value="${trg.fadeOutSec != null ? trg.fadeOutSec : ''}"></div>
        </div>
        <div style="margin-top:8px"><label style="font-size:0.85em">${tr('fxAutoOffLabel')}</label>
          <input type="number" step="0.5" min="0" placeholder="${tr('fxAutoOffPlaceholder')}" data-field="fxTrigger" data-fxt-prop="autoOffSec" style="width:100%" ${attrs} value="${trg.relations && trg.relations.autoOffSec != null ? trg.relations.autoOffSec : ''}"></div>
        <div class="hint-inline">${tr('fxAutoOffHint')}</div>
        ${fxRelationsEditorHtml(triggers, i, trg, attrs)}
      </div>`;
  }).join('');
  return `
    <div style="margin-top:14px">
      <div style="font-weight:600;font-size:0.9em;margin-bottom:2px">${tr('fxTriggersTitle')}</div>
      <div class="hint-inline">${tr('fxTriggersHint')}</div>
      ${cards}
      <div class="actions" style="margin-top:8px"><button class="btn btn-small" data-action="add-fx-trigger" data-ti="${ti}">${tr('addFxTriggerBtn')}</button></div>
    </div>`;
}
// ---- Curseurs de paramètre (24/09) -- réservés à l'admin, comme les triggers ----
// track.fxSliders = [{ id, label, defaultValue (0..1), smoothSec, visible, bindings:[{target, param, from, to}],
// thresholds:[{at (0..1), mode, triggerId}] }] : un curseur public dont la valeur règle des paramètres d'effets sur des
// cibles (courbe de `from` à `to`) et active/coupe des triggers selon des seuils. Voir fxSlidersValid dans player.js.
function fxSliderParamKey(param) { return 'fxSliderParam_' + String(param).replace('.', '_'); }
// Éditeur de courbe d'une liaison (24/09) : points {x, y} de 0 à 1 (x = position du curseur, y = de la valeur « à 0 % »
// en bas à la valeur « à 100 % » en haut). Extrémités calées aux bords (seul leur y bouge), points intermédiaires libres.
const FX_CURVE_W = 220, FX_CURVE_H = 130, FX_CURVE_PAD = 14;
const fxCurveSelected = {}; // "ti:sri:bi" -> index du point sélectionné
function fxCurveKey(ti, sri, bi) { return ti + ':' + sri + ':' + bi; }
function fxCurveInnerSvg(curve, selIdx) {
  const pts = curve && curve.length >= 2 ? curve : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const X = v => FX_CURVE_PAD + v * (FX_CURVE_W - 2 * FX_CURVE_PAD), Y = v => FX_CURVE_H - FX_CURVE_PAD - v * (FX_CURVE_H - 2 * FX_CURVE_PAD);
  return `<rect x="${X(0)}" y="${Y(1)}" width="${X(1) - X(0)}" height="${Y(0) - Y(1)}" fill="none" stroke="var(--border)" stroke-width="1"/>
    <line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="var(--border)" stroke-width="0.7" stroke-dasharray="3 3"/>
    <polyline points="${pts.map(q => X(q.x) + ',' + Y(q.y)).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2"/>` +
    pts.map((q, i) => `<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="${i === selIdx ? 6 : 4.5}" fill="${i === selIdx ? 'var(--accent)' : 'var(--bg, #fff)'}" stroke="var(--accent)" stroke-width="2"/>`).join('');
}
function fxCurveEditorHtml(b, ti, sri, bi) {
  const key = fxCurveKey(ti, sri, bi);
  const sel = fxCurveSelected[key] != null ? fxCurveSelected[key] : -1;
  return `
    <details style="margin-top:6px;width:100%">
      <summary style="cursor:pointer;font-size:0.85em">${tr('fxSliderCurveTitle')}${b.curve ? ' ✓' : ''}</summary>
      <div class="hint-inline">${tr('fxSliderCurveHint')}</div>
      <svg data-curve-editor="1" data-ti="${ti}" data-sri="${sri}" data-bi="${bi}" viewBox="0 0 ${FX_CURVE_W} ${FX_CURVE_H}" width="${FX_CURVE_W}" height="${FX_CURVE_H}" style="touch-action:none;cursor:crosshair;border:1px solid var(--border);border-radius:6px;display:block;margin-top:4px">${fxCurveInnerSvg(b.curve, sel)}</svg>
      <div class="actions" style="margin-top:4px">
        <button class="btn btn-small" type="button" data-action="fxsb-curve-remove" data-ti="${ti}" data-sri="${sri}" data-bi="${bi}">${tr('fxSliderCurveRemovePoint')}</button>
        <button class="btn btn-small" type="button" data-action="fxsb-curve-reset" data-ti="${ti}" data-sri="${sri}" data-bi="${bi}">${tr('fxSliderCurveReset')}</button>
      </div>
    </details>`;
}
function fxSlidersClean(list) {
  return (list || []).filter(x => x && x.id).map(x => ({
    id: x.id, label: x.label || '', visible: !!x.visible,
    defaultValue: Number.isFinite(+x.defaultValue) ? Math.max(0, Math.min(1, +x.defaultValue)) : 0,
    smoothSec: Number.isFinite(+x.smoothSec) && +x.smoothSec >= 0 ? +x.smoothSec : 0.15,
    bindings: (x.bindings || []).filter(b => b && b.target && b.param).map(b => { const cv = window.LayerPlayerCore.fxCurveSanitize(b.curve); return Object.assign({ target: b.target, param: b.param, from: Number.isFinite(+b.from) ? +b.from : 0, to: Number.isFinite(+b.to) ? +b.to : 1 }, cv ? { curve: cv } : {}); }),
    thresholds: (x.thresholds || []).filter(t => t && t.triggerId).map(t => ({ at: Number.isFinite(+t.at) ? Math.max(0, Math.min(1, +t.at)) : 0.5, mode: t.mode === 'above' ? 'above' : 'below', triggerId: t.triggerId }))
  }));
}
function fxSlidersEditorHtml(track, ti) {
  const sliders = track.fxSliders || [];
  if (!currentUserIsAdmin) {
    return `
      <div style="margin-top:14px;opacity:0.55">
        <div style="font-weight:600;font-size:0.9em;margin-bottom:2px">${tr('fxSlidersTitle')}</div>
        <div class="hint-inline">${tr('fxSlidersAdminOnly')}${sliders.length ? ' (' + sliders.length + ')' : ''}</div>
      </div>`;
  }
  // Décision du 24/09 : plus de cible par section -- une liaison agit sur TOUT le morceau, ou sur un Sfx attaché. Une
  // ancienne cible précise (déjà enregistrée) reste listée pour ne rien perdre.
  const voiceChoices = [{ value: 'track', label: tr('fxTargetWholeTrack') }];
  const legacyChoices = fxTriggerTargetChoices(track);
  // Sfx attachés au morceau (boutons Sfx) : cibles possibles pour les paramètres de spatialisation.
  const sfxChoices = (track.sfxIds || []).map(id => (typeof sfxLibrary !== 'undefined' ? sfxLibrary : []).find(x => x.id === id)).filter(Boolean)
    .map(x => ({ value: 'sfx:' + x.id, label: tr('fxSliderTargetSfx', { title: x.title || x.id }) }));
  const choices = voiceChoices.concat(sfxChoices);
  const paramsAll = window.LayerPlayerCore.FX_SLIDER_PARAMS;
  const paramsFor = b => Object.keys(paramsAll).filter(pk => (paramsAll[pk].kind === 'sfx') === !!(b.target && b.target.type === 'sfx'));
  const triggers = (track.fxTriggers || []).filter(d => d && d.id);
  const cards = sliders.map((sl, i) => {
    const a = `data-ti="${ti}" data-sri="${i}"`;
    const bindRows = (sl.bindings || []).map((b, bi) => {
      const cur = fxTriggerTargetToValue(b.target);
      const rowChoices = choices.some(c => c.value === cur) ? choices : choices.concat([{ value: cur, label: tr('fxSliderLegacyTargetOption', { name: (legacyChoices.find(c => c.value === cur) || {}).label || cur }) }]);
      const bAttrs = `data-field="fxSliderBinding" ${a} data-bi="${bi}"`;
      return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px;font-size:12px">
        <select ${bAttrs} data-fxsb-prop="target" style="width:auto">${rowChoices.map(c => `<option value="${escapeAttr(c.value)}" ${c.value === cur ? 'selected' : ''}>${escapeAttr(c.label)}</option>`).join('')}</select>
        <select ${bAttrs} data-fxsb-prop="param" style="width:auto">${paramsFor(b).map(pk => `<option value="${pk}" ${b.param === pk ? 'selected' : ''}>${tr(fxSliderParamKey(pk))}</option>`).join('')}</select>
        <label style="display:flex;align-items:center;gap:4px;margin:0">${tr('fxSliderFrom')} <input type="number" step="any" ${bAttrs} data-fxsb-prop="from" value="${b.from}" style="width:80px"></label>
        <label style="display:flex;align-items:center;gap:4px;margin:0">${tr('fxSliderTo')} <input type="number" step="any" ${bAttrs} data-fxsb-prop="to" value="${b.to}" style="width:80px"></label>
        <button class="btn btn-icon btn-danger" data-action="remove-fxs-binding" ${a} data-bi="${bi}" title="${tr('deleteBtn')}">×</button>
        ${fxCurveEditorHtml(b, ti, i, bi)}
      </div>`;
    }).join('');
    const thrRows = (sl.thresholds || []).map((t, thi) => {
      const tAttrs = `data-field="fxSliderThreshold" ${a} data-thi="${thi}"`;
      return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px;font-size:12px">
        <span>${tr('fxSliderThresholdWhen')}</span>
        <select ${tAttrs} data-fxst-prop="mode" style="width:auto"><option value="below" ${t.mode !== 'above' ? 'selected' : ''}>${tr('fxSliderBelow')}</option><option value="above" ${t.mode === 'above' ? 'selected' : ''}>${tr('fxSliderAbove')}</option></select>
        <input type="number" min="0" max="100" step="1" ${tAttrs} data-fxst-prop="at" value="${Math.round((t.at || 0) * 100)}" style="width:64px"> %
        <span>${tr('fxSliderThresholdThen')}</span>
        <select ${tAttrs} data-fxst-prop="triggerId" style="width:auto">${triggers.map(d => `<option value="${escapeAttr(d.id)}" ${d.id === t.triggerId ? 'selected' : ''}>${escapeAttr(d.label) || tr('fxTriggerLabelPlaceholder')}</option>`).join('')}</select>
        <button class="btn btn-icon btn-danger" data-action="remove-fxs-threshold" ${a} data-thi="${thi}" title="${tr('deleteBtn')}">×</button>
      </div>`;
    }).join('');
    return `
      <div class="list-block" style="margin-top:8px">
        <div class="row">
          <div><label>${tr('labelFieldLabel')}</label><input type="text" data-field="fxSlider" data-fxs-prop="label" ${a} placeholder="${tr('fxSliderLabelPlaceholder')}" value="${escapeAttr(sl.label)}"></div>
          <button class="btn btn-icon btn-danger" data-action="remove-fx-slider" ${a} title="${tr('removeFxSliderBtn')}" style="align-self:flex-end">×</button>
        </div>
        <div class="row" style="margin-top:6px">
          <div><label style="font-size:0.85em">${tr('fxSliderDefaultLabel')}</label><input type="number" min="0" max="100" step="1" data-field="fxSlider" data-fxs-prop="defaultValue" ${a} value="${Math.round((sl.defaultValue || 0) * 100)}"></div>
          <div><label style="font-size:0.85em">${tr('fxSliderSmoothLabel')}</label><input type="number" min="0" max="5" step="0.05" data-field="fxSlider" data-fxs-prop="smoothSec" ${a} value="${sl.smoothSec != null ? sl.smoothSec : 0.15}"></div>
        </div>
        <label class="switch-row" style="margin-top:8px">
          <input type="checkbox" data-field="fxSlider" data-fxs-prop="visible" ${a} ${sl.visible ? 'checked' : ''}>
          <span class="switch-row-label">${tr('fxSliderVisibleLabel')}</span>
        </label>
        <div style="margin-top:8px;font-weight:600;font-size:0.85em">${tr('fxSliderBindingsTitle')}</div>
        <div class="hint-inline">${tr('fxSliderBindingsHint')}</div>
        ${bindRows}
        <div class="actions" style="margin-top:6px"><button class="btn btn-small" data-action="add-fxs-binding" ${a}>${tr('addFxSliderBindingBtn')}</button></div>
        <div style="margin-top:10px;font-weight:600;font-size:0.85em">${tr('fxSliderThresholdsTitle')}</div>
        <div class="hint-inline">${tr('fxSliderThresholdsHint')}</div>
        ${thrRows}
        <div class="actions" style="margin-top:6px"><button class="btn btn-small" data-action="add-fxs-threshold" ${a} ${triggers.length ? '' : 'disabled'}>${tr('addFxSliderThresholdBtn')}</button></div>
      </div>`;
  }).join('');
  return `
    <div style="margin-top:14px">
      <div style="font-weight:600;font-size:0.9em;margin-bottom:2px">${tr('fxSlidersTitle')}</div>
      <div class="hint-inline">${tr('fxSlidersHint')}</div>
      ${cards}
      <div class="actions" style="margin-top:8px"><button class="btn btn-small" data-action="add-fx-slider" data-ti="${ti}">${tr('addFxSliderBtn')}</button></div>
    </div>`;
}
// Interaction de l'éditeur de courbe (délégation sur le document : le HTML de l'éditeur est régénéré à chaque rendu).
// Clic sur un point = le sélectionner et le déplacer ; clic dans le vide = nouveau point ; les extrémités ne bougent
// qu'en hauteur. Repeint le SVG sur place, sans redessiner toute la bibliothèque.
document.addEventListener('pointerdown', ev => {
  const svg = ev.target.closest && ev.target.closest('svg[data-curve-editor]');
  if (!svg) return;
  const ti = parseInt(svg.dataset.ti, 10), sri = parseInt(svg.dataset.sri, 10), bi = parseInt(svg.dataset.bi, 10);
  const b = (((library[ti] || {}).fxSliders || [])[sri] || {}).bindings;
  const binding = b && b[bi];
  if (!binding) return;
  if (!binding.curve) binding.curve = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const key = fxCurveKey(ti, sri, bi);
  const rect = svg.getBoundingClientRect();
  const k = FX_CURVE_W / rect.width;
  const toData = e => {
    const px = (e.clientX - rect.left) * k, py = (e.clientY - rect.top) * k;
    return { px, py, x: Math.max(0, Math.min(1, (px - FX_CURVE_PAD) / (FX_CURVE_W - 2 * FX_CURVE_PAD))), y: Math.max(0, Math.min(1, (FX_CURVE_H - FX_CURVE_PAD - py) / (FX_CURVE_H - 2 * FX_CURVE_PAD))) };
  };
  const scr = q => ({ px: FX_CURVE_PAD + q.x * (FX_CURVE_W - 2 * FX_CURVE_PAD), py: FX_CURVE_H - FX_CURVE_PAD - q.y * (FX_CURVE_H - 2 * FX_CURVE_PAD) });
  const d0 = toData(ev);
  let hit = -1, best = 12;
  binding.curve.forEach((q, i) => { const s2 = scr(q); const d = Math.hypot(s2.px - d0.px, s2.py - d0.py); if (d < best) { best = d; hit = i; } });
  if (hit < 0) {
    if (binding.curve.length >= 16) return;
    // Nouveau point à l'endroit du clic (x trié) : la courbe existante n'est pas modifiée ailleurs.
    let at = binding.curve.findIndex(q => q.x > d0.x); if (at < 0) at = binding.curve.length - 1;
    binding.curve.splice(at, 0, { x: d0.x, y: d0.y });
    hit = at;
  }
  fxCurveSelected[key] = hit;
  hasUnsavedEdits = true;
  const repaint = () => { svg.innerHTML = fxCurveInnerSvg(binding.curve, hit); };
  repaint();
  try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
  const move = e => {
    const d = toData(e), last = binding.curve.length - 1;
    const lo = hit > 0 ? binding.curve[hit - 1].x + 0.005 : 0, hi = hit < last ? binding.curve[hit + 1].x - 0.005 : 1;
    binding.curve[hit] = { x: (hit === 0 || hit === last) ? binding.curve[hit].x : Math.max(lo, Math.min(hi, d.x)), y: d.y };
    hasUnsavedEdits = true;
    repaint();
  };
  const up = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
});
// Double-clic sur un point INTERMÉDIAIRE de la courbe = le supprimer (les deux extrémités restent).
document.addEventListener('dblclick', ev => {
  const svg = ev.target.closest && ev.target.closest('svg[data-curve-editor]');
  if (!svg) return;
  const ti = parseInt(svg.dataset.ti, 10), sri = parseInt(svg.dataset.sri, 10), bi = parseInt(svg.dataset.bi, 10);
  const binding = ((((library[ti] || {}).fxSliders || [])[sri] || {}).bindings || [])[bi];
  if (!binding || !binding.curve) return;
  const rect = svg.getBoundingClientRect(), k = FX_CURVE_W / rect.width;
  const px = (ev.clientX - rect.left) * k, py = (ev.clientY - rect.top) * k;
  let hit = -1, best = 12;
  binding.curve.forEach((q, i) => {
    const d = Math.hypot(FX_CURVE_PAD + q.x * (FX_CURVE_W - 2 * FX_CURVE_PAD) - px, FX_CURVE_H - FX_CURVE_PAD - q.y * (FX_CURVE_H - 2 * FX_CURVE_PAD) - py);
    if (d < best) { best = d; hit = i; }
  });
  if (hit <= 0 || hit >= binding.curve.length - 1) return;
  binding.curve.splice(hit, 1);
  delete fxCurveSelected[fxCurveKey(ti, sri, bi)];
  hasUnsavedEdits = true;
  svg.innerHTML = fxCurveInnerSvg(binding.curve, -1);
});
// Actions liées à un embranchement : pour chaque trigger défini sur le morceau, "activer" / "couper" /
// "ne rien faire" quand CETTE option de bascule (séquentiel) ou CETTE boucle (embranchement-vertical) est prise.
function fxActionsHtml(actions, track, ownerAttrs) {
  const triggers = (track.fxTriggers || []).filter(x => x && x.id);
  if (!currentUserIsAdmin || !triggers.length) return '';
  const rows = triggers.map(trg => {
    const a = (actions || []).find(x => x.triggerId === trg.id);
    const v = a ? (a.active === false ? 'off' : 'on') : '';
    return `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <span style="flex:1;font-size:12px">${escapeAttr(trg.label) || tr('fxTriggerLabelPlaceholder')}</span>
      <select data-field="fxAction" data-fx-trigger-id="${escapeAttr(trg.id)}" ${ownerAttrs} style="width:auto">
        <option value="" ${v === '' ? 'selected' : ''}>${tr('fxActionNone')}</option>
        <option value="on" ${v === 'on' ? 'selected' : ''}>${tr('fxActionOn')}</option>
        <option value="off" ${v === 'off' ? 'selected' : ''}>${tr('fxActionOff')}</option>
      </select></div>`;
  }).join('');
  return `<div style="margin-top:10px"><div style="font-weight:600;font-size:0.85em">${tr('fxActionsTitle')}</div>${rows}</div>`;
}
// Bouton "+" inséré directement à la fin d'une liste maître de morceau (20/08, relecture de nettoyage) --
// factorise les 4 boutons d'ajout (+ Emplacement, + Section, + Boucle, + Couche) qui n'étaient que des
// copies quasi identiques les unes des autres. Vit désormais à la suite de la Structure plutôt que sous
// toute la colonne maître (retour visuel du 20/08 : il apparaissait à tort après "Contenu additionnel" /
// "Infos additionnelles").
function appendMasterAddButton(masterHost, action, ti, labelKey) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-small';
  btn.type = 'button';
  btn.dataset.action = action;
  btn.dataset.ti = ti;
  btn.textContent = tr(labelKey);
  btn.style.marginTop = '4px';
  masterHost.appendChild(btn);
}
// Glisser-déposer par poignée, généralisé (18/08) à partir du mécanisme déjà en place pour les blocs de
// contenu (16/08) -- réutilisable pour n'importe quelle liste réordonnable pilotée par un vrai tableau de
// données : couches (vertical), sections (vertical-random), boucles nommées (embranchement-vertical).
// containerEl : élément parent qui reçoit les écouteurs délégués. itemClass : classe CSS des lignes
// draggables (chacune doit porter data-drag-id = un id stable de l'objet qu'elle représente).
// getArray() : renvoie le tableau réel à réordonner (jamais une copie). onDrop() : callback après un
// réordonnancement effectif (typiquement renderLibrary()).
// Piège corrigé en relecture (18/08) : cette fonction est appelée à chaque renderLibrary() (donc à
// chaque frappe dans un champ, potentiellement des centaines de fois par session) -- brancher les
// écouteurs pointerup/pointercancel de secours ICI, comme un premier jet l'avait fait, les aurait
// empilés sur `document` sans jamais les retirer (fuite). Ils sont donc posés UNE SEULE FOIS plus bas
// (releaseAllDragHandles), pas à chaque appel -- seuls les écouteurs posés sur containerEl (recréé à
// chaque rendu, donc jamais dupliqués puisque l'ancien conteneur part avec) restent ici.
// ---- Duplication par Alt + glisser (25/09, demande de Jules-Antoine) ----
// Alt (Option sur Mac) enfoncé au moment de lâcher : l'élément est COPIÉ à l'endroit visé au lieu d'être déplacé.
// Certains navigateurs ne renseignent pas altKey sur les événements de glisser : on suit aussi la touche au clavier.
let altKeyHeld = false;
document.addEventListener('keydown', e => { if (e.key === 'Alt') altKeyHeld = true; });
document.addEventListener('keyup', e => { if (e.key === 'Alt') altKeyHeld = false; });
window.addEventListener('blur', () => { altKeyHeld = false; });
// Réservé à l'admin tant que Jules-Antoine n'a pas donné son feu vert (25/09) : ailleurs, Alt + glisser déplace simplement.
function isDuplicateDrag(e) { return currentUserIsAdmin && !!(e.altKey || altKeyHeld); }
// Copie profonde : nouveaux id partout (l'élément et tout ce qu'il contient), fichiers (File) et fichiers déjà en
// ligne (remoteFile) partagés tels quels -- rien à re-télécharger ; supprimer une copie ne peut plus effacer les
// fichiers de l'original (voir pendingOrphanR2Keys). Les références vers d'autres éléments (targetId,
// referencesSlotId, sfxIds...) sont conservées.
function deepCloneWithNewIds(v) {
  if (Array.isArray(v)) return v.map(deepCloneWithNewIds);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o = {};
    Object.keys(v).forEach(k => { o[k] = k === 'id' ? genId() : deepCloneWithNewIds(v[k]); });
    return o;
  }
  return v;
}
function cloneWithCopyLabel(item, labelKey) {
  const c = deepCloneWithNewIds(item);
  const k = labelKey || 'label';
  if (c[k] && String(c[k]).trim()) c[k] = tr('duplicateLabel', { label: c[k] });
  return c;
}
// Une poignée n'arme que l'élément qui la porte directement, jamais un élément qui le contient (27/09 : la
// poignée d'un morceau du bloc Musique armait aussi le bloc entier, resté grisé après le dépôt).
const DRAG_ITEM_SELECTOR = '[data-drag-id], .block-editor-card';
function ownsHandle(item, handle) { return handle.closest(DRAG_ITEM_SELECTOR) === item; }
// cloneItem (optionnel) : active la duplication Alt + glisser pour cette liste. onDrop(item) reçoit l'élément
// déplacé ou la copie créée.
function wireArrayDragReorder(containerEl, itemClass, getArray, onDrop, cloneItem) {
  // idOf (29/08) : accepte aussi bien un tableau d'objets {id, ...} (usage historique, ex. track.loops)
  // qu'un tableau de simples chaînes d'identifiants (ex. selectedTrackIds d'un AdReel) -- sans dupliquer
  // ce mécanisme de glisser-déposer pour ce second cas de figure.
  const idOf = x => (typeof x === 'string' ? x : x.id);
  let draggedId = null;
  containerEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.block-drag-handle');
    if (!handle) return;
    const item = handle.closest('.' + itemClass);
    if (item && ownsHandle(item, handle)) item.draggable = true;
  });
  containerEl.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.' + itemClass);
    if (!item || e.target !== item || !item.draggable) return; // seul l'élément réellement glissé (27/09)
    draggedId = item.dataset.dragId;
    item.classList.add('dragging');
    containerEl.classList.add('is-reordering');
    e.dataTransfer.effectAllowed = cloneItem ? 'copyMove' : 'move';
    try { e.dataTransfer.setData('text/plain', draggedId); } catch (err) { /* MIME requis par certains navigateurs, jamais bloquant ici */ }
  });
  containerEl.addEventListener('dragover', (e) => {
    if (!draggedId) return;
    e.preventDefault();
    const dup = !!cloneItem && isDuplicateDrag(e);
    e.dataTransfer.dropEffect = dup ? 'copy' : 'move';
    containerEl.classList.toggle('is-duplicating', dup);
    const item = e.target.closest('.' + itemClass);
    if (!item || !item.dataset.dragId || (item.dataset.dragId === draggedId && !dup)) return;
    const rect = item.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    item.classList.toggle('drag-over-top', before);
    item.classList.toggle('drag-over-bottom', !before);
  });
  containerEl.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.' + itemClass);
    if (item && !item.contains(e.relatedTarget)) item.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  containerEl.addEventListener('drop', (e) => {
    if (!draggedId) return;
    e.preventDefault();
    const targetItem = e.target.closest('.' + itemClass);
    containerEl.querySelectorAll('.' + itemClass).forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
    containerEl.classList.remove('is-reordering', 'is-duplicating');
    const arr = getArray();
    const fromIdx = arr.findIndex(x => idOf(x) === draggedId);
    draggedId = null;
    if (fromIdx === -1) return;
    if (!targetItem || !targetItem.dataset.dragId) return;
    if (cloneItem && isDuplicateDrag(e)) {
      const toIdx = arr.findIndex(x => idOf(x) === targetItem.dataset.dragId);
      if (toIdx === -1) return;
      const rect = targetItem.getBoundingClientRect();
      const copy = cloneItem(arr[fromIdx]);
      arr.splice((e.clientY - rect.top) < rect.height / 2 ? toIdx : toIdx + 1, 0, copy);
      hasUnsavedEdits = true;
      onDrop(copy);
      return;
    } // pas de dépôt en fin de liste ici (contrairement aux blocs de contenu) : chaque
    // ligne de cette liste maître occupe toute la largeur disponible, il n'y a pas d'espace vide sous la
    // dernière ligne où déposer sans ambiguïté.
    const targetId = targetItem.dataset.dragId;
    if (targetId === idOf(arr[fromIdx])) return;
    const toIdx = arr.findIndex(x => idOf(x) === targetId);
    if (toIdx === -1) return;
    const rect = targetItem.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    const insertAt = before ? toIdx : toIdx + 1;
    const [moved] = arr.splice(fromIdx, 1);
    const adjustedInsertAt = insertAt > fromIdx ? insertAt - 1 : insertAt;
    arr.splice(adjustedInsertAt, 0, moved);
    hasUnsavedEdits = true;
    onDrop(moved);
  });
  containerEl.addEventListener('dragend', (e) => {
    const item = e.target.closest('.' + itemClass);
    if (item) { item.classList.remove('dragging'); item.draggable = false; }
    containerEl.querySelectorAll('.' + itemClass).forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
    containerEl.classList.remove('is-reordering', 'is-duplicating');
    draggedId = null;
  });
}
// Filet de sécurité global (posé une seule fois, pas à chaque appel de wireArrayDragReorder ci-dessus) :
// relâche n'importe quel élément resté armé en draggable="true" si le pointeur remonte sans qu'un vrai
// drag n'ait eu lieu (simple clic bref sur la poignée, ou relâchement hors de la liste). Balaie tout le
// document plutôt qu'un conteneur précis -- volontairement large, puisqu'un seul écouteur suffit pour
// toutes les listes maître de tous les morceaux, quel que soit leur nombre.
function releaseAllDragHandles() {
  document.querySelectorAll('.seq-master-item[draggable="true"], .sel-track-item[draggable="true"]').forEach(c => { c.draggable = false; });
}
document.addEventListener('pointerup', releaseAllDragHandles);
document.addEventListener('pointercancel', releaseAllDragHandles);
// Glisser-déposer à dossiers, généralisé (20/08) -- construit d'abord pour "Gérer les AdReels", factorisé
// le même jour pour être partagé avec la bibliothèque Sfx et la bibliothèque de morceaux : même besoin
// exact dans les trois cas (organiser une liste plate en dossiers, réordonnancement des éléments ET des
// dossiers eux-mêmes par glisser-déposer). Deux systèmes coexistent dans le même conteneur, distingués par
// la classe de poignée pressée (.block-drag-handle nu pour un élément, .folder-drag-handle pour un
// dossier) :
//   - Élément : déposer SUR un autre élément change à la fois son groupe (folderId, lu depuis l'élément
//     cible) et sa position (avant/après selon la moitié survolée) ; déposer sur une zone vide (dossier
//     vide ou padding sous le dernier élément) ne change que le groupe, l'élément est ajouté en dernière
//     position de son nouveau groupe.
//   - Dossier : réordonnancement classique au sein du tableau de dossiers, même logique avant/après que
//     wireArrayDragReorder, mais réécrite ici plutôt que réutilisée -- wireArrayDragReorder cible
//     spécifiquement .block-drag-handle sans distinction, ce qui armerait aussi les éléments nichés à
//     l'intérieur d'un dossier (ils remontent jusqu'à .org-folder-group via closest()).
// getItems()/getFolders() renvoient les tableaux RÉELS actifs pour ce conteneur (jamais une copie) --
// chaque élément a .id et .folderId (null = racine), chaque dossier a .id. onDrop() est appelé après toute
// modification effective (typiquement le renderX() du panneau appelant).
// Une seule paire de variables de suivi (draggedOrgItemId/draggedOrgFolderId), partagée entre tous les
// appelants : un vrai glisser-déposer HTML5 n'est jamais qu'une seule opération active à la fois dans tout
// le navigateur, donc aucun risque de collision entre les panneaux qui appellent cette fonction chacun sur
// leur propre conteneur.
let draggedOrgItemId = null;
let draggedOrgFolderId = null;
function wireOrgDragDrop(containerEl, getItems, getFolders, onDrop) {
  containerEl.addEventListener('pointerdown', (e) => {
    const folderHandle = e.target.closest('.folder-drag-handle');
    if (folderHandle) {
      const group = folderHandle.closest('.org-folder-group');
      if (group) group.draggable = true;
      return;
    }
    const rowHandle = e.target.closest('.block-drag-handle');
    if (!rowHandle) return;
    const row = rowHandle.closest('.org-row');
    if (row && ownsHandle(row, rowHandle)) row.draggable = true;
  });
  containerEl.addEventListener('dragstart', (e) => {
    const group = e.target.closest('.org-folder-group');
    if (group && e.target === group && group.draggable) {
      draggedOrgFolderId = group.dataset.dragId;
      group.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', draggedOrgFolderId); } catch (err) { /* non bloquant */ }
      return;
    }
    const row = e.target.closest('.org-row');
    if (!row || e.target !== row || !row.draggable) return;
    draggedOrgItemId = row.dataset.dragId;
    row.classList.add('dragging');
    containerEl.classList.add('is-reordering');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', draggedOrgItemId); } catch (err) { /* non bloquant */ }
  });
  containerEl.addEventListener('dragover', (e) => {
    if (draggedOrgFolderId) {
      const group = e.target.closest('.org-folder-group');
      if (!group || group.dataset.dragId === draggedOrgFolderId) return;
      e.preventDefault();
      const rect = group.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      group.classList.toggle('drag-over-top', before);
      group.classList.toggle('drag-over-bottom', !before);
      return;
    }
    if (!draggedOrgItemId) return;
    const row = e.target.closest('.org-row');
    if (row && row.dataset.dragId !== draggedOrgItemId) {
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      row.classList.toggle('drag-over-top', before);
      row.classList.toggle('drag-over-bottom', !before);
      return;
    }
    const zone = e.target.closest('.org-folder-dropzone, .org-root-dropzone');
    if (!zone) return;
    e.preventDefault();
    zone.classList.add('org-drop-target');
  });
  containerEl.addEventListener('dragleave', (e) => {
    const group = e.target.closest('.org-folder-group');
    if (group && !group.contains(e.relatedTarget)) group.classList.remove('drag-over-top', 'drag-over-bottom');
    const row = e.target.closest('.org-row');
    if (row && !row.contains(e.relatedTarget)) row.classList.remove('drag-over-top', 'drag-over-bottom');
    const zone = e.target.closest('.org-folder-dropzone, .org-root-dropzone');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('org-drop-target');
  });
  containerEl.addEventListener('drop', (e) => {
    containerEl.classList.remove('is-reordering');
    containerEl.querySelectorAll('.drag-over-top, .drag-over-bottom, .org-drop-target').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom', 'org-drop-target');
    });
    const folders = getFolders();
    const items = getItems();
    if (draggedOrgFolderId) {
      e.preventDefault();
      const targetGroup = e.target.closest('.org-folder-group');
      const fromIdx = folders.findIndex(f => f.id === draggedOrgFolderId);
      draggedOrgFolderId = null;
      if (!targetGroup || fromIdx === -1) return;
      const targetId = targetGroup.dataset.dragId;
      if (targetId === folders[fromIdx].id) return;
      const toIdx = folders.findIndex(f => f.id === targetId);
      if (toIdx === -1) return;
      const rect = targetGroup.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      const insertAt = before ? toIdx : toIdx + 1;
      const [moved] = folders.splice(fromIdx, 1);
      const adjustedInsertAt = insertAt > fromIdx ? insertAt - 1 : insertAt;
      folders.splice(adjustedInsertAt, 0, moved);
      hasUnsavedEdits = true;
      onDrop();
      return;
    }
    if (!draggedOrgItemId) return;
    e.preventDefault();
    const it = items.find(x => x.id === draggedOrgItemId);
    const targetRow = e.target.closest('.org-row');
    const zone = e.target.closest('.org-folder-dropzone, .org-root-dropzone');
    draggedOrgItemId = null;
    if (!it) return;
    const fromIdx = items.indexOf(it);
    if (targetRow && targetRow.dataset.dragId !== it.id) {
      // Déposé sur un autre élément : change de groupe ET se positionne juste avant/après lui.
      const targetFolderId = targetRow.dataset.folderId || null;
      const rect = targetRow.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      items.splice(fromIdx, 1);
      const targetIdxNow = items.findIndex(x => x.id === targetRow.dataset.dragId);
      const insertAt = before ? targetIdxNow : targetIdxNow + 1;
      it.folderId = targetFolderId;
      items.splice(insertAt, 0, it);
      hasUnsavedEdits = true;
      onDrop();
    } else if (zone) {
      // Déposé sur une zone vide (dossier vide, ou padding sous le dernier élément) : change de groupe
      // seulement, ajouté en dernière position de ce groupe (donc en dernière position globale du
      // tableau -- l'ordre relatif au sein d'un groupe suivant celui du tableau, peu importe où vivent
      // les éléments des autres groupes entre-temps).
      const targetFolderId = zone.dataset.folderId || null;
      if (it.folderId === targetFolderId) return;
      items.splice(fromIdx, 1);
      it.folderId = targetFolderId;
      items.push(it);
      hasUnsavedEdits = true;
      onDrop();
    }
  });
  containerEl.addEventListener('dragend', (e) => {
    const group = e.target.closest('.org-folder-group');
    if (group) { group.classList.remove('dragging'); group.draggable = false; }
    const row = e.target.closest('.org-row');
    if (row) { row.classList.remove('dragging'); row.draggable = false; }
    containerEl.classList.remove('is-reordering');
    containerEl.querySelectorAll('.drag-over-top, .drag-over-bottom, .org-drop-target').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom', 'org-drop-target');
    });
    draggedOrgItemId = null;
    draggedOrgFolderId = null;
  });
}
// Pas de filet de sécurité pointerup/pointercancel dédié pour les lignes d'élément : chacune porte à la
// fois .org-row ET .seq-master-item (voir buildOrgRowEl), donc releaseAllDragHandles() ci-dessus
// (sélecteur .seq-master-item[draggable="true"]) les couvre déjà, quel que soit le panneau. Les groupes de
// dossier n'ont pas cette classe -- filet dédié pour eux, générique lui aussi.
function releaseAllOrgFolderDragHandles() {
  document.querySelectorAll('.org-folder-group[draggable="true"]').forEach(c => { c.draggable = false; });
}
document.addEventListener('pointerup', releaseAllOrgFolderDragHandles);
document.addEventListener('pointercancel', releaseAllOrgFolderDragHandles);
// Construit la colonne maître à dossiers (repliables) + zone racine pour une liste organisée en dossiers
// (20/08, généralisé) : réutilisée par "Gérer les AdReels", la bibliothèque Sfx et la bibliothèque de
// morceaux. items/folders doivent être les tableaux RÉELS (jamais une copie). opts :
//   selectedId          id actuellement affiché dans le panneau de détail
//   selectAction        nom de l'action data-action posée sur chaque ligne au clic (propre à chaque appelant)
//   toggleFolderAction  nom de l'action data-action du bouton repli/dépli de dossier
//   deleteFolderAction  nom de l'action data-action du bouton suppression de dossier
//   folderFieldAttr     nom de l'attribut data-*-folder-field posé sur le champ titre du dossier
//   folderFallbackKey   clé i18n du placeholder "dossier sans nom"
//   buildRowInner(item) renvoie le HTML interne d'une ligne (après la poignée) -- laisse à l'appelant le
//                       soin d'afficher ce qui a du sens pour lui (titre + badge, titre + compteur, etc.)
function renderOrgMasterList(masterHost, items, folders, collapsedFolderIds, opts) {
  function rowEl(item) {
    const row = document.createElement('div');
    row.className = 'seq-master-item org-row' + (item.id === opts.selectedId ? ' active' : '');
    row.dataset.action = opts.selectAction;
    row.dataset.dragId = item.id;
    row.dataset.folderId = item.folderId || '';
    row.innerHTML = `${dragHandleHtml()}${opts.buildRowInner(item)}`;
    return row;
  }
  masterHost.innerHTML = '';
  folders.forEach(folder => {
    const itemsInFolder = items.filter(it => it.folderId === folder.id);
    const collapsed = collapsedFolderIds.has(folder.id);
    const group = document.createElement('div');
    group.className = 'org-folder-group';
    group.dataset.dragId = folder.id;
    group.innerHTML = `
      <div class="org-folder-header">
        ${dragHandleHtml('folder-drag-handle')}
        <button class="btn btn-icon" data-action="${opts.toggleFolderAction}" data-folder-id="${folder.id}" type="button">${collapsed ? '▸' : '▾'}</button>
        <input type="text" class="org-folder-title" ${opts.folderFieldAttr}="label" data-folder-id="${folder.id}" value="${escapeAttr(folder.label)}" placeholder="${tr(opts.folderFallbackKey)}">
        ${deleteIconBtnHtml(opts.deleteFolderAction, { 'folder-id': folder.id }, tr('deleteBtn'))}
      </div>
    `;
    if (!collapsed) {
      const dropzone = document.createElement('div');
      dropzone.className = 'org-folder-dropzone';
      dropzone.dataset.folderId = folder.id;
      if (itemsInFolder.length) {
        itemsInFolder.forEach(it => dropzone.appendChild(rowEl(it)));
      } else {
        dropzone.innerHTML = `<div class="hint-inline org-folder-empty-hint">${tr('orgFolderEmptyHint')}</div>`;
      }
      group.appendChild(dropzone);
    }
    masterHost.appendChild(group);
  });
  const rootZone = document.createElement('div');
  rootZone.className = 'org-root-dropzone';
  rootZone.dataset.folderId = ''; // racine, hors de tout dossier
  items.filter(it => !it.folderId).forEach(it => rootZone.appendChild(rowEl(it)));
  masterHost.appendChild(rootZone);
}
// Supprime un dossier de façon non destructrice (20/08, généralisé) : demande confirmation seulement s'il
// contient encore des éléments, et les fait remonter à la racine plutôt que de les supprimer -- un
// AdReel/Sfx/morceau contient trop de travail pour risquer une perte accidentelle sur un simple clic de
// dossier. Renvoie (promesse) true si la suppression a eu lieu (pour laisser l'appelant décider de re-rendre ou non).
async function deleteOrgFolder(folders, items, folderId) {
  const hasItems = items.some(it => it.folderId === folderId);
  if (hasItems && !(await window.LayerPitchNotify.confirm(tr('deleteOrgFolderConfirm')))) return false;
  items.forEach(it => { if (it.folderId === folderId) it.folderId = null; });
  const idx = folders.findIndex(f => f.id === folderId);
  if (idx !== -1) folders.splice(idx, 1);
  return true;
}
// Repère de section dans un formulaire dense (éditeur de morceau) — même langage visuel que les eyebrows
// de la sidebar (nav-section-label), avec un filet de séparation en plus puisqu'ici le repère s'intercale
// entre des champs plutôt qu'en haut d'une liste de navigation.
function sectionEyebrow(label) {
  return `<div class="nav-section-label track-section-label">${label}</div>`;
}
// Bouton de repli en bas à droite d'un bloc long — mêmes data-action/data-* que le bouton du haut, pour
// qu'il soit pris en charge par le même gestionnaire délégué sans rien ajouter de spécifique. N'a besoin
// d'afficher qu'un seul état ("replier") : il ne peut jamais être visible quand le bloc est déjà replié,
// puisqu'il vit à l'intérieur du corps repliable lui-même.
function collapseFooterHtml(action, dataAttrs) {
  const attrs = Object.entries(dataAttrs).map(([k, v]) => `data-${k}="${v}"`).join(' ');
  return `<div class="collapse-footer"><button type="button" class="btn btn-small" data-action="${action}" ${attrs}>▴ ${tr('collapseBlockBtn')}</button></div>`;
}
function updateFileStatus(statusEl, pendingFile, remoteFile, originalFileName) {
  if (pendingFile) { statusEl.textContent = tr('selectedFilePrefix', { name: pendingFile.name }); statusEl.className = 'file-status pending'; }
  // Nom de fichier affiché même une fois publié (29/08, retour de Jules-Antoine) -- remoteFile est déjà le
  // chemin/nom lui-même partout dans ce fichier, plus besoin d'aller chercher ailleurs.
  // originalFileName (29/08, retour de Jules-Antoine) : nom donné par le compositeur au moment de
  // l'upload (ex. "Lent.wav"), distinct du nom généré par l'app pour le stockage distant (ex.
  // "loop1-on-est-repere.ogg", dérivé du label) -- bien plus lisible pour le compositeur que le nom
  // technique. Absent sur les fichiers publiés AVANT ce chantier (jamais capturé à l'époque) : repli sur
  // le nom de stockage, comportement inchangé pour eux.
  else if (remoteFile) { statusEl.textContent = tr('publishedFilePrefix', { name: originalFileName || basenameOf(remoteFile) }); statusEl.className = 'file-status ok'; }
  else { statusEl.textContent = tr('noFileStatus'); statusEl.className = 'file-status'; }
}
function wireFileControl(root, accept, getPending, getRemote, onSelect, getOriginalName) {
  const btn = root.querySelector('[data-role="pickBtn"]');
  const input = root.querySelector('[data-role="fileInput"]');
  const status = root.querySelector('[data-role="fileStatus"]');
  input.accept = accept;
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files[0] || null;
    onSelect(f);
    updateFileStatus(status, f, getRemote(), getOriginalName ? getOriginalName() : null);
  });
  updateFileStatus(status, getPending(), getRemote(), getOriginalName ? getOriginalName() : null);
  // Glisser-déposer un fichier directement sur la ligne du bouton (25/09, demande de Jules-Antoine pour
  // l'intro/outro) : même effet qu'un choix via le bouton. Posé ici plutôt qu'au cas par cas, donc valable
  // pour TOUS les sélecteurs de fichier. stopPropagation seulement si le fichier est accepté : un dépôt
  // précis sur un sélecteur remplace SON fichier, au lieu d'être aussi capté par une zone de dépôt
  // multi-fichiers englobante (wireBatchDrop, qui ajoute de nouvelles variations).
  const dropZone = root.querySelector('.file-ctrl') || root;
  const acceptsFile = f => fileMatchesAccept(f, accept);
  dropZone.addEventListener('dragover', e => {
    if (![...(e.dataTransfer.types || [])].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    dropZone.classList.remove('drag-over');
    e.preventDefault(); // jamais d'ouverture du fichier par le navigateur (qui quitterait la page sans sauvegarder)
    const f = [...(e.dataTransfer.files || [])].find(acceptsFile);
    if (!f) return; // type refusé : on laisse remonter vers une éventuelle zone de dépôt englobante
    e.stopPropagation();
    onSelect(f);
    updateFileStatus(status, f, getRemote(), getOriginalName ? getOriginalName() : null);
  });
}
// Vérifie un fichier contre une chaîne `accept` d'input file (".wav,audio/wav,image/*"...) -- extensions,
// types MIME exacts et jokers "type/*".
function fileMatchesAccept(f, accept) {
  if (!f) return false;
  if (!accept) return true;
  const name = (f.name || '').toLowerCase();
  const type = (f.type || '').toLowerCase();
  return accept.split(',').map(a => a.trim().toLowerCase()).filter(Boolean).some(a => {
    if (a.startsWith('.')) return name.endsWith(a);
    if (a.endsWith('/*')) return type.startsWith(a.slice(0, -1));
    return type === a;
  });
}

// Filet de sécurité (25/09) : un fichier lâché hors d'une zone de dépôt ne doit jamais être ouvert par le
// navigateur, qui quitterait le Backstage en perdant les modifications non enregistrées. Les zones de dépôt
// traitent l'événement avant qu'il n'arrive ici.
['dragover', 'drop'].forEach(type => document.addEventListener(type, e => {
  if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault();
}));
function wireBatchDrop(hostEl, onFiles) {
  hostEl.addEventListener('dragover', e => {
    if (![...(e.dataTransfer.types || [])].includes('Files')) return; // un glisser interne (réordonner) n'est pas un dépôt de fichiers
    e.preventDefault(); hostEl.classList.add('drag-over');
  });
  hostEl.addEventListener('dragleave', () => hostEl.classList.remove('drag-over'));
  hostEl.addEventListener('drop', e => {
    e.preventDefault();
    hostEl.classList.remove('drag-over');
    // L'ordre fourni par dataTransfer.files n'est pas garanti par la spec (varie selon navigateur/OS lors
    // d'un dépôt multi-fichiers) -- on retrie par nom (tri naturel : "#2" avant "#10") pour que l'ordre
    // affiché corresponde à celui attendu par le compositeur, quel que soit l'ordre de dépôt réel (14/09,
    // retour de Jules-Antoine).
    const files = [...(e.dataTransfer.files || [])]
      .filter(f => /\.(wav|mp3)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    if (files.length) { e.stopPropagation(); onFiles(files); } // traité ici : pas une 2e fois par un bloc englobant
  });
}

function migrateBlocks(data) {
  let loaded = data.blocks;
  // Un tableau vide est désormais un état légitime (tous les blocs supprimés intentionnellement, 20/08) --
  // à ne pas confondre avec un champ absent/corrompu (ancien format en tableau de chaînes) qui, lui,
  // déclenche la reconstruction "legacy" ci-dessous. `loaded.length > 0 &&` évite de traiter [] comme
  // legacy simplement parce que loaded[0] vaut undefined.
  const isLegacyOrMissing = !Array.isArray(loaded) || (loaded.length > 0 && typeof loaded[0] !== 'object');
  if (isLegacyOrMissing) {
    const legacy = Array.isArray(loaded) ? loaded : ['header', 'testimonials', 'videos', 'gallery', 'bio', 'tracks'];
    const out = [];
    legacy.forEach(type => {
      const t = type === 'photo' ? 'gallery' : type;
      if (t === 'gallery') out.push({ id: genId(), type: 'photo', align: 'left', images: (data.gallery || []).map(g => ({ file: g.file })) });
      else if (t === 'videos') out.push({ id: genId(), type: 'video', videos: (data.videos || []).map(v => ({ title: v.title, url: v.url })) });
      else if (SINGLETON_TYPES.includes(t)) out.push({ id: genId(), type: t });
    });
    loaded = out;
  }
  loaded.forEach(b => {
    if (b.type === 'photo' && !b.images) b.images = b.file ? [{ file: b.file }] : [];
    if (b.type === 'video' && !b.videos) b.videos = (b.title || b.url) ? [{ title: b.title || '', url: b.url || '' }] : [];
  });
  // Plus de réinjection forcée des types "singleton" ici (retirée le 20/08) : un bloc Header/Bio/
  // Témoignages/Musique supprimé par le compositeur doit rester supprimé au rechargement suivant, pas
  // réapparaître vide tout seul. Le menu "+ Ajouter un bloc" permet de le rajouter s'il change d'avis
  // (voir les boutons btnAddHeaderBlock et consorts).
  return loaded;
}

function freshBlocks() {
  return [
    { id: genId(), type: 'header' },
    { id: genId(), type: 'tracks' },
    { id: genId(), type: 'bio' }
  ];
}

