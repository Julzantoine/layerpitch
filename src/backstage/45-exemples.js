/* ---------------- Exemples préchargés (4/11) ----------------
 * Cadrage : layerpitch-docs/2026-11-04-exemples-precharges-et-profilage-cadrage.md ; base : migration 20261104020000.
 * Chaque compte reçoit UNE FOIS (feu vert example_content) une copie de 6 morceaux « Jazz +/- » et de 3 Sfx, rangés dans deux
 * dossiers « Exemples », plus un pack d'exemple et un AdReel « Démo » privé (accessMode 'example'). Une fiche d'exemple porte
 * exampleSourceId (id de la source). Ses fichiers son sont ceux de la source, PARTAGÉS par tous les comptes : jamais copiés,
 * jamais remplacés. D'où les garde-fous ci-dessous (doublés en base) :
 *   - pas de nouveau fichier son sur un morceau ou un Sfx d'exemple (filet sur les sélecteurs et dépôts de fichiers) ;
 *   - ni protection (set-track-protection déplace audio/<id>/), ni copie (copy-track-files copie audio/<id>/) ;
 *   - un exemple ne va que dans le pack ou l'AdReel d'exemple (tout autre pack/AdReel/collection est une page publique),
 *     jamais dans un album ; le pack et l'AdReel d'exemple n'ont pas de lien public, ne se vendent pas.
 * « Retirer les exemples » (bibliothèque) efface d'un coup les fiches (remove_my_examples), jamais les fichiers ; l'ajout ne se
 * refait pas ensuite (composer_profiles.examples_seeded_at). */
function isExample(o) { return !!(o && o.exampleSourceId); }
function currentAdReelObj() { return adReels.find(a => a.id === currentAdReelId) || null; }
// Choix proposés dans un sélecteur (morceaux, Sfx, packs) : sans les exemples, sauf là où ils sont permis.
function exampleChoices(list, allowExamples) { return allowExamples ? list : list.filter(x => !isExample(x)); }
function exampleBadgeHtml() { return `<span class="badge lp-example-badge" title="${escapeAttr(tr('exampleBadgeTitle'))}">${tr('exampleBadge')}</span>`; }
function hasAnyExample() {
  return library.some(isExample) || sfxLibrary.some(isExample) || packs.some(isExample) || adReels.some(isExample);
}

// Ajout au chargement : une seule tentative par ouverture de page ; le serveur décide (feu vert, déjà fait, langue).
// examplesSeedPromise : les questions de profil (46) attendent la fin de l'ajout, pour ne pas s'ouvrir avant son message.
var examplesSeedTried = false; // « var » : lu très tôt par fetchSiteData si la page démarre dans un état inattendu
var examplesSeedPromise = null;
function seedMyExamplesIfNeeded() {
  if (examplesSeedTried || isTutoMode()) return examplesSeedPromise || Promise.resolve();
  examplesSeedTried = true;
  examplesSeedPromise = seedMyExamplesNow();
  return examplesSeedPromise;
}
async function seedMyExamplesNow() {
  try {
    const { data, error } = await window.LayerPitchSupabaseClient.getClient().rpc('seed_my_examples', { p_lang: currentLang() });
    if (error) { console.warn('seed_my_examples() en erreur, aucun exemple ajouté :', error.message || error); return; }
    if (data && data.seeded) {
      log(tr('examplesSeededMsg'), 'ok');
      try { if (window.LayerPitchShell && window.LayerPitchShell.refreshInbox) await window.LayerPitchShell.refreshInbox(); } catch (e) { /* la cloche se met à jour d'elle-même */ }
    }
  } catch (e) { console.warn('seed_my_examples() injoignable :', e && e.message); }
}

