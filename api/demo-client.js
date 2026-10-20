// api/demo-client.js — LayerPitch, faux serveur local du MODE TUTORIEL (layerpitch-backstage.html?tuto)
//
// Faux client Supabase qui vit uniquement dans la page (window.LayerPitchDemoClient).
// Tous les api/*.js passent par window.LayerPitchSupabaseClient.getClient() (voir api/supabase-client.js), donc ils
// marchent sans aucune modification, mais ne parlent plus à aucun serveur :
//   - compte fictif « Compositeur de démonstration », connecté d'office (aucune vraie session n'est lue ni modifiée) ;
//   - bibliothèque d'exemple vide au départ (l'apprenant dépose ses fichiers dans les leçons) ;
//   - toutes les écritures (rpc, insert, upsert…) sont acceptées puis JETÉES : rien n'est enregistré, rien n'est
//     partagé, tout est remis à zéro au prochain chargement de la page ;
//   - les fonctions serveur (envoi de fichiers, aperçus de liens, invitations…) répondent « indisponible en mode
//     tutoriel » ; les appelants affichent déjà leurs erreurs.
// Chargé par loadPostgresReadScripts() (src/backstage/13-suivi-d-usage.js) uniquement quand l'adresse contient ?tuto.

(function () {
  const DEMO_USER = { id: 'demo-user', email: 'demo@layerpitch.com', user_metadata: {}, app_metadata: {} };
  const DEMO_SESSION = { access_token: 'demo', refresh_token: 'demo', expires_in: 86400, token_type: 'bearer', user: DEMO_USER };
  const DEMO_COMPOSER_ID = 'demo-composer';

  // Feux verts ouverts dans le tutoriel : ce dont les leçons ont besoin, rien d'autre (les nouveautés restent fermées).
  const DEMO_FLAGS = ['in_app_lessons', 'audio_fx', 'bulk_drop'];
  // Droits de la matrice : tout ce qui touche à la vente ou au compte payant reste fermé.
  const DEMO_ENTITLEMENTS_ALLOWED = ['versioning'];
  const DEMO_ENTITLEMENTS_DENIED = ['custom_address', 'private_links', 'sell_albums', 'sell_packs', 'subscriber_catalog'];

  const RPC_ANSWERS = {
    is_admin: () => false,
    my_feature_flags: () => DEMO_FLAGS.map(key => ({ key, allowed: true })),
    my_entitlements: () => DEMO_ENTITLEMENTS_ALLOWED.map(f => ({ feature: f, allowed: true, amount: null, level: 'pro', plan: 'pro', source: 'demo' }))
      .concat(DEMO_ENTITLEMENTS_DENIED.map(f => ({ feature: f, allowed: false, amount: null, level: null, plan: 'pro', source: 'demo' }))),
    get_trial_status: () => [{ plan: 'pro', trial_ends_at: null, real_plan: 'pro', preview_active: false }],
    my_billing: () => ({}),
    my_admin_preview: () => null,
    ensure_composer_profile: () => DEMO_COMPOSER_ID,
    my_studio: () => null,
    list_my_videos: () => [],
    account_deletion_status: () => null,
  };
  // Lignes lues « en direct » sur une table (select().maybeSingle()). Toute autre table : liste vide / null.
  const TABLE_ROWS = {
    composer_profiles: { id: DEMO_COMPOSER_ID, handle: 'demo' },
    profiles: { onboarding_completed: true },
  };

  const OK = (data) => ({ data: data === undefined ? null : data, error: null });
  const UNAVAILABLE = { message: 'Indisponible en mode tutoriel : rien n\'est enregistré.' };

  // Requête chaînable (select/eq/order…) qui se résout au « await » : la liste de la table, ou la ligne unique demandée.
  function makeQuery(table, isWrite, payload) {
    let single = false;
    const q = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') {
          const row = TABLE_ROWS[table];
          let result;
          if (isWrite) result = OK(single ? (payload || null) : null);
          else if (single) result = OK(row || null);
          else result = OK(row ? [row] : []);
          return (res, rej) => Promise.resolve(result).then(res, rej);
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return q; };
        return () => q; // select, eq, in, order, limit, filter… : on ignore, la réponse est de toute façon locale
      },
    });
    return q;
  }

  const listeners = [];
  const auth = {
    getSession: async () => OK({ session: DEMO_SESSION }),
    getUser: async () => OK({ user: DEMO_USER }),
    onAuthStateChange(cb) {
      listeners.push(cb);
      setTimeout(() => { try { cb('INITIAL_SESSION', DEMO_SESSION); } catch (e) { console.warn(e); } }, 0);
      return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } } } };
    },
    // Quitter le tutoriel = retour au vrai Backstage (la page de démonstration n'a pas de vraie session à fermer).
    signOut: async () => { window.location.href = window.location.pathname; return { error: null }; },
    signInWithOtp: async () => ({ data: null, error: UNAVAILABLE }),
    verifyOtp: async () => ({ data: null, error: UNAVAILABLE }),
  };

  const demoClient = {
    auth,
    from: (table) => ({
      select: () => makeQuery(table, false),
      insert: (p) => makeQuery(table, true, p),
      upsert: (p) => makeQuery(table, true, p),
      update: (p) => makeQuery(table, true, p),
      delete: () => makeQuery(table, true),
    }),
    rpc: async (name) => {
      const answer = RPC_ANSWERS[name];
      return OK(answer ? answer() : null);
    },
    // Temps réel (présence, « ça a changé ») : rien à écouter dans un tutoriel à un seul utilisateur.
    channel: () => { const c = { on: () => c, subscribe: () => c, track: () => c, send: () => c, presenceState: () => ({}), unsubscribe() {} }; return c; },
    removeChannel: () => {},
    functions: { invoke: async () => ({ data: null, error: UNAVAILABLE }) },
    storage: { from: () => ({ upload: async () => ({ data: null, error: UNAVAILABLE }), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => OK(null) }) },
  };

  // loadPostgresReadScripts() met ensuite ce client à la place du vrai (window.LayerPitchSupabaseClient.getClient).
  window.LayerPitchDemoClient = demoClient;
})();
