-- Carte de niveau : le nœud « Transition » (8/10). Un nouvel élément « transition » : on ne s'y arrête pas, on le traverse en se baladant ;
-- le lecteur joue alors son fichier de transition (réglé comme la transition d'un élément : style, durée, repère, fichier).
-- Seule la validation change : la liste des types d'éléments acceptés gagne « transition » ; tout le reste de la fonction est identique
-- à 20261008020000. Les cartes existantes ne sont pas touchées.
create or replace function public.validate_project_map(p_project_id uuid, p_data jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare n jsonb; e jsonb; v_ids text[] := '{}'; v_edge_ids text[] := '{}'; v_starts int := 0;
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
end;
$$;
revoke execute on function public.validate_project_map(uuid, jsonb) from public, anon, authenticated;
