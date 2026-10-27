-- Carte de niveau : le monde ouvert (27/10). Une carte peut maintenant avoir :
--   zones      : [{ id, label, note, shape: 'rect'|'ellipse'|'poly', x, y, w, h | points: [{ x, y }], color, keepMusic, sounds, altName,
--                   altTransition, transition, link }] -- des régions dessinées, chacune avec sa musique (100 au plus) ;
--   modes      : [{ id, label, speed, sounds, transition }] -- les déplacements de la balade libre (à pied, cheval…), 8 au plus ;
--   background : { kind: 'asset', id, title, x, y, w, h, opacity } | null -- une image du Projet sous la carte ;
--   node.link, zone.link : l'id d'une autre carte du même Projet (la sous-carte : le château dans le monde) ;
--   node.radius : le rayon du cercle de proximité d'un élément pendant la balade libre (20 à 2000).
-- Tout le reste de validate_project_map est identique à 20261008030000. Les cartes existantes ne sont pas touchées.
-- Une sous-carte supprimée : delete_project_map retire aussi les liens qui y menaient (sinon les autres cartes porteraient un lien mort).

-- Lien vers une sous-carte : un identifiant de carte ; s'il existe, la carte doit être dans le même Projet. Un lien vers une carte qui
-- n'existe plus est toléré (l'éditeur l'affiche « carte introuvable ») : sinon la suppression d'une carte par un membre empêcherait un
-- autre membre, dont l'éditeur était ouvert, d'enregistrer la sienne.
create or replace function public.validate_map_link(p_project_id uuid, l jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if l is null or l = 'null'::jsonb then return; end if;
  if jsonb_typeof(l) <> 'string' then raise exception 'Lien de sous-carte invalide'; end if;
  begin v_id := (l #>> '{}')::uuid; exception when others then raise exception 'Lien de sous-carte invalide'; end;
  if exists (select 1 from public.project_maps m where m.id = v_id and m.project_id <> p_project_id) then
    raise exception 'Une sous-carte doit être une carte de ce Projet';
  end if;
end;
$$;
revoke execute on function public.validate_map_link(uuid, jsonb) from public, anon, authenticated;

create or replace function public.validate_project_map(p_project_id uuid, p_data jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare n jsonb; e jsonb; z jsonb; m jsonb; pt jsonb; bg jsonb; v_ids text[] := '{}'; v_edge_ids text[] := '{}'; v_zone_ids text[] := '{}'; v_mode_ids text[] := '{}'; v_starts int := 0; v_asset uuid;
begin
  if jsonb_typeof(p_data) <> 'object' or jsonb_typeof(p_data->'nodes') <> 'array' or jsonb_typeof(p_data->'edges') <> 'array' then raise exception 'Carte invalide'; end if;
  if pg_column_size(p_data) > 400000 then raise exception 'Carte trop volumineuse'; end if;
  if jsonb_array_length(p_data->'nodes') > 300 or jsonb_array_length(p_data->'edges') > 600 then raise exception 'Carte trop grande (300 éléments et 600 parcours au plus)'; end if;
  -- Réglages de la carte : fond d'ambiance (un son + niveau en dB) et transition par défaut.
  if p_data ? 'roomTone' and p_data->'roomTone' <> 'null'::jsonb then perform public.validate_map_ref(p_project_id, p_data->'roomTone'); end if;
  if p_data ? 'roomToneDb' and p_data->'roomToneDb' <> 'null'::jsonb and (jsonb_typeof(p_data->'roomToneDb') <> 'number' or (p_data->>'roomToneDb')::numeric < -60 or (p_data->>'roomToneDb')::numeric > 0) then
    raise exception 'Niveau du fond d''ambiance invalide (-60 à 0 dB)';
  end if;
  if p_data ? 'defaults' and p_data->'defaults' <> 'null'::jsonb then
    if jsonb_typeof(p_data->'defaults') <> 'object' then raise exception 'Réglages invalides'; end if;
    perform public.validate_map_transition(p_project_id, p_data->'defaults'->'transition');
  end if;
  for n in select * from jsonb_array_elements(p_data->'nodes') loop
    if coalesce(n->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'Identifiant d''élément invalide'; end if;
    if n->>'id' = any (v_ids) then raise exception 'Identifiant d''élément en double'; end if;
    v_ids := v_ids || (n->>'id');
    if coalesce(n->>'type', '') not in ('start', 'place', 'quest', 'boss', 'npc', 'treasure', 'junction', 'transition') then raise exception 'Type d''élément inconnu (%)', n->>'type'; end if;
    if n->>'type' = 'start' then v_starts := v_starts + 1; end if;
    if jsonb_typeof(n->'x') <> 'number' or jsonb_typeof(n->'y') <> 'number' then raise exception 'Position invalide'; end if;
    if length(coalesce(n->>'label', '')) > 120 or length(coalesce(n->>'note', '')) > 2000 then raise exception 'Texte trop long'; end if;
    perform public.validate_map_sounds(p_project_id, n->'sounds');
    if length(coalesce(n->>'altName', '')) > 60 then raise exception 'Nom de la 2e musique trop long (60 caractères au plus)'; end if;
    if n ? 'altTransition' and n->'altTransition' <> 'null'::jsonb then perform public.validate_map_ref(p_project_id, n->'altTransition'); end if;
    perform public.validate_map_transition(p_project_id, n->'transition');
    if n ? 'anchor' and n->'anchor' <> 'null'::jsonb and coalesce(n->'anchor'->>'kind', '') not in ('node', 'edge') then raise exception 'Accroche invalide'; end if;
    perform public.validate_map_link(p_project_id, n->'link');
    if n ? 'radius' and n->'radius' <> 'null'::jsonb and (jsonb_typeof(n->'radius') <> 'number' or (n->>'radius')::numeric < 20 or (n->>'radius')::numeric > 2000) then
      raise exception 'Cercle de proximité invalide (20 à 2000)';
    end if;
  end loop;
  if v_starts > 1 then raise exception 'Une carte n''a qu''un seul début de niveau'; end if;
  for e in select * from jsonb_array_elements(p_data->'edges') loop
    if coalesce(e->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'Identifiant de parcours invalide'; end if;
    if e->>'id' = any (v_edge_ids) then raise exception 'Identifiant de parcours en double'; end if;
    v_edge_ids := v_edge_ids || (e->>'id');
    if not ((e->>'from') = any (v_ids) and (e->>'to') = any (v_ids)) or e->>'from' = e->>'to' then raise exception 'Un parcours relie deux éléments qui n''existent pas'; end if;
    if length(coalesce(e->>'label', '')) > 120 then raise exception 'Texte trop long'; end if;
    perform public.validate_map_sounds(p_project_id, e->'sounds');
    if length(coalesce(e->>'altName', '')) > 60 then raise exception 'Nom de la 2e musique trop long (60 caractères au plus)'; end if;
    if e ? 'altTransition' and e->'altTransition' <> 'null'::jsonb then perform public.validate_map_ref(p_project_id, e->'altTransition'); end if;
    perform public.validate_map_transition(p_project_id, e->'transition');
  end loop;
  -- Une accroche (quête annexe) doit viser un élément ou un parcours de la même carte.
  for n in select * from jsonb_array_elements(p_data->'nodes') loop
    if n ? 'anchor' and n->'anchor' <> 'null'::jsonb then
      if not ((n->'anchor'->>'kind' = 'node' and (n->'anchor'->>'id') = any (v_ids) and (n->'anchor'->>'id') <> n->>'id')
              or (n->'anchor'->>'kind' = 'edge' and (n->'anchor'->>'id') = any (v_edge_ids))) then
        raise exception 'Une quête annexe est accrochée à quelque chose qui n''existe pas';
      end if;
    end if;
  end loop;

  -- Zones (monde ouvert)
  if p_data ? 'zones' and p_data->'zones' <> 'null'::jsonb then
    if jsonb_typeof(p_data->'zones') <> 'array' then raise exception 'Zones invalides'; end if;
    if jsonb_array_length(p_data->'zones') > 100 then raise exception 'Trop de zones (100 au plus)'; end if;
    for z in select * from jsonb_array_elements(p_data->'zones') loop
      if jsonb_typeof(z) <> 'object' or coalesce(z->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'Identifiant de zone invalide'; end if;
      if z->>'id' = any (v_zone_ids) then raise exception 'Identifiant de zone en double'; end if;
      v_zone_ids := v_zone_ids || (z->>'id');
      if coalesce(z->>'shape', '') not in ('rect', 'ellipse', 'poly') then raise exception 'Forme de zone inconnue (%)', z->>'shape'; end if;
      if z->>'shape' = 'poly' then
        if jsonb_typeof(z->'points') <> 'array' or jsonb_array_length(z->'points') < 3 or jsonb_array_length(z->'points') > 64 then raise exception 'Forme libre invalide (3 à 64 points)'; end if;
        for pt in select * from jsonb_array_elements(z->'points') loop
          if jsonb_typeof(pt) <> 'object' or jsonb_typeof(pt->'x') <> 'number' or jsonb_typeof(pt->'y') <> 'number' then raise exception 'Position invalide'; end if;
        end loop;
      else
        if jsonb_typeof(z->'x') <> 'number' or jsonb_typeof(z->'y') <> 'number' or jsonb_typeof(z->'w') <> 'number' or jsonb_typeof(z->'h') <> 'number' then raise exception 'Position invalide'; end if;
        if (z->>'w')::numeric <= 0 or (z->>'h')::numeric <= 0 or (z->>'w')::numeric > 100000 or (z->>'h')::numeric > 100000 then raise exception 'Taille de zone invalide'; end if;
      end if;
      if length(coalesce(z->>'label', '')) > 120 or length(coalesce(z->>'note', '')) > 2000 then raise exception 'Texte trop long'; end if;
      if z ? 'color' and z->'color' <> 'null'::jsonb and coalesce(z->>'color', '') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Couleur de zone invalide'; end if;
      if z ? 'keepMusic' and jsonb_typeof(z->'keepMusic') not in ('boolean', 'null') then raise exception 'Réglage de zone invalide'; end if;
      perform public.validate_map_sounds(p_project_id, z->'sounds');
      if length(coalesce(z->>'altName', '')) > 60 then raise exception 'Nom de la 2e musique trop long (60 caractères au plus)'; end if;
      if z ? 'altTransition' and z->'altTransition' <> 'null'::jsonb then perform public.validate_map_ref(p_project_id, z->'altTransition'); end if;
      perform public.validate_map_transition(p_project_id, z->'transition');
      perform public.validate_map_link(p_project_id, z->'link');
    end loop;
  end if;

  -- Modes de déplacement (balade libre)
  if p_data ? 'modes' and p_data->'modes' <> 'null'::jsonb then
    if jsonb_typeof(p_data->'modes') <> 'array' then raise exception 'Déplacements invalides'; end if;
    if jsonb_array_length(p_data->'modes') > 8 then raise exception 'Trop de déplacements (8 au plus)'; end if;
    for m in select * from jsonb_array_elements(p_data->'modes') loop
      if jsonb_typeof(m) <> 'object' or coalesce(m->>'id', '') !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'Identifiant de déplacement invalide'; end if;
      if m->>'id' = any (v_mode_ids) then raise exception 'Identifiant de déplacement en double'; end if;
      v_mode_ids := v_mode_ids || (m->>'id');
      if length(coalesce(m->>'label', '')) > 60 then raise exception 'Nom de déplacement trop long (60 caractères au plus)'; end if;
      if jsonb_typeof(m->'speed') <> 'number' or (m->>'speed')::numeric < 20 or (m->>'speed')::numeric > 1500 then raise exception 'Vitesse de déplacement invalide (20 à 1500)'; end if;
      perform public.validate_map_sounds(p_project_id, m->'sounds');
      perform public.validate_map_transition(p_project_id, m->'transition');
    end loop;
  end if;

  -- Image de fond : une image de ce Projet.
  bg := p_data->'background';
  if bg is not null and bg <> 'null'::jsonb then
    if jsonb_typeof(bg) <> 'object' or coalesce(bg->>'kind', '') <> 'asset' then raise exception 'Image de fond invalide'; end if;
    begin v_asset := (bg->>'id')::uuid; exception when others then raise exception 'Image de fond invalide'; end;
    if not exists (select 1 from public.project_assets a where a.id = v_asset and a.project_id = p_project_id and a.kind = 'image') then
      raise exception 'L''image de fond n''est pas une image de ce Projet';
    end if;
    if jsonb_typeof(bg->'x') <> 'number' or jsonb_typeof(bg->'y') <> 'number' or jsonb_typeof(bg->'w') <> 'number' or jsonb_typeof(bg->'h') <> 'number'
       or (bg->>'w')::numeric <= 0 or (bg->>'h')::numeric <= 0 or (bg->>'w')::numeric > 100000 or (bg->>'h')::numeric > 100000 then
      raise exception 'Position de l''image de fond invalide';
    end if;
    if bg ? 'opacity' and bg->'opacity' <> 'null'::jsonb and (jsonb_typeof(bg->'opacity') <> 'number' or (bg->>'opacity')::numeric < 0.1 or (bg->>'opacity')::numeric > 1) then
      raise exception 'Opacité de l''image de fond invalide';
    end if;
    if length(coalesce(bg->>'title', '')) > 120 then raise exception 'Texte trop long'; end if;
  end if;
end;
$$;
revoke execute on function public.validate_project_map(uuid, jsonb) from public, anon, authenticated;

-- Supprimer une carte retire aussi les liens « mène à une sous-carte » qui y menaient, dans les autres cartes du Projet.
create or replace function public.delete_project_map(p_map_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.project_maps where id = p_map_id;
  if not found then raise exception 'Carte introuvable'; end if;
  perform public.assert_project_map_access(r.project_id);
  delete from public.project_maps where id = p_map_id;
  update public.project_maps m set data = jsonb_set(
      jsonb_set(m.data, '{nodes}', (select coalesce(jsonb_agg(case when x->>'link' = p_map_id::text then x - 'link' else x end order by o), '[]'::jsonb)
                                    from jsonb_array_elements(m.data->'nodes') with ordinality t(x, o))),
      '{zones}', (select coalesce(jsonb_agg(case when x->>'link' = p_map_id::text then x - 'link' else x end order by o), '[]'::jsonb)
                  from jsonb_array_elements(coalesce(m.data->'zones', '[]'::jsonb)) with ordinality t(x, o)))
  where m.project_id = r.project_id and position(p_map_id::text in m.data::text) > 0;
  perform public.log_project_activity(r.project_id, 'map_deleted', jsonb_build_object('title', r.title));
end;
$$;
grant execute on function public.delete_project_map(uuid) to authenticated;
