// layerpitch-tuto.js — LayerPitch, porte d'entrée UNIQUE du MODE TUTORIEL (?tuto), partagée par le Backstage, projet.html et projets.html (20/10).
//
// Le tutoriel tourne sur un faux serveur local (api/demo-client.js, api/demo-projects.js) : compte fictif, rien n'est lu ni écrit en base,
// tout est remis à zéro à chaque chargement. Ce fichier ne contient que la règle d'accès, pour qu'elle ne vive qu'à UN endroit.
(function () {
  // POUR OUVRIR LE TUTORIEL AU PUBLIC : faire répondre « true » ici (une seule ligne, pour les trois pages). Tant que c'est « false »,
  // seul un admin réellement connecté y entre ; tout autre visiteur est renvoyé vers la page normale.
  function publicOpen() { return false; }
  function isOn() { return new URLSearchParams(window.location.search).has('tuto'); }

  // Vérifie qu'un vrai admin est connecté (vrai client Supabase, avant la bascule). Sinon : retour à la page normale, sans ?tuto.
  async function adminGate() {
    try {
      const client = window.LayerPitchSupabaseClient.getClient();
      const { data } = await client.auth.getSession();
      if (data && data.session && data.session.user) {
        const res = await client.rpc('is_admin');
        if (!res.error && res.data) return true;
      }
    } catch (e) { /* traité comme non admin */ }
    return false;
  }
  // Niveau d'accès d'une personne réellement connectée (23/10, ouverture aux bêta-testeurs) : 'admin', 'member' (tout compte connecté), ou null
  // (personne de connecté). Le Backstage s'en sert pour laisser entrer les bêta-testeurs dans le tutoriel du moteur audio ; les pages
  // Projet (leçons « Préproduction ») gardent la porte admin ci-dessus, via enter().
  async function accessLevel() {
    try {
      const client = window.LayerPitchSupabaseClient.getClient();
      const { data } = await client.auth.getSession();
      if (data && data.session && data.session.user) {
        const res = await client.rpc('is_admin');
        return (!res.error && res.data) ? 'admin' : 'member';
      }
    } catch (e) { /* traité comme personne de connecté */ }
    return null;
  }
  // Bascule : tous les api/*.js appellent window.LayerPitchSupabaseClient.getClient() à chaque usage, donc cette seule ligne les met
  // tous sur le faux serveur (api/demo-client.js doit être chargé).
  function switchToDemo() { window.LayerPitchSupabaseClient = { getClient: () => window.LayerPitchDemoClient }; }
  // Entrée complète pour les pages à balises <script> statiques : porte (si fermée) puis bascule. `leaveTo` : page de repli pour un refus.
  async function enter(leaveTo) {
    if (!isOn()) return false;
    if (!publicOpen() && !(await adminGate())) { window.location.replace(leaveTo || window.location.pathname); await new Promise(() => {}); }
    switchToDemo();
    return true;
  }
  window.LayerPitchTuto = { publicOpen, isOn, adminGate, accessLevel, switchToDemo, enter };
})();
