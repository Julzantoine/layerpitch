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
// Aperçu des liens partagés (1er/10, rubrique Réseaux sociaux) : titre, description et image de la carte qu'affichent LinkedIn,
// Facebook, WhatsApp… quand on colle un lien. image = chemin sous images/ (publié) ; le fichier choisi attend la publication.
const DEFAULT_SHARE_PREVIEW = { title: '', description: '', image: null, imageOriginalName: null };
let sharePreview = Object.assign({}, DEFAULT_SHARE_PREVIEW);
let sharePreviewPendingFile = null;
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
