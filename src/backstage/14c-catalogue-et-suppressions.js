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

