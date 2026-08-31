-- LayerPitch — prix des packs (étape 4, logique d'achat). Absent du schéma initial : la Décision 1
-- ne prévoyait pas de champ prix sur `packs` (l'achat externe actuel via `buyUrl` gérait ça hors
-- du système). Nécessaire pour créer de vraies sessions Stripe Checkout.
--
-- Valeurs de test posées le 31 août (999 = 9,99 $), PAS une décision de pricing réelle — juste de
-- quoi valider le flux technique en mode test Stripe. `buyable` passé à true sur les 3 packs pour
-- le même motif. À remplacer par de vrais prix avant tout lancement — ne pas traiter ces valeurs
-- comme définitives.

alter table public.packs add column price_usd_cents int;

update public.packs set price_usd_cents = 999, buyable = true;
