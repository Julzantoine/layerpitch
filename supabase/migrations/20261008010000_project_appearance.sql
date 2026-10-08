-- LayerPitch — Apparence d'un Projet (8 octobre) : comme le Backstage, un Projet peut avoir sa couleur de fond et son image de fond.
-- Réglage d'ÉQUIPE : choisi par l'administrateur du Projet, vu par tous les membres, qui peuvent préférer leur propre apparence (choix local,
-- par Projet, dans leur navigateur). Le thème Jour / Nuit reste personnel. L'image est réduite par le navigateur avant l'envoi et rangée ici
-- telle quelle (adresse de données, 600 000 caractères au plus) : pas de fichier ni d'URL signée à gérer.
-- Une seule ligne par Projet. Table fermée comme tout le Projet. Réservé à l'admin LayerPitch jusqu'au feu vert 'project_appearance'.
--   data = { bg: '#rrggbb' | null, image: 'data:image/(jpeg|webp|png);base64,…' | null, opacity: 0..100, fixed: bool }

create table public.project_appearance (
  project_id uuid primary key references public.projects(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.project_appearance enable row level security;
revoke all on public.project_appearance from anon, authenticated;

insert into public.feature_flags (key, description) values
  ('project_appearance', 'Apparence des Projets : couleur et image de fond d''équipe, au choix de chaque membre (8/10) — get/set_project_appearance.');

-- Droit commun : membre du Projet + feu vert (ou admin). Renvoie le rôle.
create or replace function public.assert_project_appearance_access(p_project_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text := public.assert_project_role(p_project_id);
begin
  if not public.feature_released('project_appearance', auth.uid()) then
    raise exception 'L''apparence des Projets n''est pas encore ouverte' using hint = 'locked';
  end if;
  return v_role;
end;
$$;
revoke execute on function public.assert_project_appearance_access(uuid) from public, anon, authenticated;

-- { bg, image, opacity, fixed, updatedAt } ; vide ({}) tant que l'administrateur n'a rien réglé.
create or replace function public.get_project_appearance(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_appearance_access(p_project_id);
  return coalesce((select a.data || jsonb_build_object('updatedAt', a.updated_at) from public.project_appearance a where a.project_id = p_project_id), '{}'::jsonb);
end;
$$;
grant execute on function public.get_project_appearance(uuid) to authenticated;

-- Règle l'apparence d'équipe (administrateur du Projet seulement). p vide ou null = on retire tout.
create or replace function public.set_project_appearance(p_project_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_bg text; v_img text; v_op int; v_data jsonb;
begin
  perform public.assert_project_appearance_access(p_project_id);
  perform public.assert_project_role(p_project_id, true);
  if p is null or p = '{}'::jsonb or p = 'null'::jsonb then
    delete from public.project_appearance where project_id = p_project_id;
    perform public.log_project_activity(p_project_id, 'appearance_changed', '{}'::jsonb);
    return;
  end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'Apparence invalide'; end if;
  v_bg := nullif(p->>'bg', '');
  if v_bg is not null and v_bg !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Couleur invalide (attendu : #rrggbb)'; end if;
  v_img := nullif(p->>'image', '');
  if v_img is not null and (v_img !~ '^data:image/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$' or length(v_img) > 600000) then raise exception 'Image invalide ou trop lourde (600 000 caractères au plus)'; end if;
  if p ? 'opacity' and p->'opacity' <> 'null'::jsonb and (jsonb_typeof(p->'opacity') <> 'number' or (p->>'opacity')::numeric < 0 or (p->>'opacity')::numeric > 100) then raise exception 'Opacité invalide (0 à 100)'; end if;
  v_op := coalesce(round((p->>'opacity')::numeric), 8);
  v_data := jsonb_build_object('bg', v_bg, 'image', v_img, 'opacity', v_op, 'fixed', coalesce((p->>'fixed')::boolean, true));
  insert into public.project_appearance (project_id, data, updated_by, updated_at) values (p_project_id, v_data, auth.uid(), now())
    on conflict (project_id) do update set data = excluded.data, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_project_activity(p_project_id, 'appearance_changed', '{}'::jsonb);
end;
$$;
grant execute on function public.set_project_appearance(uuid, jsonb) to authenticated;
