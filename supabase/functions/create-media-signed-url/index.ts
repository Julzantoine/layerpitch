// supabase/functions/create-media-signed-url/index.ts — LayerPitch, upload média pour un
// compositeur non-admin (chantier "masquage des panneaux admin/debug", 4 septembre).
//
// Contexte : le panneau "Stockage média (Cloudflare R2)" du backstage (identifiants R2 en clair
// dans un champ, saisis à la main) vient d'être masqué à tout compte non-admin -- c'était pourtant
// le SEUL chemin d'upload/suppression de média existant, sans aucun repli serveur. Un compositeur
// non-admin ne pouvait donc plus publier ni logo/photo/image de fond, ni nouveau fichier audio.
//
// Corrigé ici sans partager les identifiants R2 eux-mêmes (jamais transmis au client, contrairement
// à l'ancien panneau) : cette fonction vérifie l'identité du compositeur PUIS génère une URL R2
// pré-signée à courte durée de vie (5 minutes) pour un seul objet, un seul verbe (PUT ou DELETE) --
// même mécanisme et même librairie (aws4fetch) que get-invoice-download-url. Le client fait ensuite
// lui-même l'appel PUT/DELETE directement vers R2 avec cette URL (pas de transfert de fichier via
// cette fonction -- évite toute limite de taille de requête côté Edge Function).
//
// Validation du chemin : préfixe autorisé + pas de remontée de répertoire, PLUS vérification que
// l'entité visée appartient réellement à l'appelant. Couvre maintenant tous les formats de chemin
// réels utilisés par publishAll() : les cinq tables avec owner_id direct (ad_reels/packs/collections/
// tracks/sfx_library), l'avatar de témoignage (`${ar.id}-testimonial-avatar-N`, rattaché à ad_reels
// comme logo/photo/theme-bg), et les images de bloc (`${b.id}-N`, `${b.id}-thumb-N`, `${b.id}-bg`,
// un bloc vit en JSONB dans la colonne `blocks` d'un ad_reel, résolu ici par containment JSONB plutôt
// que par une table dédiée). Durci le 11 septembre (audit sécurité) : tout chemin qui ne correspond
// à AUCUN de ces formats est désormais REFUSÉ par défaut (c'était auparavant autorisé par défaut --
// un compositeur authentifié pouvait alors obtenir une URL signée PUT/DELETE pour n'importe quel
// fichier sous images/ ou audio/ sans aucune vérification de propriété, y compris ceux d'un autre
// compositeur, tant que le nom de fichier ne matchait aucun des formats connus). Les polices
// personnalisées passent par ghPutFile (GitHub), pas par cette fonction -- un chemin en forme de
// police ne devrait donc jamais arriver ici ; le refus par défaut le couvre sans cas particulier.
//
// Vérifié avant d'écrire cette version, pas supposé : publishAll() (layerpitch-backstage.html)
// uploade TOUT le média avant d'appeler les RPC upsert_ad_reel/upsert_track/etc. qui créent
// réellement la ligne Postgres -- donc pour tout contenu publié pour la première fois, l'entité
// n'existe pas encore en base au moment de l'upload. verifyOwnership() traite "entité introuvable"
// comme autorisé (seul un vrai conflit avec une entité EXISTANTE appartenant à quelqu'un d'autre
// est bloqué) -- un rejet sur "introuvable" aurait cassé la toute première publication de tout
// compositeur, pas un cas limite.

import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Autorise uniquement les origines LayerPitch connues plutôt que '*' -- ces fonctions manipulent
// paiement/facturation/média/admin ; un JWT qui fuit ailleurs ne doit pas pouvoir être rejoué
// depuis n'importe quel site (durci 11 septembre, audit sécurité). Ne s'appuie sur aucun cookie
// (auth par Authorization: Bearer uniquement) -- ce durcissement est une défense en profondeur,
// pas la protection principale.
const ALLOWED_ORIGINS = new Set([
  'https://beta.layerpitch.com',
  'https://layerpitch.com',
  'https://www.layerpitch.com',
  'http://localhost:8420',
]);
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://beta.layerpitch.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

const ALLOWED_PREFIXES = ['images/', 'audio/'];

