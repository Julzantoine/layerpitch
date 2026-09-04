// supabase/functions/invite-tester/index.ts — LayerPitch, Edge Function d'invitation bêta-testeur
// (docs/infrastructure.md, Partie B, Décision 2 et Décision 4 ; Partie C pour Cloudflare Access)
//
// Seul point du système à détenir la clé secrète Supabase Auth Admin (SUPABASE_SERVICE_ROLE_KEY,
// injectée automatiquement par Supabase — jamais à définir manuellement) — ne doit jamais être
// exposée côté client. Appelée depuis api/auth.js (inviteTester()), jamais directement.
//
// Réservée aux admins : vérifie que l'appelant est authentifié ET que son compte figure dans la
// table `admins` (RPC `is_admin()`, supabase/migrations/20260901190000_admin_role.sql).
//
// Message personnalisé (4 septembre) : le template d'invitation fixe de Supabase
// (auth.admin.inviteUserByEmail) ne permet aucun texte personnalisé par destinataire. Remplacé par
// auth.admin.generateLink({type:'invite'}) — crée le compte et renvoie le lien d'action SANS
// envoyer d'email (contrairement à inviteUserByEmail) — puis l'email est envoyé nous-mêmes via
// l'API Resend (déjà le SMTP configuré côté Supabase Auth pour les autres emails, ici appelé
// directement en HTTP), avec le message de Jules-Antoine inséré dans un template qu'on contrôle
// entièrement. Nouveaux secrets requis : RESEND_API_KEY, RESEND_FROM_ADDRESS (ex.
// "LayerPitch <bonjour@layerpitch.com>", adresse sur le domaine layerpitch.com déjà vérifié).
//
// Si l'envoi Resend échoue APRÈS que le compte a été créé (generateLink a déjà l'effet de bord),
// l'erreur renvoyée inclut quand même actionLink -- pour que Jules-Antoine puisse transmettre le
// lien à la main plutôt que de perdre l'invitation. Pas de contournement fiable pour "annuler" la
// création du compte à ce stade (aucune API Supabase simple pour ça) -- même compromis que d'autres
// écritures de ce projet qui ne roll back jamais un effet de bord Stripe/GitHub déjà survenu.
//
// Vigilance opérationnelle (Décision 4) : limite par défaut de 2 emails d'invitation/heure côté
// Supabase — ne s'applique plus directement puisque Resend envoie l'email lui-même désormais, mais
// generateLink() reste soumis aux limites Supabase Auth générales (création de compte).
//
// Cloudflare Access (4 septembre) : le site bêta est aussi protégé par un mur Cloudflare Access
// séparé (docs/infrastructure.md, Partie C) — une liste d'emails autorisés totalement indépendante
// de Supabase. Sans ce qui suit, un testeur invité ici mais absent de cette liste reste bloqué au
// mur Cloudflare et ne peut jamais utiliser son lien magique. addEmailToCloudflareAccess() ajoute
// donc l'email à la policy Access ("Backstage — accès compositeur", policy réutilisable — pas une
// policy imbriquée dans une Application, ce compte Cloudflare utilise le nouveau modèle) avant
// l'invitation, via l'API Cloudflare (secrets CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID /
// CLOUDFLARE_ACCESS_POLICY_ID — jeton scopé à "Access: Apps and Policies", jamais "Full access").
// Échec Cloudflare non bloquant : l'invitation part quand même (comportement identique à avant si
// les secrets manquent), mais la réponse porte `cloudflareWarning` pour que l'admin sache qu'il
// doit ajouter l'email à la main.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function addEmailToCloudflareAccess(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiToken = Deno.env.get('CLOUDFLARE_API_TOKEN');
  const accountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID');
  const policyId = Deno.env.get('CLOUDFLARE_ACCESS_POLICY_ID');
  if (!apiToken || !accountId || !policyId) {
    return { ok: false, error: 'Secrets Cloudflare non configurés côté Supabase (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_ACCESS_POLICY_ID).' };
  }

  // Policy réutilisable (Access controls > Policies), pas une policy imbriquée dans une
  // Application — ce compte Cloudflare utilise ce modèle plutôt que l'ancien /access/apps/{id}/policies.
  const policyUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/access/policies/${policyId}`;
  const headers = { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' };

  try {
    const getRes = await fetch(policyUrl, { headers });
    const getBody = await getRes.json();
    if (!getRes.ok || !getBody.success) {
      return { ok: false, error: 'Lecture de la policy Cloudflare Access échouée : ' + JSON.stringify(getBody.errors || getBody) };
    }
    const policy = getBody.result;

    const normalizedEmail = email.trim().toLowerCase();
    const include = Array.isArray(policy.include) ? policy.include : [];
    const alreadyIncluded = include.some((rule: any) => rule && rule.email && typeof rule.email.email === 'string' && rule.email.email.toLowerCase() === normalizedEmail);
    if (alreadyIncluded) return { ok: true };

    // Repasse tout le reste de la policy tel que lu (name, decision, require, session_duration...)
    // plutôt que de le reconstruire à la main — seul `include` change ici.
    const { id, created_at, updated_at, ...updatableFields } = policy;
    const updateRes = await fetch(policyUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...updatableFields, include: [...include, { email: { email: email.trim() } }] }),
    });
    const updateBody = await updateRes.json();
    if (!updateRes.ok || !updateBody.success) {
      return { ok: false, error: 'Mise à jour de la policy Cloudflare Access échouée : ' + JSON.stringify(updateBody.errors || updateBody) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Appel à l\'API Cloudflare échoué : ' + String(e && e.message || e) };
  }
}

// Échappement HTML minimal -- personalMessage vient directement de la saisie de Jules-Antoine dans
// le backstage, jamais d'un visiteur non authentifié, mais on ne prend pas le risque d'injecter du
// HTML non échappé dans un email envoyé sous le nom de LayerPitch.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function sendInviteEmail(email: string, actionLink: string, personalMessage: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const fromAddress = Deno.env.get('RESEND_FROM_ADDRESS');
  if (!apiKey || !fromAddress) {
    return { ok: false, error: 'Secrets Resend non configurés côté Supabase (RESEND_API_KEY / RESEND_FROM_ADDRESS).' };
  }
  const messageHtml = personalMessage
    ? `<p>${escapeHtml(personalMessage).replace(/\n/g, '<br>')}</p>`
    : '<p>Tu es invité·e à rejoindre la bêta LayerPitch.</p>';
  const html = `
    <div style="font-family:sans-serif;color:#262521;max-width:480px;">
      <h2 style="font-family:sans-serif;">Bienvenue sur LayerPitch</h2>
      ${messageHtml}
      <p><a href="${actionLink}" style="display:inline-block;padding:10px 24px;background:#c9713c;color:#fff;text-decoration:none;border-radius:4px;">Rejoindre la bêta</a></p>
      <p style="font-size:12px;color:#6f6b62;">Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :<br>${actionLink}</p>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress,
        to: email,
        subject: 'Invitation à la bêta LayerPitch',
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `Resend a refusé l'envoi (${res.status}) : ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Appel à l\'API Resend échoué : ' + String(e && e.message || e) };
  }
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

    const { email, redirectTo, personalMessage } = await req.json();
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'email manquant ou invalide.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Ajout à la liste Cloudflare Access avant l'invitation (voir commentaire d'en-tête) — non
    // bloquant : un échec ici n'empêche pas l'invitation de partir, il est juste rapporté à
    // l'appelant via cloudflareWarning.
    const cfResult = await addEmailToCloudflareAccess(email);

    // Client Admin (clé service_role) : seul point du système à s'en servir.
    // redirectTo : sans ça, Supabase retombe sur la Site URL par défaut du projet
    // (localhost:3000, jamais configurée pour ce cas — trouvé le 1er septembre, lien
    // d'invitation cassé au premier vrai essai). Doit figurer dans la liste d'URLs autorisées du
    // projet (Authentication > URL Configuration), même exigence que emailRedirectTo côté
    // signInWithMagicLink.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, cloudflareWarning: cfResult.ok ? null : cfResult.error }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const actionLink = data.properties?.action_link;
    if (!actionLink) {
      return new Response(JSON.stringify({ error: 'Compte créé mais aucun lien d\'action renvoyé par Supabase (cas inattendu).' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const emailResult = await sendInviteEmail(email, actionLink, typeof personalMessage === 'string' && personalMessage.trim() ? personalMessage.trim() : null);
    if (!emailResult.ok) {
      // Le compte existe déjà à ce stade (generateLink a déjà eu son effet de bord) -- on renvoie
      // actionLink pour que Jules-Antoine puisse transmettre le lien à la main plutôt que de perdre
      // l'invitation, plutôt que de faire comme si rien ne s'était passé.
      return new Response(JSON.stringify({
        error: 'Compte créé, mais l\'envoi de l\'email a échoué : ' + emailResult.error,
        actionLink,
        cloudflareWarning: cfResult.ok ? null : cfResult.error,
      }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      userId: data.user ? data.user.id : null,
      cloudflareWarning: cfResult.ok ? null : cfResult.error,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
