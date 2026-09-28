// api/studio.js — LayerPitch, espace studio (chantier profils et permissions, étape 3, 28/09) et catalogue public.
//
// Droits : my_entitlements() / my_feature_flags() (matrice des droits, 20260927070000). Catalogue : catalog_packs()
// (lecture publique, sans compte). Packs custom : RPC de 20260928030000 (propriété, quota et possession de chaque
// élément vérifiés côté serveur ; rien n'est lisible directement dans les tables).
(function () {
  function getClient() { return window.LayerPitchSupabaseClient.getClient(); }
  async function rpc(name, args) {
    const { data, error } = await getClient().rpc(name, args);
    return error ? { data: null, error: error.message || String(error) } : { data, error: null };
  }

  // Droits du compte connecté, indexés par fonction : { feature: { allowed, amount, level, plan, source, kind } }.
  async function myEntitlements() {
    const { data, error } = await rpc('my_entitlements');
    if (error) return { entitlements: null, error };
    const out = {};
    (data || []).forEach(r => { out[r.feature] = { kind: r.kind, allowed: r.allowed, amount: r.amount == null ? null : Number(r.amount), level: r.level, plan: r.plan, source: r.source }; });
    return { entitlements: out, error: null };
  }
  async function myFeatureFlags() {
    const { data, error } = await rpc('my_feature_flags');
    if (error) return { flags: null, error };
    const out = {};
    (data || []).forEach(r => { out[r.key] = !!r.allowed; });
    return { flags: out, error: null };
  }

  async function catalog() {
    const { data, error } = await rpc('catalog_packs');
    return { packs: data || [], error };
  }
  async function myOwnedAssets() {
    const { data, error } = await rpc('my_owned_assets');
    return { assets: data || [], error };
  }
  async function myCustomPacks() {
    const { data, error } = await rpc('list_my_custom_packs');
    return { customPacks: data || [], error };
  }
  async function saveCustomPack(payload) {
    const { data, error } = await rpc('upsert_my_custom_pack', { payload });
    return error ? { ok: false, error } : { ok: true, id: data && data.id };
  }
  async function deleteCustomPack(id) {
    const { error } = await rpc('delete_my_custom_pack', { p_id: id });
    return error ? { ok: false, error } : { ok: true };
  }

  window.LayerPitchStudio = { myEntitlements, myFeatureFlags, catalog, myOwnedAssets, myCustomPacks, saveCustomPack, deleteCustomPack };
})();
