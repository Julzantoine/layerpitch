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

  // ---- Équipe du studio (étape 5a, 28/09, migration 20260928060000) ----
  async function myTeamPurchases() {
    const { data, error } = await rpc('my_team_purchases');
    return { purchases: data || [], error };
  }
  async function myTeam() {
    const { data, error } = await rpc('my_team');
    return { team: data, error };
  }
  // Invite (quota vérifié par le serveur) puis envoie l'e-mail (Edge Function invite-team-member). En cas d'échec
  // d'envoi, actionLink permet de transmettre le lien soi-même ; l'invitation reste valable.
  async function inviteTeamMember(email, redirectTo) {
    const { data: memberId, error } = await rpc('invite_team_member', { p_email: email });
    if (error) return { ok: false, error };
    const res = await getClient().functions.invoke('invite-team-member', { body: { memberId, redirectTo } });
    if (res.error) {
      let body = null;
      try { body = res.error.context && typeof res.error.context.json === 'function' ? await res.error.context.json() : null; } catch (e) {}
      return { ok: true, emailError: (body && body.error) || 'e-mail non envoyé', actionLink: body && body.actionLink };
    }
    return { ok: true };
  }
  async function resendTeamInvitation(memberId, redirectTo) {
    const res = await getClient().functions.invoke('invite-team-member', { body: { memberId, redirectTo } });
    if (res.error) {
      let body = null;
      try { body = res.error.context && typeof res.error.context.json === 'function' ? await res.error.context.json() : null; } catch (e) {}
      return { ok: false, error: (body && body.error) || 'e-mail non envoyé', actionLink: body && body.actionLink };
    }
    return { ok: true };
  }
  async function removeTeamMember(memberId) {
    const { error } = await rpc('remove_team_member', { p_member_id: memberId });
    return error ? { ok: false, error } : { ok: true };
  }
  async function transferOwnership(memberId) {
    const { error } = await rpc('transfer_studio_ownership', { p_member_id: memberId });
    return error ? { ok: false, error } : { ok: true };
  }
  async function myTeamInvitations() {
    const { data, error } = await rpc('my_team_invitations');
    return { invitations: data || [], error };
  }
  async function respondTeamInvitation(memberId, accept) {
    const { error } = await rpc('respond_team_invitation', { p_member_id: memberId, p_accept: !!accept });
    return error ? { ok: false, error } : { ok: true };
  }

  // ---- Crédits (étape 6b, 28/09, migration 20260928090000) ----
  async function myCredits() {
    const { data, error } = await rpc('my_credits');
    return { credits: data, error };
  }
  async function takePackWithCredits(packId) {
    const { data, error } = await rpc('take_pack_with_credits', { p_pack_id: packId });
    return error ? { ok: false, error } : { ok: true, balance: data && data.balance };
  }

  window.LayerPitchStudio = { myCredits, takePackWithCredits, myEntitlements, myFeatureFlags, catalog, myOwnedAssets, myCustomPacks, saveCustomPack, deleteCustomPack,
    myTeamPurchases, myTeam, inviteTeamMember, resendTeamInvitation, removeTeamMember, transferOwnership, myTeamInvitations, respondTeamInvitation };
})();
