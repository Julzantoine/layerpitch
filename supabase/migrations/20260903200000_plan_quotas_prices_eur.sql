-- LayerPitch — bascule des colonnes de tarification abonnement de USD vers EUR (chantier 4b,
-- décision du 3 septembre : le site est en français, les prix ont été pensés en euros -- la
-- colonne price_usd_cents_monthly/yearly ajoutée dans 20260903190000 aurait porté un nom trompeur
-- si on l'avait laissée telle quelle avec des valeurs en centimes d'euros dedans).
--
-- Ne touche pas packs.price_usd_cents (achat unitaire studio, hors périmètre de cette décision --
-- reste en USD pour l'instant, question distincte non tranchée ici).

alter table public.plan_quotas rename column price_usd_cents_monthly to price_eur_cents_monthly;
alter table public.plan_quotas rename column price_usd_cents_yearly to price_eur_cents_yearly;

update public.plan_quotas set price_eur_cents_monthly = 1000, price_eur_cents_yearly = 10000 where plan = 'starter';
update public.plan_quotas set price_eur_cents_monthly = 2500, price_eur_cents_yearly = 25000 where plan = 'pro';
