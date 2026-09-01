// supabase/functions/invite-tester/index.ts — LayerPitch, Edge Function d'invitation bêta-testeur
// (docs/infrastructure.md, Partie B, Décision 2 et Décision 4)
//
// Seul point du système à détenir la clé secrète Supabase Auth Admin (SUPABASE_SERVICE_ROLE_KEY,
// injectée automatiquement par Supabase — jamais à définir manuellement) — ne doit jamais être
// exposée côté client. Appelée depuis api/auth.js (inviteTester()), jamais directement.
//
// Réservée aux admins : vérifie que l'appelant est authentifié ET que son compte figure dans la
// table `admins` (RPC `is_admin()`, supabase/migrations/20260901190000_admin_role.sql). Remplace
// l'ancienne vérification par email en dur sur le secret ADMIN_EMAIL (intérim posé le 31 août, en
// l'absence de `profiles`/rôle à ce moment — `profiles`/`composer_profiles` existent réellement
// depuis, ADMIN_EMAIL n'est donc plus utilisé par cette fonction ni nécessaire dans ses secrets).
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
    // is_admin() (security definer) vérifie l'appartenance de auth.uid() à la table admins —
    // exécutée avec l'identité de l'appelant (callerClient porte son JWT), jamais avec service_role.
    const { data: isAdmin, error: isAdminError } = await callerClient.rpc('is_admin');
    if (isAdminError || !isAdmin) {
      return new Response(JSON.stringify({ error: 'Non autorisé.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email, redirectTo } = await req.json();
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'email manquant ou invalide.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client Admin (clé service_role) : seul point du système à s'en servir.
    // redirectTo : sans ça, Supabase retombe sur la Site URL par défaut du projet
    // (localhost:3000, jamais configurée pour ce cas — trouvé le 1er septembre, lien
    // d'invitation cassé au premier vrai essai). Doit figurer dans la liste d'URLs autorisées du
    // projet (Authentication > URL Configuration), même exigence que emailRedirectTo côté
    // signInWithMagicLink.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
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
