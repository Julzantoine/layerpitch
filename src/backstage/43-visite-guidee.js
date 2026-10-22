/* ---------------- Visite guidée et leçons guidées du Backstage (08/10) ---------------- */
// Un seul moteur de bulles, deux usages : le tour du propriétaire (étapes manuelles : « Suivant ») et les leçons (étapes
// qui avancent toutes seules quand l'apprenant fait le geste demandé). Feu vert « in_app_tour » (visite) et « in_app_lessons » (leçons), admin seulement pour
// l'instant. Menu « Tutoriel » (leçons) dans la barre du haut, à côté de la cloche et du compte : feu vert séparé « in_app_lessons ».
const TOUR_DONE_STORAGE = 'layerpitch_tour_done_v1';
const LESSONS_DONE_STORAGE = 'layerpitch_lessons_done_v1';
const TOUR_STEPS = [
  { titleKey: 'tourWelcomeTitle', textKey: 'tourWelcomeText' },
  { selector: '.nav-item[data-tab="library"]', titleKey: 'tourLibraryTitle', textKey: 'tourLibraryText' },
  { selector: '.nav-item[data-tab="content"]', titleKey: 'tourContentTitle', textKey: 'tourContentText' },
  { selector: '.nav-item[data-tab="appearance"]', titleKey: 'tourAppearanceTitle', textKey: 'tourAppearanceText' },
  { selector: '.nav-item[data-tab="packs"]', titleKey: 'tourPacksTitle', textKey: 'tourPacksText' },
  { selector: '#btnPublish', titleKey: 'tourPublishTitle', textKey: 'tourPublishText' },
  { selector: '#btnAccountMenu', titleKey: 'tourAccountTitle', textKey: 'tourAccountText' },
];

// Morceau en cours d'édition dans la Bibliothèque musicale (celui sélectionné dans la liste).
// Pool « basse » du morceau de la leçon aléatoire (compresseur, 22/10) : son rang dans la section, et ses éléments dans l'éditeur.
function lessonBassPoolIndex() { const sec = lessonSection(); return sec ? (sec.pools || []).findIndex(p => /\bBS$/i.test((p.label || '').trim())) : -1; }
function lessonBassFxToggle() { const i = lessonBassPoolIndex(); return i < 0 ? null : document.querySelector(`#libraryDetail [data-role="fxBlockToggle"][data-fx-key*='data-fx-target="pool"'][data-fx-key*='data-pi="${i}"']`); }
function lessonBassCompressorCheckbox() { const i = lessonBassPoolIndex(); return i < 0 ? null : document.querySelector(`#libraryDetail input[data-fx-effect="compressor"][data-fx-param="enabled"][data-fx-target="pool"][data-pi="${i}"]`); }
function lessonBassCompressor() { const sec = lessonSection(); const p = sec && sec.pools && sec.pools[lessonBassPoolIndex()]; return (p && p.fx && p.fx.compressor) || null; }
function lessonSection() { const t = lessonTrack(); return (t && t.sections && t.sections[0]) || null; }
function lessonPoolFiles(i) { const sec = lessonSection(); const p = sec && sec.pools && sec.pools[i]; return p ? (p.alternatives || []).filter(a => a.pendingFile || a.remoteFile).length : 0; }
// Point d'accès unique aux leçons : aujourd'hui le feu vert « in_app_lessons ». Une future version publique (mode démo,
// sans compte) n'aura qu'à répondre « oui » ici, sans toucher aux leçons.
function lessonsAccessOpen() { return flagOpen('in_app_lessons'); }
// Mode tutoriel (?tuto) en version publique : seules les leçons « publiques » sont jouables, les autres restent visibles
// avec la mention « le tuto complet nécessite un compte ». Un admin (tutoFullAccess) a tout.
function lessonPlayable(lesson) { return !isTutoMode() || tutoFullAccess || lessonIsPublic(lesson); }
// URL de chaque fichier d'exemple (nom de fichier -> URL), à renseigner quand les fichiers seront en ligne (stockage
// des médias, avec CORS ouvert à l'origine du Backstage). Tant qu'un nom manque, le bouton « Utiliser » n'apparaît pas.
const LESSON_SAMPLE_URLS = {
};
// Leçons « Jazz » (21/10) : morceaux de Jules-Antoine, 110 BPM. Chaque dossier du Bureau est déposé tel quel dans `tuto/`
// (media.layerpitch.com/tuto/<dossier>/<fichier>) : l'adresse est encodée, les espaces des noms n'y gênent pas. Le nom du fichier
// est celui que l'apprenant voit et que le moteur lit (tempo, mesures).
const LESSON_SAMPLE_FOLDERS = {
  // Leçon Sfx : trois bruits de glaçons et deux de verre qui se remplit (Jules-Antoine).
  'SFX': ['Glaçons 1.wav', 'Glaçons 2.wav', 'Glaçons 3.wav', 'Verre 1.wav', 'Verre 2.wav', 'AMBRest_Ambiance de bar 2 (ID 0481)_LaSonotheque.fr.wav'],
  // Statique : une boucle de 8 mesures, sans intro (leçon d'entrée : le moteur place tout seul les repères).
  'Jazz Lo': ['Jazz Lo_No Intro_110bpm.wav'],
  // Embranchement vertical : deux boucles de 8 mesures précédées d'une intro d'une mesure (« _Intro1M_9M » : le moteur lit tout).
  'Jazz Hi-Lo Vert. Branch.': ['Jazz Lo_Intro1M_9M_110bpm.wav', 'Jazz Hi_Intro1M_9M_110bpm.wav'],
  // Couches additives : trois couches (cordes, batterie, clavier), même durée.
  'Jazz Hi Lay. Add.': ['Jazz Hi CB Only_2bts intro_8M_110bpm.wav', 'Jazz Hi Drum Only_2bts intro_8M_110bpm.wav', 'Jazz Hi KB Only_2bts intro_8M_110bpm.wav'],
  // Aléatoire : une intro de 2 temps et trois pools de variantes de 4 mesures (BS, DM, KB), déposés d'un coup sur la section.
  'Jazz Lo Vert. Rand.': ['Jazz Lo 2bts IntroONLY_110bpm.wav', 'Jazz Lo BS_Dirty South Blender_4M_110bpm.wav', 'Jazz Lo BS_Fog Machine_4M_110bpm.wav', 'Jazz Lo BS_Stories Told_4M_110bpm.wav', 'Jazz Lo BS_Straight Up_4M_110bpm.wav', 'Jazz Lo BS_Sweet Summer_4M_110bpm.wav', 'Jazz Lo BS_Walking Strong_4M_110bpm.wav', 'Jazz Lo DM_DirtRoad 1_4M_110bpm.wav', 'Jazz Lo DM_DirtRoad 2_4M_110bpm.wav', 'Jazz Lo DM_DirtRoad 3_4M_110bpm.wav', 'Jazz Lo KB_Carry On_4M_110bpm.wav', 'Jazz Lo KB_Fluid Chords_4M_110bpm.wav', 'Jazz Lo KB_Journey\'s End_4M_110bpm.wav', 'Jazz Lo KB_Perpetual Sunrise_4M_110bpm.wav', 'Jazz Lo KB_Simply Said_4M_110bpm.wav', 'Jazz Lo KB_The Feels_4M_110bpm.wav'],
  // Séquentiel (sections aléatoires) : intro de 2 temps, deux sections de 4 mesures (4 alternatives chacune, « Alt1.1 » à « Alt2.4 »), outro de 4 mesures.
  'Jazz Hi Seq. Rand.': ['Jazz Hi Intro 2bts.wav', 'Jazz Hi Alt1.1_4M_110bpm.wav', 'Jazz Hi Alt1.2_4M_110bpm.wav', 'Jazz Hi Alt1.3_4M_110bpm.wav', 'Jazz Hi Alt1.4_4M_110bpm.wav', 'Jazz Hi Alt2.1_4M_110bpm.wav', 'Jazz Hi Alt2.2_4M_110bpm.wav', 'Jazz Hi Alt2.3_4M_110bpm.wav', 'Jazz Hi Alt2.4_4M_110bpm.wav', 'Jazz Hi Outro_4M.wav'],
  // Séquentiel à embranchement : trois « villes » de 4 mesures, et une transition d'une mesure par ville d'arrivée.
  'Jazz Hi Seq. Branch.': ['Jazz Hi_Jazz City_4M_110bpm.wav', 'Jazz Hi Jazz City.2_4M_110bpm.wav', 'Jazz Hi_Rock City_4M_110bpm.wav', 'Jazz Hi_Disco City_4M_110bpm.wav', 'Jazz Hi_Synth city_4M_110bpm.wav',
    'Jazz Hi_Trans Rock City_1M.wav', 'Jazz Hi_Trans Jazz City_1M.wav', 'Jazz Hi_Trans Disco City_1M.wav', 'Jazz Hi_Trans Synth City_1M.wav'],
};
Object.keys(LESSON_SAMPLE_FOLDERS).forEach(dir => LESSON_SAMPLE_FOLDERS[dir].forEach(n => {
  LESSON_SAMPLE_URLS[n] = 'https://media.layerpitch.com/tuto/' + encodeURIComponent(dir) + '/' + encodeURIComponent(n);
}));
function lessonStepFileNames(step) {
  const names = LESSON_SAMPLE_NAMES[step.names || (guide && guide.lessonId)] || '';
  return names.split(',').map(x => x.trim()).filter(Boolean);
}
function lessonSampleReady(step) {
  const names = lessonStepFileNames(step);
  return !!step.useSample && names.length > 0 && names.every(n => LESSON_SAMPLE_URLS[n]);
}
// Dépose les fichiers d'exemple sur la zone en surbrillance, comme si l'apprenant les y avait glissés : un événement
// « drop » transportant de vrais objets File, traité par les mêmes gestionnaires que les dépôts réels.
// Indique dans la bulle que le chargement des fichiers d'exemple est en cours (ils sont lourds, la connexion peut être
// lente) : sans cela, rien ne bouge pendant le téléchargement.
function lessonShowLoading(done, total, pct) {
  if (!guide) return;
  const card = guide.root.querySelector('.tour-card');
  if (!card) return;
  let el = card.querySelector('.tour-loading');
  if (done == null) { if (el) el.remove(); const chip = card.querySelector('.tour-chip'); if (chip) chip.style.opacity = ''; return; }
  if (!el) {
    el = document.createElement('div');
    el.className = 'tour-waiting tour-loading';
    const actions = card.querySelector('.tour-actions');
    card.insertBefore(el, actions);
  }
  const chip = card.querySelector('.tour-chip'); if (chip) chip.style.opacity = '0.45';
  el.textContent = tr('lessonSampleLoading', { done, total, pct });
}
async function lessonUseSample(step) {
  const target = guideStepTarget(step);
  if (!target) throw new Error('zone introuvable');
  if (typeof DataTransfer === 'undefined' || typeof DragEvent === 'undefined') throw new Error('dépôt non pris en charge par ce navigateur');
  if (guide && guide.sampleLoading) return; // un chargement est déjà en cours
  if (guide) guide.sampleLoading = true;
  const dt = new DataTransfer();
  try {
    const names = lessonStepFileNames(step);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      lessonShowLoading(i + 1, names.length, 0);
      // Connexion lente ou coupée (« Content-Length header of network response exceeds response Body » sous Firefox) :
      // on reprend le téléchargement là où il s'est arrêté (requête Range), jusqu'à 6 tentatives.
      const chunks = [];
      let got = 0, total = 0, mime = 'audio/wav';
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(LESSON_SAMPLE_URLS[name], got > 0 ? { headers: { Range: 'bytes=' + got + '-' } } : undefined);
          if (!res.ok) throw new Error(name + ' : ' + res.status);
          const hdr = n => (res.headers && res.headers.get ? res.headers.get(n) : null);
          if (got > 0 && res.status !== 206) { chunks.length = 0; got = 0; } // le serveur renvoie tout : on repart de zéro
          const cr = /\/(\d+)$/.exec(hdr('content-range') || '');
          total = cr ? Number(cr[1]) : (got === 0 ? Number(hdr('content-length')) || 0 : total);
          mime = hdr('content-type') || mime;
          if (res.body && res.body.getReader) {
            const reader = res.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value); got += value.length;
              lessonShowLoading(i + 1, names.length, total ? Math.min(100, Math.round(100 * got / total)) : 0);
            }
          } else {
            const b = await res.blob();
            chunks.push(b); got += b.size;
          }
          if (!total || got >= total) break;
          throw new Error('transfert incomplet');
        } catch (err) {
          if (attempt >= 5) throw err;
          await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      const blob = new Blob(chunks, { type: mime });
      dt.items.add(new File([blob], name, { type: blob.type || 'audio/wav' }));
    }
  } finally {
    if (guide) guide.sampleLoading = false;
    lessonShowLoading(null);
  }
  const zone = target.querySelector('.file-ctrl') || target;
  const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
  if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length === dt.files.length) { zone.dispatchEvent(ev); return; }
  // Navigateur qui ne transmet pas le DataTransfer dans un DragEvent construit : repli par le sélecteur de fichier de la
  // zone (même gestionnaire « change » que si l'apprenant avait choisi le fichier à la main).
  const input = target.querySelector('input[type="file"]');
  if (!input) throw new Error('dépôt non pris en charge par ce navigateur');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
