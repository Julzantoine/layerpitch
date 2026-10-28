-- LayerPitch — seul l'AdReel principal est visible sur Google par défaut (27/10, chantier SEO, décision de Jules-Antoine).
--
-- La case « Indexable par les moteurs de recherche » (ad_reels.allow_indexing, migration 20260916050000) était cochée par défaut
-- sur tous les AdReels. Or les AdReels secondaires sont souvent des démos préparées pour un seul prospect (« for-phil »…) :
-- depuis que le Worker Cloudflare sert les AdReels cochés à Google (20261027020000), ils deviendraient trouvables.
-- Ici : tous les AdReels existants SAUF le principal ('main') sont décochés. Un principal que son compositeur avait décoché
-- reste décoché. Les nouveaux AdReels démarrent décochés côté Backstage (15-selecteur-de-morceaux.js) ; le compositeur coche
-- ceux qu'il veut montrer. Aucune colonne ni fonction modifiée.

update public.ad_reels set allow_indexing = false where id <> 'main' and allow_indexing;
