// supabase/functions/suspend-account/index.ts — LayerPitch, Edge Function de suspension/
// réintégration de compte (docs/infrastructure.md, "Décision complémentaire — Rôle admin, panneau
// analytique, suspension de compte, bandeau d'annonce", actée le 3 septembre). Calquée exactement
// sur supabase/functions/invite-tester/index.ts.
//
// Réversible par défaut (30 jours, ajustable via durationHours) : ban_duration Supabase Auth,
// jamais permanent. UI copy obligatoire : "Suspendre"/"Réintégrer", jamais "bannir"/"ban" (voir
// api/auth.js, admin.html). Suppression de compte définitive : hors périmètre, chantier séparé si
// un jour nécessaire.
//
// Seul point du système à détenir SUPABASE_SERVICE_ROLE_KEY pour cette capacité — jamais exposée
// côté client. Appelée depuis api/auth.js (suspendAccount()/reinstateAccount()), jamais directement.
//
// Écriture de profiles.suspended faite directement via adminClient (service_role, bypass RLS)
// plutôt que via une RPC : le service_role n'a pas d'auth.uid(), donc un is_admin() interne à une
// RPC serait toujours faux ici — la vraie barrière est déjà la vérification is_admin() faite une
// fois ci-dessous via callerClient, exactement comme invite-tester appelle inviteUserByEmail
// directement sans RPC intermédiaire.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_SUSPEND_HOURS = 720; // 30 jours, valeur par défaut ajustable via durationHours

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

    const { profileId, action, durationHours } = await req.json();
    if (!profileId || typeof profileId !== 'string') {
      return new Response(JSON.stringify({ error: 'profileId manquant ou invalide.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action !== 'suspend' && action !== 'reinstate') {
      return new Response(JSON.stringify({ error: "action doit valoir 'suspend' ou 'reinstate'." }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (profileId === callerData.user.id) {
      return new Response(JSON.stringify({ error: 'Impossible de suspendre son propre compte admin.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client Admin (clé service_role) : seul point du système à s'en servir pour cette capacité.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const isSuspending = action === 'suspend';
    const hours = Number(durationHours) > 0 ? Number(durationHours) : DEFAULT_SUSPEND_HOURS;
    const banDuration = isSuspending ? `${hours}h` : 'none';

    const { error: banError } = await adminClient.auth.admin.updateUserById(profileId, { ban_duration: banDuration });
    if (banError) {
      return new Response(JSON.stringify({ error: banError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: profileError } = await adminClient.from('profiles').update({ suspended: isSuspending }).eq('id', profileId);
    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, profileId, suspended: isSuspending }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
