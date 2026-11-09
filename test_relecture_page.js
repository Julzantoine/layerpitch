const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Page de relecture client (9/11, relecture.html) avec un serveur simulé (mêmes fonctions que la migration 20261109020000) :
// lien invalide, parcours du client sans compte (prénom, commentaire à l'instant, réponse, décision), versions et statuts affichés,
// marqueurs sous la vidéo, texte des autres relecteurs conservé, page jamais indexée.
(async () => {
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf-8').replace(/<\/script/gi, '<\\/script');
  let html = fs.readFileSync(path.join(__dirname, 'relecture.html'), 'utf-8');
  html = html.replace(/<script src="https:[^>]*><\/script>/g, '').replace(/<script src="api\/supabase-client\.js[^>]*><\/script>/, '') // client Supabase simulé plus bas
    .replace(/<script src="([^"?]+)(\?v=[^"]*)?"><\/script>/g, (m, f) => `<script>${read(f)}</script>`);
  const state = { token: 'T'.repeat(64), calls: [], data: null };
  const mk = () => ({
    title: 'Traversée', baseUrl: 'https://m/base.mp4',
    versions: [
      { key: 'original', title: null, url: 'https://m/a.mp4', kind: 'audio', cues: [], status: null, statusBy: null },
      { key: 'verA', title: 'Musique A', url: 'https://m/b.mp4', kind: 'audio', cues: [], status: 'sent', statusBy: null },
    ],
    comments: [{ id: 'c1', versionKey: 'verA', parentId: null, t: 12.5, author: 'Camille', fromOwner: false, body: 'Drone trop fort', resolved: false, createdAt: '2026-11-09T10:00:00Z' }],
  });
  state.data = mk();
  const dom = new JSDOM(html, {
    url: 'http://localhost/relecture.html?k=' + state.token + '&lang=fr', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async (name, args) => {
        state.calls.push([name, JSON.parse(JSON.stringify(args))]);
        if (name === 'get_video_review') return { data: args.p_token === state.token ? JSON.parse(JSON.stringify(state.data)) : null, error: null };
        if (name === 'add_video_review_comment') {
          if (args.p_token !== state.token) return { data: null, error: { message: 'Lien invalide' } };
          state.data.comments.push({ id: 'n' + state.data.comments.length, versionKey: args.p_version_key, parentId: args.p_parent_id, t: args.p_t, author: args.p_author, fromOwner: false, body: args.p_body, resolved: false, createdAt: new Date().toISOString() });
          return { data: { ok: true }, error: null };
        }
        if (name === 'set_video_review_decision') {
          const v = state.data.versions.find(x => x.key === args.p_version_id); v.status = args.p_decision; v.statusBy = args.p_author;
          return { data: { ok: true }, error: null };
        }
        return { data: null, error: { message: 'inconnu' } };
      } }) };
      try { Object.defineProperty(win.HTMLMediaElement.prototype, 'duration', { get() { return 60; }, configurable: true }); } catch (e) {}
      let ct = 0;
      try { Object.defineProperty(win.HTMLMediaElement.prototype, 'currentTime', { get() { return ct; }, set(v) { ct = v; }, configurable: true }); } catch (e) {}
      win.HTMLMediaElement.prototype.play = () => Promise.resolve();
      win.HTMLMediaElement.prototype.pause = () => {};
      win.HTMLMediaElement.prototype.load = () => {};
    },
  });
  const W = dom.window, doc = W.document;
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const tick = (n = 1) => new Promise(r => setTimeout(r, 30 * n));
  await tick(4);
  check('page jamais indexée', /<meta name="robots" content="noindex/.test(html));
  check('titre de la page = titre du montage', doc.title.includes('Traversée') && doc.querySelector('h1').textContent === 'Traversée');
  check('un menu de versions est proposé (original + version)', !!doc.querySelector('.lp-video-versions select') && doc.querySelector('.lp-video-versions select').options.length === 2);
  check('sur la musique d\'origine : pas de boutons de décision, mention explicative', doc.getElementById('decision').hidden === true && doc.getElementById('status').textContent.includes('origine'));
  check('sur l\'original : aucune remarque (celle de Camille est sur la version A)', doc.getElementById('list').textContent.includes('Aucune remarque'));
  const sel = doc.querySelector('.lp-video-versions select');
  sel.value = 'verA'; sel.dispatchEvent(new W.Event('change')); await tick(2);
  check('version A : statut « À relire » affiché', doc.getElementById('status').textContent.includes('À relire'));
  check('version A : boutons Valider / Demander des modifs', doc.querySelectorAll('#decision [data-d]').length === 2);
  check('version A : la remarque de Camille est listée à son instant', doc.getElementById('list').textContent.includes('Drone trop fort') && doc.querySelector('.cm .t').textContent === '0:12');
  check('version A : un marqueur sous la vidéo', doc.querySelectorAll('#strip .dot').length === 1);
  doc.querySelector('#strip .dot').click(); await tick();
  check('clic sur le marqueur : la vidéo saute à l\'instant', Math.abs(doc.getElementById('vid').currentTime - 12.5) < 0.01);

  // Commenter sans prénom
  doc.getElementById('atBtn').click(); await tick();
  check('commenter sans prénom ni texte : refusé, message', doc.getElementById('cmErr').textContent.length > 0 && !state.calls.some(c => c[0] === 'add_video_review_comment'));
  doc.getElementById('nameInput').value = 'Léa'; doc.getElementById('nameInput').dispatchEvent(new W.Event('input'));
  doc.getElementById('cmText').value = 'Plus de basses ici';
  doc.getElementById('vid').currentTime = 20;
  doc.getElementById('atBtn').click(); await tick(3);
  const add = state.calls.find(c => c[0] === 'add_video_review_comment');
  check('commentaire envoyé : jeton, version, instant, prénom, texte', add && add[1].p_token === state.token && add[1].p_version_key === 'verA' && add[1].p_t === 20 && add[1].p_author === 'Léa' && add[1].p_body === 'Plus de basses ici' && add[1].p_parent_id === null);
  check('le nouveau commentaire apparaît dans la liste et sur la bande', doc.querySelectorAll('.cm').length === 2 && doc.querySelectorAll('#strip .dot').length === 2);
  check('le champ de texte est vidé', doc.getElementById('cmText').value === '');

  // Réponse
  doc.querySelector('[data-reply="c1"]').click();
  doc.querySelector('textarea[data-for="c1"]').value = 'Je suis d\'accord';
  doc.querySelector('[data-send="c1"]').click(); await tick(3);
  const rep = state.calls.filter(c => c[0] === 'add_video_review_comment')[1];
  check('réponse envoyée avec le commentaire parent', rep && rep[1].p_parent_id === 'c1' && rep[1].p_body === 'Je suis d\'accord');
  check('la réponse apparaît sous le commentaire', doc.querySelector('.cm[data-id="c1"] .reply') && doc.querySelector('.cm[data-id="c1"] .reply').textContent.includes('Léa'));

  // Décision
  doc.querySelector('#decision [data-d="changes_requested"]').click(); await tick(3);
  const dec = state.calls.find(c => c[0] === 'set_video_review_decision');
  check('« Demander des modifs » : envoyé avec le prénom', dec && dec[1].p_decision === 'changes_requested' && dec[1].p_version_id === 'verA' && dec[1].p_author === 'Léa');
  check('le statut affiché change, avec le prénom', doc.getElementById('status').textContent.includes('Modifs demandées') && doc.getElementById('status').textContent.includes('Léa'));
  check('le bouton déjà choisi est grisé', doc.querySelector('#decision [data-d="changes_requested"]').disabled && !doc.querySelector('#decision [data-d="approved"]').disabled);
  check('le texte échappé : pas de HTML injecté', (() => { state.data.comments.push({ id: 'x', versionKey: 'verA', parentId: null, t: 1, author: '<b>Mal</b>', fromOwner: false, body: '<img src=x onerror=alert(1)>', resolved: false, createdAt: '2026-11-09T11:00:00Z' }); return true; })());
  await W.eval('(async()=>{ data = await load(); renderAll(); })()'); await tick(2);
  check('texte du client affiché tel quel, sans balises actives', !doc.querySelector('#list img') && doc.getElementById('list').textContent.includes('<img src=x'));

  // Lien invalide
  const dom2 = new JSDOM(html, { url: 'http://localhost/relecture.html?k=mauvais&lang=fr', runScripts: 'dangerously', beforeParse(win) {
    win.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async () => ({ data: null, error: null }) }) }; } });
  await tick(3);
  check('lien inactif ou faux : message clair, aucun lecteur', dom2.window.document.getElementById('page').textContent.includes('plus actif') && !dom2.window.document.getElementById('vid'));
  const dom3 = new JSDOM(html, { url: 'http://localhost/relecture.html?lang=fr', runScripts: 'dangerously', beforeParse(win) {
    win.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async () => ({ data: null, error: null }) }) }; } });
  await tick(3);
  check('sans jeton : même message', dom3.window.document.getElementById('page').textContent.includes('plus actif'));

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
  process.exit(failures ? 1 : 0);
})();
