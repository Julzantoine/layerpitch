-- LayerPitch — crée automatiquement une ligne public.profiles pour chaque nouveau compte
-- (auth.users). Trouvé manquant en testant l'étape 4 (achat) : pack_purchases.buyer_id référence
-- profiles(id), mais rien ne créait jamais cette ligne au moment de l'inscription (Décision 4 dit
-- "profiles — une ligne par compte", mais le mécanisme lui-même n'avait jamais été construit —
-- pattern standard Supabase absent depuis l'étape 3).
--
-- Backfill inclus pour le compte déjà existant (créé lors des tests de l'étape 2, avant ce
-- correctif).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
