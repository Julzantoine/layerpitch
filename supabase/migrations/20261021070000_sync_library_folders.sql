-- Dossiers de la bibliothèque (morceaux, Sfx, AdReels) : jusqu'ici jamais écrits en base par la sauvegarde du Backstage.
-- Un dossier créé n'existait que dans le navigateur ; les éléments rangés dedans étaient refusés (dossier inconnu) et le
-- tout disparaissait au rechargement (21/10). sync_my_folders() reçoit la liste complète et ordonnée des dossiers d'un
-- type pour le compositeur courant : crée/renomme/réordonne, supprime ceux qui ne sont plus dans la liste (leurs éléments
-- repassent à la racine, on delete set null).

alter table public.track_folders add column if not exists position int not null default 0;
alter table public.sfx_folders add column if not exists position int not null default 0;
alter table public.ad_reel_folders add column if not exists position int not null default 0;

create or replace function public.sync_my_folders(p_kind text, p_folders jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.current_composer_id();
  v_table text;
  v_f jsonb;
  v_ids text[] := '{}';
  v_pos int := 0;
  v_other uuid;
begin
  if v_owner is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  v_table := case p_kind when 'tracks' then 'track_folders' when 'sfx' then 'sfx_folders' when 'adreels' then 'ad_reel_folders' end;
  if v_table is null then
    raise exception 'Type de dossier inconnu : %', p_kind;
  end if;
  if p_folders is null or jsonb_typeof(p_folders) <> 'array' then
    raise exception 'Liste de dossiers invalide';
  end if;

  for v_f in select * from jsonb_array_elements(p_folders) loop
    if coalesce(v_f->>'id', '') = '' then
      raise exception 'Dossier sans identifiant';
    end if;
    execute format('select owner_id from public.%I where id = $1', v_table) into v_other using v_f->>'id';
    if v_other is not null and v_other <> v_owner then
      raise exception 'Non autorisé : ce dossier appartient à un autre compositeur';
    end if;
    execute format(
      'insert into public.%I (id, owner_id, label, position) values ($1, $2, $3, $4)
       on conflict (id) do update set label = excluded.label, position = excluded.position',
      v_table
    ) using v_f->>'id', v_owner, coalesce(v_f->>'label', ''), v_pos;
    v_ids := v_ids || (v_f->>'id');
    v_pos := v_pos + 1;
  end loop;

  execute format('delete from public.%I where owner_id = $1 and not (id = any($2))', v_table) using v_owner, v_ids;
end;
$$;

grant execute on function public.sync_my_folders(text, jsonb) to authenticated;
