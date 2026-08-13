#!/usr/bin/env node
/**
 * LayerPitch — cycle de vie de la bêta (à exécuter en local, Node 18+ requis pour fetch natif)
 *
 * Commandes :
 *   node layerpitch-beta-sync.js promote
 *     → copie les fichiers "moteur" de ton repo perso vers le repo template bêta,
 *       et régénère le data.json de départ (squelette vide, mêmes blocs que ton AdReel principal).
 *
 *   node layerpitch-beta-sync.js create <nomTesteur>
 *     → crée un nouveau repo dans l'org bêta à partir du template, avec owner/repo
 *       déjà pré-remplis dans le backstage du testeur.
 *
 *   node layerpitch-beta-sync.js rollout <nomTesteur|--all>
 *     → pousse les fichiers "moteur" à jour du template vers un ou tous les testeurs actifs,
 *       en vérifiant d'abord la compatibilité de schéma (n'écrase jamais data.json/events.json).
 *       Crée automatiquement une branche de sauvegarde de main avant toute modification.
 *
 *   node layerpitch-beta-sync.js restore <nomTesteur> [nomBrancheSauvegarde] [--notify]
 *     → rétablit les fichiers "moteur" d'un testeur depuis une branche de sauvegarde (la plus
 *       récente si non précisée) — n'écrase jamais data.json/events.json, même si présents dans
 *       la branche de sauvegarde. Crée elle-même une sauvegarde de l'état actuel avant de rétablir.
 *       Avec --notify : affiche un bandeau d'alerte dans le Backstage du testeur (voir "notify").
 *
 *   node layerpitch-beta-sync.js list-backups <nomTesteur>
 *     → liste les branches de sauvegarde disponibles pour ce testeur, la plus récente en premier.
 *
 *   node layerpitch-beta-sync.js notify <nomTesteur|--all> --fr "message" --en "message"
 *     → affiche un bandeau d'alerte dans le Backstage du/des testeur(s) visé(s), dans la langue de
 *       son AdReel principal. Fusion ciblée d'un seul champ (data.backstageNotice) dans son data.json
 *       — jamais un remplacement de contenu. Le testeur le fait disparaître lui-même en cliquant
 *       "J'ai vu" dans son Backstage (republie son propre data.json avec son propre token).
 *
 * Token requis dans la variable d'environnement GH_TOKEN (jamais en dur dans ce fichier) :
 * un token fine-grained avec accès à ton repo perso ET à l'organisation bêta
 * (permissions : Contents Read/Write, Administration Read/Write pour la création de repos).
 * Contents suffit aussi pour créer des branches de sauvegarde (git/refs) et pour la commande
 * notify (simple écriture de fichier) — pas de scope supplémentaire à ajouter.
 *
 * layerpitch-backstage.html n'est jamais poussé sur ton repo perso GitHub (outil local, jamais publié)
 * — promote() le lit directement sur ton disque (BACKSTAGE_LOCAL_PATH, dossier courant par défaut),
 * pas via l'API. Lance donc ce script depuis le dossier qui contient tes 4 fichiers moteur en local.
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  PERSONAL_OWNER: 'Julzantoine',
  PERSONAL_REPO: 'layerpitch',
  BETA_ORG: '', // ← à remplir une fois l'organisation créée (ex. "layerpitch-beta")
  TEMPLATE_REPO: 'layerpitch-beta-template',
  BRANCH: 'main',
  // layerpitch-backstage.html n'est JAMAIS poussé sur le repo perso GitHub (outil d'édition local
  // uniquement, par choix assumé) — impossible de le lire via l'API comme les autres fichiers moteur.
  // Lu directement sur le disque à chaque promote(). Chemin relatif au dossier d'où le script est lancé ;
  // surchargeable via la variable d'environnement BACKSTAGE_LOCAL_PATH si le fichier vit ailleurs.
  BACKSTAGE_LOCAL_PATH: process.env.BACKSTAGE_LOCAL_PATH || path.join(process.cwd(), 'layerpitch-backstage.html'),
  // Fichiers "moteur", synchronisés à chaque promote/rollout — jamais data.json ni events.json.
  // Mis à jour le 16 juillet : layerpitch-i18n.js (chargé par index.html, pack.html,
  // layerpitch-backstage.html ET video-test.html), layerpitch-help.js (bulles d'aide, backstage
  // uniquement) et video-test.html (Mode Test Gameplay) manquaient — un tester se serait retrouvé
  // avec des clés de traduction brutes à l'écran, aucune bulle d'aide, et une page de test gameplay
  // cassée (404). layerpitch-i18n-editor.html et layerpitch-help-editor.html restent volontairement
  // absents de cette liste : outils de travail locaux, jamais destinés aux repos testeurs.
  // Mis à jour le 18 juillet : collection.html (nouvelle page publique, page dédiée aux collections de
  // packs) manquait — un testeur qui active une collection se serait retrouvé avec un lien mort (404).
  ENGINE_FILES: ['index.html', 'pack.html', 'collection.html', 'player.js', 'layerpitch-backstage.html', 'layerpitch-i18n.js', 'layerpitch-help.js', 'video-test.html'],
  // Dans le template, layerpitch-backstage.html contient ce texte à la place d'un vrai nom de repo.
  // create()/rollout() le remplacent par le vrai nom du repo du testeur à chaque copie.
  REPO_PLACEHOLDER: '__TESTER_REPO__',
  SCHEMA_VERSION: 1, // ← à incrémenter manuellement quand la forme de data.json change de façon significative
};

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error('Erreur : variable d\'environnement GH_TOKEN manquante.');
  console.error('Lance avec : GH_TOKEN=ghp_xxx node layerpitch-beta-sync.js <commande> ...');
  process.exit(1);
}

const API = 'https://api.github.com';
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28',
};

async function gh(path, options = {}) {
  const res = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${options.method || 'GET'} ${path} → ${res.status} ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

function toBase64(str) { return Buffer.from(str, 'utf-8').toString('base64'); }
function fromBase64(b64) { return Buffer.from(b64.replace(/\n/g, ''), 'base64').toString('utf-8'); }

async function getContent(owner, repo, path) {
  try {
    return await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${CONFIG.BRANCH}`);
  } catch (e) {
    if (e.message.includes('404')) return null;
    throw e;
  }
}

async function putFile(owner, repo, path, contentUtf8, message) {
  const existing = await getContent(owner, repo, path);
  const body = {
    message,
    content: toBase64(contentUtf8),
    branch: CONFIG.BRANCH,
    ...(existing ? { sha: existing.sha } : {}),
  };
  return gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function repoExists(owner, repo) {
  try { await gh(`/repos/${owner}/${repo}`); return true; }
  catch (e) { if (e.message.includes('404')) return false; throw e; }
}

async function createRepoFromTemplate(org, templateRepo, newRepoName) {
  // Repos publics par choix assumé : évite un plan GitHub payant (Pages sur repo privé), vu que le code
  // n'a aucun secret en dur et que les compositeurs déposent leurs morceaux avant de les exposer. Passe
  // à `private: true` si ce choix change (et prévoir un plan payant pour que Pages continue de servir).
  return gh(`/repos/${org}/${templateRepo}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner: org, name: newRepoName, private: false, include_all_branches: false }),
  });
}

async function listOrgRepos(org, prefix) {
  let page = 1, all = [];
  while (true) {
    const batch = await gh(`/orgs/${org}/repos?per_page=100&page=${page}`);
    all = all.concat(batch);
    if (batch.length < 100) break;
    page++;
  }
  return all.filter(r => r.name.startsWith(prefix) && r.name !== CONFIG.TEMPLATE_REPO);
}

/* ---------------- Git refs (branches) — pour les sauvegardes ---------------- */
async function getRefSha(owner, repo, branch) {
  const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

async function createRef(owner, repo, refName, sha) {
  return gh(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${refName}`, sha }),
  });
}

// Liste les branches "backup-*" d'un repo, triées de la plus récente à la plus ancienne. Le tri
// alphabétique du nom suffit : format AAAA-MM-JJ[-HHhMM], donc l'ordre alphabétique EST l'ordre
// chronologique — pas besoin d'appel supplémentaire pour récupérer une date de commit.
async function listBackupBranches(owner, repo) {
  let branches;
  try {
    branches = await gh(`/repos/${owner}/${repo}/git/matching-refs/heads/backup-`);
  } catch (e) {
    if (e.message.includes('404')) return [];
    throw e;
  }
  return branches
    .map(b => ({ name: b.ref.replace('refs/heads/', ''), sha: b.object.sha }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

// Crée une branche de sauvegarde pointant sur le SHA actuel de main — une vraie branche Git (référence
// légère, aucune duplication de fichiers). Nom du jour par défaut (backup-AAAA-MM-JJ) ; bascule sur un nom
// horodaté (+ heure/minute) en cas de collision, pour permettre plusieurs sauvegardes le même jour sans
// jamais en écraser une — createRef échoue avec un 422 si la ref existe déjà, jamais un écrasement silencieux.
async function createBackupBranch(owner, repo) {
  const sha = await getRefSha(owner, repo, CONFIG.BRANCH);
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);
  let branchName = `backup-${datePart}`;
  try {
    await createRef(owner, repo, branchName, sha);
  } catch (e) {
    if (!e.message.includes('422')) throw e;
    const timePart = now.toISOString().slice(11, 16).replace(':', 'h');
    branchName = `backup-${datePart}-${timePart}`;
    await createRef(owner, repo, branchName, sha);
  }
  return branchName;
}

async function getContentAtRef(owner, repo, path, ref) {
  try {
    return await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`);
  } catch (e) {
    if (e.message.includes('404')) return null;
    throw e;
  }
}

