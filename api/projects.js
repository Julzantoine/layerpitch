// api/projects.js — LayerPitch, Projets (chantier profils et permissions, étape 5, 28/09). Couche mince au-dessus des
// RPC de 20260928070000 / 20260928080000 (droits vérifiés en base à chaque appel) et des Edge Functions project-file-url
// (fichiers privés, URL signées) et project-notify (e-mails). Chaque fonction renvoie { data, error } ou { ok, error }.
(function () {
  function getClient() { return window.LayerPitchSupabaseClient.getClient(); }
  async function rpc(name, args) {
    const { data, error } = await getClient().rpc(name, args);
    return error ? { data: null, error: error.message || String(error) } : { data, error: null };
  }
  async function invoke(name, body) {
    const { data, error } = await getClient().functions.invoke(name, { body });
    if (error) {
      let parsed = null;
      try { parsed = error.context && typeof error.context.json === 'function' ? await error.context.json() : null; } catch (e) {}
      return { data: parsed, error: (parsed && parsed.error) || (window.LayerPitchAuth && await window.LayerPitchAuth.describeFunctionError(error)) || 'Erreur' };
    }
    return { data, error: data && data.error ? data.error : null };
  }

  const P = {
    // Projet de démonstration public (sans compte, lecture seule) : voir la migration 20260929010000.
    publicDemo: () => rpc('get_public_demo'),
    // Interrupteur « Démo publique » (administrateurs et compte de démo) : { eligible, projectId } et pose / retrait de la marque.
    demoStatus: () => rpc('get_public_demo_status'),
    setDemo: (id, on) => rpc('set_public_demo', { p_project_id: id, p_on: !!on }),
    listMine: () => rpc('list_my_projects'),
    // Carte de niveau (6/10, migration 20261006020000) : plusieurs cartes par Projet, une carte = un document JSON.
    listMaps: id => rpc('list_project_maps', { p_project_id: id }),
    saveMap: (id, p) => rpc('save_project_map', { p_project_id: id, p }),
    deleteMap: mapId => rpc('delete_project_map', { p_map_id: mapId }),
    // Sections (7/10, migration 20261007030000) : arbre libre ; un objet peut être dans plusieurs sections ; sans section = « Sans section ».
    // list rend { sections: [{ id, parentId, title, position }], links: [{ sectionId, assetId }] }.
    sections: id => rpc('list_project_sections', { p_project_id: id }),
    createSection: (id, title, parentId) => rpc('create_project_section', { p_project_id: id, p_title: title, p_parent_id: parentId || null }),
    renameSection: (sectionId, title) => rpc('rename_project_section', { p_section_id: sectionId, p_title: title }),
    moveSection: (sectionId, parentId, position) => rpc('move_project_section', { p_section_id: sectionId, p_parent_id: parentId || null, p_position: position == null ? null : position }),
    deleteSection: sectionId => rpc('delete_project_section', { p_section_id: sectionId }),
    setAssetSections: (assetId, sectionIds) => rpc('set_asset_sections', { p_asset_id: assetId, p_section_ids: sectionIds || [] }),
    addAssetsToSection: (sectionId, assetIds) => rpc('add_assets_to_section', { p_section_id: sectionId, p_asset_ids: assetIds }),
    // Moodboard par section (migration 20261007040000) : épingles propres à chaque section, sur les mêmes objets.
    sectionPins: id => rpc('list_section_pins', { p_project_id: id }),
    pinInSection: (sectionId, assetId, pinned) => rpc('pin_asset_in_section', { p_section_id: sectionId, p_asset_id: assetId, p_pinned: !!pinned }),
    starSectionPin: (sectionId, assetId, starred) => rpc('star_section_pin', { p_section_id: sectionId, p_asset_id: assetId, p_starred: !!starred }),
    reorderSectionPins: (sectionId, assetIds) => rpc('reorder_section_pins', { p_section_id: sectionId, p_asset_ids: assetIds }),
    // Tchat par section (migration 20261007050000) : un canal par section, texte seulement ; on suit un canal pour compter ses non lus.
    sectionMessages: (sectionId, before) => rpc('list_section_messages', { p_section_id: sectionId, p_before: before || null }),
    // attachments : [{ fileId, title }] — fichiers déjà envoyés ; ils deviennent des objets du Projet rangés dans la section (migration 20261007070000).
    postSectionMessage: (sectionId, body, attachments) => rpc('post_section_message', { p_section_id: sectionId, p_body: body || '', p_attachments: attachments || [] }),
    deleteSectionMessage: messageId => rpc('delete_section_message', { p_message_id: messageId }),
    setSectionFollow: (sectionId, follow) => rpc('set_section_follow', { p_section_id: sectionId, p_follow: !!follow }),
    markSectionRead: sectionId => rpc('mark_section_read', { p_section_id: sectionId }),
    sectionChatState: id => rpc('section_chat_state', { p_project_id: id }),
    setSectionMap: (sectionId, mapId) => rpc('set_section_map', { p_section_id: sectionId, p_map_id: mapId || null }),
    removeAssetsFromSection: (sectionId, assetIds) => rpc('remove_assets_from_section', { p_section_id: sectionId, p_asset_ids: assetIds }),
    // Apparence d'équipe d'un Projet (migration 20261008010000) : { bg, image, opacity, fixed } ; {} = rien de réglé. Réglage : administrateur du Projet.
    appearance: id => rpc('get_project_appearance', { p_project_id: id }),
    setAppearance: (id, p) => rpc('set_project_appearance', { p_project_id: id, p: p || {} }),
    create: (title, description, asStudio) => rpc('create_project', { p_title: title, p_description: description || '', p_as_studio: !!asStudio }),
    get: id => rpc('get_project', { p_project_id: id }),
    content: id => rpc('get_project_content', { p_project_id: id }),
    update: (id, title, description) => rpc('update_project', { p_project_id: id, p_title: title, p_description: description }),
    archive: (id, archived) => rpc('archive_project', { p_project_id: id, p_archived: !!archived }),
    // Suppression : la base rend les chemins des fichiers, effacés ensuite du stockage privé.
    async remove(id) {
      const r = await rpc('delete_project', { p_project_id: id });
      if (r.error) return r;
      for (const path of (r.data && r.data.filePaths) || []) await P.eraseStoredFile(path);
      return r;
    },
    // Membres et invitations
    async invite(id, email, redirectTo) {
      const r = await rpc('invite_project_member', { p_project_id: id, p_email: email });
      if (r.error) return r;
      const mail = await invoke('project-notify', { action: 'invite', memberId: r.data, redirectTo });
      return { data: r.data, error: null, emailError: mail.error, actionLink: mail.data && mail.data.actionLink };
    },
    resendInvite: (memberId, redirectTo) => invoke('project-notify', { action: 'invite', memberId, redirectTo }),
    removeMember: memberId => rpc('remove_project_member', { p_member_id: memberId }),
    myInvitations: () => rpc('my_project_invitations'),
    respondInvitation: (memberId, accept) => rpc('respond_project_invitation', { p_member_id: memberId, p_accept: !!accept }),
    // Discussion, activité, notifications
    messages: (id, before, query) => rpc('list_project_messages', { p_project_id: id, p_before: before || null, p_limit: 50, p_query: query || null }),
    // attachments : [{ fileId, title }] — fichiers déjà envoyés (upload), qui deviennent des objets du Projet (étape 3).
    post: (id, body, attachments) => rpc('post_project_message', { p_project_id: id, p_body: body || '', p_attachments: attachments || [] }),
    editMessage: (messageId, body) => rpc('edit_project_message', { p_message_id: messageId, p_body: body }),
    deleteMessage: messageId => rpc('delete_project_message', { p_message_id: messageId }),
    activity: id => rpc('list_project_activity', { p_project_id: id, p_limit: 150 }),
    notifications: unreadOnly => rpc('my_project_notifications', { p_unread_only: !!unreadOnly }),
    markRead: id => rpc('mark_project_notifications_read', { p_project_id: id || null }),
    // Dernière visite de ce Projet (cloche commune : « nouveau depuis ta dernière visite », suit d'un appareil à l'autre).
    markSeen: id => rpc('mark_project_seen', { p_project_id: id }),
    // Réserve de contenus (un objet par chose réelle du Projet) et Moodboard (épingles), étape 1 du 28/09.
    // addAsset renvoie { data: { id, existed } } : existed = la même chose était déjà dans le Projet.
    addAsset: (id, asset, pin) => rpc('add_project_asset', { p_project_id: id, p: asset, p_pin: !!pin }),
    updateAsset: (assetId, patch) => rpc('update_project_asset', { p_asset_id: assetId, p: patch }),
    // Supprimer du Projet : la base rend le chemin du fichier envoyé (s'il y en a un), effacé ensuite du stockage.
    async deleteAsset(assetId) {
      const r = await rpc('delete_project_asset', { p_asset_id: assetId });
      if (!r.error && r.data) await P.eraseStoredFile(r.data);
      return r;
    },
    // Aperçu d'un lien (titre, vignette, lecteur intégrable) récupéré côté serveur auprès du service d'origine (étape 2).
    preview: assetId => invoke('link-preview', { assetId }),
    pin: (assetId, pinned) => rpc('pin_project_asset', { p_asset_id: assetId, p_pinned: !!pinned }),
    star: (assetId, starred) => rpc('star_project_asset', { p_asset_id: assetId, p_starred: !!starred }),
    reorderMoodboard: (id, assetIds) => rpc('reorder_moodboard', { p_project_id: id, p_asset_ids: assetIds }),
    // Sauvegarde auto du Moodboard (étape 4) : 'off' | 'daily' | 'weekly' (administrateur du Projet).
    setAutoSnapshot: (id, mode) => rpc('set_project_auto_snapshot', { p_project_id: id, p_mode: mode }),
    snapshot: (id, label) => rpc('create_project_snapshot', { p_project_id: id, p_label: label }),
    snapshots: id => rpc('list_project_snapshots', { p_project_id: id }),
    restore: snapshotId => rpc('restore_project_snapshot', { p_snapshot_id: snapshotId }),
    // Notes : targetType 'asset' (un objet de la réserve, où qu'il soit affiché), 'message' ou 'project' ; atPart = partie
    // d'un morceau adaptatif (« Segment 2 »), à côté de l'instant.
    annotations: (id, targetType, targetId) => rpc('list_project_annotations', { p_project_id: id, p_target_type: targetType || null, p_target_id: targetId || null }),
    // addresseeId = un membre, null = pour tout le monde, P.PRIVATE = « juste pour moi » (visible par son seul auteur).
    PRIVATE: '__me',
    async annotate(id, targetType, targetId, atSeconds, body, addresseeId, projectUrl, atPart) {
      const priv = addresseeId === P.PRIVATE;
      const to = priv ? null : (addresseeId || null);
      const r = await rpc('add_project_annotation', { p_project_id: id, p_target_type: targetType, p_target_id: targetId, p_at_seconds: atSeconds == null ? null : atSeconds, p_body: body, p_addressee: to, p_at_part: atPart || null, p_private: priv });
      if (!r.error && to) invoke('project-notify', { action: 'annotation', annotationId: r.data, projectUrl }); // e-mail en arrière-plan
      return r;
    },
    resolve: (annotationId, resolved) => rpc('resolve_project_annotation', { p_annotation_id: annotationId, p_resolved: !!resolved }),
    deleteAnnotation: annotationId => rpc('delete_project_annotation', { p_annotation_id: annotationId }),
    // Musique
    sharePack: (id, packId, mode) => rpc('share_pack_in_project', { p_project_id: id, p_pack_id: packId, p_mode: mode }),
    unsharePack: (id, packId) => rpc('unshare_pack_from_project', { p_project_id: id, p_pack_id: packId }),
    linkAlbum: (id, albumId, linked) => rpc('link_album_to_project', { p_project_id: id, p_album_id: albumId, p_linked: linked !== false }),
    // Vitrines (étape 6, 28/09) : plusieurs par Projet, en blocs au format de l'AdReel (voir la migration 20260928200000).
    vitrines: id => rpc('list_project_vitrines', { p_project_id: id }),
    saveVitrine: (id, vitrine) => rpc('save_project_vitrine', { p_project_id: id, p: vitrine }),
    deleteVitrine: vitrineId => rpc('delete_project_vitrine', { p_vitrine_id: vitrineId }),
    renewVitrineToken: vitrineId => rpc('renew_vitrine_token', { p_vitrine_id: vitrineId }),
    vitrineFromSnapshot: (snapshotId, audience) => rpc('vitrine_from_snapshot', { p_snapshot_id: snapshotId, p_audience: audience || 'publisher' }),
    // Lecture publique : par adresse (publiée), par lien secret (éditeur) ou par identifiant (aperçu d'un membre).
    // Statistiques des vitrines (étape 6b) : écriture sans compte (visites des membres ignorées côté serveur), lecture membres.
    logVitrineEvent: (vitrineId, sessionId, name, detail, device) => rpc('log_vitrine_event', { p_vitrine_id: vitrineId, p_session_id: sessionId, p_event_name: name, p_detail: detail || {}, p_device: device || null }),
    vitrineStats: (vitrineId, days) => rpc('get_vitrine_stats', { p_vitrine_id: vitrineId, p_days: days || 30 }),
    getVitrine: ({ slug, token, id } = {}) => rpc('get_vitrine', { p_slug: slug || null, p_token: token || null, p_id: id || null }),
    // Fichiers : réservation + envoi (URL signée, type et taille verrouillés), lecture signée, effacement.
    async upload(id, file, onProgress) {
      const signed = await invoke('project-file-url', { action: 'upload', projectId: id, name: file.name, size: file.size });
      if (signed.error) return { data: null, error: signed.error };
      const res = await fetch(signed.data.url, { method: 'PUT', headers: signed.data.headers || {}, body: file }).catch(e => ({ ok: false, statusText: e.message }));
      if (!res.ok) {
        await rpc('delete_project_file', { p_file_id: signed.data.fileId });
        return { data: null, error: 'Envoi interrompu (' + (res.statusText || res.status) + ')' };
      }
      const done = await rpc('complete_project_file', { p_file_id: signed.data.fileId });
      if (onProgress) onProgress(1);
      return done.error ? done : { data: { fileId: signed.data.fileId }, error: null };
    },
    // vitrineToken : lien secret d'une vitrine éditeur (lecture sans compte des fichiers qu'elle cite).
    async fileUrl(fileId, vitrineToken) {
      const r = await invoke('project-file-url', vitrineToken ? { action: 'read', fileId, vitrineToken } : { action: 'read', fileId });
      return r.error ? { data: null, error: r.error } : { data: r.data.url, error: null };
    },
    async deleteFile(fileId) {
      const r = await rpc('delete_project_file', { p_file_id: fileId });
      if (!r.error && r.data) await P.eraseStoredFile(r.data);
      return r;
    },
    async eraseStoredFile(path) {
      const r = await invoke('project-file-url', { action: 'delete', path });
      if (!r.error && r.data && r.data.url) await fetch(r.data.url, { method: 'DELETE' }).catch(() => {});
    },
  };
  window.LayerPitchProjects = P;
})();
