// supabase/functions/notify-admin-message/index.ts — LayerPitch, email envoyé aux testeurs quand
// une annonce admin arrive dans leur cloche (21 septembre).
//
// Appelée par un Database Webhook (dashboard Supabase > Database > Webhooks, événement INSERT sur
// admin_messages) -- jamais depuis un navigateur. Le corps du webhook n'est PAS cru sur parole :
// seul l'identifiant du message en est retiré, le message et la liste des destinataires sont relus
// en base (service_role). L'appelant doit présenter le secret partagé NOTIFY_WEBHOOK_SECRET
// (en-tête x-webhook-secret) : la clé anonyme Supabase est publique, sans ce secret n'importe qui
// pourrait déclencher un envoi en rafale.
//
// Ne notifie que les annonces diffusées (recipient_id null) : le message de bienvenue
// (mark_onboarding_complete) est un message ciblé, jamais envoyé par email. Idempotent : chaque
// (annonce, compte) notifié est consigné dans admin_message_emails, un rejeu n'envoie rien de plus.
//
// Mode essai (corps { message_id, test_email, test_lang? }) : envoie UN SEUL email, à cette
// adresse, préfixé [TEST], sans rien consigner -- pour vérifier le rendu sans écrire à tout le
// monde. Même secret requis.
//
// Envoi par lots via l'API batch de Resend (jusqu'à 100 emails par appel) plutôt qu'un appel par
// destinataire : évite la limite de débit par seconde. Même précautions de délivrabilité que les
// autres emails (version texte brut, reply_to) depuis l'épisode "classé en spam" du 20 septembre.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APP_URL = 'https://beta.layerpitch.com';
const REPLY_TO = 'contact@layerpitch.com';
const MAX_RECIPIENTS = 300;
const BATCH_SIZE = 50;
const EXCERPT_CHARS = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlToText(html: string): string {
  return html
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, '$2 : $1')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n').trim();
}