/* ---------------- Bandeau d'alerte (data.backstageNotice) ----------------
 * SEULE exception délibérée à la règle "on ne touche jamais au data.json du testeur" : une fusion
 * ciblée d'un seul champ technique, jamais un remplacement de contenu — et toujours déclenchée
 * explicitement par une commande dédiée (notify, ou restore --notify), jamais automatique.
 * Le testeur la fait disparaître lui-même depuis son Backstage (bouton "J'ai vu"), avec son propre
 * token — ce script ne republie jamais rien "pour effacer" après coup.
 */
async function sendNotice(owner, repo, frText, enText) {
  const existing = await getContent(owner, repo, 'data.json');
  if (!existing) { console.warn(`  ⚠ ${repo} : data.json introuvable, notification ignorée.`); return false; }
  let data;
  try { data = JSON.parse(fromBase64(existing.content)); }
  catch { console.warn(`  ⚠ ${repo} : data.json illisible, notification ignorée.`); return false; }

  const mainAdReel = (data.adReels || []).find(a => a.id === 'main') || (data.adReels || [])[0];
  const lang = (mainAdReel && mainAdReel.lang === 'en') ? 'en' : 'fr';
  data.backstageNotice = { message: lang === 'en' ? enText : frText, ts: new Date().toISOString() };

  await gh(`/repos/${owner}/${repo}/contents/data.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'notify: bandeau d\'alerte pour le testeur',
      content: toBase64(JSON.stringify(data, null, 2)),
      branch: CONFIG.BRANCH,
      sha: existing.sha,
    }),
  });
  return true;
}

/* ---------------- Génération du data.json de départ ---------------- */
// Reprend les mêmes TYPES de blocs que l'AdReel "main" de ton repo perso, dans le même ordre,
// mais vide tout le contenu. Ainsi le squelette suit automatiquement l'évolution de ta propre page,
// sans fichier séparé à maintenir à la main.
// Un nouveau testeur démarre toujours avec ces 4 blocs vierges (header/bio/témoignages/morceaux),
// jamais un décalque des blocs de l'AdReel personnel de l'admin — celui-ci peut très bien contenir des
// blocs texte/photo/packs propres à son propre portfolio, qui n'ont aucune raison de se retrouver chez
// un testeur qui démarre de zéro.
function buildStarterDataJson() {
  const emptyBlocks = [
    { id: 'b_header', type: 'header' }, { id: 'b_bio', type: 'bio' },
    { id: 'b_testimonials', type: 'testimonials' }, { id: 'b_tracks', type: 'tracks' },
  ];
  return {
    schemaVersion: CONFIG.SCHEMA_VERSION,
    publishedAt: null,
    library: [],
    packs: [],
    collections: [],
    customFonts: [],
    sfxLibrary: [],
    socials: [],
    implementationSkills: { wwise: false, fmod: false, unity: false, unreal: false },
    adReels: [{
      id: 'main',
      label: 'Principal',
      blocks: emptyBlocks,
      profile: {
        title: '', subtitle: '', bio: '', contactEmail: '', contactUrl: '', formspreeEndpoint: '',
        logo: null, photo: null, theme: { bgColor: '#f6f5f3', titleColor: '#262521', contentColor: '#262521' },
      },
      testimonials: [],
      trackIds: [],
      trackOverrides: {},
    }],
  };
}

/* ---------------- Vérification de compatibilité de schéma ---------------- */
async function checkSchemaCompatible(owner, repo) {
  const existing = await getContent(owner, repo, 'data.json');
  if (!existing) return { compatible: true, reason: 'aucun data.json existant' };
  let data;
  try { data = JSON.parse(fromBase64(existing.content)); }
  catch { return { compatible: false, reason: 'data.json illisible (JSON invalide)' }; }
  const version = data.schemaVersion || 1;
  if (version !== CONFIG.SCHEMA_VERSION) {
    return { compatible: false, reason: `schemaVersion ${version} (testeur) ≠ ${CONFIG.SCHEMA_VERSION} (nouveau code)` };
  }
  return { compatible: true };
}

/* ---------------- Commande : promote ---------------- */
async function promote() {
  if (!CONFIG.BETA_ORG) { console.error('BETA_ORG non configuré dans CONFIG — crée d\'abord l\'organisation.'); process.exit(1); }
  console.log(`Promotion : ${CONFIG.PERSONAL_OWNER}/${CONFIG.PERSONAL_REPO} → ${CONFIG.BETA_ORG}/${CONFIG.TEMPLATE_REPO}`);

  for (const file of CONFIG.ENGINE_FILES) {
    let content;
    if (file === 'layerpitch-backstage.html') {
      if (!fs.existsSync(CONFIG.BACKSTAGE_LOCAL_PATH)) {
        console.warn(`  ⚠ layerpitch-backstage.html introuvable sur le disque (${CONFIG.BACKSTAGE_LOCAL_PATH}), ignoré.`);
        console.warn('    → lance le script depuis le dossier qui le contient, ou fixe BACKSTAGE_LOCAL_PATH.');
        continue;
      }
      content = fs.readFileSync(CONFIG.BACKSTAGE_LOCAL_PATH, 'utf-8')
        .replace(new RegExp(`value="${CONFIG.PERSONAL_OWNER}"`), `value="${CONFIG.BETA_ORG}"`)
        .replace(new RegExp(`value="${CONFIG.PERSONAL_REPO}"`), `value="${CONFIG.REPO_PLACEHOLDER}"`);
    } else {
      const src = await getContent(CONFIG.PERSONAL_OWNER, CONFIG.PERSONAL_REPO, file);
      if (!src) { console.warn(`  ⚠ ${file} introuvable dans le repo perso, ignoré.`); continue; }
      content = fromBase64(src.content);
    }
    await putFile(CONFIG.BETA_ORG, CONFIG.TEMPLATE_REPO, file, content, `promote: sync ${file} depuis ${file === 'layerpitch-backstage.html' ? 'ton disque local' : CONFIG.PERSONAL_REPO}`);
    console.log(`  ✓ ${file}`);
  }

  const starter = buildStarterDataJson();
  await putFile(CONFIG.BETA_ORG, CONFIG.TEMPLATE_REPO, 'data.json', JSON.stringify(starter, null, 2), 'promote: régénère le data.json de départ (squelette vide)');
  console.log('  ✓ data.json (squelette régénéré)');
  console.log('Promotion terminée.');
}

/* ---------------- Commande : create ---------------- */
async function create(testerName) {
  if (!CONFIG.BETA_ORG) { console.error('BETA_ORG non configuré dans CONFIG — crée d\'abord l\'organisation.'); process.exit(1); }
  const repoName = `layerpitch-beta-${testerName}`;
  if (await repoExists(CONFIG.BETA_ORG, repoName)) {
    console.error(`Le repo ${CONFIG.BETA_ORG}/${repoName} existe déjà.`);
    process.exit(1);
  }
  console.log(`Création de ${CONFIG.BETA_ORG}/${repoName} depuis le template…`);
  await createRepoFromTemplate(CONFIG.BETA_ORG, CONFIG.TEMPLATE_REPO, repoName);

  // Le "generate from template" peut prendre quelques secondes côté GitHub avant que le contenu soit prêt.
  await new Promise(r => setTimeout(r, 3000));

  const backstageFile = await getContent(CONFIG.BETA_ORG, repoName, 'layerpitch-backstage.html');
  if (backstageFile) {
    const content = fromBase64(backstageFile.content).replaceAll(CONFIG.REPO_PLACEHOLDER, repoName);
    await putFile(CONFIG.BETA_ORG, repoName, 'layerpitch-backstage.html', content, `create: pré-remplissage owner/repo pour ${testerName}`);
    console.log('  ✓ backstage pré-rempli avec le bon nom de repo');
  }
  // events.json initialisé dès la création avec le nom choisi (testerId) plutôt que de laisser les
  // analytics se rabattre sur le slug du repo tant qu'aucune activité n'a eu lieu — le testeur apparaît
  // par son nom dès qu'on recharge la console, même à zéro action.
  await putFile(CONFIG.BETA_ORG, repoName, 'events.json', JSON.stringify({ testerId: testerName, events: [] }, null, 2), `create: initialise events.json pour ${testerName}`);
  console.log('  ✓ events.json initialisé (testerId: ' + testerName + ')');
  console.log(`Repo prêt : https://github.com/${CONFIG.BETA_ORG}/${repoName}`);
  console.log('Reste à faire manuellement : générer un token fine-grained scopé à ce seul repo et le transmettre au testeur.');
}

/* ---------------- Commande : rollout ---------------- */
async function rollout(target) {
  if (!CONFIG.BETA_ORG) { console.error('BETA_ORG non configuré dans CONFIG — crée d\'abord l\'organisation.'); process.exit(1); }
  const repos = target === '--all'
    ? (await listOrgRepos(CONFIG.BETA_ORG, 'layerpitch-beta-')).map(r => r.name)
    : [`layerpitch-beta-${target}`];

  console.log(`Rollout vers : ${repos.join(', ')}`);
  const skipped = [];
  const failed = [];

  for (const repo of repos) {
    try {
      const check = await checkSchemaCompatible(CONFIG.BETA_ORG, repo);
      if (!check.compatible) {
        console.warn(`  ⚠ ${repo} ignoré — ${check.reason}`);
        skipped.push(repo);
        continue;
      }
      const backupBranch = await createBackupBranch(CONFIG.BETA_ORG, repo);
      console.log(`  ✓ sauvegarde créée : ${backupBranch}`);
      for (const file of CONFIG.ENGINE_FILES) {
        const src = await getContent(CONFIG.BETA_ORG, CONFIG.TEMPLATE_REPO, file);
        if (!src) continue;
        let content = fromBase64(src.content);
        if (file === 'layerpitch-backstage.html') {
          content = content.replaceAll(CONFIG.REPO_PLACEHOLDER, repo);
        }
        await putFile(CONFIG.BETA_ORG, repo, file, content, `rollout: mise à jour ${file}`);
      }
      console.log(`  ✓ ${repo} mis à jour`);
    } catch (e) {
      // Un repo en échec (supprimé, permissions, erreur réseau ponctuelle) ne doit jamais interrompre
      // le traitement des testeurs suivants — particulièrement important en --all sur une dizaine de repos.
      console.warn(`  ✗ ${repo} en échec — ${e.message}`);
      failed.push(repo);
    }
  }

  if (skipped.length) {
    console.log(`\n${skipped.length} repo(s) ignoré(s) pour incompatibilité de schéma : ${skipped.join(', ')}`);
    console.log('→ à traiter manuellement (migration de leur data.json ou report de leur mise à jour).');
  }
  if (failed.length) {
    console.log(`\n${failed.length} repo(s) en échec (voir messages ci-dessus) : ${failed.join(', ')}`);
    console.log('→ à vérifier manuellement (repo supprimé ? accès token ?) puis relancer le rollout pour ceux-là seulement.');
  }
}

/* ---------------- Commande : restore ---------------- */
async function restore(testerName, branchArg, notifyFlag) {
  if (!CONFIG.BETA_ORG) { console.error('BETA_ORG non configuré dans CONFIG — crée d\'abord l\'organisation.'); process.exit(1); }
  const repo = `layerpitch-beta-${testerName}`;
  if (!(await repoExists(CONFIG.BETA_ORG, repo))) {
    console.error(`Le repo ${CONFIG.BETA_ORG}/${repo} n'existe pas.`);
    process.exit(1);
  }

  let branchName = branchArg;
  if (!branchName) {
    const backups = await listBackupBranches(CONFIG.BETA_ORG, repo);
    if (!backups.length) { console.error(`Aucune branche de sauvegarde trouvée pour ${repo}.`); process.exit(1); }
    branchName = backups[0].name;
    console.log(`Aucune branche précisée — utilise la plus récente : ${branchName}`);
  }

  console.log(`Restauration de ${CONFIG.BETA_ORG}/${repo} depuis la branche "${branchName}"…`);

  // Filet de sécurité : on sauvegarde l'état actuel de main AVANT de le remplacer, au cas où cette
  // restauration elle-même se révèle être une erreur (même logique que rollout).
  const safetyBranch = await createBackupBranch(CONFIG.BETA_ORG, repo);
  console.log(`  ✓ sauvegarde de sécurité créée avant restauration : ${safetyBranch}`);

  for (const file of CONFIG.ENGINE_FILES) {
    const src = await getContentAtRef(CONFIG.BETA_ORG, repo, file, branchName);
    if (!src) { console.warn(`  ⚠ ${file} absent de la branche "${branchName}", ignoré.`); continue; }
    const content = fromBase64(src.content);
    await putFile(CONFIG.BETA_ORG, repo, file, content, `restore: rétablit ${file} depuis ${branchName}`);
    console.log(`  ✓ ${file}`);
  }

  console.log('Restauration terminée. data.json et events.json n\'ont pas été touchés (contenu du testeur préservé).');
  console.log('⚠ Vérifie que ce code restauré fonctionne toujours avec le data.json actuel du testeur — le schéma a pu évoluer entre la sauvegarde et maintenant, et rien ne le garantit automatiquement.');

  if (notifyFlag) {
    const sent = await sendNotice(CONFIG.BETA_ORG, repo,
      'Une mise à jour ne s\'est pas passée comme prévu. Le système a été restauré à une version précédente — vérifie que tout va bien de ton côté, et préviens Jules-Antoine si tu remarques quoi que ce soit d\'anormal.',
      'An update didn\'t go as planned. The system has been restored to a previous version — please check that everything looks right on your end, and let Jules-Antoine know if you notice anything unusual.'
    );
    if (sent) console.log('  ✓ testeur notifié (bandeau d\'alerte affiché dans son Backstage)');
  }
}

/* ---------------- Commande : list-backups ---------------- */
async function listBackups(testerName) {
  if (!CONFIG.BETA_ORG) { console.error('BETA_ORG non configuré dans CONFIG — crée d\'abord l\'organisation.'); process.exit(1); }
  const repo = `layerpitch-beta-${testerName}`;
  const backups = await listBackupBranches(CONFIG.BETA_ORG, repo);
  if (!backups.length) { console.log(`Aucune branche de sauvegarde pour ${repo}.`); return; }
  console.log(`Sauvegardes disponibles pour ${repo} (la plus récente en premier) :`);
  backups.forEach(b => console.log(`  ${b.name}  (${b.sha.slice(0, 7)})`));
}

/* ---------------- Commande : notify ---------------- */
async function notify(target, frText, enText) {
  if (!CONFIG.BETA_ORG) { console.error('BETA_ORG non configuré dans CONFIG — crée d\'abord l\'organisation.'); process.exit(1); }
  if (!frText || !enText) {
    console.error('Usage : node layerpitch-beta-sync.js notify <nomTesteur|--all> --fr "message" --en "message"');
    process.exit(1);
  }
  const repos = target === '--all'
    ? (await listOrgRepos(CONFIG.BETA_ORG, 'layerpitch-beta-')).map(r => r.name)
    : [`layerpitch-beta-${target}`];

  console.log(`Envoi du bandeau d'alerte à : ${repos.join(', ')}`);
  for (const repo of repos) {
    try {
      const sent = await sendNotice(CONFIG.BETA_ORG, repo, frText, enText);
      if (sent) console.log(`  ✓ ${repo}`);
    } catch (e) {
      console.warn(`  ✗ ${repo} en échec — ${e.message}`);
    }
  }
}

/* ---------------- CLI ---------------- */
// Drapeaux connus : --fr/--en attendent une valeur (le texte du message), --notify est un booléen.
// Toute autre chose commençant par "--" (ex. --all, valeur de <nomTesteur|--all>) reste un argument
// positionnel normal, pas un drapeau — évite toute ambiguïté avec les commandes existantes.
const FLAGS_WITH_VALUE = new Set(['fr', 'en']);
const BOOLEAN_FLAGS = new Set(['notify']);
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && FLAGS_WITH_VALUE.has(a.slice(2))) { flags[a.slice(2)] = argv[++i]; }
    else if (a.startsWith('--') && BOOLEAN_FLAGS.has(a.slice(2))) { flags[a.slice(2)] = true; }
    else { positional.push(a); }
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [cmd, arg, arg2] = positional;
(async () => {
  try {
    if (cmd === 'promote') await promote();
    else if (cmd === 'create' && arg) await create(arg);
    else if (cmd === 'rollout' && arg) await rollout(arg);
    else if (cmd === 'restore' && arg) await restore(arg, arg2, !!flags.notify);
    else if (cmd === 'list-backups' && arg) await listBackups(arg);
    else if (cmd === 'notify' && arg) await notify(arg, flags.fr, flags.en);
    else {
      console.log('Usage :');
      console.log('  node layerpitch-beta-sync.js promote');
      console.log('  node layerpitch-beta-sync.js create <nomTesteur>');
      console.log('  node layerpitch-beta-sync.js rollout <nomTesteur|--all>');
      console.log('  node layerpitch-beta-sync.js restore <nomTesteur> [nomBrancheSauvegarde] [--notify]');
      console.log('  node layerpitch-beta-sync.js list-backups <nomTesteur>');
      console.log('  node layerpitch-beta-sync.js notify <nomTesteur|--all> --fr "message" --en "message"');
      process.exit(1);
    }
  } catch (e) {
    console.error('Erreur :', e.message);
    process.exit(1);
  }
})();
