-- Correctif (24/11) : la fonction create-media-signed-url (version du 23/11, audit sécurité M5) appelle claim_media_prefix
-- avec la clé service_role, mais la migration 20261123020000 avait retiré le droit d'exécution sans le redonner à
-- service_role : « permission denied for function claim_media_prefix » -> TOUT envoi de fichier d'un nouveau morceau /
-- Sfx / vidéo était refusé avec « Ce fichier ne t'appartient pas ». Le droit est rendu au seul service_role.
-- Conditionnelle : la fonction n'existe que si la migration de sécurité 20261123020000 est passée (sur une base neuve
-- dont main ne la contient pas encore, il n'y a rien à faire).
do $$
begin
  if to_regprocedure('public.claim_media_prefix(text, text, uuid, uuid)') is not null then
    grant execute on function public.claim_media_prefix(text, text, uuid, uuid) to service_role;
  end if;
end $$;
