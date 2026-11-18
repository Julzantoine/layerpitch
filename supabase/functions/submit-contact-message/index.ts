// supabase/functions/submit-contact-message/index.ts — LayerPitch, bloc "Contact" public (5 septembre).
//
// Remplace l'ancien flux (navigateur du visiteur → compte Formspree tiers créé par le compositeur) :
// trop de friction à l'inscription (compte externe requis avant de pouvoir publier le bloc), et
// LayerPitch ne voyait jamais passer le message, donc aucun moyen de prévenir le compositeur autrement
// que par cet email tiers. Voir supabase/migrations/20260905040000_contact_messages.sql pour le détail.
//
// Shop (29/09) : accepte aussi { packId } ou { albumId } (« prenez contact avec le vendeur pour d'éventuelles adaptations ») —
// pack ou album EN VENTE seulement ; le destinataire est retrouvé côté serveur (adresse de contact configurée dans le
// bloc Contact de son AdReel principal, à défaut l'adresse de connexion du vendeur ; pour un studio, celle du propriétaire).
// Le message ne révèle jamais l'adresse du vendeur à l'expéditeur.
//
// Annuaire des compositeurs (23/10) : accepte aussi { handle } — le compositeur de l'annuaire (case « visible » cochée) ; même
// recherche du destinataire que pour un pack (adresse de contact de ses AdReels, à défaut l'adresse de connexion).
//
// Appelée anonymement (aucune session requise, un visiteur public n'a pas de compte) — le
// propriétaire réel et son email de contact sont retrouvés ICI, côté serveur, à partir de l'AdReel
// visé, jamais depuis une valeur envoyée par le client (même principe que log_analytics_event()).

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
  const corsHeaders = corsHeadersFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { adReelId, ownerId, packId, albumId, handle, name, email, message } = await req.json();
    const shopKind = typeof packId === 'string' && packId ? 'pack' : (typeof albumId === 'string' && albumId ? 'album' : (typeof handle === 'string' && handle ? 'composer' : null));
    if (!shopKind && (!adReelId || typeof adReelId !== 'string')) {
      return new Response(JSON.stringify({ error: 'adReelId, packId, albumId ou handle manquant.' }), {
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
    // Dernier segment de x-forwarded-for (posé par le proxy de confiance le plus proche), pas le
    // premier (falsifiable par l'appelant qui peut fixer sa propre valeur sur la requête) -- corrigé
    // 11 septembre, audit sécurité, même raisonnement que log_analytics_event() côté SQL.
    const xff = req.headers.get('x-forwarded-for');
    const ip = (xff ? xff.split(',').map((s) => s.trim()).filter(Boolean).pop() : null) || senderEmail;
    const bucketKey = `contact:${ip}:${Math.floor(Date.now() / 60000)}`;
    const { data: withinLimit } = await adminClient.rpc('bump_contact_rate_limit', { p_bucket_key: bucketKey });
    if (withinLimit === false) {
      return new Response(JSON.stringify({ error: 'Trop de messages envoyés — réessaie dans une minute.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Destinataire retrouvé ICI, jamais depuis une valeur envoyée par le client — un visiteur ne doit jamais pouvoir
    // rediriger un message vers un autre compositeur.
    let ownerComposerId: string | null = null;
    let recipientEmail = '';
    let logRef = adReelId as string;
    let adReelLabel = '';
    if (shopKind) {
      // Shop : pack ou album EN VENTE (jamais un brouillon).
      let sellerProfileId: string | null = null;
      if (shopKind === 'composer') {
        const { data: cp } = await adminClient.from('composer_profiles').select('id, profile_id, directory_opt_in').eq('handle', handle).maybeSingle();
        if (!cp || !cp.directory_opt_in) return new Response(JSON.stringify({ error: 'Compositeur introuvable.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        ownerComposerId = cp.id; sellerProfileId = cp.profile_id;
        adReelLabel = `Annuaire · ${handle}`; logRef = 'main';
      } else if (shopKind === 'pack') {
        const { data: pack } = await adminClient.from('packs').select('owner_id, title, buyable').eq('id', packId).maybeSingle();
        if (!pack || !pack.buyable) return new Response(JSON.stringify({ error: 'Pack introuvable.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const { data: cp } = await adminClient.from('composer_profiles').select('id, profile_id').eq('id', pack.owner_id).maybeSingle();
        ownerComposerId = cp?.id ?? null; sellerProfileId = cp?.profile_id ?? null;
        adReelLabel = `Shop · ${pack.title || packId}`; logRef = `pack:${packId}`;
      } else {
        const { data: album } = await adminClient.from('albums').select('seller_id, seller_role, title, buyable').eq('id', albumId).maybeSingle();
        if (!album || !album.buyable) return new Response(JSON.stringify({ error: 'Album introuvable.' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        sellerProfileId = album.seller_id;
        if (album.seller_role !== 'studio') {
          const { data: cp } = await adminClient.from('composer_profiles').select('id').eq('profile_id', album.seller_id).maybeSingle();
          ownerComposerId = cp?.id ?? null;
        }
        adReelLabel = `Shop · ${album.title || albumId}`; logRef = `album:${albumId}`;
      }
      if (ownerComposerId) {
        // Adresse de contact privée (ad_reel_contacts, 18/11, audit sécurité I1) : celle de l'AdReel principal d'abord.
        const { data: contacts } = await adminClient.from('ad_reel_contacts').select('ad_reel_id, email').eq('owner_id', ownerComposerId).limit(50);
        const list = (contacts || []).filter((c: { email?: string }) => typeof c.email === 'string' && c.email.trim());
        const pick = list.find((c: { ad_reel_id: string }) => c.ad_reel_id === 'main') || list[0];
        if (pick) recipientEmail = pick.email.trim();
      }
      if (!recipientEmail && sellerProfileId) {
        const { data: u } = await adminClient.auth.admin.getUserById(sellerProfileId);
        recipientEmail = u?.user?.email || '';
      }
      if (!recipientEmail) return new Response(JSON.stringify({ error: 'Ce vendeur ne peut pas être contacté pour le moment.' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      // Le même identifiant (« main ») existe chez chaque compositeur : ownerId (envoyé par la page, 18/11) désigne
      // lequel. Il ne choisit pas le destinataire : l'adresse reste celle que CE compositeur a configurée pour CET AdReel.
      // Sans ownerId (ancienne page encore en cache) : accepté seulement si l'identifiant est unique.
      let adReelQuery = adminClient.from('ad_reels').select('owner_id, label').eq('id', adReelId);
      if (typeof ownerId === 'string' && /^[0-9a-f-]{36}$/i.test(ownerId)) adReelQuery = adReelQuery.eq('owner_id', ownerId);
      const { data: adReelRows, error: adReelError } = await adReelQuery.limit(2);
      const adReel = adReelRows && adReelRows.length === 1 ? adReelRows[0] : null;
      if (adReelError || !adReel) {
        return new Response(JSON.stringify({ error: 'AdReel introuvable.' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: contact } = await adminClient.from('ad_reel_contacts').select('email')
        .eq('owner_id', adReel.owner_id).eq('ad_reel_id', adReelId).maybeSingle();
      recipientEmail = contact && typeof contact.email === 'string' ? contact.email.trim() : '';
      if (!recipientEmail) {
        return new Response(JSON.stringify({ error: 'Ce compositeur n\'a pas configuré d\'email de contact.' }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      ownerComposerId = adReel.owner_id;
      adReelLabel = adReel.label || adReelId;
    }

    const emailResult = await sendContactEmail(recipientEmail, senderName, senderEmail, senderMessage, adReelLabel);
    if (!emailResult.ok) {
      return new Response(JSON.stringify({ error: emailResult.error }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Journalisé APRÈS l'envoi réussi de l'email : un message que le vendeur n'a jamais reçu ne doit pas déclencher un badge
    // "nouveau message" trompeur dans la cloche. Un studio (sans profil compositeur) reçoit l'e-mail seulement.
    if (ownerComposerId) {
      await adminClient.from('contact_messages').insert({
        owner_id: ownerComposerId, ad_reel_id: logRef, ad_reel_label: adReelLabel,
        sender_name: senderName, sender_email: senderEmail,
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // Erreur interne inattendue : détail loggé côté serveur, jamais renvoyé au client (durci 11
    // septembre, audit sécurité -- évite de fuir un nom de colonne/contrainte Postgres ou un autre
    // détail interne).
    console.error('submit-contact-message:', e);
    return new Response(JSON.stringify({ error: 'Erreur interne. Réessaie dans un instant.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
