const { escapeHtml, linkify, renderTracksBlock, setupContrastToggle, setupNightModeToggle, section } = window.LayerPlayerCore;

// Images migrées vers Cloudflare R2 (docs/infrastructure.md, Partie B, Décision 3) — chemins
// conservés à l'identique (images/<filename>), seul le domaine de base change.
const IMAGES_BASE = 'https://media.layerpitch.com/images/';

// Chemin joli par compositeur — voir le commentaire équivalent dans index.html.
// Capturé AVANT le replaceState ci-dessous (même bug que index.html, corrigé le 18/09) : __pretty ne
// contient jamais ?u=<handle>, donc restaurer la barre d'adresse dessus efface u de location.search.
const composerHandleFromUrl = new URLSearchParams(location.search).get('u');
(function restorePrettyUrl() {
  const pretty = new URLSearchParams(location.search).get('__pretty');
  if (pretty) history.replaceState(null, '', pretty);
})();
const DEFAULT_OWNER_ID = 'd7b26934-2f7d-43d4-a69e-52611bf4c141';

// Dernier ownerId résolu par loadSiteData() — voir le commentaire équivalent dans index.html
// (ajouté le 4 septembre pour le tableau de bord analytique compositeur).
let lastResolvedOwnerId = DEFAULT_OWNER_ID;
// Identité de compositeur par handle — voir le commentaire équivalent dans index.html.
// Postgres seule source de vérité (7 septembre, Décision 5 close) -- data.json plus jamais lu, voir
// index.html pour le pourquoi (backstage hébergé multi-compositeur).
// Mode aperçu (?preview=1, backstage -- bouton "Prévisualiser") : mis à vrai seulement si un dépôt
// local valide a réellement été utilisé ci-dessous -- lu par init() pour afficher le bandeau "Mode
// aperçu", jamais affiché sur un ?preview=1 sans dépôt valide (page rechargée après expiration du
// stockage local, par exemple), qui retombe alors sur le chargement Postgres normal, silencieusement.
let previewActive = false;
async function loadSiteData() {
  const params = new URLSearchParams(location.search);
  // localStorage (pas sessionStorage, cf. commentaire de openPreview() côté backstage) : partagé
  // entre onglets de même origine, seul moyen pour cet onglet fraîchement ouvert de lire le dépôt
  // écrit par l'onglet backstage juste avant. Aucun appel réseau, aucune écriture ici.
  if (params.get('preview') === '1') {
    try {
      const raw = localStorage.getItem('layerpitch_preview_data');
      if (raw) { previewActive = true; return JSON.parse(raw); }
    } catch (e) { /* dépôt corrompu/absent -- repli silencieux sur le chargement Postgres normal */ }
  }
  const handle = composerHandleFromUrl;
  await loadPostgresReadScripts();
  let ownerId = DEFAULT_OWNER_ID;
  if (handle) {
    const { ownerId: resolvedId, error } = await window.LayerPitchComposers.resolveHandle(handle);
    if (error) throw new Error(error);
    ownerId = resolvedId || DEFAULT_OWNER_ID;
  }
  lastResolvedOwnerId = ownerId;
  return window.LayerPitchSiteData.loadSiteDataFromPostgres(ownerId);
}
// Bandeau "Mode aperçu" -- seul indice visible que ce chargement vient du backstage (localStorage)
// et non de Postgres, pour que l'absence d'un fichier tout juste ajouté/remplacé (voir
// buildDataSnapshot(), backstage) ne passe pas pour un bug.
function showPreviewModeBanner() {
  const banner = document.createElement('div');
  banner.className = 'preview-mode-banner';
  banner.textContent = tr('previewModeBanner');
  document.body.prepend(banner);
  document.body.classList.add('has-preview-banner');
}

// Achat réel de packs (Décision 5, étape 4 — backend Stripe/Postgres construit et vérifié le
// 31 août, docs/LAYERPITCH_CHANGELOG.md). Volontairement désactivé en production pour l'instant :
// décision actée avec Jules-Antoine de garder l'affichage "Bientôt disponible" pendant la bêta
// (comportement inchangé tant que ce flag reste à false — aucune requête réseau supplémentaire,
// aucun SDK chargé). Passer à true pour activer, une fois prêt à sortir de la bêta.
const PURCHASES_ENABLED = false;

