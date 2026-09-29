-- LayerPitch — onglet « Ventes » (29/09) : le compositeur ou le studio voit ses ventes de packs et d'albums, en lecture seule.
-- Feu vert 'sales_tab' (admin seulement pendant la bêta). Pas d'identité d'acheteur (vie privée) : montants, dates, statuts.
--   * packs : achats des packs du compositeur ; sa part n'est connue que pour les prises en crédits (credit_payouts) ; pour un
--     achat payé, la part figure sur la facture (Documents).
--   * albums : achats des albums dont le compte est vendeur, plus ceux où il est bénéficiaire d'une part (album_payouts) ;
--     sa part et le statut du versement viennent d'album_payouts. Les achats de TEST sont listés mais exclus des totaux.
insert into public.feature_flags (key, description) values
  ('sales_tab', 'Onglet Ventes (Mon compte → Ventes), 29/09. Admin seulement pendant la bêta.')
on conflict (key) do nothing;

create or replace function public.my_sales(p_limit int default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_composer uuid; v_rows jsonb; v_open boolean;
begin
  if v_uid is null then raise exception 'Non autorisé : connexion requise'; end if;
  v_open := public.feature_released('sales_tab', v_uid);
  if not v_open then return jsonb_build_object('open', false); end if;
  select id into v_composer from public.composer_profiles where profile_id = v_uid;
  select coalesce(jsonb_agg(r order by d desc), '[]'::jsonb) into v_rows from (
    select d, r from (
    select pp.purchased_at as d, jsonb_build_object('kind', 'pack', 'title', k.title, 'purchasedAt', pp.purchased_at, 'grossCents', round(coalesce(pp.price_paid, 0) * 100)::int,
             'shareCents', cp.amount_cents, 'status', coalesce(cp.status, 'paid'), 'isTest', false,
             'invoice', (select i.invoice_number from public.invoices i where i.purchase_id = pp.id and i.composer_id = v_composer limit 1), 'source', pp.source) r
    from public.pack_purchases pp join public.packs k on k.id = pp.pack_id
    left join public.credit_payouts cp on cp.pack_purchase_id = pp.id
    where k.owner_id = v_composer and pp.studio_id <> v_uid
    union all
    select ap.purchased_at as d, jsonb_build_object('kind', 'album', 'title', a.title, 'purchasedAt', ap.purchased_at, 'grossCents', round(coalesce(ap.price_paid, 0) * 100)::int,
             'shareCents', (select sum(p.amount_cents)::int from public.album_payouts p where p.album_purchase_id = ap.id and p.beneficiary_profile_id = v_uid),
             'status', coalesce((select min(p.status) from public.album_payouts p where p.album_purchase_id = ap.id and p.beneficiary_profile_id = v_uid), case when ap.is_test then 'test' else 'pending' end),
             'isTest', ap.is_test,
             'invoice', (select i.invoice_number from public.invoices i where i.album_purchase_id = ap.id and i.beneficiary_profile_id = v_uid limit 1), 'source', 'album')
    from public.album_purchases ap join public.albums a on a.id = ap.album_id
    where a.seller_id = v_uid or exists (select 1 from public.album_payouts p where p.album_purchase_id = ap.id and p.beneficiary_profile_id = v_uid)
    ) u order by d desc limit least(greatest(coalesce(p_limit, 200), 1), 500)) s;
  return jsonb_build_object('open', true, 'rows', v_rows,
    'totals', jsonb_build_object(
      'count', (select count(*) from jsonb_array_elements(v_rows) e where not (e->>'isTest')::boolean),
      'grossCents', coalesce((select sum((e->>'grossCents')::int) from jsonb_array_elements(v_rows) e where not (e->>'isTest')::boolean), 0),
      'shareCents', coalesce((select sum((e->>'shareCents')::int) from jsonb_array_elements(v_rows) e where not (e->>'isTest')::boolean and e->>'shareCents' is not null), 0)));
end;
$$;
revoke execute on function public.my_sales(int) from public, anon;
grant execute on function public.my_sales(int) to authenticated;
