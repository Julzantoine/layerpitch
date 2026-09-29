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
// l'entité visée appartient réellement à l'appelant. Durci le 11 septembre (audit sécurité) : tout
// chemin qui ne correspond à AUCUN format connu est REFUSÉ par défaut.
//
// Images et polices (27/09) : rangées sous images/<id du compositeur>/ et fonts/<id du compositeur>/,
// la propriété se lit directement dans le chemin, sans requête. Avant le 27/09, les images étaient à
// plat (images/photo-<id AdReel>.jpg...) et la propriété se déduisait de l'id de l'AdReel -- or cet id
// n'est unique que PAR compositeur (le premier AdReel de chacun s'appelle 'main', les suivants
// reprennent leur libellé). La recherche tombait donc sur plusieurs lignes, échouait, et l'échec était
// lu comme "AdReel pas encore créé, autorisé" : le 18/09, la photo de bio d'un bêta-testeur a écrasé
// celle de l'AdReel 'main' de Jules-Antoine (même fichier images/photo-main.jpg pour les deux). Les
// anciens fichiers à plat restent servis tels quels mais ne peuvent plus être ni écrits ni effacés
// (le Backstage n'efface jamais d'image, et n'écrit plus que dans le dossier du compositeur).
//
// Toute erreur de lecture pendant la vérification REFUSE désormais la demande (jamais "autorisé par
// défaut" sur une erreur).
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

const ALLOWED_PREFIXES = ['images/', 'audio/', 'video/', 'fonts/'];

