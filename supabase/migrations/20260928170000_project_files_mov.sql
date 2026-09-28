-- LayerPitch — Projets : accepter les vidéos .mov (enregistrements d'écran et exports du Mac), 28/09 au soir, suite à
-- l'essai réel de Jules-Antoine (« Type de fichier non accepté (.mov) »). Même limite que les autres vidéos (2 Go).
-- Lecture : Safari et Chrome lisent en général un .mov (H.264) ; Firefox pas toujours -> la page propose alors de le
-- télécharger (projet.html). Rien d'autre ne change (toujours jamais de HTML ni de SVG).
create or replace function public.project_file_rule(p_ext text)
returns table (mime text, max_bytes bigint)
language sql
immutable
as $$
  select m, mb::bigint * 1024 * 1024 from (values
    ('jpg', 'image/jpeg', 20), ('jpeg', 'image/jpeg', 20), ('png', 'image/png', 20), ('webp', 'image/webp', 20), ('gif', 'image/gif', 20),
    ('ogg', 'audio/ogg', 150), ('mp3', 'audio/mpeg', 150), ('wav', 'audio/wav', 300), ('m4a', 'audio/mp4', 150), ('flac', 'audio/flac', 300),
    ('mp4', 'video/mp4', 2048), ('webm', 'video/webm', 2048), ('mov', 'video/quicktime', 2048), ('pdf', 'application/pdf', 30)
  ) t(e, m, mb) where e = lower(p_ext);
$$;
