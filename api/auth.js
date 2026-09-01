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

  // Crée le composer_profile du compte connecté s'il n'existe pas encore (RPC, aucune policy RLS
  // INSERT côté client) — à appeler après une connexion réussie, avant tout appel upsert_*.
  async function ensureMyComposerProfile() {
    const { data, error } = await getClient().rpc('ensure_composer_profile');
    if (error) return { composerId: null, error: error.message };
    return { composerId: data, error: null };
  }

  window.LayerPitchAuth = {
    signInWithMagicLink, signOut, getSession, onAuthStateChange, inviteTester,
    getMyComposerId, ensureMyComposerProfile,
  };
})();
