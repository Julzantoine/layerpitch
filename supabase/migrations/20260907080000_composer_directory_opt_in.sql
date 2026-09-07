-- Branchement pour le futur Annuaire des compositeurs (opt-in), chantier 9 de la bascule bêta
-- fermée -> lancement public. Colonne posée maintenant pour que rien ne bloque le jour où l'annuaire
-- sera construit, mais aucune UI réelle ne l'utilise encore -- mon-compte.html affiche une carte
-- grisée/désactivée (case à cocher `disabled`) tant que ce chantier n'est pas repris.
alter table public.composer_profiles
  add column directory_opt_in boolean not null default false;