// Glisser-déposer simulé par la page (fiable sous tous les navigateurs) : une vignette suit la souris, la zone en
// surbrillance réagit au survol, et le relâchement sur la zone dépose les fichiers d'exemple (même chemin que le bouton).
function lessonPointInZone(step, x, y) {
  const el = guideStepTarget(step);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const m = 6;
  return x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m;
}
function lessonStartChipDrag(ev, step, chip) {
  if (ev.button !== undefined && ev.button !== 0) return;
  ev.preventDefault();
  const ghost = chip.cloneNode(true);
  ghost.classList.add('tour-chip-ghost');
  ghost.removeAttribute('data-tour');
  document.body.appendChild(ghost);
  const place = (x, y) => { ghost.style.left = (x + 12) + 'px'; ghost.style.top = (y + 12) + 'px'; };
  place(ev.clientX, ev.clientY);
  chip.classList.add('is-dragging');
  const spot = guide && guide.root.querySelector('.tour-spot');
  const target = guideStepTarget(step);
  const hot = on => { if (spot) spot.classList.toggle('tour-spot-hot', on); if (target) target.classList.toggle('drag-over', on); };
  const move = e => { place(e.clientX, e.clientY); hot(lessonPointInZone(step, e.clientX, e.clientY)); };
  const finish = e => {
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', finish, true);
    document.removeEventListener('pointercancel', finish, true);
    ghost.remove(); chip.classList.remove('is-dragging'); hot(false);
    if (e.type !== 'pointercancel' && lessonPointInZone(step, e.clientX, e.clientY)) {
      lessonUseSample(step).catch(err => window.LayerPitchNotify.error(tr('lessonSampleError', { error: err.message || String(err) })));
    }
  };
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', finish, true);
  document.addEventListener('pointercancel', finish, true);
}
// Point de la timeline (écran) où commence la mesure `bar` : même échelle que buildLoopTimelineEl (durée / temps).
function lessonArrowPoint(bar) {
  const t = lessonTrack();
  const ruler = document.querySelector('#libraryDetail .loop-timeline-ruler');
  if (!t || !ruler || !t.duration) return null;
  const bpm = t.bpm || 120, bpb = t.beatsPerBar || 4;
  const total = Math.max(1, Math.round(t.duration / (60 / bpm)));
  const beat = (bar - 1) * bpb;
  if (beat < 0 || beat > total) return null;
  const r = ruler.getBoundingClientRect();
  if (!r.width) return null;
  return { x: r.left + r.width * beat / total, y: r.top };
}
// Fenêtre de dépôt groupé de la section : la case « + piste vide » du pool dont le nom commence par `label`.
function lessonDialogPoolSilent(label) {
  const g = [...document.querySelectorAll('.vrs-batch-modal .vrs-batch-group')].find(x => { const i = x.querySelector('[data-vbd-group-label]'); return i && i.value.trim().toLowerCase() === label.toLowerCase(); });
  return g ? g.querySelector('[data-vbd-group-silent]') : null;
}
function lessonPoolHasSilence(label) {
  const sec = lessonSection(); const p = sec && (sec.pools || []).find(x => (x.label || '').trim().toLowerCase() === label.toLowerCase());
  return !!p && (p.alternatives || []).some(a => !(a.pendingFile || a.remoteFile));
}
function fxSliderExists() { const t = lessonTrack(); return !!t && (t.fxSliders || []).length >= 1; }
function lessonHasFile(x) { return !!(x && (x.pendingFile || x.remoteFile)); }
function lessonSelectTrackInfo() { const t = lessonTrack(); if (t && seqSelectedSlotIndex.get(t.id) !== 'trackinfo') { seqSelectedSlotIndex.set(t.id, 'trackinfo'); renderLibrary(); } }
// Leçon Sfx (22/10) : les deux Sfx de la bibliothèque (Glaçons, puis le verre) et leur espace, tels que Jules-Antoine les a réglés dans « Jazz Lo Static +SFX ».
function lessonSfx(i) { return (typeof sfxLibrary !== 'undefined' && sfxLibrary[i]) || null; }
function lessonSfxSpace(i) { const x = lessonSfx(i); return (x && x.spatial) || null; }
function lessonSfxEntryOpen(i, entry) { const x = lessonSfx(i); return !!x && sfxSelectedEntry.get(x.id) === entry; }
function lessonSfxBatchOpen() { return !!document.querySelector('.vrs-batch-modal [data-vbd="confirm"]'); }
function lessonSfxGroupName() { const el = document.querySelector('.vrs-batch-modal [data-vbd-group-label]'); return el ? el.value.trim().toLowerCase() : ''; }
// Leçon « Les événements d'effets » (22/10) : le morceau « Jazz Lo Static +FX » de Jules-Antoine, deux événements (un groupe dans un coin du bar, une radio).
function lessonTrigger(i) { const t = lessonTrack(); return (t && t.fxTriggers && t.fxTriggers[i]) || null; }
function lessonFxToggle(i, effect) { return document.querySelector(`#libraryDetail input[data-fx-target="trigger"][data-tri="${i}"][data-fx-effect="${effect}"][data-fx-param="enabled"]`); }
function lessonFxBox(i, effect) { const c = lessonFxToggle(i, effect); return c ? c.closest('label').parentElement : null; } // l'effet en entier : case à cocher + réglages
function lessonFxValue(i, effect, param) { const t = lessonTrigger(i); return t && t.fx && t.fx[effect] ? t.fx[effect][param] : undefined; }
function lessonEventsSection() { const t = lessonTrack(); return t ? document.querySelector(`#libraryDetail details[data-fxt-section-key="${t.id}"] > summary`) : null; }
function lessonSlotFirstName(i) { const t = lessonTrack(); const sl = t && t.segmentSlots && t.segmentSlots[i]; const al = sl && (sl.alternatives || []).find(lessonHasFile); return al ? ((al.pendingFile && al.pendingFile.name) || al.remoteFile || '') : ''; }
function lessonSlotFileCount(i) { const t = lessonTrack(); const sl = t && t.segmentSlots && t.segmentSlots[i]; return sl ? (sl.alternatives || []).filter(lessonHasFile).length : 0; }
function lessonSlot(i) { const t = lessonTrack(); return (t && t.segmentSlots && t.segmentSlots[i]) || null; }
function lessonLoopFileCount() { const t = lessonTrack(); return t ? (t.loops || []).filter(lessonHasFile).length : 0; }
// Raccourci « Importer un dossier » (fin de la leçon d'embranchement) : joué seulement si le feu vert est ouvert ET si le dossier d'exemple est en ligne.
function lessonImportSkipped() { return !flagOpen('bulk_drop') || !lessonSampleReady({ useSample: true, names: 'import' }); }
function lessonFolderDialogOpen() { return !!document.querySelector('.vrs-batch-modal [data-fi="mode"]'); }
function lessonDialogText() { const m = document.querySelector('.vrs-batch-modal'); return m ? m.textContent : ''; }
function lessonTrack() { return (typeof library !== 'undefined' && library.find(t => t.id === manageLibrarySelectedId)) || null; }
// Fichiers d'exemple de chaque leçon : null tant qu'ils n'existent pas (la bulle dit alors « bientôt disponible »).
const LESSON_SAMPLE_FILES = { static: null, additive: null, random: null, sequential: null, branching: null, embranchement: null, import: null };
// Nom du fichier d'exemple cité dans la consigne de dépôt (il porte le tempo : ambiance_120bpm).
const LESSON_SAMPLE_NAMES = {
  static: 'Jazz Lo_No Intro_110bpm.wav',
  additive: 'Jazz Hi CB Only_2bts intro_8M_110bpm.wav, Jazz Hi Drum Only_2bts intro_8M_110bpm.wav, Jazz Hi KB Only_2bts intro_8M_110bpm.wav',
  randAll: 'Jazz Lo 2bts IntroONLY_110bpm.wav, Jazz Lo BS_Dirty South Blender_4M_110bpm.wav, Jazz Lo BS_Fog Machine_4M_110bpm.wav, Jazz Lo BS_Stories Told_4M_110bpm.wav, Jazz Lo BS_Straight Up_4M_110bpm.wav, Jazz Lo BS_Sweet Summer_4M_110bpm.wav, Jazz Lo BS_Walking Strong_4M_110bpm.wav, Jazz Lo DM_DirtRoad 1_4M_110bpm.wav, Jazz Lo DM_DirtRoad 2_4M_110bpm.wav, Jazz Lo DM_DirtRoad 3_4M_110bpm.wav, Jazz Lo KB_Carry On_4M_110bpm.wav, Jazz Lo KB_Fluid Chords_4M_110bpm.wav, Jazz Lo KB_Journey\'s End_4M_110bpm.wav, Jazz Lo KB_Perpetual Sunrise_4M_110bpm.wav, Jazz Lo KB_Simply Said_4M_110bpm.wav, Jazz Lo KB_The Feels_4M_110bpm.wav',
  seqIntro: 'Jazz Hi Intro 2bts.wav',
  seqAlt1: 'Jazz Hi Alt1.1_4M_110bpm.wav, Jazz Hi Alt1.2_4M_110bpm.wav, Jazz Hi Alt1.3_4M_110bpm.wav, Jazz Hi Alt1.4_4M_110bpm.wav',
  seqAlt2: 'Jazz Hi Alt2.1_4M_110bpm.wav, Jazz Hi Alt2.2_4M_110bpm.wav, Jazz Hi Alt2.3_4M_110bpm.wav, Jazz Hi Alt2.4_4M_110bpm.wav',
  seqAlt3: 'Jazz Hi Alt3_4M_110bpm.wav',
  seqAlt4: 'Jazz Hi Alt4_4M_110bpm.wav',
  seqOutro: 'Jazz Hi Outro_4M.wav',
  cityRock: 'Jazz Hi_Rock City_4M_110bpm.wav',
  sfxIce: 'Glaçons 1.wav, Glaçons 2.wav, Glaçons 3.wav',
  sfxGlass: 'Verre 1.wav, Verre 2.wav',
  sfxBar: 'AMBRest_Ambiance de bar 2 (ID 0481)_LaSonotheque.fr.wav',
  cityDisco: 'Jazz Hi_Disco City_4M_110bpm.wav',
  cityJazz: 'Jazz Hi_Jazz City_4M_110bpm.wav, Jazz Hi Jazz City.2_4M_110bpm.wav',
  citySynth: 'Jazz Hi_Synth city_4M_110bpm.wav',
  transDisco: 'Jazz Hi_Trans Disco City_1M.wav',
  transRock: 'Jazz Hi_Trans Rock City_1M.wav',
  transJazz: 'Jazz Hi_Trans Jazz City_1M.wav',
  transSynth: 'Jazz Hi_Trans Synth City_1M.wav',
  embrLoops: 'Jazz Lo_Intro1M_9M_110bpm.wav, Jazz Hi_Intro1M_9M_110bpm.wav',
  embrDetour: 'detour_120bpm_4M.wav',
  import: 'Tuto séquentiel - raccourci',
};
// La boucle de détour de la leçon d'embranchement n'est montrée que lorsque son fichier d'exemple est en ligne.
function lessonDetourReady() { return lessonStepFileNames({ names: 'embrDetour' }).every(n => !!LESSON_SAMPLE_URLS[n]); }
// done(ctx) : true quand le geste est fait -> la leçon avance seule. clickDone : un clic sur la cible suffit.
// Sans done ni clickDone : étape manuelle (« Suivant »). enter(ctx) : photographie l'état à l'arrivée sur l'étape.
// Nettoyage commun à toutes les leçons (Backstage des compositeurs) : le morceau d'essai est supprimé, puis la
// suppression est sauvegardée (une suppression n'est définitive qu'une fois sauvegardée). « Garder ce morceau » existe.
// Absentes d'une éventuelle version publique sans compte : rien n'y est jamais enregistré.
// Après un dépôt de plusieurs fichiers dont les noms portent le tempo / la longueur (« _120bpm », « _64M »), le moteur
// ouvre une petite fenêtre de confirmation : la leçon la met en surbrillance et attend le clic sur « Appliquer ».
// Sans fenêtre (rien à proposer, ou fonction fermée) l'étape est sautée.
const HINTS_DIALOG_STEP = { selector: '.vrs-batch-overlay .vrs-batch-modal', titleKey: 'lsHintsTitle', textKey: 'lsHintsText',
  skip: () => !document.querySelector('.vrs-batch-overlay'),
  done: () => !document.querySelector('.vrs-batch-overlay'),
  onBack: () => { const o = document.querySelector('.vrs-batch-overlay'); if (o) o.remove(); } }; // « Précédent » ferme la fenêtre : elle ne reste pas devant l'étape revue
