-- LayerPitch — achat réel d'un album (mode test Stripe pour l'instant), avec compte créé à l'achat (29/09).
--   * Feu vert 'album_checkout' (admin seulement pendant la bêta). album_checkout_status() : ouvert pour l'admin, ou pour tous
--     une fois le feu vert donné (un visiteur sans compte ne peut donc acheter qu'après ouverture générale).
--   * user_id_by_email(courriel) : pour l'Edge Function stripe-webhook, qui rattache l'achat d'un visiteur sans compte au compte
--     existant de cette adresse, ou en crée un (sans mot de passe : connexion par lien envoyé par e-mail).
insert into public.feature_flags (key, description) values
  ('album_checkout', 'Achat réel d''un album (Stripe, page /album/<id>), avec compte créé à l''achat. Admin seulement pendant la bêta : À OUVRIR APRÈS LES ESSAIS STRIPE.')
on conflict (key) do nothing;

create or replace function public.album_checkout_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('open', coalesce((select f.released from public.feature_flags f where f.key = 'album_checkout'), false)
                                    or (auth.uid() is not null and exists (select 1 from public.admins a where a.profile_id = auth.uid())));
$$;
grant execute on function public.album_checkout_status() to anon, authenticated;

create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;
revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;
