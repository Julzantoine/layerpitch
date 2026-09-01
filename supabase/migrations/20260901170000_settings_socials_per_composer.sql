-- LayerPitch — settings/socials : singleton global → une ligne par compositeur
--
-- Trouvé le 1er septembre en préparant l'authentification des testeurs, confirmé par
-- Jules-Antoine : ces réglages doivent être personnels, pas partagés entre compositeurs.
-- `settings` était une vraie table singleton (id booléen contraint à true, une seule ligne pour
-- tout le système) ; `socials` n'avait aucune notion de propriétaire. Migré vers le même modèle
-- owner_id que tracks/packs/etc. (Décision 1, correction du 31 août) plutôt qu'inventer un
-- mécanisme différent.

-- ---- settings : remplace la clé primaire singleton par owner_id ----
alter table public.settings add column owner_id uuid references public.composer_profiles(id) on delete cascade;
update public.settings set owner_id = (select id from public.composer_profiles where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c') where owner_id is null;
alter table public.settings alter column owner_id set not null;
alter table public.settings drop constraint settings_singleton;
alter table public.settings drop constraint settings_pkey;
alter table public.settings drop column id;
alter table public.settings add primary key (owner_id);

-- ---- socials : ajoute owner_id (id text reste la clé primaire, plusieurs lignes par compositeur) ----
alter table public.socials add column owner_id uuid references public.composer_profiles(id) on delete cascade;
update public.socials set owner_id = (select id from public.composer_profiles where profile_id = '4d04e87f-7da8-41b9-a84e-9fd5ecd0e35c') where owner_id is null;
alter table public.socials alter column owner_id set not null;
create index socials_owner_id_idx on public.socials(owner_id);

-- RLS déjà "public read using (true)" sur les deux tables (inchangé, cohérent avec le reste du
-- schéma — le filtrage par compositeur se fait au niveau requête, comme tracks/packs/etc., pas au
-- niveau RLS, pour que le site public reste consultable sans compte).

-- ---- RPC d'écriture (n'existaient pas du tout jusqu'ici) ----
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

  insert into public.settings (owner_id, published_at, implementation_skills, no_ai_certified_global, custom_fonts)
  values (
    v_owner_id, (payload->>'publishedAt')::bigint,
    coalesce(payload->'implementationSkills', '{}'::jsonb),
    coalesce((payload->>'noAiCertifiedGlobal')::boolean, false),
    coalesce(payload->'customFonts', '[]'::jsonb)
  )
  on conflict (owner_id) do update set
    published_at = excluded.published_at, implementation_skills = excluded.implementation_skills,
    no_ai_certified_global = excluded.no_ai_certified_global, custom_fonts = excluded.custom_fonts;

  return jsonb_build_object('ok', true);
end;
$$;

-- payload : { socials: [{id, platform, url}, ...] } — remplace atomiquement la liste complète du
-- compositeur, même principe que pack_tracks/collection_packs (delete puis réinsertion).
create or replace function public.upsert_socials(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
  v_idx int := 0;
  v_item jsonb;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;

  delete from public.socials where owner_id = v_owner_id;
  for v_item in select * from jsonb_array_elements(coalesce(payload->'socials', '[]'::jsonb))
  loop
    insert into public.socials (id, owner_id, platform, url, position)
    values (v_item->>'id', v_owner_id, v_item->>'platform', coalesce(v_item->>'url',''), v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.upsert_settings(jsonb) to authenticated;
grant execute on function public.upsert_socials(jsonb) to authenticated;