// Thèmes du menu « Tutoriel » : les leçons y sont regroupées. `public` (sur une leçon) = ouverte dans la version sans compte
// (mode démo) ; les autres y restent visibles avec la mention « nécessite un compte ». Un thème sans leçon s'affiche « bientôt ».
// Titre de la vidéo du bloc vidéo de la leçon AdReel (gameplay d'« Alone in the Barque », la même que celle de la leçon « Versioning »).
const LESSON_ADREEL_VIDEO = { title: 'Gameplay d’Alone in the Barque : traversée du ponton à la cabane' };
// Leçon Versioning : l'atelier (cadre) a fini sa partie (message « lessonDone », voir 41-envoi-r2-et-bibliotheque-video.js).
let atelierLessonFinished = false;
function onAtelierLessonDone() { atelierLessonFinished = true; }
// Première vidéo du premier bloc vidéo de l'AdReel en cours (celle que la leçon fait remplir).
function lessonAdreelVideo() { const b = blocks.find(x => x.type === 'video'); return b && b.videos && b.videos[0] || null; }
const LESSON_THEMES = [
  { id: 'engine', titleKey: 'lessonThemeEngine' },
  { id: 'pitch', titleKey: 'lessonThemePitch' },
  { id: 'preprod', titleKey: 'lessonThemePreprod' },
];
// Page où se joue une leçon : le Backstage lui-même, ou une autre page du mode tutoriel (liste des projets, espace Projet).
function lessonPageUrl(l) { return l && l.page === 'projet' ? 'projet.html' : (l && l.page === 'projets' ? 'projets.html' : window.location.pathname); }
// Adresse complète d'une leçon dans le mode tutoriel (la page de la leçon + ?tuto&lesson=…).
function lessonTutoUrl(l, id) { const base = lessonPageUrl(l); return base + (base.includes('?') ? '&' : '?') + 'tuto&lesson=' + encodeURIComponent(id) + '&lang=' + currentLang(); }
function lessonIsPublic(lesson) { return !!(lesson && lesson.public); }
const LESSONS = [
  { id: 'static', theme: 'engine', public: true, titleKey: 'lessonStaticTitle', descKey: 'lessonStaticDesc', steps: [
    // Message d'accueil : premier écran de la leçon (étape manuelle, sans zone en surbrillance).
    { titleKey: 'lsWelcomeTitle', textKey: 'lsWelcomeText' },
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#btnAddLibraryTrack', titleKey: 'lsAddTitle', textKey: 'lsAddText',
      enter: (c) => { c.baseLen = library.length; }, done: (c) => library.length > c.baseLen },
    { selector: '#libraryDetail select[data-field="mode"]', titleKey: 'lsModeTitle', textKey: 'lsModeText',
      done: () => { const t = lessonTrack(); return !!t && t.mode === 'static'; } },
    { useSample: true, selector: '#libraryDetail [data-role="staticFileCtrl"]', titleKey: 'lsFileTitle', textKey: 'lsFileText', sampleKey: 'static', downloadSample: true,
      // Le bouton « Choisir un WAV ou MP3 » est grisé pendant cette étape : la leçon utilise les fichiers d'exemple (le texte l'explique).
      enter: () => { const b = document.querySelector('#libraryDetail [data-role="staticFileCtrl"] [data-role="pickBtn"]'); if (b) b.disabled = true; },
      done: () => { const t = lessonTrack(); const l = t && t.layers && t.layers[0]; return !!(l && (l.pendingFile || l.remoteFile)); } },
    { selector: '#libraryDetail input[data-field="loopable"]', titleKey: 'lsLoopTitle', textKey: 'lsLoopText',
      done: () => { const t = lessonTrack(); return !!t && !!t.loopable; } },
    // Le fichier d'exemple n'est pas préparé pour boucler seul : la leçon exige « Quantifié » (required : pas de « Passer
    // l'étape », elle n'avance que lorsque c'est fait). Le tempo et les points de boucle n'existent qu'en Quantifié.
    { selector: '#libraryDetail select[data-field="loopEngine"]', titleKey: 'lsEngineTitle', textKey: 'lsEngineText', required: true,
      done: () => { const t = lessonTrack(); return !!t && t.loopEngine === 'quantized'; } },
    { selector: '#libraryDetail input[data-field="bpm"]', titleKey: 'lsVerifyTitle', textKey: 'lsVerifyText' },
    // Flèche sur la barre de la 31e mesure : le morceau d'exemple fait 30 mesures (+ résonances), la sortie se place à la fin.
    { selector: '#libraryDetail [data-role="loopTimelineHost"]', titleKey: 'lsPointsTitle', textKey: 'lsPointsText', arrow: { bar: 9, labelKey: 'lsArrowOut' } },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'lsListenTitle', textKey: 'lsListenText', listen: true, listenTarget: '#libraryDetail [data-role="previewHost"]' },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'lsEndTitle', textKey: 'lsEndText', final: true },
  ] },
  { id: 'embranchement', theme: 'engine', public: true, titleKey: 'lessonEmbrTitle', descKey: 'lessonEmbrDesc', steps: [
    // Message d'accueil : premier écran de la leçon (étape manuelle, sans zone en surbrillance).
    { titleKey: 'leWelcomeTitle', textKey: 'leWelcomeText' },
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#btnAddLibraryTrack', titleKey: 'lsAddTitle', textKey: 'lsAddText',
      enter: (c) => { c.baseLen = library.length; }, done: (c) => library.length > c.baseLen },
    { selector: '#libraryDetail select[data-field="mode"]', titleKey: 'leModeTitle', textKey: 'leModeText',
      done: () => { const t = lessonTrack(); return !!t && t.mode === 'embranchement-vertical'; } },
    { useSample: true, selector: '#libraryDetail [data-role="modeMaster"]', titleKey: 'leDropTitle', textKey: 'leDropText', sampleKey: 'embranchement', names: 'embrLoops',
      done: () => lessonLoopFileCount() >= 2 },
    HINTS_DIALOG_STEP,
    { selector: '#libraryDetail [data-role="modeMaster"]', titleKey: 'leCheckTitle', textKey: 'leCheckText' },
    { selector: '#libraryDetail .seq-master-item[data-si="0"]', titleKey: 'leRefTitle', textKey: 'leRefText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 0; } },
    { selector: '#libraryDetail input[data-field="bpm"]', titleKey: 'leBpmTitle', textKey: 'leBpmText' },
    { selector: '#libraryDetail [data-role="embrLoopTimelineHost"]', titleKey: 'lePointsTitle', textKey: 'lePointsText', names: 'embrLoops' },
    { selector: '#libraryDetail .seq-master-item[data-si="1"]', titleKey: 'leSecondTitle', textKey: 'leSecondText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 1; } },
    { selector: '#libraryDetail input[data-embr-loop-field="label"]', titleKey: 'leLabelTitle', textKey: 'leLabelText' },
    { selector: '#libraryDetail select[data-embr-loop-field="switchQuantize"]', titleKey: 'leQuantTitle', textKey: 'leQuantText' },
    // Style de coupure « personnalisé » : le fondu se règle alors à la seconde près (0,5 s pour ces deux boucles).
    { selector: '#libraryDetail select[data-embr-loop-field="cutStyle"]', titleKey: 'leCutTitle', textKey: 'leCutText',
      done: () => { const t = lessonTrack(); const l = t && (t.loops || [])[1]; return !!l && l.cutStyle === 'custom'; } },
    { selector: '#libraryDetail input[data-embr-loop-field="customCutFadeSec"]', titleKey: 'leFadeTitle', textKey: 'leFadeText' },
    { selector: '#libraryDetail input[data-embr-loop-field="hasTransition"]', titleKey: 'leTransTitle', textKey: 'leTransText' },
    // Boucle de détour : un fichier à part, joué ponctuellement au clic (mesures et tempo propres).
    { selector: '#libraryDetail [data-action="add-embr-loop"]', titleKey: 'ldAddTitle', textKey: 'ldAddText', skip: () => !lessonDetourReady(),
      done: () => { const t = lessonTrack(); return !!t && (t.loops || []).length >= 3; } },
    { selector: '#libraryDetail .seq-master-item[data-si="2"]', titleKey: 'ldOpenTitle', textKey: 'ldOpenText', skip: () => !lessonDetourReady(),
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 2; } },
    { useSample: true, selector: '#libraryDetail [data-role="embrLoopFileCtrl"]', titleKey: 'ldFileTitle', textKey: 'ldFileText', names: 'embrDetour', skip: () => !lessonDetourReady(),
      done: () => { const t = lessonTrack(); return !!t && lessonHasFile((t.loops || [])[2]); } },
    { selector: '#libraryDetail input[data-embr-loop-field="isDetour"]', titleKey: 'ldFlagTitle', textKey: 'ldFlagText', skip: () => !lessonDetourReady(),
      done: () => { const t = lessonTrack(); const l = t && (t.loops || [])[2]; return !!l && !!l.isDetour; } },
    { selector: '#libraryDetail .row:has([data-embr-loop-field="bars"])', titleKey: 'ldSetTitle', textKey: 'ldSetText', skip: () => !lessonDetourReady() },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'leListenTitle', textKey: 'leListenText', listen: true, listenTarget: '#libraryDetail [data-role="previewHost"]' },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'leEndTitle', textKey: 'leEndText', final: true },
  ] },
  { id: 'additive', theme: 'engine', public: true, titleKey: 'lessonAdditiveTitle', descKey: 'lessonAdditiveDesc', steps: [
    // Message d'accueil : premier écran de la leçon (étape manuelle, sans zone en surbrillance).
    { titleKey: 'laWelcomeTitle', textKey: 'laWelcomeText' },
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#btnAddLibraryTrack', titleKey: 'lsAddTitle', textKey: 'lsAddText',
      enter: (c) => { c.baseLen = library.length; }, done: (c) => library.length > c.baseLen },
    // Un nouveau morceau est déjà en « vertical » : étape de lecture (« Suivant »), pas de geste à détecter.
    { selector: '#libraryDetail select[data-field="mode"]', titleKey: 'laModeTitle', textKey: 'laModeText' },
    { useSample: true, selector: '#libraryDetail [data-role="modeMaster"] .seq-master-item[data-si="0"]', titleKey: 'laDropTitle', textKey: 'laDropText', sampleKey: 'additive',
      done: () => { const t = lessonTrack(); return !!t && (t.layers || []).filter(l => l.pendingFile || l.remoteFile).length >= 2; } },
    HINTS_DIALOG_STEP,
    { selector: '#libraryDetail [data-role="modeMaster"]', titleKey: 'laCheckTitle', textKey: 'laCheckText' },
    // Si la confirmation « tempo et mesures repérés » a déjà passé le moteur en « Quantifié », la leçon le dit (étape de
    // lecture) au lieu de demander un geste déjà fait.
    { selector: '#libraryDetail select[data-field="loopEngine"]', titleKey: 'laEngineTitle', textKey: 'laEngineText', required: true,
      skip: () => { const t = lessonTrack(); return !!t && t.loopEngine === 'quantized'; },
      enter: (c) => { c.engineManual = true; },
      done: () => { const t = lessonTrack(); return !!t && t.loopEngine === 'quantized'; } },
    { selector: '#libraryDetail select[data-field="loopEngine"]', titleKey: 'laEngineAutoTitle', textKey: 'laEngineAutoText',
      skip: (c) => !!c.engineManual },
    { selector: '#libraryDetail [data-role="loopTimelineHost"]', titleKey: 'laPointsTitle', textKey: 'laPointsText', arrow: [{ bar: 1.5, labelKey: 'laArrowIn' }, { bar: 9.5, labelKey: 'laArrowOut' }] },
    // Le pilotage des couches se règle AVANT l'écoute : boutons nommés (par défaut), ou curseur à seuils (RTPC).
    // Le champ « Label » n'existe que lorsqu'une couche est ouverte : on demande d'abord de cliquer dessus.
    { selector: '#libraryDetail .seq-master-item[data-si="0"]', titleKey: 'laSelectTitle', textKey: 'laSelectText',
      skip: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 0; },
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 0; } },
    { selector: '#libraryDetail input[data-field="label"]', titleKey: 'laButtonsTitle', textKey: 'laButtonsText' },
    // Curseur qui remplace les boutons : pas à pas (feu vert « rtpc », admin seulement pour l'instant). 
    // « Infos du morceau » s'ouvre toute seule : la zone des curseurs y est entourée tout de suite (pas de choix à faire,
    // c'est le but de la leçon).
    { selector: '#libraryDetail [data-role="fxSlidersHost"]', titleKey: 'laSl0Title', textKey: 'laSl0Text', group: 'sliders',
      skip: () => !fxOpen('rtpc'),
      enter: () => { const t = lessonTrack(); if (t && seqSelectedSlotIndex.get(t.id) !== 'trackinfo') { seqSelectedSlotIndex.set(t.id, 'trackinfo'); renderLibrary(); } } },
    { selector: '#libraryDetail [data-action="add-fx-slider"]', titleKey: 'laSl2Title', textKey: 'laSl2Text', group: 'sliders',
      skip: () => !fxOpen('rtpc'),
      done: () => { const t = lessonTrack(); return !!t && (t.fxSliders || []).length >= 1; } },
    { selector: '#libraryDetail [data-field="fxSlider"][data-fxs-prop="label"]', titleKey: 'laSl3Title', textKey: 'laSl3Text', group: 'sliders',
      skip: () => !fxOpen('rtpc') || !fxSliderExists() },
    { selector: '#libraryDetail [data-field="fxSlider"][data-fxs-prop="visible"]', titleKey: 'laSl4Title', textKey: 'laSl4Text', group: 'sliders',
      skip: () => !fxOpen('rtpc') || !fxSliderExists(),
      done: () => { const t = lessonTrack(); const sl = t && (t.fxSliders || [])[0]; return !!sl && !!sl.visible; } },
    { selector: '#libraryDetail [data-field="fxSlider"][data-fxs-prop="intensity"]', titleKey: 'laSl5Title', textKey: 'laSl5Text', group: 'sliders',
      skip: () => !fxOpen('rtpc') || !fxSliderExists(),
      done: () => { const t = lessonTrack(); const sl = t && (t.fxSliders || [])[0]; return !!sl && !!sl.intensity; } },
    { selector: '#libraryDetail [data-field="fxSliderIntensityBound"]', titleKey: 'laSl6Title', textKey: 'laSl6Text', group: 'sliders',
      skip: () => !fxOpen('rtpc') || !fxSliderExists() },
    { selector: '#libraryDetail [data-field="fxSlider"][data-fxs-prop="defaultValue"]', titleKey: 'laSl7Title', textKey: 'laSl7Text', group: 'sliders',
      skip: () => !fxOpen('rtpc') || !fxSliderExists(),
      done: () => { const t = lessonTrack(); const sl = t && (t.fxSliders || [])[0]; return !!sl && Number(sl.defaultValue) === 0; } },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'laListenTitle', textKey: 'laListenText', listen: true, listenTarget: '#libraryDetail [data-role="previewHost"]' },
    { selector: '#libraryDetail [data-role="previewHost"]', titleKey: 'laIntensityTitle', textKey: 'laIntensityText' },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'laEndTitle', textKey: 'laEndText', final: true },
  ] },
  { id: 'random', theme: 'engine', public: true, titleKey: 'lessonRandomTitle', descKey: 'lessonRandomDesc', steps: [
    // Message d'accueil : premier écran de la leçon (étape manuelle, sans zone en surbrillance).
    { titleKey: 'lrWelcomeTitle', textKey: 'lrWelcomeText' },
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    // Pas de « + Morceau » (22/10) : on dépose tous les fichiers dans la zone d'import, ce qui crée le morceau. Une fenêtre demande
    // la structure (aucun mot-clé dans un lot de fichiers seuls : le choix est à faire), puis la fenêtre de rangement en pools.
    { useSample: true, selector: '#libraryFolderDrop', titleKey: 'lrBatchTitle', textKey: 'lrBatchText', sampleKey: 'random', names: 'randAll',
      enter: (c) => { c.baseLen = library.length; }, done: () => lessonFolderDialogOpen() },
    { selector: '.vrs-batch-modal [data-fi="mode"]', titleKey: 'lrModeTitle', textKey: 'lrModeText',
      done: () => { const m = document.querySelector('.vrs-batch-modal [data-fi="mode"]'); return !!m && m.value === 'vertical-random'; } },
    { selector: '.vrs-batch-modal [data-fi-btn="go"]', titleKey: 'lfGoTitle', textKey: 'lfGoText',
      done: () => !!document.querySelector('.vrs-batch-modal [data-vbd-file]') },
    { selector: '.vrs-batch-modal .vrs-batch-body', titleKey: 'lrReadTitle', textKey: 'lrReadText' },
    { selector: () => lessonDialogPoolSilent('Jazz Lo KB'), titleKey: 'lrSilentTitle', textKey: 'lrSilentText',
      done: () => { const c = lessonDialogPoolSilent('Jazz Lo KB'); return !!c && c.checked; } },
    { selector: '.vrs-batch-modal [data-vbd="confirm"]', titleKey: 'lrConfirmTitle', textKey: 'lrConfirmText',
      done: (c) => library.length > c.baseLen && !document.querySelector('.vrs-batch-modal') && (lessonSection() || { pools: [] }).pools.length >= 3 },
    // Le morceau vient d'être créé par l'import : son écran s'ouvre sur « Infos du morceau », on affiche la section pour voir ses pools.
    { selector: '#libraryDetail [data-role="vrsPools"]', titleKey: 'lrCheckTitle', textKey: 'lrCheckText',
      enter: () => { const t = lessonTrack(); if (t && (t.sections || []).length && seqSelectedSlotIndex.get(t.id) !== 0) { seqSelectedSlotIndex.set(t.id, 0); renderLibrary(); } } },
    { selector: '#libraryDetail input[data-section-field="bpm"]', titleKey: 'lrBpmTitle', textKey: 'lrBpmText' },
    { selector: '#libraryDetail [data-role="loopTimelineHost"]', titleKey: 'lrPointsTitle', textKey: 'lrPointsText' },
    { selector: '#libraryDetail .seq-master-item[data-seq-key="vrsIntro"]', titleKey: 'lrIntroOpenTitle', textKey: 'lrIntroOpenText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 'vrsIntro'; } },
    // L'intro (2 temps, moins d'une mesure) est rangée toute seule, mais sa durée se règle à la main : 1 mesure de 2 temps.
    { selector: '#libraryDetail [data-role="introTimingRows"]', titleKey: 'lrIntroSetTitle', textKey: 'lrIntroSetText',
      done: () => { const t = lessonTrack(); return !!t && !!t.intro && Number(t.intro.bars) === 1 && Number(t.intro.beatsPerBar) === 2; } },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'lrListenTitle', textKey: 'lrListenText', listen: true, listenTarget: '#libraryDetail [data-role="previewHost"]' },
    // Compresseur sur la basse (22/10) : réglages de Jules-Antoine (seuil -30 dB, ratio 4, gain +2 dB). Ignoré tant que les effets par voix sont fermés.
    { selector: () => lessonBassFxToggle(), titleKey: 'lrCompOpenTitle', textKey: 'lrCompOpenText', skip: () => !fxOpen('fx_per_voice') || lessonBassPoolIndex() < 0,
      // On quitte l'écran de l'intro : les effets des pools se trouvent dans l'écran de la section.
      enter: () => { const t = lessonTrack(); if (t && (t.sections || []).length && seqSelectedSlotIndex.get(t.id) !== 0) { seqSelectedSlotIndex.set(t.id, 0); renderLibrary(); } },
      done: () => { const b = lessonBassFxToggle(); return !!b && expandedAltPoolKeys.has(b.dataset.fxKey); } },
    { selector: () => lessonBassCompressorCheckbox(), titleKey: 'lrCompOnTitle', textKey: 'lrCompOnText', skip: () => !fxOpen('fx_per_voice') || lessonBassPoolIndex() < 0,
      done: () => !!lessonBassCompressor() },
    { selector: () => { const c = lessonBassCompressorCheckbox(); return c ? c.closest('label').parentElement : null; }, titleKey: 'lrCompSetTitle', textKey: 'lrCompSetText', skip: () => !fxOpen('fx_per_voice') || lessonBassPoolIndex() < 0,
      done: () => { const c = lessonBassCompressor(); return !!c && c.threshold === -30 && c.ratio === 4 && c.makeup === 2; } },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'lrEndTitle', textKey: 'lrEndText', final: true },
  ] },
  { id: 'sequential', theme: 'engine', public: true, titleKey: 'lessonSequentialTitle', descKey: 'lessonSequentialDesc', steps: [
    // Message d'accueil : premier écran de la leçon (étape manuelle, sans zone en surbrillance).
    { titleKey: 'lqWelcomeTitle', textKey: 'lqWelcomeText' },
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#btnAddLibraryTrack', titleKey: 'lsAddTitle', textKey: 'lsAddText',
      enter: (c) => { c.baseLen = library.length; }, done: (c) => library.length > c.baseLen },
    { selector: '#libraryDetail select[data-field="mode"]', titleKey: 'lqModeTitle', textKey: 'lqModeText',
      done: () => { const t = lessonTrack(); return !!t && t.mode === 'sequential'; } },
    { useSample: true, selector: '#libraryDetail .seq-master-item[data-seq-key="seqIntro"]', titleKey: 'lqIntroTitle', textKey: 'lqIntroText', sampleKey: 'sequential', names: 'seqIntro',
      done: () => { const t = lessonTrack(); return !!t && lessonHasFile(t.intro); } },
    // L'intro de l'exemple dure 2 temps (moins d'une mesure) et son nom ne porte aucun tempo : réglage manuel (BPM = 110, mesures = 1, temps par mesure = 2).
    { selector: '#libraryDetail .row:has([data-field="introBars"])', titleKey: 'lqIntroSetTitle', textKey: 'lqIntroSetText',
      done: () => { const t = lessonTrack(); return !!t && !!t.intro && Number(t.intro.bars) === 1 && Number(t.intro.beatsPerBar) === 2 && Number(t.intro.bpm) === 110; } },
    { selector: '#libraryDetail [data-action="add-segment-slot"]', titleKey: 'lqSlotTitle', textKey: 'lqSlotText',
      done: () => { const t = lessonTrack(); return !!t && (t.segmentSlots || []).length >= 1; } },
    { useSample: true, selector: '#libraryDetail .seq-master-item[data-si="0"]', titleKey: 'lqSegTitle', textKey: 'lqSegText', names: 'seqAlt1',
      done: () => lessonSlotFileCount(0) >= 4 },
    { selector: '#libraryDetail [data-role="slotSettings"]', titleKey: 'lqSlotCheckTitle', textKey: 'lqSlotCheckText' },
    // Répétition des opérations pour une nouvelle section.
    { selector: '#libraryDetail [data-action="add-segment-slot"]', titleKey: 'lqSlot2Title', textKey: 'lqSlot2Text',
      done: () => { const t = lessonTrack(); return !!t && (t.segmentSlots || []).length >= 2; } },
    { useSample: true, selector: '#libraryDetail .seq-master-item[data-si="1"]', titleKey: 'lqSeg2Title', textKey: 'lqSeg2Text', names: 'seqAlt2',
      done: () => lessonSlotFileCount(1) >= 4 },
    // Dupliquer une section (22/10) : structure AABA = A, copie de A, B, copie de A (morceau « Jazz Hi Seq. Rand. » de Jules-Antoine). Le bouton
    // « Dupliquer cette section » (ou Alt + glisser, feu vert alt_drag_delete) crée une copie indépendante, juste après l'original.
    { selector: '#libraryDetail [data-action="duplicate-segment-slot"]', titleKey: 'lqDupTitle', textKey: 'lqDupText',
      enter: () => { const t = lessonTrack(); if (t && seqSelectedSlotIndex.get(t.id) !== 0) { seqSelectedSlotIndex.set(t.id, 0); renderLibrary(); } },
      done: () => { const t = lessonTrack(); return !!t && (t.segmentSlots || []).length >= 3; } },
    // La 2e copie de A va APRÈS B : Alt + glisser la section A sous B (ou « Dupliquer » puis glisser la copie par n'importe où sur sa ligne).
    { selector: '#libraryDetail [data-role="segmentSlotsMaster"]', titleKey: 'lqDup2Title', textKey: 'lqDup2Text',
      done: () => { const t = lessonTrack(); const n = t && (t.segmentSlots || []).length; return n >= 4 && lessonSlotFileCount(n - 1) >= 4 && lessonSlotFirstName(n - 1) === lessonSlotFirstName(0) && lessonSlotFirstName(n - 2) !== lessonSlotFirstName(0); } },
    { useSample: true, selector: '#libraryDetail .seq-master-item[data-seq-key="seqOutro"]', titleKey: 'lqOutroTitle', textKey: 'lqOutroText', names: 'seqOutro',
      done: () => { const t = lessonTrack(); return !!t && lessonHasFile(t.outro); } },
    { selector: '#libraryDetail [data-role="segmentSlotsMaster"]', titleKey: 'lqCheckTitle', textKey: 'lqCheckText' },
    { selector: '#libraryDetail .seq-master-item[data-seq-key="trackinfo"]', titleKey: 'lqInfoTitle', textKey: 'lqInfoText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 'trackinfo'; } },
    // Le dépôt d'un fichier daté (« 110bpm ») règle le tempo de CHAQUE section, pas celui du morceau : on saisit celui-ci à la main (110).
    { selector: '#libraryDetail input[data-field="bpm"]', titleKey: 'lqBpmTitle', textKey: 'lqBpmText', enter: lessonSelectTrackInfo,
      done: () => { const t = lessonTrack(); return !!t && Number(t.bpm) === 110; } },
    // Case « ordre aléatoire » : simplement présentée (étape manuelle, rien à cocher) — le morceau garde l'ordre A, A, B, A.
    { selector: '#libraryDetail input[data-field="seqSlotOrder"]', titleKey: 'lqRandomTitle', textKey: 'lqRandomText', enter: lessonSelectTrackInfo },
    { selector: '#libraryDetail select[data-field="maxChainLoops"]', titleKey: 'lqCyclesTitle', textKey: 'lqCyclesText', enter: lessonSelectTrackInfo },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'lqListenTitle', textKey: 'lqListenText', listen: true, listenTarget: '#libraryDetail [data-role="previewHost"]' },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'lqEndTitle', textKey: 'lqEndText', final: true },
  ] },
  { id: 'branching', theme: 'engine', public: true, titleKey: 'lessonBranchingTitle', descKey: 'lessonBranchingDesc', steps: [
    // Message d'accueil : premier écran de la leçon (étape manuelle, sans zone en surbrillance).
    { titleKey: 'lbWelcomeTitle', textKey: 'lbWelcomeText' },
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lsLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#btnAddLibraryTrack', titleKey: 'lsAddTitle', textKey: 'lsAddText',
      enter: (c) => { c.baseLen = library.length; }, done: (c) => library.length > c.baseLen },
    { selector: '#libraryDetail select[data-field="mode"]', titleKey: 'lbModeTitle', textKey: 'lbModeText',
      done: () => { const t = lessonTrack(); return !!t && t.mode === 'sequential'; } },
    { selector: '#libraryDetail [data-action="add-segment-slot"]', titleKey: 'lbSlot3Title', textKey: 'lbSlot3Text',
      done: () => { const t = lessonTrack(); return !!t && (t.segmentSlots || []).length >= 4; } },
    // Structure du morceau « Jazz Hi Seq. Branch. » (22/10) : quatre villes, Rock City au centre (emplacement 2) ; elle mène aux trois autres,
    // qui n'ont chacune qu'une sortie, vers Rock City. Emplacements : 0 Jazz City, 1 Rock City, 2 Disco City, 3 Synth City.
    { useSample: true, selector: '#libraryDetail .seq-master-item[data-si="0"]', titleKey: 'lbCity1Title', textKey: 'lbCity1Text', sampleKey: 'branching', names: 'cityJazz',
      done: () => lessonSlotFileCount(0) >= 2 },
    { useSample: true, selector: '#libraryDetail .seq-master-item[data-si="1"]', titleKey: 'lbCity2Title', textKey: 'lbCity2Text', names: 'cityRock',
      done: () => lessonSlotFileCount(1) >= 1 },
    { useSample: true, selector: '#libraryDetail .seq-master-item[data-si="2"]', titleKey: 'lbCity3Title', textKey: 'lbCity3Text', names: 'cityDisco',
      done: () => lessonSlotFileCount(2) >= 1 },
    { useSample: true, selector: '#libraryDetail .seq-master-item[data-si="3"]', titleKey: 'lbCity4Title', textKey: 'lbCity4Text', names: 'citySynth',
      done: () => lessonSlotFileCount(3) >= 1 },
    { selector: '#libraryDetail .seq-master-item[data-si="1"]', titleKey: 'lbPickTitle', textKey: 'lbPickText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 1; } },
    { selector: '#libraryDetail input[data-slot-field="hasBranches"]', titleKey: 'lbEnableTitle', textKey: 'lbEnableText',
      done: () => { const sl = lessonSlot(1); return !!sl && (sl.nextOptions || []).length >= 1; } },
    { selector: '#libraryDetail .branch-option-card:nth-child(1) [data-branch-field="targetId"]', titleKey: 'lbTarget1Title', textKey: 'lbTarget1Text' },
    { selector: '#libraryDetail .branch-option-card:nth-child(1) [data-branch-field="hasTransition"]', titleKey: 'lbTransTitle', textKey: 'lbTransText',
      done: () => { const sl = lessonSlot(1); const o = sl && (sl.nextOptions || [])[0]; return !!(o && o.transition); } },
    { useSample: true, selector: '#libraryDetail .branch-option-card:nth-child(1) [data-role="transitionFileCtrl"]', titleKey: 'lbTransFile1Title', textKey: 'lbTransFile1Text', names: 'transDisco',
      done: () => { const sl = lessonSlot(1); const o = sl && (sl.nextOptions || [])[0]; return !!(o && o.transition && lessonHasFile(o.transition)); } },
    { selector: '#libraryDetail [data-action="add-branch-option"]', titleKey: 'lbAddTitle', textKey: 'lbAddText',
      done: () => { const sl = lessonSlot(1); return !!sl && (sl.nextOptions || []).length >= 2; } },
    { selector: '#libraryDetail .branch-option-card:nth-child(2) [data-branch-field="targetId"]', titleKey: 'lbTarget2Title', textKey: 'lbTarget2Text',
      done: () => { const sl = lessonSlot(1); const jazz = lessonSlot(0); return !!(sl && jazz && sl.nextOptions && sl.nextOptions[1] && sl.nextOptions[1].targetId === jazz.id); } },
    { selector: '#libraryDetail .branch-option-card:nth-child(2) [data-branch-field="hasTransition"]', titleKey: 'lbTrans2Title', textKey: 'lbTrans2Text',
      done: () => { const sl = lessonSlot(1); const o = sl && (sl.nextOptions || [])[1]; return !!(o && o.transition); } },
    { useSample: true, selector: '#libraryDetail .branch-option-card:nth-child(2) [data-role="transitionFileCtrl"]', titleKey: 'lbTransFile2Title', textKey: 'lbTransFile2Text', names: 'transJazz',
      done: () => { const sl = lessonSlot(1); const o = sl && (sl.nextOptions || [])[1]; return !!(o && o.transition && lessonHasFile(o.transition)); } },
    { selector: '#libraryDetail [data-action="add-branch-option"]', titleKey: 'lbAdd3Title', textKey: 'lbAdd3Text',
      done: () => { const sl = lessonSlot(1); return !!sl && (sl.nextOptions || []).length >= 3; } },
    { selector: '#libraryDetail .branch-option-card:nth-child(3) [data-branch-field="targetId"]', titleKey: 'lbTarget3Title', textKey: 'lbTarget3Text',
      done: () => { const sl = lessonSlot(1); const synth = lessonSlot(3); return !!(sl && synth && sl.nextOptions && sl.nextOptions[2] && sl.nextOptions[2].targetId === synth.id); } },
    { selector: '#libraryDetail .branch-option-card:nth-child(3) [data-branch-field="hasTransition"]', titleKey: 'lbTrans3Title', textKey: 'lbTrans3Text',
      done: () => { const sl = lessonSlot(1); const o = sl && (sl.nextOptions || [])[2]; return !!(o && o.transition); } },
    { useSample: true, selector: '#libraryDetail .branch-option-card:nth-child(3) [data-role="transitionFileCtrl"]', titleKey: 'lbTransFile3Title', textKey: 'lbTransFile3Text', names: 'transSynth',
      done: () => { const sl = lessonSlot(1); const o = sl && (sl.nextOptions || [])[2]; return !!(o && o.transition && lessonHasFile(o.transition)); } },
    { selector: '#libraryDetail .branch-option-card:nth-child(1) [data-branch-field="label"]', titleKey: 'lbLabelsTitle', textKey: 'lbLabelsText' },
    // Déclenchement et coupure de Rock City : on garde les valeurs par défaut (prochaine mesure, fondu court), simplement présentées.
    { selector: '#libraryDetail select[data-slot-field="quantization"]', titleKey: 'lbTriggerTitle', textKey: 'lbTriggerText' },
    { selector: '#libraryDetail select[data-slot-field="cutStyle"]', titleKey: 'lbCutTitle', textKey: 'lbCutText' },
    { selector: '#libraryDetail [data-role="segmentSlotsMaster"]', titleKey: 'lbOthersTitle', textKey: 'lbOthersText' },
    { selector: '#libraryDetail .seq-master-item[data-seq-key="trackinfo"]', titleKey: 'lqInfoTitle', textKey: 'lqInfoText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 'trackinfo'; } },
    { selector: '#libraryDetail input[data-field="bpm"]', titleKey: 'lqBpmTitle', textKey: 'lqBpmText', enter: lessonSelectTrackInfo,
      done: () => { const t = lessonTrack(); return !!t && Number(t.bpm) === 110; } },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'lbListenTitle', textKey: 'lbListenText', listen: true, listenTarget: '#libraryDetail [data-role="previewHost"]' },
    // Raccourci (feu vert « bulk_drop ») : après la construction à la main (leçons 4 et 5), le même résultat en déposant un dossier. L'import crée la chaîne mais pas les embranchements, qui se relient à la main.
    // L'import tourne entièrement dans le navigateur. Étapes ignorées tant que le feu vert est fermé.
    { titleKey: 'lfIntroTitle', textKey: 'lfIntroText', skip: lessonImportSkipped },
    { selector: '#libraryFolderDrop', titleKey: 'lfDropTitle', textKey: 'lfDropText', sampleKey: 'import', names: 'import', skip: lessonImportSkipped,
      enter: (c) => { c.baseLen = library.length; }, done: () => lessonFolderDialogOpen() },
    { selector: '.vrs-batch-modal [data-fi="mode"]', titleKey: 'lfReadTitle', textKey: 'lfReadText', skip: lessonImportSkipped },
    { selector: '.vrs-batch-modal [data-fi-btn="go"]', titleKey: 'lfGoTitle', textKey: 'lfGoText', skip: lessonImportSkipped,
      done: () => !!document.querySelector('.vrs-batch-modal [data-vbd-file]') },
    // Le piège : « Ouverture.wav » n'est pas reconnue comme intro et aucun nom ne porte de tempo. L'apprenant la
    // renomme chez lui (mot « Intro » + « _120bpm »), puis redépose le dossier.
    { selector: '.vrs-batch-modal .vrs-batch-body', titleKey: 'lfRolesTitle', textKey: 'lfRolesText', skip: lessonImportSkipped },
    { selector: '.vrs-batch-modal .vrs-batch-body', titleKey: 'lfRenameTitle', textKey: 'lfRenameText', required: true, skip: lessonImportSkipped,
      done: () => /120\s*BPM/i.test(lessonDialogText()) && !!document.querySelector('.vrs-batch-modal [data-vbd-check="hints"]') },
    { selector: '.vrs-batch-modal .vrs-batch-group', titleKey: 'lfCheckTitle', textKey: 'lfCheckText', skip: lessonImportSkipped },
    { selector: '.vrs-batch-modal [data-vbd="confirm"]', titleKey: 'lfCreateTitle', textKey: 'lfCreateText', skip: lessonImportSkipped,
      done: (c) => library.length > c.baseLen },
    { selector: '#libraryMaster', titleKey: 'lfDraftTitle', textKey: 'lfDraftText', skip: lessonImportSkipped },
    { selector: '#btnPublish', titleKey: 'lsSaveTitle', textKey: 'lsSaveText', clickDone: true },
    { titleKey: 'lbEndTitle', textKey: 'lbEndText', final: true },
  ] },
  // Leçon « Les Sfx » (22/10) : reproduit le morceau « Jazz Lo Static +SFX » de Jules-Antoine. Le morceau « Jazz Lo Static » est préchargé dans le compte
  // fictif (api/demo-client.js, leçon `sfx`) ; on crée deux Sfx (glaçons : 3 variations, espace en pas à pas, 6 points ; verre : 2 variations, 5 points, rendu
  // binaural), on les ajoute au morceau et on les déclenche à l'écoute.
  { id: 'sfx', theme: 'engine', public: true, reload: true, titleKey: 'lessonSfxTitle', descKey: 'lessonSfxDesc', steps: [
    { titleKey: 'lxWelcomeTitle', textKey: 'lxWelcomeText' },
    { selector: '.nav-item[data-tab="sfxLibrary"]', titleKey: 'lxNavTitle', textKey: 'lxNavText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="sfxLibrary"]'); return !!(p && p.classList.contains('active')); } },
    { useSample: true, selector: '#sfxLibraryDrop', titleKey: 'lxDrop1Title', textKey: 'lxDrop1Text', names: 'sfxIce',
      enter: (c) => { c.baseLen = sfxLibrary.length; }, done: () => lessonSfxBatchOpen() },
    { selector: '.vrs-batch-modal [data-vbd-group-label]', titleKey: 'lxName1Title', textKey: 'lxName1Text' },
    { selector: '.vrs-batch-modal [data-vbd="confirm"]', titleKey: 'lxConfirmTitle', textKey: 'lxConfirmText',
      done: (c) => sfxLibrary.length > c.baseLen && !document.querySelector('.vrs-batch-modal') },
    { selector: '#sfxLibraryDetail [data-role="sfxVariationsDrop"]', titleKey: 'lxVarTitle', textKey: 'lxVarText' },
    { selector: '#sfxLibraryDetail [data-action="select-sfx-entry"][data-entry="behavior"]', titleKey: 'lxBehTitle', textKey: 'lxBehText',
      done: () => lessonSfxEntryOpen(0, 'behavior') },
    { selector: '#sfxLibraryDetail select[data-sfx-field="rrMode"]', titleKey: 'lxRrTitle', textKey: 'lxRrText' },
    { selector: '#sfxLibraryDetail [data-action="select-sfx-entry"][data-entry="space"]', titleKey: 'lxSpaceTitle', textKey: 'lxSpaceText',
      done: () => lessonSfxEntryOpen(0, 'space') },
    { selector: '#sfxLibraryDetail input[data-sfx-space="enabled"]', titleKey: 'lxEnableTitle', textKey: 'lxEnableText',
      done: () => { const sp = lessonSfxSpace(0); return !!sp && !!sp.enabled; } },
    { selector: '#sfxLibraryDetail select[data-sfx-space="room"]', titleKey: 'lxRoomTitle', textKey: 'lxRoomText' },
    { selector: '#sfxLibraryDetail select[data-sfx-space="pathMode"]', titleKey: 'lxModeTitle', textKey: 'lxModeText',
      done: () => { const sp = lessonSfxSpace(0); return !!sp && !!sp.path && sp.path.mode === 'steps'; } },
    { selector: '#sfxLibraryDetail [data-role="spaceMatrix"]', titleKey: 'lxPointsTitle', textKey: 'lxPointsText',
      done: () => { const sp = lessonSfxSpace(0); return !!sp && !!sp.path && sp.path.mode === 'steps' && (sp.path.points || []).length >= 6; } },
    { selector: '#sfxLibraryDetail [data-role="spaceTest"]', titleKey: 'lxTest1Title', textKey: 'lxTest1Text', listen: true },
    { useSample: true, selector: '#sfxLibraryDrop', titleKey: 'lxDrop2Title', textKey: 'lxDrop2Text', names: 'sfxGlass',
      enter: (c) => { c.baseLen = sfxLibrary.length; }, done: () => lessonSfxBatchOpen() },
    { selector: '.vrs-batch-modal [data-vbd-group-label]', titleKey: 'lxName2Title', textKey: 'lxName2Text' },
    { selector: '.vrs-batch-modal [data-vbd="confirm"]', titleKey: 'lxConfirmTitle', textKey: 'lxConfirmText',
      done: (c) => sfxLibrary.length > c.baseLen && !document.querySelector('.vrs-batch-modal') },
    { selector: '#sfxLibraryDetail [data-action="select-sfx-entry"][data-entry="space"]', titleKey: 'lxSpace2Title', textKey: 'lxSpace2Text',
      done: () => lessonSfxEntryOpen(1, 'space') },
    { selector: '#sfxLibraryDetail input[data-sfx-space="enabled"]', titleKey: 'lxEnableTitle', textKey: 'lxEnableText',
      done: () => { const sp = lessonSfxSpace(1); return !!sp && !!sp.enabled; } },
    { selector: '#sfxLibraryDetail select[data-sfx-space="pathMode"]', titleKey: 'lxMode2Title', textKey: 'lxMode2Text',
      done: () => { const sp = lessonSfxSpace(1); return !!sp && !!sp.path && sp.path.mode === 'steps'; } },
    { selector: '#sfxLibraryDetail [data-role="spaceMatrix"]', titleKey: 'lxPoints2Title', textKey: 'lxPoints2Text',
      done: () => { const sp = lessonSfxSpace(1); return !!sp && !!sp.path && sp.path.mode === 'steps' && (sp.path.points || []).length >= 5; } },
    { selector: '#sfxLibraryDetail input[data-sfx-space="binaural"]', titleKey: 'lxBinauralTitle', textKey: 'lxBinauralText',
      done: () => { const sp = lessonSfxSpace(1); return !!sp && !!sp.binaural; } },
    { selector: '#sfxLibraryDetail [data-role="spaceTest"]', titleKey: 'lxTest2Title', textKey: 'lxTest2Text', listen: true },
    // Troisième Sfx (22/10) : l'ambiance du bar, UN seul fichier (créé aussitôt, sans fenêtre de rangement), en « Glissement » sur 20 s.
    { useSample: true, selector: '#sfxLibraryDrop', titleKey: 'lxDrop3Title', textKey: 'lxDrop3Text', names: 'sfxBar',
      enter: (c) => { c.baseLen = sfxLibrary.length; }, done: (c) => sfxLibrary.length > c.baseLen },
    { selector: '#sfxLibraryDetail [data-sfx-field="title"]', titleKey: 'lxName3Title', textKey: 'lxName3Text' },
    { selector: '#sfxLibraryDetail [data-action="select-sfx-entry"][data-entry="space"]', titleKey: 'lxSpace3Title', textKey: 'lxSpace3Text',
      done: () => lessonSfxEntryOpen(2, 'space') },
    { selector: '#sfxLibraryDetail input[data-sfx-space="enabled"]', titleKey: 'lxEnableTitle', textKey: 'lxEnableText',
      done: () => { const sp = lessonSfxSpace(2); return !!sp && !!sp.enabled; } },
    { selector: '#sfxLibraryDetail select[data-sfx-space="pathMode"]', titleKey: 'lxMode3Title', textKey: 'lxMode3Text',
      done: () => { const sp = lessonSfxSpace(2); return !!sp && !!sp.path && sp.path.mode === 'glide'; } },
    { selector: '#sfxLibraryDetail [data-role="spaceMatrix"]', titleKey: 'lxPoints3Title', textKey: 'lxPoints3Text',
      done: () => { const sp = lessonSfxSpace(2); return !!sp && !!sp.path && sp.path.mode === 'glide' && (sp.path.points || []).length >= 6; } },
    { selector: '#sfxLibraryDetail input[data-sfx-space="pathDuration"]', titleKey: 'lxDurationTitle', textKey: 'lxDurationText',
      done: () => { const sp = lessonSfxSpace(2); return !!sp && !!sp.path && sp.path.durationSec === 20; } },
    { selector: '#sfxLibraryDetail input[data-sfx-space="binaural"]', titleKey: 'lxBinauralTitle', textKey: 'lxBinaural3Text',
      done: () => { const sp = lessonSfxSpace(2); return !!sp && !!sp.binaural; } },
    { selector: '#sfxLibraryDetail [data-role="spaceTest"]', titleKey: 'lxTest3Title', textKey: 'lxTest3Text', listen: true },
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lxLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#libraryMaster .seq-master-item', titleKey: 'lxPickTitle', textKey: 'lxPickText',
      done: () => !!lessonTrack() && !!document.querySelector('#libraryDetail .seq-master-item[data-seq-key="sfx"]') },
    { selector: '#libraryDetail .seq-master-item[data-seq-key="sfx"]', titleKey: 'lxExtraTitle', textKey: 'lxExtraText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 'sfx'; } },
    { selector: '#libraryDetail [data-role="trackSfxSelector"] select[data-sel-action="add"]', titleKey: 'lxAdd1Title', textKey: 'lxAdd1Text',
      done: () => { const t = lessonTrack(); const a = lessonSfx(0); return !!t && !!a && (t.sfxIds || []).includes(a.id); } },
    { selector: '#libraryDetail [data-role="trackSfxSelector"] select[data-sel-action="add"]', titleKey: 'lxAdd2Title', textKey: 'lxAdd2Text',
      done: () => { const t = lessonTrack(); const b = lessonSfx(1); return !!t && !!b && (t.sfxIds || []).includes(b.id); } },
    { selector: '#libraryDetail [data-role="trackSfxSelector"] select[data-sel-action="add"]', titleKey: 'lxAdd3Title', textKey: 'lxAdd3Text',
      done: () => { const t = lessonTrack(); const c = lessonSfx(2); return !!t && !!c && (t.sfxIds || []).includes(c.id); } },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'lxListenTitle', textKey: 'lxListenText', listen: true, listenTarget: '#libraryDetail [data-role="previewHost"]' },
    { titleKey: 'lxEndTitle', textKey: 'lxEndText', final: true },
  ] },
  // Leçon « Les événements d'effets » (22/10) : reproduit les deux événements du morceau « Jazz Lo Static +FX » de Jules-Antoine, posés sur « Toutes les voix » :
  // « un groupe qui joue dans un coin » (volume -8 dB, pan 0,6, low cut 80 Hz, high cut 5 000 Hz, reverb 1,3 s / 0,3) et « une radio » (volume -18 dB,
  // low cut 500 Hz, high cut 1 500 Hz). Le morceau « Jazz Lo Static » est préchargé dans le compte fictif (api/demo-client.js, leçon `events`).
  { id: 'events', theme: 'engine', public: true, reload: true, titleKey: 'lessonEventsTitle', descKey: 'lessonEventsDesc', steps: [
    { titleKey: 'lvxWelcomeTitle', textKey: 'lvxWelcomeText' },
    { selector: '.nav-item[data-tab="library"]', titleKey: 'lxLibTitle', textKey: 'lsLibText',
      done: () => { const p = document.querySelector('.backstage-panel[data-panel="library"]'); return !!(p && p.classList.contains('active')); } },
    { selector: '#libraryMaster .seq-master-item', titleKey: 'lxPickTitle', textKey: 'lxPickText',
      done: () => !!lessonTrack() && !!document.querySelector('#libraryDetail .seq-master-item[data-seq-key="trackinfo"]') },
    { selector: '#libraryDetail .seq-master-item[data-seq-key="trackinfo"]', titleKey: 'lvxInfoTitle', textKey: 'lvxInfoText',
      done: () => { const t = lessonTrack(); return !!t && seqSelectedSlotIndex.get(t.id) === 'trackinfo'; } },
    { selector: () => lessonEventsSection(), titleKey: 'lvxSectionTitle', textKey: 'lvxSectionText', enter: lessonSelectTrackInfo,
      done: () => { const t = lessonTrack(); return !!t && fxTriggersSectionOpen.has(String(t.id)); } },
    { selector: '#libraryDetail [data-action="add-fx-trigger"]', titleKey: 'lvxAddTitle', textKey: 'lvxAddText',
      done: () => { const t = lessonTrack(); return !!t && (t.fxTriggers || []).length >= 1; } },
    { selector: '#libraryDetail [data-fxt-prop="label"][data-tri="0"]', titleKey: 'lvxName1Title', textKey: 'lvxName1Text' },
    { selector: '#libraryDetail [data-tri="0"][data-fxtg-owner="trigger"]', titleKey: 'lvxTargetTitle', textKey: 'lvxTargetText' },
    { selector: () => lessonFxBox(0, 'volume'), titleKey: 'lvxVolTitle', textKey: 'lvxVolText',
      done: () => lessonFxValue(0, 'volume', 'db') === -8 },
    { selector: () => lessonFxBox(0, 'pan'), titleKey: 'lvxPanTitle', textKey: 'lvxPanText',
      done: () => { const v = lessonFxValue(0, 'pan', 'value'); return Number.isFinite(v) && v >= 0.4 && v <= 0.9; } },
    { selector: () => lessonFxBox(0, 'lowcut'), titleKey: 'lvxLowTitle', textKey: 'lvxLowText',
      done: () => lessonFxValue(0, 'lowcut', 'frequency') === 80 },
    { selector: () => lessonFxBox(0, 'highcut'), titleKey: 'lvxHighTitle', textKey: 'lvxHighText',
      done: () => lessonFxValue(0, 'highcut', 'frequency') === 5000 },
    { selector: () => lessonFxBox(0, 'reverb'), titleKey: 'lvxReverbTitle', textKey: 'lvxReverbText',
      done: () => lessonFxValue(0, 'reverb', 'decay') === 1.3 && lessonFxValue(0, 'reverb', 'wet') === 0.3 },
    { selector: '#libraryDetail [data-fxt-prop="visible"][data-tri="0"]', titleKey: 'lvxVisibleTitle', textKey: 'lvxVisibleText' },
    { selector: '#libraryDetail [data-action="add-fx-trigger"]', titleKey: 'lvxAdd2Title', textKey: 'lvxAdd2Text',
      done: () => { const t = lessonTrack(); return !!t && (t.fxTriggers || []).length >= 2; } },
    { selector: '#libraryDetail [data-fxt-prop="label"][data-tri="1"]', titleKey: 'lvxName2Title', textKey: 'lvxName2Text' },
    { selector: () => lessonFxBox(1, 'volume'), titleKey: 'lvxVol2Title', textKey: 'lvxVol2Text',
      done: () => lessonFxValue(1, 'volume', 'db') === -18 },
    { selector: () => lessonFxBox(1, 'lowcut'), titleKey: 'lvxLow2Title', textKey: 'lvxLow2Text',
      done: () => lessonFxValue(1, 'lowcut', 'frequency') === 500 },
    { selector: () => lessonFxBox(1, 'highcut'), titleKey: 'lvxHigh2Title', textKey: 'lvxHigh2Text',
      done: () => lessonFxValue(1, 'highcut', 'frequency') === 1500 },
    { selector: '#libraryDetail [data-action="preview-track"]', titleKey: 'lvxListenTitle', textKey: 'lvxListenText', listen: true, listenTarget: '#libraryDetail [data-role="previewHost"]' },
    { titleKey: 'lvxEndTitle', textKey: 'lvxEndText', final: true },
  ] },
  // Leçon « Créer un AdReel » (20/10) : se joue dans le Backstage du mode tutoriel, bibliothèque d'exemple préchargée (api/demo-client.js,
  // ?tuto&lesson=adreel : rechargement obligatoire d'où `reload`). Fil rouge : le compositeur fictif Théo envoie son travail au studio Barque.
  // L'aperçu de fin ouvre l'AdReel REMPLI (bouton Prévisualiser : aperçu local, sans serveur).
  { id: 'adreel', theme: 'pitch', public: true, reload: true, titleKey: 'laTitle', descKey: 'laDesc', steps: [
    { titleKey: 'laWelcomeTitle', textKey: 'laWelcomeText' },
    { selector: '#btnAddAdReel', titleKey: 'laNewTitle', textKey: 'laNewText', clickDone: true },
    { selector: '#newAdReelLabel', titleKey: 'laNameTitle', textKey: 'laNameText', done: () => { const i = document.getElementById('newAdReelLabel'); return !!i && i.value.trim().length > 2; },
      drops: [{ kind: 'text', label: 'Alone in the Barque : pitch musical', value: 'Alone in the Barque : pitch musical' }] },
    { selector: '#newAdReelOk', titleKey: 'laCreateTitle', textKey: 'laCreateText', done: () => currentAdReelId !== 'main' && adReels.length >= 2 },
    { selector: '#btnToggleCollapseAllBlocks', titleKey: 'laOpenTitle', textKey: 'laOpenText', done: () => !!document.querySelector('.block-editor-body:not(.collapsed)') },
    { selector: '.block-editor-card[data-type="header"] [data-role="title"]', titleKey: 'laHeaderTitleTitle', textKey: 'laHeaderTitleText', done: () => (profile.title || '').trim().length > 2,
      drops: [{ kind: 'text', label: 'Alone in the Barque', value: 'Alone in the Barque' }] },
    { selector: '.block-editor-card[data-type="header"] [data-role="subtitle"]', titleKey: 'laHeaderSubTitle', textKey: 'laHeaderSubText', done: () => (profile.subtitle || '').trim().length > 2,
      drops: [{ kind: 'text', label: 'Un jeu d’horreur lacustre. Musique interactive par Daniel Orcman.', value: 'Un jeu d’horreur lacustre. Musique interactive par Daniel Orcman.' }] },
    { selector: '.block-editor-card[data-type="bio"] [data-role="bioText"]', titleKey: 'laBioTitle', textKey: 'laBioText', done: () => (profile.bio || '').trim().length > 5,
      drops: [{ kind: 'text', label: 'Quatre zones, une menace qui se rapproche : la musique réagit à la distance du monstre, et se tait à la cabane.', value: 'Quatre zones, une menace qui se rapproche : la musique réagit à la distance du monstre, et se tait à la cabane.' }] },
    { selector: '.block-editor-card[data-type="tracks"] select[data-sel-action="add"]', titleKey: 'laTrack1Title', textKey: 'laTrack1Text', done: () => trackIds.length >= 1 },
    { selector: '.block-editor-card[data-type="tracks"] select[data-sel-action="add"]', titleKey: 'laTrack2Title', textKey: 'laTrack2Text', done: () => trackIds.length >= 2 },
    // Mise en page : explication, sans geste obligatoire (le glisser-déposer des blocs marche à la souris, pas toujours au doigt).
    { selector: '.block-editor-card[data-type="tracks"] .block-drag-handle', titleKey: 'laReorderTitle', textKey: 'laReorderText' },
    { selector: '#btnAddText', titleKey: 'laAddTextTitle', textKey: 'laAddTextText', clickDone: true, done: () => blocks.some(b => b.type === 'text') },
    { selector: '.block-editor-card[data-type="text"] [data-role="title"]', titleKey: 'laTextTitleTitle', textKey: 'laTextTitleText', done: () => blocks.some(b => b.type === 'text' && (b.title || '').trim().length > 2),
      drops: [{ kind: 'text', label: 'Direction sonore', value: 'Direction sonore' }] },
    { selector: '.block-editor-card[data-type="text"] [data-role="content"]', titleKey: 'laTextBodyTitle', textKey: 'laTextBodyText', done: () => blocks.some(b => b.type === 'text' && (b.content || '').trim().length > 5),
      drops: [{ kind: 'text', label: 'Le silence fait partie de la musique : refuge = feu de bois et un accord de piano.', value: 'Le silence fait partie de la musique : refuge = feu de bois et un accord de piano.' }] },
    // Bloc vidéo : la vidéo de gameplay de la leçon « Versioning » (lien à fournir : LESSON_ADREEL_VIDEO ; l'étape du lien est sautée tant qu'il manque).
    { selector: '#btnAddVideoBlock', titleKey: 'laAddVideoTitle', textKey: 'laAddVideoText', clickDone: true, done: () => blocks.some(b => b.type === 'video') },
    { selector: '.block-editor-card[data-type="video"] [data-role="addBtn"]', titleKey: 'laVideoItemTitle', textKey: 'laVideoItemText', clickDone: true, done: () => blocks.some(b => b.type === 'video' && (b.videos || []).length >= 1) },
    // La vidéo de gameplay d'Alone, déjà dans la bibliothèque vidéo en deux versions (même montage, deux musiques) : on la choisit, puis on choisit
    // la version montrée au studio (versioning depuis le bloc vidéo, 21/10).
    { selector: '.block-editor-card[data-type="video"] [data-role="sourceRadio"][value="library"]', titleKey: 'laVideoSourceTitle', textKey: 'laVideoSourceText',
      done: () => lessonAdreelVideo() && lessonAdreelVideo().source === 'library' },
    { selector: '.block-editor-card[data-type="video"] [data-role="librarySelect"]', titleKey: 'laVideoPickTitle', textKey: 'laVideoPickText',
      done: () => !!(lessonAdreelVideo() && lessonAdreelVideo().libraryVideoId) },
    { selector: '.block-editor-card[data-type="video"] [data-role="versionSelect"]', titleKey: 'laVideoVersionTitle', textKey: 'laVideoVersionText',
      done: (c) => { const v = lessonAdreelVideo(); if (!v) return false; if (!c.firstVideo) c.firstVideo = v.libraryVideoId; return !!v.libraryVideoId && v.libraryVideoId !== c.firstVideo; } },
    { selector: '.block-editor-card[data-type="video"] [data-field="title"]', titleKey: 'laVideoNameTitle', textKey: 'laVideoNameText', done: () => !!(lessonAdreelVideo() && (lessonAdreelVideo().title || '').trim().length > 2),
      drops: [{ kind: 'text', label: LESSON_ADREEL_VIDEO.title, value: LESSON_ADREEL_VIDEO.title }] },
    { selector: '.nav-item[data-tab="appearance"]', titleKey: 'laAppearanceTitle', textKey: 'laAppearanceText', done: () => !!document.querySelector('.nav-item[data-tab="appearance"].active') },
    { selector: () => document.querySelector('#themeProQuickStartGallery button, #appThemeFreeGallery button'), titleKey: 'laThemeTitle', textKey: 'laThemeText', clickDone: true },
    { selector: '.nav-item[data-tab="content"]', titleKey: 'laBackTitle', textKey: 'laBackText', done: () => !!document.querySelector('.nav-item[data-tab="content"].active') },
    // Aperçu de l'AdReel rempli : nouvelle fenêtre, aperçu local (rien n'est publié).
    { selector: '#btnPreview', titleKey: 'laPreviewTitle', textKey: 'laPreviewText', clickDone: true },
    { selector: '#btnPublish', titleKey: 'laSendTitle', textKey: 'laSendText', clickDone: true },
    { titleKey: 'laEndTitle', textKey: 'laEndText', final: true },
  ] },
  // Leçon « Versioning vidéo » (21/10, refaite le même jour : elle se joue dans le Backstage, pas sur la page du pack). Parcours choisi par
  // Jules-Antoine : onglet Vidéo → Atelier ; DANS l'atelier (cadre, atelier-lecons.js) : choisir le pack, la vidéo muette d'« Alone in the
  // Barque », capturer la musique 1, enregistrer le montage, version musique 2, écoute en direct ; puis, ici, le bloc vidéo d'un AdReel :
  // la vidéo du montage, ses versions, « Créer une version vidéo » qui rouvre l'atelier. Suite : annoter le montage (espace Projet).
  // `reload` : le faux serveur prépare le montage d'exemple déjà publié (deux musiques) pour la partie « bloc vidéo ».
  // « bientôt » tant que la vidéo muette (alone-gameplay-muette.mp4) n'est pas en ligne (KIT d'atelier-lecons.js).
  { id: 'versioning', theme: 'preprod', public: true, reload: true, soon: true, titleKey: 'lvTitle', descKey: 'lvDesc', steps: [
    { titleKey: 'lvWelcomeTitle', textKey: 'lvWelcomeText' },
    { selector: '.nav-item[data-tab="videoLibrary"]', titleKey: 'lvVideoTabTitle', textKey: 'lvVideoTabText',
      done: () => !!document.querySelector('.backstage-panel[data-panel="videoLibrary"].active') },
    { selector: '#panelVideoLibrary [data-video-subtab="capture"]', titleKey: 'lvAtelierTabTitle', textKey: 'lvAtelierTabText',
      done: () => !!document.querySelector('#panelVideoLibrary .video-subpanel[data-video-subpanel="capture"].active') },
    // La suite se passe DANS l'atelier (ses propres bulles) ; cette étape avance seule quand l'atelier a fini sa partie.
    { selector: '#videoAtelierFrame', titleKey: 'lvInAtelierTitle', textKey: 'lvInAtelierText', done: () => atelierLessonFinished },
    { selector: '.nav-item[data-tab="content"]', titleKey: 'lvAdreelTitle', textKey: 'lvAdreelText', done: () => !!document.querySelector('.nav-item[data-tab="content"].active') },
    { selector: '#btnAddVideoBlock', titleKey: 'laAddVideoTitle', textKey: 'laAddVideoText', clickDone: true, done: () => blocks.some(b => b.type === 'video') },
    { selector: '.block-editor-card[data-type="video"] [data-role="addBtn"]', titleKey: 'laVideoItemTitle', textKey: 'laVideoItemText', clickDone: true, done: () => blocks.some(b => b.type === 'video' && (b.videos || []).length >= 1) },
    { selector: '.block-editor-card[data-type="video"] [data-role="sourceRadio"][value="library"]', titleKey: 'laVideoSourceTitle', textKey: 'laVideoSourceText',
      done: () => lessonAdreelVideo() && lessonAdreelVideo().source === 'library' },
    { selector: '.block-editor-card[data-type="video"] [data-role="librarySelect"]', titleKey: 'lvBlockPickTitle', textKey: 'lvBlockPickText',
      done: () => !!(lessonAdreelVideo() && lessonAdreelVideo().montageId) },
    { selector: '.block-editor-card[data-type="video"] [data-role="versionSelect"]', titleKey: 'lvBlockVersionTitle', textKey: 'lvBlockVersionText' },
    { selector: '.block-editor-card[data-type="video"] [data-role="versionShown"]', titleKey: 'lvBlockMenuTitle', textKey: 'lvBlockMenuText' },
    // Explication seulement : dans un vrai compte, ce bouton rouvre l'atelier sur ce montage.
    { selector: '.block-editor-card[data-type="video"] [data-role="versionNew"]', titleKey: 'lvBlockNewTitle', textKey: 'lvBlockNewText' },
    { titleKey: 'lvEndTitle', textKey: 'lvEndText', final: true },
  ] },
  // Leçons « Préproduction » (20/10) : elles se jouent sur la page du Projet (projet.html?tuto, voir projet-lecons.js), dans un
  // Projet fictif ; `page` renvoie vers cette page au clic.
  { id: 'tracking', theme: 'pitch', public: true, soon: true, titleKey: 'ltTitle', descKey: 'ltDesc' }, // à construire ; « bientôt » d'ici là
  { id: 'pj-create', theme: 'preprod', public: true, page: 'projets', titleKey: 'plCreateTitle', descKey: 'plCreateDesc' },
  { id: 'pj-chat', theme: 'preprod', public: true, page: 'projet', titleKey: 'plChatTitle', descKey: 'plChatDesc' },
  { id: 'pj-moodboard', theme: 'preprod', public: true, page: 'projet', titleKey: 'plBoardTitle', descKey: 'plBoardDesc' },
  { id: 'pj-music', theme: 'preprod', public: true, page: 'projet', titleKey: 'plMusicTitle', descKey: 'plMusicDesc' },
  { id: 'pj-annotate', theme: 'preprod', public: true, page: 'projet', soon: true, titleKey: 'plAnnTitle', descKey: 'plAnnDesc' }, // projet-lecons.js ; « bientôt » tant que les vidéos d'« Alone » manquent
  { id: 'pj-map-build', theme: 'preprod', public: true, page: 'projet', titleKey: 'plMapBuildTitle', descKey: 'plMapBuildDesc' },
  // « Musique » et « balade » attendent les fichiers sonores d'exemple (kit MAP_MUSIC dans projet-lecons.js) : « bientôt » d'ici là.
  { id: 'pj-map-music', theme: 'preprod', public: true, page: 'projet', soon: true, titleKey: 'plMapMusicTitle', descKey: 'plMapMusicDesc' },
  { id: 'pj-map-walk', theme: 'preprod', public: true, page: 'projet', soon: true, titleKey: 'plMapWalkTitle', descKey: 'plMapWalkDesc' },
];

