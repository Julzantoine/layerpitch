-- LayerPitch — réduit le quota de stockage vidéo Warrior (plan 'starter') de 20 à 5 Go, 16 septembre.
--
-- plan_quotas.max_video_storage_gb valait 20 Go pour 'starter' depuis le 3 septembre (grille
-- initiale, sans lien avec le chantier vidéo capturée qui n'existait pas encore). Discussion avec
-- Jules-Antoine le 16 septembre, en construisant la bibliothèque vidéo compositeur
-- (composer_videos) : il a d'abord dit que seul Boss ('pro') devrait pouvoir stocker de la vidéo,
-- avant de se raviser en expliquant un vrai cas vécu -- l'un de ses rescores a été refusé par
-- YouTube, bloquant complètement l'exposition du Reel correspondant faute de repli hébergé (argument
-- que ReelCrafter met lui-même en avant). Décision retenue : 5 Go pour Warrior, un filet de sécurité
-- modeste ("mon Reel principal est rejeté, j'ai besoin d'un repli") plutôt qu'un vrai stockage de
-- bibliothèque -- le vrai argument Boss reste l'édition/sauvegarde des prises de capture
-- (video_captures), pas le stockage vidéo en tant que tel. Coût négligeable dans tous les cas (R2 :
-- ~0,015$/Go/mois, sortie gratuite).
--
-- Rookie/free reste à 0 Go (inchangé), Boss/pro reste à 100 Go (inchangé).

update public.plan_quotas set max_video_storage_gb = 5 where plan = 'starter';
