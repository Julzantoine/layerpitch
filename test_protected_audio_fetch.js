// Lecture de l'audio des morceaux protégés (src/player/02a-audio-protege.js, 29/09) : adresse publique d'abord, lien signé
// si elle répond 404/403, liens gardés en mémoire, aucun changement pour les Sfx et les fichiers publics. Faux réseau.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const src = fs.readFileSync(path.join(__dirname, 'src/player/02a-audio-protege.js'), 'utf8');

function world({ publicStatus, allowed, expiresIn }) {
  const log = { fetched: [], invoked: [] };
  let now = 1000000;
  const sandbox = {
    Date: { now: () => now },
    fetch: async url => { log.fetched.push(url); const signed = /signed\.example/.test(url); return { ok: signed || publicStatus === 200, status: signed ? 200 : publicStatus, url }; },
    decodeURIComponent, encodeURIComponent, Set, Map, Promise, Uint8Array, Math, URL,
    window: { LayerPitchSupabaseClient: { getClient: () => ({ functions: { invoke: async (name, { body }) => {
      log.invoked.push(name + ':' + (body.trackId || JSON.stringify(body)));
      return allowed ? { data: { ok: true, protected: true, files: { 'a b.ogg': 'https://signed.example/a', 'l1.ogg': 'https://signed.example/l1' }, expiresIn: expiresIn || 900 }, error: null }
        : { data: null, error: { message: 'refusé' } };
    } } }) } },
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.__f = { fetchAudio, fetchAudioBytes };', sandbox);
  return { f: sandbox.__f, log, advance: ms => { now += ms; } };
}
const U = f => 'https://media.layerpitch.com/audio/trk1/' + f;

(async () => {
  let w = world({ publicStatus: 200, allowed: true });
  let r = await w.f.fetchAudio(U('l1.ogg'));
  check('fichier public : lu à son adresse, aucune demande de lien signé', r.ok && w.log.invoked.length === 0 && w.log.fetched.length === 1);

  w = world({ publicStatus: 404, allowed: true });
  r = await w.f.fetchAudio(U('a%20b.ogg') + '?v=123');
  check('adresse publique introuvable : lien signé utilisé (nom décodé, ?v= ignoré)', r.ok && r.url === 'https://signed.example/a' && w.log.invoked.join() === 'track-audio-url:trk1');
  r = await w.f.fetchAudio(U('l1.ogg'));
  check('deuxième fichier du même morceau : liens gardés en mémoire (une seule demande)', r.url === 'https://signed.example/l1' && w.log.invoked.length === 1);
  check('morceau désormais connu comme protégé : plus d\'essai sur l\'adresse publique', !w.log.fetched.slice(2).some(u => u.includes('media.layerpitch.com')));
  w.advance(900 * 1000);
  await w.f.fetchAudio(U('l1.ogg'));
  check('liens expirés : nouvelle demande', w.log.invoked.length === 2);

  w = world({ publicStatus: 403, allowed: false });
  r = await w.f.fetchAudio(U('a%20b.ogg'));
  check('sans droit d\'écoute : la réponse d\'origine (403) est rendue, comme avant', !r.ok && r.status === 403);
  await w.f.fetchAudio(U('l1.ogg'));
  check('sans droit : pas de demande répétée pour chaque fichier', w.log.invoked.length === 1);
  let threw = false; try { await w.f.fetchAudioBytes(U('a%20b.ogg')); } catch (e) { threw = /introuvable/.test(e.message); }
  check('fetchAudioBytes : erreur claire si le fichier reste inaccessible', threw);

  w = world({ publicStatus: 404, allowed: true });
  r = await w.f.fetchAudio(U('l1.ogg'), true);
  check('morceau connu comme protégé (track.protected) : lien signé d\'emblée, aucun essai public', r.url === 'https://signed.example/l1' && !w.log.fetched.some(u => u.includes('media.layerpitch.com')));

  w = world({ publicStatus: 404, allowed: true });
  r = await w.f.fetchAudio('https://media.layerpitch.com/audio/sfx-boom/l1.ogg');
  check('Sfx protégé : lien signé demandé avec { sfxId } (sans le préfixe sfx-)', r.url === 'https://signed.example/l1' && w.log.invoked.join() === 'track-audio-url:{"sfxId":"boom"}');
  w = world({ publicStatus: 404, allowed: true });
  r = await w.f.fetchAudio('https://example.com/vendor/fonts/x.ttf');
  check('autre adresse (police, vidéo…) : lecture ordinaire', w.log.invoked.length === 0 && w.log.fetched.pop() === 'https://example.com/vendor/fonts/x.ttf');
  w = world({ publicStatus: 500, allowed: true });
  r = await w.f.fetchAudio(U('l1.ogg'));
  check('erreur serveur (500) : pas de bascule, la réponse est rendue', r.status === 500 && w.log.invoked.length === 0);

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
