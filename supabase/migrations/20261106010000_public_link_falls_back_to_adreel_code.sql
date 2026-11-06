-- 06/11 : une adresse /<nom>/<x> dont <x> n'est ni un nom d'AdReel enregistré, ni un ancien nom, mène désormais à
-- l'AdReel dont le CODE est <x> (l'adresse « par code » existait déjà en ?adreel=<code>). Avant, elle renvoyait
-- silencieusement l'AdReel principal : un nom affiché dans le champ du Backstage mais jamais enregistré semblait « cassé ».
-- Ordre : nom actuel > ancien nom > code. Un code inconnu renvoie toujours adReelId null (AdReel principal).
create or replace function public.resolve_public_link(p_handle text, p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.resolve_composer_handle(p_handle);
  v_handle text;
  v_ar text;
  v_slug text := nullif(lower(trim(coalesce(p_slug, ''))), '');
begin
  if v_owner is null then return null; end if;
  select handle into v_handle from public.composer_profiles where id = v_owner;
  if v_slug is not null then
    select id into v_ar from public.ad_reels where owner_id = v_owner and slug = v_slug;
    if v_ar is null then
      select ad_reel_id into v_ar from public.ad_reel_slug_aliases where owner_id = v_owner and slug = v_slug;
    end if;
    if v_ar is null then
      select id into v_ar from public.ad_reels where owner_id = v_owner and lower(id) = v_slug;
    end if;
  end if;
  return jsonb_build_object(
    'ownerId', v_owner, 'handle', v_handle, 'adReelId', v_ar,
    'slug', (select slug from public.ad_reels where owner_id = v_owner and id = v_ar)
  );
end;
$$;
grant execute on function public.resolve_public_link(text, text) to anon, authenticated;
