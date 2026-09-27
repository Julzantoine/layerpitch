-- LayerPitch — Adaptive OST (étape A.8, 27/09/2026) : les fichiers audio utilisés par une version ne sont jamais effacés.
--
-- Décision de Jules-Antoine (27/09) : « le fan garde ce qu'il a acheté ». Une version (prise du fan, album_track_versions,
-- ou version du compositeur, album_tracks.default_settings) rejoue les fichiers audio publiés du morceau et de ses Sfx
-- (URL complètes dans le journal de la prise). Si le compositeur remplace ou retire un fichier en republiant, le
-- Backstage demande à l'effacer (Edge Function create-media-signed-url, méthode DELETE) : la fonction consulte ici si
-- une version s'en sert, et garde alors le fichier au lieu de signer l'effacement. Écoute et téléchargement restent
-- donc possibles pour toujours, sans stocker de fichier rendu par version.
--
-- p_needles : les formes sous lesquelles le chemin peut apparaître dans une prise (chemin brut, et nom de fichier encodé
-- comme le fait le lecteur : base + encodeURIComponent(fichier)). Recherche plein texte dans le JSON des prises :
-- suffisant à l'échelle de la bêta (quelques prises) ; à indexer (table des fichiers utilisés) si le volume grandit.
-- Réservée au rôle service (appelée par l'Edge Function), jamais aux clients.

create or replace function public.media_path_used_by_versions(p_needles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.album_track_versions v, unnest(p_needles) n
    where n <> '' and strpos(v.take::text, n) > 0
  ) or exists (
    select 1 from public.album_tracks t, unnest(p_needles) n
    where n <> '' and t.default_settings->>'kind' = 'layerpitch-take' and strpos(t.default_settings::text, n) > 0
  );
$$;

revoke all on function public.media_path_used_by_versions(text[]) from public, anon, authenticated;
grant execute on function public.media_path_used_by_versions(text[]) to service_role;