// Charge le SDK Supabase + api/*.js à la demande seulement (jamais si PURCHASES_ENABLED est faux) —
// mémorisé pour ne charger qu'une fois même si plusieurs packs de la page en ont besoin.
let purchaseScriptsLoaded = null;
function loadPurchaseScripts() {
  if (purchaseScriptsLoaded) return purchaseScriptsLoaded;
  // Même chargeur que loadPostgresReadScripts() (public-page.js) : téléchargement parallèle, exécution dans l'ordre,
  // version du déploiement.
  purchaseScriptsLoaded = lpLoadScriptsInOrder([
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
    './api/supabase-client.js',
    './api/auth.js',
    './api/packs.js',
    './api/purchases.js',
  ]);
  return purchaseScriptsLoaded;
}

// Rendu du widget d'achat réel (Décision 5, étape 4) dans `el` — un des trois états : formulaire de
// connexion (magic link), bouton d'achat (prix lu depuis Postgres, jamais inventé côté client), ou
// "déjà acheté". Affiche aussi une bannière de retour Stripe (succès/annulation) une fois, puis
// nettoie l'URL pour ne pas la réafficher à un rechargement ultérieur.
async function renderRealPurchaseWidget(el, pack) {
  await loadPurchaseScripts();

  const params = new URLSearchParams(window.location.search);
  const purchaseStatus = params.get('purchase');
  if (purchaseStatus === 'success' || purchaseStatus === 'cancelled') {
    const banner = document.createElement('div');
    banner.className = 'purchase-banner ' + (purchaseStatus === 'success' ? 'ok' : 'cancelled');
    banner.textContent = purchaseStatus === 'success' ? tr('purchaseSuccessMsg') : tr('purchaseCancelledMsg');
    el.parentNode.insertBefore(banner, el);
    params.delete('purchase');
    const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState({}, '', newUrl);

    // Facture/attestation de vente (chantier 4 septembre) : générée de façon asynchrone dans le
    // webhook Stripe, jamais déjà prête à cet instant précis -- on sonde plutôt que de supposer
    // qu'elle est immédiatement disponible (même principe que bienvenue.html?subscribed=1).
    if (purchaseStatus === 'success') {
      const { session: buyerSession } = await window.LayerPitchAuth.getSession();
      if (buyerSession) {
        const invoiceMsg = document.createElement('div');
        invoiceMsg.className = 'purchase-msg';
        invoiceMsg.textContent = tr('invoicePreparingMsg');
        banner.appendChild(invoiceMsg);
        for (let attempt = 0; attempt < 10; attempt++) {
          const { purchases } = await window.LayerPitchPurchases.myPurchases();
          const match = (purchases || []).find(p => p.packId === pack.id && p.invoice);
          if (match) {
            invoiceMsg.innerHTML = '';
            const dlBtn = document.createElement('button');
            dlBtn.type = 'button';
            dlBtn.className = 'buy-btn';
            dlBtn.textContent = tr('downloadInvoiceBtn');
            dlBtn.addEventListener('click', async () => {
              dlBtn.disabled = true;
              const { data, error: fnError } = await window.LayerPitchSupabaseClient.getClient().functions.invoke('get-invoice-download-url', { body: { invoiceId: match.invoice.id } });
              if (fnError || !data || !data.url) {
                window.LayerPitchNotify.error(tr('purchaseErrorMsg').replace('{error}', fnError ? await window.LayerPitchAuth.describeFunctionError(fnError) : (data && data.error) || 'inconnue'));
              } else {
                window.open(data.url, '_blank', 'noopener');
              }
              dlBtn.disabled = false;
            });
            invoiceMsg.appendChild(dlBtn);
            break;
          }
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  const { pack: livePack, error: packError } = await window.LayerPitchPacks.getPack(pack.id);
  if (packError || !livePack || !livePack.buyable || !livePack.priceEurCents) {
    el.innerHTML = `<span class="buy-btn disabled">${tr('comingSoon')}</span><div class="buy-hint">${tr('notForSaleYet')}</div>`;
    return;
  }
  // Pack en vente : « Contacter le vendeur » (Shop, 29/09) — le message part vers le compositeur, jamais son adresse ne s'affiche.
  if (window.LayerPitchSellerContact) window.LayerPitchSellerContact.mount(document.getElementById('sellerContact'), { kind: 'pack', id: pack.id });
  // Tout en euros depuis le 28/09 (D30) ; format selon la langue de la page (« 10,00 € » / « €10.00 »).
  const priceLabel = new Intl.NumberFormat(currentLang() === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR' }).format(livePack.priceEurCents / 100);

  const { session } = await window.LayerPitchAuth.getSession();
  if (!session) {
    el.innerHTML = `
      <div class="purchase-signin">
        <div class="buy-hint">${tr('signInToBuyHint')}</div>
        <input type="email" id="purchaseSignInEmail" placeholder="${tr('signInToBuyEmailPlaceholder')}">
        <button class="buy-btn" id="purchaseSignInBtn" type="button">${tr('signInToBuySendBtn')}</button>
        <div class="purchase-msg" id="purchaseSignInMsg"></div>
      </div>`;
    el.querySelector('#purchaseSignInBtn').addEventListener('click', async () => {
      const email = el.querySelector('#purchaseSignInEmail').value.trim();
      const msg = el.querySelector('#purchaseSignInMsg');
      if (!email) return;
      msg.textContent = '…'; msg.className = 'purchase-msg';
      const { ok, error } = await window.LayerPitchAuth.signInWithMagicLink(email, window.location.href);
      msg.textContent = ok ? tr('signInToBuySentMsg') : tr('purchaseErrorMsg').replace('{error}', error);
      msg.className = 'purchase-msg ' + (ok ? 'ok' : 'err');
    });
    return;
  }

  const { purchases } = await window.LayerPitchPurchases.myPurchases();
  const alreadyOwned = (purchases || []).some(p => p.packId === pack.id);
  if (alreadyOwned) {
    el.innerHTML = `<span class="purchase-owned">${tr('alreadyOwned')}</span>`;
    return;
  }

  el.innerHTML = `<button class="buy-btn" id="realBuyBtn" type="button">${tr('buyBtn').replace('{price}', priceLabel)}</button><div class="purchase-msg" id="purchaseBuyMsg"></div>`;
  el.querySelector('#realBuyBtn').addEventListener('click', async () => {
    const btn = el.querySelector('#realBuyBtn');
    const msg = el.querySelector('#purchaseBuyMsg');
    btn.disabled = true;
    btn.textContent = tr('buyBtnLoading');
    const successUrl = window.location.origin + window.location.pathname + '?id=' + encodeURIComponent(pack.id) + '&purchase=success';
    const cancelUrl = window.location.origin + window.location.pathname + '?id=' + encodeURIComponent(pack.id) + '&purchase=cancelled';
    const { ok, error } = await window.LayerPitchPurchases.buyPack(pack.id, { successUrl, cancelUrl });
    if (!ok) {
      msg.textContent = tr('purchaseErrorMsg').replace('{error}', error);
      msg.className = 'purchase-msg err';
      btn.disabled = false;
      btn.textContent = tr('buyBtn').replace('{price}', priceLabel);
    }
    // Si ok, buyPack() a déjà redirigé la page vers Stripe Checkout — rien d'autre à faire ici.
  });
}

// Presets du palier Free (Chantier Apparence Phase 3, 4 septembre) -- copiés tel quel depuis
// layerpitch-backstage.html/index.html, même encodage, même logique. titleColor n'est pas utilisé ici
// (pack.html n'a qu'un seul --text, pas de --text-title séparé) mais reste dans l'objet pour rester
// identique aux 2 autres copies.
const THEME_PRESETS = [
  { id: 'default', labelKey: 'themePresetDefault', bgColor: '#FAFAF8', titleColor: '#1A1A1A', contentColor: '#333333', font: 'default', separator: { visible: true, color: '#E0E0DC', thickness: 1 } },
  { id: 'night', labelKey: 'themePresetNight', bgColor: '#121212', titleColor: '#FFFFFF', contentColor: '#C9C9CE', font: 'default', separator: { visible: true, color: '#3A3A40', thickness: 1 } },
  { id: 'amber', labelKey: 'themePresetAmber', bgColor: '#F5EDE0', titleColor: '#A85C1E', contentColor: '#5C4530', font: 'google:Fraunces', separator: { visible: true, color: '#C99A6B', thickness: 3 } },
  { id: 'neon', labelKey: 'themePresetNeon', bgColor: '#1B1035', titleColor: '#FF3EA5', contentColor: '#D9CFFF', font: 'google:Space Grotesk', separator: { visible: true, color: '#7A5FFF', thickness: 1 } },
  { id: 'forest', labelKey: 'themePresetForest', bgColor: '#16321F', titleColor: '#D4AF37', contentColor: '#EDE6D6', font: 'google:Zilla Slab', separator: { visible: true, color: '#8C7A3D', thickness: 1 } },
  { id: 'minimal', labelKey: 'themePresetMinimal', bgColor: '#FFFFFF', titleColor: '#000000', contentColor: '#4D4D4D', font: 'google:Manrope', separator: { visible: false, color: '#E0E0DC', thickness: 1 } }
];
