// api/supabase-client.js — LayerPitch, client Supabase partagé (une seule instance GoTrueClient)
//
// Tous les modules api/*.js qui touchent Supabase (auth, tracks, packs, purchases, adreels,
// collections, sfx, settings) appellent window.LayerPitchSupabaseClient.getClient() plutôt que de
// créer chacun le leur — avant ce fichier, chaque module instanciait son propre
// createClient(), donc plusieurs instances GoTrueClient coexistaient sur la même page dès que
// plusieurs api/*.js étaient chargés ensemble (avertissement navigateur "Multiple GoTrueClient
// instances detected"). Ça a causé un vrai bug : après un clic sur un lien magique, plusieurs
// clients tentaient de détecter la session depuis le fragment d'URL (#access_token=...) en même
// temps au chargement, et cette détection concurrente ne se synchronisait pas toujours
// correctement (trouvé le 1er septembre, Session B — voir docs/LAYERPITCH_CHANGELOG.md). Un seul
// client partagé élimine la course : la détection n'a lieu qu'une fois.
//
// Doit être chargé en premier, juste après le SDK Supabase (CDN) et avant tout autre api/*.js,
// partout où loadPostgresReadScripts()/loadPurchaseScripts() (ou des <script> statiques)
// chargent ces modules — voir index.html/pack.html/collection.html/layerpitch-backstage.html/
// library.html/auth-test.html.

(function () {
  const SUPABASE_URL = 'https://ypygllyjfynrnvapufow.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bpjR1M-no9BaxD6QjwcNlQ_og_IgcRb';

  let client = null;
  function getClient() {
    if (!client) {
      if (!window.supabase || !window.supabase.createClient) {
        throw new Error('SDK Supabase non chargé — ajouter le <script> UMD avant api/supabase-client.js.');
      }
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    }
    return client;
  }

  window.LayerPitchSupabaseClient = { getClient };
})();
