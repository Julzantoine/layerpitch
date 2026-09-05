// supabase/functions/submit-contact-message/index.ts — LayerPitch, bloc "Contact" public (5 septembre).
//
// Remplace l'ancien flux (navigateur du visiteur → compte Formspree tiers créé par le compositeur) :
// trop de friction à l'inscription (compte externe requis avant de pouvoir publier le bloc), et
// LayerPitch ne voyait jamais passer le message, donc aucun moyen de prévenir le compositeur autrement
// que par cet email tiers. Voir supabase/migrations/20260905040000_contact_messages.sql pour le détail.
//
// Appelée anonymement (aucune session requise, un visiteur public n'a pas de compte) — le
// propriétaire réel et son email de contact sont retrouvés ICI, côté serveur, à partir de l'AdReel
// visé, jamais depuis une valeur envoyée par le client (même principe que log_analytics_event()).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function sendContactEmail(to: string, senderName: string, senderEmail: string, message: string, adReelLabel: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const fromAddress = Deno.env.get('RESEND_FROM_ADDRESS');
  if (!apiKey || !fromAddress) {
    return { ok: false, error: 'Secrets Resend non configurés côté Supabase (RESEND_API_KEY / RESEND_FROM_ADDRESS).' };
  }
  const html = `
    <div style="font-family:sans-serif;color:#262521;max-width:480px;">
      <h2 style="font-family:sans-serif;">Nouveau message via ${escapeHtml(adReelLabel)}</h2>
      <p><strong>${escapeHtml(senderName)}</strong> (${escapeHtml(senderEmail)}) t'a écrit :</p>
      <p style="white-space:pre-wrap;border-left:3px solid #c9713c;padding-left:12px;">${escapeHtml(message)}</p>
      <p style="font-size:12px;color:#6f6b62;">Réponds directement à cet email pour lui répondre.</p>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress,
        to,
        reply_to: senderEmail,
        subject: `Nouveau message via ${adReelLabel}`,
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
    const { adReelId, name, email, message } = await req.json();
    if (!adReelId || typeof adReelId !== 'string') {
      return new Response(JSON.stringify({ error: 'adReelId manquant.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const senderName = typeof name === 'string' ? name.trim().slice(0, 200) : '';
    const senderEmail = typeof email === 'string' ? email.trim().slice(0, 200) : '';
    const senderMessage = typeof message === 'string' ? message.trim().slice(0, 5000) : '';
    if (!senderName || !isValidEmail(senderEmail) || !senderMessage) {
      return new Response(JSON.stringify({ error: 'Nom, email et message sont requis.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Limite de fréquence par IP, fenêtre d'une minute — même principe que log_analytics_event(),
    // repli sur l'email du visiteur si l'en-tête n'est pas exposé (jamais un rejet total faute d'IP).
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || senderEmail;
    const bucketKey = `contact:${ip}:${Math.floor(Date.now() / 60000)}`;
    const { data: withinLimit } = await adminClient.rpc('bump_contact_rate_limit', { p_bucket_key: bucketKey });
    if (withinLimit === false) {
      return new Response(JSON.stringify({ error: 'Trop de messages envoyés — réessaie dans une minute.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Propriétaire réel et email de contact retrouvés ICI, jamais depuis une valeur envoyée par le
    // client — un visiteur ne doit jamais pouvoir rediriger un message vers un autre compositeur.
    const { data: adReel, error: adReelError } = await adminClient
      .from('ad_reels')
      .select('owner_id, label, profile')
      .eq('id', adReelId)
      .maybeSingle();
    if (adReelError || !adReel) {
      return new Response(JSON.stringify({ error: 'AdReel introuvable.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const recipientEmail = adReel.profile && typeof adReel.profile.contactEmail === 'string'
      ? adReel.profile.contactEmail.trim() : '';
    if (!recipientEmail) {
      return new Response(JSON.stringify({ error: 'Ce compositeur n\'a pas configuré d\'email de contact.' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adReelLabel = adReel.label || adReelId;
    const emailResult = await sendContactEmail(recipientEmail, senderName, senderEmail, senderMessage, adReelLabel);
    if (!emailResult.ok) {
      return new Response(JSON.stringify({ error: emailResult.error }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Journalisé APRÈS l'envoi réussi de l'email : un message que le compositeur n'a jamais reçu ne
    // doit pas déclencher un badge "nouveau message" trompeur dans la cloche du backstage.
    await adminClient.from('contact_messages').insert({
      owner_id: adReel.owner_id, ad_reel_id: adReelId, ad_reel_label: adReelLabel,
      sender_name: senderName, sender_email: senderEmail,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
