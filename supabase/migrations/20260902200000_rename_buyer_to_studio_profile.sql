-- LayerPitch — renomme buyer_profile → studio_profile (docs/infrastructure.md, Décision
-- complémentaire du 2 septembre) : le profil "Studio/Game dev" désigne à la fois l'usage déjà
-- construit (achat de packs, bibliothèque, Packs custom) et sa trajectoire future (Moodboard
-- Studios, vente d'OST) — un seul profil qui s'enrichit dans le temps, "buyer" ne reflète plus
-- son rôle réel une fois le flux d'inscription construit par-dessus.
--
-- Périmètre vérifié avant d'écrire cette migration (recherche exhaustive dans le code, pas une
-- supposition) : buyer_video_uploads, buyer_custom_packs, buyer_custom_pack_tracks,
-- buyer_custom_pack_sfx (décidées sur le papier le 31 août) n'ont jamais été migrées — rien
-- n'existe en base pour elles, donc rien à renommer ici. Elles seront créées directement sous le
-- nom studio_ le jour où ces chantiers seront construits.
--
-- pack_purchases.buyer_id / album_purchases.buyer_id référencent profiles(id) directement, pas
-- buyer_profiles(id) — un achat ne provisionne ni ne vérifie aujourd'hui de buyer_profile.
-- Comportement conservé à l'identique après renommage (studio_id référence toujours profiles(id))
-- pour ne rien casser dans le flux d'achat déjà fonctionnel et vérifié de bout en bout (pack.html
-- → create-checkout-session → stripe-webhook). Question ouverte, non tranchée ici : faire
-- provisionner un studio_profile à l'achat (comme ensure_composer_profile() le fait côté
-- compositeur) reste un choix produit pour Jules-Antoine, pas une décision prise unilatéralement.

alter table public.buyer_profiles rename to studio_profiles;

alter table public.pack_purchases rename column buyer_id to studio_id;
alter table public.album_purchases rename column buyer_id to studio_id;

drop policy "own buyer profile" on public.studio_profiles;
create policy "own studio profile" on public.studio_profiles for select using (auth.uid() = profile_id);

drop policy "own pack purchases" on public.pack_purchases;
create policy "own pack purchases" on public.pack_purchases for select using (auth.uid() = studio_id);

drop policy "own album purchases" on public.album_purchases;
create policy "own album purchases" on public.album_purchases for select using (auth.uid() = studio_id);

comment on table public.profiles is 'Une ligne par compte (Décision 4), sans rôle figé — un compte peut cumuler composer_profile et/ou studio_profile.';
