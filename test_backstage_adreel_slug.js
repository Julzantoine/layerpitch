// Adresse personnalisable d'un AdReel dans le VRAI Backstage (27/09) : champ grisé pour l'AdReel principal et pour un
// non-admin, nom proposé à partir du titre, enregistrement immédiat par set_my_ad_reel_slug, lien public /<nom>/<adreel>,
// message clair si l'AdReel n'est pas encore publié. Les règles serveur sont vérifiées sur PGlite (changelog [2026-09-27i]).
const { loadBackstage } = require('./scripts/test-harness.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const dom = await loadBackstage({ scripts: ['layerpitch-i18n.js', 'layerpitch-notify.js', 'layerpitch-help.js', 'player.js'] });
  const w = dom.window;
  const ev = code => w.eval(code);
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const settle = () => new Promise(r => setTimeout(r, 20));

  const data = { library: [], packs: [], collections: [], sfxLibrary: [], socials: [], customFonts: [],
    adReels: [{ id: 'main', label: 'Principal', blocks: [], profile: {} }, { id: 'r1', label: 'Pitch Ubisoft été', blocks: [], profile: {}, slug: null }] };
  w.fetchSiteData = async () => JSON.parse(JSON.stringify(data));
  const rpcCalls = [];
  let rpcReply = { data: 'pitch-ubisoft-ete', error: null };
  w.loadPostgresReadScripts = async () => {};
  w.LayerPitchSupabaseClient = { getClient: () => ({ rpc: async (name, args) => { rpcCalls.push({ name, args }); return rpcReply; } }) };
  await ev('loadData(true)'); await settle();
  ev("myComposerHandle = 'jean'; currentUserIsAdmin = true;");
  const $ = id => w.document.getElementById(id);
  ev("switchAdReel('main')"); await settle();
  check('AdReel principal : champ grisé, adresse = racine', $('appSlug').disabled && $('appSlugPrefix').textContent === 'beta.layerpitch.com/jean/' && /racine/.test($('appSlugHint').textContent));
  check('lien de l’AdReel principal : /jean/', ev("computeAdReelUrl('main')") === 'https://beta.layerpitch.com/jean/');
  ev("switchAdReel('r1')"); await settle();
  check('AdReel r1 : champ actif, nom proposé à partir du titre', !$('appSlug').disabled && $('appSlug').placeholder === 'pitch-ubisoft-ete');
  check('sans nom : lien par code', ev("computeAdReelUrl('r1')") === 'https://beta.layerpitch.com/jean/?adreel=r1');
  $('appSlug').value = 'Pitch Ubisoft Été';
  $('btnSaveSlug').click(); await settle();
  check('enregistrement : nom nettoyé envoyé au serveur', rpcCalls.length === 1 && rpcCalls[0].name === 'set_my_ad_reel_slug' && rpcCalls[0].args.p_ad_reel_id === 'r1' && rpcCalls[0].args.p_slug === 'pitch-ubisoft-ete');
  check('lien public : /jean/pitch-ubisoft-ete, affiché dans le message', ev("computeAdReelUrl('r1')") === 'https://beta.layerpitch.com/jean/pitch-ubisoft-ete' && /jean\/pitch-ubisoft-ete/.test($('appSlugMsg').textContent));
  rpcReply = { data: null, error: { message: 'AdReel introuvable', hint: 'unpublished' } };
  $('btnSaveSlug').click(); await settle();
  check('AdReel pas encore publié : message clair', /Publie d’abord/.test($('appSlugMsg').textContent));
  ev("currentUserIsAdmin = false; fillAdReelSlugField(adReels.find(a => a.id === 'r1'));");
  check('non admin : champ grisé (bêta)', $('appSlug').disabled && $('btnSaveSlug').disabled && /administrateur/.test($('appSlugHint').textContent));
  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST THREW:', e); process.exit(1); });