// Le moteur de bulles (affichage, avancement des étapes, clavier, déplacement) est partagé avec les autres pages :
// layerpitch-guide.js. Ici ne reste que ce qui est propre au Backstage : les textes, les leçons, les vignettes de fichiers
// d'exemple, la flèche de la timeline et la mémorisation de ce qui a été fait.
function tourTargetVisible(el) { return window.LayerPitchGuide.targetVisible(el); }
function tourMarkDone() { try { localStorage.setItem(TOUR_DONE_STORAGE, '1'); } catch (e) { /* stockage indisponible */ } }
function tourAlreadyDone() { try { return localStorage.getItem(TOUR_DONE_STORAGE) === '1'; } catch (e) { return false; } }
function lessonsDone() { try { return JSON.parse(localStorage.getItem(LESSONS_DONE_STORAGE) || '{}') || {}; } catch (e) { return {}; } }
function lessonMarkDone(id) { try { const d = lessonsDone(); d[id] = true; localStorage.setItem(LESSONS_DONE_STORAGE, JSON.stringify(d)); } catch (e) { /* stockage indisponible */ } }


// Leçon qui suit la leçon en cours dans le menu (ou null) : proposée sur la bulle finale.
function nextLessonOf(lessonId) {
  const i = LESSONS.findIndex(l => l.id === lessonId);
  const next = i >= 0 ? LESSONS[i + 1] : null;
  return next && next.steps && next.theme === LESSONS[i].theme && !next.reload && lessonPlayable(next) && (!next.needs || flagOpen(next.needs)) ? { lesson: next, n: i + 2 } : null;
}
const GUIDE = window.LayerPitchGuide.create({
  tr,
  nextLesson: nextLessonOf,
  startLesson: id => startLesson(id),
  onLessonDone: lessonMarkDone,
  onTourDone: tourMarkDone,
  onClose: () => renderTutorialMenu(),
  onOpen: () => { const helpTip = document.getElementById('helpTooltip'); if (helpTip) helpTip.classList.remove('visible'); },
  // Vignettes d'exemple : lot à télécharger, bouton « Utiliser » (étapes useSample dont les URL sont connues), et « bientôt
  // disponible » seulement sur les étapes qui annoncent un lot (sampleKey).
  cardExtras(step) {
    const sample = step.sampleKey ? LESSON_SAMPLE_FILES[step.sampleKey] : undefined;
    const canUse = lessonSampleReady(step);
    const many = lessonStepFileNames(step).length > 1;
    return (sample ? `<a class="tour-sample" href="${escapeAttr(sample)}" download>${escapeHtml(tr('lessonSampleDownload'))}</a>` : '')
      + (canUse && step.downloadSample ? `<a class="tour-sample" href="#" data-tour="download">${escapeHtml(tr('lessonSampleDownload'))}</a>` : '')
      + (canUse ? `<div class="tour-chip" data-tour="chip" role="button" tabindex="0" aria-label="${escapeAttr(tr('lessonChipHint'))}"><span class="tour-chip-note">♪</span><span class="tour-chip-name">${escapeHtml(many ? tr('lessonChipMany', { n: lessonStepFileNames(step).length }) : lessonStepFileNames(step)[0])}</span></div><div class="tour-sample-hint">${escapeHtml(tr('lessonChipHint'))}</div>` : '')
      + (step.sampleKey && !sample && !canUse ? `<div class="tour-sample tour-sample-soon">${escapeHtml(tr('lessonSampleSoon'))}</div>` : '');
  },
  wireCard(card, step) {
    // Lien « Télécharger le fichier d'exemple » : pour la façon « bouton » (choisir le fichier sur son ordinateur). Le fichier vient d'un
    // autre domaine : on le charge puis on le propose en téléchargement, l'attribut `download` seul serait ignoré.
    const dl = card.querySelector('[data-tour="download"]');
    if (dl) dl.addEventListener('click', async ev => {
      ev.preventDefault();
      const name = lessonStepFileNames(step)[0];
      try {
        const res = await fetch(LESSON_SAMPLE_URLS[name]);
        if (!res.ok) throw new Error(name + ' : ' + res.status);
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (err) { window.LayerPitchNotify.error(tr('lessonSampleError', { error: err.message || String(err) })); }
    });
    const chip = card.querySelector('[data-tour="chip"]');
    if (chip) chip.addEventListener('pointerdown', ev => lessonStartChipDrag(ev, step, chip));
    // Accès clavier : Entrée ou Espace sur la vignette dépose le fichier d'exemple (sans glisser à la souris).
    if (chip) chip.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      lessonUseSample(step).catch(err => window.LayerPitchNotify.error(tr('lessonSampleError', { error: err.message || String(err) })));
    });
  },
  textVars: (step, st) => ({ file: LESSON_SAMPLE_NAMES[step.names || st.lessonId] || '' }),
  arrowPoint: lessonArrowPoint,
  // Les champs de la fiche passent sous la barre fixe du haut : on les ramène au centre.
  centerTarget: (target, b) => b.top < 250 && !!target.closest('#libraryDetail'),
});
// `guide` (état de la bulle en cours, ou null) reste lisible partout dans ce fichier comme avant.
Object.defineProperty(window, 'guide', { get: () => GUIDE.state(), configurable: true });
const guideStepTarget = GUIDE.stepTarget, guideStepIsDone = GUIDE.stepIsDone, guideGo = GUIDE.go, finishGuide = GUIDE.finish, renderGuideStep = GUIDE.render, guideTick = GUIDE.tick;
function openGuide(kind, steps, lessonId) { GUIDE.open(kind, steps, lessonId); }
function closeBackstageTour() { GUIDE.close(); }
function startBackstageTour() {
  if (guide) return;
  openGuide('tour', TOUR_STEPS.filter(s => !s.selector || tourTargetVisible(document.querySelector(s.selector))));
}
function startLesson(id) {
  const lesson = LESSONS.find(l => l.id === id);
  if (lesson && lesson.page && lessonsAccessOpen() && lessonPlayable(lesson)) { window.location.href = lessonTutoUrl(lesson, id); return; }
  // Dans le tutoriel, chaque leçon repart d'un compte d'exemple propre (22/10) : changer de leçon recharge la page, sinon les restes
  // de la leçon précédente (morceau créé, fenêtres) restent à l'écran.
  if (lesson && lesson.steps && lessonsAccessOpen() && lessonPlayable(lesson) && !lesson.soon && isTutoMode() && new URLSearchParams(window.location.search).get('lesson') !== id) {
    window.location.href = window.location.pathname + '?tuto&lesson=' + encodeURIComponent(id) + '&lang=' + currentLang(); return;
  }
  if (lesson && lesson.reload && lessonsAccessOpen() && lessonPlayable(lesson) && !lesson.soon && !(isTutoMode() && new URLSearchParams(window.location.search).get('lesson') === id)) {
    window.location.href = window.location.pathname + '?tuto&lesson=' + encodeURIComponent(id) + '&lang=' + currentLang(); return;
  }
  if (!lesson || !lesson.steps || !lessonsAccessOpen() || !lessonPlayable(lesson) || (lesson.needs && !flagOpen(lesson.needs))) return;
  openGuide('lesson', lesson.steps, id);
  // Saute les étapes déjà faites au départ (par ex. bibliothèque déjà ouverte).
  const skipDone = () => { while (guide && guide.index < guide.steps.length - 1 && guide.steps[guide.index].done && guideStepIsDone(guide.steps[guide.index])) guideGo(1); };
  skipDone();
}

