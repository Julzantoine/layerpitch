// Parcours « montage vidéo → AdReel » simplifié (06/11, décidé avec Jules-Antoine) : « Un de mes montages » dans le bloc vidéo, montage
// enregistré tout seul dans l'atelier (plus de bouton « Sauvegarder »), publié par « Sauvegarder / publier » du Backstage (étape montage,
// avant les AdReels), bouton « Publier le montage » seulement hors Backstage (studio), textes FR + EN.
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
(async () => {
  const atelier = read('atelier.html'), bs = read('layerpitch-backstage.html'), i18n = read('layerpitch-i18n.js'), lessons = read('atelier-lecons.js');

  // Atelier : enregistrement automatique
  check('atelier : plus de bouton « Sauvegarder » (« Ajouter à la bibliothèque », avec son nom demandé, reste : demande du 06/11)', !/id="videoCaptureSaveBtn"/.test(atelier) && /id="videoCaptureAddToLibraryBtn"/.test(atelier) && /captureExportNamePrompt/.test(atelier));
  check('atelier : toute retouche planifie l\'enregistrement automatique (1,5 s), sans renvoyer ce qui n\'a pas changé',
    /scheduleAutosave\(\); \/\/ toute retouche/.test(atelier) && /setTimeout\(\(\) => \{ saveCaptureNow\(\)/.test(atelier, 1500) && /if \(key === lastSavedKey\) return;/.test(atelier) && /\}, 1500\);/.test(atelier));
  check('atelier : titre retouché = enregistrement automatique', /titleInput\.addEventListener\('input', scheduleAutosave\)/.test(atelier));
  check('atelier : prise chargée = rien à enregistrer (clé posée au chargement)', /lastSavedKey = captureStateKey\(\);\s*lastPublishedKey = null;/.test(atelier));
  check('atelier : nouvelle prise = ni enregistrée ni publiée', /lastSavedKey = null; lastPublishedKey = null;/.test(atelier));
  check('atelier : enregistrement réservé au palier qui enregistre', /function scheduleAutosave\(\) \{\s*if \(!captureCanSave \|\| !packId\) return;/.test(atelier));
  check('atelier : zone d\'état « Enregistré ✓ » (data-state) pour la leçon', /setSaveState\('saved'/.test(atelier) && /dataset\.state === 'saved'/.test(lessons) && !/videoCaptureSaveBtn/.test(lessons));

  // Atelier : publication
  check('atelier : « Publier le montage » = même fonction que le bouton global ; masqué dans le Backstage',
    /async function publishMontageNow\(opts\)/.test(atelier) && /window\.__lpFinishMontage = async \(\) =>/.test(atelier) && /if \(hostPublishes \|\| !captureCanSave\) \{\s*updateEverywhereBtn\.hidden = true;/.test(atelier)
    && /const hostPublishes = typeof atelierEmbedded !== 'undefined' && atelierEmbedded && !atelierAsStudio;/.test(atelier));
  check('atelier : la publication enregistre d\'abord (ce qui est publié = ce qui est enregistré) et ne republie pas sans changement', /await saveCaptureNow\(\); \/\/ ce qui est publié/.test(atelier) && /if \(!opts\.force && key === lastPublishedKey\) return 'none';/.test(atelier));
  check('atelier : fermer un montage non publié propose de le publier (pas de confirm natif)', /montageNeedsPublish\(\)[\s\S]{0,200}LayerPitchNotify\.confirm\(tr\('captureCloseUnpublishedAsk'\)/.test(atelier) && !/window\.confirm\(/.test(atelier));
  check('atelier : répond au Backstage (ack, puis résultat none/done/error)', /type !== 'finishMontage'/.test(atelier) && /atelierTell\('finishMontageAck'/.test(atelier) && /atelierTell\('finishMontageResult', \{ id, status \}\)/.test(atelier) && /status: 'error', message/.test(atelier));

  // Backstage : étape montage de « Sauvegarder / publier », entre les packs et les AdReels
  const iPacks = bs.indexOf("log(`Écriture en base : ${data.packs.length} pack(s) OK.`"), iMon = bs.indexOf('await finishAtelierMontage()'), iAd = bs.indexOf("log('Écriture en base : AdReels...')");
  check('Backstage : le montage est terminé après les packs et avant les AdReels', iPacks > 0 && iMon > iPacks && iAd > iMon);
  check('Backstage : un échec du montage arrête la publication, avec la raison', /throw new Error\(tr\('montageFinishFailed'/.test(bs));

  // Protocole côté Backstage, joué avec un faux cadre
  const src = read('src/backstage/41-envoi-r2-et-bibliotheque-video.js');
  const body = src.slice(src.indexOf('function finishAtelierMontage()'), src.indexOf("// Messages de l'atelier (même origine seulement)"));
  const make = (reply) => {
    const listeners = [];
    const win = {
      addEventListener: (t, f) => listeners.push(f), removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
    };
    const frame = { getAttribute: () => './atelier.html', contentWindow: { postMessage: (msg) => { if (reply) setTimeout(() => reply(msg, m => listeners.slice().forEach(f => f({ origin: 'http://x', data: Object.assign({ source: 'lp-atelier', id: msg.id }, m) }))), 5); } } };
    const ctx = { window: win, location: { origin: 'http://x' }, document: { getElementById: () => frame }, tr: k => k, setTimeout, clearTimeout, Promise, Date, Math, Error };
    vm.createContext(ctx); vm.runInContext(body, ctx);
    return ctx.finishAtelierMontage;
  };
  check('protocole : publié -> done', (await make((msg, send) => { send({ type: 'finishMontageAck' }); setTimeout(() => send({ type: 'finishMontageResult', status: 'done' }), 5); })()) === 'done');
  check('protocole : rien à publier -> none', (await make((msg, send) => { send({ type: 'finishMontageAck' }); send({ type: 'finishMontageResult', status: 'none' }); })()) === 'none');
  let err = null; try { await make((msg, send) => { send({ type: 'finishMontageAck' }); send({ type: 'finishMontageResult', status: 'error', message: 'quota plein' }); })(); } catch (e) { err = e; }
  check('protocole : échec -> erreur avec la raison', err && /quota plein/.test(err.message));
  const noFrame = (() => { const ctx = { window: { addEventListener() {}, removeEventListener() {} }, location: { origin: 'http://x' }, document: { getElementById: () => null }, tr: k => k, setTimeout, clearTimeout, Promise, Date, Math, Error }; vm.createContext(ctx); vm.runInContext(body, ctx); return ctx.finishAtelierMontage; })();
  check('protocole : atelier jamais ouvert -> none, sans attendre', (await noFrame()) === 'none');

  // Textes
  const keys = ['captureSavedAutoHost', 'captureSavedAutoStudio', 'captureCloseUnpublishedAsk', 'captureClosePublishBtn', 'captureCloseWithoutBtn', 'montageFinishing', 'montagePublished', 'montageNothingToPublish', 'montageFinishFailed', 'montageFinishTimeout', 'videoSourceMontage', 'videoMontageSelectLabel', 'videoMontageSelectPlaceholder', 'videoMontageSelectEmpty', 'videoMontageNoVideo'];
  check('textes FR + EN : 15 clés présentes deux fois', keys.every(k => (i18n.match(new RegExp('\\b' + k + ':', 'g')) || []).length === 2));
  check('textes : le bouton de l\'atelier s\'appelle « Publier le montage » / « Publish the montage »', /captureUpdateEverywhereBtn: "Publier le montage"/.test(i18n) && /captureUpdateEverywhereBtn: "Publish the montage"/.test(i18n));
  check('textes : plus de « vidéo muette » dans les libellés d\'un montage', !/captureSilentVideoSuffix: "vidéo muette"/.test(i18n) && /captureSilentVideoSuffix: "montage"/.test(i18n));

  // Bloc vidéo : « Un de mes montages »
  check('bloc vidéo : source « Un de mes montages », fichier technique masqué de la bibliothèque', /value="montage"/.test(bs) && /lv\.kind !== 'capture_base' \|\| lv\.id === v\.libraryVideoId/.test(bs) && /data-role="montageSelect"/.test(bs));
  check('bloc vidéo : liste des montages lue dans l\'index de Versioning', /out\.captures\.push\(\{ capture: c, siblings \}\)/.test(bs));
  if (failures) { console.log(failures + ' CHECK(S) FAILED'); process.exit(1); }
})();
