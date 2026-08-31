// api/auth.js — LayerPitch, couche d'abstraction authentification (Supabase Auth)
// (docs/infrastructure.md, Partie B, Décision 2 et Décision 4)
//
// SEUL fichier du front autorisé à toucher supabase.auth.* ou l'Edge Function invite-tester —
// aucun autre fichier ne doit importer le SDK Supabase pour l'auth, pensé pour la réversibilité
// (remplacer Supabase Auth plus tard ne toucherait que ce fichier).
//
// Nécessite le SDK Supabase chargé en amont via <script> (build UMD, pas de module ES — voir
// contrainte 100% statique/file://) :
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
//   <script src="api/auth.js"></script>
//
// Connexion par magic link (passwordless) uniquement, inscriptions publiques désactivées côté
// projet Supabase (Décision 4) — seuls les comptes créés via invitation admin peuvent se
// connecter. `inviteTester()` appelle l'Edge Function invite-tester, qui détient seule la clé
// secrète Supabase Auth Admin (jamais exposée ici).

(function () {
  const SUPABASE_URL = 'https://ypygllyjfynrnvapufow.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bpjR1M-no9BaxD6QjwcNlQ_og_IgcRb';

  let client = null;
  function getClient() {
    if (!client) {
      if (!window.supabase || !window.supabase.createClient) {
        throw new Error('SDK Supabase non chargé — ajouter le <script> UMD avant api/auth.js.');
      }
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    }
    return client;
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
  async function inviteTester(email) {
    const { data, error } = await getClient().functions.invoke('invite-tester', { body: { email } });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data };
  }

  window.LayerPitchAuth = { signInWithMagicLink, signOut, getSession, onAuthStateChange, inviteTester };
})();