// ---- Menu « Tutoriel » (barre du haut) ----
const capitalizeFirst = str => str.charAt(0).toUpperCase() + str.slice(1);
function renderTutorialMenu() {
  const list = document.getElementById('tutorialMenuList');
  if (!list) return;
  const done = lessonsDone();
  const tick = '<svg class="account-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  list.innerHTML = `
    <button class="account-menu-item" type="button" data-tutorial="tour">
      <span class="account-menu-item-label"><span class="tutorial-menu-text"><b>${escapeHtml(tr('accountMenuTour'))}</b><small>${escapeHtml(tr('tutorialTourDesc'))}</small></span></span>
      ${tourAlreadyDone() ? tick : ''}
    </button>
    <div class="account-menu-sep"></div>
    <div class="tutorial-menu-heading">${escapeHtml(tr('tutorialLessonsHeading'))}</div>
    ${LESSON_THEMES.map(th => {
      const items = LESSONS.filter(l => l.theme === th.id);
      // Hiérarchie (retour de Jules-Antoine, 21/10) : « Leçons » = petite étiquette ; chaque section = vrai titre (le plus visible),
      // coupé en titre + sous-titre au « : » ; les leçons en dessous, en retrait et moins appuyées.
      const [thMain, ...thRest] = tr(th.titleKey).split(' : ');
      return `<div class="tutorial-menu-section"><strong>${escapeHtml(thMain)}</strong>${thRest.length ? `<small>${escapeHtml(capitalizeFirst(thRest.join(' : ')))}</small>` : ''}</div>` + (items.length ? items.map(l => `
      <button class="account-menu-item tutorial-menu-lesson" type="button" data-tutorial="${l.id}" ${(l.soon || !lessonPlayable(l) || (l.needs && !flagOpen(l.needs))) ? 'disabled' : ''}>
        <span class="account-menu-item-label"><span class="tutorial-menu-text"><b>${escapeHtml(tr(l.titleKey))}</b><small>${escapeHtml(lessonPlayable(l) ? tr(l.descKey) : tr('tutoNeedsAccount'))}</small></span></span>
        ${!lessonPlayable(l) ? `<span class="nav-badge">${escapeHtml(tr('tutoAccountBadge'))}</span>` : (l.soon || (l.needs && !flagOpen(l.needs))) ? `<span class="nav-badge">${escapeHtml(tr('comingSoonBadge'))}</span>` : (done[l.id] ? tick : '')}
      </button>`).join('') : `<div class="tutorial-menu-empty">${escapeHtml(tr('lessonThemeSoon'))}</div>`);
    }).join('')}`;
}
function initTutorialMenuUi() {
  const btn = document.getElementById('btnTutorialMenu');
  const dropdown = document.getElementById('tutorialMenuDropdown');
  if (!btn || !dropdown) return;
  const closeMenu = () => { dropdown.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = dropdown.hidden;
    if (willOpen) renderTutorialMenu();
    dropdown.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) document.dispatchEvent(new CustomEvent('lp-header-menu-open', { detail: 'tutorial' }));
  });
  document.addEventListener('lp-header-menu-open', (e) => { if (e.detail !== 'tutorial' && !dropdown.hidden) closeMenu(); });
  document.addEventListener('click', (e) => { if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== btn) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('[data-tutorial]');
    if (!item || item.disabled) return;
    closeMenu();
    const id = item.dataset.tutorial;
    if (id === 'tour') { startBackstageTour(); return; }
    // Décidé le 20/10 : le tutoriel se joue TOUJOURS en mode sans compte (faux compte local, rien d'enregistré), pour tout le monde,
    // y compris depuis un vrai Backstage : un seul tutoriel à maintenir. On y entre en rechargeant la page avec la leçon demandée.
    const l = LESSONS.find(x => x.id === id);
    // Nouvelle fenêtre (22/10) : le vrai Backstage reste ouvert à côté du tutoriel.
    if (!isTutoMode() && l && !l.soon) { window.open(lessonTutoUrl(l, id), '_blank', 'noopener'); return; }
    startLesson(id);
  });
}
// Appelée une fois les feux verts connus (fin de renderAdminOnlyPanels) : montre le menu et lance la visite la toute
// première fois, sans jamais la relancer ensuite.
function syncBackstageTour() {
  const open = flagOpen('in_app_tour');
  const menuItem = document.getElementById('accountMenuTour');
  if (menuItem) menuItem.hidden = !open;
  // Le menu « Tutoriel » et les leçons ont leur propre feu vert : on peut ouvrir la visite sans ouvrir les leçons.
  const lessonsOpen = lessonsAccessOpen();
  const wrap = document.getElementById('tutorialMenuWrap');
  if (wrap) wrap.hidden = !lessonsOpen;
  if (lessonsOpen) renderTutorialMenu();
  const wanted = isTutoMode() ? new URLSearchParams(window.location.search).get('lesson') : null;
  if (wanted && lessonsOpen && !guide && !window.__lessonAutoStarted) { window.__lessonAutoStarted = true; setTimeout(() => startLesson(wanted), 900); return; }
  if (open && !tourAlreadyDone() && !guide) setTimeout(startBackstageTour, 600);
}
(function wireTourMenu() {
  const item = document.getElementById('accountMenuTour');
  if (item) item.addEventListener('click', () => {
    const dd = document.getElementById('accountMenuDropdown');
    if (dd) dd.hidden = true;
    startBackstageTour();
  });
  initTutorialMenuUi();
})();
// Mode tutoriel (?tuto) : bandeau « rien n'est enregistré » + bouton Quitter (retour au Backstage normal, sans ?tuto).
(function initTutoBanner() {
  if (!isTutoMode()) return;
  const banner = document.getElementById('tutoBanner');
  if (!banner) return;
  banner.hidden = false;
  // « Visualiser le résultat » ouvre la vraie page publique du compte : rien à voir avec le compte fictif.
  const viewBtn = document.getElementById('btnView');
  if (viewBtn) { viewBtn.disabled = true; viewBtn.title = tr('tutoNoPublicLink'); }
  document.getElementById('btnTutoQuit').addEventListener('click', () => { window.location.href = window.location.pathname; });
})();