// Problème bloquant avant une sauvegarde (null si tout va bien) : vérifié avant tout envoi de fichier ou écriture en base.
function hasPendingFileDeep(obj, seen) {
  if (!obj || typeof obj !== 'object') return false;
  seen = seen || new Set();
  if (seen.has(obj)) return false;
  seen.add(obj);
  if (obj.pendingFile) return true;
  return Object.keys(obj).some(k => k !== 'pendingFile' && hasPendingFileDeep(obj[k], seen));
}
function examplePublishProblem() {
  const name = o => (o && (o.title || o.label)) || (o && o.id) || '?';
  const exTrack = id => library.find(t => t.id === id && isExample(t));
  const exSfx = id => sfxLibrary.find(s => s.id === id && isExample(s));
  const exPack = id => packs.find(p => p.id === id && isExample(p));
  for (const t of library) if (isExample(t) && hasPendingFileDeep(t)) return tr('examplePublishFiles', { name: name(t) });
  for (const s of sfxLibrary) if (isExample(s) && hasPendingFileDeep(s.alternatives)) return tr('examplePublishFiles', { name: name(s) });
  const placed = (holder, found) => found ? tr('examplePublishPlacement', { item: name(holder), name: name(found) }) : null;
  for (const p of packs) {
    if (isExample(p)) continue;
    const msg = placed(p, (p.trackIds || []).map(exTrack).find(Boolean) || (p.sfxIds || []).map(exSfx).find(Boolean));
    if (msg) return msg;
  }
  for (const a of adReels) {
    if (isExample(a)) continue;
    const inBlocks = (a.blocks || []).map(b => (b.sfxIds || []).map(exSfx).find(Boolean) || (b.packIds || []).map(exPack).find(Boolean)).find(Boolean);
    const msg = placed(a, (a.trackIds || []).map(exTrack).find(Boolean) || inBlocks);
    if (msg) return msg;
  }
  for (const c of collections) {
    const msg = placed(c, (c.packIds || []).map(exPack).find(Boolean));
    if (msg) return msg;
  }
  for (const t of library) {
    if (isExample(t)) continue;
    const msg = placed(t, (t.sfxIds || []).map(exSfx).find(Boolean));
    if (msg) return msg;
  }
  return null;
}

// Filet anti-fichiers : sur une fiche d'exemple ([data-example], posé par renderLibrary/renderSfxLibrary), tout choix ou dépôt
// de fichier est arrêté avant d'atteindre le sélecteur (phase de capture), avec un message.
function exampleFileGuard(e) {
  const host = e.target && e.target.closest && e.target.closest('[data-example]');
  if (!host) return;
  if (e.type === 'click') {
    if (!e.target.closest('[data-role="pickBtn"], input[type="file"]')) return;
  } else if (!e.dataTransfer || ![...(e.dataTransfer.types || [])].includes('Files')) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.type !== 'dragover') window.LayerPitchNotify.error(tr(host.dataset.example === 'sfx' ? 'exampleNoFilesSfx' : 'exampleNoFiles'));
}
['libraryDetail', 'sfxLibraryDetail'].forEach(id => {
  const el = document.getElementById(id);
  if (el) ['click', 'dragover', 'drop'].forEach(type => el.addEventListener(type, exampleFileGuard, true));
});

// Bouton « Retirer les exemples » (bibliothèque) : visible tant qu'il reste un exemple.
function refreshExamplesUi() {
  const btn = document.getElementById('btnRemoveExamples');
  if (btn) btn.hidden = isTutoMode() || !hasAnyExample();
}
document.getElementById('btnRemoveExamples').addEventListener('click', async () => {
  const btn = document.getElementById('btnRemoveExamples');
  if (isTutoMode()) return;
  // Le retrait recharge la page : des changements non sauvegardés seraient perdus.
  if (hasUnsavedEdits) { window.LayerPitchNotify.info(tr('removeExamplesSaveFirst')); return; }
  if (!(await window.LayerPitchNotify.confirm(tr('removeExamplesConfirm'), { danger: true, okLabel: tr('removeExamplesBtn') }))) return;
  btn.disabled = true;
  try {
    await loadPostgresReadScripts();
    const { error } = await window.LayerPitchSupabaseClient.getClient().rpc('remove_my_examples');
    if (error) throw new Error(error.message || String(error));
    await loadData(true);
    window.LayerPitchNotify.info(tr('removeExamplesDone'));
  } catch (e) {
    window.LayerPitchNotify.error(tr('removeExamplesError', { error: e && e.message ? e.message : String(e) }));
  } finally {
    btn.disabled = false;
    refreshExamplesUi();
  }
});
