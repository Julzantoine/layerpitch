const fs = require('fs');
const path = require('path');
const vm = require('vm');

// api/albums.js côté fan (versions figées, 25/09) : chaque fonction appelle la bonne RPC avec les noms de paramètres
// exacts de la migration 20260925010000 / 20260921090000 (une faute de nom ne se voit qu'en production).
(async () => {
  let failures = 0;
  const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
  const calls = [];
  const responses = {
    get_my_album_versions: { data: { tracks: [{ trackId: 't1' }], versions: [{ id: 'v1' }] }, error: null },
    save_my_track_version: { data: 'new-id', error: null },
  };
  const client = { rpc: (name, args) => { calls.push({ name, args }); return Promise.resolve(responses[name] || { data: null, error: null }); } };
  const window = { LayerPitchSupabaseClient: { getClient: () => client } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'api/albums.js'), 'utf8'), { window });
  const A = window.LayerPitchAlbums;
  const last = () => calls[calls.length - 1];

  const got = await A.getMyAlbumVersions('al1');
  check('getMyAlbumVersions → get_my_album_versions(p_album_id)', last().name === 'get_my_album_versions' && last().args.p_album_id === 'al1');
  check('getMyAlbumVersions : morceaux et versions', got.tracks.length === 1 && got.versions[0].id === 'v1' && got.error === null);

  const take = { kind: 'layerpitch-take', trackId: 't1' };
  const saved = await A.saveMyTrackVersion('al1', 't1', 'Ma version', take);
  check('saveMyTrackVersion → save_my_track_version(p_album_id, p_track_id, p_name, p_take)',
    last().name === 'save_my_track_version' && last().args.p_album_id === 'al1' && last().args.p_track_id === 't1' && last().args.p_name === 'Ma version' && last().args.p_take === take);
  check('saveMyTrackVersion : renvoie l\'identifiant', saved.ok && saved.id === 'new-id');

  await A.renameMyTrackVersion('v1', 'Nouveau nom');
  check('renameMyTrackVersion → rename_my_track_version(p_version_id, p_name)', last().name === 'rename_my_track_version' && last().args.p_version_id === 'v1' && last().args.p_name === 'Nouveau nom');
  await A.deleteMyTrackVersion('v1');
  check('deleteMyTrackVersion → delete_my_track_version(p_version_id)', last().name === 'delete_my_track_version' && last().args.p_version_id === 'v1');

  await A.getMyAlbumSettings('al1');
  check('getMyAlbumSettings → get_my_album_settings', last().name === 'get_my_album_settings' && last().args.p_album_id === 'al1');
  await A.setMyAlbumTrackSettings('al1', 't1', { level: 2 });
  check('setMyAlbumTrackSettings → set_my_album_track_settings', last().name === 'set_my_album_track_settings' && last().args.p_track_id === 't1' && last().args.p_settings.level === 2);
  await A.resetMyAlbumTrackSettings('al1', 't1');
  check('resetMyAlbumTrackSettings → reset_my_album_track_settings', last().name === 'reset_my_album_track_settings' && last().args.p_track_id === 't1');

  await A.setAlbumTrackOfficialTake('al1', 't1', take);
  check('setAlbumTrackOfficialTake → set_album_track_default_settings (prise du vendeur)', last().name === 'set_album_track_default_settings' && last().args.p_settings === take);

  responses.save_my_track_version = { data: null, error: { message: 'Non autorisé : tu ne possèdes pas cet album' } };
  const refused = await A.saveMyTrackVersion('al1', 't1', '', take);
  check('refus serveur remonté tel quel', refused.ok === false && /ne possèdes pas/.test(refused.error));

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
  process.exit(failures ? 1 : 0);
})();
