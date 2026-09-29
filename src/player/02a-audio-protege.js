// ---------------------------------------------------------------------------------------------------------------------
// Audio des morceaux PROTÉGÉS (29/09, « protéger l'album », choix par morceau ; migration 20260929050000).
//
// Les fichiers d'un morceau protégé ne sont plus à leur adresse publique (…/audio/<id>/<fichier>) : ils sont dans un seau
// privé, lisibles par des liens signés que l'Edge Function track-audio-url délivre selon can_hear_track (acheteur,
// vendeur, compositeur, écoute libre, AdReel…). fetchAudio(url) est le SEUL point de lecture de l'audio d'un morceau :
//   * adresse publique d'abord (sauf morceau déjà connu comme protégé) ; si elle répond « introuvable » (404) ou
//     « interdit » (403), lien signé -- c'est aussi ce qui fait relire les versions figées des fans, dont l'adresse
//     publique d'origine est gardée telle quelle dans la prise ;
//   * les liens signés d'un morceau sont gardés en mémoire (une seule demande par morceau et par session, renouvelée à
//     l'approche de leur expiration) ;
//   * sans droit d'écoute (ou sans client Supabase sur la page) : la réponse d'origine est rendue, en erreur comme avant.
// Les Sfx (audio/sfx-…) restent publics.
// ---------------------------------------------------------------------------------------------------------------------
const _protectedTrackIds = new Set();
const _signedAudio = new Map(); // id du morceau -> { files, expiresAt } | { none: true, until }
const _signedAudioPending = new Map();
const MEDIA_AUDIO_RE = /^https?:\/\/[^/]+\/audio\/([^/?#]+)\/([^?#]+)/;

async function signedAudioFor(trackId) {
  const cached = _signedAudio.get(trackId);
  if (cached && (cached.none ? cached.until : cached.expiresAt) > Date.now()) return cached.none ? null : cached;
  if (_signedAudioPending.has(trackId)) return _signedAudioPending.get(trackId);
  const p = (async () => {
    try {
      const sb = window.LayerPitchSupabaseClient;
      if (!sb) return null;
      const { data, error } = await sb.getClient().functions.invoke('track-audio-url', { body: { trackId } });
      if (error || !data || !data.ok || data.protected === false || !data.files) {
        _signedAudio.set(trackId, { none: true, until: Date.now() + 60000 }); // pas d'accès (ou pas protégé) : on ne redemande pas à chaque fichier
        return null;
      }
      const entry = { files: data.files, expiresAt: Date.now() + Math.max(30, (data.expiresIn || 900) - 60) * 1000 };
      _signedAudio.set(trackId, entry);
      return entry;
    } catch (e) { return null; }
    finally { _signedAudioPending.delete(trackId); }
  })();
  _signedAudioPending.set(trackId, p);
  return p;
}

// hintProtected : le morceau est déjà connu comme protégé (track.protected) -> pas d'essai sur l'adresse publique.
async function fetchAudio(url, hintProtected) {
  const m = MEDIA_AUDIO_RE.exec(url);
  if (!m || m[1].startsWith('sfx-')) return fetch(url);
  const trackId = m[1];
  if (hintProtected) _protectedTrackIds.add(trackId);
  let first = null;
  if (!_protectedTrackIds.has(trackId)) {
    first = await fetch(url);
    if (first.ok || (first.status !== 404 && first.status !== 403)) return first;
  }
  const entry = await signedAudioFor(trackId);
  const signedUrl = entry && entry.files[decodeURIComponent(m[2])];
  if (signedUrl) { _protectedTrackIds.add(trackId); return fetch(signedUrl); }
  return first || fetch(url);
}
async function fetchAudioBytes(url) {
  const res = await fetchAudio(url);
  if (!res.ok) throw new Error('Fichier audio introuvable : ' + url);
  return new Uint8Array(await res.arrayBuffer());
}

