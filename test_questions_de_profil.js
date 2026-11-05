// Questions de profil + « Tes essentiels » (4/11, src/backstage/46-questions-de-profil.js) : arbre de questions en fin de visite,
// « Passer », réponses enregistrées, leçons essentielles en tête du menu Tutoriel, bouton « autre voie » pour « les deux », pas de
// « refaire le questionnaire », comptes déjà inscrits, répartition admin. Le vrai Backstage dans jsdom ; le serveur est simulé.
const { loadBackstage } = require('./scripts/test-harness.js');
const fs = require('fs');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  const ev = code => w.eval(code);
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const saves = [];
  let stored = null;
  w.LayerPitchSupabaseClient = { getClient: () => ({
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { onboarding_profile: stored }, error: null }) }) }),
    rpc: async (name, params) => { if (name === 'set_my_onboarding_profile') { saves.push(params.p); stored = Object.assign({}, params.p, { at: 'now' }); return { data: stored, error: null }; } return { data: null, error: null }; },
  }) };
  ev("currentUserIsAdmin = true; myFlags = new Proxy({}, { get: () => true }); myEntitlements = new Proxy({}, { get: () => ({ allowed: true, level: 'saved', amount: null }) });");
  ev("window.LayerPitchNotify.error = m => { window.__err = m; }; window.open = () => null;");
  const doc = w.document;
  const card = () => doc.querySelector('.tour-card');
  const answer = async v => { card().querySelector(`[data-profile-answer="${v}"]`).click(); await settle(); };
  const menuIds = () => [...doc.querySelectorAll('#tutorialMenuList [data-tutorial]')].map(b => b.dataset.tutorial);

  // ---- Jamais proposées : elles remplacent le double choix en fin de visite
  check('réponses lues en base (jamais proposées = null)', (await ev('loadMyOnboardingProfile()')) === null);
  check('fin de visite : les questions, plus le double choix « moteur / pitch »', ev('tourFinalStep().profileQuiz') === true && !ev('tourFinalStep().choices'));
  ev("myFlags = new Proxy({}, { get: (t, k) => k !== 'onboarding_profile' })");
  check('feu vert onboarding_profile fermé : le double choix d\'avant', !!(ev('tourFinalStep()') || {}).choices);
  ev("myFlags = new Proxy({}, { get: () => true })");
  check('mode tutoriel (sans compte) : jamais de questions', /function profileQuizOpen\(\) \{ return !isTutoMode\(\)/.test(fs.readFileSync('src/backstage/46-questions-de-profil.js', 'utf8')));

  ev("startBackstageTour()"); await settle(50);
  check('la visite se termine sur la bulle des questions', ev('guide.steps[guide.steps.length - 1].profileQuiz') === true);
  ev('closeBackstageTour()'); await settle();
  check('visite fermée AVANT d\'arriver aux questions : rien n\'est enregistré', saves.length === 0);

  // ---- Compositeur, contrats, plusieurs OST
  ev("openGuide('tour', [profileQuizStep()])"); await settle();
  check('Q1 « Tu es… » : Compositeur / Studio / Les deux, et « Passer »', /Tu es/.test(card().textContent) && card().querySelectorAll('[data-profile-answer]').length === 3 && !!card().querySelector('[data-profile-skip]') && /Trois petites questions/.test(card().textContent));
  await answer('composer');
  check('Compositeur → « contrats ou début d\'une (grande) carrière ? »', /grande\) carrière/.test(card().textContent) && !!card().querySelector('[data-profile-skip]'));
  await answer('contracts');
  check('Contrats → « plusieurs OST à ton actif ? »', /plusieurs OST/.test(card().textContent));
  await answer('yes');
  check('réponses enregistrées en base', JSON.stringify(saves[0]) === JSON.stringify({ role: 'composer', career: 'contracts', ost: 'yes' }));
  const ess = [...card().querySelectorAll('[data-profile-lesson]')].map(b => b.dataset.profileLesson);
  check('compositeur + contrats + plusieurs OST : les 5 leçons essentielles', ess.join() === 'embranchement,additive,pj-map-music,versioning,album');
  ev('closeBackstageTour()'); await settle();
  check('fermer après avoir répondu : pas de « passée » en plus', saves.length === 1);
  ev('renderTutorialMenu()');
  const ids = menuIds();
  check('menu Tutoriel : « Tes essentiels » en tête, avant la visite et les 27 leçons', /Tes essentiels/.test(doc.getElementById('tutorialMenuList').textContent.slice(0, 40)) && ids.slice(0, 5).join() === ess.join() && ids[5] === 'tour' && ids.length === 5 + 1 + ev('LESSONS.length'));
  check('pas de « refaire le questionnaire », pas de bouton « autre voie » (pas « les deux »)', !/refaire|questionnaire/i.test(doc.getElementById('tutorialMenuList').textContent) && !doc.querySelector('[data-essentials-switch]'));
  ev("localStorage.setItem(LESSONS_DONE_STORAGE, JSON.stringify({ embranchement: true })); renderTutorialMenu();");
  check('leçon faite : cochée dans « Tes essentiels »', !!doc.querySelector('#tutorialMenuList [data-tutorial="embranchement"] svg'));
  check('rejouer la visite : elle finit sur les essentiels, sans reposer les questions', ev('tourFinalStep().profileQuiz') === true && ev('profileQuiz.done') === true);

  // ---- Les autres profils
  const essOf = p => { ev(`myOnboardingProfile = ${JSON.stringify(p)}; try { localStorage.removeItem(ESSENTIALS_VIEW_STORAGE); } catch (e) {}`); return ev('myEssentialLessons().map(l => l.id).join()'); };
  check('compositeur, début de carrière', essOf({ role: 'composer', career: 'starting' }) === 'embranchement,additive,adreel-intro,adreel');
  check('compositeur, contrats, pas encore plusieurs OST', essOf({ role: 'composer', career: 'contracts', ost: 'no' }) === 'embranchement,additive,pj-map-music,versioning');
  check('studio', essOf({ role: 'studio' }) === 'pj-create,pj-moodboard,pj-music,pj-map-walk');

  // ---- Les deux : voie choisie + « Explorer aussi … »
  stored = null; ev('myOnboardingProfile = null'); saves.length = 0;
  ev("openGuide('tour', [profileQuizStep()])"); await settle();
  await answer('both');
  check('Les deux → « Quelle voie veux-tu explorer en premier ? »', /Quelle voie/.test(card().textContent));
  await answer('studio');
  check('voie studio choisie : enregistré tout de suite, essentiels studio', JSON.stringify(saves[0]) === JSON.stringify({ role: 'both', path: 'studio' }) && [...card().querySelectorAll('[data-profile-lesson]')].map(b => b.dataset.profileLesson)[0] === 'pj-create');
  ev('closeBackstageTour(); renderTutorialMenu()'); await settle();
  const sw = doc.querySelector('[data-essentials-switch]');
  check('menu : bouton « Explorer aussi la voie compositeur »', sw && sw.dataset.essentialsSwitch === 'composer' && /voie compositeur/.test(sw.textContent));
  sw.click(); await settle();
  check('voie compositeur sans réponses carrière : les deux questions d\'abord', ev('guide && guide.steps[0].profileQuiz') && /grande\) carrière/.test(card().textContent));
  await answer('starting');
  check('… réponses ajoutées à la fiche (rôle et voie gardés)', JSON.stringify(saves[1]) === JSON.stringify({ role: 'both', path: 'studio', career: 'starting' }));
  ev('closeBackstageTour(); renderTutorialMenu()'); await settle();
  check('… menu : essentiels compositeur, bouton « Explorer aussi la voie studio »', menuIds()[2] === 'adreel-intro' && doc.querySelector('[data-essentials-switch]').dataset.essentialsSwitch === 'studio');
  doc.querySelector('[data-essentials-switch]').click(); await settle();
  check('retour à la voie studio d\'un clic (sans questions)', menuIds()[0] === 'pj-create' && saves.length === 2 && !ev('guide'));

  // ---- Passer
  stored = null; ev('myOnboardingProfile = null'); saves.length = 0;
  ev("openGuide('tour', [profileQuizStep()])"); await settle();
  card().querySelector('[data-profile-skip]').click(); await settle();
  check('« Passer » : enregistré comme passé, bulle fermée', JSON.stringify(saves[0]) === '{"skipped":true}' && !ev('guide'));
  ev('renderTutorialMenu()');
  check('… pas de « Tes essentiels », et plus de questions en fin de visite', !/Tes essentiels/.test(doc.getElementById('tutorialMenuList').textContent) && !ev('tourFinalStep().profileQuiz'));
  stored = null; ev('myOnboardingProfile = null'); saves.length = 0;
  ev("openGuide('tour', [profileQuizStep()])"); await settle();
  await answer('composer');
  ev('closeBackstageTour()'); await settle();
  check('questions vues puis bulle fermée sans finir : vaut « Passer » (proposées une seule fois)', JSON.stringify(saves[0]) === '{"skipped":true}');

  // ---- Comptes déjà inscrits : une fois, à la prochaine connexion
  stored = null; ev('myOnboardingProfile = undefined; profileQuizOffered = false; tourMarkDone()');
  ev('offerProfileQuizIfNeeded()'); await settle(1100);
  check('visite déjà faite, jamais répondu : les questions seules s\'ouvrent', ev('!!guide && guide.steps.length === 1 && guide.steps[0].profileQuiz'));
  ev('closeBackstageTour()'); await settle();
  stored = { skipped: true }; ev('myOnboardingProfile = undefined; profileQuizOffered = false');
  ev('offerProfileQuizIfNeeded()'); await settle(1100);
  check('déjà proposées (passées) : plus jamais', !ev('guide'));
  stored = null; ev('myOnboardingProfile = undefined; profileQuizOffered = false');
  check('questions seules : leur propre titre, pas « Pour finir »', ev("tr(profileQuizStep({ alone: true }).titleKey)") === 'Tes leçons essentielles');

  // ---- Message non lu dans la cloche (5/11) : les questions attendent qu'il soit lu et la cloche refermée
  ev(`(() => { const ls = []; let items = [{ kind: 'announcement', unread: true, title: 'Des exemples pour jouer' }];
    window.__inbox = { set(v) { items = v; ls.forEach(f => f(items)); } };
    window.LayerPitchShell = Object.assign({}, window.LayerPitchShell, { onInbox(f) { ls.push(f); f(items); } });
    let dd = document.getElementById('inboxBellDropdown'); if (!dd) { dd = document.createElement('div'); dd.id = 'inboxBellDropdown'; document.body.appendChild(dd); } dd.hidden = true; })()`);
  ev('offerProfileQuizIfNeeded()'); await settle(1100);
  check('message de la cloche non lu : pas de questions par-dessus', !ev('guide'));
  ev("document.getElementById('inboxBellDropdown').hidden = false; window.__inbox.set([{ kind: 'announcement', unread: false }])"); await settle(1100);
  check('cloche ouverte (message lu) : toujours rien', !ev('guide'));
  ev("document.getElementById('inboxBellDropdown').hidden = true"); await settle(1100);
  check('cloche refermée : les questions s\'ouvrent, titre « Tes leçons essentielles »', ev('!!guide && guide.steps[0].profileQuiz') && /Tes leçons essentielles/.test(card().textContent) && !/Pour finir/.test(card().textContent));
  ev('profileQuiz = null; closeBackstageTour()'); await settle();

  // ---- Admin
  const adminHtml = fs.readFileSync('admin.html', 'utf8');
  check('statistiques admin : bloc « Questions de profil » et appel de la répartition', /id="statsProfile"/.test(adminHtml) && /getOnboardingProfileStats\(\)/.test(adminHtml) && /admin_onboarding_profile_stats/.test(fs.readFileSync('api/admin.js', 'utf8')));

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
