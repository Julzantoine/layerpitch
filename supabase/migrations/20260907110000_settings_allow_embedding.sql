-- LayerPitch — réglage global "J'autorise les visiteurs à intégrer mon contenu sur leur site" (packs,
-- collections, listes de morceaux d'AdReel), même principe que waveform_style/seq_map_theme
-- (20260905030000_settings_waveform_style.sql, 20260906010000_settings_seq_map_theme.sql).
--
-- Contrôle uniquement le bouton "Intégrer" affiché ou non aux VISITEURS sur les pages publiques
-- (pack.html/collection.html/index.html) -- ne bloque jamais un lien ?embed=1 déjà généré par le
-- compositeur lui-même depuis le backstage (toujours disponible, geste délibéré de sa part).
--
-- Défaut : false (opt-in) -- un compositeur ne doit pas découvrir après coup que n'importe quel
-- visiteur pouvait embarquer sa musique ailleurs sans qu'il l'ait explicitement choisi.
alter table public.settings
  add column allow_embedding boolean not null default false;

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

  insert into public.settings (owner_id, published_at, implementation_skills, no_ai_certified_global, custom_fonts, waveform_style, seq_map_theme, allow_embedding)
  values (
    v_owner_id, (payload->>'publishedAt')::bigint,
    coalesce(payload->'implementationSkills', '{}'::jsonb),
    coalesce((payload->>'noAiCertifiedGlobal')::boolean, false),
    coalesce(payload->'customFonts', '[]'::jsonb),
    coalesce(payload->>'waveformStyle', 'bars'),
    coalesce(payload->>'seqMapTheme', 'light'),
    coalesce((payload->>'allowEmbedding')::boolean, false)
  )
  on conflict (owner_id) do update set
    published_at = excluded.published_at, implementation_skills = excluded.implementation_skills,
    no_ai_certified_global = excluded.no_ai_certified_global, custom_fonts = excluded.custom_fonts,
    waveform_style = excluded.waveform_style, seq_map_theme = excluded.seq_map_theme,
    allow_embedding = excluded.allow_embedding;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.upsert_settings(jsonb) to authenticated;
