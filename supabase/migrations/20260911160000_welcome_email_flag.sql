-- LayerPitch — colonne de suivi pour l'email de bienvenue envoyé une fois l'onboarding terminé
-- (bienvenue.html, juste après mark_onboarding_complete()).
--
-- Sert de garde-fou anti-doublon côté Edge Function send-welcome-email : celle-ci pose ce
-- timestamp via un UPDATE conditionné à "IS NULL" (adminClient, service_role — aucun GRANT
-- UPDATE direct n'existe sur profiles pour authenticated, même principe que
-- mark_onboarding_complete_rpc), donc un double-appel (double-clic, retry réseau) n'envoie jamais
-- deux fois le même email.

alter table public.profiles add column welcome_email_sent_at timestamptz;
