// supabase/functions/get-invoice-download-url/index.ts — LayerPitch, facturation légale (chantier
// 4 septembre).
//
// Les factures/attestations de vente contiennent des données personnelles réelles (nom, adresse,
// SIRET, n° TVA de l'acheteur et du vendeur) -- contrairement aux médias déjà servis publiquement
// depuis media.layerpitch.com (sécurité par obscurité jugée suffisante pour de l'audio de
// démonstration, docs/infrastructure.md), une URL PDF permanente et devinable serait une vraie
// fuite de PII. Cette fonction vérifie l'autorisation via le client appelant (RLS "own issued
// invoices" / "own purchased invoices" sur la table invoices, migration 20260904130000) PUIS
// génère une URL R2 pré-signée à courte durée de vie (5 minutes) avec les identifiants
// service_role -- jamais d'URL publique permanente pour ce bucket.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    // Client "appelant" (clé anon + JWT de la requête) : la RLS de `invoices` fait tout le travail
    // d'autorisation ici -- si ce SELECT ne renvoie rien, l'appelant n'a pas le droit de voir cette
    // facture, qu'il soit le compositeur vendeur ou l'acheteur.
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { invoiceId } = await req.json();
    if (!invoiceId || typeof invoiceId !== 'string') {
      return new Response(JSON.stringify({ error: 'invoiceId manquant ou invalide.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: invoice, error: invoiceError } = await callerClient
      .from('invoices')
      .select('pdf_storage_path')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invoiceError || !invoice) {
      return new Response(JSON.stringify({ error: 'Facture introuvable ou accès non autorisé.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
    // aws4fetch n'expose pas d'option expiresIn (contrairement au SDK AWS complet) -- pose
    // X-Amz-Expires directement dans l'URL AVANT signature : AwsV4Signer ne fixe son défaut de
    // 86400s (24h, bien trop long pour un document contenant des données personnelles) que si ce
    // paramètre n'est pas déjà présent (vérifié dans le code source d'aws4fetch) -- 300s ici.
    const objectUrl = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${invoice.pdf_storage_path}?X-Amz-Expires=300`;
    const signedRequest = await client.sign(objectUrl, { method: 'GET', aws: { signQuery: true } });

    return new Response(JSON.stringify({ ok: true, url: signedRequest.url }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
