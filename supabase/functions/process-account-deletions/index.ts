// process-account-deletions — LayerPitch, suppression de compte (29/09 ; migration 20260929070000).
//
// À PLANIFIER une fois par jour (Supabase → Integrations → Cron, ou pg_cron + pg_net), ou à lancer à la main. Qui peut
// l'appeler : la tâche planifiée (clé service_role) ou un admin LayerPitch. Pour chaque compte dont la suppression est
// échue (30 jours après la demande, sans annulation) :
//   1. lit les identifiants Stripe (avant l'anonymisation) ;
//   2. finalize_account_deletion : SUPPRIME en base tout ce qui n'a pas été vendu à des tiers et ANONYMISE le reste
//      (une transaction ; en cas d'erreur rien n'est modifié et le compte reste échu : réessayé le lendemain) ;
//   3. résilie l'abonnement Stripe et supprime le client Stripe (les factures Stripe restent chez Stripe ; un compte
//      Connect Standard ne peut pas être supprimé par la plateforme : il reste, détaché de LayerPitch) ;
//   4. supprime l'identité de connexion (auth.admin.deleteUser en suppression DOUCE : l'adresse e-mail disparaît, la ligne
//      d'identité reste pour porter ce qui a été vendu).
// Puis, pour TOUS les comptes (y compris ceux d'une exécution précédente interrompue), vide la file account_deletion_files :
// efface les fichiers R2 (seau public R2_BUCKET / privé R2_PROJECTS_BUCKET) des préfixes en file, sauf keep_keys.
// Réponse : { deleted: [ids], filesDeleted, filesPending, errors: [...] }.
// NON TESTÉE EN RÉEL au 29/09 : essayer sur un compte de test (feu vert account_deletion ouvert, date d'échéance avancée à
// la main) AVANT de planifier. supabase functions deploy process-account-deletions
import Stripe from 'npm:stripe@22.6.0';
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const unxml = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// Appel depuis le navigateur (1er/10) : un administrateur peut lancer la fonction depuis sa session (console du Backstage) pour
// l'essai réel ; sans ces en-têtes le navigateur bloquait l'appel (« CORS »). Mêmes origines que les autres fonctions ; l'accès
// reste réservé à la clé de service ou à un administrateur (vérifié plus bas), l'origine n'est qu'une défense en profondeur.
const ALLOWED_ORIGINS = new Set(['https://beta.layerpitch.com', 'https://layerpitch.com', 'https://www.layerpitch.com', 'http://localhost:8420']);
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://beta.layerpitch.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersFor(req) });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeadersFor(req)) });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';
    if (authHeader.replace(/^Bearer\s+/i, '') !== serviceKey) {
      const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
      const { data: isAdmin } = await callerClient.rpc('is_admin');
      if (!isAdmin) return json({ error: 'Non autorisé.' }, 403);
    }
    const admin = createClient(supabaseUrl, serviceKey);
    const stripe = Deno.env.get('STRIPE_SECRET_KEY') ? new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2025-03-31.basil' }) : null;
    const result: { deleted: string[]; filesDeleted: number; filesPending: number; errors: string[] } = { deleted: [], filesDeleted: 0, filesPending: 0, errors: [] };

    // ---- 1. Comptes échus ----
    const { data: due, error: dueError } = await admin.rpc('due_account_deletions');
    if (dueError) return json({ error: dueError.message }, 500);
    for (const profileId of (due || []) as string[]) {
      try {
        const { data: ext } = await admin.rpc('account_deletion_stripe_ids', { p_profile: profileId });
        const { error: finError } = await admin.rpc('finalize_account_deletion', { p_profile: profileId });
        if (finError) { result.errors.push(`${profileId}: base : ${finError.message}`); continue; }
        // Stripe : après la base (si la base a échoué, rien n'est résilié). Une erreur ici n'annule pas la suppression.
        if (stripe && ext) {
          for (const sub of ext.subscriptions || []) { try { await stripe.subscriptions.cancel(sub); } catch (e) { result.errors.push(`${profileId}: Stripe abonnement ${sub} : ${(e as Error).message}`); } }
          for (const cus of ext.customers || []) { try { await stripe.customers.del(cus); } catch (e) { result.errors.push(`${profileId}: Stripe client ${cus} : ${(e as Error).message}`); } }
        } else if (ext && ((ext.subscriptions || []).length || (ext.customers || []).length)) {
          result.errors.push(`${profileId}: STRIPE_SECRET_KEY absent : abonnement/client Stripe à résilier à la main (${[...(ext.subscriptions || []), ...(ext.customers || [])].join(', ')})`);
        }
        const { error: authError } = await admin.auth.admin.deleteUser(profileId, true);
        if (authError) result.errors.push(`${profileId}: identité de connexion : ${authError.message}`);
        result.deleted.push(profileId);
      } catch (e) { result.errors.push(`${profileId}: ${(e as Error).message}`); }
    }

    // ---- 2. File des fichiers R2 ----
    const accountId = Deno.env.get('R2_ACCOUNT_ID')!;
    const buckets: Record<string, string | undefined> = { public: Deno.env.get('R2_BUCKET'), private: Deno.env.get('R2_PROJECTS_BUCKET') };
    const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!, secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!, service: 's3', region: 'auto' });
    const { data: queue } = await admin.rpc('pending_deletion_files', { p_limit: 200 });
    for (const item of (queue || []) as Array<{ id: string; bucket: string; prefix: string; keep_keys: string[] }>) {
      const bucket = buckets[item.bucket];
      if (!bucket) { result.errors.push(`file ${item.id}: seau ${item.bucket} non configuré`); continue; }
      try {
        const host = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
        const keys: string[] = [];
        let token: string | null = null;
        do {
          const res = await r2.fetch(`${host}?list-type=2&prefix=${encodeURIComponent(item.prefix)}${token ? '&continuation-token=' + encodeURIComponent(token) : ''}`);
          if (!res.ok) throw new Error(`liste ${res.status}`);
          const xml = await res.text();
          for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(unxml(m[1]));
          const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
          token = next ? next[1] : null;
        } while (token);
        const keep = new Set(item.keep_keys || []);
        let failed = 0;
        for (const key of keys.filter((k) => !keep.has(k))) {
          const res = await r2.fetch(`${host}/${key.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' });
          if (res.ok || res.status === 404) result.filesDeleted++; else failed++;
        }
        if (failed) { result.errors.push(`file ${item.id}: ${failed} fichier(s) non effacé(s), réessayé à la prochaine exécution`); continue; }
        await admin.rpc('mark_deletion_file_done', { p_id: item.id });
      } catch (e) { result.errors.push(`file ${item.id}: ${(e as Error).message}`); }
    }
    const { data: left } = await admin.rpc('pending_deletion_files', { p_limit: 1000 });
    result.filesPending = (left || []).length;
    return json({ ok: result.errors.length === 0, ...result });
  } catch (e) {
    console.error('process-account-deletions:', e);
    return json({ error: 'Erreur interne.' }, 500);
  }
});