// Types de fichier acceptés à l'envoi, par dossier, et taille maximale (27/09). Avant, n'importe quel fichier passait
// (une page .html ou un SVG avec du code, servis sur media.layerpitch.com : hameçonnage sous notre domaine, risque de
// voir tout le domaine signalé comme dangereux). Le type servi (Content-Type) est décidé ICI d'après l'extension et
// verrouillé dans la signature avec la taille exacte annoncée : R2 refuse l'envoi si le navigateur envoie autre chose.
// Les SVG (logos) restent acceptés mais partent avec Content-Disposition: attachment -- affichés normalement dans une
// balise <img> (où leur code ne s'exécute jamais), téléchargés au lieu d'être ouverts si on visite leur adresse.
const MB = 1024 * 1024;
const MEDIA_RULES: Record<string, { types: Record<string, string>; maxBytes: number }> = {
  'images/': {
    types: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' },
    maxBytes: 20 * MB,
  },
  'audio/': { types: { ogg: 'audio/ogg' }, maxBytes: 150 * MB },
  'video/': { types: { mp4: 'video/mp4' }, maxBytes: 2048 * MB },
  'fonts/': { types: { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' }, maxBytes: 10 * MB },
};

// En-têtes imposés à un envoi (PUT), ou un message d'erreur lisible par le compositeur.
function uploadHeadersFor(path: string, size: unknown): { headers: Record<string, string> } | { error: string } {
  const prefix = Object.keys(MEDIA_RULES).find((p) => path.startsWith(p));
  if (!prefix) return { error: 'Chemin invalide.' };
  const rule = MEDIA_RULES[prefix];
  const m = path.match(/\.([a-z0-9]+)$/i);
  const ext = m ? m[1].toLowerCase() : '';
  const type = rule.types[ext];
  if (!type) {
    return { error: `Type de fichier non accepté (${ext ? '.' + ext : 'sans extension'}). Formats acceptés : ${Object.keys(rule.types).map((e) => '.' + e).join(', ')}.` };
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) return { error: 'Taille du fichier manquante.' };
  if (size > rule.maxBytes) {
    return { error: `Fichier trop lourd (${Math.ceil(size / MB)} Mo, maximum ${rule.maxBytes / MB} Mo).` };
  }
  const headers: Record<string, string> = { 'content-type': type, 'content-length': String(size) };
  if (ext === 'svg') headers['content-disposition'] = 'attachment';
  return { headers };
}

// Renvoie true si le chemin est autorisé pour ce compositeur -- l'entité visée doit lui appartenir
// (ou ne pas encore exister, voir plus bas). Tout chemin qui ne correspond à aucun format connu est
// refusé (voir commentaire d'en-tête).
async function verifyOwnership(adminClient: ReturnType<typeof createClient>, path: string, composerId: string): Promise<boolean> {
  // Image ou police : <images|fonts>/<id du compositeur>/<fichier>.<ext> -- à lui seul, et à personne d'autre.
  // Un chemin images/ ou fonts/ sans ce dossier (anciens fichiers à plat, voir en-tête) est refusé.
  if (path.startsWith('images/') || path.startsWith('fonts/')) {
    const m = path.match(/^(?:images|fonts)\/([^/]+)\/[^/]+\.[^./]+$/);
    return !!m && m[1] === composerId;
  }
  // Tables à id GLOBALEMENT unique (clé primaire = id seul) : une ligne au plus par id.
  const checks: Array<{ pattern: RegExp; table: string }> = [
    { pattern: /^audio\/sfx-([^/]+)\//, table: 'sfx_library' },
    { pattern: /^audio\/([^/]+)\//, table: 'tracks' },
    // Bibliothèque vidéo compositeur (16 septembre, composer_videos) -- même forme que l'audio
    // (base + fichier, id de la vidéo dans le premier segment du chemin).
    { pattern: /^video\/([^/]+)\//, table: 'composer_videos' },
  ];
  for (const { pattern, table } of checks) {
    const m = path.match(pattern);
    if (!m) continue;
    const { data, error } = await adminClient.from(table).select('owner_id').eq('id', m[1]).maybeSingle();
    if (error) {
      console.error('create-media-signed-url: verifyOwnership', table, error);
      return false;
    }
    // Entité pas encore créée : autorisé -- publishAll() (layerpitch-backstage.html) uploade tout
    // le média AVANT d'appeler les RPC upsert_* qui créent réellement la ligne Postgres. Rejeter
    // ici casserait la toute première publication de tout nouveau contenu, pas seulement un cas
    // limite. Seul un vrai conflit (entité existante appartenant à quelqu'un d'autre) est bloqué.
    if (!data) return true;
    return data.owner_id === composerId;
  }
  // Tout le reste : refusé par défaut plutôt qu'autorisé (durci 11 septembre).
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
    const { path, method, size } = await req.json();
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Pochette d'un album de STUDIO (29/09) : images/<id du studio>/album-<id>.<ext>, réservé au studio qui l'envoie (son
    // dossier), sans profil compositeur (un compte studio seul ne doit pas en recevoir un juste pour envoyer une image).
    let studioFolderId: string | null = null;
    if (typeof path === 'string' && /^images\/[^/]+\/album-[^/]+\.[^./]+$/.test(path)) {
      const { data: userData } = await callerClient.auth.getUser(jwt);
      if (userData?.user) {
        const { data: studio } = await adminClient.from('studio_profiles').select('id').eq('profile_id', userData.user.id).maybeSingle();
        if (studio && path.startsWith(`images/${studio.id}/`)) studioFolderId = studio.id as string;
      }
    }

    // Le compositeur doit exister avant de publier du média -- même garde-fou que
    // create-connect-onboarding-link (ensure_composer_profile() déjà appelé ailleurs dans le
    // parcours d'inscription, mais on ne le suppose pas ici).
    let composerId: unknown = studioFolderId;
    if (!studioFolderId) {
      const { data, error: composerError } = await callerClient.rpc('ensure_composer_profile');
      if (composerError || !data) {
        return new Response(JSON.stringify({ error: composerError?.message || 'Impossible de provisionner le profil compositeur.' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      composerId = data;
    }

    if (!path || typeof path !== 'string' || !ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
      return new Response(JSON.stringify({ error: 'Chemin invalide (doit commencer par images/, audio/, video/ ou fonts/).' }), {
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
    let uploadHeaders: Record<string, string> | null = null;
    if (method === 'PUT') {
      const check = uploadHeadersFor(path, size);
      if ('error' in check) {
        return new Response(JSON.stringify({ error: check.error }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      uploadHeaders = check.headers;
    }

    // service_role (adminClient, plus haut) pour la vérification de propriété -- même raisonnement que create-checkout-session
    // (seul point de vérité, jamais soumis à la RLS "lecture publique" qui s'applique par ailleurs à ces tables).
    const owned = await verifyOwnership(adminClient, path, composerId as string);
    if (!owned) {
      return new Response(JSON.stringify({ error: 'Ce fichier ne t\'appartient pas.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Envoi d'une vidéo : quota vérifié et place réservée AVANT de signer (27/09, reserve_video_upload), sur la taille
    // exacte verrouillée dans la signature -- jamais sur ce que le navigateur annoncera ensuite à upsert_video.
    if (method === 'PUT' && path.startsWith('video/')) {
      const { data: refusal, error: reserveError } = await adminClient.rpc('reserve_video_upload', {
        p_composer_id: composerId, p_path: path, p_size: size,
      });
      if (reserveError) {
        console.error('create-media-signed-url: reserve_video_upload', reserveError);
        return new Response(JSON.stringify({ error: 'Erreur interne. Réessaie dans un instant.' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (refusal) {
        return new Response(JSON.stringify({ error: refusal }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Fichier audio utilisé par une version d'album (prise d'un fan ou version du compositeur), ou appartenant à un
    // morceau / Sfx gardé pour des fans (album obtenu, morceau retiré -- 27/09, « le fan garde ce qu'il a acheté ») :
    // jamais effacé, même si le compositeur l'a remplacé ou retiré de son morceau. Réponse
    // { ok, kept } sans URL : le Backstage garde le fichier et continue. En cas de doute (vérification impossible), on
    // garde aussi -- un fichier conservé à tort coûte un peu de stockage, un fichier effacé à tort rend une version muette.
    if (method === 'DELETE' && path.startsWith('audio/')) {
      const cut = path.lastIndexOf('/');
      const needles = [path, path.slice(0, cut + 1) + encodeURIComponent(path.slice(cut + 1))];
      const { data: used, error: usedError } = await adminClient.rpc('media_path_kept_for_fans', { p_needles: needles });
      if (usedError) console.error('create-media-signed-url: media_path_kept_for_fans', usedError);
      if (usedError || used) {
        return new Response(JSON.stringify({ ok: true, kept: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
    // Morceau PROTÉGÉ (29/09) : ses fichiers audio/<id>/… vivent dans le seau privé (R2_PROJECTS_BUCKET), au même chemin.
    // Envoi et effacement y sont donc aiguillés ; la vérification de propriété plus haut reste la même.
    let bucket = Deno.env.get('R2_BUCKET')!;
    const audioMatch = path.match(/^audio\/([^/]+)\//);
    if (audioMatch && !audioMatch[1].startsWith('sfx-')) {
      const { data: trk } = await adminClient.from('tracks').select('protected').eq('id', audioMatch[1]).maybeSingle();
      if (trk && trk.protected) {
        const privateBucket = Deno.env.get('R2_PROJECTS_BUCKET');
        if (!privateBucket) {
          return new Response(JSON.stringify({ error: 'Stockage privé non configuré (R2_PROJECTS_BUCKET).' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        bucket = privateBucket;
      }
    }
    const client = new AwsClient({
      accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
      secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
      service: 's3',
      region: 'auto',
    });
    // X-Amz-Expires posé avant signature (voir get-invoice-download-url pour le pourquoi -- le
    // défaut d'aws4fetch est 24h sans ça, bien trop long pour un lien à usage unique).
    // Envoi : type, taille (et pour un SVG, Content-Disposition) signés -- allHeaders, sinon aws4fetch laisse
    // content-type et content-length hors signature. Le client doit renvoyer exactement ces en-têtes (renvoyés
    // dans la réponse) ; content-length, lui, est posé par le navigateur d'après le fichier réellement envoyé.
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const objectUrl = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodedPath}?X-Amz-Expires=300`;
    const signedRequest = await client.sign(objectUrl, {
      method,
      ...(uploadHeaders ? { headers: uploadHeaders } : {}),
      aws: { signQuery: true, allHeaders: true },
    });

    // En-têtes que le navigateur doit poser lui-même (content-length est calculé par le navigateur, interdit à poser).
    const clientHeaders = uploadHeaders
      ? Object.fromEntries(Object.entries(uploadHeaders).filter(([k]) => k !== 'content-length'))
      : undefined;
    return new Response(JSON.stringify({ ok: true, url: signedRequest.url, headers: clientHeaders }), {
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
