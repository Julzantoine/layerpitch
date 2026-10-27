/* layerpitch-import-engine.js — moteur de lecture des NOMS de fichiers audio (tempo, mesures, rôles, familles, structure).
   Fonctions pures : un nom (ou une liste de fichiers { name }) entre, une réponse sort ; aucun accès à la page, au réseau ni à
   l'audio. Une SEULE copie : le Backstage (navigateur) le charge par balise <script> et le futur serveur MCP l'importera tel quel
   (require / import) -- il ne peut donc pas y avoir deux versions qui se contredisent. Les noms lus et leurs règles sont décrits dans
   layerpitch-docs/convention-nommage-fichiers.md ; test de référence : test_import_engine.js (dossiers réels de Jules-Antoine).
   Extrait de src/backstage/16-bibliotheque-de-morceaux.js et 16a-import-de-dossier.js le 27/10 (phase 1 du MCP), sans changer le comportement. */
(function (root) {
'use strict';
function titleFromFilename(filename) {
  return filename.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim();
}
// Reconnaissance de bpm/nombre de mesures dans le nom d'un fichier déposé (demande du 13/08, nomenclature
// de Jules-Antoine : "..._160bpm_40M.wav") — restaurée le 01/09 après une disparition accidentelle
// constatée en investiguant la dérive des tests (aucune trace de suppression volontaire, contrairement aux
// changements du 18/08 qui portent tous un commentaire de refonte). Jeton bpm ("\d+bpm") et jeton mesures
// ("\d+M") isolés par un séparateur (_, -, espace) ou une limite de chaîne des deux côtés, pour éviter un
// faux positif du type "Room40Meters" (le "M" colle directement à "eters", donc pas de limite après).
function parseAudioFilenameHints(filename) {
  const bpmMatch = filename.match(/(?:^|[_\s-])(\d+)bpm(?=[_\s.-]|$)/i);
  const barsMatch = filename.match(/(?:^|[_\s-])(\d+)M(?=[_\s.-]|$)/);
  return { bpm: bpmMatch ? parseInt(bpmMatch[1], 10) : null, bars: barsMatch ? parseInt(barsMatch[1], 10) : null };
}
// Mesures d'intro DANS une boucle (« ..._120bpm_18M_intro2M.wav » : les 2 premières mesures ne rebouclent pas), 11/10.
// Fonction à part (et non un champ de plus de parseAudioFilenameHints, dont le résultat est comparé tel quel par des tests).
function parseIntroBarsHint(filename) {
  const m = filename.match(/(?:^|[_\s-])intro(\d+)M(?=[_\s.-]|$)/i);
  return m ? parseInt(m[1], 10) : null;
}
// Même principe que titleFromFilename() ci-dessus, mais retire d'abord les jetons bpm/mesures repérés par
// parseAudioFilenameHints() — pour ne pas les laisser traîner dans le libellé affiché d'un emplacement.
function titleFromFilenameStrippingHints(filename) {
  return filename.replace(/\.[^/.]+$/, '')
    .replace(/(?:^|[_\s-])(\d+)bpm(?=[_\s.-]|$)/i, '')
    .replace(/(?:^|[_\s-])(\d+)M(?=[_\s.-]|$)/, '')
    .replace(/(?:^|[_\s-])intro(\d+)M(?=[_\s.-]|$)/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}
// Devine le rôle (intro/segment/outro) d'un fichier déposé en lot dans le mode séquentiel, à partir de
// son nom. "Segment" par défaut si rien ne correspond — reste ajustable ensuite via le sélecteur "Rôle".
// Séparateurs explicites plutôt que \b (25/09) : pour \b le tiret bas est une lettre, donc
// "The_Last_Door_Intro_120bpm_14M.wav" n'était jamais reconnu comme intro.
function guessSequentialRole(filename) {
  const n = filename.toLowerCase().replace(/\.[^/.]+$/, '');
  if (/(?:^|[^a-z0-9])intro(?:only)?(?:$|[^a-z0-9])/.test(n)) return 'intro'; // « IntroONLY » (22/10) : l'intro seule du morceau Jazz Lo du tuto
  if (/(?:^|[^a-z0-9])outro(?:only)?(?:$|[^a-z0-9])/.test(n)) return 'outro';
  return 'segment';
}
// ---- Dépôt groupé "par familles de noms" (25/09, demandes de Jules-Antoine) ----
// Sert aux pools d'une section vertical-random et à la bibliothèque Sfx (un Sfx par famille, ses fichiers en
// variations round-robin). L'intro/outro est reconnue au nom (guessSequentialRole) quand c'est pertinent, le
// reste est rangé par racine de nom commune ("Alt Perc 1", "Alt Perc 1.5" -> "Alt Perc"). Rien n'est écrit
// tant que le compositeur n'a pas validé la fenêtre de vérification (openGroupedDropDialog) : déplacer un
// fichier, renommer un groupe, piste vide par pool, tempo/mesures lus dans les noms.
function nameFamilyKey(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
// Retire les marques de variante en fin de nom, de façon répétée : "(8th)", "#2", "1.5", "BS1" -> "BS".
// Si tout le nom y passe (fichier "01.wav"), on garde le nom tel quel.
function stripVariantSuffix(label) {
  const orig = (label || '').trim();
  let s = orig, prev;
  do {
    prev = s;
    s = s.replace(/\s*\([^()]*\)\s*$/, '').replace(/\s*#?\s*\d+(?:[.,]\d+)?\s*$/, '').trim();
  } while (s && s !== prev);
  return s || orig;
}
// Variante "large" : retire aussi une lettre isolée finale ("Hit A", "Hit B", "Step v2") -- appliquée
// seulement si elle réunit vraiment plusieurs fichiers, pour ne pas abîmer un nom comme "Plan B" seul.
function stripVariantSuffixLoose(label) {
  const s = stripVariantSuffix(label);
  const t = s.replace(/\s+(?:v\d*|[a-z])$/i, '').trim();
  return t ? stripVariantSuffix(t) : s;
}
function groupFilesByNameFamily(files, detectIntroOutro) {
  let intro = null, outro = null;
  const rest = [];
  files.forEach(f => {
    const role = detectIntroOutro ? guessSequentialRole(f.name) : 'segment';
    if (role === 'intro' && !intro) intro = f;
    else if (role === 'outro' && !outro) outro = f;
    else rest.push(f);
  });
  // Nom de pool = ce qui précède le premier « _ » (« BS_Stories… », « DM_Foothills… » -> pools BS et DM) : au moins 2 fichiers qui
  // le partagent (casse ignorée) forment un seul pool (21/10, règle choisie par Jules-Antoine : plus simple et sans piège que
  // les majuscules). Un fichier sans « _ », ou seul sous son préfixe, suit les règles de familles de noms ci-dessous.
  const prefixOf = f => { const m = f.name.match(/^([^_]+)_/); const p = m ? m[1].trim() : ''; return p || null; };
  const prefixCount = new Map();
  rest.forEach(f => { const p = prefixOf(f); if (p) { const k = p.toLowerCase(); prefixCount.set(k, (prefixCount.get(k) || 0) + 1); } });
  const codeGroups = new Map();
  for (let i = rest.length - 1; i >= 0; i--) {
    const p = prefixOf(rest[i]);
    if (!p || prefixCount.get(p.toLowerCase()) < 2) continue;
    const k = p.toLowerCase();
    if (!codeGroups.has(k)) codeGroups.set(k, { label: p, files: [] });
    codeGroups.get(k).files.unshift(rest.splice(i, 1)[0]);
  }
  const strictLabel = f => stripVariantSuffix(titleFromFilenameStrippingHints(f.name));
  const looseCount = new Map();
  rest.forEach(f => { const k = nameFamilyKey(stripVariantSuffixLoose(strictLabel(f))); looseCount.set(k, (looseCount.get(k) || 0) + 1); });
  const groups = new Map();
  rest.forEach(f => {
    const strict = strictLabel(f);
    const loose = stripVariantSuffixLoose(strict);
    const label = looseCount.get(nameFamilyKey(loose)) >= 2 ? loose : strict;
    const key = nameFamilyKey(label);
    if (!groups.has(key)) groups.set(key, { label, files: [] });
    groups.get(key).files.push(f);
  });
  // Un fichier resté seul rejoint le groupe dont le nom est le début du sien ("BS SLAP" -> "BS"), à
  // condition que ce groupe soit une vraie famille (au moins 2 fichiers) -- "Main Perc" reste à part.
  const familyKeys = [...groups.keys()].filter(k => groups.get(k).files.length >= 2);
  [...groups.keys()].forEach(k => {
    const g = groups.get(k);
    if (g.files.length !== 1) return;
    const words = k.split(' ');
    for (let n = words.length - 1; n >= 1; n--) {
      const prefix = words.slice(0, n).join(' ');
      if (familyKeys.includes(prefix)) { groups.get(prefix).files.push(...g.files); groups.delete(k); break; }
    }
  });
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  return { intro, outro, groups: [...codeGroups.values(), ...groups.values()].map(g => ({ label: g.label, files: g.files.sort(byName) })) };
}
// Premier fichier (hors intro/outro) dont le nom porte un tempo ou un nombre de mesures.
// anyRole (21/10) : morceau à couches / boucles, où « intro » dans un nom (« Jazz Hi_2bts Intro_8M_110bpm ») n'est pas un rôle à part --
// tous les fichiers comptent, sinon ce nom ne proposait jamais son tempo.
function firstFilenameHints(files, anyRole) {
  const f = files.find(x => { const h = parseAudioFilenameHints(x.name); return (anyRole || guessSequentialRole(x.name) === 'segment') && (h.bpm || h.bars || parseIntroBarsHint(x.name)); });
  // introBars (11/10, « ..._intro2M ») s'ajoute ici, pas dans parseAudioFilenameHints (comparé tel quel par des tests).
  return f ? { file: f, hints: Object.assign({}, parseAudioFilenameHints(f.name), { introBars: parseIntroBarsHint(f.name) }) } : null;
}
// Un fichier « Transition #1.wav » : audio joué à la bascule vers une boucle d'un embranchement (11/10, dossier réel de
// Jules-Antoine : « #1 … », « #2 … », « Transition #1 », « Transition #2 »).
function isTransitionFile(name) {
  return /(?:^|[^a-z0-9])transitions?(?:$|[^a-z0-9])/i.test((name || '').replace(/\.[^/.]+$/, ''));
}
// Numéro « #N » (ou « 1. » en tête) d'un nom, pour relier une transition à sa boucle.
// Le numéro doit être isolé : « #1bis_SecretLever_Transition » n'est PAS le « #1 » d'une boucle (11/10, dossier RobotAdventure).
function folderImportNumber(name) {
  const m = (name || '').match(/#\s*(\d+(?:[.,]\d+)?)(?![A-Za-z0-9])/) || (name || '').match(/^\s*(\d+)\s*[.\-_ ]/);
  return m ? m[1].replace(',', '.') : null;
}
// Boucles + transitions rattachées : par numéro commun, puis par ordre pour les transitions restantes.
function pairLoopsWithTransitions(files) {
  const transitions = files.filter(f => isTransitionFile(f.name));
  const loops = files.filter(f => !isTransitionFile(f.name));
  if (!loops.length) return { loops: files, transitions: [], pairs: [] };
  const taken = new Set();
  const pairs = loops.map(l => {
    const n = folderImportNumber(l.name);
    const t = n && transitions.find(x => !taken.has(x) && folderImportNumber(x.name) === n);
    if (t) taken.add(t);
    return { loop: l, transition: t || null };
  });
  const rest = transitions.filter(t => !taken.has(t));
  pairs.forEach(pr => { if (!pr.transition && rest.length) pr.transition = rest.shift(); });
  return { loops, transitions, pairs, unassigned: rest };
}
// Structure la plus probable pour un dossier, avec la raison (affichée au compositeur). Pure : testée sans page.
// Ordre : le nom du dossier d'abord (il l'a écrit), puis l'intensité dans les noms, puis les alternatives numérotées,
// puis une intro/outro, sinon une couche par fichier.
function guessFolderStructure(folderName, files) {
  const n = nameFamilyKey(folderName || '');
  if (/embranch|branching/.test(n)) return { mode: 'embranchement-vertical', why: 'name' };
  if (/random|aleatoire/.test(n) && /vertical|layer|couche/.test(n)) return { mode: 'vertical-random', why: 'name' };
  if (/sequenti/.test(n)) return { mode: 'sequential', why: 'name' };
  if (/layer|vertical|couche/.test(n)) return { mode: 'vertical', why: 'name' };
  // Des transitions rattachées à des boucles : un embranchement. Prudence : « Transition » est aussi un nom courant dans
  // un séquentiel (« #1bis_SecretLever_Transition »), donc : jamais avec intro/outro, et seulement si chaque transition
  // porte le numéro d'une boucle ou si le dossier n'a pas de familles d'alternatives.
  const transFiles = files.filter(f => isTransitionFile(f.name)), otherFiles = files.filter(f => !isTransitionFile(f.name));
  if (transFiles.length && otherFiles.length && !otherFiles.some(f => guessSequentialRole(f.name) !== 'segment')) {
    const loopNumbers = new Set(otherFiles.map(f => folderImportNumber(f.name)).filter(Boolean));
    const allNumbered = transFiles.every(t => { const n = folderImportNumber(t.name); return n && loopNumbers.has(n); });
    if (allNumbered) return { mode: 'embranchement-vertical', why: 'transitions' };
    // Une transition qui ne porte le numéro d'aucune boucle : embranchement, ou séquentiel avec une bifurcation ? Rien ne
    // le dit dans les noms -> on le demande, on ne présélectionne rien (RobotAdventure : séquentiel à embranchement).
    if (!groupFilesByNameFamily(otherFiles, false).groups.some(x => x.files.length >= 2)) return { mode: 'vertical', why: 'transitionsUnclear' };
  }
  // Un seul fichier (21/10) : un morceau statique, une seule piste -- ni couches, ni étapes, ni boucles à empiler.
  if (files.length === 1) return { mode: 'static', why: 'single' };
  const intensity = files.filter(f => /(?:^|[^a-z])(?:low|med|medium|mid|high)[\s_-]?intensit|intensit/i.test(f.name)).length;
  if (files.length >= 2 && intensity >= 2) return { mode: 'vertical', why: 'intensity' };
  const g = groupFilesByNameFamily(files, true);
  if (g.groups.some(x => x.files.length >= 2)) return { mode: 'vertical-random', why: 'variants' };
  if (g.intro || g.outro) return { mode: 'sequential', why: 'introOutro' };
  return { mode: 'vertical', why: 'default' };
}
// Slots du séquentiel : « Door #1.1 », « Door #1.2 » forment le slot « Door #1 » (variations) ; « Door #2 » est un autre slot.
// Plus fin que la famille de noms des pools, qui réunirait « Door #1 » et « Door #2 » en un seul groupe.
function groupFilesBySequentialSlot(files) {
  let intro = null, outro = null;
  const order = [], bySlot = new Map();
  files.forEach(f => {
    const role = guessSequentialRole(f.name);
    if (role === 'intro' && !intro) { intro = f; return; }
    if (role === 'outro' && !outro) { outro = f; return; }
    const base = titleFromFilenameStrippingHints(f.name);
    const m = base.match(/^(.*\d)\s*[.,]\s*\d+$/);
    const label = m ? m[1].trim() : base;
    const key = nameFamilyKey(label);
    if (!bySlot.has(key)) { bySlot.set(key, { label, files: [] }); order.push(key); }
    bySlot.get(key).files.push(f);
  });
  return { intro, outro, groups: order.map(k => bySlot.get(k)) };
}
const FOLDER_IMPORT_MODES = ['vertical-random', 'vertical', 'sequential', 'embranchement-vertical'];
const FOLDER_IMPORT_AUDIO_RE = /\.(wav|mp3)$/i;
const folderImportByName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const engine = {
  titleFromFilename, parseAudioFilenameHints, parseIntroBarsHint, titleFromFilenameStrippingHints, guessSequentialRole,
  nameFamilyKey, stripVariantSuffix, stripVariantSuffixLoose, groupFilesByNameFamily, firstFilenameHints,
  isTransitionFile, folderImportNumber, pairLoopsWithTransitions, guessFolderStructure, groupFilesBySequentialSlot,
  FOLDER_IMPORT_MODES, FOLDER_IMPORT_AUDIO_RE, folderImportByName,
};
if (typeof module !== 'undefined' && module.exports) module.exports = engine;
if (root) root.LayerPitchImportEngine = engine;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
