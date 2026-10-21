// Non-régression (21/10, « le lecteur ne prend pas en compte le nombre de temps par mesure ») : le tempo / les temps par
// mesure propres à l'intro d'un séquentiel (drapeau intro.timingOwn) se perdaient à chaque copie du morceau vers le lecteur
// (publication, chargement, aperçu du Backstage). Ce test suit le même morceau à travers l'aperçu et la publication, puis
// vérifie que le lecteur en tire bien la durée attendue : 1 mesure de 2 temps à 110 BPM = 2 temps = 60/110*2 s.
const { loadBackstage } = require('./scripts/test-harness.js');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-help.js', 'layerpitch-notify.js', 'player.js'] });
  const { window } = dom;
  let failures = 0;
  function check(label, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; }

  const track = {
    id: 't1', title: 'Seq', description: '', mode: 'sequential', duration: 10, base: '', bpm: 110, beatsPerBar: 4,
    layers: [], segmentSlots: [], sections: [], loops: [], sfxIds: [],
    intro: { label: 'Intro', bars: 1, beatsPerBar: 2, bpm: null, timingOwn: true, remoteFile: 'intro.ogg', pendingFile: null },
    outro: null
  };
  window.eval('library').push(track);
  const expected = (60 / 110) * 2;
  const core = window.LayerPlayerCore;

  const preview = window.eval('buildPreviewTrack')(track);
  check('aperçu : timingOwn transmis', preview.intro.timingOwn === true && preview.intro.beatsPerBar === 2);
  check('aperçu : le lecteur calcule 2 temps', Math.abs(core.seqIntroSeconds(preview, null) - expected) < 1e-6);

  const snap = window.eval('buildDataSnapshot')('pro', 1).library.find(t => t.id === 't1');
  check('publication : timingOwn transmis', snap.intro.timingOwn === true && snap.intro.beatsPerBar === 2);
  check('publication : le lecteur calcule 2 temps', Math.abs(core.seqIntroSeconds(snap, null) - expected) < 1e-6);

  const noFlag = Object.assign({}, snap, { intro: Object.assign({}, snap.intro, { timingOwn: false }) });
  check('morceau enregistré avant le drapeau : les temps par mesure comptent quand même (2 temps)', Math.abs(core.seqIntroSeconds(noFlag, null) - expected) < 1e-6);
  const oldBpm = Object.assign({}, snap, { intro: { label: 'Intro', bars: 1, bpm: 200, remoteFile: 'i.ogg' } });
  check('bpm d\'un nom de fichier, sans drapeau : toujours ignoré (4 temps)', Math.abs(core.seqIntroSeconds(oldBpm, null) - (60 / 110) * 4) < 1e-6);

  console.log(failures ? '\n' + failures + ' ÉCHEC(S)' : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
