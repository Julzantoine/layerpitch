-- Import par assistant : un envoi interrompu ne doit plus bloquer le compte. Il comptait dans les 5 imports en attente pendant
-- 14 jours sans apparaître dans le Backstage (impossible à écarter).
--   1. list_my_pending_imports montre aussi les envois incomplets, avec leur état ;
--   2. assistant_cancel_import : le programme annule lui-même un envoi qui échoue (seulement tant qu'il est incomplet) ;
--   3. assistant_import_files_for_discard : les chemins à effacer quand le compositeur écarte un import, complet ou non.

create or replace function public.list_my_pending_imports()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'plan', p.plan, 'status', p.status, 'created_at', p.created_at, 'expires_at', p.expires_at,
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f->>'id', 'name', f->>'name', 'size', (f->>'size')::bigint)), '[]'::jsonb)
                from jsonb_array_elements(p.files) f)
  ) order by p.created_at desc), '[]'::jsonb)
  from public.pending_imports p
  where p.composer_id = public.current_composer_id() and p.status in ('uploading', 'ready') and p.expires_at > now();
$$;

-- Rend les chemins de l'import annulé, ou null s'il n'y avait rien à annuler (autre compte, import déjà complet…).
-- files_deleted_at reste vide : une adresse d'envoi encore valable (15 min) peut recréer un fichier, la purge repasse donc.
create or replace function public.assistant_cancel_import(p_composer uuid, p_import uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  update public.pending_imports set status = 'discarded', added_at = now()
   where id = p_import and composer_id = p_composer and status = 'uploading'
  returning files;
$$;

create or replace function public.assistant_import_files_for_discard(p_composer uuid, p_import uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.files from public.pending_imports p
                    where p.id = p_import and p.composer_id = p_composer and p.status in ('uploading', 'ready', 'failed')), '[]'::jsonb);
$$;

revoke all on function public.assistant_cancel_import(uuid, uuid), public.assistant_import_files_for_discard(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assistant_cancel_import(uuid, uuid), public.assistant_import_files_for_discard(uuid, uuid) to service_role;
