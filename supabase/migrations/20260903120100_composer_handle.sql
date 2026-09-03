-- LayerPitch — handle public par compositeur, nécessaire pour que l'URL publique porte l'identité
-- du compositeur (backstage hébergé, plusieurs compositeurs sur beta.layerpitch.com — voir
-- 20260903120000_ad_reels_owner_scoped_id.sql pour le problème que ça résout).
--
-- Handles réservés : ne doivent jamais coïncider avec un fichier/dossier réel du dépôt, sinon
-- GitHub Pages le résout directement (ex. /pack -> pack.html) avant même que 404.html n'ait la main.
-- Contrainte posée ici, pas seulement documentée pour plus tard.
--
-- Attribution réelle d'un handle à un nouveau compositeur (choix, validation d'unicité côté UI)
-- reste à construire dans le chantier "flux d'inscription" — cette migration ne pose que la colonne
-- et la résolution en lecture, nullable pour l'instant.

alter table public.composer_profiles add column handle text unique
  check (handle !~ '^(pack|collection|index|video-test|admin-beta-console|admin-analytics|layerpitch-backstage|api|docs|scripts|supabase|404|u|data)$');

update public.composer_profiles
  set handle = 'julzantoine'
  where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c';

-- Résolution handle -> owner_id en lecture publique, via une fonction étroite plutôt qu'une policy
-- RLS ouverte sur toute la table (composer_profiles reste par ailleurs à lecture restreinte au
-- propriétaire, comme profiles/buyer_profiles/pack_purchases — voir 20260831112717_grants.sql) :
-- ne révèle que l'id, jamais profile_id/created_at/les autres compositeurs listés en vrac.
create or replace function public.resolve_composer_handle(p_handle text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.composer_profiles where handle = p_handle;
$$;

grant execute on function public.resolve_composer_handle(text) to anon, authenticated;
