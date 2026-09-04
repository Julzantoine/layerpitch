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
// Validation du chemin volontairement simple (préfixe autorisé + pas de remontée de répertoire),
// PAS de vérification que l'entité visée (AdReel/morceau/Sfx) appartient bien à l'appelant --
// lacune connue, notée dans docs/infrastructure.md comme point à durcir si un vrai abus est
// constaté (un compositeur pourrait aujourd'hui écraser le fichier d'un autre s'il devine/connaît
// son identifiant, exposé dans les URLs publiques). Reste une amélioration nette : avant ce
// correctif, chaque testeur détenait la clé secrète complète du bucket entier (lecture/écriture/
// suppression de tout, y compris data.json/player.js), pas seulement d'un objet précis.

import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_PREFIXES = ['images/', 'audio/'];

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
