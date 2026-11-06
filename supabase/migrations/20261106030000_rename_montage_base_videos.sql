-- 06/11 (décidé avec Jules-Antoine) : le fichier technique d'un montage (image sans son, kind = 'capture_base') s'appelait
-- « … — vidéo muette » / « … — silent video » : trompeur, puisque c'est le montage avec son qu'on cherche dans la liste.
-- Il s'appelle désormais « … — montage » (libellé de l'atelier : layerpitch-i18n.js, captureSilentVideoSuffix). Ici : l'existant.
update public.composer_videos
set title = regexp_replace(title, ' — (vidéo muette|silent video)$', ' — montage')
where kind = 'capture_base'
  and title ~ ' — (vidéo muette|silent video)$';
