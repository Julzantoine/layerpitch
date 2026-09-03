-- LayerPitch — ad_reels.id devient unique PAR COMPOSITEUR plutôt que globalement.
--
-- Trouvé en testant le backstage hébergé avec un second compte compositeur réel : le backstage
-- donne toujours l'id littéral 'main' au tout premier AdReel d'un compositeur qui n'a encore rien
-- publié (layerpitch-backstage.html:7115/7364) — sans conséquence tant que chaque compositeur avait
-- son propre repo GitHub isolé, mais collision garantie pour 100% des nouveaux compositeurs dès
-- qu'ils partagent une seule base Postgres. `upsert_ad_reel` a correctement rejeté la collision
-- ("appartient à un autre compositeur"), confirmant le problème sans corrompre de données.
--
-- Corrigé uniquement ici, pas sur tracks/packs/sfx_library/collections/albums (même défaut de
-- conception, mais leurs ids sont générés aléatoirement — genId() — donc une collision réelle y
-- est de probabilité négligeable, contrairement à 'main' qui est un cas garanti). Refondre ces 8
-- tables pour un risque quasi nul serait de la sur-ingénierie, pas une correction proportionnée.
--
-- Complément indispensable, pas seulement une contrainte de base : la lecture publique
-- (index.html/pack.html/collection.html) a besoin d'un moyen de porter l'identité du compositeur
-- dans l'URL pour résoudre 'main' sans ambiguïté (voir 20260903120100_composer_handle.sql et le
-- code applicatif — api/adreels.js, 404.html, index.html/pack.html/collection.html).

alter table public.ad_reels drop constraint ad_reels_pkey;
alter table public.ad_reels add primary key (owner_id, id);

alter table public.ad_reel_tracks add column owner_id uuid;
update public.ad_reel_tracks art
  set owner_id = ar.owner_id
  from public.ad_reels ar
  where ar.id = art.ad_reel_id;
alter table public.ad_reel_tracks alter column owner_id set not null;
alter table public.ad_reel_tracks drop constraint ad_reel_tracks_ad_reel_id_fkey;
alter table public.ad_reel_tracks add constraint ad_reel_tracks_ad_reel_id_fkey
  foreign key (owner_id, ad_reel_id) references public.ad_reels(owner_id, id) on delete cascade;

-- packs.linked_ad_reel_id : un pack ne peut lier qu'un AdReel de son propre compositeur (règle déjà
-- vraie dans les faits, jamais construite pour en lier un autre) — réutilise packs.owner_id, déjà
-- présent, plutôt que d'ajouter une colonne.
alter table public.packs drop constraint packs_linked_ad_reel_id_fkey;
alter table public.packs add constraint packs_linked_ad_reel_id_fkey
  foreign key (owner_id, linked_ad_reel_id) references public.ad_reels(owner_id, id) on delete set null;
