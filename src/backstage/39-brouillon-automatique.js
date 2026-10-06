/* ---------------- Brouillon automatique (27/09) ----------------
 * Avant : une modification non publiée (réglage, trigger, fichier choisi…) disparaissait au rechargement ou à un
 * plantage de l'onglet (seul un garde-fou « quitter la page ? » protégeait). Désormais, tant qu'il y a des
 * modifications non publiées, tout l'état de travail du Backstage est enregistré toutes les quelques secondes dans le
 * navigateur (IndexedDB : bibliothèque, Sfx, packs, collections, AdReels, polices, réglages, suppressions en attente)
 * -- fichiers pas encore publiés compris, rangés une seule fois chacun. Au chargement suivant, le Backstage propose
 * de reprendre ce brouillon. Publier ou recharger volontairement l'efface. Un brouillon par compte, dans ce
 * navigateur seulement (rien n'est envoyé au serveur). */
let loadedComposerId = null;   // compte dont le catalogue est chargé (clé du brouillon)
let loadedPublishedAt = null;  // date de publication du catalogue chargé (détecte une publication faite ailleurs entre-temps)
const DRAFT_DB_NAME = 'layerpitch-backstage-drafts';
const DRAFT_SAVE_EVERY_MS = 3000;
let draftDbPromise = null;
let draftDisabled = false;     // IndexedDB indisponible (navigation privée…) : on n'insiste pas
let draftDecisionPending = true; // pas d'écriture avant la décision « reprendre / ignorer » du chargement
let draftSaving = false, draftLastJson = null;
const draftFileIds = new WeakMap(); // fichier -> identifiant stable dans le brouillon (rangé une seule fois)
let draftFileSeq = 0;
function openDraftDb() {
  if (draftDbPromise) return draftDbPromise;
  draftDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DRAFT_DB_NAME, 1);
    req.onupgradeneeded = () => { const db = req.result; db.createObjectStore('drafts'); db.createObjectStore('files'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(e => { draftDisabled = true; log(tr('draftUnavailable'), 'warn'); throw e; });
  return draftDbPromise;
}
function draftTx(store, mode, fn) {
  return openDraftDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}
// État -> forme enregistrable : fichiers remplacés par une référence, Map/Set conservés, fonctions et nœuds du DOM
// ignorés (caches d'affichage).
function draftEncode(v, files) {
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (typeof Blob !== 'undefined' && v instanceof Blob) {
    let id = draftFileIds.get(v);
    if (!id) { id = 'f' + Date.now().toString(36) + '-' + (++draftFileSeq); draftFileIds.set(v, id); }
    files.set(id, v);
    return { __lpDraftFile: id };
  }
  if (typeof Node !== 'undefined' && v instanceof Node) return undefined;
  if (v instanceof Map) return { __lpDraftMap: [...v].map(([k, x]) => [k, draftEncode(x, files)]) };
  if (v instanceof Set) return { __lpDraftSet: [...v].map(x => draftEncode(x, files)) };
  if (Array.isArray(v)) return v.map(x => { const e = draftEncode(x, files); return e === undefined ? null : e; });
  const o = {};
  for (const k of Object.keys(v)) { const e = draftEncode(v[k], files); if (e !== undefined) o[k] = e; }
  return o;
}
function draftDecode(v, filesById) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => draftDecode(x, filesById));
  if ('__lpDraftFile' in v) { const f = filesById.get(v.__lpDraftFile) || null; if (f) draftFileIds.set(f, v.__lpDraftFile); return f; }
  if ('__lpDraftMap' in v) return new Map(v.__lpDraftMap.map(([k, x]) => [k, draftDecode(x, filesById)]));
  if ('__lpDraftSet' in v) return new Set(v.__lpDraftSet.map(x => draftDecode(x, filesById)));
  const o = {};
  for (const k of Object.keys(v)) o[k] = draftDecode(v[k], filesById);
  return o;
}
function draftState() {
  saveWorkingPendingIntoCurrent(); // fichiers en cours de l'AdReel affiché -> dans son AdReel
  return {
    library, libraryFolders, sfxLibrary, sfxFolders, socials, packs, collections, customFonts, adReels, adReelFolders,
    currentAdReelId, implementationSkills, noAiCertifiedGlobal, waveformStyle, seqMapTheme, allowEmbedding, sharePreview, sharePreviewPendingFile,
    pendingR2Deletes, pendingOrphanR2Keys,
  };
}
async function saveDraftNow() {
  if (draftDisabled || draftSaving || !loadedComposerId || !dataLoadOk || draftDecisionPending) return;
  draftSaving = true;
  try {
    const files = new Map();
    const state = draftEncode(draftState(), files);
    const json = JSON.stringify(state);
    if (json === draftLastJson) return; // rien n'a changé depuis le dernier enregistrement
    const prefix = loadedComposerId + ':';
    const known = new Set(await draftTx('files', 'readonly', st => st.getAllKeys()));
    // Fichiers : chacun rangé une seule fois ; ceux qui ne servent plus sont retirés.
    await draftTx('files', 'readwrite', st => {
      files.forEach((blob, id) => { if (!known.has(prefix + id)) st.put(blob, prefix + id); });
      known.forEach(k => { if (typeof k === 'string' && k.startsWith(prefix) && !files.has(k.slice(prefix.length))) st.delete(k); });
    });
    await draftTx('drafts', 'readwrite', st => st.put({ v: 1, savedAt: Date.now(), baselinePublishedAt: loadedPublishedAt, state: json }, loadedComposerId));
    draftLastJson = json;
  } catch (e) {
    if (!draftDisabled) log(tr('draftSaveFailed', { error: e && e.message ? e.message : String(e) }), 'warn');
  } finally { draftSaving = false; }
}
async function clearDraft() {
  draftLastJson = null;
  if (draftDisabled || !loadedComposerId) return;
  const prefix = loadedComposerId + ':';
  try {
    await draftTx('drafts', 'readwrite', st => st.delete(loadedComposerId));
    const keys = await draftTx('files', 'readonly', st => st.getAllKeys());
    await draftTx('files', 'readwrite', st => keys.forEach(k => { if (typeof k === 'string' && k.startsWith(prefix)) st.delete(k); }));
  } catch (e) { /* rien de grave : le brouillon sera réécrit ou reproposé */ }
}
// Au premier chargement : un brouillon de ce compte existe -> proposer de le reprendre.
async function offerDraftRestore() {
  try {
    if (!dataLoadOk || !loadedComposerId || typeof indexedDB === 'undefined') return;
    const draft = await draftTx('drafts', 'readonly', st => st.get(loadedComposerId));
    if (!draft || !draft.state) return;
    const when = new Date(draft.savedAt).toLocaleString(currentLang(), { dateStyle: 'short', timeStyle: 'short' });
    // Réglage « ne plus m'avertir » (30/09) : les brouillons retrouvés sont ignorés (supprimés) sans rien demander. Se règle dans
    // la fenêtre ci-dessous et dans Mon compte → Profil ; propre à ce navigateur, comme le brouillon lui-même.
    let autoIgnore = false;
    try { autoIgnore = localStorage.getItem('layerpitch_draft_auto_ignore') === '1'; } catch (e) { /* stockage indisponible : on demande */ }
    if (autoIgnore) { await clearDraft(); log(tr('draftAutoIgnored', { date: when }), 'info'); return; }
    const stale = draft.baselinePublishedAt !== loadedPublishedAt;
    const ok = await window.LayerPitchNotify.confirm(tr('draftRestoreConfirm', { date: when }) + (stale ? '\n\n' + tr('draftRestoreStale') : ''),
      { okLabel: tr('draftRestoreOk'), cancelLabel: tr('draftRestoreDiscard'), checkboxLabel: tr('draftRestoreNever'),
        // Cochée : retenue seulement avec « Ignorer » (reprendre un brouillon reste un choix fait à chaque fois).
        onFinish: (answer, checked) => { if (!answer && checked) { try { localStorage.setItem('layerpitch_draft_auto_ignore', '1'); } catch (e) { /* tant pis */ } } } });
    if (!ok) { await clearDraft(); return; }
    const prefix = loadedComposerId + ':';
    const filesById = new Map();
    await draftTx('files', 'readonly', st => {
      const req = st.openCursor();
      req.onsuccess = () => { const c = req.result; if (!c) return; if (typeof c.key === 'string' && c.key.startsWith(prefix)) filesById.set(c.key.slice(prefix.length), c.value); c.continue(); };
      return req;
    });
    applyDraftState(draftDecode(JSON.parse(draft.state), filesById));
    draftLastJson = draft.state;
    log(tr('draftRestored', { date: when }), 'ok');
  } catch (e) {
    log(tr('draftSaveFailed', { error: e && e.message ? e.message : String(e) }), 'warn');
  } finally {
    draftDecisionPending = false;
  }
}
function applyDraftState(d) {
  library = d.library || []; libraryFolders = d.libraryFolders || []; sfxLibrary = d.sfxLibrary || []; sfxFolders = d.sfxFolders || [];
  socials = d.socials || []; packs = d.packs || []; collections = d.collections || []; customFonts = d.customFonts || [];
  adReels = (d.adReels && d.adReels.length) ? d.adReels : adReels; adReelFolders = d.adReelFolders || [];
  implementationSkills = d.implementationSkills || implementationSkills; noAiCertifiedGlobal = !!d.noAiCertifiedGlobal;
  waveformStyle = d.waveformStyle || waveformStyle; seqMapTheme = d.seqMapTheme || seqMapTheme; allowEmbedding = !!d.allowEmbedding;
  sharePreview = Object.assign({}, DEFAULT_SHARE_PREVIEW, d.sharePreview || {}); sharePreviewPendingFile = d.sharePreviewPendingFile || null;
  pendingR2Deletes.clear(); (d.pendingR2Deletes || new Map()).forEach((v, k) => pendingR2Deletes.set(k, v));
  pendingOrphanR2Keys.clear(); (d.pendingOrphanR2Keys || new Set()).forEach(k => pendingOrphanR2Keys.add(k));
  currentAdReelId = adReels.some(a => a.id === d.currentAdReelId) ? d.currentAdReelId : adReels[0].id;
  const cur = adReels.find(a => a.id === currentAdReelId);
  blocks = cur.blocks; profile = cur.profile; testimonials = cur.testimonials; trackIds = cur.trackIds; trackOverrides = cur.trackOverrides || (cur.trackOverrides = {});
  logoPendingFile = cur.logoPendingFile || null; photoPendingFile = cur.photoPendingFile || null; themeBgImagePendingFile = cur.themeBgImagePendingFile || null;
  collapsedPackIds.clear(); packs.forEach(p => collapsedPackIds.add(p.id));
  collapsedCollectionIds.clear(); collections.forEach(c => collapsedCollectionIds.add(c.id));
  collapsedBlockIds.clear(); adReels.forEach(a => a.blocks.forEach(b => collapsedBlockIds.add(b.id)));
  renderLibrary(); renderSfxLibrary(); renderSocials(); renderPacks(); renderCollections(); renderAdReelSelect(); renderManageAdreels();
  fillAppearanceFields(); fillImplementationSkillsFields(); fillNoAiCertifiedGlobalField(); fillAllowEmbeddingField(); fillSharePreviewFields(); rebuildAllCards();
  hasUnsavedEdits = true; // rien de tout ça n'est publié : le garde-fou « quitter la page ? » reste actif
}
if (typeof indexedDB !== 'undefined') {
  setInterval(() => { if (hasUnsavedEdits) saveDraftNow(); }, DRAFT_SAVE_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && hasUnsavedEdits) saveDraftNow(); });
}

document.getElementById('btnPublish').addEventListener('click', publishAll);
document.getElementById('btnView').addEventListener('click', () => {
  // 24/09 : ne plus exiger owner/repo GitHub ici (signalé par Jules-Antoine : le bouton ne faisait RIEN sur
  // http://localhost, où ces champs -- gardés dans le stockage local de chaque adresse -- sont vides ; le message
  // « Renseigne owner / repo » n'allait que dans le journal, invisible). C'était aussi vrai pour tout compositeur
  // sans dépôt GitHub personnel, alors que computeAdReelUrl sait déjà retomber sur le lien public de son handle.
  const url = computeAdReelUrl(currentAdReelId);
  if (!url) { window.LayerPitchNotify.info(tr('adreelUrlPending')); return; }
  window.open(url, '_blank');
});


