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
// Validation du chemin : préfixe autorisé + pas de remontée de répertoire, PLUS (4 septembre,
// durcissement) vérification que l'entité visée appartient réellement à l'appelant, pour les
// formats de chemin dont l'entité est une table avec owner_id connue (ad_reels/packs/collections/
// tracks/sfx_library -- toutes les cinq confirmées le 31 août). Deux formats restent NON vérifiés
// et volontairement laissés passer : les images de bloc (`${b.id}-*`, un bloc vit en JSONB à
// l'intérieur d'un ad_reel, pas une table interrogeable séparément) et les polices personnalisées
// (`${font.id}`, table non confirmée) -- même comportement qu'avant ce durcissement pour ces deux
// cas plutôt que de deviner un schéma et casser un vrai upload.
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_PREFIXES = ['images/', 'audio/'];

// Renvoie true si le chemin est autorisé pour ce compositeur -- soit parce que l'entité visée lui
// appartient (vérifié), soit parce que le format de chemin n'est pas rattachable à une table
// interrogeable (voir commentaire d'en-tête) et reste donc non vérifié, comme avant ce durcissement.
async function verifyOwnership(adminClient: ReturnType<typeof createClient>, path: string, composerId: string): Promise<boolean> {
  const checks: Array<{ pattern: RegExp; table: string }> = [
    { pattern: /^images\/(?:logo|photo|theme-bg)-([^./]+)\.[^./]+$/, table: 'ad_reels' },
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
  // Format non reconnu (bloc, police...) -- non vérifiable, laissé passer.
  return true;
}

Deno.serve(async (req) => {
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
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
