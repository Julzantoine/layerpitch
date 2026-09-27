// api/composers.js — LayerPitch, résolution du handle public d'un compositeur (Décision 2,
// docs/infrastructure.md — chantier backstage hébergé, identité de compositeur dans l'URL).
//
// resolveHandle() est le point d'entrée des pages publiques (index.html/pack.html/collection.html)
// pour transformer un handle d'URL (?u=<handle>) en owner_id avant tout chargement de catalogue.
// Passe par la RPC resolve_composer_handle plutôt qu'une lecture directe de composer_profiles :
// cette table reste par ailleurs à lecture restreinte au propriétaire (comme profiles/
// buyer_profiles/pack_purchases), la RPC ne révèle que l'id, jamais les autres colonnes ni les
// autres compositeurs.

(function () {
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // Retourne null (pas d'erreur) si le handle n'existe pas — un handle inconnu dans l'URL n'est pas
  // une panne, juste "personne à cette adresse", à traiter comme tel côté appelant.
  async function resolveHandle(handle) {
    const { data, error } = await getClient().rpc('resolve_composer_handle', { p_handle: handle });
    if (error) return { ownerId: null, error: error.message };
    return { ownerId: data || null, error: null };
  }

  // Adresse publique complète (27/09) : nom du compositeur (actuel ou ancien) + nom d'AdReel (actuel ou ancien) ->
  // { ownerId, handle (actuel), adReelId (null = AdReel principal), slug (actuel) } ; link null si le nom est inconnu.
  async function resolvePublicLink(handle, slug) {
    const { data, error } = await getClient().rpc('resolve_public_link', { p_handle: handle, p_slug: slug || '' });
    if (error) return { link: null, error: error.message };
    return { link: data || null, error: null };
  }

  window.LayerPitchComposers = { resolveHandle, resolvePublicLink };
})();
