// supabase/functions/invite-tester/index.ts — LayerPitch, Edge Function d'invitation bêta-testeur
// (docs/infrastructure.md, Partie B, Décision 2 et Décision 4)
//
// Seul point du système à détenir la clé secrète Supabase Auth Admin (SUPABASE_SERVICE_ROLE_KEY,
// injectée automatiquement par Supabase — jamais à définir manuellement) — ne doit jamais être
// exposée côté client. Appelée depuis api/auth.js (inviteTester()), jamais directement.
//
// Réservée à Jules-Antoine : vérifie que l'appelant est authentifié ET que son adresse
// correspond au secret ADMIN_EMAIL (à définir via le dashboard Supabase, Edge Functions >
// invite-tester > Secrets, ou `supabase secrets set ADMIN_EMAIL=...`). Pas de table
// `profiles`/rôle disponible à ce stade (arrive à l'étape 3, base Postgres) — vérification par
// email en dur en attendant, à remplacer par une vraie vérification de rôle une fois `profiles`
// en place.
//
// Vigilance opérationnelle (Décision 4) : limite par défaut de 2 emails d'invitation/heure côté
// Supabase — cette fonction n'en fait pas plus (un appel = une invitation), mais des appels en
// rafale échoueront côté Supabase au-delà de la limite. Espacer manuellement ou configurer un
// SMTP personnalisé pour un rollout bêta groupé.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminEmail = Deno.env.get('ADMIN_EMAIL');

    // Client "appelant" (clé anon + JWT de la requête) : sert uniquement à vérifier qui appelle,
    // ne touche jamais à l'API Admin.
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser(jwt);
    if (callerError || !callerData.user) {
      return new Response(JSON.stringify({ error: 'Jeton invalide.' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!adminEmail || callerData.user.email !== adminEmail) {
      return new Response(JSON.stringify({ error: 'Non autorisé.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'email manquant ou invalide.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client Admin (clé service_role) : seul point du système à s'en servir.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, userId: data.user ? data.user.id : null }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
