// supabase/functions/submit-access-request/index.ts — LayerPitch, demandes d'accès à la bêta
// fermée (6 septembre, suite).
//
// Remplace l'appel direct à la RPC submit_access_request() (toujours en base, plus utilisée par le
// front) : la RPC seule ne peut pas envoyer d'email de confirmation (pas d'appel HTTP sortant
// possible depuis une simple fonction SQL sans pg_net, et surtout pas de secret Resend accessible
// depuis là) -- même raisonnement que submit-contact-message la veille. Insertion faite ici
// directement via service_role (contourne RLS), pas besoin de rappeler la RPC.
//
// Confirmation immédiate à la personne qui demande l'accès (pas à Jules-Antoine — lui la voit dans
// le panneau admin du backstage) : retour rapide sur son intérêt, dans sa langue.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

const CONFIRMATION_COPY: Record<string, { subject: string; html: string }> = {
  fr: {
    subject: 'Merci pour ton intérêt pour LayerPitch !',
    html: `
      <div style="font-family:sans-serif;color:#262521;max-width:480px;">
        <p>Hey ! Merci de ton intérêt pour LayerPitch !</p>
        <p>Demande bien reçue, on te tient au courant rapidement !</p>
      </div>`,
  },
  en: {
    subject: 'Thanks for your interest in LayerPitch!',
    html: `
      <div style="font-family:sans-serif;color:#262521;max-width:480px;">
        <p>Hey! Thanks for your interest in LayerPitch!</p>
        <p>Request received, we'll be in touch soon!</p>
      </div>`,
  },
};

async function sendConfirmationEmail(to: string, lang: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const fromAddress = Deno.env.get('RESEND_FROM_ADDRESS');
  if (!apiKey || !fromAddress) {
    // Jamais bloquant pour l'utilisateur : la demande est déjà enregistrée à ce stade (voir plus
    // bas, l'insertion a lieu AVANT cet appel) -- un email de confirmation manqué reste un problème
    // mineur comparé à une demande perdue.
    return { ok: false, error: 'Secrets Resend non configurés côté Supabase.' };
  }
  const copy = CONFIRMATION_COPY[lang] || CONFIRMATION_COPY.fr;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress, to, subject: copy.subject, html: copy.html }),
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
    const { email, source, intent, lang } = await req.json();
    const v_email = typeof email === 'string' ? email.trim().slice(0, 200) : '';
    if (!isValidEmail(v_email)) {
      return new Response(JSON.stringify({ error: 'Email invalide.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (source !== 'landing' && source !== 'blocked_signin') {
      return new Response(JSON.stringify({ error: 'source invalide.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const v_intent = (intent === 'beta' || intent === 'waitlist') ? intent : null;
    const v_lang = lang === 'en' ? 'en' : 'fr';

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Limite de fréquence par IP, même fonction/fenêtre qu'avant (bump_access_request_rate_limit,
    // supabase/migrations/20260906010000_access_requests.sql) -- réutilisée via RPC plutôt que
    // dupliquée, la fonction reste appelable par service_role même si son GRANT vise anon/authenticated.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || v_email;
    const bucketKey = `access_request:${ip}:${Math.floor(Date.now() / 60000)}`;
    const { data: withinLimit } = await adminClient.rpc('bump_access_request_rate_limit', { p_bucket_key: bucketKey });
    if (withinLimit === false) {
      return new Response(JSON.stringify({ error: 'Trop de demandes envoyées — réessaie dans une minute.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: insertError } = await adminClient.from('access_requests').insert({
      email: v_email, source, intent: v_intent,
    });
    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Envoyé après l'insertion réussie : la demande est déjà en sécurité côté LayerPitch même si
    // l'email de confirmation échoue (secrets manquants, Resend indisponible) -- jamais perdre une
    // vraie demande pour un souci d'email de courtoisie.
    const emailResult = await sendConfirmationEmail(v_email, v_lang);

    return new Response(JSON.stringify({ ok: true, emailSent: emailResult.ok }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
