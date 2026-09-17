-- LayerPitch — permet à l'admin d'effacer une ligne du panneau "Invitations envoyées" (17
-- septembre). Suppression libre (en attente ou inscrit·e) -- ce panneau est un outil de suivi
-- personnel pour Jules-Antoine, pas un historique légal à préserver ; il doit pouvoir le nettoyer
-- comme il veut (doublons de test, entrées obsolètes). Même patron que
-- admin_delete_access_request() (20260911170000).

create or replace function public.delete_invite(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then return; end if;
  delete from public.invites where id = p_id;
end;
$$;
grant execute on function public.delete_invite(bigint) to authenticated;