// Renvoie true si le chemin est autorisé pour ce compositeur -- l'entité visée doit lui appartenir
// (ou ne pas encore exister, voir plus bas). Tout chemin qui ne correspond à aucun format connu est
// refusé (voir commentaire d'en-tête).
async function verifyOwnership(adminClient: ReturnType<typeof createClient>, path: string, composerId: string): Promise<boolean> {
  const checks: Array<{ pattern: RegExp; table: string }> = [
    { pattern: /^images\/(?:logo|photo|theme-bg)-([^./]+)\.[^./]+$/, table: 'ad_reels' },
    { pattern: /^images\/([^./]+)-testimonial-avatar-\d+\.[^./]+$/, table: 'ad_reels' },
    { pattern: /^images\/pack(?:-watermark)?-([^./]+)\.[^./]+$/, table: 'packs' },
    { pattern: /^images\/collection-([^./]+)\.[^./]+$/, table: 'collections' },
    { pattern: /^audio\/sfx-([^/]+)\//, table: 'sfx_library' },
    { pattern: /^audio\/([^/]+)\//, table: 'tracks' },
  ];
  for (const { pattern, table } of checks) {
    const m = path.match(pattern);
    if (!m) continue;
    const { data } = await adminClient.from(table).select('owner_id').eq('id', m[1]).maybeSingle();
    // Entité pas encore créée : autorisé -- publishAll() (layerpitch-backstage.html) uploade tout
    // le média AVANT d'appeler les RPC upsert_* qui créent réellement la ligne Postgres. Rejeter
    // ici casserait la toute première publication de tout nouveau contenu, pas seulement un cas
    // limite. Seul un vrai conflit (entité existante appartenant à quelqu'un d'autre) est bloqué.
    if (!data) return true;
    return data.owner_id === composerId;
  }
  // Image de bloc : `${b.id}-N`, `${b.id}-thumb-N` ou `${b.id}-bg` -- le bloc vit dans la colonne
  // jsonb `ad_reels.blocks` (tableau d'objets {id, type, ...}), pas dans une table à part. Résolu par
  // containment jsonb (`@>`, via .contains()) : trouve l'ad_reel dont le tableau blocks contient un
  // objet avec cet id, peu importe ses autres champs.
  const blockMatch = path.match(/^images\/([^./]+?)(?:-\d+|-thumb-\d+|-bg)\.[^./]+$/);
  if (blockMatch) {
    const { data } = await adminClient.from('ad_reels').select('owner_id').contains('blocks', [{ id: blockMatch[1] }]).maybeSingle();
    if (!data) return true; // bloc pas encore publié -- même raisonnement que ci-dessus.
    return data.owner_id === composerId;
  }
  // Tout le reste (y compris un chemin en forme de police -- jamais censé arriver ici, voir
  // commentaire d'en-tête) : refusé par défaut plutôt qu'autorisé (durci 11 septembre).
  return false;
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Non authentifié.' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    // Le compositeur doit exister avant de publier du média -- même garde-fou que
    // create-connect-onboarding-link (ensure_composer_profile() déjà appelé ailleurs dans le
    // parcours d'inscription, mais on ne le suppose pas ici).
    const { data: composerId, error: composerError } = await callerClient.rpc('ensure_composer_profile');
    if (composerError || !composerId) {
      return new Response(JSON.stringify({ error: composerError?.message || 'Impossible de provisionner le profil compositeur.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { path, method } = await req.json();
    if (!path || typeof path !== 'string' || !ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
      return new Response(JSON.stringify({ error: 'Chemin invalide (doit commencer par images/ ou audio/).' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (path.includes('..') || path.includes('//')) {
      return new Response(JSON.stringify({ error: 'Chemin invalide.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (method !== 'PUT' && method !== 'DELETE') {
      return new Response(JSON.stringify({ error: 'method invalide (PUT ou DELETE attendu).' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // service_role pour la vérification de propriété -- même raisonnement que create-checkout-session
    // (seul point de vérité, jamais soumis à la RLS "lecture publique" qui s'applique par ailleurs à
    // ces tables).
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const owned = await verifyOwnership(adminClient, path, composerId as string);
    if (!owned) {
      return new Response(JSON.stringify({ error: 'Ce fichier ne t\'appartient pas.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
    const bucket = Deno.env.get('R2_BUCKET')!;
    const client = new AwsClient({
      accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
      secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
      service: 's3',
      region: 'auto',
    });
    // X-Amz-Expires posé avant signature (voir get-invoice-download-url pour le pourquoi -- le
    // défaut d'aws4fetch est 24h sans ça, bien trop long pour un lien à usage unique).
    // content-type volontairement PAS inclus dans les en-têtes signés (contrairement à un PUT direct
    // signé côté client) -- garde la signature simple et fiable pour une URL pré-signée par requête,
    // le Content-Type envoyé par le client au moment du vrai PUT est stocké tel quel par R2.
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const objectUrl = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodedPath}?X-Amz-Expires=300`;
    const signedRequest = await client.sign(objectUrl, { method, aws: { signQuery: true } });

    return new Response(JSON.stringify({ ok: true, url: signedRequest.url }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // Erreur interne inattendue : détail loggé côté serveur, jamais renvoyé au client (durci 11
    // septembre, audit sécurité -- évite de fuir un nom de colonne/contrainte Postgres ou un autre
    // détail interne).
    console.error('create-media-signed-url:', e);
    return new Response(JSON.stringify({ error: 'Erreur interne. Réessaie dans un instant.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
