-- LayerPitch — Tchat par section (7 octobre, étape 3) : un canal de discussion par section, « type Discord », en plus du tchat général.
-- Le tchat général (project_messages) n'est pas touché : sa recherche, la cloche commune et la démo publique ne voient donc jamais les
-- messages des sections. Texte seulement pour l'instant (pas de pièces jointes dans les canaux de section).
-- Abonnement : tout le monde est prévenu sur le général ; un canal de section ne compte de « non lus » que pour ceux qui le suivent
-- (on suit un canal en y écrivant, ou avec la cloche). Supprimer une section supprime sa discussion (ses objets, eux, restent).
-- Même feu vert que les sections ('project_sections'). Tables fermées comme tout le Projet.

create table public.project_section_messages (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.project_sections(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index project_section_messages_idx on public.project_section_messages (section_id, created_at desc);
alter table public.project_section_messages enable row level security;
revoke all on public.project_section_messages from anon, authenticated;

-- Canaux suivis, et dernière lecture de chacun.
create table public.project_section_follows (
  section_id uuid not null references public.project_sections(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (section_id, profile_id)
);
alter table public.project_section_follows enable row level security;
revoke all on public.project_section_follows from anon, authenticated;

-- Messages d'un canal, du plus récent au plus ancien, par pages de 50 (p_before = date du plus ancien déjà affiché).
create or replace function public.list_section_messages(p_section_id uuid, p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'createdAt', m.created_at, 'authorId', m.author_id,
      'authorEmail', (select u.email from auth.users u where u.id = m.author_id), 'mine', m.author_id = auth.uid()) order by m.created_at desc), '[]'::jsonb)
    from (select * from public.project_section_messages where section_id = p_section_id and (p_before is null or created_at < p_before) order by created_at desc limit 50) m);
end;
$$;
grant execute on function public.list_section_messages(uuid, timestamptz) to authenticated;

-- Écrire dans un canal : on le suit aussitôt, et il est lu jusqu'ici pour soi.
create or replace function public.post_section_message(p_section_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id); v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  perform public.assert_project_sections_access(r.project_id);
  if v_body = '' then raise exception 'Message vide'; end if;
  if length(v_body) > 4000 then raise exception 'Message trop long (4000 caractères au plus)'; end if;
  insert into public.project_section_messages (section_id, author_id, body) values (p_section_id, auth.uid(), v_body) returning id into v_id;
  insert into public.project_section_follows (section_id, profile_id) values (p_section_id, auth.uid())
    on conflict (section_id, profile_id) do update set last_read_at = now();
  return v_id;
end;
$$;
grant execute on function public.post_section_message(uuid, text) to authenticated;

-- Supprimer un message : son auteur, ou l'administrateur du Projet.
create or replace function public.delete_section_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare m public.project_section_messages; r public.project_sections;
begin
  select * into m from public.project_section_messages where id = p_message_id;
  if not found then raise exception 'Message introuvable'; end if;
  r := public.project_section_row(m.section_id);
  perform public.assert_project_sections_access(r.project_id);
  if not (coalesce(m.author_id = auth.uid(), false) or public.project_role(r.project_id, auth.uid()) = 'admin') then raise exception 'Message introuvable'; end if;
  delete from public.project_section_messages where id = p_message_id;
end;
$$;
grant execute on function public.delete_section_message(uuid) to authenticated;

-- Suivre / ne plus suivre un canal.
create or replace function public.set_section_follow(p_section_id uuid, p_follow boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  if p_follow then
    insert into public.project_section_follows (section_id, profile_id) values (p_section_id, auth.uid()) on conflict do nothing;
  else
    delete from public.project_section_follows where section_id = p_section_id and profile_id = auth.uid();
  end if;
end;
$$;
grant execute on function public.set_section_follow(uuid, boolean) to authenticated;

-- « J'ai lu ce canal » (seulement s'il est suivi).
create or replace function public.mark_section_read(p_section_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.project_sections := public.project_section_row(p_section_id);
begin
  perform public.assert_project_sections_access(r.project_id);
  update public.project_section_follows set last_read_at = now() where section_id = p_section_id and profile_id = auth.uid();
end;
$$;
grant execute on function public.mark_section_read(uuid) to authenticated;

-- [{ sectionId, followed, unread }] : une ligne par canal que je suis ; unread = messages des autres depuis ma dernière lecture.
create or replace function public.section_chat_state(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_project_sections_access(p_project_id);
  return (select coalesce(jsonb_agg(jsonb_build_object('sectionId', f.section_id, 'followed', true,
      'unread', (select count(*) from public.project_section_messages m where m.section_id = f.section_id and m.author_id is distinct from auth.uid() and m.created_at > f.last_read_at))), '[]'::jsonb)
    from public.project_section_follows f join public.project_sections s on s.id = f.section_id
    where s.project_id = p_project_id and f.profile_id = auth.uid());
end;
$$;
grant execute on function public.section_chat_state(uuid) to authenticated;
