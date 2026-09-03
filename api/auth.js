// api/auth.js — LayerPitch, couche d'abstraction authentification (Supabase Auth)
// (docs/infrastructure.md, Partie B, Décision 2 et Décision 4)
//
// SEUL fichier du front autorisé à toucher supabase.auth.* ou l'Edge Function invite-tester —
// aucun autre fichier ne doit importer le SDK Supabase pour l'auth, pensé pour la réversibilité
// (remplacer Supabase Auth plus tard ne toucherait que ce fichier).
//
// Nécessite le SDK Supabase + api/supabase-client.js chargés en amont via <script> (build UMD,
// pas de module ES — voir contrainte 100% statique/file://) :
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
//   <script src="api/supabase-client.js"></script>
//   <script src="api/auth.js"></script>
//
// Connexion par magic link (passwordless) uniquement, inscriptions publiques désactivées côté
// projet Supabase (Décision 4) — seuls les comptes créés via invitation admin peuvent se
// connecter. `inviteTester()` appelle l'Edge Function invite-tester, qui détient seule la clé
// secrète Supabase Auth Admin (jamais exposée ici).

(function () {
  // Client Supabase partagé (api/supabase-client.js) — une seule instance GoTrueClient par page,
  // voir ce fichier pour le pourquoi (bug de course sur la détection de session par lien magique).
  function getClient() {
    return window.LayerPitchSupabaseClient.getClient();
  }

  // Envoie le lien magique à cette adresse. redirectTo : URL de retour après clic sur le lien
  // (doit être dans la liste d'URLs autorisées du projet Supabase, Authentication > URL
  // Configuration — sinon Supabase refuse silencieusement la redirection).
  async function signInWithMagicLink(email, redirectTo) {
    const { error } = await getClient().auth.signInWithOtp({
      email,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });
    return { ok: !error, error: error ? error.message : null };
  }

  async function signOut() {
    const { error } = await getClient().auth.signOut();
    return { ok: !error, error: error ? error.message : null };
  }

  // { session, user } — session est null si personne n'est connecté.
  async function getSession() {
    const { data, error } = await getClient().auth.getSession();
    return { session: data ? data.session : null, error: error ? error.message : null };
  }

  // callback(event, session) — appelé immédiatement avec l'état courant puis à chaque changement
  // (connexion, déconnexion, rafraîchissement de jeton). Retourne une fonction de désinscription.
  function onAuthStateChange(callback) {
    const { data } = getClient().auth.onAuthStateChange(callback);
    return () => data.subscription.unsubscribe();
  }

  // Invite un·e testeur·euse par email (compte créé, email d'invitation envoyé). Réservé à
  // Jules-Antoine : l'Edge Function vérifie elle-même que l'appelant est authentifié ET que son
  // adresse correspond à ADMIN_EMAIL (secret de la fonction) — pas de table `profiles`/rôle
  // disponible à ce stade (arrive à l'étape 3, base Postgres), donc vérification par email en
  // dur côté serveur en attendant. À durcir une fois `profiles` en place.
  // Vigilance opérationnelle (Décision 4) : limite par défaut de 2 emails/heure côté Supabase —
  // espacer les invitations en rafale, ou configurer un SMTP personnalisé.
  // redirectTo : URL de retour après clic sur le lien d'invitation (même exigence que
  // signInWithMagicLink — doit être dans la liste d'URLs autorisées du projet Supabase). Sans ça,
  // Supabase retombe sur la Site URL par défaut du projet, jamais configurée pour ce cas (trouvé
  // le 1er septembre, lien d'invitation cassé au premier vrai essai).
  async function inviteTester(email, redirectTo) {
    const { data, error } = await getClient().functions.invoke('invite-tester', { body: { email, redirectTo } });
    if (error) return { ok: false, error: await describeFunctionError(error) };
    return { ok: true, data };
  }

  // error.message du SDK Supabase pour une Edge Function en échec est un message générique
  // ("Edge Function returned a non-2xx status code") qui masque le vrai message JSON que la
  // fonction a renvoyé (ex. "email rate limit exceeded", "Non autorisé") — trouvé le 1er
  // septembre, premier vrai essai d'invitation illisible pour Jules-Antoine. error.context est la
  // Response brute du fetch quand elle existe (FunctionsHttpError) ; on la relit ici plutôt que de
  // se contenter du message générique.
  async function describeFunctionError(error) {
    if (error && error.context && typeof error.context.json === 'function') {
      try {
        const body = await error.context.json();
        if (body && body.error) return body.error;
      } catch (e) { /* corps non-JSON ou déjà consommé : repli sur error.message */ }
    }
    return error.message;
  }

  // Id de la ligne composer_profiles du compte connecté, null si personne n'est connecté ou si
  // aucun composer_profile n'existe encore pour ce compte (RLS "own composer profile" : lecture de
  // sa propre ligne seulement — voir supabase/migrations pour le détail).
  async function getMyComposerId() {
    const { data: userData } = await getClient().auth.getUser();
    if (!userData || !userData.user) return { composerId: null, error: null };
    const { data, error } = await getClient().from('composer_profiles').select('id').maybeSingle();
    if (error) return { composerId: null, error: error.message };
    return { composerId: data ? data.id : null, error: null };
  }

  // Handle public du compte connecté (docs/infrastructure.md, chantier backstage hébergé — identité
  // de compositeur dans l'URL) — null si aucun handle attribué (cas de tout compositeur autre que
  // Jules-Antoine tant que le flux d'inscription n'attribue pas encore de handle réel).
  async function getMyComposerHandle() {
    const { data: userData } = await getClient().auth.getUser();
    if (!userData || !userData.user) return { handle: null, error: null };
    const { data, error } = await getClient().from('composer_profiles').select('handle').maybeSingle();
    if (error) return { handle: null, error: error.message };
    return { handle: data ? data.handle : null, error: null };
  }

  // Crée le composer_profile du compte connecté s'il n'existe pas encore (RPC, aucune policy RLS
  // INSERT côté client) — à appeler après une connexion réussie, avant tout appel upsert_*.
  async function ensureMyComposerProfile() {
    const { data, error } = await getClient().rpc('ensure_composer_profile');
    if (error) return { composerId: null, error: error.message };
    return { composerId: data, error: null };
  }

  // Id de la ligne studio_profiles du compte connecté — même principe que getMyComposerId().
  async function getMyStudioId() {
    const { data: userData } = await getClient().auth.getUser();
    if (!userData || !userData.user) return { studioId: null, error: null };
    const { data, error } = await getClient().from('studio_profiles').select('id').maybeSingle();
    if (error) return { studioId: null, error: error.message };
    return { studioId: data ? data.id : null, error: null };
  }

  // Crée le studio_profile du compte connecté s'il n'existe pas encore — même principe
  // qu'ensureMyComposerProfile(), RPC ensure_studio_profile() (docs/infrastructure.md, chantier
  // "flux d'inscription").
  async function ensureMyStudioProfile() {
    const { data, error } = await getClient().rpc('ensure_studio_profile');
    if (error) return { studioId: null, error: error.message };
    return { studioId: data, error: null };
  }

  // profiles.onboarding_completed (docs/infrastructure.md, chantier "flux d'inscription") —
  // lecture/écriture directe sur la table, pas de RPC nécessaire (policies RLS "own profile"/"own
  // profile update" déjà en place, supabase/migrations/20260831102636_rls_policies.sql).
  async function getMyProfile() {
    const { data: userData } = await getClient().auth.getUser();
    if (!userData || !userData.user) return { profile: null, error: null };
    const { data, error } = await getClient().from('profiles').select('onboarding_completed').maybeSingle();
    if (error) return { profile: null, error: error.message };
    return { profile: data ? { onboardingCompleted: !!data.onboarding_completed } : null, error: null };
  }

  // RPC plutôt qu'un update direct sur profiles : aucun GRANT UPDATE de base n'existe sur cette
  // table (RLS seule ne suffit pas, voir la migration mark_onboarding_complete_rpc) — cohérent avec
  // le principe déjà en place ailleurs dans le projet ("toute écriture passe par les RPC").
  async function markOnboardingComplete() {
    const { error } = await getClient().rpc('mark_onboarding_complete');
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  }

  window.LayerPitchAuth = {
    signInWithMagicLink, signOut, getSession, onAuthStateChange, inviteTester,
    getMyComposerId, getMyComposerHandle, ensureMyComposerProfile,
    getMyStudioId, ensureMyStudioProfile, getMyProfile, markOnboardingComplete,
    describeFunctionError,
  };
})();
