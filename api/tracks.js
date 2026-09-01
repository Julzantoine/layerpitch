// api/tracks.js — LayerPitch, CRUD morceaux via SDK Supabase (Décision 2, docs/infrastructure.md)
//
// Lecture : directe via le SDK (RLS "public read"). Écriture : passe par la RPC upsert_track
// (jamais d'écriture directe sur tracks/segment_slots/segment_slot_transitions/track_sfx depuis
// le front) — seule la RPC valide le graphe segmentSlots/nextOptions avant d'écrire quoi que ce
// soit, une contrainte FK seule ne pouvant pas exprimer "la cible doit appartenir au même morceau".
//
// Nécessite le SDK Supabase + api/supabase-client.js chargés en amont (voir api/auth.js pour le
// détail des <script> requis).

(function () {
  // Client Supabase partagé (api/supabase-client.js) — voir ce fichier pour le pourquoi.
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // `!from_slot_id` : segment_slot_transitions porte deux FK vers segment_slots (from_slot_id et
  // target_slot_id), PostgREST ne peut pas deviner laquelle utiliser pour l'imbrication sans cet
  // indice explicite (trouvé au test réel via le navigateur — l'appel échouait silencieusement
  // avec "more than one relationship was found").
  const TRACK_SELECT = `*, track_sfx(sfx_id, position), segment_slots(*, segment_slot_transitions!from_slot_id(*))`;

  // Reconstruit la forme attendue par player.js (mêmes noms de champs que data.json) à partir des
  // lignes Postgres (snake_case, imbriquées via l'embedding PostgREST).
  function reshapeTrack(row) {
    if (!row) return null;
    const segmentSlots = [...(row.segment_slots || [])]
      .sort((a, b) => a.position - b.position)
      .map(s => {
        const nextOptions = [...(s.segment_slot_transitions || [])]
          .sort((a, b) => a.position - b.position)
          .map(tr => ({ targetId: tr.target_slot_id, label: tr.label, transition: tr.transition }));
        return {
          id: s.id, label: s.label, avoidImmediateRepeat: s.avoid_immediate_repeat,
          referencesSlotId: s.references_slot_id, repeatCount: s.repeat_count, quantization: s.quantization,
          cutStyle: s.cut_style, descriptionFr: s.description_fr, descriptionEn: s.description_en,
          alternatives: s.alternatives, nextOptions: nextOptions.length ? nextOptions : null,
          bpm: s.bpm != null ? Number(s.bpm) : null, beatsPerBar: s.beats_per_bar,
          customCutFadeSec: s.custom_cut_fade_sec != null ? Number(s.custom_cut_fade_sec) : null,
        };
      });
    const sfxIds = [...(row.track_sfx || [])].sort((a, b) => a.position - b.position).map(r => r.sfx_id);
    return {
      id: row.id, folderId: row.folder_id, title: row.title, description: row.description, mode: row.mode,
      loopable: row.loopable, implementationNote: row.implementation_note, noAiOverride: row.no_ai_override,
      loopEngine: row.loop_engine, bpm: row.bpm != null ? Number(row.bpm) : null, beatsPerBar: row.beats_per_bar,
      loopGridUnit: row.loop_grid_unit, loopInBeat: row.loop_in_beat != null ? Number(row.loop_in_beat) : null,
      loopOutBeat: row.loop_out_beat != null ? Number(row.loop_out_beat) : null,
      startTrackBeat: row.start_track_beat != null ? Number(row.start_track_beat) : null,
      maxLoops: row.max_loops, maxChainLoops: row.max_chain_loops, normalizeVolume: row.normalize_volume,
      duration: Number(row.duration), base: row.base, layers: row.layers, intro: row.intro, outro: row.outro,
      segmentSlots, loops: row.loops, randomizeSections: row.randomize_sections, sections: row.sections, sfxIds,
    };
  }

  // opts.ownerId : filtre par compositeur (Session C/D, isolation multi-compositeur — sans ce
  // filtre, listTracks() renvoyait le catalogue de TOUS les compositeurs mélangés, sans distinction
  // possible entre bibliothèque du backstage courant et celle des autres comptes ; trouvé en
  // préparant l'authentification des testeurs, voir docs/LAYERPITCH_CHANGELOG.md). Omis = comportement
  // historique inchangé (utilisé nulle part après ce correctif, gardé pour compatibilité ascendante).
  async function listTracks(opts) {
    let query = getClient().from('tracks').select(TRACK_SELECT);
    if (opts && opts.ownerId) query = query.eq('owner_id', opts.ownerId);
    const { data, error } = await query;
    if (error) return { tracks: null, error: error.message };
    return { tracks: data.map(reshapeTrack), error: null };
  }

  // Organisation propre au backstage — jamais lue par le rendu public (index.html/pack.html/
  // collection.html), mais nécessaire dès qu'un consommateur (ex. le backstage lui-même) reconstruit
  // library.folderId : son garde-fou existant réinitialise à null tout folderId ne correspondant à
  // aucun dossier connu, donc une liste de dossiers absente/vide y est interprétée comme "tous les
  // dossiers supprimés" plutôt que comme "non demandée".
  // opts.ownerId : voir le commentaire d'isolation multi-compositeur plus haut (listTracks).
  async function listTrackFolders(opts) {
    let query = getClient().from('track_folders').select('*');
    if (opts && opts.ownerId) query = query.eq('owner_id', opts.ownerId);
    const { data, error } = await query;
    if (error) return { folders: null, error: error.message };
    return { folders: data.map(f => ({ id: f.id, label: f.label })), error: null };
  }

  async function getTrack(id) {
    const { data, error } = await getClient().from('tracks').select(TRACK_SELECT).eq('id', id).maybeSingle();
    if (error) return { track: null, error: error.message };
    return { track: reshapeTrack(data), error: null };
  }

  // payload : même forme qu'un morceau de data.json (voir reshapeTrack ci-dessus pour le mapping
  // inverse). Réservé à l'admin — la RPC elle-même refuse tout autre appelant (voir migrations).
  async function upsertTrack(payload) {
    const { data, error } = await getClient().rpc('upsert_track', { payload });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  window.LayerPitchTracks = { listTracks, getTrack, upsertTrack, listTrackFolders };
})();