// Début du message, coupé proprement sur un mot -- l'email donne envie d'ouvrir la cloche, il ne
// remplace pas la lettre complète.
function excerptOf(text: string): string {
  const t = text.trim();
  if (t.length <= EXCERPT_CHARS) return t;
  const cut = t.slice(0, EXCERPT_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > EXCERPT_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

const COPY: Record<string, { subject: string; heading: string; cta: string; footer: string; unsubscribe: string }> = {
  fr: {
    subject: 'Nouveau message sur LayerPitch',
    heading: 'Vous avez un nouveau message sur LayerPitch',
    cta: 'Lire le message',
    footer: 'Vous recevez cet email parce que vous testez la bêta de LayerPitch.',
    unsubscribe: 'Ne plus recevoir ces emails',
  },
  en: {
    subject: 'New message on LayerPitch',
    heading: 'You have a new message on LayerPitch',
    cta: 'Read the message',
    footer: 'You are receiving this email because you are testing the LayerPitch beta.',
    unsubscribe: 'Stop receiving these emails',
  },
};

function bodyIn(body: Record<string, string>, lang: 'fr' | 'en'): string {
  const other = lang === 'fr' ? 'en' : 'fr';
  return (typeof body[lang] === 'string' && body[lang].trim()) ? body[lang] : (typeof body[other] === 'string' ? body[other] : '');
}

// Titre optionnel du message (admin_messages.title, même forme que body : une clé par langue) --
// repris comme objet et comme intitulé de l'email quand il existe, sinon les textes génériques.
function titleIn(title: Record<string, string> | null, lang: 'fr' | 'en'): string {
  if (!title) return '';
  const other = lang === 'fr' ? 'en' : 'fr';
  const v = (typeof title[lang] === 'string' && title[lang].trim()) ? title[lang] : (typeof title[other] === 'string' ? title[other] : '');
  return v.trim();
}

function buildEmail(body: Record<string, string>, title: Record<string, string> | null, lang: string | null, isTest: boolean) {
  const langs: Array<'fr' | 'en'> = lang === 'fr' || lang === 'en' ? [lang] : ['fr', 'en'];
  const unsubscribeUrl = `${APP_URL}/mon-compte.html`;
  const blocks = langs.map((l) => {
    const c = COPY[l];
    const excerpt = escapeHtml(excerptOf(bodyIn(body, l))).replace(/\n/g, '<br>');
    const heading = escapeHtml(titleIn(title, l) || c.heading);
    return `
      <h2 style="font-family:sans-serif;font-size:18px;">${heading}</h2>
      <p>${excerpt}</p>
      <p><a href="${APP_URL}/layerpitch-backstage.html" style="display:inline-block;padding:10px 24px;background:#c9713c;color:#fff;text-decoration:none;border-radius:4px;">${c.cta}</a></p>
      <p style="font-size:12px;color:#6f6b62;">${c.footer} <a href="${unsubscribeUrl}">${c.unsubscribe}</a></p>`;
  });
  const html = `<div style="font-family:sans-serif;color:#262521;max-width:480px;">${blocks.join('<hr style="border:none;border-top:1px solid #e2e2e6;margin:24px 0;">')}</div>`;
  const subjects = langs.map((l) => titleIn(title, l) || COPY[l].subject);
  const subject = (isTest ? '[TEST] ' : '') + (subjects[1] && subjects[1] !== subjects[0] ? subjects.join(' / ') : subjects[0]);
  return { subject, html, text: htmlToText(html), unsubscribeUrl };
}

async function sendBatch(apiKey: string, fromAddress: string, emails: Array<{ to: string; subject: string; html: string; text: string; unsubscribeUrl: string }>) {
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(emails.map((e) => ({
      from: fromAddress,
      to: e.to,
      subject: e.subject,
      html: e.html,
      text: e.text,
      reply_to: REPLY_TO,
      headers: { 'List-Unsubscribe': `<${e.unsubscribeUrl}>` },
    }))),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false as const, error: `Resend a refusé le lot (${res.status}) : ${detail.slice(0, 300)}` };
  }
  return { ok: true as const };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

  const secret = Deno.env.get('NOTIFY_WEBHOOK_SECRET') || '';
  const provided = req.headers.get('x-webhook-secret') || '';
  if (!secret || !safeEqual(provided, secret)) return json({ error: 'Non autorisé.' }, 401);

  try {
    const payload = await req.json();
    if (payload && payload.type && payload.type !== 'INSERT') return json({ skipped: 'not an insert' });
    const messageId = Number(payload?.record?.id ?? payload?.message_id);
    if (!Number.isInteger(messageId) || messageId <= 0) return json({ error: 'Identifiant de message manquant.' }, 400);

    const apiKey = Deno.env.get('RESEND_API_KEY');
    const fromAddress = Deno.env.get('RESEND_FROM_ADDRESS');
    if (!apiKey || !fromAddress) return json({ error: 'Secrets Resend non configurés côté Supabase.' }, 500);

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: message, error: messageError } = await adminClient
      .from('admin_messages').select('id, body, title, recipient_id').eq('id', messageId).maybeSingle();
    if (messageError || !message) return json({ error: 'Message introuvable.' }, 404);
    if (message.recipient_id) return json({ skipped: 'message ciblé (pas une annonce diffusée)' });
    const body = (message.body && typeof message.body === 'object') ? message.body as Record<string, string> : {};
    const title = (message.title && typeof message.title === 'object') ? message.title as Record<string, string> : null;

    // Mode essai : un seul email à l'adresse donnée, rien de consigné.
    const testEmail = typeof payload.test_email === 'string' ? payload.test_email.trim() : '';
    if (testEmail) {
      const built = buildEmail(body, title, payload.test_lang === 'fr' || payload.test_lang === 'en' ? payload.test_lang : null, true);
      const result = await sendBatch(apiKey, fromAddress, [{ to: testEmail, ...built }]);
      return result.ok ? json({ ok: true, test: true, sent: 1 }) : json({ error: result.error }, 502);
    }

    const { data: recipients, error: recipientsError } = await adminClient
      .rpc('get_announcement_recipients', { p_message_id: messageId });
    if (recipientsError) {
      console.error('notify-admin-message: get_announcement_recipients', recipientsError);
      return json({ error: 'Impossible de lire les destinataires.' }, 500);
    }
    const list = (recipients || []) as Array<{ profile_id: string; email: string; lang: string | null }>;
    if (list.length === 0) return json({ ok: true, sent: 0 });
    if (list.length > MAX_RECIPIENTS) {
      return json({ error: `Trop de destinataires (${list.length} > ${MAX_RECIPIENTS}) : envoi refusé par sécurité.` }, 400);
    }

    let sent = 0;
    const failures: string[] = [];
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const chunk = list.slice(i, i + BATCH_SIZE);
      const emails = chunk.map((r) => ({ to: r.email, ...buildEmail(body, title, r.lang, false) }));
      const result = await sendBatch(apiKey, fromAddress, emails);
      if (!result.ok) { failures.push(result.error); console.error('notify-admin-message:', result.error); continue; }
      const { error: trackError } = await adminClient.from('admin_message_emails')
        .insert(chunk.map((r) => ({ message_id: messageId, profile_id: r.profile_id })));
      if (trackError) console.error('notify-admin-message: suivi non enregistré', trackError);
      sent += chunk.length;
    }
    return json({ ok: failures.length === 0, sent, failed: list.length - sent, errors: failures }, failures.length ? 502 : 200);
  } catch (e) {
    console.error('notify-admin-message:', e);
    return json({ error: 'Erreur interne.' }, 500);
  }
});
