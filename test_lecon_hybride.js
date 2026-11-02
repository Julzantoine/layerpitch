// Leçon « Hybride à sections » (02/11) : chaque étape trouve sa cible dans l'éditeur, chaque geste fait avancer la leçon,
// et la fin de la leçon reproduit « A little walk in Music City » de Jules-Antoine (7 sections, mêmes morceaux, mêmes chemins, mêmes moments de passage et points).
const fs = require('fs');
const { loadBackstage } = require('./scripts/test-harness.js');
(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'player.js'] });
  const { window } = dom;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }
  const pick = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  // Le faux serveur du tutoriel sert bien les 6 morceaux et ouvre le mode pour cette leçon.
  const demo = fs.readFileSync('api/demo-client.js', 'utf8');
  const ids = window.eval('Object.values(LH_TRACKS)');
  ids.forEach(id => check('faux serveur : morceau ' + id + ' présent', demo.includes('"id":"' + id + '"')));

  const lesson = window.eval("LESSONS.find(l => l.id === 'hybrid')");
  check('leçon déclarée dans le thème moteur audio', !!lesson && lesson.theme === 'engine' && lesson.reload === true);
  // Ouverte à tous le 02/11 : jouable et comptée dans les pastilles pour un bêta-testeur.
  window.eval('currentUserIsAdmin = false;');
  check('bêta-testeur : leçon ouverte et comptée dans les pastilles', window.eval("(function () { const l = LESSONS.find(x => x.id === 'hybrid'); return lessonOpenToMe(l) && lessonAvailable(l); })()"));
  window.eval('currentUserIsAdmin = true;');
  // 2e bulle : la carte finale, dessinée dans la bulle.
  const mapStep = lesson.steps[1];
  check('2e bulle : aperçu de la carte finale', mapStep.preview === 'hybridMap' && !mapStep.selector);
  const mapHtml = window.eval('lhMapPreviewHtml()');
  check('aperçu : les 7 sections et la fin', (mapHtml.match(/<rect/g) || []).length === 8 && mapHtml.includes('Meet me there') && mapHtml.includes('This place is so'));

  // Bibliothèque de départ : les 6 morceaux Jazz (fichiers déjà en ligne, réglages de boucle réels : la frise s'arrête à la sortie de boucle), puis le morceau de l'apprenant.
  window.eval(`
    myFlags.hybrid_sequential = true;
    const has = { remoteFile: 'a.ogg' };
    library.push(
      { id: LH_TRACKS.lo, title: 'Jazz Lo Static +FX', mode: 'static', bpm: 110, duration: 20.48, loopEngine: 'quantized', loopInBeat: 2, loopOutBeat: 34, layers: [has] },
      { id: LH_TRACKS.seq, title: 'Jazz Hi Seq. Branch.', mode: 'sequential', bpm: 110, segmentSlots: [{ alternatives: [has] }] },
      { id: LH_TRACKS.add, title: 'Jazz Hi Lay. Add.', mode: 'vertical', bpm: 110, duration: 21.96, loopEngine: 'quantized', loopInBeat: 2, loopOutBeat: 34, layers: [has, has] },
      { id: LH_TRACKS.embr, title: 'Jazz Hi-Lo Vert. Branch.', mode: 'embranchement-vertical', bpm: 110, loops: [Object.assign({ isInitial: true }, has)] },
      { id: LH_TRACKS.hi, title: 'Jazz Hi Static', mode: 'static', bpm: 110, duration: 20, layers: [has] },
      { id: LH_TRACKS.rand, title: 'Jazz Lo Vert. Rand.', mode: 'vertical-random', bpm: 110, sections: [{ pools: [{ alternatives: [has] }] }] },
      { id: 'h', title: 'Ma balade', mode: 'static', layers: [{}] });
    manageLibrarySelectedId = 'h';
    renderLibrary();
  `);
  const steps = lesson.steps;
  const find = key => steps.findIndex(s => s.titleKey === key);
  const target = i => { const s = steps[i]; return typeof s.selector === 'function' ? s.selector() : window.document.querySelector(s.selector); };
  const done = i => !!steps[i].done && steps[i].done({});
  // Pour chaque étape à geste : la cible existe avant le geste, le geste la valide.
  const gesture = (key, act) => {
    const i = find(key);
    const el = target(i);
    check(key + ' : cible trouvée', !!el);
    check(key + ' : pas encore faite', !done(i));
    if (el) act(el);
    check(key + ' : faite après le geste', done(i));
  };
  gesture('lhModeTitle', el => pick(el, 'hybrid-sequential'));
  gesture('lhAddTitle', click);
  gesture('lhTrack1Title', el => pick(el, window.eval('LH_TRACKS.lo')));
  gesture('lhName1Title', el => pick(el, 'Meet me there'));
  check('lhLoopsTitle : cible trouvée', !!target(find('lhLoopsTitle')));
  gesture('lhSwitchTitle', el => pick(el, 'point'));
  // Frise : un clic par point, au début des mesures 2, 4 et 6 (temps 4, 12, 20).
  gesture('lhPointsTitle', el => [4, 12, 20].forEach(b => click(target(find('lhPointsTitle')).querySelector('[data-beat="' + b + '"]'))));
  check('lhFadeTitle : cible trouvée', !!target(find('lhFadeTitle')));
  gesture('lhBranch1Title', click);
  gesture('lhBranch2Title', click);
  gesture('lhNewTitle', el => pick(el, '__new'));
  gesture('lhBranchSw1Title', el => pick(el, 'point'));
  gesture('lhBranchSw2Title', el => pick(el, 'point'));
  ['lhLabelTitle', 'lhDefaultTitle'].forEach(k => check(k + ' : cible trouvée', !!target(find(k))));
  gesture('lhTrack2Title', el => pick(el, window.eval('LH_TRACKS.seq')));
  gesture('lhName2Title', el => pick(el, 'This way?'));
  gesture('lhSwitch2Title', el => pick(el, 'bar'));
  gesture('lhTrack3Title', el => pick(el, window.eval('LH_TRACKS.add')));
  gesture('lhName3Title', el => pick(el, 'Or this one?'));
  gesture('lhSwitch3Title', el => pick(el, 'point'));
  gesture('lhPoints3Title', el => [4, 20].forEach(b => click(target(find('lhPoints3Title')).querySelector('[data-beat="' + b + '"]'))));
  gesture('lhBranch3Title', click);
  gesture('lhNew2Title', el => pick(el, '__new'));
  gesture('lhTrack4Title', el => pick(el, window.eval('LH_TRACKS.embr')));
  gesture('lhName4Title', el => pick(el, 'Would you like to walk a bit more?'));
  gesture('lhEnd1Title', click);
  gesture('lhEnd2Title', el => pick(el, 'end'));

  // La leçon complète la carte, une seule fois.
  steps[find('lhRestTitle')].enter({});
  steps[find('lhRestTitle')].enter({});
  const tree = window.eval(`(function () {
    const t = library.find(l => l.id === 'h');
    const key = id => Object.keys(LH_TRACKS).find(k => LH_TRACKS[k] === id);
    const idx = id => id === 'end' ? 'fin' : String(t.sections.findIndex(s => s.id === id) + 1);
    return t.sections.map((s, i) => (i + 1) + ':' + key(s.trackId) + ':' + s.label + ':' + (s.switchMode || 'end') + (s.transitionPoints && s.transitionPoints.length ? '@' + s.transitionPoints.join(',') : '')
      + '>' + (s.branches || []).map(b => idx(b.targetId) + '/' + (b.switchMode || 'end')).join('|')).join(' ; ');
  })()`);
  check('carte finale identique à « A little walk in Music City »', tree === [
    '1:lo:Meet me there:point@4,12,20>2/point|3/point', '2:seq:This way?:bar>4/end|5/end', '3:add:Or this one?:point@4,20>6/end|7/end',
    '4:embr:Would you like to walk a bit more?:end>fin/end', '5:hi:This is so pretty over there:end>fin/end', '6:rand:This place is so nice:end>fin/end',
    '7:hi:I would like it never ends:end>fin/end'].join(' ; '));
  console.log('   ' + tree);
  gesture('lhFreeTitle', click);
  check('retour libre : coché sur les 7 sections', window.eval("library.find(l => l.id === 'h').sections.every(s => s.freeReturn)"));
  check('l\'écoute trouve son bouton', !!target(find('lhListenTitle')));

  // Leçon 9 « Hybride à sections » (sans embranchement) : « Music City_Hyb. Seq. », trois sections bout à bout.
  const seq = window.eval("LESSONS.find(l => l.id === 'hybrid-seq')");
  const order = window.eval("LESSONS.filter(l => l.theme === 'engine').map(l => l.id)");
  check('leçon 9 juste avant la 10 (à embranchement), en fin de thème', order.slice(-2).join() === 'hybrid-seq,hybrid');
  check('titres : 9 · hybride à sections, 10 · hybride à embranchement', /^9 · Mode hybride à sections$/.test(window.eval("tr('lessonHybridSeqTitle')")) && /^10 · Mode hybride à embranchement$/.test(window.eval("tr('lessonHybridTitle')")));
  check('faux serveur : mêmes morceaux et feu vert pour la leçon 9', demo.includes("['hybrid', 'hybrid-seq'].includes(lessonParam())) return DEMO_TRACKS_HYBRID") && demo.includes("['hybrid', 'hybrid-seq'].includes(lessonParam()) ? ['hybrid_sequential']"));
  check('leçon 9 : aperçu linéaire en 2e bulle', seq.steps[1].preview === 'hybridSeqMap' && (window.eval('lhsMapPreviewHtml()').match(/<rect/g) || []).length === 4);
  window.eval("library.push({ id: 'h2', title: 'Ma suite', mode: 'static', layers: [{}] }); manageLibrarySelectedId = 'h2'; renderLibrary();");
  const sSteps = seq.steps;
  const sFind = key => sSteps.findIndex(s => s.titleKey === key);
  const sTarget = i => { const s = sSteps[i]; return typeof s.selector === 'function' ? s.selector() : window.document.querySelector(s.selector); };
  const sGesture = (key, act) => {
    const i = sFind(key), el = sTarget(i);
    check('9 · ' + key + ' : cible trouvée', !!el);
    check('9 · ' + key + ' : pas encore faite', !sSteps[i].done({}));
    if (el) act(el);
    check('9 · ' + key + ' : faite après le geste', sSteps[i].done({}));
  };
  sGesture('lhModeTitle', el => pick(el, 'hybrid-sequential'));
  sGesture('lhsAddTitle', click);
  sGesture('lhsTrack1Title', el => pick(el, window.eval('LH_TRACKS.add')));
  ['lhsNameTitle', 'lhsLoopsTitle', 'lhsSwitchTitle'].forEach(k => check('9 · ' + k + ' : cible trouvée', !!sTarget(sFind(k))));
  sGesture('lhsAdd2Title', click);
  sGesture('lhsTrack2Title', el => pick(el, window.eval('LH_TRACKS.seq')));
  check('9 · lhsTransTitle : cible trouvée', !!sTarget(sFind('lhsTransTitle')));
  sGesture('lhsAdd3Title', click);
  sGesture('lhsTrack3Title', el => pick(el, window.eval('LH_TRACKS.lo')));
  ['lhsOrderTitle', 'lhsListenTitle'].forEach(k => check('9 · ' + k + ' : cible trouvée', !!sTarget(sFind(k))));
  const seqResult = window.eval("library.find(l => l.id === 'h2').sections.map(s => [s.trackId, s.label || '', s.switchMode || 'end', (s.branches || []).length, s.transition ? 1 : 0].join('/')).join(' ; ')");
  check('9 · résultat identique à « Music City_Hyb. Seq. »', seqResult === window.eval("['add', 'seq', 'lo'].map(k => LH_TRACKS[k] + '//end/0/0').join(' ; ')"));

  // Textes en français et en anglais pour chaque étape.
  const I18N = window.LAYERPITCH_I18N;
  const keys = [lesson.titleKey, lesson.descKey, seq.titleKey, seq.descKey].concat(...steps.concat(seq.steps).map(s => [s.titleKey, s.textKey]));
  check('textes FR et EN présents', keys.every(k => I18N.fr.backstage[k] && I18N.en.backstage[k]));

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
})();
