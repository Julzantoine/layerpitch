-- LayerPitch — annule 20260911160000_welcome_email_flag.sql.
--
-- Cette colonne préparait un envoi par vrai email (Resend) pour le message de bienvenue --
-- clarifié dans la foulée (même session, 11 septembre) : le besoin est un message INTERNE à
-- LayerPitch (boîte "Messages de LayerPitch" existante), jamais un email dans la boîte mail
-- personnelle. Voir 20260911162000_admin_messages_targeting.sql pour l'implémentation retenue.

alter table public.profiles drop column if exists welcome_email_sent_at;
