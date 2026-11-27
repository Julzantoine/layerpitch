-- LayerPitch — origine des demandes d'accès (15 novembre).
--
-- Pour savoir quel clip (LinkedIn, Discord…) amène quelle inscription : les liens partagés portent
-- des étiquettes utm_source / utm_medium / utm_campaign, la landing les retient pendant la visite et
-- les envoie avec le formulaire. Trois colonnes facultatives (les anciennes lignes restent vides) ;
-- seules les étiquettes du lien sont stockées, pas d'adresse IP ni de profil de navigation.

alter table public.access_requests
  add column utm_source   text check (utm_source   is null or char_length(utm_source)   <= 80),
  add column utm_medium   text check (utm_medium   is null or char_length(utm_medium)   <= 80),
  add column utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 80);
