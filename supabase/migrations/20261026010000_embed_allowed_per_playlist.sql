-- LayerPitch — « Intégrer » par playlist (26/10). L'ancien oui/non global settings.allow_embedding (les VISITEURS peuvent-ils
-- générer un code d'intégration depuis les pages publiques ?) est remplacé par une liste choisie élément par élément :
--   settings.embed_allowed = { "adreels": [ids], "packs": [ids], "collections": [ids] }
-- Un élément absent de la liste = non autorisé (défaut). La colonne allow_embedding reste en base (héritage, plus lue).
-- Reprise : les comptes qui avaient coché la case globale reçoivent TOUS leurs AdReels, packs et collections actuels dans la liste.
-- upsert_settings est recopiée de 20260930050000 avec ce seul ajout (embed_allowed).

alter table public.settings add column if not exists embed_allowed jsonb not null default '{}'::jsonb;

update public.settings s set embed_allowed = jsonb_build_object(
  'adreels', coalesce((select jsonb_agg(a.id) from public.ad_reels a where a.owner_id = s.owner_id), '[]'::jsonb),
  'packs', coalesce((select jsonb_agg(p.id) from public.packs p where p.owner_id = s.owner_id), '[]'::jsonb),
  'collections', coalesce((select jsonb_agg(c.id) from public.collections c where c.owner_id = s.owner_id), '[]'::jsonb)
) where s.allow_embedding;

create or replace function public.upsert_settings(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;

  insert into public.settings (owner_id, published_at, implementation_skills, no_ai_certified_global, custom_fonts, waveform_style, seq_map_theme, allow_embedding, share_preview, embed_allowed)
  values (
    v_owner_id, (payload->>'publishedAt')::bigint,
    coalesce(payload->'implementationSkills', '{}'::jsonb),
    coalesce((payload->>'noAiCertifiedGlobal')::boolean, false),
    coalesce(payload->'customFonts', '[]'::jsonb),
    coalesce(payload->>'waveformStyle', 'bars'),
    coalesce(payload->>'seqMapTheme', 'light'),
    coalesce((payload->>'allowEmbedding')::boolean, false),
    coalesce(payload->'sharePreview', '{}'::jsonb),
    coalesce(payload->'embedAllowed', '{}'::jsonb)
  )
  on conflict (owner_id) do update set
    published_at = excluded.published_at, implementation_skills = excluded.implementation_skills,
    no_ai_certified_global = excluded.no_ai_certified_global, custom_fonts = excluded.custom_fonts,
    waveform_style = excluded.waveform_style, seq_map_theme = excluded.seq_map_theme,
    allow_embedding = excluded.allow_embedding, share_preview = excluded.share_preview,
    embed_allowed = excluded.embed_allowed;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.upsert_settings(jsonb) to authenticated;
