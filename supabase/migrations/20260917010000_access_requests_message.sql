-- LayerPitch — champ message libre sur les demandes d'accès (17 septembre).
--
-- La landing ne capturait qu'un email : demande de Jules-Antoine d'ajouter un petit champ texte
-- pour que les gens puissent préciser leur demande ("je veux rejoindre la bêta" / "tenez-moi au
-- courant" ne disent rien du contexte). Colonne nullable plutôt qu'obligatoire : le champ reste
-- optionnel côté formulaire, l'email seul suffit toujours à faire une demande valide.

alter table public.access_requests
  add column message text check (message is null or char_length(message) <= 500);
