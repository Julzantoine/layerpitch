/* ---------------- Visites de section (14/11, feu vert « section_tours », admin seulement jusqu'à ouverture) ----------------
 * À la PREMIÈRE arrivée dans une section (Contenu, Apparence, Bibliothèque, Sfx, Packs, Analytics), une vraie bulle propose une
 * mini-visite : 2 ou 3 zones clés, puis une dernière bulle à choix — « explorer l'exemple » (morceau, Sfx, pack ou AdReel d'exemple
 * préchargé) ou « suivre le tutoriel » (la leçon de la section) — qui rappelle que l'Accueil garde toutes les infos. Même moteur de
 * bulles que la visite générale (43-visite-guidee.js), mais une mini-visite ne compte JAMAIS comme « visite générale faite ».
 * Mémoire de ce qui a été proposé : sur le compte (profiles.home_prefs.section_tours_seen, migration 20261114010000) avec repli sur ce
 * navigateur. Une section est notée « vue » dès qu'elle est proposée (passer la bulle = ne plus la proposer).
 * Jamais en mode tutoriel (?tuto, compte fictif), jamais pendant une visite ou une leçon. La page Projet a la sienne (projet-lecons.js). */
const SECTION_TOURS_LOCAL = 'lp_section_tours_seen_v1';
// Par onglet : `zones` = [sélecteur, préfixe de texte] (ignorées si absentes de l'écran), `lesson` = leçon suivie, `example` = action « explorer l'exemple ».
const SECTION_TOURS = {
  content: { key: 'stContent', lesson: 'adreel-intro', example: 'adreel', zones: [['.add-block-row', 'Add'], ['#btnPublish', 'Publish']] },
  appearance: { key: 'stAppearance', lesson: 'appearance', example: 'adreel', zones: [['#appLang', 'Lang'], ['#appSlug', 'Slug'], ['#appAccessMode', 'Access']] },
  library: { key: 'stLibrary', lesson: 'static', example: 'library', zones: [['#btnAddLibraryTrack', 'Add'], ['#libraryMaster', 'List']] },
  sfxLibrary: { key: 'stSfx', lesson: 'sfx', example: 'sfx', zones: [['#btnAddSfx', 'Add'], ['#sfxLibraryMaster', 'List']] },
  packs: { key: 'stPacks', lesson: 'pack', example: 'pack', zones: [['#btnAddPack', 'Add'], ['#packsContainer', 'List']] },
  analytics: { key: 'stAnalytics', lesson: 'tracking', zones: [['#analyticsPresets', 'Period']] },
};
let sectionTourOpen = false; // vrai pendant une mini-visite : la fermeture ne vaut pas « visite générale faite » (voir onTourDone)
function sectionToursOpen() { return !isTutoMode() && flagOpen('section_tours'); }
function sectionToursSeen() {
  let local = [];
  try { local = JSON.parse(localStorage.getItem(SECTION_TOURS_LOCAL) || '[]') || []; } catch (e) { /* stockage indisponible */ }
  const account = (typeof homePrefs !== 'undefined' && homePrefs && Array.isArray(homePrefs.section_tours_seen)) ? homePrefs.section_tours_seen : [];
  return [...new Set([...local, ...account])];
}
function sectionTourMarkSeen(tab) {
  const seen = sectionToursSeen();
  if (seen.includes(tab)) return;
  seen.push(tab);
  try { localStorage.setItem(SECTION_TOURS_LOCAL, JSON.stringify(seen)); } catch (e) { /* stockage indisponible */ }
  // Jamais bloquant : si le compte est injoignable, la mémoire de ce navigateur suffit.
  try { if (typeof homeSavePrefs === 'function') Promise.resolve(homeSavePrefs({ section_tours_seen: seen })).catch(() => {}); } catch (e) { /* idem */ }
}
// « Explorer l'exemple » : ouvre l'élément d'exemple préchargé de la section (le choix n'est proposé que s'il existe encore).
function sectionTourExample(kind) {
  if (kind === 'library') return library.find(isExample) || null;
  if (kind === 'sfx') return sfxLibrary.find(isExample) || null;
  if (kind === 'pack') return packs.find(isExample) || null;
  if (kind === 'adreel') return adReels.find(isExample) || null;
  return null;
}
function sectionTourRunExample(kind) {
  const ex = sectionTourExample(kind);
  if (!ex) return;
  if (kind === 'library') { manageLibrarySelectedId = ex.id; renderLibrary(); }
  else if (kind === 'sfx') { manageSfxSelectedId = ex.id; renderSfxLibrary(); }
  else if (kind === 'pack') {
    collapsedPackIds.delete(ex.id); renderPacks();
    const idx = packs.findIndex(p => p.id === ex.id);
    const el = document.querySelectorAll('#packsContainer > .list-block')[idx];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } else if (kind === 'adreel') { if (currentAdReelId !== ex.id) switchAdReel(ex.id); }
}
function sectionTourSteps(tab) {
  const def = SECTION_TOURS[tab];
  if (!def) return null;
  const steps = [{ titleKey: def.key + 'Title', textKey: def.key + 'Text' }];
  def.zones.forEach(([selector, name]) => {
    const el = document.querySelector(selector);
    if (el && tourTargetVisible(el)) steps.push({ selector, titleKey: def.key + name + 'Title', textKey: def.key + name + 'Text' });
  });
  const lesson = LESSONS.find(l => l.id === def.lesson);
  const choices = [];
  if (def.example && sectionTourExample(def.example)) choices.push({ labelKey: def.key + 'Explore', action: 'example:' + def.example });
  if (lessonsAccessOpen() && lesson && lessonPlayable(lesson) && !lesson.soon && !(lesson.needs && !flagOpen(lesson.needs))) choices.push({ labelKey: 'stLearn', lesson: def.lesson });
  steps.push({ titleKey: 'stEndTitle', textKey: homeOpen() ? 'stEndTextHome' : 'stEndText', ...(choices.length ? { choices } : {}) });
  return steps;
}
function maybeOfferSectionTour(tab) {
  if (!SECTION_TOURS[tab] || !sectionToursOpen() || guide || sectionToursSeen().includes(tab)) return;
  // Laisse l'onglet se dessiner (listes, boutons) avant de viser ses zones ; si la personne est déjà repartie ailleurs, on n'ouvre rien.
  setTimeout(() => {
    const active = document.querySelector('.backstage-panel.active');
    if (guide || !active || active.dataset.panel !== tab || sectionToursSeen().includes(tab)) return;
    const steps = sectionTourSteps(tab);
    if (!steps) return;
    sectionTourMarkSeen(tab);
    sectionTourOpen = true;
    openGuide('tour', steps, 'section:' + tab);
  }, 700);
}
