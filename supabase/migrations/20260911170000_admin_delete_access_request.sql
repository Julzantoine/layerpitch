-- LayerPitch — permet à un admin de supprimer une demande d'accès en attente (panneau backstage,
-- fieldset panelAccessRequests). Jusqu'ici la seule sortie de la liste était "Inviter" (marque
-- invited_at) -- rien ne permettait d'écarter une entrée doublon/spam/déjà traitée autrement,
-- alors que get_pending_access_requests() n'a pas de LIMIT et que la liste ne fait que grossir
-- (retour de Jules-Antoine le 11 septembre, plusieurs demandes de test à sa propre adresse dans
-- la liste). Même patron que mark_access_request_invited() : silencieux (return) pour un compte
-- non-admin plutôt qu'une erreur, is_admin() vérifié côté fonction.

create or replace function public.admin_delete_access_request(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  delete from public.access_requests where id = p_id;
end;
$$;
grant execute on function public.admin_delete_access_request(bigint) to authenticated;
