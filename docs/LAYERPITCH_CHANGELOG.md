# LayerPitch — Changelog technique

Journal des modifications de code et sessions de débogage. Entrées classées de la plus récente à la plus ancienne. Chaque entrée liste les fichiers touchés, le contexte, le diagnostic (si débogage) et le changement effectué.

*Ce document a été reconstitué le 28 juillet 2026 à partir de cinq fichiers de changelog partiels retrouvés dans le projet (le fichier global ayant été accidentellement écrasé par une version antérieure) : `LAYERPITCH_CHANGELOG_25_JUILLET.md`, `LAYERPITCH_CHANGELOG_20_JUILLET.md`, `LAYERPITCH_CHANGELOG_SESSION_18_JUILLET.md`, `LAYERPITCH_CHANGELOG_CETTE_SESSION.md` (session du 16 juillet) et la version encore présente de `LAYERPITCH_CHANGELOG.md` (01 → 16 juillet). Les doublons entre fichiers ont été fusionnés (notamment l'entrée du 16 juillet sur la collision `t`, présente à l'identique dans deux sources).*

*Note du 30 juillet 2026 (obsolète) : ce fichier avait été déplacé à la racine du dépôt pour simplifier la publication. Remis dans `docs/` le 6 août 2026 — c'est son emplacement actuel.*

---

## [2026-09-04e] — Rétablit l'upload média pour les compositeurs non-admin

**Fichiers touchés** : `layerpitch-backstage.html`, nouveau `supabase/functions/create-media-signed-url/index.ts`.

**Contexte** : conséquence directe de [2026-09-04d] (masquage du panneau "Stockage média"), acceptée à ce moment-là comme lacune ouverte plutôt que résolue dans l'urgence. Jules-Antoine a demandé de la combler avant de passer à la suite.

**Changement** :
- Nouvelle Edge Function `create-media-signed-url` : vérifie l'identité du compositeur (`ensure_composer_profile()`) puis génère une URL R2 pré-signée à courte durée de vie (5 minutes, `aws4fetch`, même mécanisme que `get-invoice-download-url` — `X-Amz-Expires` posé avant signature, sinon 24h par défaut) pour un seul objet et un seul verbe (PUT ou DELETE). Chemin validé (préfixe `images/`/`audio/` uniquement, pas de remontée de répertoire) mais **pas d'entité vérifiée propriétaire de l'appelant** — lacune connue, notée ci-dessous.
- `r2PutFile()`/`r2DeleteFile()` (`layerpitch-backstage.html`) basculent automatiquement sur ce chemin dès qu'aucun identifiant R2 local n'est saisi (cas de tout compositeur non-admin depuis [2026-09-04d]) — aucun des 19 points d'appel existants n'a dû changer, le repli est interne aux deux fonctions.

**Lacune restante, documentée plutôt que devinée** : le chemin R2 demandé n'est pas vérifié comme appartenant réellement au compositeur appelant (juste son préfixe) — un compositeur qui connaîtrait/devinerait l'identifiant d'AdReel/morceau d'un autre pourrait théoriquement écraser son fichier média. Amélioration nette malgré tout : avant ce chantier, chaque testeur détenait la clé secrète complète du bucket R2 entier (lecture/écriture/suppression de tout, y compris `data.json`/`player.js`), pas seulement d'un objet précis à la fois. À durcir (vérification `owner_id` par type d'entité) si un abus réel est constaté.

---

## [2026-09-04d] — Masque les panneaux admin/debug du backstage pour les non-admins

**Fichiers touchés** : `layerpitch-backstage.html`.

**Contexte** : signalé par Jules-Antoine avant de s'absenter, sujet déjà documenté (`docs/infrastructure.md`, "À trancher") — les panneaux "Dépôt GitHub" (token), "Lecture/Écriture Postgres (test)", "Inviter un testeur (admin)" et "Stockage média (Cloudflare R2)" étaient visibles à quiconque atteint la page, seule la liste d'emails Cloudflare Access limitant qui l'atteint. Le mécanisme `admins`/`is_admin()` existait déjà (1er septembre, utilisé par `admin.html`) mais n'était jamais branché à l'affichage de ces panneaux.

**Vérifié avant de masquer, pas supposé** : `publishAll()` a déjà (2 septembre) un repli "compositeur hébergé sans repo GitHub personnel → écriture Postgres forcée, indépendamment de la case #pgWriteToggle". Aucun repli équivalent côté lecture n'existait — `pgReadEnabled()` dépendait uniquement de la case #pgReadToggle. Masquer #panelPgRead sans corriger ça aurait laissé la bibliothèque d'un compositeur hébergé vide au premier chargement (plus aucun moyen d'activer la case, invisible). Pire : masquer #panelPgWrite/#panelGithubRepo aurait aussi supprimé l'unique déclencheur de chargement des scripts Postgres pour un compositeur n'ayant jamais coché ces cases — cassant silencieusement tous les autres panneaux (abonnement, facturation, Connect) faute d'un autre point d'entrée.

**Changement** :
- `pgReadEnabled()` corrigé pour appliquer le même repli que `publishAll()` : bascule automatique sur Postgres si `state.token()` est vide, indépendamment de la case.
- Six panneaux (`panelGithubRepo`, `panelPgRead`, `panelPgWrite`, `panelInviteTester`, `panelR2Storage`, `panelAdminLink`) portent désormais `hidden` par défaut, retiré uniquement si `is_admin()` renvoie vrai (`renderAdminOnlyPanels()`, même vérification client que `admin.html` — confort d'affichage, la vraie barrière reste côté serveur, RLS/RPC).

**Conséquence à surveiller, pas résolue ici** : les identifiants R2 (`Stockage média`) sont aujourd'hui le seul moyen d'uploader un logo/photo/image de fond ou un nouveau fichier audio — masqués, un compositeur non-admin ne peut plus le faire (pas de repli serveur existant, contrairement à GitHub/Postgres). Accepté tel quel sur demande explicite de Jules-Antoine, à rouvrir s'il veut que les testeurs puissent uploader leurs propres médias avant l'ouverture réelle.

---

## [2026-09-04c] — Stripe Connect compositeur + facturation légale automatisée

**Fichiers touchés** : nouveaux `supabase/migrations/20260904120000_composer_stripe_connect.sql`, `20260904130000_composer_billing_profile.sql`, `supabase/functions/create-connect-onboarding-link/index.ts`, `supabase/functions/get-invoice-download-url/index.ts`, `api/connect.js`, `api/invoices.js` ; `supabase/functions/create-checkout-session/index.ts`, `supabase/functions/stripe-webhook/index.ts`, `api/purchases.js`, `layerpitch-backstage.html`.

**Contexte** : question de Jules-Antoine sur le fonctionnement réel de la commission par palier (`plan_quotas.commission_rate`, posée le 3 septembre, jamais lue par aucun code de paiement — vérifié). Recherche du modèle Bandcamp (Stripe Connect Standard, l'artiste crée/relie son propre compte, aucune facture émise par la plateforme) + comparaison eBay/Amazon Marketplace/Leboncoin Pro (modèle "agence", mandat de facturation) vs Etsy (contre-exemple : TVA absente des documents, vendeurs contraints de tout reconstruire) a mené à une architecture en deux volets, actée en plan-mode avec Jules-Antoine.

**Versement (Stripe Connect Standard, charges de destination)** :
- `composer_profiles.stripe_connect_account_id`/`charges_enabled`/`payouts_enabled`. `stripe_connect_account_id` est la seule exception au principe "webhook seul écrivain de l'état Stripe dérivé" (aucun événement webhook n'existe pour "un compte vient d'être créé") — les deux booléens restent, eux, écrits uniquement par `stripe-webhook` (`account.updated`).
- `create-checkout-session` : commission calculée via `effective_plan_quotas()` (jamais `plan_quotas.commission_rate` en direct, pour respecter les dérogations essai/admin/étudiant déjà en place), `application_fee_amount`/`transfer_data.destination` sur la Checkout Session. Achat bloqué sans repli si le compositeur n'a pas de compte Connect actif.
- `stripe-webhook` : second secret de signature (`STRIPE_CONNECT_WEBHOOK_SECRET`) essayé en repli du premier — Stripe exige deux endpoints séparés (portées différentes) pour recevoir les événements "compte" et "Connect", mais les deux peuvent pointer vers cette même fonction.

**Facturation légale (mandat de facturation, art. 289 CGI — LayerPitch mandataire, le compositeur reste seul redevable de la TVA)** :
- Profil de facturation déclaratif sur `composer_profiles` (statut pro/particulier, SIRET, TVA) — déclaratif plutôt que lu depuis l'API Stripe Connect : pour un compte Standard, la plateforme perd l'accès à l'objet `persons` une fois l'onboarding lancé, et la lisibilité de `business_profile`/`company` dans ce cas n'est pas garantie avec certitude par la documentation Stripe.
- Nouvelle table `invoices` (snapshot vendeur/acheteur au moment de la vente, jamais un JOIN vivant — l'identité légale peut changer après coup, le document doit rester figé). Numérotation séquentielle **par compositeur** (`next_invoice_number()`, `UPDATE ... RETURNING` atomique), cohérent avec la pratique du mandat de facturation.
- `stripe-webhook` génère la facture/attestation de vente (`pdf-lib`) après un achat réellement nouveau (jamais sur un renvoi Stripe du même événement — vérifié via le retour de l'upsert `pack_purchases`, `RETURNING` ne renvoie rien sur un conflit ignoré), upload R2, sans jamais faire échouer le webhook si la génération échoue (paiement acquis malgré tout, erreur seulement loggée).
- Calcul de TVA volontairement simplifié (France 20% par défaut, autoliquidation B2B intracommunautaire si TVA acheteur présente, exonération hors UE — pas de validation VIES, pas de taux OSS par pays de destination) : à valider par un expert-comptable avant toute mise en production réelle, explicitement noté comme tel dans le code.
- Nouvelle Edge Function `get-invoice-download-url` : les factures portent des données personnelles réelles — jamais d'URL R2 publique permanente comme pour les médias (sécurité par obscurité jugée insuffisante ici). Vérifie l'autorisation via la RLS de la table `invoices` (le client appelant fait le SELECT, pas `service_role`) puis génère un lien R2 pré-signé de 5 minutes (`aws4fetch`, `X-Amz-Expires` posé avant signature — le défaut de la librairie est 24h, bien trop long pour ce cas).
- `api/purchases.js` : `myPurchases()` embarque désormais la facture liée ; `buyPack()` corrigé pour afficher le vrai message d'erreur (même correctif que `invite-tester`, le SDK masque le corps JSON d'une Edge Function en échec derrière un message générique).

**Non couvert ici, à dessein** : remboursements (`reverse_transfer`/facture rectificative — aucun flux de remboursement n'existe nulle part dans ce projet, pas un manque introduit ici) ; bascule de `PURCHASES_ENABLED` (reste une décision séparée, prix des packs encore des valeurs de test) ; `account.application.deauthorized` (compositeur qui déconnecte son compte Stripe) ; DAC7 et facturation électronique structurée (Factur-X), différées à un volume réel de ventes / à l'approche de l'échéance réglementaire de 2027 ; validation experte du montage mandat de facturation avant production réelle.

**Vérifié** : migrations appliquées, 4 fonctions Edge déployées et testées par Jules-Antoine en mode test réel — essai reverse trial affiché correctement pour la partie abonnement (chantier voisin), reste à tester en conditions réelles côté Connect/facturation (`PURCHASES_ENABLED` à activer temporairement en local pour ce test, pas encore fait au moment de cette entrée).

---

## [2026-09-04b] — Coordination Cloudflare Access / invitation testeur

**Fichiers touchés** : `supabase/functions/invite-tester/index.ts`, `layerpitch-backstage.html`.

**Contexte** : signalé par Jules-Antoine — un testeur invité via le panneau "Inviter un testeur" (compte Supabase + lien magique) mais absent de la liste d'emails Cloudflare Access (docs/infrastructure.md, Partie C) reste bloqué au mur Cloudflare et ne peut jamais utiliser son lien. Les deux barrières étaient jusqu'ici totalement indépendantes, sans aucun rappel dans l'outil. Deux options présentées (automatisation vs simple rappel manuel), automatisation retenue.

**Changement** :
- `invite-tester` (Edge Function) appelle désormais l'API Cloudflare (`addEmailToCloudflareAccess()`) pour ajouter l'email à la policy Access réutilisable "Backstage — accès compositeur" *avant* d'envoyer l'invitation Supabase. Idempotent (vérifie d'abord si l'email figure déjà dans `include`). Ce compte Cloudflare utilise le modèle "Access controls > Policies" (policy réutilisable, pas imbriquée dans une Application) — endpoint `/accounts/{id}/access/policies/{policy_id}`, pas `/access/apps/{app_id}/policies`. Nouveaux secrets requis côté Supabase : `CLOUDFLARE_API_TOKEN` (scope "Access: Apps and Policies", jamais "Full access"), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_POLICY_ID`.
- Non bloquant à dessein : si l'appel Cloudflare échoue (secrets absents, jeton expiré, API en panne...), l'invitation Supabase part quand même — comportement jamais pire qu'avant. L'échec est renvoyé via `cloudflareWarning` dans la réponse plutôt qu'avalé silencieusement.
- Backstage : l'alerte de confirmation distingue désormais succès complet ("ajouté aussi à la liste Cloudflare Access") d'un succès partiel (invitation partie, mais ajout Cloudflare en échec — message explicite avec le geste manuel de secours à faire dans le dashboard).

**Non couvert ici** : la policy d'accès Zero Trust pour les futurs repos testeurs individuels (`docs/infrastructure.md`, point "À trancher" séparé, sans rapport avec ce correctif). Secrets Cloudflare pas encore renseignés côté Supabase au moment de cette session — à faire par Jules-Antoine (jeton créé dans le dashboard Cloudflare, jamais transmis à Claude Code) puis `supabase secrets set` + redéploiement de `invite-tester` avant que l'automatisation soit active en pratique.

---

## [2026-09-04a] — Chantier Apparence — Phase 3 : gestion par palier + mode nuit visiteur

**Fichiers touchés** : `layerpitch-backstage.html`, `index.html`, `pack.html`, `collection.html`, `player.js`, `layerpitch-i18n.js`, nouveaux `test_theme_presets.js`, `test_theme_separators.js`, `test_publish_effective_plan.js`, `test_free_tier_fallback.js`, `test_watermark_gating.js`, `test_night_mode_toggle.js`, `test_i18n_symmetry.js`.

**Contexte** : le système de thème/police de la Phase 1-2 (25 juillet) devient un avantage payant, avec deux paliers construits ici (Free/Starter — la colonne Pro, réglage élément par élément à l'intérieur de chaque bloc + style de forme d'onde, reste hors périmètre, non conçue) et un mode nuit visiteur indépendant des paliers. Décision actée hors code (canal architecture), prompt fonctionnel complet. Périmètre étendu à Pack et Collection en cours de session (confirmé avec Jules-Antoine), pas seulement l'AdReel.

**Changement** :
- **Palier Free — 6 presets de thème** (`THEME_PRESETS`, dupliqué tel quel dans `layerpitch-backstage.html`/`index.html`/`pack.html`/`collection.html`, même convention que `fontCssFamily`/`injectFontAssets`) : Défaut, Nuit, Ambre, Néon, Forêt, Minimal. Chaque preset fixe fond/titres/contenu/police/séparateur en un clic — plus de sélecteurs libres ni de personnalisation par bloc sur ce palier. Stocké comme un identifiant (`profile.theme.presetId` pour l'AdReel, `pack.presetId`/`collection.presetId` à plat) plutôt que dupliqué en valeurs de couleur — la page publique résout l'id au chargement, avec repli silencieux sur "Défaut" si absent/inconnu.
  - Choix de police par preset (parmi les 12 Google Fonts déjà intégrées, `GOOGLE_FONTS_PRESET`) : Défaut/Nuit → police système par défaut (aucune surcharge) ; Ambre → Fraunces (serif chaleureuse, texturée) ; Néon → Space Grotesk (display géométrique, déjà utilisée pour les titres du site) ; Forêt → Zilla Slab (slab serif robuste, esprit RPG/nature) ; Minimal → Manrope (sans-serif géométrique fine).
  - Contraste WCAG AA vérifié (script Node ponctuel, formule de luminance relative officielle) sur les 6 paires fond/titre et fond/contenu — toutes passent sans ajustement des couleurs indicatives du prompt. Pire ratio observé : 4.29:1 (titre Ambre) — `--text-title` n'est utilisé que pour le grand titre d'en-tête (24-40px), donc soumis au seuil AA "grand texte" (3:1), largement dépassé. Tous les autres ratios ≥ 5.5:1.
- **Palier Starter — séparateurs indépendants** : nouveau sous-réglage `profile.theme.separator` / `pack.separator` / `collection.separator` (`{visible, color, thickness}`, `DEFAULT_SEPARATOR` désactivé par défaut — aucun changement visuel sur un AdReel/Pack/Collection Starter déjà publié tant que le compositeur n'y touche pas explicitement). Rendu via deux nouvelles CSS vars (`--separator-color`/`--separator-width`) posées au chargement, appliquées par une classe `show-separators` sur le conteneur (`#blocksContainer` pour l'AdReel avec `.block + .block` ; `#content` pour Pack/Collection avec une nouvelle classe générique `.pub-section` posée sur leurs sections de haut niveau).
- **Gating par palier** : le champ `plan` renvoyé par `effective_plan_quotas()` (SQL) ne reflète JAMAIS un essai reverse trial actif (seuls les quotas numériques sont boostés) — aucun appelant JS de cette fonction n'existait de toute façon. Nouvelle fonction pure `effectiveTierFromTrialStatus(status)` construite au-dessus du RPC déjà câblé `get_trial_status()`/`getTrialStatus()` (`api/subscriptions.js`, déjà utilisé par le panneau "Mon abonnement") : essai actif ⇒ `'pro'`, sinon le palier brut. Pas de nouvelle fonction SQL, pas de nouvelle colonne. Le rôle admin n'est pas pris en compte ici (chantier de gating admin séparé, pas encore fini ailleurs dans le backstage — voir mémoire de session).
  - Backstage : panneau Apparence (AdReel/Pack/Collection) bascule entre galerie de presets (Free) et contrôles complets + séparateurs (Starter et au-dessus) — jamais les deux en même temps. Personnalisation par bloc (`appendBlockAppearanceSection`) masquée en un seul point d'injection (`buildCardForBlock`) sur Free, sans toucher aux ~9 builders de bloc.
  - Publication : `publishAll()` résout le palier effectif UNE FOIS en tout début de publication (juste après le garde-fou `dataLoadOk`, avant tout upload) et bloque la publication (comme ce garde-fou) si la résolution échoue — jamais de publication avec un palier incertain. La valeur est injectée dans `data.json` à la sérialisation (`profile.effectivePlan` pour chaque AdReel, `effectivePlan` à plat pour chaque Pack/Collection), sans muter les objets vivants du backstage (`Object.assign({}, ar.profile, { effectivePlan })`).
  - Repli non-destructif Starter → Free : les réglages fins déjà enregistrés (thème général + par bloc) restent en base tels quels, jamais supprimés ni migrés — ils cessent seulement d'être appliqués au rendu tant que `effectivePlan==='free'`, et réapparaissent automatiquement dès qu'un compositeur repasse Starter (ou entre en essai actif), sur exactement les mêmes données.
- **Filigrane "propulsé par LayerPitch"** (`.layerpitch-credit`, déjà existant et inconditionnel depuis longtemps sur les 3 pages publiques) : désormais conditionnel (`effectivePlan !== 'pro'` — donc affiché sur Free/Starter/AdReels legacy, retiré sur Pro dès qu'un composant Pro existera) et cliquable (`<a href="https://layerpitch.com" target="_blank" rel="noopener">` — landing Framer pré-lancement, `docs/infrastructure.md`).
- **Mode nuit visiteur** (`setupNightModeToggle`, `player.js`, exporté via `window.LayerPlayerCore`) : nouveau bouton sur les 3 pages publiques, disponible sur tout AdReel/Pack/Collection quel que soit le palier du compositeur — un contrôle du confort du visiteur, pas une personnalisation du compositeur. Palette fixe reprenant les valeurs du preset "Nuit" (donc un AdReel déjà sombre ne change quasiment pas visuellement). Persistance `localStorage['layerpitch-night-mode']` (`'1'`/`'0'`), même convention que `layerpitch-high-contrast`.
  - **Conflit résolu avec le contraste renforcé existant** (confirmé avec Jules-Antoine avant implémentation) : le contraste renforcé forçait un fond blanc pur — l'activer en même temps que le mode nuit aurait annulé l'objectif même de ce dernier (éviter un écran blanc dans le noir). Les deux modes se recomposent désormais via une fonction de composition partagée (`applyVisualModes()`, remplace l'ancienne logique interne de `setupContrastToggle`) : thème de base → mode nuit → contraste renforcé, avec une variante SOMBRE du contraste renforcé (`DARK_HIGH_CONTRAST_VARS`, fond/texte inversés) appliquée quand le mode nuit est actif. Les deux cases cochées ensemble donnent désormais un fond noir pur/texte blanc pur, jamais un écran blanc.
- Nouveau script `test_i18n_symmetry.js` (vm sandbox minimal, pas de vrai DOM nécessaire) : confirme que les clés FR/EN sont déjà symétriques sur tout `layerpitch-i18n.js`, zone par zone — aucune régression introduite par les nouvelles clés de ce chantier.

**Note sur `layerpitch-i18n.js`** : le fichier porte un commentaire d'en-tête indiquant qu'il doit être édité via `layerpitch-i18n-editor.html`, introuvable dans ce dépôt au moment de cette session (probablement ailleurs ou retiré) — les nouvelles clés ont donc été ajoutées à la main directement, en respectant scrupuleusement la structure/le format existants, faute d'outil disponible.

**Vérifié** : `node --check` sur `player.js` et sur chacun des blocs `<script>` inline des 4 fichiers HTML touchés (extraction + vérification syntaxique). Les 6 nouveaux tests dédiés passent (`ALL CHECKS PASSED`), ainsi que l'intégralité de la suite de tests déjà existante (aucune régression sur `test_player_regression.js` ni les autres, malgré la réécriture de `setupContrastToggle`). Script de symétrie i18n exécuté avec succès. Contraste WCAG AA vérifié par script ponctuel (voir ci-dessus).

**Non couvert ici, à dessein** : colonne Pro complète (réglage élément par élément à l'intérieur de chaque bloc, choix du style de forme d'onde par compositeur) — chantier séparé à venir, non conçu en détail. Prise en compte du rôle admin dans la résolution du palier effectif (aligné avec le chantier de gating admin déjà identifié comme non fini ailleurs dans le backstage).

---

## [2026-09-03l] — Bandeau d'annonce : structure ouverte au nombre de langues, lien vers le panneau admin depuis le backstage

**Fichiers touchés** : nouveau `supabase/migrations/20260903240000_platform_notice_extensible_languages.sql` ; `api/admin.js`, `admin.html`, `layerpitch-backstage.html`, `scripts/test-admin-rpcs.js`

**Contexte** : suite immédiate de [2026-09-03k]. Jules-Antoine, en apprenant que le bandeau venait d'être construit avec deux colonnes fixes (`notice_message_fr`/`notice_message_en`), a fait remarquer qu'un jour le backstage pourrait s'ouvrir à d'autres langues (espagnol, allemand — mentionné comme piste, pas une décision ni un calendrier) et que ça méritait d'être anticipé. Distinction faite avant d'agir : le bandeau (tout neuf, sans contenu réel encore publié) est bon marché à corriger maintenant ; refaire `layerpitch-i18n.js` (chargé par 6 fichiers, sélecteur de langue, zones de traduction) serait un vrai chantier sans troisième langue réellement décidée à ce jour — Jules-Antoine a tranché : corriger le bandeau, documenter la même approche pour `layerpitch-i18n.js` le jour où ce chantier sera lancé pour de vrai.

**Changement** : `notice_message_fr`/`notice_message_en` (deux colonnes) remplacées par `notice_messages` (`jsonb`, une clé par code langue — ajouter une langue devient un ajout de clé, plus jamais une migration de schéma). `set_platform_notice()` prend désormais un seul paramètre `jsonb`. `admin.html` génère ses champs de saisie depuis une liste `NOTICE_LANGS` (actuellement `fr`/`en`) plutôt que deux champs figés dans le HTML — ajouter une langue à l'écran de saisie devient une ligne dans cette liste + une clé i18n, pas une restructuration. `layerpitch-backstage.html` : repli sur la clé `fr` si la langue du compte n'a pas de message (même convention que `tr()`/`applyI18n()`, qui retombe toujours sur le français).

**Ajouté au passage** : lien "Ouvrir le panneau admin" dans `layerpitch-backstage.html` (fieldset à côté d'"Inviter un testeur"), suite à la question de Jules-Antoine après son premier test — il n'avait accédé à `admin.html` qu'en tapant l'URL directement, aucun lien n'existait encore depuis le backstage.

**Vérifié** : migration appliquée en base réelle, `scripts/test-admin-rpcs.js` mis à jour et repassé (7/7 OK). `admin.html` rechargé en local (nouvel onglet, le premier étant resté épinglé sur un aperçu `data:` sans accès à `localStorage`) — aucune erreur console, les deux champs de langue s'affichent correctement, générés dynamiquement.

**Non couvert ici, à dessein** : `layerpitch-i18n.js` reste structuré `{ fr: {...}, en: {...} }` — si un futur chantier ouvre le backstage à une troisième langue, reprendre le même principe (carte extensible plutôt que zones figées par langue) plutôt que d'ajouter une troisième zone en dur.

---

## [2026-09-03k] — Panneau admin : statistiques, suspension de compte, bandeau d'annonce bilingue

**Fichiers touchés** : nouveaux `admin.html`, `api/admin.js`, `supabase/functions/suspend-account/index.ts`, `scripts/test-admin-rpcs.js`, `supabase/migrations/20260903220000_admin_platform_settings.sql`, `20260903220100_admin_rpcs.sql`, `20260903230000_platform_notice_bilingual.sql` ; `api/auth.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `docs/infrastructure.md`

**Contexte** : cinquième chantier du plan de séquencement (`docs/infrastructure.md`, "Décision complémentaire — Rôle admin..."), indépendant des quatre autres. Exploration réelle du code avant d'écrire quoi que ce soit (trois recherches en parallèle) : a trouvé que le mécanisme admin décrit dans le texte de décision (`profiles.is_admin`) était en fait déjà couvert par `admins`/`is_admin()`, déployés le 1er septembre et déjà utilisés par `invite-tester` — évité de dupliquer. Même erreur trouvée et corrigée en parallèle dans le chantier Stripe ([2026-09-03j]), coordination faite en direct entre les deux sessions actives sur ce checkout. Vérification de non-collision faite avant de committer (deux autres sessions actives sur le même dépôt, aucune ne touchait aux mêmes fichiers/tables).

**Changement** :
- `platform_settings` (nouvelle table, singleton) + `profiles.suspended`/`notice_dismissed_at` (nouvelles colonnes).
- Quatre RPC `security definer` gated `is_admin()` (sauf `dismiss_notice()`, utilisable par tout compte) : `admin_get_stats()` (comptages/moyennes agrégées — volontairement limité en v1, pas de "tendances de modes de lecture", aucune table d'événements aujourd'hui), `admin_list_accounts(p_search)`, `set_platform_notice(p_message_fr, p_message_en)`, `dismiss_notice()`.
- `suspend-account` (nouvelle Edge Function, calquée sur `invite-tester`) : bannissement Supabase Auth réversible (30 jours par défaut, ajustable) + écriture `profiles.suspended` — directement via `service_role` plutôt qu'une RPC (le `service_role` n'a pas d'`auth.uid()`, la vraie barrière est déjà la vérification `is_admin()` faite une fois côté appelant, même principe qu'`invite-tester`). Garde-fou : un admin ne peut pas se suspendre lui-même. UI copy imposée : "Suspendre"/"Réintégrer", jamais "bannir"/"ban".
- `admin.html` (nouvelle page, calquée sur `auth-test.html` pour la structure, sur les variables CSS de `layerpitch-backstage.html` pour le style — pas sur `admin-beta-console.html`, resté dormant) : trois blocs (statistiques, recherche + suspension de compte, bandeau d'annonce).
- `layerpitch-backstage.html` : bandeau reconnecté à Postgres (`loadPlatformNotice()`/`dismissPlatformNotice()`), ancien mécanisme GitHub (`data.backstageNotice`, alimenté par `admin-beta-console.html`) laissé en place sans appelant — déjà mort en pratique en mode lecture Postgres.

**Bug trouvé et corrigé pendant le test** : `admin_list_accounts()` échouait ("structure of query does not match function result type") — `auth.users.email` est `character varying`, pas `text` ; la fonction déclarait `email text` sans caster la colonne. Corrigé (`u.email::text`), reconfirmé par le script de test.

**Retour de Jules-Antoine après premier test réel** : le bandeau doit afficher un message différent selon la langue du backstage de chaque compte (FR/EN), pas un seul message pour tout le monde. `platform_settings.notice_message` (un seul champ) remplacé par `notice_message_fr`/`notice_message_en` (migration `20260903230000`, appliquée le jour même — aucun message réel n'avait encore été publié en production, pas de backfill nécessaire) ; `set_platform_notice()` prend désormais deux paramètres ; `layerpitch-backstage.html` choisit le champ selon `currentLang()`, avec repli sur l'autre langue si l'admin n'en a rempli qu'une.

**Vérifié** : migrations appliquées en base réelle, `scripts/test-admin-rpcs.js` (7/7 OK, y compris après le passage bilingue). `admin.html` et `layerpitch-backstage.html` rechargés en local, aucune erreur console. `suspend-account` et le redéploiement d'`invite-tester` (jamais reconfirmé depuis un incident de fusion du 1er septembre, levé au passage) faits manuellement par Jules-Antoine via le dashboard Supabase. Panneau testé en conditions réelles par Jules-Antoine sur le site déployé (`beta.layerpitch.com/admin.html`) : statistiques et accès visibles avec son vrai compte, confirmé fonctionnel.

**Non couvert ici, à dessein** : "tendances de modes de lecture" (aucune table d'événements, chantier futur séparé) ; suppression définitive de compte (hors périmètre acté).

---

## [2026-09-03j] — Vérification du chantier Stripe Billing : tarification EUR, oubli du cas admin, liens trompeurs retirés

**Fichiers touchés** : nouveaux `supabase/migrations/20260903200000_plan_quotas_prices_eur.sql`, `20260903210000_effective_plan_quotas_admin_case.sql` ; `supabase/functions/create-subscription-checkout-session/index.ts`, `bienvenue.html`, `library.html`, `layerpitch-i18n.js`, `docs/infrastructure.md`

**Contexte** : premier test réel de [2026-09-03i] par Jules-Antoine, trois problèmes trouvés en cours de route.

**1. Tarification en EUR, pas USD** : Jules-Antoine a donné les prix Starter (10€/100€) et Pro (25€/250€) en euros, alors que `create-subscription-checkout-session` (comme `create-checkout-session`, achat unitaire, non touché) facturait en `usd` en dur. Décision : facturer en EUR (site en français, prix pensés en euros) — `currency: 'eur'` dans la nouvelle fonction, et colonnes `plan_quotas.price_usd_cents_monthly`/`price_usd_cents_yearly` renommées `price_eur_cents_monthly`/`price_eur_cents_yearly` (auraient porté un nom trompeur avec des valeurs en centimes d'euros dedans) puis renseignées (Starter 1000/10000, Pro 2500/25000). `packs.price_usd_cents` (achat unitaire studio) volontairement non touché, question distincte non tranchée.

**2. Cas admin oublié dans `effective_plan_quotas()`** : [2026-09-03i] avait vérifié que la colonne `profiles.is_admin` n'existait pas et avait sauté le cas admin en conséquence — raté un mécanisme différent, déjà en place depuis le 1er septembre (`admins` table + `is_admin()`, `20260901190000_admin_role.sql`, déjà utilisé en prod par `invite-tester`). Résultat concret : le compte de Jules-Antoine n'avait pas l'accès Pro complet promis par le plan approuvé (statut admin plutôt que palier dédié). Corrigé en ajoutant le cas admin en priorité la plus haute, vérifié via `exists (select 1 from admins where profile_id = cp.profile_id)` — `is_admin()` elle-même non réutilisable ici car elle vérifie `auth.uid()` de l'appelant, pas un `composer_id` arbitraire passé en paramètre.

**3. Liens trompeurs vers `index.html` retirés** : `index.html` retombe sur `DEFAULT_OWNER_ID` (le compte de Jules-Antoine) quand aucun `?u=<handle>` n'est présent dans l'URL — vestige de l'époque mono-compositeur, aucune vraie page d'accueil générique. Trouvé par Jules-Antoine en testant avec un second compte (bibliothèque acheteur) : "← Retour" ramenait vers son propre site, pas vers un accueil générique. Deux liens retirés en attendant une vraie page d'accueil (option choisie parmi trois proposées — masquer / laisser tel quel / construire maintenant) : "Le site LayerPitch" (`bienvenue.html`, écran "déjà inscrit" — clé i18n `linkHome` supprimée, devenue orpheline) et "← Retour" (`library.html`). Même schéma trouvé mais **pas corrigé** sur `collection.html`/`pack.html` (leur "← Retour" perdrait le `?u=<handle>` de la page consultée — problème différent, ces pages restent publiques et ont besoin d'une vraie navigation) : documenté dans `docs/infrastructure.md` comme sujet à traiter avec la vraie page d'accueil, pas en pièces détachées.

**Trouvé au passage, documenté sans être corrigé** (`docs/infrastructure.md`, liste "À trancher") : aucun des panneaux de debug du backstage (dépôt GitHub avec token, tests Postgres, stockage R2) n'est masqué par rôle — seule la liste d'emails Cloudflare Access limite l'exposition aujourd'hui ; le mécanisme `admins`/`is_admin()` existe déjà pour corriger ça. Le panneau "Mon abonnement" reste un point d'entrée minimal (5 boutons), pas une vraie page "Mon compte/Settings" (ID, moyen de paiement) — les deux volontairement hors périmètre de cette session.

**Vérifié** : `library.html` rechargé en local (`localhost:8420`), lien "← Retour" absent, aucune erreur console.

**Non couvert ici, à dessein** : le test de bout en bout (souscription réelle, webhook, essai) reste à faire par Jules-Antoine — invitation d'un compte test via le panneau admin (en cours au moment de cette entrée), migrations à appliquer, fonctions à redéployer.

---

## [2026-09-03i] — Stripe Billing compositeur : essai reverse trial, tarification mensuelle/annuelle

**Fichiers touchés** : nouveaux `supabase/migrations/20260903190000_stripe_billing_reverse_trial.sql`, `supabase/functions/create-subscription-checkout-session/index.ts`, `api/subscriptions.js` ; `supabase/functions/stripe-webhook/index.ts`, `layerpitch-backstage.html`, `bienvenue.html`, `layerpitch-i18n.js`

**Contexte** : chantier 4b, dernier morceau du plan de séquencement d'origine. Débloqué par les chiffres de `plan_quotas` ([2026-09-03h]) puis révisé en profondeur suite à une série de décisions actées le même jour : essai en **reverse trial** (accès Pro complet 30 jours, sans carte, retombée automatique sur Free) plutôt qu'un essai Stripe classique carte-obligatoire ; bonus bêta-testeurs en coupon Stripe individuel manuel, pas une extension de l'essai ; code promo générique (`allow_promotion_codes`), réutilisable pour toute future opération commerciale ; tarification mensuelle **et** annuelle ; compte de Jules-Antoine couvert par le futur statut admin, pas un palier dédié ; `bienvenue.html` inchangé pour l'instant (l'écran à 3 cartes reste différé à la bascule), le point d'entrée pour s'abonner est un panneau dans le backstage déjà utilisé par les compositeurs.

**Simplification trouvée en explorant** : `create-checkout-session` (achat unitaire, déjà en prod) n'utilise aucun objet Stripe Price pré-créé — le prix vient de Postgres via `price_data` calculé dynamiquement à chaque appel. Stripe Checkout accepte ce même mécanisme en mode `subscription` (`price_data` + `recurring`), donc **aucune configuration de Produit/Prix Stripe côté dashboard n'est nécessaire** — le reverse trial (pas de `trial_period_days` côté Stripe) simplifie encore : un abonnement souscrit facture immédiatement, l'essai a déjà eu lieu entièrement en base avant que Stripe n'intervienne.

**Changement** :
- `composer_profiles.trial_ends_at` (nouveau) : posé à `now() + 30 jours` uniquement à la création d'un **nouveau** `composer_profile` (`ensure_composer_profile()` modifiée) — jamais rétroactif sur les comptes existants (backfill explicitement exclu, voir la migration).
- `plan_quotas.price_usd_cents_monthly`/`price_usd_cents_yearly` (nouveau, remplace l'usage du champ de prix unique d'origine — colonne laissée telle quelle, non touchée).
- `choose_free_plan()`, `get_trial_status()` (nouvelles RPC, même patron que `ensure_studio_profile()`/`mark_onboarding_complete()`).
- `effective_plan_quotas()` : `create or replace`, ajoute la priorité "essai actif → quotas Pro" au-dessus de la dérogation étudiante déjà en place. **Le cas `is_admin` (priorité la plus haute, décision actée) n'est pas construit ici** — `profiles.is_admin` vérifié inexistant au moment d'écrire cette migration (chantier admin d'une autre session, toujours en cours de planification, coordination faite en direct) ; à ajouter dès que cette colonne existera réellement.
- `create-subscription-checkout-session` (nouvelle Edge Function, séparée de `create-checkout-session` — aucune donnée en commun entre les deux cas d'usage) : mode `subscription`, prix dynamique selon palier/intervalle, `allow_promotion_codes: true`, pas de `trial_period_days`.
- `stripe-webhook` : nouveau cas `checkout.session.completed` en mode `subscription` (écrit `composer_profiles.plan`) et `customer.subscription.deleted` (repli sur `free`) — comportement de l'achat unitaire existant strictement inchangé.
- `layerpitch-backstage.html` : nouveau panneau "Mon abonnement" (palier réel + compte à rebours d'essai si actif, 5 boutons Free/Starter mensuel/Starter annuel/Pro mensuel/Pro annuel).
- `bienvenue.html` : gère le retour `?subscribed=1` de Stripe Checkout — sonde `get_trial_status()` (jusqu'à 10 fois, 1s d'intervalle) avant de rediriger vers le backstage, pour ne pas renvoyer le compositeur vers une interface dont le palier n'est pas encore à jour (le webhook Stripe est asynchrone).

**Vérifié** : `node --check` OK sur tous les `.js` touchés/nouveaux (pas d'outil `deno check` disponible dans cet environnement pour les `.ts`, relu attentivement à la place, même structure que les Edge Functions déjà en prod). `bienvenue.html` et le nouveau panneau du backstage chargés en local (`localhost:8420`), aucune erreur console, les 5 boutons et les zones de statut confirmés présents dans le DOM.

**Non testé, bloqué sur un vrai prérequis** : `price_usd_cents_monthly`/`price_usd_cents_yearly` restent `NULL` pour `starter`/`pro` — aucun chiffre fourni, rien inventé. Aucun test de bout en bout possible (souscription réelle, webhook, essai) sans ces valeurs. Migration écrite, pas encore appliquée (classifieur de permission, comme toujours).

---

## [2026-09-03h] — `plan_quotas` renseigné, palier étudiant compositeur

**Fichiers touchés** : nouveau `supabase/migrations/20260903180000_plan_quotas_values_and_student_tier.sql`

**Contexte** : chiffres de pricing actés par Jules-Antoine le 3 septembre (canal business plan dédié, `docs/business-plan.md` §6.1 une fois poussé) — première fois que `plan_quotas`, provisionnée vide depuis le 31 août, reçoit de vraies valeurs.

**Trouvé en préparant la migration** : le schéma retenu par la grille business ne correspond pas aux colonnes d'origine de `plan_quotas` (`max_ad_reels`/`max_tracks`/`max_packs`/`storage_mb`/`price_usd_cents`) — 6 nouvelles colonnes nécessaires (`max_share_links`, `max_embeds`, `max_audio_tracks`, `max_video_blocks`, `max_video_storage_gb`, `commission_rate`). Anciennes colonnes laissées telles quelles (non référencées ailleurs dans le code, vérifié) plutôt que renommées/supprimées dans la foulée — décision à part si Jules-Antoine veut nettoyer. Trouvé aussi : rien ne reliait un `composer_profile` à un palier — `composer_profiles.plan` ajouté (FK vers `plan_quotas.plan`, défaut `'free'`, réglable à la main en attendant Stripe Billing qui l'assignera automatiquement une fois construit).

**Palier étudiant compositeur** (déclaratif, sans justificatif) : volontairement pas nommé "remise" dans le code — Jules-Antoine a précisé que certains champs deviennent *moins* avantageux que le palier starter de base (`max_audio_tracks` passe d'illimité à 200, `commission_rate` augmente de 0,05 à 0,10), d'autres plus (`max_video_storage_gb` réduit à 5 Go) : un compromis, pas une réduction pure. Implémenté en `composer_profiles.student_tier_declared` (booléen) plutôt qu'une ligne dédiée `starter_student` dans `plan_quotas` — une ligne par variante obligerait à dupliquer `pro_student` le jour où la dérogation s'étend à d'autres paliers (explosion combinatoire) et à élargir la contrainte `check()` sur `plan_quotas.plan` à chaque nouveau cas.

**`effective_plan_quotas(composer_id)`** (nouvelle RPC) : résout le palier de base puis applique la dérogation étudiante par-dessus si active et palier `starter` — un seul point de lecture pour tout futur code qui aura besoin d'appliquer réellement les quotas (aucun n'existe encore, comme noté dans `infrastructure.md`).

**Vérifié en conditions réelles** : les 3 lignes de `plan_quotas` correspondent exactement à la grille fournie. `effective_plan_quotas()` testé sur le compte de Jules-Antoine dans les trois cas (free par défaut, starter sans dérogation, starter avec dérogation étudiante) — valeurs correctes dans les trois, remis à l'état d'origine (`free`, pas de dérogation) après test.

**Non couvert ici, à dessein** : `price_usd_cents` des paliers payants reste `NULL` — aucun chiffre fourni, rien inventé. Écran de choix de palier (avec essai gratuit d'un mois du palier le plus élevé, sur le modèle ReelCrafter) et intégration Stripe Billing (Prix récurrents, `create-checkout-session` en mode abonnement, `stripe-webhook` étendu) : confirmé avec Jules-Antoine qu'aucun blocage technique ne les empêche plus (les chiffres existent désormais), mais volontairement traités comme leur propre chantier à planifier, pas greffés à la volée sur ce remplissage de schéma.

---

## [2026-09-03g] — Flux d'inscription vérifié en conditions réelles, bug de droits corrigé au passage

**Fichiers touchés** : `api/auth.js`, nouveau `supabase/migrations/20260903160000_mark_onboarding_complete_rpc.sql`

**Contexte** : premier vrai test de [2026-09-03f] (`jules_escande@hotmail.com`, `bienvenue.html`, sur `beta.layerpitch.com`) — échec immédiat, `Erreur : permission denied for table profiles`.

**Diagnostic** : `markOnboardingComplete()` faisait un `update()` direct sur `profiles` côté client. La policy RLS "own profile update" existe depuis le 31 août, mais **aucun `GRANT UPDATE` de base n'avait jamais été posé** sur `profiles` pour `authenticated` — RLS filtre les lignes visibles, encore faut-il le privilège de table sous-jacent en premier lieu (même famille de trou que `20260831112717_grants.sql`, jamais rencontré avant faute d'avoir jamais tenté d'écrire directement sur `profiles` depuis un client).

**Corrigé en RPC** (`mark_onboarding_complete()`, SECURITY DEFINER) plutôt qu'en ouvrant le `GRANT` manquant — cohérent avec le principe déjà acté et documenté dans `20260831112717_grants.sql` ("toute écriture passe par les RPC upsert_*, jamais un GRANT direct"), pas une dérogation ponctuelle.

**Retard de déploiement inhabituel** : après le push du correctif, GitHub Pages a mis plusieurs minutes à servir la nouvelle version d'`api/auth.js` (bien au-delà du délai habituel, sans qu'un échec ne soit visible dans les vérifications faites) — surveillé par sondage (`curl` en boucle) plutôt que par estimation, confirmé déployé avant de faire retester.

**Vérifié en conditions réelles, sur la vraie URL hébergée** : `jules_escande@hotmail.com`, écran "bêta réservée aux compositeurs" → clic "Continuer" → succès. Confirmé en base : `composer_profile` provisionné, `profiles.onboarding_completed = true`.

**Chantier 3 (flux d'inscription) considéré terminé et vérifié en conditions réelles**, comme les chantiers 1 et 2 avant lui. Restent non testés, sans urgence : la revisite de `bienvenue.html` après onboarding déjà fait (doit afficher les liens, pas reproposer l'écran — logique simple, pas revérifiée en direct) et le futur écran à trois choix Compositeur/Studio/Fan (délibérément pas construit, voir [2026-09-03f]).

---

## [2026-09-03f] — Flux d'inscription : écran d'accueil, bêta réservée aux compositeurs

**Fichiers touchés** : nouveaux `bienvenue.html`, `supabase/migrations/20260903150000_onboarding_and_studio_profile_rpc.sql` ; `api/auth.js`, `layerpitch-i18n.js`, `layerpitch-backstage.html`

**Contexte** : chantier 3 du plan de séquencement (renommage ✓, backstage hébergé ✓). Décision actée avec Jules-Antoine : le vrai écran de choix à trois options (Compositeur/Studio/Fan) est reporté à l'ouverture de la bêta au-delà des compositeurs (vivier de testeurs actuel 100% compositeurs) — construit ici seulement la variante "bêta compositeurs uniquement" (un message, un bouton "Continuer"), exception documentée et délibérée au principe de non-choix forcé.

**Corrigé une exploration précédente** : `library.html` ("Ma bibliothèque", achat/bibliothèque acheteur) existe déjà, tracké et hébergé — jamais utilisé par erreur dans le raisonnement initial faute d'avoir cherché avant de conclure à son absence.

**Changement** :
- `profiles.onboarding_completed` (nouvelle colonne, backfillée à `true` pour tous les comptes existants — aucun ne doit voir le nouvel écran).
- `ensure_studio_profile()` (RPC, copie conforme d'`ensure_composer_profile()`) — construite dès maintenant même si aucun écran ne l'appelle encore côté UI, pour réduire le coût du futur écran à trois choix. Policies RLS `studio_profiles` vérifiées avant de s'appuyer dessus (pas supposées) : bien suivies au renommage du 2 septembre, rien à recréer.
- `api/auth.js` : `getMyStudioId()`/`ensureMyStudioProfile()` (miroir composer), `getMyProfile()`/`markOnboardingComplete()` (lecture/écriture directe sur `profiles`, policies RLS déjà en place, pas de RPC nécessaire).
- `bienvenue.html` (nouveau, même patron que `library.html` : connexion par lien magique, `onAuthStateChange`) : revisite après onboarding déjà fait → liens (backstage/bibliothèque/accueil) ; première visite → message "bêta réservée aux compositeurs" + bouton "Continuer" → `ensureMyComposerProfile()` + `markOnboardingComplete()` → redirection backstage.
- `layerpitch-backstage.html` : le panneau "Inviter un testeur" redirige désormais vers `bienvenue.html` (`window.location.origin + '/bienvenue.html'`) plutôt que vers lui-même — sinon tout nouvel invité atterrit directement dans l'outil compositeur sans jamais voir l'écran d'accueil.

**Vérifié** : `node --check` OK sur tous les `.js` touchés/nouveaux. `bienvenue.html` chargé en local (`localhost:8420`), rendu correct de l'état "non connecté", aucune erreur console réelle. **Non testé en conditions réelles** : le parcours complet connecté (migration pas encore appliquée — bloqué par le classifieur de permission pour Claude Code, comme toujours ; `bienvenue.html` pas encore ajoutée à la liste blanche Supabase des URLs de redirection).

**Reste à faire côté Jules-Antoine avant le premier test réel** :
1. `node scripts/apply-migrations.js`
2. Ajouter `https://beta.layerpitch.com/bienvenue.html` dans Supabase → Authentication → URL Configuration → Redirect URLs
3. Tester : un compte avec `onboarding_completed` remis à `false` manuellement (ou une nouvelle invitation réelle) doit voir l'écran "bêta réservée aux compositeurs", et une revisite après coup doit afficher les liens plutôt que reproposer l'écran.

---

## [2026-09-03e] — Backstage réellement hébergé, chantier fermé pour de bon

**Fichiers touchés** : `.gitignore` (retrait de `layerpitch-backstage.html`), `layerpitch-backstage.html` (publié, placeholders R2 assainis)

**Contexte** : Jules-Antoine a demandé "le backstage hébergé est terminé ?" en fin de journée — bonne question. Tout le travail précédent ([2026-09-02q], [2026-09-03c], [2026-09-03d]) n'avait été vérifié qu'en local. "Hébergé" au sens propre restait à faire.

**Fait** :
- Balayage complet de secrets sur `layerpitch-backstage.html` avant publication (pas seulement le champ token déjà connu) — aucun secret réel en dur, mais les placeholders des 3 champs R2 reprenaient les 6 premiers caractères des vrais identifiants de Jules-Antoine (`10fba6...`, `8089e0...`, `892bef...`) — remplacés par des exemples fictifs.
- `layerpitch-backstage.html` retiré de `.gitignore`, committé, poussé — servi pour la première fois par GitHub Pages sur `https://beta.layerpitch.com/layerpitch-backstage.html`.
- **Accès non authentifié** : Cloudflare Access reconfiguré, cette fois scopé uniquement au chemin `/layerpitch-backstage.html` (pas tout `beta.layerpitch.com`, comme la première tentative documentée dans `infrastructure.md` Partie C — retirée à l'époque car elle bloquait aussi les AdReels envoyés à de vrais prospects). Vérifié : la page backstage demande bien une authentification OTP, le site public (AdReels, packs) charge toujours sans rien demander.
- Supabase : URL de redirection réelle ajoutée (`Authentication → URL Configuration → Redirect URLs`), et **cause racine du bug `localhost:3000` rencontré trois fois aujourd'hui enfin corrigée** : le champ "Site URL" (repli par défaut du projet) pointait encore vers `localhost:3000` depuis la création du projet — mis à jour vers `https://beta.layerpitch.com/`.

**Détour, résolu** : passage du repo `layerpitch` en privé testé (pour protéger `docs/` — `business-marche.md` notamment, analyse de marché actuellement publique) — casse immédiatement la lecture GitHub du backstage (`ghGetContent` → 404 systématique), malgré un token fine-grained fraîchement régénéré, correctement scopé, avec les bonnes permissions. Cause exacte non élucidée. Repassé en public pour débloquer les tests du jour. Solution retenue par Jules-Antoine (pas exécutée aujourd'hui, notée dans une worktree dédiée `split-public-private-repos`, `CHANTIER_SPLIT_REPOS.md`) : séparer en repo public (site) + repo privé (doc interne) plutôt que forcer le token à fonctionner sur un repo privé unique.

**Vérifié en conditions réelles, sur la vraie URL hébergée (pas en local)** :
1. Jules-Antoine, repo GitHub configuré comme toujours : bibliothèque chargée (6 AdReels, 3 packs, 14 morceaux), publication complète réussie (data.json + versions de script des 5 fichiers, y compris `layerpitch-backstage.html` lui-même — premier vrai test de ce chemin de code).
2. `jules_escande@hotmail.com`, sans repo GitHub configuré : bibliothèque vide confirmée (isolation), publication réussie entièrement via Postgres, aucun appel GitHub.

**Chantier "backstage hébergé" considéré définitivement terminé.** Reste ouvert, volontairement hors de ce chantier : la séparation repo public/privé (worktree dédiée), le chemin joli `/<handle>/...` en conditions réelles (testable maintenant que le dépôt tourne pour de vrai), et la propagation de `?u=<handle>` dans le retour Pack→AdReel de l'autre canal.

---

## [2026-09-03d] — Migrations appliquées, vérifiées en conditions réelles avec le second compte compositeur

**Fichiers touchés** : aucun (vérification et opérations en base uniquement — voir [2026-09-03c] pour le code, `20260903120000_ad_reels_owner_scoped_id.sql` corrigée)

**Contexte** : suite de [2026-09-03c]. Jules-Antoine a appliqué les 3 migrations lui-même. **Premier essai en échec** : `cannot drop constraint ad_reels_pkey on table ad_reels because other objects depend on it` — la migration tentait de supprimer la clé primaire de `ad_reels` avant les deux FK qui la référencent (`ad_reel_tracks_ad_reel_id_fkey`, `packs_linked_ad_reel_id_fkey`), ordre invalide en Postgres. Rollback automatique propre (transaction par fichier de migration), rien de cassé — confirmé par lecture directe (`ad_reels` toujours `PRIMARY KEY (id)`, migration non enregistrée dans `_migrations`). Migration corrigée (FK dépendantes supprimées avant la clé primaire) et réappliquée avec succès.

**Blocage opérationnel rencontré en cours de route** : Jules-Antoine a tenté de lancer la migration dans le même terminal que le serveur local (`python3 -m http.server 8420`, tournant au premier plan) — la commande ne s'exécutait pas. Résolu par Ctrl+C (arrêt temporaire du serveur) dans ce terminal, la commande a alors tourné normalement ; serveur relancé ensuite pour la suite des tests.

**Vérifié après application** : `ad_reels` a bien `PRIMARY KEY (owner_id, id)` ; `composer_profiles.handle` de Jules-Antoine backfillé à `'julzantoine'` ; `resolve_composer_handle()` existe. **Test réel refait avec `jules_escande@hotmail.com`** (le cas qui avait échoué le matin même) : republication depuis le backstage, GitHub toujours non configuré, lecture Postgres cochée après un rechargement complet (Cmd+Shift+R — même redémarrage nécessaire que pour la connexion, cf. [2026-09-03]) — **succès** : "Écriture double Postgres : 1 AdReel(s) OK", "Publication terminée", sans aucun appel GitHub. Confirmé en base : `jules_escande` a maintenant sa propre ligne `ad_reels` avec `id = 'main'`, `owner_id` distinct de celui de Jules-Antoine (`d7b26934-...` vs `b0a8478f-...`) — les deux `'main'` coexistent sans collision.

**Chantier "collision d'id ad_reels + identité de compositeur dans l'URL" considéré terminé et vérifié en conditions réelles**, y compris l'écriture (ce test). **Reste non testé en conditions réelles** : la lecture publique via le chemin joli (`beta.layerpitch.com/julzantoine/...` ou `/<handle inconnu ou futur>/...`) — nécessiterait un vrai déploiement GitHub Pages pour exercer `404.html` (le serveur Python local ne le sert pas). À vérifier à la prochaine mise en ligne.

---

## [2026-09-03c] — Identité de compositeur dans l'URL publique + `ad_reels.id` unique par compositeur (chemin joli)

**Fichiers touchés** : nouveaux `404.html`, `api/composers.js`, `supabase/migrations/20260903120000_ad_reels_owner_scoped_id.sql`, `20260903120100_composer_handle.sql`, `20260903120200_upsert_ad_reel_owner_scoped.sql` ; `api/adreels.js`, `api/auth.js`, `index.html`, `pack.html`, `collection.html`, `layerpitch-backstage.html`

**Contexte** : en testant le backstage hébergé avec le second compte compositeur réel (`jules_escande@hotmail.com`, sans repo GitHub), la publication de son AdReel par défaut a échoué : `Non autorisé : cet AdReel appartient à un autre compositeur`. Cause : `ad_reels.id` est une clé primaire globale, et le backstage donne toujours l'id littéral `'main'` au premier AdReel d'un compositeur sans contenu — collision garantie pour 100% des nouveaux compositeurs dès qu'ils partagent Postgres. En creusant : la vraie cause est plus profonde qu'une contrainte de base — `index.html` résout `'main'` en dur pour la page d'accueil publique (sans paramètre), donc corriger seulement la base sans donner à l'URL un moyen de porter l'identité du compositeur aurait laissé `getAdReel('main')` ambigu. Décision actée avec Jules-Antoine après discussion (dont un choix explicite sous-domaine vs paramètre d'URL, tranché en faveur du paramètre — LayerPitch reste 100% statique, un sous-domaine par compositeur aurait demandé un vrai Worker) : identité de compositeur via chemin joli (`/<handle>/...`), corrigé uniquement sur `ad_reels` (les 8 autres tables du même type ont des ids générés aléatoirement, collision négligeable — pas de sur-ingénierie sur un risque qui n'existe pas concrètement).

**Changement** :
- `ad_reels` : clé primaire `id` seul → `(owner_id, id)`. `ad_reel_tracks` gagne `owner_id`, FK composite. `packs.linked_ad_reel_id` : FK composite réutilisant `packs.owner_id`.
- `composer_profiles.handle` (nouvelle colonne, `unique`, `check` contre une liste de handles réservés — `pack`, `collection`, `index`, `api`, etc., pour éviter qu'un handle coïncide avec un fichier réel du dépôt que GitHub Pages résoudrait avant `404.html`). Backfill : `julzantoine`.
- `resolve_composer_handle(handle)` : RPC étroite (retourne uniquement l'id), pas une policy RLS ouverte sur `composer_profiles` — cette table reste par ailleurs à lecture restreinte au propriétaire.
- `upsert_ad_reel` : `on conflict (owner_id, id)`, vérification de propriété devenue inutile retirée (structurellement impossible de conflicter avec la ligne d'un autre compositeur désormais) — code mort, pas gardé.
- `404.html` (nouveau) : intercepte `/<handle>/...` (uniquement une forme stricte — 1 ou 2 segments, second segment parmi une liste fermée de pages réelles ; un segment unique avec extension, ex. `favicon.ico`, traité comme une vraie 404, jamais comme un handle — bug trouvé en testant la logique en isolation avant tout déploiement), redirige vers le fichier réel avec `?u=<handle>&__pretty=<chemin original>`.
- `index.html`/`pack.html`/`collection.html` : restaurent l'URL jolie (`history.replaceState`) au chargement, résolvent le handle en `ownerId` via `api/composers.js` avant tout appel Postgres (simplifie au passage `loadSiteData()` : plus besoin de la double lecture "charger pour découvrir le propriétaire, puis tout recharger scopé"). **Ajout `<base href="/">`** dans les trois `<head>` — bug trouvé en testant : une fois l'URL jolie restaurée à une profondeur de chemin différente, toute ressource relative (`./data.json`, `./api/*.js`) se mettait à résoudre depuis le mauvais dossier (`/julzantoine/data.json` au lieu de `/data.json`). Vérifié sans danger pour les liens `julzantoine.github.io/layerpitch/` déjà partagés : `curl` confirme une redirection 301 automatique vers `beta.layerpitch.com/` (racine), donc `<base href="/">` correspond exactement à ce qui est réellement servi.
- `layerpitch-backstage.html` : `computeAdReelUrl()` construit désormais `https://beta.layerpitch.com/<monHandle>/` pour tout compositeur sans repo GitHub configuré (sinon inchangé, toujours l'URL `github.io` — comportement de Jules-Antoine strictement identique). Handle mis en cache (`myComposerHandle`) à chaque changement de session pour garder la fonction synchrone (8 points d'appel).
- `api/auth.js` : nouvelle `getMyComposerHandle()`, même schéma que `getMyComposerId()`.

**Vérifié** : `node --check` OK sur tous les `.js` touchés/nouveaux. Logique de `404.html` testée en isolation (Node, hors navigateur — Python `http.server` local ne réplique pas le comportement 404-fallback de GitHub Pages) : chemins à handle valides correctement reconnus, `favicon.ico`/`robots.txt`/segments inconnus correctement laissés en vraie 404. Restauration `__pretty` + `<base href="/">` vérifiées ensemble dans le navigateur piloté (`localhost:8420`) : adresse restaurée à `/julzantoine/pack.html?id=...`, `data.json` chargé depuis la racine (`/data.json`, plus `/julzantoine/data.json`), page rendue correctement. **Non testé** : le vrai flux `404.html` servi par GitHub Pages (nécessite un vrai déploiement), et tout le mécanisme de bout en bout avec la vraie RPC `resolve_composer_handle` (les trois migrations SQL sont écrites mais pas encore appliquées — bloqué par le classifieur de permission pour Claude Code, comme pour les migrations précédentes ; à appliquer par Jules-Antoine).

**Point d'interaction avec le travail concurrent d'un autre canal (même session de travail, fichiers partagés)** : `player.js`/`index.html`/`pack.html` ont aussi été modifiés en parallèle ce jour pour un paramètre `?from=<adReelId>` (retour dynamique Pack → AdReel, `window.LayerPlayerCore.adReelFromParam()`) — aucun chevauchement de lignes avec ce chantier, mais ce paramètre ne propage pas encore `?u=<handle>` : un visiteur sur le pack d'un second compositeur cliquant sur "retour à l'AdReel" retomberait sur le compositeur par défaut plutôt que le bon. Sans conséquence tant qu'aucun second compositeur réel n'a de contenu public, à corriger avant l'ouverture réelle.

---

## [2026-09-03b] — Trois correctifs UX sur la page publique des Packs (infobulles d'aide, retour dynamique Pack → AdReel)

**Fichiers touchés** : `index.html`, `pack.html`, `player.js`, `layerpitch-i18n.js`

**Contexte** : retours de compositeurs externes en phase de découverte de LayerPitch — deux constats indépendants de Jules-Antoine que les visiteurs ne comprennent pas spontanément ce qu'est un "pack" ni qu'il est cliquable sur la page publique (AdReel), nécessitant une redirection orale. Occasion d'y regrouper deux autres correctifs de la même famille (page publique des Packs), traités comme trois tâches indépendantes.

**Tâche 1 — Infobulle sur le libellé "Packs"** : réutilisation exacte du mécanisme déjà en place pour le badge "certifié sans IA" (`<span title="...">` + icône SVG inline, tooltip natif du navigateur au survol) — pas de nouveau composant. Nouvelle icône générique `infoBadgeSvg()` ajoutée dans `player.js` à côté de `noAiBadgeSvg()` (même mécanisme, icône différente — cercle "i" plutôt que bouclier), exportée via `LayerPlayerCore`. Appliquée au libellé "Packs" du bloc `packs` d'un AdReel (`renderPacksBlockItem`, `index.html`) avec la classe CSS `.info-badge` (copie de `.no-ai-badge`). Le libellé "Packs" lui-même n'est pas renommé — décision actée dans `docs/extensions-roadmap.md` (le mot n'est pas le problème, l'absence d'explication l'était).

**Tâche 2 — Retour dynamique Pack → AdReel** : jusqu'ici le bouton "← Retour"/"Voir le travail complet de {nom}" de `pack.html` dépendait uniquement de `pack.linkedAdReelId`, réglage statique en backstage — un même pack intégré dans plusieurs AdReels (ex. AdReel principal + AdReel de démo envoyé à un prospect) renvoyait toujours vers le même AdReel fixe, peu importe celui par lequel le visiteur était réellement arrivé. Nouvelle fonction `adReelFromParam()` (`player.js`, même `window.__lpTrackContext` déjà utilisé pour le contexte analytics Umami) ajoute `&from=<adReelId>` à tout lien généré vers `pack.html` depuis un contexte AdReel — appliqué aux deux endroits qui génèrent un tel lien : le bloc "Packs" d'un AdReel (`index.html`) et la mention "Fait partie du pack…" sous un morceau (`buildTrackRow`, `player.js`). Au chargement, `pack.html` priorise ce paramètre `from` sur `pack.linkedAdReelId` pour résoudre l'AdReel à afficher ; si absent, ou si l'AdReel qu'il désigne a depuis été supprimé, repli sur `pack.linkedAdReelId` (même nettoyage défensif que l'existant — un `.find()` qui échoue ne casse rien, `if (linkedAdReel)` reste la garde). Le champ `linkedAdReelId` et son sélecteur en backstage restent inchangés, toujours le repli par défaut.

**Tâche 3 — Infobulle sur "Tester en jeu"** : même logique que la Tâche 1, mais le déclencheur est déjà un `<button>` — simple ajout de l'attribut `title` natif dessus (`pack.html`), pas besoin de l'icône séparée.

**i18n** : quatre nouvelles clés FR/EN dans `layerpitch-i18n.js` (`index.packsSectionHelp`, `pack.videoTestTriggerBtnHelp`), symétrie FR/EN vérifiée programmatiquement (comparaison des jeux de clés par zone) — aucun écart.

**Vérification** : `node --check` sur `player.js` et `layerpitch-i18n.js`, et sur les scripts inline extraits de `index.html`/`pack.html` — tout passe. Testé en local (`localhost:8420`) : badge d'aide "Packs" présent avec le bon texte au survol ; lien généré depuis le bloc Packs d'un AdReel et depuis la mention "Fait partie du pack" portent bien `&from=<adReelId>` ; sur `pack.html`, `from=<adReelId>` prend le pas sur un `pack.linkedAdReelId` différent (testé avec un pack dont `linkedAdReelId=main`, ouvert avec `from=formike` : lien de retour bien vers `formike`) ; `from` absent retombe sur `linkedAdReelId` ; `from` pointant vers un AdReel inexistant (simulé) retombe proprement sur `linkedAdReelId` sans erreur console ; bouton "Tester en jeu" porte bien le `title` attendu. Aucune erreur console sur aucune des pages testées.

---

## [2026-09-03] — Renommage `studio_profile` : migration appliquée, Edge Functions déployées, achat réel vérifié de bout en bout

**Fichiers touchés** : aucun (vérification et opérations en base uniquement — voir entrées [2026-09-02o] à [2026-09-02q] pour le code)

**Contexte** : suite de la session de la veille, avec Jules-Antoine présent cette fois. Le classifieur de permission automatique a de nouveau bloqué `node scripts/apply-migrations.js` exécuté par Claude Code, même avec Jules-Antoine dans la conversation — confirmé que ce n'est pas conditionné à sa présence, seulement à une exécution directe par lui. Jules-Antoine a lancé la commande lui-même depuis son terminal (un premier essai a échoué : commande lancée depuis son dossier personnel `~` plutôt que depuis le checkout du projet — corrigé en indiquant le chemin complet).

**Vérifié après application** :
- Migration confirmée en base par lecture directe (`information_schema`) : `studio_profiles` existe, `buyer_profiles` a disparu, `pack_purchases.studio_id`/`album_purchases.studio_id` bien renommées. L'achat déjà existant du 31 août (pack "Robot Adventure") a survécu au renommage avec `studio_id` correctement rempli.
- Les deux Edge Functions modifiées (`create-checkout-session`, `stripe-webhook`) déployées manuellement par Jules-Antoine via le dashboard Supabase (fichiers envoyés en pièce jointe pour copier-coller exact, pas d'accès CLI authentifié dans cet environnement).
- **Achat réel de bout en bout testé et confirmé** : `PURCHASES_ENABLED` (flag dans `pack.html`, masque tout le flux d'achat public tant que la bêta n'est pas terminée) temporairement activé en local uniquement (jamais commité), un pack temporairement rendu achetable en base (`packs.buyable`), test effectué par Jules-Antoine lui-même en local (`localhost:8420`, connecté via sa vraie session déjà active) — carte Stripe test, paiement confirmé, nouvelle ligne `pack_purchases` créée avec `studio_id` correctement rempli et un vrai `stripe_payment_intent_id` (`pi_3UBV3PRoZFK9c9lr0Jma4ynD`). `PURCHASES_ENABLED` et `packs.buyable` remis à leur état d'origine (`false`) immédiatement après — `git diff` confirme `pack.html` revenu identique au commit.

**Diagnostic en cours de route (pas un bug)** : premier essai de test sur le site public (`beta.layerpitch.com`) affichait "Bientôt disponible" malgré `packs.buyable = true` en base — cause trouvée après vérification que la donnée était bien lisible publiquement (requête REST directe, `buyable: true` confirmé) : `pack.html` a son propre interrupteur global `PURCHASES_ENABLED = false` (ligne 446) qui masque tout le flux d'achat réel sur le site public pendant la bêta, indépendamment de `packs.buyable`. Comportement voulu, pas une régression — d'où le choix de tester en local plutôt que de basculer ce flag en production (aurait nécessité un commit/push public, même bref).

**Chantier "renommage `buyer_profile` → `studio_profile`" (le premier des quatre du plan de séquencement) considéré terminé et vérifié.** Prochaine étape du séquencement : reprendre et tester le "backstage hébergé" ([2026-09-02q]) — écriture Postgres sans repo GitHub, toujours pas testée en conditions réelles.

---

## [2026-09-02q] — Publication possible sans repo GitHub personnel (backstage hébergé, écriture)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : suite des entrées précédentes de ce soir ([2026-09-02o], [2026-09-02p]) — pièce centrale du chantier "backstage hébergé" (`docs/infrastructure.md`, décision du 2 septembre) : `publishAll()` refusait jusqu'ici de publier sans `owner`/`repo`/`token` GitHub renseignés (`if (!owner || !repo || !token) return`), modèle "un compositeur = son repo" incompatible avec plusieurs compositeurs partageant une seule base Postgres.

**Changement** : nouvelle constante `githubConfigured` (vrai seulement si les trois champs GitHub sont renseignés). Comportement de Jules-Antoine strictement inchangé quand `githubConfigured` est vrai (écriture double Postgres+GitHub comme avant, case `#pgWriteToggle` toujours opt-in). Sans repo configuré : `writeToPg` est désormais forcé à vrai (l'écriture Postgres cesse d'être une case à cocher pour ce cas — un compositeur du backstage hébergé n'a aucune raison de connaître ce réglage pensé à l'origine pour les tests de Jules-Antoine), et le bloc final GitHub (`ghPutFile('data.json', ...)`, `updateScriptVersions` ×5, `flushEventBuffer`) devient conditionnel, entièrement sauté dans ce cas. Nettoyage au passage : la clé de traduction `needAllBeforePublish` (fr/en, `layerpitch-i18n.js`), devenue orpheline après ce changement, supprimée.

**Non résolu, à dessein — dépend d'une décision de Jules-Antoine, pas prise ici** : `index.html`/`pack.html`/`collection.html` continuent de lire `data.json` (GitHub) par défaut, pas Postgres (`?dataSource=postgres` reste opt-in, Décision 5 de `infrastructure.md` — bascule manuelle unique, jamais automatique). Conséquence concrète : même avec ce changement, le catalogue d'un compositeur publiant uniquement vers Postgres (sans repo) **resterait invisible sur le site public par défaut**. Ce n'est pas un bug de ce soir — c'est la même limite déjà signalée dans le plan de séquencement (point 7 des "corrections aux hypothèses de départ") — mais elle devient concrètement testable maintenant que l'écriture Postgres-seule existe. Ne pas basculer ce défaut sans en parler à Jules-Antoine en premier.

**Vérification** : relecture statique complète de `publishAll()` après modification (portée de `owner`/`repo`/`branch`/`token` toujours utilisée uniquement à l'intérieur du bloc `if (githubConfigured)`, `hasUnsavedEdits`/`renderLibrary()`/etc. bien restés hors de ce bloc) ; aucune erreur console au chargement de la page en local (`localhost:8420`) avant et après le retrait de `needAllBeforePublish`. **Aucun test de publication réelle** (ni avec, ni sans repo configuré) — nécessiterait une session Postgres réelle (lien magique par email) et une écriture RPC réelle, deux catégories d'action bloquées ce soir par le classifieur de permission automatique en l'absence de Jules-Antoine (même comportement que les entrées précédentes). **À tester en priorité à la prochaine session, dans l'ordre** : (1) publication avec Jules-Antoine connecté et son repo configuré, pour confirmer une stricte non-régression ; (2) publication avec le second compte compositeur de test déjà utilisé le 1er septembre, GitHub vide et `#pgWriteToggle` non coché, pour confirmer que Postgres seul suffit désormais.

---

## [2026-09-02p] — Corrige un bug réel en production : les nouvelles images uploadées depuis le backstage étaient invisibles côté public depuis le 31 août

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : en poursuivant le séquencement du chantier "backstage hébergé, flux d'inscription, studio_profile, Stripe" (entrée précédente [2026-09-02o]), exploration du fichier de publication (`publishAll()`) pour évaluer ce qu'il faudrait changer pour publier sans repo GitHub personnel. Trouvé au passage — pas seulement une limite architecturale, un vrai bug déjà documenté comme connu mais jamais corrigé : `docs/infrastructure.md` (journal du 31 août, ligne 311) notait explicitement *"Pipeline d'upload du backstage volontairement laissé sur GitHub pour cette étape (nouveaux uploads médias à geler en attendant une session dédiée à sa réécriture vers R2)"*. Ce "gel" n'avait jamais été communiqué comme un vrai bug bloquant : depuis la migration de l'étape 1 (31 août), `index.html`/`pack.html`/`collection.html` chargent toutes les images via `IMAGES_BASE = 'https://media.layerpitch.com/images/'` (R2), alors que le backstage continuait d'envoyer toute nouvelle image (logo, photo bio, fond de thème, image/vignette de bloc, illustration/filigrane de pack, illustration de collection) vers GitHub (`images/` du repo) via `ghPutFile`. Concrètement : **toute image ajoutée ou remplacée depuis le 31 août, y compris par Jules-Antoine lui-même, restait invisible sur le site public** (le champ `.illustration`/`.logo`/etc. pointait vers un fichier qui n'existait que sur GitHub, jamais sur R2) — silencieux, aucune erreur affichée au moment de la publication.

**Corrigé** : les 9 sites d'upload d'image dans `publishAll()` basculés de `ghPutFile(owner, repo, 'images/${fileName}', ...)` vers `r2PutFile('images/${fileName}', bytes, imageContentType(...))` — même fonction R2 déjà utilisée et vérifiée en production pour l'audio (signature AWS SigV4, `docs/LAYERPITCH_CHANGELOG.md` 31 août), même convention de clé plate `images/<fichier>` déjà utilisée par `IMAGES_BASE`. Nouvelle fonction `imageContentType(ext)` ajoutée (R2 veut un `Content-Type` correct, GitHub n'en avait jamais eu besoin). Les polices custom (`fonts/`) sont **volontairement laissées sur GitHub** — contrairement aux images, `index.html`/`pack.html`/`collection.html` chargent encore les polices en chemin relatif (`./fonts/...`, même origine que le site), migrer leur upload vers R2 sans aussi ajouter une `FONTS_BASE` dans ces trois fichiers publics casserait le chargement des polices déjà publiées ; laissé pour une passe séparée.

**Vérification** : relecture statique des 9 sites modifiés (variable `bytes` toujours un `Uint8Array` cohérent avec la signature de `r2PutFile`, `fileName` toujours calculé avant son premier usage) et absence de nouvelle erreur console au chargement de la page en local (`localhost:8420`). **Test d'écriture réelle sur le bucket R2 de production non fait** : bloqué par le même classifieur de permission automatique que l'application de la migration du renommage (entrée précédente) — jugé comme une action à risque nécessitant une confirmation explicite pendant l'absence de Jules-Antoine. Risque jugé faible malgré l'absence de test en direct : `r2PutFile` est réutilisé tel quel (aucune logique de signature nouvelle), déjà éprouvé en production pour l'audio depuis le 31 août. **À vérifier par Jules-Antoine** : uploader une nouvelle image de test depuis le backstage et confirmer qu'elle apparaît bien sur le site public à `https://media.layerpitch.com/images/<fichier>`.

---

## [2026-09-02o] — Renommage `buyer_profile` → `studio_profile` (code prêt, migration non encore appliquée)

**Fichiers touchés** : nouvelle migration `supabase/migrations/20260902200000_rename_buyer_to_studio_profile.sql`, `supabase/functions/create-checkout-session/index.ts`, `supabase/functions/stripe-webhook/index.ts`

**Contexte** : premier des quatre chantiers du plan de séquencement "backstage hébergé, flux d'inscription, renommage `studio_profile`, Stripe complet" (`docs/infrastructure.md`, décision du 2 septembre — plan détaillé produit en session précédente). Mis en premier car son périmètre réel, vérifié par recherche exhaustive avant d'écrire quoi que ce soit, s'est avéré bien plus petit que la liste de départ ne le laissait supposer : `buyer_` n'apparaît nulle part dans le code applicatif (`api/*.js`, tout le HTML, `scripts/test-rpc-upserts.js`) — uniquement dans les migrations SQL, plus une seule exception trouvée dans les Edge Functions Stripe (`buyer_id`/`buyerId` dans `create-checkout-session`/`stripe-webhook`). Les tables `buyer_video_uploads`/`buyer_custom_pack*` évoquées dans la liste de départ n'ont en réalité jamais été migrées (décidées sur le papier le 31 août, jamais créées en base) — rien à renommer pour elles.

**Changement** : `buyer_profiles` → `studio_profiles` (table + policy RLS), `pack_purchases.buyer_id`/`album_purchases.buyer_id` → `studio_id` (+ policies RLS mises à jour), commentaire de la table `profiles` mis à jour. `pack_purchases.studio_id`/`album_purchases.studio_id` continuent de référencer `profiles(id)` directement (comportement inchangé, pas `studio_profiles(id)`) — un achat ne provisionne toujours aucun `studio_profile`, pour ne rien casser dans le flux d'achat unitaire déjà fonctionnel de bout en bout. Question ouverte, non tranchée : faire provisionner un `studio_profile` à l'achat reste un choix produit pour Jules-Antoine. Côté Edge Functions : variable/clé de métadonnée Stripe `buyerId` → `studioId`, champ `buyer_id` → `studio_id` dans l'upsert `pack_purchases` du webhook.

**Non appliqué ce soir** : `node scripts/apply-migrations.js` (qui écrirait sur la vraie base Postgres de production) a été bloqué par le classifieur de permission automatique de Claude Code — Jules-Antoine étant absent pour confirmer une action de ce niveau de risque, conformément au fonctionnement attendu du classifieur (même comportement déjà rencontré le 2026-09-02n). La migration et les deux fichiers Edge Function sont prêts et vérifiés (relecture + grep confirmant zéro référence `buyer_` restante en dehors des anciennes migrations déjà appliquées), mais rien n'est encore en base ni déployé. **Reste à faire, dans l'ordre, avant de considérer ce chantier terminé** :
1. `node scripts/apply-migrations.js` (depuis le checkout principal, pas une worktree — voir credentials `.env`).
2. Copier-coller le contenu mis à jour de `create-checkout-session/index.ts` et `stripe-webhook/index.ts` dans le dashboard Supabase (Edge Functions) — aucun CLI Supabase authentifié dans cet environnement, le déploiement reste manuel comme pour les Edge Functions précédentes.
3. Re-tester le flux d'achat complet en mode test Stripe (`pack.html` → checkout → webhook → `pack_purchases`) pour confirmer qu'aucune référence à l'ancien nom n'a été oubliée.

Chantier suivant du séquencement (backstage hébergé) volontairement non entamé ce soir : exploration plus poussée du fichier a montré que la publication ne dépend pas seulement de l'écriture finale de `data.json` (déjà doublée vers Postgres et testée) mais aussi d'une dizaine d'appels `ghPutFile` pour les images/polices tout au long de `publishAll()` (l'audio, lui, passe déjà par R2 directement, pas par GitHub) — plus gros et plus risqué à modifier sans pouvoir tester en conditions réelles (lien magique par email, écritures Postgres) pendant l'absence de Jules-Antoine. Repoussé à une session où il peut vérifier au fur et à mesure.

---

## [2026-09-02n] — Parité GitHub/Postgres vérifiée (27/27) : un écart réel trouvé et corrigé sur l'AdReel "Principal"

**Fichiers touchés** : aucun fichier de code — correction de données en base Postgres uniquement (table `ad_reels`, colonne `blocks`, ligne `id = 'main'`)

**Contexte** : à la demande de Jules-Antoine ("vérifie si ce qu'il y a dans le GitHub correspond bien à ce qu'il y a en Postgres"), exécution de `scripts/verify-postgres-migration.js` (déjà existant, utilisé le 31 août) sur l'état courant. Nécessite d'abord une resynchronisation : le dépôt local était 6 commits derrière `origin/main` (publications automatiques faites par le backstage pendant les tests de connexion de Jules-Antoine plus tôt dans la session) — `data.json` local était donc périmé de 26 lignes. `git fetch` + `git merge origin/main` (fusion automatique propre, aucun conflit — mêmes commits de publication routiniers déjà rencontrés plus tôt aujourd'hui) puis push, avant de lancer la vérification sur un `data.json` réellement à jour.

**Diagnostic** : 26 des 27 éléments (morceaux, Sfx, packs, collections, AdReels) strictement identiques entre `data.json` et Postgres. Un seul écart réel, sur l'AdReel `main` ("Principal") : l'ordre des 9 blocs de la page diffère entre les deux (même contenu, positions différentes — notamment le bloc "morceaux" en 3ᵉ position côté GitHub mais en dernière position côté Postgres). Cause probable : une réorganisation de blocs dont l'écriture double n'a, à un moment donné, pas suivi côté Postgres jusqu'au bout. Un second écart de surface (`profile` : clés dans un ordre différent) s'est avéré un faux positif de mon script de diagnostic ad hoc (comparaison sans tri de clés) — le script `verify-postgres-migration.js` original, qui trie les clés avant de comparer, ne l'avait pas signalé à tort.

**Corrigé** : mise à jour directe et ciblée de `ad_reels.blocks` pour `id = 'main'` avec l'ordre de blocs de `data.json` (source de vérité actuelle du site public), après explication à Jules-Antoine et autorisation explicite en chat — l'écriture directe en base avait d'abord été bloquée par le classifieur de permission automatique de Claude Code (action jugée trop risquée sans confirmation explicite), conformément à son fonctionnement attendu. Aucun trigger sur `ad_reels` (vérifié dans les migrations), donc une mise à jour ciblée de la seule colonne concernée est équivalente à ce qu'aurait fait l'RPC `upsert_ad_reel` pour ce champ précis.

**Vérifications** : re-exécution de `scripts/verify-postgres-migration.js` après correction → 27 identique(s), 0 différent(s), "Tout data.json (...) est identique entre l'original et Postgres."

## [2026-09-02m] — Corrige le message d'erreur "undefined" au chargement d'un script api/*.js échoué

**Fichiers touchés** : `layerpitch-backstage.html`, `index.html`, `pack.html`, `collection.html`

**Contexte** : Jules-Antoine a rencontré une alerte "Erreur : undefined" en testant le bouton "Envoyer le lien magique" du backstage (panneau Écriture Postgres, Session B). Diagnostic : `loadPostgresReadScripts()`/`loadPurchaseScripts()` chargent leurs scripts (`api/*.js`) via `new Promise((resolve, reject) => { ...; s.onerror = reject; ... })` — `s.onerror` reçoit en réalité un `Event` DOM, pas une `Error`, donc sans propriété `.message`. Toute erreur remontée plus haut dans la chaîne (`alert('Erreur : ' + e.message)`) tombait donc systématiquement sur "undefined", sans jamais dire quel script avait échoué à charger ni pourquoi — un problème d'affichage, pas une vraie panne : reproduit en direct (navigateur piloté), le clic fonctionnait en réalité correctement une fois testé isolément, la vraie cause du "undefined" ce jour-là étant probablement un script en échec de chargement à un instant donné (tous les fichiers `api/*.js` existent et se chargent normalement en temps normal, vérifié).

**Corrigé** : `s.onerror` construit désormais une vraie `Error` nommant le script en cause (`new Error('Échec du chargement de ' + s.src)`) avant de `reject()`, dans les quatre fichiers qui répètent ce même motif `loadScript()`. Un futur échec de chargement affichera enfin un message exploitable au lieu de "undefined".

**Vérifications** : reproduction en direct via navigateur piloté (serveur local `localhost:8420`) — bouton "Envoyer le lien magique" testé deux fois : premier essai bloqué par la limite anti-spam Supabase par email (message désormais lisible : "For security purposes, you can only request this after N seconds", comportement normal de Supabase, pas un bug), second essai après le délai → succès ("Lien envoyé — vérifie ta boîte mail."), confirmant à la fois la correction du message d'erreur et le bon fonctionnement du flux de connexion.

## [2026-09-02l] — Retire les boutons de destination du mode séquentiel à embranchement : la carte des chemins suffit

**Fichiers touchés** : `player.js` (retrait de `renderSeqBranchOptions`, du panneau `.seq-branch-options`, simplification de `handleSeqBranchChoice`/`activateSeqStage`/`stopSequential`) ; `index.html`, `pack.html`, `layerpitch-backstage.html` (CSS `.seq-branch-options`/`.seq-branch-btn`/`.seq-branch-transition-badge` retirée ; `?v=` bumpée) ; `test_seq_branching.js`, `test_seq_custom_cut_fade.js`, `test_seq_stage_description.js`, `test_seq_transitions.js`, `test_seq_slot_tempo.js`, `test_seq_map.js` (les clics de test passent désormais par les nœuds de la carte).

**Contexte** : retour direct en situation réelle sur [2026-09-02h] (nœuds cliquables) — "dans le backstage, plus besoin des boutons de destination non plus : la carte se suffit également à elle-même", confirmé "partout" (page publique et pack.html compris, pas seulement Backstage) après clarification.

**Corrigé** :
- **Panneau `.seq-branch-options` retiré du gabarit** (`buildTrackRow`) — les boutons de destination par emplacement (ex. "#3 Battle", "#1 WetDarkCave") ont disparu, la carte des chemins (déjà cliquable depuis [2026-09-02h]) reste l'unique façon de choisir un embranchement, sur les trois fichiers.
- **`renderSeqBranchOptions()` supprimée** — plus rien à construire pour ce panneau. Ses deux points d'appel (`activateSeqStage`/`stopSequential`) appellent désormais directement `updateSeqPendingIndicator()`, seul comportement qu'ils avaient encore besoin de déclencher (l'indicateur textuel "en attente" reste, inchangé, quel que soit le mode de choix).
- **`handleSeqBranchChoice()` simplifiée** — ne touche plus que les nœuds de la carte (`.seq-map-node.pending`), plus les boutons devenus inexistants.
- **CSS mort retiré** sur les 3 fichiers : `.seq-branch-options`, `.seq-branch-btn` (+ `:hover`/`.pending`), `.seq-branch-transition-badge` (+ `svg`). `.seq-pending-indicator` conservé (toujours utilisé). Commentaires mis à jour là où ils faisaient encore référence à `.seq-branch-btn`.
- **Perte de couverture assumée, pas comblée** : l'ancien Scénario 1 de `test_seq_map.js` testait un badge de transition spécifique aux boutons (retiré) — supprimé plutôt que converti, la boule de transition de la carte ([2026-09-02i]) couvre déjà le même besoin (signaler qu'un embranchement a une transition). Les tests qui utilisaient un bouton texte pour vérifier un libellé personnalisé par embranchement (`opt.label`) perdent cette assertion précise : un nœud de carte affiche toujours le nom de l'emplacement cible, jamais un libellé propre à l'arête (qui reste lisible en infobulle sur l'arête elle-même, déjà couvert ailleurs) — les autres 6 fichiers de test n'utilisaient les boutons que comme mécanisme de clic, convertis en clics sur les nœuds correspondants (`[data-slot-id="..."]`) sans perte de couverture comportementale.

**Vérifications** : `node --check` OK sur `player.js` et le JS inline des 3 fichiers HTML. Suite complète des `test_*.js`/`test-*.js` rejouée après conversion des 6 fichiers concernés — tous verts, aucune régression sur le comportement testé (dernier-clic-gagne, quantification immediate/bar, fondus personnalisés, tempo par segment, textes de mise en scène, durées de transition en mesures/temps/secondes). Balises équilibrées sur les 4 gabarits.

**Toujours aucune écoute réelle possible de ma part** — le confort d'usage de "cliquer uniquement sur la carte" (notamment en mode compact au-delà de 14 emplacements, où les nœuds sont plus petits) reste à confirmer par Jules-Antoine après rechargement forcé (Cmd+Shift+R).

---

## [2026-09-02k] — Deux corrections en embranchement vertical : durée de transition ignorée dans l'aperçu Backstage, redémarrage inutile au retour d'onglet

**Fichiers touchés** : `layerpitch-backstage.html` (`buildPreviewTrack()`, non suivi par git — voir rappel plus bas) ; `player.js` (`visibilitychange`, branche `isEmbrVert`) ; `?v=` bumpée sur les 3 fichiers HTML.

**Contexte** : deux retours directs successifs en situation réelle, sur le même morceau ("Monte en l'air et Pattes de Velours") :
1. "J'ai réglé la durée de la transition sur 1 temps, mais ça va jusqu'au bout du fichier" — reproduit dans l'aperçu "Écouter" du Backstage, PAS sur la page publique (confirmé par le retour suivant : "ha non, ça marche sur la page publique").
2. "On veut que l'audio continue même si on va sur un autre onglet (ce qu'il fait déjà), mais qu'il ne reprenne pas au début quand on revient sur l'AdReel !"

**Corrigé** :
- **Bug 1 (Backstage uniquement)** : `buildPreviewTrack()` construit l'objet piste utilisé par l'aperçu local à partir de `mapItem()`, qui ne renvoie que `label`/`localFile`/`file`/`gain` — jamais `durationUnit`/`durationBeats`/`durationSeconds`/`bpm`/`beatsPerBar`. Sans `durationUnit`, `embrTransitionDurationSecFor()` (player.js) ne reconnaît aucune des trois unités possibles et retombe systématiquement sur la durée totale du fichier décodé, quel que soit le réglage choisi dans le formulaire. La page publique n'est pas concernée : elle lit `data.json` directement, où ces champs sont bien présents (le chemin de sauvegarde/publication les portait déjà correctement, seul l'aperçu local en était privé). Correctif : les mêmes champs de durée sont désormais explicitement recopiés dans `buildPreviewTrack()`, à l'identique du bloc de chargement/restauration existant plus bas dans ce même fichier (qui, lui, les portait déjà depuis le 24/08).
- **Bug 2 (tous les gabarits)** : la reprise après changement d'onglet (`visibilitychange`) relançait TOUJOURS `resumeEmbrVerticalAfterBackground()` sans savoir si quelque chose avait réellement été interrompu — or le Web Audio de ce moteur continue en pratique de jouer normalement en arrière-plan la plupart du temps (pas de vraie coupure), donc ce redémarrage systématique reconstruisait toute la programmation à chaque retour d'onglet, provoquant un redémarrage audible depuis le début du fichier alors que rien n'en avait besoin. Ajout d'une garde : on ne relance que si le contexte audio a été RÉELLEMENT suspendu par le navigateur (`ctx.state !== 'running'`) ou si le planificateur périodique a pris du retard au point de ne plus avoir de génération programmée à l'heure (`embrNextStartCtxTime` dépassé) — sinon, rien n'est touché, la lecture en cours continue exactement telle quelle. Le chemin de reprise pour un cas de VRAIE interruption (celui visé par le correctif du 29/08) reste inchangé et fonctionnel.

**Vérifications** : `node --check` OK sur `player.js` et le JS inline des 3 fichiers HTML. Suite complète des `test_*.js`/`test-*.js` rejouée, aucune régression. Balises équilibrées. Vérification en navigateur réel pour le bug 2 (compteur de `BufferSource` créées, via un patch du constructeur `AudioContext`) : cycle onglet caché→visible avec `ctx.state` resté `'running'` -- 0 nouvelle source créée, rien redémarré ; même cycle avec le contexte explicitement suspendu (`ctx.suspend()`) avant le retour -- 2 nouvelles sources créées (les deux boucles paires reconstruites), contexte relancé, bonne boucle toujours active -- confirme que le chemin de vraie reprise n'a pas été cassé par la garde ajoutée. Le bug 1 n'a pas pu être revérifié en direct dans l'outil Backstage lui-même (nécessite l'environnement complet de Jules-Antoine) — correction faite par lecture directe du code, en miroir exact du bloc de chargement déjà existant et déjà fonctionnel plus bas dans le même fichier.

**Rappel distribution** : `layerpitch-backstage.html` est dans `.gitignore` (fichier local, jamais suivi par git) — la correction du bug 1 n'apparaîtra jamais dans `git status`/`git diff`, seulement sur le disque local et via `downloadTesterKit()` pour les testeurs.

**Toujours aucune écoute réelle possible de ma part** — les deux corrections sont à confirmer par Jules-Antoine après rechargement forcé (Cmd+Shift+R) et republication depuis le Backstage pour le bug 1.

---

## [2026-09-02j] — Corrige deux bugs bloquants sur la forme d'onde des boutons de boucle en embranchement vertical

**Fichiers touchés** : `player.js` (chargement des boucles, boucle `embrLoopBtns.forEach`) ; `index.html`, `pack.html`, `layerpitch-backstage.html` (CSS : `.embr-wave-btn.active` ; `?v=` bumpée).

**Contexte** : retour en situation réelle sur le morceau "Monte en l'air et Pattes de Velours" (mode embranchement vertical, 2 boucles paires, aucun détour) — capture d'écran montrant les deux boutons de boucle en gabarit plat (fond uni/bordure simple), sans aucune trace de forme d'onde, alors que ce chantier (avant celui-ci, committé le 1er septembre) était censé l'avoir ajoutée. Confirmé par lecture directe du code, PAS par écoute — deux bugs indépendants, tous les deux présents depuis ce premier chantier :

**Corrigé** :
- **Bug 1, le plus grave : les canvases n'étaient jamais dessinés.** Les éléments `<canvas class="embr-wave-bg/fg">` existaient bien dans le HTML généré par `buildTrackRow` depuis le premier chantier, mais rien n'appelait jamais `renderWaveformPair()` dessus une fois les buffers audio décodés — contrairement à toutes les autres formes d'onde du fichier (séquentiel, Sfx, overlay de transition/détour de ce même mode), qui sont bien câblées. Résultat : chaque bouton "riche" restait un canvas entièrement transparent, indiscernable d'un bouton plat pour l'auditeur. Ajout d'une boucle `embrLoopBtns.forEach(...)` juste après le chargement des buffers de boucle, qui dessine bg/fg pour chaque bouton en gabarit riche à partir de son buffer déjà décodé — exactement le même appel que pour l'overlay de transition/détour du même mode, simplement jamais fait pour les boutons permanents du picker.
- **Bug 2, un conflit CSS qui aurait de toute façon masqué le bouton actif même une fois le bug 1 corrigé : `.embr-loop-btn.active` peint un fond uni `var(--accent)` sur TOUT bouton actif** — une règle héritée du gabarit plat d'origine (avant les canvases), qui continue de s'appliquer aux boutons riches puisqu'ils portent aussi la classe `.embr-loop-btn`. Les barres de la forme d'onde active étant elles-mêmes dessinées en `var(--accent)` (même couleur), elles auraient disparu par-dessus ce fond identique — en plus de recouvrir tout le canvas. Ajout de `.embr-wave-btn.active { background: transparent; color: var(--text); }`, qui laisse la forme d'onde elle-même porter le signal "actif" (via l'opacité de `.embr-wave-fg`, déjà en place) — exactement le même principe que `.sfx-rr-block.active`, qui ne touche déjà que la bordure ailleurs dans ce fichier.

**Précision utile pour la suite** : le seuil "boucle riche vs boucle courte/détour" dans `buildTrackRow` (`isShortLoop`, comparaison `l.bars < refBars`) ne s'appuie PAS sur le champ `isDetour` explicite désormais utilisé par le moteur de lecture (`embrPeerIndices`, avec repli sur `bars === refBars` seulement pour les données publiées avant ce champ). Sans effet sur ce morceau précis (les deux boucles ont `bars: 8`, valeur égale, donc `isShortLoop` retombe correctement à `false` pour les deux) — mais une piste avec deux vraies boucles paires (`isDetour: false` sur les deux) de longueurs *différentes* et non détour serait mal classée par ce raccourci. Signalé pour un chantier séparé, pas touché ici pour ne pas mélanger un correctif confirmé avec un changement de classification plus large.

**Vérifications** : `node --check` OK sur `player.js` et le JS inline des 3 fichiers HTML. Suite complète des `test_*.js`/`test-*.js` rejouée, aucune régression (le fichier `test_embr_vertical_waveform.js` existant documente lui-même, dans son en-tête, que jsdom ne fournit ni layout réel ni contexte canvas 2D — donc ne pouvait pas détecter ce bug précis, ce qui explique qu'il soit passé inaperçu jusqu'à un test en situation réelle). Balises équilibrées sur les 4 gabarits. Vérification en navigateur réel (page de test jetable, CSS complet d'index.html inliné, track "Monte en l'air et Pattes de Velours" reconstruite à l'identique avec 2 boucles paires factices) : les deux canvases affichent désormais de vrais pixels non transparents (658 pixels dessinés sur 14944, cohérent avec un fichier de test silencieux qui ne dessine que le plancher minimal de hauteur de barre) ; fond transparent confirmé sur le bouton actif (`rgba(0,0,0,0)` au lieu de l'accent uni) ; opacité du calque `fg` correctement différenciée (1 actif / 0.35 inactif) ; animation `embrWaveFill` `running` sur les deux boutons après lecture, en phase — page de test supprimée après vérification.

**Toujours aucune écoute réelle possible de ma part** — la lisibilité du contraste (bordure + forme d'onde plutôt que fond uni) sur le bouton actif, avec un vrai fichier audio (pas un silence de test), reste à confirmer par Jules-Antoine après rechargement forcé (Cmd+Shift+R).

---

## [2026-09-02i] — La boule de transition se colore pendant qu'elle joue réellement

**Fichiers touchés** : `player.js` (`currentTransitionEdge`/`seqMapLastCurrentIdx`, `activateSeqStage`, `performSeqBranchCut`, `scheduleSeqGeneration`/`scheduleSeqLabelUpdate`, `seqMapDrawEdges`, `stopSequential`) ; `index.html`, `pack.html`, `layerpitch-backstage.html` (CSS : `.seq-map-transition-dot.playing` + `@keyframes seqMapTransitionDotPulse` ; `?v=` bumpée) ; `test_seq_map.js` (nouveau scénario 7, 3 vérifications).

**Contexte** : retour en situation réelle sur [2026-09-02h] — "est-ce que la boule qui symbolise la transition peut se colorer lorsqu'elle joue ?". Jusqu'ici le disque de transition ([2026-09-02g]) avait une seule apparence, qu'un embranchement donné ait ou non son fichier de transition réellement en train de sonner à cet instant précis.

**Corrigé** :
- **`currentTransitionEdge`** : nouvel état (source→cible) posé par `activateSeqStage` uniquement pendant que le stade `'transition'` est le stade audible, retiré dès que n'importe quel autre stade (segment cible, ou un arrêt) devient actif à sa place.
- **Identité de l'arête portée par le bloc lui-même** : `performSeqBranchCut()` connaît `sourceSlotIdx`/`targetIdx` au moment du clic, mais l'activation réelle du stade `'transition'` n'arrive que plus tard (après le `setTimeout` de planification, `currentSlotIndex` ayant déjà basculé sur la cible entretemps) — ces deux index sont donc ajoutés au `forcedNextBlock` puis relayés tels quels à travers `scheduleSeqGeneration`/`scheduleSeqLabelUpdate` jusqu'à `activateSeqStage`, plutôt que redéduits a posteriori (impossible à ce stade, l'info n'existe nulle part ailleurs).
- **`seqMapLastCurrentIdx`** : mémorise le dernier index passé à `updateSeqMap()` pour pouvoir la redessiner à l'identique (même nœud "current") au moment précis où une transition démarre, sans faire remonter cet index jusqu'à `performSeqBranchCut()`.
- **`.seq-map-transition-dot.playing`** : `seqMapDrawEdges` compare `currentTransitionEdge` à chaque arête tracée et pose la classe uniquement sur celle concernée. CSS : la teinte de repos (accent, toujours visible dès qu'une transition existe sur ce chemin) reste inchangée — seul un battement d'opacité (`@keyframes seqMapTransitionDotPulse`, 0.8s, boucle) s'ajoute pendant que `.playing` est présent, cohérent avec "se colorer lorsqu'elle joue" sans perdre la lisibilité de repos déjà validée le round précédent.
- **`stopSequential()`** : `currentTransitionEdge` explicitement remis à `null` avant le `updateSeqMap(-1)` final — plus rien n'est audible à l'arrêt, jamais "en train de jouer".

**Vérifications** : `node --check` OK sur `player.js` et le JS inline des 3 fichiers HTML. Nouveau scénario 7 de `test_seq_map.js` (3 assertions : la boule existe mais n'est pas `.playing` avant tout clic ; elle devient `.playing` exactement pendant que le libellé affiché est celui de la transition elle-même ("Whoosh") ; elle redevient inerte une fois le segment cible (B1) devenu le stade courant) — 34/34 vérifications au total sur ce fichier, toutes vertes. Suite complète des `test_*.js`/`test-*.js` rejouée, aucune régression. Balises équilibrées sur les 4 gabarits. Vérification en navigateur réel (page de test jetable avec le CSS complet d'index.html inliné, cette fois, précisément pour pouvoir mesurer l'animation calculée) : `animationName: none` avant le clic, `seqMapTransitionDotPulse` (durée 0.8s) après, opacité mesurée en train d'osciller réellement (0.91 puis 0.49 quelques centaines de ms plus tard) — page de test supprimée après vérification.

**Précision apportée en cours de route** : à une question de Jules-Antoine sur une capture montrant le mode branching vertical (bouton bleu "Retour au calme...") — confirmé par lecture du diff que ce chantier ne touche aucune ligne liée à `.embr-loop-btn`/embr-vertical, et que le bleu observé est simplement `--accent: #2f80c0` propre au thème du Backstage (`--accent: #c9713c` orange côté public), pas une régression.

**Toujours aucune écoute réelle possible de ma part** — la cadence du battement (0.8s) et sa lisibilité à l'œil, notamment sur des transitions très courtes où elle pourrait n'être visible que le temps d'un ou deux cycles, restent à confirmer par Jules-Antoine après rechargement forcé (Cmd+Shift+R).

---

## [2026-09-02h] — Carte des chemins : nœuds cliquables, restreints aux vraies options depuis la position courante

**Fichiers touchés** : `player.js` (nouvelle fonction `handleSeqBranchChoice`, refactorisation du clic sur `.seq-branch-btn`, réécriture de `updateSeqMap` avec `nodeStateCls`/`attachSeqMapNodeClicks`) ; `index.html`, `pack.html`, `layerpitch-backstage.html` (CSS : `.seq-map-node.selectable`, `.seq-map-node.pending` ; `?v=` bumpée) ; `test_seq_map.js` (nouveau scénario 6, 5 vérifications).

**Contexte** : retour en situation réelle sur [2026-09-02g] — "fais en sorte que les nœuds soient cliquables : en surbrillance pour celui qui est en train de jouer, les prochaines possibilités qui peuvent être choisies sont visibles, les possibilités non possibles n'apparaissent pas à l'écran (on découvre le chemin au fur et à mesure)". Le "n'apparaît pas à l'écran" était déjà couvert par la révélation progressive existante ([2026-09-02b]) — restait à rendre les nœuds réellement cliquables, et uniquement ceux qui représentent une vraie option depuis la position courante.

**Corrigé** :
- **`handleSeqBranchChoice(targetId, currentSlot)`** : extrait du gestionnaire de clic des boutons `.seq-branch-btn` (logique inchangée : marque le choix en attente, bascule immédiate si `quantization === 'immediate'`, sinon coupe au prochain temps fort) — désormais partagé entre les boutons ET les nœuds de la carte, un seul point de vérité pour "choisir une branche".
- **`.seq-map-node.selectable`** : à chaque rendu de la carte, `updateSeqMap` calcule `selectableIds` à partir de `currentSlot.nextOptions` (l'emplacement en cours de lecture) et pose la classe uniquement sur les nœuds qui y figurent réellement — le nœud courant lui-même n'est jamais cliquable (`isCurrent` exclu), et un nœud déjà visité mais qui n'est plus une option valable depuis la position actuelle (ex. A après être passé sur B, si B ne repart pas vers A) reste affiché mais redevient inerte.
- **`.seq-map-node.pending`** : au clic, le nœud choisi porte la même classe "en attente" que le bouton correspondant, retirée dès que la bascule effective a lieu — cohérence visuelle entre les deux façons de choisir (bouton ou nœud).
- **`attachSeqMapNodeClicks`** : ré-attache les écouteurs à chaque reconstruction du HTML de la carte (nœuds recréés à chaque `updateSeqMap`, comme le reste du contenu).

**Vérifications** : `node --check` OK sur `player.js` et le JS inline des 3 fichiers HTML. Nouveau scénario 6 de `test_seq_map.js` (5 assertions : nœud courant non cliquable, vraie option cliquable, clic sur un nœud déclenche la même bascule qu'un clic sur le bouton correspondant — vérifié par l'avancement réel de lecture jusqu'à `B1` —, nœud visité mais non-option redevient inerte, nouvelle vraie option redevient cliquable) — 31/31 vérifications au total sur ce fichier, toutes vertes. Suite complète des `test_*.js`/`test-*.js` rejouée, aucune régression. Balises équilibrées sur les 4 gabarits. Vérification en navigateur réel (page de test jetable, `LayerPlayerCore.buildTrackRow`/`initTrackPlayer` avec un vrai fichier WAV silencieux décodable) : lecture démarrée sur A, seul B (vraie option) porte `.selectable` ; clic sur B → `.pending` apparaît immédiatement, puis la lecture bascule réellement sur `B1` ; après la bascule, B devient le nœud courant non cliquable, A (option de "Retour" depuis B) reste cliquable, C devient cliquable — comportement identique à la couverture jsdom, page de test supprimée après vérification.

**Toujours aucune écoute réelle possible de ma part** — le comportement au clic (position des nœuds, taille de la zone cliquable en mode carte complète comme en mode compact dégradé) reste à confirmer par Jules-Antoine après rechargement forcé (Cmd+Shift+R).

---

## [2026-09-02g] — Couleurs par boucle de retour, flèches de sens, titre "SFX", et un merge suite à une publication concurrente

**Fichiers touchés** : `player.js` (`seqMapDrawEdges` : palette de couleurs stables par boucle de retour, marqueurs SVG `<marker>` pour les flèches de sens sur toutes les arêtes, disque de transition agrandi ; `buildTrackRow` : titre "SFX" ajouté au-dessus des deux blocs `.track-sfx-row`) ; `index.html`, `pack.html`, `layerpitch-backstage.html` (CSS : règle de couleur retirée de `.seq-map-edge.transition`, épaisseur du liseré du disque de transition augmentée ; `?v=` bumpée) ; `layerpitch-i18n.js` (nouvelle clé `sfxRowLabel`).

**Contexte** : dernier lot de retours en situation réelle sur [2026-09-02f] : "oublie la couleur du liseré bleu, laisse le rond mais un peu plus visible", "pour les retours, donne-leur une couleur à chacun choisie aléatoirement", "sur les liserés, ajoute une flèche pour bien expliciter le sens de lecture", "au-dessus des SFX, rajoute un titre (SFX) — valable pour TOUS les modes de lecture à partir du moment où on y inclut des SFX".

**Corrigé** :
- **Couleur retirée du liseré** : `.seq-map-edge.transition { stroke: var(--accent); }` supprimée -- toutes les arêtes restent grises par défaut, le disque redevient le seul indicateur de transition (agrandi de 5px à 6.5px de rayon, liseré blanc épaissi à 2px pour rester net à cette taille).
- **Couleur par boucle de retour, "aléatoire" mais stable** : chaque boucle de retour reçoit une couleur tirée d'une palette de 6 teintes (bleu/vert/violet/rouge/sarcelle/jaune, l'orange volontairement exclu car déjà réservé à `var(--accent)` pour l'état "courant"), choisie via un hash stable de la paire source→cible plutôt qu'un vrai `Math.random()` -- la carte étant redessinée à chaque changement d'état (`activateSeqStage`), un tirage réellement aléatoire aurait fait changer la couleur d'une même boucle à chaque bascule, illisible. Même paire = toujours la même couleur.
- **Flèches de sens** : un `<marker>` SVG par couleur utilisée (une par couleur de boucle de retour, plus une grise par défaut pour les arêtes "en avant"), posé en bout de chemin via `marker-end` -- indique sans ambiguïté le sens de lecture sur toutes les arêtes, pas seulement les retours.
- **Titre "SFX"** : ajouté au-dessus des deux blocs `.track-sfx-row` du fichier (celui du gabarit séquentiel/vertical-random/embranchement-vertical déplacé en [2026-09-02f], et celui du gabarit statique/vertical classique, non touché jusqu'ici) -- réutilise la classe `.track-intensity-label` déjà existante (même style que les autres titres de section) plutôt que d'en créer une nouvelle, dans un `.track-intensity-block` pour l'espacement, cohérent avec le reste du fichier.

**Incident, résolu proprement** : le `git push` a été rejeté (`non-fast-forward`) -- 6 commits étaient apparus sur `origin/main` entre-temps, tous automatiques ("Mise à jour version des scripts moteur", "Mise à jour data.json/events.json") : le bouton "Sauvegarder / publier" du Backstage pousse ces fichiers directement sur GitHub via l'API, indépendamment de mes commits `git`. `git merge origin/main` : seul `index.html`/`pack.html` avaient un vrai conflit (la chaîne `?v=`, résolu en gardant la plus récente, la mienne) -- `player.js`/`layerpitch-i18n.js` ont fusionné automatiquement sans perte (vérifié : aucun marqueur de conflit restant, contenu des deux sessions bien présent). Suite complète rejouée après fusion avant de pousser -- tout vert. `collection.html` (modification locale non commise, préexistante depuis le début de cette session, sans rapport avec ce chantier) mise de côté via `git stash` avant le merge puis restaurée à l'identique après, pour ne rien perdre.

**Vérifications** : `node --check` OK sur `player.js`, `layerpitch-i18n.js` et les 3 fichiers HTML. Symétrie i18n FR/EN : 719/719, 0 écart. Balises équilibrées. Suite complète des 27 fichiers `test_*.js`/`test-*.js` rejouée deux fois (avant et après le merge) — tous « ALL CHECKS PASSED » les deux fois, aucune régression. Vérification visuelle réelle dans le navigateur, reconstruction de "Robot Adventure" avec un `sfxIds` peuplé : confirmé à l'œil le disque de transition orange bien visible, deux boucles de retour de couleurs nettement différentes (rouge/vert dans cette exécution) avec flèches pointant vers le haut dans le bon sens, et le titre "SFX" correctement positionné au-dessus du bouton "Impacts".

**Toujours aucune écoute/navigation réelle possible de ma part** — rendu final, notamment le choix des 6 couleurs de la palette en usage prolongé, à confirmer par Jules-Antoine après rechargement forcé.

---

## [2026-09-02f] — Boucles de retour en tracé orthogonal, repère de transition, stingers repositionnés, libellé de mode manquant corrigé

**Fichiers touchés** : `player.js` (`seqMapDrawEdges` : boucles de retour en droites/angles droits au lieu d'une courbe bézier, marqueur circulaire de transition ajouté ; `buildTrackRow` : ligne des stingers déplacée après `seqMapHtml`) ; `index.html`, `pack.html`, `layerpitch-backstage.html` (CSS `.seq-map-transition-dot` ; `?v=` bumpée à nouveau) ; `layerpitch-i18n.js` (nouvelle clé `modeSequentialBranching`, manquante depuis l'introduction de `getModeLabel()`, sans rapport avec ce chantier mais trouvée en le testant).

**Contexte** : encore des retours en situation réelle sur [2026-09-02e], une fois le cache correctement invalidé cette fois :
1. "Avec des chemins de retour avec des droites et des angles droits, ce sera plus clair, notamment dans les systèmes complexes" — la courbe en "U" de l'entrée précédente, bien que prévisible, restait une courbe.
2. "Le liseré bleu (transition), pas très parlant. On pourrait rajouter un nœud, une forme différente, comme un rond" — la simple teinte de trait ne se voyait pas assez.
3. "Ce serait plus logique d'avoir les stingers en dessous de la carte des chemins" — actuellement affichés juste après le statut de chargement, avant tout le reste.
4. Repéré au passage sur la même capture (pas remonté explicitement, mais visible) : le tag de mode affichait littéralement "modeSequentialBranching" au lieu d'un libellé lisible.

**Corrigé** :
- **Boucles de retour en tracé orthogonal** : `M ax ay L ax loopY L bx loopY L bx by` (trois segments droits) au lieu d'une courbe de Bézier — descend tout droit, traverse à l'horizontale, remonte tout droit. Mêmes points d'ancrage (bas des nœuds) et le même étalement vertical par boucle qu'avant (voir [2026-09-02e]).
- **Marqueur de transition** : un petit disque (`<circle>`, rayon 5px, couleur `--accent`, liseré `--bg-card`) posé au milieu de chaque arête qui a un fichier de transition associé, en plus (pas à la place) de la teinte de trait déjà en place — forme délibérément différente des nœuds rectangulaires pour ne jamais se confondre avec un emplacement. Infobulle au survol identique au badge déjà présent sur les boutons d'embranchement (`branchTransitionBadgeTitle`, réutilisée).
- **Stingers repositionnés** : la ligne `.track-sfx-row` (uniquement pour les modes séquentiel/vertical-random/embranchement-vertical, qui partagent ce chemin de rendu) déplacée de juste après le statut de chargement vers la toute fin du gabarit, après `seqGraphHtml`/`seqMapHtml`/`voiceGraphHtml`/`embrVertBlockHtml` selon le mode — cohérent pour les trois modes concernés, pas seulement le séquentiel à embranchement. Le second bloc `.track-sfx-row` (modes statique/vertical classique, gabarit avec forme d'onde/barre de progression) n'a pas été touché, non concerné par la demande.
- **Libellé de mode manquant** : `getModeLabel()` (`player.js:361`) prévoyait déjà `t('modeSequentialBranching')` pour un morceau séquentiel avec au moins un embranchement configuré, mais cette clé n'a jamais existé dans `layerpitch-i18n.js` -- `t()` retombe sur le nom brut de la clé quand elle est absente, d'où "modeSequentialBranching" affiché tel quel. Corrigée par une clé cohérente avec les autres libellés de mode : "séquentiel à embranchement" (FR) / "sequential branching" (EN).

**Vérifications** : `node --check` OK sur `player.js`, `layerpitch-i18n.js` et les 3 fichiers HTML. Symétrie i18n FR/EN : 718/718, 0 écart. Balises équilibrées. Suite complète des 27 fichiers `test_*.js`/`test-*.js` rejouée — tous « ALL CHECKS PASSED », aucune régression (aucun test existant ne référence `.stinger-btn`/`.track-sfx-row`, confirmé par grep avant de déplacer ce bloc). Vérification visuelle réelle : reconstruction de la structure "Robot Adventure" avec un `sfxIds` peuplé -- confirmé par inspection directe du DOM l'ordre final des blocs (`track-desc` → `status` → `loop-count-block` → `voice-graph` (séquentiel) → `seq-map` → `track-sfx-row`, stingers bien en dernier), le libellé de mode "séquentiel à embranchement" au lieu de la clé brute, et le marqueur de transition présent avec la bonne infobulle.

**Toujours aucune écoute/navigation réelle possible de ma part** — rendu final à confirmer par Jules-Antoine après rechargement forcé.

---

## [2026-09-02e] — Cache navigateur jamais invalidé + boucles de retour réécrites en "U" prévisible

**Fichiers touchés** : `player.js` (`seqMapDrawEdges` : boucles de retour sorties/rentrées par le bas des nœuds, sous toute la grille, au lieu du bord droit avec décalage fixe ; `updateSeqMap` : marge verticale recalculée sur le nombre réel d'arêtes de retour) ; `index.html`, `pack.html`, `layerpitch-backstage.html` (CSS : bordure pointillée retirée pour "pas encore atteint", fond `--accent-soft` ajouté pour le nœud "courant" ; balise `?v=` de `player.js`/`layerpitch-i18n.js`/`layerpitch-help.js` bumpée à deux reprises) ; `layerpitch-backstage.html` (`--accent-soft` ajoutée à son `:root`, absente jusqu'ici).

**Contexte, découvert en situation réelle (encore)** : après [2026-09-02d], Jules-Antoine a rechargé le Backstage local et vu... exactement le même rendu cassé qu'avant (hachures de forme d'onde, texte superposé) malgré le push. **Diagnostic** : la balise `<script src="player.js?v=1788277095265">` n'avait pas changé depuis avant TOUS les commits de la journée — même URL en cache, donc le navigateur continuait de servir l'ancienne version malgré le fichier changé côté serveur. Corrigé en bumpant `?v=` sur les trois scripts versionnés (mécanisme identique à `updateScriptVersions()` côté Backstage, fait ici à la main). **Point de vigilance pour la suite** : toute future session touchant `player.js`/`layerpitch-i18n.js`/`layerpitch-help.js` doit penser à bumper `?v=` avant de considérer le travail terminé, sans quoi ce même piège se reproduira — ce n'est pas fait automatiquement par un `git commit`/`git push` classique.

Une fois le cache réellement invalidé, Jules-Antoine a pu voir le vrai rendu à jour et remonté un dernier lot de retours, précis : "les boucles de retour sont tracées un peu aléatoirement", "les cadres pourraient ne pas être en pointillés", "l'évènement joué peut être en surbrillance".

**Corrigé** :
- **Boucles de retour** (le point principal, "moche et difficilement compréhensible") : entièrement réécrites. L'ancienne version sortait par le bord DROIT du nœud source avec un décalage horizontal fixe (+26px) quelle que soit la distance à parcourir — donnait un crochet serré pour un retour proche et un arc à peine perceptible pour un retour lointain, d'où l'impression d'aléatoire. Nouvelle version : chaque boucle sort par le BAS du nœud source, plonge sous TOUTE la grille (pas seulement sous la ligne des deux nœuds concernés, pour ne jamais risquer de croiser un nœud intermédiaire d'une autre ligne), et remonte par le BAS du nœud cible — une courbe de Bézier dont les deux points de contrôle sont directement sous chaque nœud (tangentes verticales aux deux extrémités), ce qui donne systématiquement la même forme en "U" symétrique quelle que soit la distance. Plusieurs boucles vers la même cible s'empilent en arcs imbriqués de profondeur croissante (vérifié : 62px/80px/98px pour 3 retours vers le même nœud, incrément constant) plutôt que de se chevaucher.
- **Bordures pointillées retirées** : les nœuds "pas encore atteints" ont désormais une bordure pleine comme les autres, la distinction se fait uniquement par la couleur/le fond du nœud "courant".
- **Nœud courant en surbrillance** : fond `var(--accent-soft)` ajouté (déjà défini dans `index.html`/`pack.html` ; ajouté au `:root` de `layerpitch-backstage.html`, qui ne l'avait pas — teinte claire calculée à partir de son propre `--accent` bleu pour rester cohérent avec son thème d'éditeur).

**Vérifications** : `node --check` OK sur `player.js` et les 3 fichiers HTML. Balises équilibrées. Suite complète des 27 fichiers `test_*.js`/`test-*.js` rejouée — tous « ALL CHECKS PASSED », aucune régression (ce chantier ne touche que la disposition géométrique du SVG et le CSS, pas la structure DOM/les classes déjà testées). Vérification visuelle réelle dans le navigateur, reproduction de deux structures (3 emplacements/3 retours vers le même nœud comme "Robot Adventure", et 4 emplacements/3 retours empilés) : géométrie des chemins SVG inspectée directement (coordonnées `d` des `<path>`) plutôt que par capture d'écran — confirmé les boucles empilées à 62/80/98px avec incrément constant de 18px, toutes symétriques (mêmes points de contrôle en x que leurs ancrages), aucune superposition. Bordure pleine et fond de surbrillance confirmés par inspection du style calculé (`getComputedStyle`).

**Toujours aucune écoute/navigation réelle possible de ma part** — rendu final à confirmer par Jules-Antoine après un rechargement forcé (Cmd+Shift+R), le cache navigateur ayant déjà causé une confusion dans cette même session.

---

## [2026-09-02d] — Carte des chemins : forme d'onde retirée des nœuds, libellés d'arête en infobulle (deuxième passe de retours en situation réelle)

**Fichiers touchés** : `player.js` (`updateSeqMap` : plus de canvas/rendu de forme d'onde sur les nœuds, hook de progression dans `activateSeqStage` supprimé ; `seqMapDrawEdges` : libellés en `<title>` au lieu de `<text>` toujours visible, boucles de retour étalées verticalement par index) ; `index.html`, `pack.html`, `layerpitch-backstage.html` (CSS `.seq-map-node-bg`/`.seq-map-node-fg`/`.seq-map-edge-label` retirées, devenues mortes) ; `test_seq_map.js` (assertions ajustées).

**Contexte** : suite directe de l'entrée [2026-09-02c] ci-dessous, toujours en testant en situation réelle. Deux retours supplémentaires de Jules-Antoine sur le même écran :
1. "Les emplacements des chemins n'ont pas besoin d'avoir la forme d'onde" — décision de la retirer aussi des nœuds de la carte globale (déjà retirée des boutons d'embranchement dans l'entrée précédente), pas seulement une question de goût : les formes d'onde affichées ne reflétaient de toute façon pas fidèlement le fichier réel ("celle de Corridor s'arrête à mi-chemin, tout comme celle de Battle").
2. "Ici, c'est tout moche, tout recroquevillé" (capture d'écran à l'appui) : les libellés d'arête (`<text>` SVG toujours affiché dans la version 02c) se chevauchaient et devenaient illisibles dès que plusieurs embranchements/retours étaient proches sur le même écran — la piste "Robot Adventure" réelle a 5 arêtes (1 aller normal, 1 aller avec transition, 3 retours) qui finissaient toutes à des hauteurs très proches.

**Corrigé** : les nœuds n'affichent plus que le libellé de l'emplacement (l'état courant/visité/pas-encore-atteint se lit uniquement via la bordure — pleine et colorée pour "courant", pointillée sinon). Les libellés d'arête passent d'un `<text>` SVG toujours visible à un `<title>` (infobulle native au survol) posé sur le `<path>` — même principe que le graphe Wwise du vertical-random, qui n'affiche lui-même aucun libellé permanent sur ses connecteurs. Les boucles de retour (arêtes en arrière) sont désormais étalées verticalement (chacune un peu plus bas que la précédente, via un compteur incrémenté à chaque arête en arrière rencontrée) plutôt que de toutes converger vers la même hauteur — `updateSeqMap()` réserve la marge verticale correspondante en fonction du nombre réel d'arêtes de retour, pas d'une marge fixe comme avant.

**Vérifications** : `node --check` OK sur `player.js` et les 3 fichiers HTML. Balises équilibrées. Suite complète des 27 fichiers `test_*.js`/`test-*.js` rejouée — tous « ALL CHECKS PASSED », aucune régression. `test_seq_map.js` : les assertions sur la présence/absence de canvas remplacées par des vérifications d'absence totale (nœuds ET boutons) ; le scénario de dégradation vérifie maintenant la présence/absence du positionnement en couches (`style.left`) plutôt que celle des canvases, devenue non pertinente. Vérification visuelle réelle dans le navigateur, reproduction de la structure exacte de "Robot Adventure" (5 arêtes dont 3 retours) : confirmé mécaniquement 0 élément `<text>` dans le SVG (contre plusieurs qui se chevauchaient avant), 5 infobulles `<title>` correctement posées (une par arête), 0 canvas dans les nœuds.

**Reste ouvert, suggéré par Jules-Antoine, pas traité ici** : une fois la carte fiable et bien présentée, les boutons d'embranchement du "zoom local" (`.seq-branch-btn`) pourraient devenir redondants si les nœuds de la carte eux-mêmes devenaient cliquables pour choisir la cible. Nécessiterait de transformer les `<div class="seq-map-node">` (purement informatifs aujourd'hui) en éléments interactifs et d'y migrer la logique de clic actuellement sur `renderSeqBranchOptions()` — chantier distinct, à traiter séparément une fois la carte elle-même validée.

**Toujours aucune écoute/navigation réelle possible de ma part** — lisibilité finale (espacement, taille des nœuds en repli étroit) à confirmer par Jules-Antoine.

---

## [2026-09-02c] — Corrections en situation réelle sur la carte des chemins (02b) : forme d'onde retirée des boutons, carte reprise en flowchart

**Fichiers touchés** : `player.js` (`renderSeqBranchOptions` : forme d'onde retirée, badge conservé ; réécriture complète de `updateSeqMap`/nouvelles `seqMapComputeLayout`/`seqMapForwardTargets`/`seqMapDrawEdges`, ancienne `drawSeqMapLines` supprimée) ; `index.html`, `pack.html`, `layerpitch-backstage.html` (`<style>` inline, classes `.seq-map*` réécrites) ; `test_seq_map.js` (assertions adaptées + nouveaux contrôles géométriques).

**Contexte** : Jules-Antoine a testé l'entrée [2026-09-02b] ci-dessous en situation réelle (Backstage local, piste "Robot Adventure" déjà en production avec un vrai cycle #1→#2→#3→#1/#2) et remonté deux problèmes concrets, plus une maquette de référence pour ce chantier (et une seconde pour le vertical à embranchement déjà livré) qui expliquait d'où venait la mention bleu/violet du brief initial :
1. Les boutons d'embranchement affichaient une forme d'onde qu'il ne voulait pas voir là — retirée, gardée uniquement sur la carte globale.
2. La carte ne montrait pas la possibilité de revenir de #3 vers #1. **Diagnostic réel, pas supposé** : l'arête existait bel et bien dans le SVG (vérifié en inspectant le DOM live), mais la disposition en grille en flux de la version 02b plaçait tous les nœuds sur une seule colonne dans le panneau étroit du Backstage (~90-190px de large selon l'endroit) — l'arête de retour, calculée en ligne droite entre les centres des nœuds, se retrouvait exactement superposée aux nœuds intermédiaires et à toutes les autres arêtes, invisible en pratique.

**Décisions prises avec Jules-Antoine avant de recoder** (une maquette pour la carte des chemins ET une pour le vertical à embranchement montraient toutes deux bleu actif/violet transition, la seconde ajoutant même un vert pour le détour) :
- Couleurs : `var(--accent)` partout, sur les deux chantiers (celui-ci et l'embr-vertical déjà livré, qui reste inchangé malgré sa propre maquette bleu/violet/vert) — un seul langage visuel "actif" dans tout le site plutôt que 3 palettes concurrentes.
- Disposition : abandon de la grille en flux au profit d'un vrai flowchart en couches, correspondant à la maquette ET résolvant le bug à la racine.

**Nouvelle architecture de la carte** : `seqMapComputeLayout()` fait un parcours en largeur (BFS) depuis le premier emplacement découvert (ou l'emplacement 0 en révélation complète Backstage avant toute lecture) sur le sous-graphe des emplacements révélés, affectant à chaque nœud une colonne (distance en arêtes avant) et une ligne (ordre de première découverte au sein de sa colonne — `seqVisitedSlotIds` étant un `Set`, son ordre d'itération EST l'ordre d'insertion, aucun état supplémentaire nécessaire). Positions calculées entièrement en JS et posées en `left`/`top` inline sur des `.seq-map-node` en position absolue, plutôt que mesurées après coup via `getBoundingClientRect()` comme `drawWwiseLines()` — un vrai graphe avec boucles a besoin de connaître la colonne de la cible AVANT de choisir comment tracer l'arête. `seqMapDrawEdges()` route une arête "en avant" (colonne cible > colonne source) en courbe en S classique, et une arête "en arrière ou même colonne" (boucle/retour) en boucle large sortant et rentrant par la droite des deux nœuds — jamais une ligne droite. `.seq-map-graph` devient une fenêtre défilable (`overflow-x:auto`) sur `.seq-map-canvas`, dimensionné explicitement par JS à la taille réelle du graphe — un graphe plus large que la carte se parcourt au scroll plutôt que de s'effondrer.

**Second bug trouvé pendant la vérification visuelle réelle de cette correction** (pas par Jules-Antoine cette fois, avant qu'il ne le voie) : la boucle d'une arête de retour dépasse volontairement la dernière ligne de nœuds (elle sort par le bas) — sans marge verticale réservée, `overflow-y:hidden` sur `.seq-map-graph` la coupait tout simplement, invisible malgré des coordonnées SVG parfaitement correctes. Corrigé en réservant une marge (`rowH * 0.7`) à la hauteur totale du canevas dès qu'au moins une arête de retour existe.

**Vérifications** : `node --check` OK sur `player.js` et les 3 fichiers HTML. Balises `<div>`/`<button>`/`<svg>` équilibrées. Suite complète des 27 fichiers `test_*.js`/`test-*.js` rejouée — tous « ALL CHECKS PASSED », aucune régression. `test_seq_map.js` mis à jour : les assertions sur la forme d'onde des boutons remplacées par des vérifications d'absence ; nouvelles assertions géométriques sur le scénario de cycle (colonnes distinctes pour A/B, 2 arêtes tracées, l'arête de retour identifiée comme une vraie boucle via ses points de contrôle bezier plutôt qu'une simple ligne) — ciblant précisément le bug remonté. **Vérification visuelle réelle dans un vrai navigateur (pas seulement jsdom)**, avec de vrais fichiers WAV silencieux générés à la volée (les buffers factices jsdom ne passent pas un vrai `decodeAudioData`) : reproduction de la structure exacte de "Robot Adventure" (3 emplacements, cycle complet), positions de colonnes confirmées par inspection directe du DOM (`left: 0/136/272px`), 5 arêtes tracées dont 3 boucles de retour aux points de contrôle nettement décalés sous la ligne principale (y≈50.8 contre y=20 pour la ligne des nœuds) -- le second bug (clipping vertical) trouvé et corrigé à cette étape, confirmé résolu par une seconde vérification visuelle après correctif.

**Toujours aucune écoute/navigation réelle possible de ma part** — calage fin du flowchart (espacements, lisibilité des libellés d'arête qui se chevauchent un peu en repli étroit) à valider par Jules-Antoine.

---

## [2026-09-02b] — Carte globale des chemins + aperçu enrichi des embranchements (mode séquentiel)

**Fichiers touchés** : `player.js` (`renderSeqBranchOptions` enrichie, nouvelles `seqMapVisibleSlotIndices`/`updateSeqMap`/`drawSeqMapLines`, hooks dans `activateSeqStage`/`stopSequential`/`playSequential`/le chargement des buffers séquentiels, nouveau template `seqMapHtml` dans `buildTrackRow`) ; `index.html`, `pack.html`, `layerpitch-backstage.html` (`<style>` inline : `.seq-branch-btn-rich`/`.seq-branch-transition-badge`/`.seq-map*`) ; `layerpitch-backstage.html` (`buildPreviewTrack()` : nouveau champ `seqMapFullReveal: true`) ; `layerpitch-i18n.js` (2 nouvelles clés `shared`) ; nouveau `test_seq_map.js`.

**Contexte** : le mode séquentiel à embranchement avait deux angles morts — les boutons d'embranchement n'offraient aucun aperçu de leur cible (juste un libellé), et rien ne montrait la structure globale du morceau (juste l'emplacement courant et les options immédiates). Demande de Jules-Antoine : (1) chaque bouton d'option affiche une forme d'onde statique de la cible + un badge si un fichier de transition existe pour cette paire précise ; (2) une carte globale du morceau (nœuds = emplacements, arêtes = avancement linéaire ou embranchement), avec révélation progressive côté public (effet de découverte) mais structure complète d'emblée côté Backstage (outil de vérification pendant la construction), gérant les cycles (un embranchement peut pointer vers un emplacement déjà visité) et une dégradation au-delà d'un certain nombre de nœuds visibles.

**Correction sur l'énoncé initial** : le brief affirmait une convention déjà établie "couleur active = bleu, badge transition = violet" côté vertical à embranchement (chantier précédent). Vérifié avant de coder quoi que ce soit : ça ne correspond à rien dans le code. `--accent` vaut orange (`#c9713c`) sur les pages publiques (`index.html`/`pack.html`) et bleu (`#2f80c0`) uniquement dans le chrome propre à l'éditeur Backstage (`layerpitch-backstage.html`) — deux palettes différentes selon la page, pas une convention "actif = bleu". Le seul violet du projet entier est un bouton de bascule sans rapport (texte de présentation Intro/Outro/Slot/Transition), dont le commentaire d'origine dit explicitement "violet plutôt que le bleu --accent déjà associé au choix visiteur/embranchement **ailleurs dans ce fichier**" — confirmant que le bleu est une convention de l'éditeur Backstage lui-même, pas de l'état de lecture. Il n'existe aucun concept de "badge" pour les transitions dans le travail précédent (une ligne overlay complète, pas un badge). Repris `var(--accent)` partout ici aussi (déjà la bonne pratique du chantier précédent), sans inventer de bleu/violet. **Fait latent découvert au passage, hors périmètre** : l'aperçu "Écouter" du Backstage rend directement dans la page (pas d'iframe), donc une forme d'onde "active" y peint déjà en bleu (`--accent` du Backstage) alors que la même piste peint en orange sur les pages publiques — incohérence silencieuse préexistante du chantier précédent, signalée mais non corrigée ici (hors scope de cette session).

**Architecture retenue** :
- **Zoom local** : `slotBuffers[targetIdx]`/`transitionBuffers[slotIdx][oi]` sont déjà décodés au chargement (aucune nouvelle logique de décodage) — `renderSeqBranchOptions` lit simplement cet état existant. Aperçu statique via `renderWaveformPair(bg, null, buf, ...)` — `fgCanvas` volontairement omis (`null`), premier appel réel de ce chemin dans le fichier (déjà géré gracieusement par la fonction, jamais exercé avant). Badge conditionné à `!!transitionBuffers[slotIdx][oi]` (buffer réellement chargé, pas juste le champ JSON déclaré).
- **Carte globale** : aucun suivi d'historique n'existait avant ce chantier — nouveau `seqVisitedSlotIds` (Set), alimenté dans `activateSeqStage` à chaque nouvel emplacement audible, remis à zéro seulement sur un vrai redémarrage (`playSequential(false)`), pas sur un simple Stop (ce qui a été découvert reste affiché). Révélation : `seqMapFullReveal` (flag posé par `buildPreviewTrack()` côté Backstage uniquement) affiche tous les `segmentSlots` d'emblée ; côté public, uniquement visités + courant + options immédiates depuis le courant. Nœuds disposés en grille en flux (pas de disposition en colonnes fixes comme le Wwise Voice Graph du vertical-random, inadaptée à un graphe avec boucles) ; arêtes dessinées en SVG via `drawSeqMapLines()`, qui reprend directement la technique de `drawWwiseLines()` (chemins bezier calculés depuis `getBoundingClientRect()` des nœuds réels, redessinés au premier rendu et au redimensionnement via `ResizeObserver`) — une arête de retour vers un nœud déjà affiché plus tôt dans le flux se contente de pointer vers l'élément DOM existant (jamais de duplication de nœud), ce qui donne gratuitement le rendu correct des cycles. Arête "linéaire" (emplacement sans `nextOptions`) approximée par "index suivant dans le tableau" plutôt que de rejouer la logique de saut des emplacements vides de `pickNextSegmentSlot()` — suffisant pour un aperçu topologique, pas pour une simulation exacte du moteur. Bug trouvé et corrigé pendant l'implémentation : le premier emplacement de l'observer de redimensionnement de la carte avait été posé au même endroit que celui du Wwise Graph, avant la déclaration `const` des éléments DOM de la carte plus bas dans le fichier — `ReferenceError` (TDZ) à l'exécution, corrigé en déplaçant l'observer juste après cette déclaration.

**Seuils de dégradation choisis** (nombre de nœuds simultanément visibles) : ≤6 = taille pleine (96×40px) ; 7-14 = interpolation linéaire jusqu'à un plancher ; 15+ = repli compact (puces sans forme d'onde, juste le libellé). Seuils plus généreux que le vertical à embranchement (2-4 puis 7) : une structure séquentielle à embranchements affiche naturellement plus de nœuds simultanés qu'un vertical à embranchement n'a de boucles, sans que ce soit pour autant illisible.

**Vérifications** : `node --check` OK sur `player.js`, `layerpitch-i18n.js`, les blocs `<script>` inline d'`index.html`/`pack.html`/`layerpitch-backstage.html`, et les deux fichiers de test touchés/ajoutés. Balises `<div>`/`<button>`/`<svg>` équilibrées sur les 4 fichiers modifiés. Symétrie i18n FR/EN : 717/717, 0 écart (2 nouvelles clés `shared` : `seqMapLabel`, `branchTransitionBadgeTitle`) — éditées à la main dans `layerpitch-i18n.js` plutôt que via l'outil dédié `layerpitch-i18n-editor.html` (son en-tête dit "jamais à la main"), faute d'accès interactif à cet outil depuis cette session ; structure/formatage repris à l'identique des clés existantes, symétrie vérifiée programmatiquement, mais Jules-Antoine peut vouloir rouvrir cet outil pour confirmer que rien n'y a été perturbé. Suite complète des 27 fichiers `test_*.js`/`test-*.js` rejouée (26 existants + le nouveau) — tous « ALL CHECKS PASSED », aucune régression ; `test_seq_branching.js`/`test_seq_transitions.js`/`test_backstage_seq_transitions.js` explicitement revérifiés sans modification. Nouveau `test_seq_map.js` (22 vérifications) : aperçu enrichi + badge sélectif, révélation progressive (rien avant lecture, puis courant+options immédiates seulement), cycle (retour vers un nœud déjà visité : pas de duplication, bon nœud remis en "current"), révélation complète Backstage sans avoir joué, dégradation à 6/10/20 emplacements. Un scénario de cycle a d'abord échoué à l'exécution pour une raison de timing (pas de logique) : une boucle qui embranche avec `bars:1` fait coïncider sa propre durée avec l'unité de quantification — course déjà documentée dans `test_seq_branching.js`, corrigée en alignant mes fixtures sur `bars:2` comme le fait déjà ce fichier. Vérification visuelle réelle dans le navigateur (page de test ad hoc générée puis supprimée) : badge de transition, distinction courant/visité/révélé, repli compact à 20 nœuds, tous confirmés à l'œil.

**Aucune écoute/navigation réelle possible de ma part** (pas d'oreille, jsdom ne rend ni pixel ni son) — calage visuel de la carte, lisibilité du repli compact, et cohérence bleu(Backstage)/orange(public) déjà signalée plus haut, à valider par Jules-Antoine avant publication.

**Rappel distribution** : mêmes règles que le chantier précédent — `layerpitch-backstage.html` reste dans `.gitignore`, propagation aux testeurs via `admin-beta-console.html` → `downloadTesterKit()`.

**Rappel `backstage.css`** : diff fourni séparément à Jules-Antoine pour resynchronisation manuelle. **Signalé au passage** : cette copie sandbox n'a pas encore reçu le CSS du chantier vertical à embranchement précédent (`.embr-loop-btn` etc.) — déjà en retard avant même ce chantier-ci, donc en retard sur deux chantiers désormais, pas seulement celui-ci.

---

## [2026-09-02] — Forme d'onde en mode vertical à embranchement (trois états, dégradation N boucles)

**Fichiers touchés** : `player.js` (picker riche/compact dans `buildTrackRow`, moteur embr-vertical : `updateEmbrButtonsUI`, `applyEmbrWaveAnimation`/`pauseEmbrWaveAnimation`, `showEmbrTransitionOverlay`/`removeEmbrTransitionOverlay`, `showEmbrDetourWaveRow`/`removeEmbrDetourWaveRow`, hooks dans `playEmbrVertical`/`resumeEmbrVerticalAfterBackground`/`stopEmbrVertical`/`fadeOutCurrentDetour`/`performEmbrSwitch`) ; `index.html`, `pack.html`, `layerpitch-backstage.html` (`<style>` inline, CSS `.embr-wave-btn`/`.embr-wave-bg`/`.embr-wave-fg`/`.embr-transition-row`/`.embr-detour-wave-row`/`@keyframes embrWaveFill`) ; nouveau `test_embr_vertical_waveform.js` ; `test_embr_vertical_engine.js` (3 assertions adaptées, voir plus bas).

**Contexte** : le mode `embranchement-vertical` était le seul mode de lecture sans aucun visuel de progression (`.embr-loop-btn` = bouton texte simple). Demande de Jules-Antoine : trois états visuels — (1) boucles "paires" empilées verticalement, chacune avec sa forme d'onde qui avance en continu, verrouillées en phase entre elles, la boucle active en pleine couleur et les autres grisées mais jamais figées ; (2) au moment d'une bascule avec fichier de transition, une ligne overlay en surimpression joue sa propre progression pendant que les deux boucles concernées passent en filigrane (jamais mises en pause) ; (3) au déclenchement d'un détour (boucle plus courte que la référence), une ligne dédiée apparaît sous les boucles paires (elles-mêmes grisées mais toujours animées) et disparaît au retour à la référence.

**Correction faite en cours de session sur l'énoncé initial** : demandé de synchroniser le CSS entre `layerpitch-backstage.html` et `backstage.css`. Vérifié que `.embr-loop-btn` n'existait dans aucun des deux — mais creusé plus loin, `layerpitch-backstage.html` a un vrai lecteur d'aperçu live (bouton "Écouter" par piste, `togglePreview`/`buildPreviewTrack`, réutilise `buildTrackRow`/`initTrackPlayer` à l'identique d'`index.html`/`pack.html`) dont le bloc de style dit explicitement "repris à l'identique d'index.html/pack.html" — `.embr-loop-btn` en était absent, lacune préexistante non liée à cette demande (un compositeur prévisualisant une piste embr-vertical depuis le Backstage voyait des boutons sans aucun style). Comblée avant d'ajouter le CSS riche. Le vrai trio à synchroniser est donc `index.html` + `pack.html` + `layerpitch-backstage.html`, pas `layerpitch-backstage.html` + `backstage.css` comme initialement énoncé — `backstage.css` (fichier vendor de l'outil Electron sandbox, `~/Desktop/LayerPitch/SandBox/.../vendor/backstage.css`) n'est chargé par aucun `<link>` dans `layerpitch-backstage.html` et reste hors dépôt git ; non modifié directement, diff fourni séparément à Jules-Antoine pour resynchronisation manuelle (convention déjà en place, voir rappels `backstage.css` plus bas dans ce journal).

**Architecture retenue** : les boutons `.embr-loop-btn` existants restent les éléments cliquables (aucun changement sur `data-loop-idx`/le tableau `embrLoopBtns`/la logique de clic) — seules les boucles "paires" (`embrPeerIndices`) reçoivent, en mode riche, deux canvases (`.embr-wave-bg`/`.embr-wave-fg`) réutilisant les fonctions déjà hissées au niveau module (`computeWaveformPeaks`/`drawWaveformCanvas`/`renderWaveformPair`, introduites pour le lecteur Sfx). Progression continue (état 1) : animation CSS `@keyframes embrWaveFill` en boucle infinie sur `.embr-wave-fg`, calée une seule fois par (re)démarrage de l'horloge de phase (`applyEmbrWaveAnimation()`, appelée dans `playEmbrVertical`/`resumeEmbrVerticalAfterBackground`) — jamais recalculée à chaque bascule, puisque le verrouillage de phase entre boucles paires ne change pas quand seul le gain change (`refreshEmbrGains`). `updateEmbrButtonsUI()` ne masque plus (`display:none`) le bouton audible pour les lignes riches (uniquement la classe `.active`) — le masquage reste inchangé pour les boucles détour et pour le gabarit compact. Transition (état 2) et détour minuté (état 3a) : même mécanisme one-shot `clip-path` que `animateMainWaveProgress()` du lecteur Sfx, ligne injectée/retirée dynamiquement (`showEmbrTransitionOverlay`/`showEmbrDetourWaveRow`). Détour "en boucle jusqu'à un bouton" (état 3b) : traité comme une mini-boucle paire à lui seul (animation infinie, durée = celle du buffer). Trois points d'arrêt couverts pour la ligne de détour (retour naturel, interruption volontaire, Stop pendant un détour — ce dernier ne passe pas par `fadeOutCurrentDetour()`, nettoyage ajouté séparément dans `stopEmbrVertical()`). Bug trouvé et corrigé en cours de route : une transition annulée par un nouveau clic sans transition propre laissait l'ancienne ligne overlay affichée indéfiniment — `removeEmbrTransitionOverlay()` appelée maintenant inconditionnellement en tête de `performEmbrSwitch()`.

**Seuils de dégradation choisis** (2 à N boucles paires) : 2-4 boucles = hauteur pleine 34px (reprend `.seq-block`, gabarit de référence du projet) ; 5-7 boucles = hauteur interpolée linéairement jusqu'à un plancher de 20px (en dessous, les barres de `drawWaveformCanvas()` fusionnent visuellement, plus reconnaissable comme une forme d'onde) ; 8 boucles et plus = repli intégral sur le gabarit compact actuel (texte seul, aucune forme d'onde, aucun scroll). Calcul fait une fois côté `buildTrackRow`, hauteur exposée via une variable CSS inline (`--embr-row-h`) plutôt que des classes par palier.

**Vérifications** : `node --check` OK sur `player.js` et sur les blocs `<script>` inline d'`index.html`/`pack.html`/`layerpitch-backstage.html`. Balises `<div>`/`<button>` équilibrées sur les 4 fichiers (`player.js` 69/69 et 17/17 ; `index.html` 24/24 et 5/5 ; `pack.html` 22/22 et 8/8 ; `layerpitch-backstage.html` 489/489 et 123/123). Symétrie i18n FR/EN inchangée (715 clés de chaque côté, 0 écart — aucune nouvelle clé, le texte des boutons ne change pas). Suite complète des 26 fichiers `test_*.js`/`test-*.js` rejouée — tous « ALL CHECKS PASSED », aucune régression. Nouveau `test_embr_vertical_waveform.js` (30 vérifications : rendu riche 3 boucles, animation continue lancée/mise en pause, overlay de transition avec filigrane et durée mesurée, détour minuté avec interruption précoce, détour en boucle avec fin sur bouton, Stop pendant un détour, dégradation 5 et 8 boucles). `test_embr_vertical_engine.js` : 3 assertions historiques sur le masquage `display:none` du bouton audible adaptées au nouveau contrat (jamais masqué en mode riche, seule la classe `.active` bascule) — comportement volontairement changé, pas une régression. Vérification visuelle réelle dans le navigateur (page de test ad hoc générée puis supprimée, appelant directement `buildTrackRow` avec 2/3/5/8 boucles paires) : empilement plein écran, dégradation de hauteur à 5 boucles, repli compact à 8 boucles, distinction couleur active/grisée toutes confirmées à l'œil.

**Aucune écoute réelle possible de ma part** (pas d'oreille, jsdom ne rend ni pixel ni son) — calage de phase visuel et lisibilité du plancher à 20px à valider par Jules-Antoine avant publication.

**Rappel distribution** : `layerpitch-backstage.html` reste dans `.gitignore` (fichier local, jamais suivi par git) — ces modifications n'apparaissent pas dans `git status`/`git diff`. Propagation vers les testeurs via le mécanisme déjà en place (`admin-beta-console.html` → `downloadTesterKit()`), rien de nouveau construit ici.

**Rappel `backstage.css`** : diff du bloc ajouté à `layerpitch-backstage.html` fourni séparément à Jules-Antoine pour resynchronisation manuelle de sa copie sur le Bureau — non fait automatiquement (fichier hors dépôt, hors du périmètre surveillé par cette session).

---

## [2026-09-01r] — Dérive tests backstage vs UI : les 8 échecs résolus (7 tests réécrits pour le master/détail + reconnaissance bpm/mesures restaurée)

**Fichiers touchés** : `test_backstage_branch_collapse_and_header_order.js`, `test_backstage_seq_transitions.js`, `test_backstage_custom_cut_fade_roundtrip.js`, `test_backstage_slot_collapse.js`, `test_backstage_default_collapse.js`, `test_backstage_intro_outro_collapse_and_reorder.js`, `test_backstage_filename_bpm_bars_detection.js`, `test_backstage_slot_autolabel.js`, `layerpitch-backstage.html`

**Contexte** : 8 fichiers `test_backstage_*.js` échouaient (constaté en lançant la suite complète). Investigation directe en session (demande explicite de Jules-Antoine : « faisons le carrément ici », plutôt qu'en tâche d'arrière-plan). Cause commune identifiée pour 6 des 8 : la restructuration en disposition maître-détail des morceaux/emplacements/Intro-Outro/Sfx (18/08, `seqSelectedSlotIndex` / `manageLibrarySelectedId`) et le passage de la réorganisation de la bibliothèque de morceaux au glisser-déposer (`wireOrgDragDrop`, 20/08) sont postérieurs à l'écriture de ces tests, qui ciblaient encore l'ancienne UI à plat. Les 2 derniers relevaient d'une cause différente et plus sérieuse (voir plus bas).

**Corrigé (dérive de design documentée du 18/08, tests réécrits sans autre question)** :
- `test_backstage_branch_collapse_and_header_order.js` : ajout d'un clic `select-seq-slot` pour sélectionner l'emplacement avant d'interroger son détail (sinon rien n'est rendu). Bug réel trouvé au passage et corrigé dans `layerpitch-backstage.html` (~ligne 3969) : le conteneur `branchesBody` n'avait pas la classe de base `list-block-body`, donc `.list-block-body.collapsed { display:none }` ne s'appliquait jamais — régression d'un bug déjà corrigé le 13/08. Section « ordre complet de l'en-tête » entièrement réécrite (voir décision utilisateur ci-dessous) : `toggle-collapse-track`/`move-track-up`/`move-track-down` confirmés absents du code par grep — le repli d'un morceau est désormais la sélection dans `#libraryMaster` et la réorganisation se fait par glisser-déposer sur cette même liste (testé dans `test_backstage_intro_outro_collapse_and_reorder.js` ci-dessous), donc l'en-tête de la carte de détail n'a plus que titre+mode à gauche, Écouter+Supprimer à droite — vérifié explicitement.
- `test_backstage_seq_transitions.js` : même correctif (clic de sélection avant lecture du détail).
- `test_backstage_custom_cut_fade_roundtrip.js` : le marqueur de texte littéral extrait du mapping de publication ne correspondait plus — un champ `originalFileName` a été inséré entre `file` et `gain` dans l'objet `outro` depuis l'écriture du test (fonctionnalité réelle inchangée, juste le texte exact à retrouver). Marqueur mis à jour.
- `test_backstage_slot_collapse.js` : entièrement réécrit. L'ancien mécanisme (`collapsedSlotIds`, `toggle-collapse-slot`, `data-role="slotBody"`, suivi par id) n'existe plus du tout (confirmé par grep) — remplacé par la sélection exclusive `seqSelectedSlotIndex`, qui suit la POSITION et non l'identité (différence de comportement réelle et assumée du nouveau design, testée explicitement).
- `test_backstage_default_collapse.js` : entièrement réécrit. Le bootstrap `collapsedSlotIds`/`collapsedSfxIds` n'a plus lieu d'être (la sélection exclusive n'affiche qu'un seul élément par défaut, sans Set à maintenir). Le volet Sfx attachés (`trackSfxToggle`/`trackSfxBody`) est réécrit comme entrée virtuelle `'sfx'` de la même liste maître-détail.
- `test_backstage_intro_outro_collapse_and_reorder.js` : entièrement réécrit. Intro/Outro réécrits comme deux entrées virtuelles (`seqIntro`/`seqOutro`) de la liste maître-détail (`introBlockBody`/`introBlockToggle`/`outroBlockBody`/`outroBlockToggle` confirmés absents par grep). La réorganisation de la bibliothèque de morceaux est réécrite avec de vrais événements `dragstart`/`dragover`/`drop`/`dragend` simulés sur les lignes `.org-row` de `#libraryMaster`, en s'appuyant sur le comportement déterministe de jsdom (`getBoundingClientRect()` renvoie des zéros, donc un dépôt place toujours l'élément juste après la cible).

Décision utilisateur (proposée avec 3 options — réécrire / supprimer / laisser en l'état) : **réécrire pour le nouveau design**, appliquée aux 5 tests ci-dessus qui en avaient besoin.

**Corrigé (perte de fonctionnalité non documentée, confirmée avec Jules-Antoine avant d'y toucher)** : `test_backstage_filename_bpm_bars_detection.js` et `test_backstage_slot_autolabel.js` testaient la reconnaissance du bpm/nombre de mesures dans le nom d'un fichier déposé (`parseAudioFilenameHints`, demande du 13/08 — nomenclature « ..._160bpm_40M.wav ») et le retrait du jeton correspondant du libellé auto-généré de l'emplacement. Cette fonction **n'existait plus du tout** dans `layerpitch-backstage.html` (confirmé par grep) et sa disparition ne portait aucun commentaire de refonte à proximité (contrairement au 18/08) — signe probable d'une perte accidentelle plutôt que d'un choix. Question posée explicitement à Jules-Antoine : confirmé non-voulu (« Non, je ne savais pas — remets-la »). Restauré dans `layerpitch-backstage.html` (~ligne 2687, près de `titleFromFilename`) :
- `parseAudioFilenameHints(filename)` : détecte `\d+bpm` et `\d+M`, chacun isolé par un séparateur (`_`/espace/`-`) ou une limite de chaîne des deux côtés (évite le faux positif `Room40Meters`). Exposée sur `window` pour les tests.
- `titleFromFilenameStrippingHints(filename)` : même rôle que `titleFromFilename()`, en retirant d'abord les jetons repérés ci-dessus du libellé affiché.
- Re-branchées dans le gestionnaire de dépôt groupé de la liste maître des emplacements (`wireBatchDrop(slotsMasterHost, ...)`, ~ligne 4242) : `slot.bpm` et `alt.bars` sont désormais repris automatiquement du nom de fichier quand détectés, `bars` retombant sur 8 par défaut sinon (comportement inchangé depuis avant cette restauration).
Les deux tests, adaptés à la disposition maître-détail (zone de dépôt `[data-role="segmentSlotsMaster"]`, sélection de l'emplacement avant lecture de son détail), passent désormais intégralement.

**Vérifications** : suite complète (23 fichiers `test_*.js`) relancée après coup — tous « ALL CHECKS PASSED » (ou équivalent, `test_backstage_content_nav_redesign.js` utilise son propre marqueur « Tous les tests sont passes. »). Syntaxe des blocs `<script>` inline de `layerpitch-backstage.html` validée après modification (extraction + `new Function()` sur chacun). Commit `42c12b2` toujours non poussé sur GitHub — ce travail s'y ajoutera au prochain commit, en attente d'un « ok » explicite pour le push.

## [2026-09-01q] — Kit testeur : dossier `api/*.js` absent du zip, corrigé et retesté

**Fichiers touchés** : `admin-beta-console.html` (`downloadTesterKit()`)

**Contexte** : lacune signalée le 1er septembre en même temps que l'ajout de l'interface d'invitation permanente (voir `docs/infrastructure.md`, entrée du 1er septembre), jamais retestée depuis. `downloadTesterKit()` ne bundlait que `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js` et `player.js`. Or `loadPostgresReadScripts()` (`layerpitch-backstage.html`) charge en plus neuf scripts via des balises `<script src="./api/*.js">` relatives (`supabase-client.js`, `auth.js`, `tracks.js`, `packs.js`, `collections.js`, `sfx.js`, `settings.js`, `adreels.js`, `site-data.js`) dès qu'une fonctionnalité Postgres est utilisée (connexion par lien magique, écriture double, invitation testeur). Un testeur ouvrant le kit en `file://` (double-clic, jamais un serveur) aurait obtenu des 404 sur ces neuf scripts au premier essai.

**Corrigé** : après les quatre fichiers existants, `downloadTesterKit()` liste maintenant le contenu réel du dossier `api/` du repo testeur via l'API GitHub (`GET contents/api`, déjà utilisé ailleurs dans ce fichier via `getContent()`) plutôt que de coder une liste figée — tout fichier `api/*.js` supplémentaire qui apparaîtrait plus tard (comme `api/supabase-client.js`, ajouté le jour même par l'entrée [2026-09-01p] ci-dessous) sera inclus automatiquement, sans repasser par ce script. Chaque fichier est ajouté au zip sous son chemin complet (`api/xxx.js`), JSZip reconstituant de lui-même la sous-arborescence `api/` à côté de `layerpitch-backstage.html` — nécessaire puisque les chemins chargés sont relatifs (`./api/xxx.js`, pas à plat à la racine).

**Vérifications, réellement, pas seulement en lecture de code** : kit reconstitué à la main avec les 10 fichiers `api/*.js` du repo actuel (dont `purchases.js`, absent de la liste d'origine — confirme l'intérêt de lister le dossier plutôt que coder les noms), placé dans un dossier propre reproduisant la structure attendue (`layerpitch-backstage.html` + `api/`). L'outil de navigateur disponible dans cet environnement ne pouvant pas exécuter de JS sur un `file://` situé hors de son propre dossier de travail (rendu en "static snapshot"), le kit a été servi via un petit serveur HTTP statique local plutôt qu'ouvert directement en `file://` — seule différence avec le scénario réel d'un testeur, la résolution des chemins relatifs étant identique dans les deux cas. Flux "Envoyer le lien magique" déclenché pour de vrai (email de test) : les neuf scripts `api/*.js` chargés par `loadPostgresReadScripts()` répondent tous 200 (confirmé via l'onglet réseau), aucun 404. Seule erreur observée : 422 Supabase ("Signups not allowed for this instance"), attendue pour un email de test et sans rapport avec le bundling. Re-testé une seconde fois après le refactor concurrent du client Supabase partagé (entrée [2026-09-01p] ci-dessous, faite en parallèle de cette correction) — même résultat, 9/9 scripts en 200.

---

## [2026-09-01p] — Client Supabase partagé : fin du bug de course sur la détection de session par lien magique

**Fichiers touchés** : nouveau `api/supabase-client.js` ; `api/auth.js`, `api/tracks.js`, `api/packs.js`, `api/purchases.js`, `api/adreels.js`, `api/collections.js`, `api/sfx.js`, `api/settings.js` (chacun ne crée plus son propre client) ; `index.html`, `pack.html` (les deux `loadPostgresReadScripts()`/`loadPurchaseScripts()`), `collection.html`, `layerpitch-backstage.html`, `library.html`, `auth-test.html` (chargent désormais `api/supabase-client.js` en premier)

**Contexte** : nettoyage du design smell signalé le 1er septembre (Session B, voir l'entrée [2026-09-01e] ci-dessous) — chaque module `api/*.js` instanciait son propre `createClient()`, donc plusieurs instances `GoTrueClient` coexistaient sur toute page chargeant plusieurs modules à la fois (le backstage en charge 8 d'un coup). Symptôme navigateur : avertissement "Multiple GoTrueClient instances detected". Conséquence réelle déjà observée : ces instances se disputaient la détection de session depuis le fragment d'URL (`#access_token=...`) après un clic sur un lien magique, avec un échec intermittent de connexion au premier chargement (contourné à l'époque par un rechargement de page, jamais corrigé à la racine).

**Corrigé** : `api/supabase-client.js` expose un unique `window.LayerPitchSupabaseClient.getClient()` (mêmes `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`, même paresse d'instanciation qu'avant). Les 8 modules `api/*.js` qui touchaient Supabase ont chacun leur ancien bloc `const SUPABASE_URL = ...; let client = null; function getClient() {...}` remplacé par un simple relais vers ce client partagé — aucun changement de leur API publique, aucun appelant à toucher. Les 6 points de chargement front (dynamiques via `loadScript()` ou `<script>` statiques) chargent maintenant `api/supabase-client.js` juste après le SDK Supabase CDN et avant tout autre `api/*.js`, dans l'ordre exact où l'ordre de chargement compte.

**Vérifié** : simulation du pire cas dans un vrai navigateur (page de test isolée, chargeant les 8 modules en même temps, comme le fait `layerpitch-backstage.html`) — `window.LayerPitchSupabaseClient.getClient()` retourne la même instance à chaque appel, **zéro** avertissement "Multiple GoTrueClient instances" en console. La course structurelle est éliminée à la racine : un seul client ne peut pas se disputer la détection du fragment d'URL avec lui-même. Test réel d'un clic sur un vrai lien magique (boîte mail) non refait dans cette passe — hors de portée de l'environnement qui a fait ce correctif ; à confirmer par Jules-Antoine au prochain essai de connexion (`auth-test.html` ou le backstage, avec plusieurs modules chargés). Suite de tests existante (23 fichiers `test_*.js`/`test-*.js`) rejouée — mêmes 8 échecs préexistants (`test_backstage_*.js`, marqueurs de code désynchronisés du fichier backstage en évolution constante, sans rapport avec ce correctif), aucune régression.

**Complété dans la foulée** : `loadPurchaseScripts()` (`pack.html`) n'avait jamais eu de cache-busting sur ses modules locaux, contrairement à `loadPostgresReadScripts()` juste au-dessus dans le même fichier (entrée [2026-09-01l]) — même risque que celui déjà trouvé et corrigé pour l'autre loader (fichier `api/*.js` modifié puis rechargé en cache par le navigateur pendant une session de dev), latent tant que `PURCHASES_ENABLED` reste à `false` mais réel dès qu'il repasse à `true`. Étendu par cohérence : `loadScript()` de `loadPurchaseScripts()` ajoute désormais `?v=<timestamp>` sur ses fichiers locaux (jamais sur le SDK CDN), même logique que l'autre loader.

**Non fait, hors périmètre** : le cache-busting `?v=<timestamp>` que `loadPostgresReadScripts()` applique aux autres modules locaux (entrée [2026-09-01l]) n'a pas été étendu à `api/supabase-client.js` dans les deux loaders qui l'utilisent (`loadPurchaseScripts()` dans `pack.html` n'en a jamais eu pour aucun de ses modules, comportement laissé inchangé) — cohérent avec le reste de chaque loader, pas une régression introduite ici.

---

## [2026-09-01p] — Audit des trois tâches en arrière-plan : client partagé, `invite-tester`, kit testeur

**Fichiers touchés** : `supabase/functions/invite-tester/index.ts` (fusion manuelle), `admin-beta-console.html` (`downloadTesterKit()` : lecture `api/*.js` depuis le repo personnel plutôt que celui du testeur)

**Contexte** : les trois tâches spawnées en arrière-plan (client Supabase partagé, durcissement `invite-tester`, kit testeur) ont tourné dans des sessions séparées. Audit demandé par Jules-Antoine avant tout commit.

**Tâche 1 (client Supabase partagé)** : vérifiée complète et correcte — nouveau `api/supabase-client.js`, tous les `api/*.js` + `library.html` + `auth-test.html` migrés, plus aucun `createClient()` dupliqué. Aucune intervention nécessaire.

**Tâche 2 (durcissement `invite-tester`)** : travail fait dans un worktree Git isolé (`.claude/worktrees/heuristic-meitner-068cb8`) jamais recopié dans le dossier principal — trouvé en cherchant pourquoi le fichier local ne reflétait pas le changement attendu. **Complication additionnelle** : ce worktree était parti d'une base antérieure au correctif `redirectTo` de l'entrée `[2026-09-01n]` — sa version avait donc perdu ce correctif en le remplaçant par la vérification `is_admin()`. **Fusionné manuellement, vérifié ligne par ligne** : `is_admin()` (RPC) remplace bien `ADMIN_EMAIL`, ET `redirectTo` reste transmis à `inviteUserByEmail()`. Point opérationnel important : **Jules-Antoine avait déjà redéployé et testé en conditions réelles la version SANS `redirectTo`** (confirmé dans le rapport de la tâche — invitation admin acceptée, invitation non-admin rejetée) — la version actuellement en ligne sur Supabase est donc de nouveau exposée au bug `localhost:3000` tant que la version fusionnée n'est pas redéployée à son tour.

**Tâche 3 (kit testeur)** : incomplète, un vrai trou de logique plutôt qu'un oubli cosmétique. La tâche lit intelligemment le contenu du dossier `api/` plutôt qu'une liste figée (bonne idée, conforme à la consigne initiale) — mais lisait ce dossier depuis le **repo du testeur**, alors que `ENGINE_FILES` (la liste poussée par `promote()`/`rollout()` vers chaque repo testeur) n'a jamais été étendue pour y inclure `api/*.js`. Le dossier lu aurait donc toujours été vide en pratique. Décision prise avec Jules-Antoine (option B plutôt que A) : lire `api/*.js` depuis le **repo personnel** de Jules-Antoine plutôt que celui du testeur — ces fichiers sont strictement identiques pour tout le monde (même URL/clé Supabase en dur, rien de propre à un testeur), inutile de les dupliquer dans chaque repo testeur et de coupler des fichiers indépendants du système GitHub-par-testeur au pipeline que la Décision 5 prévoit justement de remplacer à terme. Vérifié que `api/` existe réellement sur `Julzantoine/layerpitch` (confirmé via l'API GitHub publique) — l'option B fonctionne dès maintenant, pas besoin d'attendre un premier push supplémentaire.

**Vérifications** : `node --check` OK sur le bloc `<script>` inline d'`admin-beta-console.html`. Forme de réponse de l'API GitHub Contents vérifiée par un appel réel (`curl` public) contre `type`/`name`/`path`, cohérente avec ce que le code consomme. Suite de tests existante (23 fichiers) rejouée après les trois audits — mêmes 8 échecs préexistants, aucune régression.

**À faire par Jules-Antoine avant de considérer ce chantier clos** : redéployer `supabase/functions/invite-tester/index.ts` (version fusionnée, contenu prêt à copier-coller) via l'éditeur du dashboard Supabase — la version actuellement en ligne n'a que la moitié du correctif.

---

## [2026-09-01o] — `fan_profiles` : 3ᵉ table du modèle de comptes à profils multiples

**Fichiers touchés** : nouveau `supabase/migrations/20260901180000_fan_profiles.sql`

**Contexte** : lacune signalée le 1er septembre (Session B/C) — le modèle réel de comptes à profils multiples (`extensions-roadmap.md` 5.4, acté le 30 juillet) prévoit trois profils, pas deux : Fan (nom provisoire) + Compositeur + Game dev. Le schéma initial (31 août) n'avait construit que `composer_profiles`/`buyer_profiles`. Décision de Jules-Antoine : table séparée plutôt qu'une fusion du profil Fan avec `buyer_profiles`. Usage prévu du profil Fan communiqué par Jules-Antoine : achat d'Albums OST Adaptive Edition plus tard — **l'UI acheteur correspondante (bibliothèque, lecteur, playlists, bouton "Figer") reste explicitement hors périmètre de cette entrée**, actée comme un chantier à part entière à construire plus tard (`extensions-roadmap.md` 5.5).

**Différence de nature avec `composer_profiles`/`buyer_profiles`, traitée dans le schéma** : ces deux-là restent optionnels, activables à la demande. Le profil Fan est "toujours présent par défaut sur tout compte" (`extensions-roadmap.md` 5.4) — création automatique à l'inscription plutôt qu'une activation manuelle. `handle_new_user()` (trigger `auth.users` → `profiles`, posé le 31 août) étendu pour créer aussi la ligne `fan_profiles` dans le même mouvement. Backfill des comptes déjà existants inclus dans la migration.

**Vérifications** : migration appliquée, cache de schéma PostgREST rechargé automatiquement (`scripts/apply-migrations.js`, corrigé plus tôt dans la session). Backfill confirmé (2 comptes existants → 2 `fan_profiles`, correspond aux comptes de Jules-Antoine et du compte de test créé plus tôt aujourd'hui). Trigger testé en conditions réelles : création d'un compte `auth.users` de test → `profiles` et `fan_profiles` créés automatiquement tous les deux, confirmé puis nettoyé (suppression en cascade vérifiée, retour à 2/2). Suite de tests existante (23 fichiers) rejouée — mêmes 8 échecs préexistants, aucune régression.

**Hors périmètre, actée explicitement** : aucune UI, aucune RPC d'écriture pour ce profil (rien à écrire dessus pour l'instant — juste un socle de compte). Le "nom à définir" (Fan est un nom de travail jugé réducteur) reste à trancher au moment d'exposer ce profil dans l'interface.

---

## [2026-09-01n] — SMTP personnalisé configuré, bug de redirection d'invitation corrigé, isolation multi-compositeur confirmée avec un vrai second compte

**Fichiers touchés** : `supabase/functions/invite-tester/index.ts` (accepte et transmet `redirectTo`), `api/auth.js` (`inviteTester` transmet `redirectTo` ; nouvelle fonction `describeFunctionError()` — dépile le vrai message d'erreur JSON d'une Edge Function en échec, masqué jusqu'ici par le message générique du SDK), `layerpitch-backstage.html` (appel `inviteTester` passe `window.location.href`)

**Contexte** : Jules-Antoine a testé pour de vrai l'invitation d'un second compte (sa propre seconde adresse email, pas un testeur externe — décision actée avec lui, pas de vrai testeur à ce jour).

**Bug 1 — lien d'invitation cassé, trouvé au premier essai réel** : le clic sur le lien reçu par email redirigeait vers `http://localhost:3000/...`, jamais atteint (rien ne tourne sur ce port). Cause : `adminClient.auth.admin.inviteUserByEmail(email)` était appelé sans option `redirectTo` — Supabase retombe alors sur la Site URL par défaut du projet, jamais configurée pour ce cas d'usage (contrairement à `signInWithMagicLink`, qui passait déjà `emailRedirectTo` correctement depuis le 31 août). Corrigé : `redirectTo` remonté du client jusqu'à l'Edge Function, même URL que pour le lien magique classique. **Point opérationnel découvert par la même occasion** : le compte avait malgré tout été créé par ce premier essai (l'email a bien été envoyé et reçu) — une seconde tentative d'invitation a donc échoué avec "A user with this email address has already been registered", ce qui est le comportement correct ; contournement pour Jules-Antoine : utiliser le lien magique classique (compte déjà existant) plutôt que réinviter.

**Bug 2, trouvé en diagnostiquant le premier** : le message d'erreur affiché pour toute Edge Function en échec était générique ("Edge Function returned a non-2xx status code"), masquant le vrai message JSON renvoyé par la fonction (`error.message` du SDK Supabase ne dépile pas automatiquement le corps de la réponse d'erreur pour les `FunctionsHttpError`). Corrigé par `describeFunctionError()`, qui relit `error.context` (la `Response` brute) quand disponible. Sans ce correctif, le diagnostic du bug 1 aurait été beaucoup plus lent — le message générique ne donnait aucune piste.

**SMTP personnalisé configuré** (Resend, décidé et exécuté par Jules-Antoine suite à deux nouvelles limites de débit atteintes en testant aujourd'hui) : domaine `layerpitch.com` vérifié sur Resend (DNS ajoutés manuellement dans Cloudflare, "Auto configure" écarté pour ne pas donner d'accès OAuth à Resend sur le compte Cloudflare), "Enable click tracking" laissé actif faute de pouvoir le désactiver à la création du domaine (signalé, à revisiter depuis les réglages du domaine une fois vérifié — risque théorique de griller un jeton à usage unique si un scanner de sécurité suit le lien avant l'utilisateur, pas encore rencontré en pratique). Clé API Resend créée en "Sending access" scopée à `layerpitch.com` (pas "Full access"), jamais transmise à Claude Code. SMTP renseigné dans Supabase (Authentication → Emails), confirmé actif par le message "rate limit increased to 30 emails per hour" affiché par Supabase lui-même.

**Isolation multi-compositeur validée en conditions réelles, pas seulement simulée** : une fois connecté dans le backstage avec la seconde adresse (lecture Postgres activée, `ensure_composer_profile()` provisionnant son propre `composer_profile`), la Bibliothèque musicale affiche "Aucun morceau pour l'instant" — zéro fuite du contenu du compte principal (14 morceaux). Confirme en conditions réelles ce que les tests simulés (`FAKE_OWNER`, `scripts/test-rpc-upserts.js`) avaient déjà montré indépendamment.

**Vérifications** : `node --check` OK sur les 3 fichiers JS/TS touchés. Edge Function redéployée manuellement par Jules-Antoine via l'éditeur du dashboard (pas de CLI Supabase configurée dans cet environnement). Chemin d'erreur avant correctif testé en isolation (session absente → "Non authentifié." affiché correctement au lieu du message générique, confirmé avant que Jules-Antoine ne retente pour de vrai).

**Statut** : les trois points de suivi de cette session (écriture double avec réglages/réseaux sociaux, SMTP, isolation avec un vrai second compte) sont bouclés. Reste, sans urgence (aucun testeur réel) : décocher "Enable click tracking" sur le domaine Resend, valider le mécanisme de kit téléchargeable avec le contenu Postgres le jour du premier vrai testeur.

---

## [2026-09-01m] — Interface d'invitation testeur permanente dans le backstage

**Fichiers touchés** : `layerpitch-backstage.html` (nouveau bloc "Inviter un testeur (admin)", câblage sur `window.LayerPitchAuth.inviteTester()`)

**Contexte** : point de cadrage tranché avec Jules-Antoine avant de coder — aucun testeur réel n'existe encore sur le système GitHub actuel, donc pas de stratégie de migration individuelle à construire. `inviteTester()` (Edge Function `invite-tester`, Décision 4) existait et fonctionnait déjà depuis le 31 août, mais uniquement testée via `auth-test.html`, un outil jetable — jamais d'interface permanente dans le vrai backstage.

**Changement** : nouveau bloc dans le backstage, même style que les blocs "Écriture Postgres"/"Stockage média" déjà en place — champ email + bouton, réutilise `api/auth.js` tel quel (aucune modification de l'Edge Function elle-même, son contrôle `ADMIN_EMAIL` reste inchangé et reste la seule barrière réelle, côté serveur — l'UI ne fait qu'appeler la fonction existante, ne duplique aucune vérification côté client qui pourrait être contournée).

**Vérifications** : `node --check` OK, balises `<div>` équilibrées (489/489). Testé en navigateur (onglet neuf) : rendu de l'interface confirmé, comportement par défaut inchangé sur le reste du fichier. Chemin de sécurité vérifié en conditions réelles : appel `inviteTester()` sans session active → rejeté par l'Edge Function (non-2xx), confirmant que le contrôle serveur fonctionne indépendamment de l'UI. Invitation réelle **non testée dans cette entrée** (aurait créé un vrai compte Supabase et envoyé un vrai email — laissé à Jules-Antoine, avec son accord explicite, le jour où il a un vrai testeur à inviter). Suite de tests existante (23 fichiers) rejouée — mêmes 8 échecs préexistants, aucune régression.

**Reste ouvert, pas tranché** : où les testeurs récupèrent concrètement leur copie de `layerpitch-backstage.html` une fois invités — le mécanisme de kit téléchargeable existant (`admin-beta-console.html`) reste valable tel quel (le fichier n'est toujours jamais déployé publiquement, cohérent avec le principe "outil local" déjà en place), mais n'a pas été retesté avec le contenu Postgres de cette session. À valider au moment du premier vrai testeur.

---

## [2026-09-01l] — Correction des deux pièges signalés : rechargement automatique du schéma PostgREST, cache-busting des `api/*.js`

**Fichiers touchés** : `scripts/apply-migrations.js` (envoie `NOTIFY pgrst, 'reload schema'` après application) ; `index.html`, `pack.html`, `collection.html`, `layerpitch-backstage.html` (`loadPostgresReadScripts()` : cache-busting `?v=<timestamp>` sur les fichiers locaux, jamais sur le SDK CDN déjà versionné)

**Contexte** : les deux points signalés à Jules-Antoine dans l'entrée précédente ("pas urgent, contournable") — corrigés à sa demande explicite plutôt que laissés en dette technique.

**Rechargement de schéma automatique** : `apply-migrations.js` envoie désormais `NOTIFY pgrst, 'reload schema'` une seule fois, après que toutes les migrations d'un run ont été appliquées (pas de notification si rien à appliquer). Élimine le besoin d'un rechargement manuel après toute migration touchant une structure de table.

**Cache-busting des scripts locaux** : `loadPostgresReadScripts()` (dupliqué dans les 4 fichiers, même correctif partout) ajoute `?v=` + horodatage à chaque `api/*.js` chargé dynamiquement — jamais au SDK Supabase CDN (déjà versionné dans son URL, inutile de le invalider). Élimine la classe de bug rencontrée trois fois dans cette session (code obsolète silencieusement servi depuis le cache navigateur après une modification de fichier).

**Vérifications** : `node --check` OK sur les 5 fichiers touchés. Balises `<div>` équilibrées. Testé réellement : `window.LayerPitchSettings.getSettings.toString()` confirmé à jour immédiatement après modification (sans contournement manuel cette fois) ; onglet neuf sur `index.html?dataSource=postgres` et `index.html` (défaut) — aucune erreur console dans les deux cas. Les erreurs 400/429 observées en cours de route se sont révélées être l'historique accumulé de toute la session de test (le journal de la console ne se réinitialise pas entre navigations dans l'outil de test) — confirmé par les horodatages, aucune nouvelle erreur après le correctif. Suite de tests existante (23 fichiers) rejouée — mêmes 8 échecs préexistants, aucune régression.

---

## [2026-09-01k] — `settings`/`socials` : singleton global → personnels par compositeur

**Fichiers touchés** : nouveau `supabase/migrations/20260901170000_settings_socials_per_composer.sql` ; `api/settings.js` (réécrit — `getSettings`/`listSocials` exigent `ownerId`, nouvelles `upsertSettings`/`upsertSocials`) ; `api/site-data.js` (`ownerId` propagé) ; `layerpitch-backstage.html` (écriture double étendue aux réglages/réseaux sociaux)

**Contexte** : confirmé par Jules-Antoine — la lacune signalée dans l'entrée précédente (`settings`/`socials` restaient des tables singleton globales, aucune colonne `owner_id`) doit être corrigée : ces réglages (certification "sans IA", polices personnalisées, réseaux sociaux) sont personnels, jamais partagés entre compositeurs.

**Migration de schéma** : `settings` — clé primaire remplacée (`id boolean` singleton → `owner_id`), données existantes rattachées au compte de Jules-Antoine avant de rendre la colonne `not null`. `socials` — `owner_id` ajouté (clé primaire `id` inchangée, plusieurs lignes par compositeur), même rattachement. RLS laissée "public read" sur les deux tables (cohérent avec le reste du schéma — filtrage par requête, pas par RLS, pour que le site public reste consultable sans compte). Deux nouvelles RPC construites (n'existaient pas du tout auparavant) : `upsert_settings`, `upsert_socials` (remplace atomiquement la liste complète, même principe que `pack_tracks`/`collection_packs`).

**Piège rencontré en vérifiant — cache de schéma PostgREST, pas propagé automatiquement** : après la migration, les lectures échouaient avec `column settings.id does not exist` malgré un schéma correct en base (confirmé directement via `psql`). Cause : `scripts/apply-migrations.js` applique les migrations par connexion Postgres directe, sans notifier PostgREST du changement de schéma (`NOTIFY pgrst, 'reload schema'`, absent du script). Résolu par un envoi manuel de ce signal — propagation effective confirmée en quelques secondes via `curl` direct contre l'API REST. **Point de vigilance pour la suite** : toute future migration touchant une structure de table (colonnes ajoutées/retirées, contrainte de clé primaire) devra envoyer ce signal manuellement tant que `apply-migrations.js` ne le fait pas automatiquement — candidat pour un correctif futur du script lui-même.

**Deuxième piège, distinct du premier, purement lié aux tests de cette session** : une fois le cache PostgREST rechargé côté serveur, les appels continuaient d'échouer côté navigateur avec la même erreur — cause identifiée : `loadPostgresReadScripts()` (`index.html`/`pack.html`/`collection.html`/`layerpitch-backstage.html`) charge `api/settings.js` sans paramètre de cache-busting, contrairement au reste du pipeline de publication (`updateScriptVersions()`, qui verse `?v=<buildVersion>` sur `player.js`/`layerpitch-i18n.js`/`layerpitch-help.js` à chaque publication). Le navigateur de test servait une version mise en cache de ce fichier, antérieure à la réécriture de cette session — confirmé en inspectant directement `window.LayerPitchSettings.getSettings.toString()`, qui montrait encore l'ancien code `.eq('id', true)`. Contourné pour le test (chargement manuel avec `?cb=<timestamp>`), **non corrigé dans le code livré** — un vrai visiteur chargeant la page pour la première fois n'a pas ce problème (rien à invalider), mais toute session de développement future rechargeant ces fichiers plusieurs fois y sera exposée. Candidat pour un futur correctif d'ensemble (étendre `updateScriptVersions()` aux fichiers `api/*.js`, ou cache-busting systématique dans `loadPostgresReadScripts()`), pas traité ici pour ne pas élargir le périmètre de cette session.

**Vérifications** : RPC testées directement via connexion Postgres simulant une session compositeur (même contournement que d'habitude) — `upsert_settings`/`upsert_socials` écrivent correctement, état réel restauré après coup (vérifié identique à l'original par comparaison avant/après). Testé en navigateur (une fois le contournement de cache appliqué) : lecture scopée par `ownerId` fonctionnelle, comparaison profonde contre `data.json` toujours cohérente (mêmes écarts déjà connus, rien de nouveau côté réglages/réseaux sociaux). `node --check` OK, balises `<div>` équilibrées. Suite de tests existante (23 fichiers) rejouée — mêmes 8 échecs préexistants, aucune régression.

**Statut** : les cinq types de contenu ET les réglages personnels ont maintenant une isolation par compositeur complète et une écriture double fonctionnelle. Reste pour clore l'authentification des testeurs : ouvrir `invite-tester` au-delà de `ADMIN_EMAIL`, terminer la migration "sans coupure" depuis le système GitHub actuel.

---

## [2026-09-01j] — Isolation multi-compositeur : lecture Postgres scopée par propriétaire (préparation auth testeurs)

**Fichiers touchés** : nouveau `supabase/migrations/20260901160000_ensure_composer_profile_rpc.sql` ; `api/tracks.js`, `api/packs.js`, `api/sfx.js`, `api/collections.js`, `api/adreels.js` (filtrage `owner_id` optionnel sur tous les `list*`, `ownerId` exposé dans `reshapeAdReel`/`reshapePack`/`reshapeCollection`) ; `api/auth.js` (`getMyComposerId`/`ensureMyComposerProfile`) ; `api/site-data.js` (`ownerId` obligatoire) ; `index.html`, `pack.html`, `collection.html` (résolution de l'AdReel/pack/collection en premier pour découvrir son propriétaire avant de charger le reste) ; `layerpitch-backstage.html` (lecture Postgres exige désormais une session)

**Contexte** : point signalé à Jules-Antoine avant de démarrer l'authentification des testeurs, pas improvisé — aucune lecture Postgres n'était filtrée par compositeur. `listTracks()`/`listPacks()`/`listSfx()`/`listCollections()`/`listAdReels()` renvoyaient systématiquement le contenu de **tous** les compositeurs mélangés, sans distinction. Invisible jusqu'ici (un seul compositeur réel existe), mais aurait cassé l'isolation entre testeurs dès le premier vrai second compte — soit côté backstage (bibliothèque d'un testeur affichant le contenu des autres), soit côté site public (la politique RLS "public read using (true)" expose déjà toute la table à quiconque interroge Postgres avec la clé publique, pas seulement ce qui est référencé par l'AdReel consulté).

**Corrigé** :
- `listTracks`/`listPacks`/`listSfx`/`listCollections`/`listAdReels` (et leurs équivalents `listTrackFolders`/`listSfxFolders`/`listAdReelFolders`) acceptent désormais `{ ownerId }` en option — filtre `.eq('owner_id', ownerId)` quand fourni.
- `reshapeAdReel`/`reshapePack`/`reshapeCollection` exposent maintenant `ownerId` (absent de `data.json`, jamais réinjecté dans les payloads d'écriture qui construisent leur propre objet champ par champ dans `publishAll()` — vérifié, aucun risque de fuite vers l'écriture).
- `api/site-data.js` : `loadSiteDataFromPostgres(ownerId)` — paramètre désormais **obligatoire** (lève une exception explicite si omis), pour qu'un futur appel ne puisse pas silencieusement revenir au comportement non scopé.
- **Site public** (`index.html`/`pack.html`/`collection.html`) : résout l'AdReel/pack/collection demandé **en premier** (par son id, connu depuis l'URL) pour découvrir son `ownerId`, puis charge le reste du catalogue scopé à ce seul compositeur — jamais tout le monde mélangé.
- **Backstage** : la lecture Postgres (`fetchSiteData()`) exige maintenant une session active — `ensureMyComposerProfile()` (nouvelle RPC, provisionne automatiquement le `composer_profile` du compte connecté s'il n'existe pas encore, aucune policy RLS `INSERT` ne permettant de le faire directement depuis le client) résout l'`ownerId` avant tout chargement. Même mécanisme réutilisé côté écriture double (remplace la simple vérification `getSession()` — un message d'erreur clair couvre maintenant à la fois "pas connecté" et "connecté mais profil pas encore provisionné").

**Décision de conception, pas improvisée** : `ensureMyComposerProfile()` crée automatiquement le `composer_profile` à la première connexion plutôt que d'exiger une étape d'activation manuelle séparée — cohérent avec le fait que cette bêta est 100% composée de compositeurs (le modèle à profils multiples Fan/Compositeur/Game dev de `extensions-roadmap.md` 5.4 n'a pas encore de vraie UI, session ouverte séparément). À revisiter le jour où le grand public (profils multiples réels) entre en jeu.

**Lacune trouvée mais explicitement non traitée, signalée à Jules-Antoine** : `settings`/`socials` restent des tables singleton globales (une seule ligne pour tout le système, aucune colonne `owner_id`) — correct pour un seul compositeur, mais deux compositeurs partageraient malgré tout les mêmes réglages "sans IA certifié"/polices personnalisées/réseaux sociaux le jour où un second compte publie du contenu. Nécessite une vraie décision de schéma (singleton → une ligne par compositeur), pas un simple filtre de requête comme le reste de cette entrée — hors périmètre de cette session, à trancher avant l'ouverture réelle aux testeurs.

**Vérifications** : `node --check` OK sur les 7 fichiers `api/*.js` et les 4 pages HTML modifiées. Balises `<div>` équilibrées partout. Testé réellement en navigateur : comportement par défaut (sans `?dataSource=postgres`, sans case Postgres cochée) confirmé strictement identique sur les quatre pages. Chemin Postgres scopé testé sur `index.html` — comparaison profonde contre `data.json`, mêmes écarts déjà connus et expliqués (cosmétiques), **plus un signe positif** : la divergence `packs.buyable` notée en Session A/B a disparu (la vraie publication de Jules-Antoine l'a resynchronisée). Un tout petit écart de contenu trouvé au passage (quelques caractères de différence dans une bio, dérive normale d'une édition faite sans l'écriture double cochée, pas un bug). Filtrage par propriétaire vérifié directement (sans session, RLS "public read" le permet) : 14 morceaux pour le vrai compositeur, 0 pour un id inventé, confirmant l'isolation fonctionne. `ensureMyComposerProfile()`/le chemin backstage complet avec vraie session **non re-testés en conditions réelles dans cette entrée** — limite de débit email Supabase atteinte deux fois de suite ; le garde-fou "pas de session → erreur claire" a lui été vérifié en conditions réelles (message correct, aucun crash). Suite de tests existante (23 fichiers) rejouée — mêmes 8 échecs préexistants, aucune régression.

**Reste à faire pour clore l'authentification des testeurs** : construire le flux d'invitation/connexion réel côté testeur (aujourd'hui `invite-tester` vérifie l'appelant par `ADMIN_EMAIL` en dur, Jules-Antoine uniquement — à ouvrir), et la fin de la migration "sans coupure" depuis le système GitHub actuel.

---

## [2026-09-01i] — Écriture double validée de bout en bout, en conditions réelles, par Jules-Antoine lui-même

**Fichiers touchés** : aucun (validation pure, pas de code changé)

**Contexte** : première publication réelle complète depuis le backstage avec l'écriture double activée (vrai token GitHub, vraie session Postgres) — le test resté en attente depuis le début de la Session B, débloqué par le correctif `nextOptions` de l'entrée précédente.

**Résultat, confirmé indépendamment des deux côtés après coup** : les cinq types de contenu écrits en Postgres sans erreur (14 morceaux, 3 packs, 6 AdReels, 3 Sfx, 1 collection), `data.json` publié sur GitHub avec succès, versions de `player.js` mises à jour sur les pages publiques. Seul avertissement dans le journal — `layerpitch-backstage.html introuvable` pour la mise à jour de version — **attendu et sans rapport**, ce fichier n'étant jamais poussé sur GitHub par conception (outil local uniquement, `.gitignore`).

**Vérification indépendante** : comptages Postgres (`select count(*)`) et `data.json` récupéré directement depuis `raw.githubusercontent.com` — identiques des deux côtés (14/3/6/3/1). "The Last Door" (le morceau qui avait fait échouer le tout premier essai) confirmée avec un `updated_at` correspondant exactement à l'heure de cette publication.

**Statut** : l'écriture double (Postgres + GitHub, jamais l'un sans l'autre) est maintenant validée en conditions de production réelles, pas seulement en test isolé. Les Sessions B et C (côté écriture) sont fonctionnellement complètes pour les cinq types de contenu. Reste, pour clore complètement le backstage en ligne (Décision 5) : l'authentification Supabase complète pour les testeurs bêta (remplacement du système GitHub actuel, "sans coupure").

---

## [2026-09-01h] — Bug réel trouvé au premier vrai test de publication : `upsert_track` échouait sur `nextOptions: null`

**Fichiers touchés** : nouveau `supabase/migrations/20260901150000_fix_upsert_track_null_next_options.sql`

**Contexte** : premier vrai test de publication par Jules-Antoine lui-même (vrai token GitHub, écriture double activée) — exactement le test resté en attente depuis le début de la Session B. Résultat : écriture Postgres arrêtée avant tout contact GitHub (le garde-fou a fonctionné comme prévu), avec l'erreur `The Last Door : cannot extract elements from a scalar`.

**Diagnostic** : `payload->'segmentSlots'[].nextOptions` vaut `null` (JSON explicite, pas une clé absente) pour tout emplacement séquentiel sans branchement — sérialisation délibérée de `layerpitch-backstage.html` (`nextOptions: (sl.nextOptions && sl.nextOptions.length) ? ... : null`), pas une anomalie de données. Piège JSONB classique : une valeur JSON `null` n'est PAS une valeur SQL NULL — `coalesce(v_slot->'nextOptions', '[]'::jsonb)` ne la remplace donc jamais par `[]`, et `jsonb_array_elements()` appelé sur ce scalaire JSON null lève "cannot extract elements from a scalar". `upsert_track` était la seule RPC concernée : vérifié qu'aucun autre champ itéré via `jsonb_array_elements` dans les cinq RPC existantes (`segmentSlots`, `sfxIds`, `trackIds`, `tags`, `packIds`) n'est jamais sérialisé en `null` explicite par le backstage — toujours `[]` au minimum.

**Corrigé** : `nullif(v_slot->'nextOptions', 'null'::jsonb)` avant le `coalesce`, aux deux occurrences (validation du graphe + insertion des transitions) — convertit la valeur JSON null en véritable SQL NULL, que `coalesce` peut alors remplacer par `[]` comme prévu.

**Vérifications, sur les vraies données de production** : le morceau réel "The Last Door" retesté directement — succès confirmé, `segment_slots` correctement écrit, 0 transition (cohérent, `nextOptions` était bien vide). **Les 14 morceaux réels de la bibliothèque testés un par un via la RPC** — 14/14 OK, aucun autre échec cascadé. `scripts/test-rpc-upserts.js` rejoué (11/11, aucune régression sur la validation du graphe ni l'isolation entre compositeurs). Suite de tests existante (23 fichiers) rejouée — mêmes 8 échecs préexistants.

**Note** : ce test a écrit pour de vrai le morceau "The Last Door" dans Postgres (données réelles et correctes, cohérent avec `data.json` — pas une donnée de test à nettoyer).

**Prochaine étape** : Jules-Antoine retente la publication réelle (écriture double + vrai token GitHub) — plus aucun blocage connu.

---

## [2026-09-01g] — Bascule backend, Session C (démarrage) : RPC `upsert_sfx`/`upsert_collection` (nouvelles), écriture double étendue

**Fichiers touchés** : nouveau `supabase/migrations/20260901140000_upsert_sfx_collection_rpc.sql` ; `api/sfx.js`, `api/collections.js` (fonctions `upsertSfx`/`upsertCollection` ajoutées) ; `layerpitch-backstage.html` (`publishAll()` : écriture double étendue aux Sfx et collections)

**Contexte** : premier étage de la Session C. Lacune trouvée en démarrant : contrairement aux morceaux/packs/AdReels, **aucune RPC d'écriture n'existait pour les Sfx ni les collections** — seules `upsert_track`/`upsert_pack`/`upsert_ad_reel` avaient été construites le 31 août (Décision 2). À construire depuis zéro avant de pouvoir étendre l'écriture double.

**RPC ajoutées** : `upsert_sfx` et `upsert_collection`, même schéma exact que `upsert_pack` (vérification de propriété via `current_composer_id()`, `owner_id` ne change jamais après création, `sfx_library`/`collections` déjà dotées de `owner_id not null` depuis la correction du 31 août soir). `upsert_collection` gère `collection_packs` de la même façon que `upsert_pack` gère `pack_tracks`/`pack_sfx` (suppression puis réinsertion atomique, jamais un état à moitié fait).

**Vérifications, en deux temps** : d'abord logique RPC testée directement via connexion Postgres simulant une session compositeur (même contournement que `scripts/test-rpc-upserts.js`, `set local request.jwt.claims`) — création simple + `collection_packs` peuplée atomiquement avec un vrai pack existant, 3/3. Puis **vrai chemin navigateur** (session réelle par lien magique, contournement de la course sur la détection de session déjà documenté le 1er septembre — `setSession()` manuel + rechargement) : `upsertSfx()`/`upsertCollection()` appelés sur des entrées de test dédiées (jamais les vraies données), propriété vérifiée en base, lignes supprimées après vérification.

**Écriture double étendue** : `data.sfxLibrary` et `data.collections` écrits juste après les AdReels dans `publishAll()`, même principe (avant GitHub, arrêt net avant tout contact GitHub en cas d'échec).

**Vérifications** : `node --check` OK sur les 2 fichiers `api/*.js` et le bloc `<script>` inline du backstage. Balises `<div>` équilibrées (485/485). Suite de tests existante (23 fichiers) rejouée — mêmes 8 échecs préexistants, aucune régression.

**Statut Session C** : les cinq types de contenu (morceaux, packs, AdReels, Sfx, collections) ont maintenant leur écriture double codée. Reste, dans l'ordre : le test réel complet par Jules-Antoine (vrai token GitHub, toujours en attente), puis authentification Supabase complète pour les testeurs bêta (dernière pièce du backstage en ligne, Décision 5).

---

## [2026-09-01f] — Bascule backend, Session B : écriture double des AdReels — code écrit, pas encore vérifié en conditions réelles (limite de débit email)

**Fichiers touchés** : `layerpitch-backstage.html` (`publishAll()` : écriture double étendue aux AdReels ; hint du bloc "Écriture Postgres" mis à jour)

**Contexte** : dernière des trois fonctionnalités prévues pour l'écriture double (morceaux, packs, AdReels). `upsert_ad_reel` vérifié avant codage : structure la plus simple des trois (`folderId`/`label`/`lang`/`profile`/`testimonials`/`blocks`/`trackOverrides`/`trackIds`), aucun champ à risque de désynchronisation comme `packs.buyable` — rien à signaler avant d'implémenter.

**Changement** : même principe, troisième et dernier bloc — `data.adReels` écrit via `upsertAdReel()` après morceaux et packs, toujours avant `ghPutFile`, toujours avec arrêt net avant tout contact GitHub en cas d'échec.

**Non vérifié en conditions réelles dans cette entrée, à la différence des deux précédentes** : limite de débit email Supabase atteinte (2/heure, connue depuis le 31 août) en tentant d'obtenir une troisième session fraîche de test. Plutôt que d'attendre une heure pour un test isolé, décision actée avec Jules-Antoine : le code suit exactement le même schéma que `upsert_track`/`upsert_pack` (déjà validés deux fois chacun en conditions réelles cette session — vraie session, vrai appel PostgREST, propriété vérifiée en base), et le vrai test de bout en bout des trois RPC ensemble aura lieu naturellement au moment où Jules-Antoine testera `publishAll()` avec son vrai token GitHub (étape encore en attente, lui seul peut la faire — Claude Code ne saisit jamais de token GitHub).

**Vérifications faites malgré tout** : `node --check` OK, balises `<div>` équilibrées (485/485). Suite de tests existante (23 fichiers) rejouée — mêmes 8 échecs préexistants, aucune régression.

**Statut Session B** : les trois fonctionnalités prévues (morceaux, packs, AdReels) ont leur lecture ET leur écriture double codées. Reste : le test réel complet par Jules-Antoine (vrai token GitHub), puis passage à la Session C (Sfx, Collections, fin du backstage, authentification Supabase complète pour les testeurs).

---

## [2026-09-01e] — Bascule backend, Session B : écriture double des packs, bug de course trouvé sur la détection de session par lien magique

**Fichiers touchés** : `layerpitch-backstage.html` (`publishAll()` : écriture double étendue aux packs ; hint du bloc "Écriture Postgres" mis à jour)

**Contexte** : suite directe de l'écriture double des morceaux. Point signalé à Jules-Antoine avant de coder (pas improvisé) : `upsert_pack` écrase `buyable` à chaque appel (`buyable = excluded.buyable`) — comme `data.json` a `buyable: false` sur les 3 packs (vraie valeur de prod) contre `true` en Postgres (valeur de test posée le 31 août pendant la session Stripe), activer l'écriture double allait automatiquement remettre `buyable` à `false` côté Postgres dès la première publication. Vérifié au passage que `price_usd_cents` (999, valeur de test) n'est pas touché par cette RPC — aucun risque de ce côté. Confirmé par Jules-Antoine de laisser faire (résout la divergence dans le sens de la vraie donnée de prod).

**Changement** : même principe que les morceaux — `data.packs` (déjà dans la forme exacte attendue par `upsert_pack`) écrit via `upsertPack()` juste après les morceaux, toujours avant `ghPutFile`, toujours avec arrêt net avant tout contact GitHub en cas d'échec.

**Bug réel trouvé en testant le renouvellement de la connexion** : le premier lien magique de la session précédente avait expiré (jeton de rafraîchissement révoqué par le `signOut()` de fin de session, normal). Un second lien magique envoyé et son URL de redirection chargée directement dans le navigateur de test — cette fois, la session ne s'est PAS établie (`pgAuthStatus` resté "Non connecté" malgré le fragment `#access_token=...` toujours présent dans l'URL). **Cause identifiée** : chaque module `api/*.js` crée son propre client Supabase indépendant (déjà signalé comme design smell le 1er septembre, section précédente) — plusieurs instances `GoTrueClient` tentent de détecter la session depuis le fragment d'URL en même temps au chargement de la page, et cette détection concurrente ne s'est pas correctement synchronisée cette fois (contrairement au premier test, qui avait fonctionné). Contournement utilisé pour ce test : établir la session manuellement via `setSession({access_token, refresh_token})` sur un client dédié (persiste en `localStorage`), puis recharger la page sans fragment — au rechargement suivant, tous les clients lisent simplement la session déjà persistée, sans course. **Non corrigé** — un vrai bug utilisateur potentiel (cliquer le lien magique pourrait occasionnellement ne pas connecter du premier coup, un simple rechargement de page suffit à contourner) mais peu probable de se manifester dans l'usage réel de Jules-Antoine (un seul module `api/auth.js` suffit pour la vraie page de connexion, contrairement à ce test qui chargeait 8 modules simultanément) — candidat pour le même futur nettoyage que le design smell déjà noté (client Supabase partagé plutôt qu'un par fichier), pas traité dans cette session pour ne pas élargir son périmètre.

**Vérifications** : `node --check` OK, balises `<div>` équilibrées (485/485). Testé réellement en navigateur avec une vraie session (deuxième lien magique, contournement ci-dessus) : `upsertPack()` appelé sur un pack de test dédié (`browser-test-pack-1`, jamais un des 3 packs réels) — écriture réussie, propriété vérifiée en base, ligne supprimée après vérification. Suite de tests existante (23 fichiers) rejouée — mêmes 8 échecs préexistants, aucune régression.

**Reste à faire (Session B)** : AdReels (dernière des trois fonctionnalités prévues), puis passage à la Session C (Sfx, Collections, fin du backstage).

---

## [2026-09-01d] — Bascule backend, Session B : écriture double des morceaux (Postgres + GitHub), connexion minimale dans le backstage

**Fichiers touchés** : `layerpitch-backstage.html` (bloc "Écriture Postgres" — connexion par lien magique, case "Écriture double vers Postgres" ; `publishAll()` : écriture Postgres insérée avant `ghPutFile`, abandon avant tout contact GitHub en cas d'échec)

**Contexte** : suite immédiate de l'étape précédente (lecture Postgres dans le backstage). Point technique trouvé en préparant la conversion de l'écriture : `upsert_track` (comme `upsert_pack`/`upsert_ad_reel`) exige un appelant réellement authentifié (`current_composer_id()`, durci le 31 août) — le backstage n'avait aucune intégration Supabase. Signalé à Jules-Antoine avant de coder : pas un vrai conflit avec "auth en dernier" (qui visait le remplacement complet du système de connexion des testeurs bêta), juste besoin d'une session valide pour lui, le seul compositeur existant. Décision actée avec lui : connexion minimale par lien magique, réutilisant `api/auth.js` tel quel (testé de bout en bout le 31 août), pas le grand chantier d'auth des testeurs.

**Écriture double** : dans `publishAll()`, si la case "Écriture double vers Postgres" est cochée, chaque morceau de `data.library` (déjà construit dans la forme exacte attendue par `upsert_track`, aucune transformation supplémentaire nécessaire) est écrit via `upsertTrack()` **avant** `ghPutFile`. Toute erreur (pas de session, RPC refusée, etc.) lève une exception qui remonte au `catch` existant de `publishAll()` — la publication s'arrête net, GitHub n'est jamais contacté. Décochée par défaut, comportement de publication strictement inchangé tant qu'elle ne l'est pas.

**Vérifications, en conditions réelles à chaque étape** :
- Chemin d'échec testé en premier (sans session) : case cochée, token GitHub factice renseigné, `publishAll()` déclenché — confirmé via `performance.getEntriesByType('resource')` qu'aucun appel réseau vers `api.github.com` n'a eu lieu, erreur claire dans le journal ("aucune session active — connecte-toi via lien magique avant de publier").
- Lien magique envoyé pour de vrai à `julzantoine@yahoo.com` (accord explicite de Jules-Antoine avant l'envoi), lien collé par lui dans la conversation. Consommé via `curl --max-redirs 0` pour capturer la redirection contenant `access_token`/`refresh_token` (même contournement que le 31 août — charger le lien magique directement dans l'outil de navigateur automatisé consomme le jeton à usage unique sans établir la session correctement), puis l'URL de résultat chargée directement dans le navigateur de test : session établie, `pgAuthStatus` confirmé "Connecté en tant que julzantoine@yahoo.com".
- **Test RPC réel de bout en bout, session authentique** : `upsertTrack()` appelé sur un morceau de test dédié (`browser-test-track-1`, jamais un des 14 morceaux réels) — écriture réussie, propriété vérifiée directement en base (`owner_id` correctement rattaché au `composer_profile` de Jules-Antoine), puis ligne de test supprimée après vérification (aucun résidu). Session de test fermée (`signOut()`) une fois la vérification terminée.

**Non testé dans cette session, actée explicitement** : le chemin complet `publishAll()` avec un vrai token GitHub (nécessite le token personnel de Jules-Antoine, jamais saisi ni géré par Claude Code) — la boucle d'écriture Postgres sur les 14 morceaux réels suivie du commit GitHub réel reste à valider par Jules-Antoine lui-même en conditions réelles.

**Vérifications** : `node --check` OK sur le bloc `<script>` inline. Balises `<div>` équilibrées (485/485). Suite de tests existante (23 fichiers) rejouée — mêmes 8 échecs préexistants, aucune régression.

---

## [2026-09-01c] — Bascule backend, Session B (démarrage) : lecture Postgres dans le backstage, bug de dossiers trouvé et corrigé

**Fichiers touchés** : `layerpitch-backstage.html` (case à cocher "Lecture Postgres (test)" ajoutée, `loadData()` branché sur un nouveau `fetchSiteData()` — écriture toujours 100% inchangée) ; `api/tracks.js`, `api/sfx.js`, `api/adreels.js` (nouvelles fonctions `listTrackFolders`/`listSfxFolders`/`listAdReelFolders`) ; `api/site-data.js` (inclut désormais `libraryFolders`/`sfxFolders`/`adReelFolders`)

**Contexte** : premier étage de la Session B (réécriture incrémentale du backstage, lecture avant écriture — voir `docs/infrastructure.md`, "Décision complémentaire — Approche du backstage en ligne"). Objectif de cette étape : basculer l'affichage du backstage vers Postgres sans toucher à l'écriture (toujours 100% GitHub), validé avant de commencer la conversion fonctionnalité par fonctionnalité de la Décision 2 (RPC `upsert_*`). Réutilise directement `api/site-data.js` construit en Session A — la forme `data.json` reconstruite est identique, donc `loadData()` (migration/normalisation existante, ~230 lignes) n'a pas eu besoin d'être dupliquée, seule sa source d'entrée change.

**Bug réel trouvé au premier test dans le backstage (invisible en Session A)** : `api/site-data.js` omettait volontairement `libraryFolders`/`sfxFolders`/`adReelFolders` — un choix correct pour le site public (jamais lu par `index.html`/`pack.html`/`collection.html`) mais faux pour le backstage. Son garde-fou existant (`library.forEach(t => { if (t.folderId && !libraryFolders.some(f => f.id === t.folderId)) t.folderId = null; })`, ligne ~6961, même mécanisme que celui déjà documenté pour `adReelFolders`) interprète une liste de dossiers vide comme "tous les dossiers ont été supprimés" plutôt que "non demandée" — résultat : tous les morceaux/Sfx perdaient silencieusement leur rattachement à un dossier dès que la case Postgres était cochée, alors que Postgres contenait les bonnes valeurs de bout en bout (vérifié directement en base via `psql` et via PostgREST en `curl` — aucune perte de données réelle, uniquement une reconstruction incomplète côté lecture).

**Corrigé** : trois nouvelles fonctions de lecture (`listTrackFolders`/`listSfxFolders`/`listAdReelFolders`, même style que le reste des modules `api/*.js` — lecture directe SDK, RLS "public read" déjà en place, vérifiée pour les trois tables). `api/site-data.js` les assemble désormais dans son objet retourné. Coût nul pour les pages publiques (nouveaux champs jamais lus par leur code de rendu).

**Vérification, en deux temps à cause d'un piège d'outillage** : premier test après le correctif montrait encore l'échec (cache HTTP du serveur statique local servant l'ancienne version de `api/site-data.js`/`api/tracks.js` etc. — aucun cache-busting sur ces `<script src="...">` chargés dynamiquement, même limite déjà présente dans `loadPurchaseScripts()` de `pack.html`, non traitée ici, hors périmètre). Rechargement forcé avec cache-busting explicite pour le test : confirmé corrigé, `libraryFolders` reconstitué à l'identique (2 dossiers, "SF"/"8Bits", labels vérifiés dans les champs `<input>` du DOM rendu).

**Comparaison profonde finale** (`library`/`packs`/`collections`/`sfxLibrary`/`socials`/`adReels`/`libraryFolders`/`sfxFolders`/`adReelFolders`, état interne du backstage après migration — pas seulement la lecture brute) : 11 écarts restants, tous déjà identifiés et expliqués en Session A (`bpm`/`beatsPerBar`/`customCutFadeSec` null vs absent, sans impact — voir `player.js` ; `packs.buyable` toujours désynchronisé depuis la session Stripe du 31 août, toujours pas corrigé, en attente d'arbitrage avec Jules-Antoine).

**Vérifications** : `node --check` OK sur les 4 fichiers `api/*.js` touchés et sur le bloc `<script>` inline de `layerpitch-backstage.html`. Balises `<div>` équilibrées (480/480). Testé réellement en navigateur (serveur statique local) : comportement par défaut (case décochée) confirmé strictement identique à avant — chargement automatique des 6 AdReels, 14 morceaux, 9 blocs sur l'AdReel principal, aucune erreur console. Chemin Postgres testé avec succès (mêmes comptes, mêmes structures de morceau affichées — couches, BPM, points de boucle — dossiers désormais corrects). Suite de tests existante (23 fichiers) rejouée deux fois (avant et après le correctif) — mêmes 8 échecs préexistants (`test_backstage_*`, documentés le 31 août), aucune régression.

**Hors périmètre de cette étape, actée explicitement** : l'écriture reste 100% GitHub — aucune conversion vers les RPC `upsert_*` dans cette entrée, ni écriture double (Postgres + GitHub) encore construite. Prochaine étape : conversion de l'écriture des morceaux (la plus simple des trois prévues), avec écriture double dès le départ — décision actée avec Jules-Antoine le 1er septembre pour ne jamais geler sa capacité à publier réellement pendant la transition (voir `docs/infrastructure.md`).

---

## [2026-09-01b] — Bascule backend, Session A : lecture Postgres côté public, en isolation (pas de bascule de production)

**Fichiers touchés** : nouveau `api/sfx.js`, `api/collections.js`, `api/settings.js`, `api/site-data.js` ; `index.html`, `pack.html`, `collection.html` (chargeur `loadSiteData()` ajouté, `fetch('./data.json')` remplacé par un appel à ce chargeur)

**Contexte** : premier étage du séquençage cadré avec Jules-Antoine le 1er septembre (voir `docs/infrastructure.md`) — objectif : brancher le site public sur Postgres, valider la parité avec `data.json`, sans jamais faire dépendre la production de cette lecture tant que le backstage en ligne n'écrit pas encore dans Postgres (risque de désynchronisation identifié en amont, voir Décision 5).

**Lacune trouvée en démarrant** : `docs/infrastructure.md` présentait ce chantier comme "techniquement prêt", mais seuls `api/tracks.js`/`api/packs.js`/`api/adreels.js` existaient — aucune lecture pour les Sfx, les Collections, ni les réglages globaux (`settings`, table singleton avec `publishedAt`/`implementationSkills`/`noAiCertifiedGlobal`/`customFonts`) et les réseaux sociaux (`socials`), pourtant tous nécessaires au rendu de `index.html`. Trois nouveaux modules `api/*.js` créés sur le même principe que les existants (lecture directe SDK, RLS "public read" déjà en place — vérifié). Écriture non couverte (pas nécessaire à ce stade, Décision 5).

**`api/site-data.js`** : nouvel agrégateur en lecture seule, assemble un objet strictement au format `data.json` à partir des sept appels Postgres en parallèle (`tracks`, `packs`, `collections`, `sfx`, `settings`, `socials`, `adReels`). Omet volontairement `libraryFolders`/`sfxFolders`/`adReelFolders` — organisation propre au backstage, jamais lue par le rendu public.

**Mécanisme de bascule, isolé par construction** : `loadSiteData()` (dupliqué dans les trois pages, même principe que `loadPurchaseScripts()` déjà existant dans `pack.html`) ne charge le SDK Supabase et les `api/*.js` qu'à la demande, et seulement si `?dataSource=postgres` est explicitement présent dans l'URL — sinon comportement 100% inchangé (`fetch('./data.json')` comme avant, aucune requête réseau supplémentaire). Aucun flag de bascule globale posé (contrairement à `PURCHASES_ENABLED`) : ce n'est pas une fonctionnalité à activer un jour, seulement un outil de validation, la bascule réelle de production étant conditionnée à la fin de la réécriture du backstage (Décision 5).

**Vérification de parité, au-delà d'un seul AdReel de test** : script de comparaison profonde exécuté en conditions réelles dans le navigateur (extension du principe déjà utilisé pour `scripts/verify-postgres-migration.js`) — `data.json` entier reconstruit depuis Postgres et comparé champ par champ, sur la totalité des 6 AdReels, tous les morceaux/Sfx/packs/collections, pas un seul AdReel isolé. **17 écarts trouvés, tous expliqués, aucun impact fonctionnel** :
- `segment_slots.bpm`/`beatsPerBar`/`customCutFadeSec` : `null` (Postgres) vs clé absente (`data.json`) — cosmétique, vérifié dans `player.js` (`slotTiming()`, ligne 1218 ; `sourceSlot.customCutFadeSec != null`, ligne 1538) que `null` et `undefined` sont traités identiquement partout où ces champs sont lus.
- `packs[].tags`/`priceUsdCents` absents de `data.json` — normal, champs propres à Postgres (Marketplace/Stripe), jamais portés par le format `data.json`, non lus par le rendu public.
- **`packs[0-2].buyable : false (data.json) vs true (Postgres)`** — écart réel, pas cosmétique : valeur de test posée dans Postgres pendant la session Stripe du 31 août (`buyable=true` pour tester le paiement), jamais resynchronisée vers `data.json` (resté à `false`, la vraie valeur de production — masquée de toute façon par `PURCHASES_ENABLED=false` côté `pack.html`). Preuve concrète, pas seulement théorique, du risque de désynchronisation Postgres/`data.json` déjà identifié avant de démarrer cette session. **Non corrigé dans cette session** — laissé en l'état, à trancher avec Jules-Antoine (aligner sur `data.json`, ou confirmer que la valeur de test doit rester).

**Point non corrigé, signalé mais hors périmètre de cette session** : chaque module `api/*.js` (existants et nouveaux) crée son propre client Supabase indépendant (`GoTrueClient` séparé par fichier) — avertissement navigateur "Multiple GoTrueClient instances detected" observé dès que plusieurs modules sont chargés ensemble (6 dans cette session, contre 2-3 auparavant). Non bloquant (confirmé par la doc Supabase elle-même : "not an error"), mais un vrai design smell préexistant (pas introduit par cette session) qui s'aggrave à mesure que d'autres modules `api/*.js` sont ajoutés — candidat pour un futur nettoyage (client Supabase partagé plutôt qu'un par fichier), pas traité ici pour ne pas élargir le périmètre de la Session A.

**Vérifications** : `node --check` OK sur les 4 nouveaux fichiers `api/*.js` et sur les 3 blocs `<script>` inline modifiés (`index.html`/`pack.html`/`collection.html`). Testé réellement en navigateur (serveur statique local, `.claude/launch.json`) : comportement par défaut (sans `?dataSource=postgres`) confirmé strictement identique à avant sur les trois pages (aucune erreur console, rendu texte identique) ; chemin Postgres testé sans erreur sur `index.html` (AdReel `main`), `pack.html` et `collection.html` (IDs réels). Suite de tests existante (23 fichiers) rejouée en entier — mêmes 8 échecs préexistants (`test_backstage_*`, déjà documentés le 31 août, sans rapport avec ce chantier), aucune régression.

**Hors périmètre, actée explicitement (Décision 5)** : le site public ne dépend toujours pas de Postgres en production — `data.json` reste la source de vérité par défaut sur les trois pages. La bascule réelle reste conditionnée à ce que le backstage en ligne écrive dans Postgres de façon fiable (Session B du séquençage), pour ne pas figer le contenu public au prochain cycle de publication depuis le backstage actuel (toujours 100% GitHub).

---

## [2026-09-01] — Rapatriement de `admin-beta-console.html` dans le repo

**Fichiers touchés** : `admin-beta-console.html` (nouveau dans ce repo)

**Contexte** : session de cadrage du séquençage restant de la Partie B (basculement du site public, réécriture en ligne du backstage, tableaux de bord analytiques, etc.). Le point 4 de la feuille de route de Jules-Antoine visait `admin-beta-console.html` comme cible du futur tableau de bord admin sur Postgres, en le distinguant d'`admin-analytics.html` (obsolète) — or seul `admin-analytics.html` existait dans ce repo, `admin-beta-console.html` n'y avait jamais existé. Fichier fourni par Jules-Antoine depuis une copie locale (`Desktop/LayerPitch/V7/V7.1/`), non suivie par Git, et rapatrié tel quel.

**Contenu du fichier rapatrié** (aucune modification apportée, copie fidèle) : outil de pilotage de la bêta GitHub (Partie A) — `promote`/`create`/`rollout`/`restore`/`notify` sur les repos testeurs, piloté depuis le navigateur plutôt qu'en ligne de commande — fusionné avec un panneau d'analytics lisant les `events.json` par testeur (actions du backstage, erreurs). **Aucun lien avec Postgres/Supabase à ce stade** — 100% API GitHub, comme `layerpitch-beta-sync.js` dont il reprend la logique.

**Statut du fichier avant rapatriement (vérifié)** : `git log` confirmé sans aucune trace historique de ce fichier dans ce repo — pas un fichier retrouvé après suppression, une première introduction. `admin-analytics.html` existant reste inchangé et non touché par ce rapatriement (à statuer plus tard : le remplacer ou le laisser tel quel, la console rapatriée couvre déjà son usage d'analytics bêta).

**Non fait dans cette entrée** : aucun panneau Postgres ajouté à ce fichier — objet d'une session ultérieure (comptages comptes/AdReels/packs, moyennes par compositeur, tendances de modes de lecture), une fois la base de données peuplée par un vrai flux de publication (dépend du séquençage de la bascule backend, en cours de cadrage). Fichier non commité (laissé en `git status` non indexé) — à commit sur demande explicite de Jules-Antoine.

---

## [2026-08-31i] — Correction Décision 1 : `owner_id` manquant sur le contenu compositeur

**Fichiers touchés** : `supabase/migrations/20260831231400_composer_ownership_schema.sql` (nouveau), `supabase/migrations/20260831231500_composer_ownership_rpc.sql` (nouveau), `scripts/test-rpc-upserts.js`, `docs/infrastructure.md` (Décisions 1 et 2, journal)

**Origine** : signalé par Claude dans une autre session de discussion sur le projet, en réaction au travail du jour — pas une question ouverte à trancher avec Jules-Antoine, mais un oubli factuel de la Décision 1 : le schéma initial (`20260831102635_initial_schema.sql`) créait `composer_profiles` sans jamais rattacher `tracks`/`packs`/`collections`/`ad_reels`/`sfx_library` (ni leurs dossiers) à un propriétaire. LayerPitch est multi-compositeur depuis la conception (business plan, et déjà en vigueur dans la Partie A où chaque testeur bêta a son propre repo isolé) — vérifié avant correction : `composer_profiles` était vide (aucun flux d'inscription compositeur n'existe encore, c'est l'objet du futur backstage en ligne).

**Corrigé (migration schéma)** : colonne `owner_id` (FK `composer_profiles`, `on delete cascade`, `not null`) ajoutée sur `track_folders`, `tracks`, `sfx_folders`, `sfx_library`, `packs`, `collections`, `albums`, `ad_reel_folders`, `ad_reels`. Le `composer_profile` de Jules-Antoine n'existait pas non plus (jamais créé faute de flux d'inscription) — créé par cette migration, tout le contenu existant (14 morceaux, 3 packs, 6 AdReels vérifiés après coup) rattaché à son compte. Tables de liaison et `segment_slots`/`segment_slot_transitions` volontairement laissées sans `owner_id` propre — héritent de la propriété de leur table parente. Lecture publique du site inchangée (le correctif porte sur l'écriture, pas la visibilité).

**Corrigé (RPC)** : `is_admin()` (admin unique en dur sur l'email de Jules-Antoine, documenté dès l'origine comme un intérim "en l'absence de `profiles`/rôle") remplacé dans `upsert_track`/`upsert_pack`/`upsert_ad_reel` par un vrai contrôle de propriété via une nouvelle fonction `current_composer_id()` : à la création, l'appelant devient propriétaire (`owner_id`) ; à la modification, rejeté si le `owner_id` existant ne correspond pas à son propre `composer_profile`. `owner_id` ne change jamais après création (absent du `ON CONFLICT ... DO UPDATE SET`). `is_admin()` retiré (plus aucun appelant).

**Vérifié** : `scripts/test-rpc-upserts.js` réécrit pour simuler un second compte (`composer B`, créé/détruit par le script via `auth.users` directement — seule colonne réellement obligatoire au-delà de `id`, vérifié via `information_schema` avant d'écrire le test) et tester l'isolation entre compositeurs, en plus des cas déjà couverts (graphe `segmentSlots`, atomicité). 11/11 : compte sans `composer_profile` rejeté, composer B rejeté sur le contenu de composer A (morceau et pack), composer B peut créer son propre contenu, composer A inchangé sur ses propres opérations (création, graphe valide/invalide, re-upsert d'un pack). Migrations appliquées à la vraie base Supabase (`scripts/apply-migrations.js`), comptages avant/après confirmés identiques (aucune perte de données).

**Non traité, hors périmètre de cette correction** : le contrôle de propriété n'existe qu'à l'intérieur des RPC (seul chemin d'écriture existant, Décision 2) — aucune policy RLS `INSERT`/`UPDATE`/`DELETE` ajoutée au niveau table, puisqu'aucune n'était nécessaire avant (écriture déjà refusée par défaut pour `anon`/`authenticated`, RPC en `SECURITY DEFINER` contourne RLS). À revisiter si un chemin d'écriture direct (hors RPC) est un jour ajouté. Le flux d'inscription/activation compositeur lui-même (formulaire, création du `composer_profile`) reste à construire — objet du backstage en ligne.

## [2026-08-31h] — URGENCE PRODUCTION : audio/Sfx cassés, correctif poussé + pipeline d'upload migré vers R2

**Fichiers touchés** : `data.json` (poussé seul, en urgence, commit `a2027eb`), `layerpitch-backstage.html` (nouveau bloc "Stockage média (Cloudflare R2)", nouvelle fonction `r2PutFile`, `track.base`/`sfx.base` et les deux fonctions d'aperçu local corrigés, 10 appels d'upload audio migrés de `ghPutFile` vers `r2PutFile`)

**Signalement de Jules-Antoine** : des AdReels déjà envoyés comme démos à de vraies personnes ne chargeaient plus l'audio/Sfx. Diagnostic confirmé en conditions réelles sur `beta.layerpitch.com` — erreurs CORS en console.

**Cause, sans rapport avec le travail de cette session** (rien n'était encore poussé au moment du signalement) : la Partie C (protection Cloudflare, cadrée avant cette session) a fini de configurer `beta.layerpitch.com` comme domaine personnalisé du repo GitHub Pages, ce qui déclenche une redirection automatique de `julzantoine.github.io` vers ce domaine — décision délibérée actée le 29 août ("un seul point d'accès protégé"). `data.json` pointait encore vers l'ancienne URL github.io pour l'audio ; un fetch autrefois même origine est devenu cross-origin via ce redirect, et GitHub Pages n'envoie pas d'en-tête CORS dessus. Jules-Antoine a un temps envisagé de défaire la configuration Cloudflare (Partie C) plutôt que de corriger le pointeur — écarté après explication : cela aurait annulé une décision de sécurité volontaire sans réparer le vrai problème.

**Correctif d'urgence poussé seul** (avec accord explicite, push effectué manuellement par Jules-Antoine — pas d'accès identifiants git depuis cet environnement) : les 17 champs `base` de `data.json` repointés vers `media.layerpitch.com` (déjà migré et vérifié à l'étape 1). Confirmé en ligne après quelques minutes de propagation GitHub Pages.

**Point critique trouvé en préparant ce correctif, plus urgent que prévu** : `layerpitch-backstage.html` réécrivait `track.base`/`sfx.base` vers `github.io` à **chaque publication**, y compris pour un simple changement de texte sans rapport avec l'audio — la toute première publication suivante aurait silencieusement annulé le correctif et recassé le site. Corrigé en même temps que le reste du pipeline (voir ci-dessous) — décision de traiter les deux ensemble plutôt que de livrer le correctif de données seul et laisser ce piège actif.

**Pipeline d'upload migré de GitHub vers R2** (Décision 3) :
- Nouveau bloc de formulaire "Stockage média (Cloudflare R2)" (Account ID, Bucket, Access Key ID, Secret Access Key) — même principe de persistance locale (localStorage) que le token GitHub existant, jamais publié.
- Nouvelle fonction `r2PutFile()` : signature AWS SigV4 en Web Crypto API (`crypto.subtle`), pas de module Node — porté depuis `scripts/migrate-media-to-r2.js`. Testé réellement contre le bucket (upload, vérification du contenu via CDN, suppression) avant intégration, puis testé une seconde fois intégré dans le vrai fichier backstage.
- **Nouveau blocage CORS trouvé au test** : la policy R2 posée à l'étape 1 n'autorisait que `GET`/`HEAD` (lecture seule) — un `PUT` déclenche une requête préflight que R2 rejetait. Policy CORS étendue à `PUT` (dashboard Cloudflare, même bucket).
- 10 appels d'upload audio (couches, intro/outro, alternatives séquentielles, transitions, sections/pools, boucles embranchement-vertical, variations Sfx, copie de stinger migré) basculés de `ghPutFile` vers `r2PutFile`. Les uploads d'images/fonts restent sur GitHub (non migrés, hors périmètre).
- **Deux bugs supplémentaires du même type trouvés en vérifiant systématiquement** (pas seulement le chemin de publication) : les fonctions d'aperçu local ("Écouter" un morceau/Sfx non encore publié) construisaient elles aussi un `base` vers `github.io` — corrigées vers R2 par cohérence. Variables `previewOwner`/`previewRepo` devenues inutilisées, supprimées.

**Point non traité, discuté explicitement avec Jules-Antoine** : le backstage ne supprime déjà aucun fichier distant quand un morceau/Sfx est supprimé (`library.splice`/`sfxLibrary.splice` — vérifié, aucune fonction de suppression n'existe dans tout le fichier) — comportement historique inchangé, pas une régression de ce correctif. Ajouter une vraie suppression (GitHub et R2) mis de côté comme tâche séparée plutôt que traité dans l'urgence.

**Vérifications** : `node --check` OK sur le script inline du backstage. Flux testé réellement de bout en bout (upload direct navigateur → R2, lecture de vérification via CDN, suppression) avant intégration, puis re-testé une fois intégré dans le vrai fichier. Message d'erreur clair confirmé quand les identifiants R2 sont absents. Aucune référence restante à `github.io` pour l'audio dans tout le fichier (vérifié par recherche exhaustive après coup).

---

## [2026-08-31g] — UI d'achat réel dans pack.html, bibliothèque acheteur (library.html)

**Fichiers touchés** : `pack.html`, nouveau `library.html`, `layerpitch-i18n.js` (nouvelles clés `pack.buyBtn`/`alreadyOwned`/`signInToBuy*`/`purchase*`, nouvelle zone `library`)

**Contexte** : le backend d'achat (étape 4) était prêt mais invisible sur le site. `pack.html` contenait une décision délibérée déjà en place : bouton d'achat toujours affiché grisé ("Bientôt disponible") pendant la bêta, quel que soit `buyable`/`buyUrl` — signalait aux testeurs que l'achat était envisagé, pas encore réel. Avant de toucher à ce fichier **en production**, confirmé avec Jules-Antoine de garder ce comportement pour l'instant plutôt que d'exposer le vrai flux Stripe (encore en mode test) aux testeurs actuels.

**Solution retenue : interrupteur unique.** `const PURCHASES_ENABLED = false;` en haut du script de `pack.html`. À `false` (état actuel, poussé tel quel) : comportement strictement identique à avant — aucun SDK chargé, aucune requête réseau supplémentaire, "Bientôt disponible" partout, vérifié par comparaison avant/après. À `true` : charge le SDK Supabase + `api/auth.js`/`api/packs.js`/`api/purchases.js` à la demande, affiche l'un de trois états selon le prix réel lu depuis Postgres (jamais data.json, qui n'a pas de champ prix) et la session : formulaire de connexion par lien magique, bouton d'achat (redirige vers Stripe Checkout), ou "Déjà acheté ✓". Bannière de confirmation/annulation au retour de Stripe (`?purchase=success|cancelled`), URL nettoyée ensuite.

**`library.html`** (nouveau, page autonome, non liée depuis aucune page publique pour l'instant — cohérent avec le flag) : bibliothèque acheteur, liste les packs achetés (titre, date, prix) avec lien vers `pack.html`, connexion par lien magique si nécessaire.

**Bug réel trouvé et corrigé en testant (flag activé temporairement, jamais en production)** : la bannière de retour Stripe référençait `container`, une variable hors de portée (déclarée dans une autre fonction) — `ReferenceError` empêchant l'affichage de la bannière. Corrigé (`el.parentNode.insertBefore` plutôt que `container.insertBefore`), revérifié avec le flag activé puis remis à `false` avant de considérer le travail terminé.

**Vérifications** : `node --check` OK sur les scripts inline de `pack.html`/`library.html`. Symétrie i18n FR/EN confirmée (8 zones, nouvelle zone `library` ajoutée). Suite de tests existante inchangée (mêmes 7 échecs préexistants, sans rapport). Testé réellement avec le flag à `true` : lecture du prix Postgres, détection "déjà acheté" (sur le pack acheté à l'étape précédente), création de session Stripe Checkout pour un second pack non possédé (redirection confirmée), bibliothèque acheteur affichant correctement l'achat existant. Comportement par défaut (`false`) revérifié identique à avant après chaque test.

**Hors périmètre** : `collection.html` a le même bouton grisé mais n'a pas été touché — le backend d'achat ne couvre que les packs (`packs.price_usd_cents`), pas les collections. `library.html` non lié depuis `index.html`/`pack.html` — à faire au moment d'activer `PURCHASES_ENABLED`.

---

## [2026-08-31f] — Bascule backend, étape 4 : logique d'achat (Stripe, mode test)

**Fichiers touchés** : nouveau `supabase/functions/create-checkout-session/index.ts`, `supabase/functions/stripe-webhook/index.ts` ; nouveau `api/purchases.js` ; `api/packs.js` complété (`priceUsdCents`) ; nouveau `supabase/migrations/20260831120422_pack_pricing.sql`, `20260831120526_pack_purchases_idempotency.sql`, `20260831152500_service_role_grants.sql`, `20260831193231_profiles_auto_create.sql` ; `.env`/`.env.example` complétés (`STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)

**Contexte** : Jules-Antoine a créé un compte Stripe en cours de session, débloquant l'étape 4 (Décision 5 — "achat de pack depuis l'AdReel", `pack_purchases`, achat unitaire one-time). Choix de compte Stripe fait par Jules-Antoine sur place (Managed Payments — Stripe gère taxes/fraude/support pour 3,5% de frais en plus par transaction, vérifié via la doc Stripe à sa demande) — impacte directement l'implémentation ci-dessous (voir les correctifs Managed Payments).

**Point absent du schéma, trouvé en démarrant cette étape** : `packs` n'avait pas de champ prix (l'achat externe actuel via `buyUrl` gérait ça hors du système). Ajouté `price_usd_cents`, valeurs de **test provisoires** (9,99 $ partout, `buyable` passé à `true` sur les 3 packs) — explicitement pas une décision de pricing réelle, à corriger avant tout lancement.

**Architecture** : `create-checkout-session` (crée une session Stripe Checkout, prix lu depuis Postgres — jamais le client — même principe que `invite-tester`/`upsert_track`) et `stripe-webhook` (reçoit la confirmation de paiement, écrit `pack_purchases` avec la clé service_role). `api/purchases.js` : `buyPack()` (redirection Checkout) et `myPurchases()` (bibliothèque acheteur, lecture RLS "own purchases").

**Six bugs réels trouvés et corrigés en testant en conditions réelles (mode test Stripe, pas juste en théorie)**, du plus superficiel au plus grave :
1. `payment_method_types` explicite rejeté par l'API — Managed Payments (choisi par Jules-Antoine) le gère lui-même.
2. Code de taxe produit manquant, requis par Managed Payments — `txcd_10401100` ("Digital Audio Works - downloaded - non subscription - with permanent rights") identifié via la doc Stripe plutôt que deviné.
3. Version d'API Stripe incompatible avec Managed Payments — le SDK `stripe` npm fige toujours une version par défaut (celle de sa release, pas celle du compte) même sans la préciser ; fixée explicitement à `2025-03-31.basil`, SDK mis à jour vers `stripe@22.6.0`.
4. **`service_role` n'avait aucun GRANT de table** (`permission denied for table packs`) — même cause que le GRANT `anon`/`authenticated` manquant trouvé à l'étape précédente (tables créées via connexion Postgres directe, hors du flux habituel du dashboard Supabase qui pose normalement ces GRANT), mais j'avais oublié ce rôle dans le correctif initial. `service_role` contourne déjà RLS (BYPASSRLS) mais a quand même besoin du privilège de table de base — les deux mécanismes sont indépendants en Postgres.
5. **`pack_purchases.buyer_id` viole sa contrainte FK vers `profiles`** — aucune ligne `profiles` n'était jamais créée à l'inscription (Décision 4 dit "profiles — une ligne par compte", mais le mécanisme (trigger standard `auth.users` → `public.profiles`) n'avait jamais été construit depuis l'étape 3). Ajouté `handle_new_user()` + trigger + backfill du compte existant.
6. **Le webhook avalait silencieusement les erreurs d'écriture** — un paiement Stripe confirmé (200 renvoyé à Stripe) sans que l'achat soit jamais enregistré côté LayerPitch, sans aucune trace (c'est le bug n°5 ci-dessus qui échouait silencieusement). Corrigé : l'erreur de l'upsert est maintenant vérifiée, une écriture échouée renvoie 500 (Stripe considère alors la livraison échouée et réessaie automatiquement — comportement correct pour un webhook de paiement, jamais accepter silencieusement une perte de donnée).

**Vérification de bout en bout, en conditions réelles** (mode test Stripe, pas de simulation) : session Checkout créée par `create-checkout-session`, paiement réel complété (carte de test `4242...`, TVA française calculée automatiquement par Managed Payments — 9,99 $ + TVA = 11,99 $, cohérent), webhook reçu et traité (rejoué manuellement avec une signature reconstruite pour confirmer indépendamment de la redélivraison Stripe), achat visible dans `pack_purchases`, **idempotence confirmée** (même événement rejoué deux fois, une seule ligne), `myPurchases()` confirmé fonctionnel via `api/purchases.js` (bibliothèque acheteur, jointure avec les détails du pack).

**Hors périmètre, actée explicitement** : vrais prix des packs (valeurs de test posées ici, à remplacer), UI d'achat dans `index.html`/`pack.html` (le flux backend est prêt, l'intégration visuelle pas faite cette session), gestion des remboursements/annulations.

---

## [2026-08-31e] — Bascule backend, couche api/*.js et RPC de publication atomique (Décision 2)

**Fichiers touchés** : nouveau `supabase/migrations/20260831110216_rpc_upserts.sql`, `20260831112717_grants.sql` ; nouveau `api/tracks.js`, `api/packs.js`, `api/adreels.js` ; nouveau `scripts/test-rpc-upserts.js`

**Contexte** : prérequis identifié à la fin de l'étape 3 — pas de compte Stripe disponible pour attaquer l'étape 4 (logique d'achat) telle quelle, donc avancement sur la couche `api/*.js`/RPC de la Décision 2 (indépendante de Stripe, nécessaire de toute façon avant tout achat réel).

**RPC ajoutées** (`is_admin()`, `upsert_track`, `upsert_pack`, `upsert_ad_reel`) : écriture atomique multi-tables, `SECURITY DEFINER`. `upsert_track` valide le graphe `segmentSlots`/`nextOptions` **avant** toute écriture — une simple FK ne peut pas exprimer "la cible d'un branchement doit appartenir au même morceau" (`segment_slot_transitions.target_slot_id` référence `segment_slots` globalement, pas par morceau). Un graphe invalide lève une exception, qui annule tout le reste de l'écriture (rien n'est laissé à moitié écrit) — vérifié par test réel, pas supposé. Autorisation : même interim que `invite-tester` (étape 2) — `is_admin()` compare l'email de l'appelant authentifié à une adresse en dur, en l'absence de `profiles`/rôle exploitable.

**Deux bugs réels trouvés et corrigés par les tests, avant tout usage réel** :
1. **Test via connexion Postgres directe insuffisant** : les RPC passaient tous les tests via `pg` (8/8), mais `api/tracks.js` échouait en conditions réelles (navigateur → PostgREST) avec `"more than one relationship was found for 'segment_slots' and 'segment_slot_transitions'"` — `segment_slot_transitions` porte deux FK vers `segment_slots` (`from_slot_id` et `target_slot_id`), PostgREST ne peut pas deviner laquelle utiliser pour l'imbrication automatique sans l'indice explicite `!from_slot_id`. Une connexion `pg` directe ne passe pas par PostgREST donc ne pouvait pas révéler ce problème — leçon retenue : tester aussi via le vrai chemin navigateur, pas seulement la logique SQL isolée.
2. **`permission denied for table tracks`** : les tables ayant été créées via connexion Postgres directe plutôt que par le flux habituel du dashboard Supabase, les GRANT `SELECT` par défaut que Supabase pose normalement pour `anon`/`authenticated` n'avaient jamais été appliqués — RLS restreint les lignes visibles mais ne remplace pas le privilège de table de base. Migration `grants.sql` ajoutée (`GRANT SELECT` + `ALTER DEFAULT PRIVILEGES` pour les futures tables).

**`api/tracks.js`/`api/packs.js`/`api/adreels.js`** : lecture directe via SDK Supabase avec imbrication PostgREST (`segment_slots(*, segment_slot_transitions!from_slot_id(*))` etc., une seule requête réseau plutôt que des requêtes en cascade), reconstruction de la forme exacte attendue par `player.js` (mêmes noms de champs que `data.json`). Écriture exclusivement via les RPC `upsert_*` — aucune écriture directe sur les tables depuis le front.

**Vérifications** : `node --check` OK sur les nouveaux fichiers. `scripts/test-rpc-upserts.js` : 8/8 (rejet non-admin, écriture simple, graphe valide accepté, **graphe invalide rejeté avec rollback atomique confirmé** — rien écrit —, upsert_pack avec remplacement propre des tables de liaison au ré-upsert, upsert_ad_reel). Test de bout en bout réel via navigateur (vraie session magic link, chargement des scripts, appels PostgREST réels) après correction des deux bugs ci-dessus : lecture publique de 14 morceaux / 3 packs / 6 AdReels, écriture admin réussie, rejet de graphe invalide confirmé au vrai chemin d'API. Données de test nettoyées, `scripts/verify-postgres-migration.js` reconfirmé 27/27 après coup (aucune donnée réelle affectée).

**Hors périmètre** : étape 4 (logique d'achat, Stripe) — aucun compte Stripe disponible cette session, je ne peux pas en créer un à la place de Jules-Antoine. `api/publish.js` (orchestration multi-entités façon "Sauvegarder/publier" actuel du backstage) volontairement non construit — chaque `upsert_*` est atomique individuellement, mais une vraie atomicité cross-entités façon "tout `data.json` en une fois" nécessiterait une RPC dédiée plus large, pas nécessaire tant que le site public ne dépend pas de Postgres (Décision 5).

---

## [2026-08-31d] — Bascule backend, étape 3 : base Postgres et migration des données

**Fichiers touchés** : nouveau `supabase/migrations/20260831102635_initial_schema.sql`, `20260831102636_rls_policies.sql`, `20260831105209_segment_slots_missing_fields.sql` ; nouveau `scripts/apply-migrations.js`, `scripts/migrate-data-to-postgres.js`, `scripts/verify-postgres-migration.js` ; `.env`/`.env.example` complétés (`SUPABASE_DB_URL`)

**Contexte** : Décision 1 (schéma hybride relationnel + JSONB) et Décision 5 (étape la plus délicate — le script de migration peuple Postgres depuis `data.json`, sans faire dépendre le site public de cette base tant qu'un AdReel de test n'est pas vérifié identique en comportement à l'original).

**Points d'interprétation tranchés avec Jules-Antoine avant d'écrire le SQL** (la Décision 1 ne les couvrait pas dans le détail) :
- Tables de liaison (`track_sfx`, `pack_sfx`) appliquées par cohérence aux deux cas que la Décision 1 ne citait pas nommément (elle citait `pack_tracks`/`collection_packs`/`ad_reel_tracks`), plutôt que des tableaux d'IDs bruts.
- IDs existants de `data.json` (ex. `bmrc8rec1wtahz`, pas des UUID) conservés tels quels comme clés primaires (`text`) — migration directe, cohérence avec les chemins R2 déjà basés sur ces mêmes IDs.

**Schéma appliqué** : 25 tables (comptes/profils, `plan_quotas` avec quotas volontairement laissés `NULL` — pas encore décidés, non fabriqués —, réglages globaux, morceaux/dossiers, `segment_slots`/`segment_slot_transitions` pour le mode sequential, Sfx/dossiers, packs/collections/albums, AdReels/dossiers, achats). RLS activé sur toutes les tables : lecture publique (cohérent avec le site actuel, sans auth), écriture réservée à `service_role` en attendant la couche `api/*.js` de CRUD applicatif (Décision 2, pas encore construite).

**Deux bugs réels trouvés et corrigés par le script de vérification de fidélité** (pas de simples différences de format — de vraies pertes de données évitées avant toute mise en production) :
1. **Chaînes vides converties en `null`** : le script de migration utilisait `champ || null` pour plusieurs colonnes texte nullable (`implementationNote`, `loopEngine`, `loopGridUnit`, `cutStyle`, `rrMode`, `illustration`, `watermark`, `bgColor`, `textColor`, `font`...) — `''` étant une valeur JS "fausse", ce pattern la remplaçait silencieusement par `null`, perdant la distinction entre "vide" et "jamais renseigné". Corrigé par un helper `nn()` qui ne substitue `null` que pour une valeur réellement absente (`undefined`/`null`).
2. **Deux colonnes manquantes sur `segment_slots`** : `bpm` et `customCutFadeSec` existent dans `data.json` (rencontrés sur un vrai morceau, "Robot Adventure") et sont lus par `player.js` (`slotTiming()`) mais absents du schéma initial — auraient silencieusement perdu tout override de tempo/fondu par emplacement. `beatsPerBar` ajoutée par cohérence (même mécanisme, pas encore rencontrée dans les données actuelles). Migration `20260831105209` ajoutée, données réimportées.

**Vérifications** : `node --check` OK sur les trois scripts. **Vérification de fidélité complète** (`scripts/verify-postgres-migration.js`, va au-delà du minimum "un AdReel de test" de la Décision 5) : reconstruction depuis Postgres et comparaison profonde à l'original pour la totalité de `data.json` — 6 AdReels, 14 morceaux (avec `segmentSlots`/`nextOptions` reconstruits), 3 Sfx, 3 packs, 1 collection — **27/27 identiques**. Suite de tests existante exécutée en entier après la migration : aucune régression (les 7 échecs `test_backstage_*` préexistants, déjà signalés et mis de côté dans une tâche séparée, sont sans rapport — ni `player.js` ni `layerpitch-backstage.html` ne sont touchés par ce chantier). Symétrie i18n FR/EN inchangée (7 zones).

**Hors périmètre, actée explicitement (Décision 5)** : le site public ne dépend pas encore de cette base — `data.json` reste la source de vérité en production. Couche `api/*.js` de CRUD applicatif, RPC de validation du graphe `segmentSlots`/publication atomique (Décision 2) : pas construites dans cette session, nécessaires avant tout basculement réel.

---

## [2026-08-31c] — Correction des deux anomalies de tests préexistantes signalées à l'étape 1

**Fichiers touchés** : `test_backstage_branch_collapse_and_header_order.js`, `test_backstage_default_collapse.js`, `test_backstage_filename_bpm_bars_detection.js`, `test_backstage_intro_outro_collapse_and_reorder.js`, `test_backstage_maxchainloops.js`, `test_backstage_seq_transitions.js`, `test_backstage_slot_autolabel.js`, `test_backstage_slot_collapse.js`, `test_quantized_loop_engine.js`, `test_seq_branching.js`

**1) `inlineExactLine()` ne reconnaissait plus les balises `<script>` versionnées.** Les 9 fichiers ci-dessus (helper dupliqué à l'identique dans chacun) comparaient la ligne HTML à une chaîne exacte sans `?v=...`, alors que `layerpitch-backstage.html` réécrit ces balises avec un cache-buster depuis le 13 août (`updateScriptVersions()`). Résultat : le script (le plus souvent `player.js`) n'était jamais réellement inliné dans le DOM de test, d'où `window.LayerPlayerCore` incomplet et `buildTrackRow`/`parseAudioFilenameHints` indéfinis. **Corrigé** : la comparaison normalise la ligne en retirant un éventuel `?...` avant l'extension `.js` avant de la comparer au tagline attendu. `test_backstage_maxchainloops.js` et `test_quantized_loop_engine.js` passent maintenant intégralement (confirmé). Les 7 autres fichiers de ce lot dépassent maintenant ce point mais échouent sur des assertions différentes, sans rapport — voir plus bas.

**2) `test_seq_branching.js` intermittent — vraie course identifiée dans `player.js`, pas juste un test fragile.** Diagnostic (comparaison de 6 exécutions instrumentées) : quand la durée totale d'un passage sur un emplacement séquentiel correspond exactement à une seule unité de quantification (`bars: 1` avec `quantization` par défaut = `bar`), deux mécanismes indépendants de `player.js` tombent au même instant nominal — l'événement "l'emplacement rejoue depuis le début" (qui incrémente `seqBranchEpoch`, voir `activateSeqStage`) et le timer de vérification de frontière du passage qui se termine (`armNextSeqBranchBoundary`, qui vérifie `pendingNextSegmentId` puis appelle `performSeqBranchCut()`). Le second timer, ayant été calculé/armé légèrement après le premier, se retrouve invalidé par l'epoch avancé avant même de pouvoir vérifier le choix en attente — silencieusement, à chaque cycle, de façon déterministe pour toute la durée d'une exécution (d'où l'échec "tout ou rien" par run plutôt qu'un échec ponctuel). **Corrigé côté test** : l'alternative de l'emplacement testé passe de `bars: 1` à `bars: 2`, pour que la première frontière de quantification tombe au milieu du passage plutôt qu'exactement à sa toute fin — élimine la coïncidence sans changer le comportement testé. Stress-testé 20 exécutions consécutives, 20/20 réussies (0/3 avant le correctif sur un échantillon comparable).

**Point non traité, à signaler pour une session dédiée** : la course sous-jacente existe dans `player.js` lui-même, pas seulement dans le test — un vrai emplacement séquentiel configuré avec `bars` = 1 unité de quantification pourrait, en conditions réelles, occasionnellement "avaler" un clic de branchement sans jamais l'appliquer (le choix reste affiché "en attente" indéfiniment jusqu'à ce qu'un timing plus favorable se présente, ou jusqu'à l'arrêt de la piste). Non corrigé ici par prudence — c'est un changement dans le moteur de lecture central, avec une suite de tests existante à ne pas déstabiliser sans un temps d'analyse dédié.

**Nouveau constat, distinct des deux bugs ci-dessus** : une fois le point 1 corrigé, 7 des 9 fichiers `test_backstage_*` échouent maintenant sur des assertions différentes (éléments/sélecteurs introuvables — ex. `Cannot set properties of null`, "zone de dépôt des emplacements trouvée" en échec) : `test_backstage_branch_collapse_and_header_order.js`, `test_backstage_custom_cut_fade_roundtrip.js`, `test_backstage_default_collapse.js`, `test_backstage_filename_bpm_bars_detection.js`, `test_backstage_intro_outro_collapse_and_reorder.js`, `test_backstage_seq_transitions.js`, `test_backstage_slot_autolabel.js`, `test_backstage_slot_collapse.js`. Masqués jusqu'ici par le bug du point 1 (le test plantait avant d'atteindre ces assertions). Cause probable : dérive entre ces tests et l'UI actuelle de `layerpitch-backstage.html` (fichier réintroduit dans cette copie locale en cours de session, potentiellement plus avancé que ce que ces tests attendent). Non investigué ni corrigé dans cette passe — périmètre distinct des deux bugs explicitement signalés à l'étape 1, à traiter séparément.

---

## [2026-08-31b] — Bascule backend, étape 2 : authentification Supabase (magic link, invite-only)

**Fichiers touchés** : nouveau `api/auth.js`, nouveau `supabase/functions/invite-tester/index.ts`, nouveau `auth-test.html`, `.env`/`.env.example` complétés (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`)

**Contexte** : Décision 4 (`docs/infrastructure.md`, Partie B) — Supabase Auth, magic link passwordless, inscriptions publiques désactivées, invitation via Edge Function `invite-tester` détenant seule la clé secrète Admin.

**Point technique imprévu, tranché avec Jules-Antoine avant tout code** : la Décision 4 prévoit que `invite-tester` soit appelée depuis `api/auth.js`, mais ne précise pas qui a le droit de l'appeler — aucune table `profiles`/rôle n'existe encore (arrive à l'étape 3, base Postgres). Retenu en attendant : la fonction vérifie elle-même que l'appelant est authentifié ET que son email correspond au secret `ADMIN_EMAIL` (Jules-Antoine uniquement). À remplacer par une vraie vérification de rôle une fois `profiles` en place — changement contenu à l'intérieur de la fonction, aucun autre fichier à toucher.

**Changement** :
- `api/auth.js` : couche d'abstraction (`window.LayerPitchAuth`) — seul fichier du front à toucher `supabase.auth.*`, comme prescrit par la Décision 2. Expose `signInWithMagicLink`, `signOut`, `getSession`, `onAuthStateChange`, `inviteTester`. Nécessite le SDK Supabase chargé en amont via CDN (`@supabase/supabase-js@2`, build UMD — pas de module ES, cohérent avec la contrainte 100% statique/file://).
- `supabase/functions/invite-tester/index.ts` : Edge Function Deno, vérifie l'appelant (JWT + `ADMIN_EMAIL`) puis appelle `auth.admin.inviteUserByEmail` avec la clé service_role (jamais exposée côté client). Déployée manuellement via l'éditeur du dashboard Supabase (pas de CLI installée cette session).
- `auth-test.html` : page de test isolée (Décision 5 — "isolable, testable en parallèle de l'usage normal"), n'affecte ni le site public ni le backstage. Formulaire de connexion par lien magique + section admin (invitation).
- Inscriptions publiques désactivées côté projet Supabase (`disable_signup` confirmé `true` par requête directe, était `false` par défaut à la création du projet).

**Vérifications** (bout en bout, avec l'accord explicite de Jules-Antoine avant chaque envoi d'email réel) :
- `node --check` OK sur `api/auth.js` et le script inline de `auth-test.html`.
- Flux magic link complet testé avec `julzantoine@yahoo.com` : envoi, clic sur le lien reçu, session établie et persistée (confirmée après rechargement de page), déconnexion fonctionnelle.
- **Piège d'outillage rencontré, sans rapport avec le code** : la toute première tentative d'ouvrir le lien magique via l'outil de navigateur automatisé a échoué à charger la page tout en consommant le jeton à usage unique côté Supabase (jeton à usage unique, `otp_expired` au deuxième essai) — contournement adopté : capturer la redirection via `curl --max-redirs 0` (qui contient `access_token`/`refresh_token` dans le fragment d'URL) puis charger cette URL locale directement, qui fonctionne de façon fiable.
- Edge Function `invite-tester` testée en conditions réelles : d'abord `403 Non autorisé` (secret `ADMIN_EMAIL` pas encore créé côté dashboard — corrigé), puis `400 A user with this email address has already been registered` (test avec une adresse ayant déjà un compte — confirme que l'authentification admin ET l'appel réel à l'API Admin fonctionnent), puis `400 email rate limit exceeded` en testant avec une adresse neuve — **confirmation concrète de la limite de 2 emails/heure déjà anticipée par la Décision 4**, pas un bug. Renvoi réel à valider une fois la fenêtre d'une heure écoulée.
- Ménage : une fonction `smart-processor` créée par erreur (nom par défaut du dashboard, code d'exemple non remplacé) au premier essai de déploiement, supprimée.

**Hors périmètre, actée explicitement** : intégration de l'auth dans `layerpitch-backstage.html` (remplacement effectif du système bêta GitHub) — la Décision 5 la prévoit "sans coupure", donc après validation complète en isolation, pas dans cette session. Base Postgres/table `profiles` (étape 3) — nécessaire pour remplacer la vérification `ADMIN_EMAIL` par une vraie gestion de rôle.

---

## [2026-08-31] — Bascule backend, étape 1 : migration des médias vers Cloudflare R2

**Fichiers touchés** : `data.json`, `index.html`, `pack.html`, `collection.html`, nouveau `scripts/migrate-media-to-r2.js`, nouveau `.gitignore` (absent jusqu'ici — voir plus bas), nouveau `.env` (jamais committé)

**Contexte** : Premier chantier de code de la Partie B (`docs/infrastructure.md`), architecture actée le 27 août. Décision 3 : migration 1:1 de `audio/` et `images/` vers le bucket R2 `layerpitch-media`, domaine personnalisé `media.layerpitch.com`, sans presigned URLs.

**Points techniques imprévus, tranchés avec Jules-Antoine avant tout code** (la Décision 3 ne les couvrait pas explicitement) :
- `images/` n'est **pas** structuré en sous-dossier par entité (`images/<packId>/...`) comme le décrivait la doc — dossier plat, sans mécanisme de champ `base` comme l'audio (les 13 usages sont codés en dur `./images/...` dans `index.html`/`pack.html`/`collection.html`). Retenu : constante `IMAGES_BASE` en dur dans chaque fichier (pas de nouveau champ dans `data.json`), même logique que l'existant.
- Les Sfx (`audio/sfx-<id>/`) partagent en réalité déjà le mécanisme `base` de l'audio — pas de préfixe `sfx/` séparé comme le supposait la Décision 3 ; aucun cas particulier à gérer.
- Le pipeline d'upload de `layerpitch-backstage.html` (`ghPutFile`) écrit toujours vers GitHub, pas vers R2 — laissé hors périmètre de cette étape (décision explicite : geler les nouveaux uploads/remplacements média le temps qu'une session dédiée réécrive ce pipeline vers l'API S3 de R2, pour ne pas casser un fichier fraîchement uploadé après la bascule du champ `base`).
- **`layerpitch-backstage.html` n'était protégé par aucun `.gitignore`** (le fichier n'existait même pas dans cette copie locale, puis ajouté en cours de session) — `git status` le montrait comme fichier non suivi, donc exposable via un `git add -A`. Créé `.gitignore` (`layerpitch-backstage.html`, `.env`, `node_modules/`) avant toute autre modification.

**Changement** :
- `scripts/migrate-media-to-r2.js` (Node.js, aucune dépendance externe — signature AWS SigV4 en pur `crypto`/`https`, cohérent avec `layerpitch-beta-sync.js`) : commandes `upload [--only=audio|images] [--dry-run]` et `verify`. Idempotent (compare MD5 local vs ETag distant, un fichier identique n'est jamais réenvoyé). Identifiants lus depuis `.env` (jamais en dur, jamais committé).
- Migration exécutée et vérifiée : 102/102 fichiers (68 audio `.ogg`, 34 images `.avif/.jpeg/.jpg/.png`, ~75 Mo) présents et identiques sur R2 (MD5 == ETag pour chacun — hypothèse de départ, confirmée en pratique sur un PUT simple non multipart).
- Confirmé par requête HTTP directe que `media.layerpitch.com` sert déjà correctement le contenu migré (200, bon `content-type`, bon `content-length`) — la configuration du domaine personnalisé sur le bucket a visiblement avancé depuis la dernière mise à jour de la doc (29 août, "pas encore faite").
- `data.json` : les 17 champs `base` (morceaux + Sfx) réécrits de `https://Julzantoine.github.io/layerpitch/audio/...` vers `https://media.layerpitch.com/audio/...`.
- `index.html`/`pack.html`/`collection.html` : nouvelle constante `const IMAGES_BASE = 'https://media.layerpitch.com/images/'`, les 13 usages de `./images/` remplacés par `${IMAGES_BASE}`.

**Vérifications** : `node --check` OK sur les trois blocs `<script>` inline (extraction + vérification syntaxique), `data.json` validé comme JSON, symétrie i18n FR/EN confirmée (7 zones, aucun écart — non affectée par ce changement). Suite de tests existante exécutée en entier (après installation locale de `jsdom`, absent de l'environnement) :
- Tous les tests moteur audio (`test_seq_*`, `test_embr_*`, `test_vr_engine`, `test_player_regression`, `test_max_chain_loops_e2e`) passent, sans lien avec ce changement (aucun fichier moteur touché).
- **Deux anomalies préexistantes découvertes, non causées par ce changement** (confirmé en comparant sur l'état `git stash` d'avant les modifications) : `test_seq_branching.js` est intermittent (flaky — 2 échecs sur 3 essais avant même les modifications de cette session, à investiguer séparément) ; tous les `test_backstage_*.js` échouent avec `buildTrackRow` indéfini, cause identifiée : ces tests cherchent une balise exacte `<script src="player.js"></script>` sans le `?v=...` de cache-busting ajouté au fichier backstage le 13 août (`updateScriptVersions()`), donc l'injection inline du script échoue silencieusement. Non corrigé dans cette session (hors périmètre étape 1/2), signalé à Jules-Antoine.

**Hors périmètre, actée explicitement** : réécriture du pipeline d'upload du backstage vers R2 — à traiter dans une session dédiée.

**Bug bloquant trouvé et corrigé au test visuel — CORS manquant sur le bucket R2.** Le `curl` de vérification (200, bon contenu) ne l'avait pas révélé : `player.js` charge l'audio via `fetch()` + `decodeAudioData` (Web Audio API, nécessaire au bouclage sample-accurate — pas un simple `<audio src>`), donc soumis à la vérification CORS du navigateur, contrairement aux images (`<img src>`, jamais concernées). Sans règle CORS sur le bucket, tout `fetch()` cross-origin vers `media.layerpitch.com` échouait silencieusement (`net::ERR_FAILED`) dès que le site n'est pas servi depuis le même domaine que le bucket — cassait donc toute lecture audio en production.

- Extension de `scripts/migrate-media-to-r2.js` : nouvelles commandes `set-cors`/`get-cors` (support des opérations de niveau bucket dans la signature SigV4 — canonical query string `cors=`, URI canonique sans le fichier). Le token R2 existant (portée "Object Read & Write") s'est révélé insuffisant (`403 AccessDenied` sur les deux commandes) — configuration de niveau bucket, pas objet.
- CORS finalement posé manuellement par Jules-Antoine via le dashboard Cloudflare (R2 > `layerpitch-media` > Settings > CORS Policy) : `AllowedOrigins: ["*"]`, `GET`/`HEAD`. Origine large retenue à dessein — cohérent avec le modèle d'accès public déjà acté (Décision 3, pas de presigned URLs) et R2 est egress-free (pas de coût lié à l'origine du trafic).
- Piège rencontré en revérifiant : le cache Cloudflare avait mis en cache mes toutes premières requêtes de test (faites avant l'activation du CORS) sous les mêmes URLs exactes que celles utilisées par le site (`?v=<publishedAt>`) — `cf-cache-status: HIT` pendant 4h sans l'en-tête malgré le CORS déjà actif à l'origine. Résolu par un `Purge Everything` manuel (dashboard Cloudflare, dans le même passage).

**Test visuel effectué** (serveur statique local `python3 -m http.server`, `.claude/launch.json` ajouté) : page publique chargée, 50 requêtes vers `media.layerpitch.com` confirmées réussies via `performance.getEntriesByType('resource')` (audio + images mélangés), lecture d'un morceau déclenchée manuellement et confirmée active (statut "Lecture en cours" affiché, pas seulement un état visuel figé), aucune erreur console sur un onglet neuf. Migration étape 1 déclarée fonctionnelle de bout en bout.

---

## [2026-08-29f] — Garde-fou contre une publication écrasant les données après un échec de chargement

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : confirmation de Jules-Antoine sur le scénario exact vécu — erreur 403 au chargement automatique (jeton GitHub), puis clic sur "Sauvegarder / publier" en mode panique, ce qui aurait écrasé les vraies données publiées par une bibliothèque restée vide en mémoire. Diagnostic mené la session précédente : le bouton Publier n'avait aucune protection contre ce cas.

**Correctif** : nouveau flag `dataLoadOk`, vrai une fois qu'un chargement a réussi (données existantes chargées OU absence légitime de `data.json` au tout premier lancement) — et qui **reste vrai** ensuite même si un rechargement manuel ultérieur échoue à son tour, puisque les données en mémoire restent alors les bonnes (le `catch` de `loadData()` ne les touche pas). Seul le tout premier chargement resté en échec bloque réellement la publication.

Trois niveaux de protection :
- Le bouton "Sauvegarder / publier" est désactivé par défaut dans le HTML, et reste désactivé si le tout premier chargement échoue (infobulle explicative).
- `loadData()` le réactive dès qu'un chargement réussit (dans les deux cas légitimes).
- `publishAll()` vérifie aussi `dataLoadOk` en tout début de fonction (défense en profondeur, au cas où le bouton serait réactivé par un autre chemin), avec un message clair dans le journal expliquant quoi faire (recharger avant de publier).

**i18n** : `publishBlockedNoLoadMsg`, `publishDisabledUntilLoadHint` (nouvelles, FR/EN) — symétrie vérifiée (687 clés de chaque côté).

**Vérifications** : `node --check` OK, balises `<div>` équilibrées (474/474), couverture i18n complète. Modification limitée au backstage (aucun changement dans `player.js`), suite de tests audio non concernée.

---

## [2026-08-29e] — Reprise après changement d'onglet corrigée, UI transition réorganisée, glisser-déposer pour l'ordre des morceaux d'un AdReel

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, nouveau `test_embr_vertical_visibility_resume.js`

**Contexte** : message groupé de Jules-Antoine (4 captures d'écran) après avoir buté sur un jeton GitHub expiré. Diagnostic mené en premier : `data.json` publié vérifié intact (14 morceaux, 6 AdReels, 3 packs — la sauvegarde interrompue par la fermeture accidentelle de fenêtre n'a rien corrompu), le `403` au chargement automatique est un problème d'authentification côté navigateur (jeton à régénérer), pas un bug applicatif. Vérification du morceau concerné par le signalement "la transition ne réagit toujours pas correctement" : `transition: null` sur les deux boucles dans le JSON publié — sa configuration (bascule "prochain temps" + durée "1 temps") n'a donc jamais pu être publiée, bloquée depuis le début par ce même jeton expiré. Aucune régression du moteur trouvée à ce sujet ; à retester une fois le jeton réparé et les derniers fichiers republiés.

**1) Bug réel trouvé et corrigé — la lecture d'un morceau en embranchement-vertical repartait de la référence à chaque changement d'onglet.** Diagnostic : le gestionnaire de reprise après mise en arrière-plan (`visibilitychange`) ne traite explicitement que le séquentiel et le vertical-random (recherche fine à la position exacte) ; l'embranchement-vertical tombait dans le chemin générique, qui appelle `playThisTrack()` sans discernement — or pour ce mode, ça route vers `playEmbrVertical()`, qui réinitialise TOUJOURS `embrActiveLoopIdx` sur la référence, perdant la boucle "paire" réellement active (ex. "On est repéré !").

   Correctif : nouvelle fonction `resumeEmbrVerticalAfterBackground()`, chemin dédié dans le gestionnaire `visibilitychange`. Ne tente pas de retrouver la phase exacte d'avant la mise en veille (potentiellement longue, aucun repère fiable pour plusieurs boucles phase-verrouillées en parallèle) mais relance proprement une nouvelle horloge de phase à partir de maintenant, EN PRÉSERVANT la boucle qui était effectivement active. Cas d'un détour en cours au moment de la mise en veille (pas de boucle "paire" à préserver) : repli sur la référence, compromis acceptable pour un aparté ponctuel.

   **Test** : nouveau fichier `test_embr_vertical_visibility_resume.js` — simule un vrai changement de `document.visibilityState` (pas un appel direct à une fonction interne), bascule vers une boucle "paire", déclenche hidden→visible, vérifie que cette boucle reste active après le retour. Au vert.

**2) Réorganisation de l'UI transition d'une boucle embranchement-vertical.** Deux retours de Jules-Antoine : le bloc de réglages de transition ("Ajouter une transition" + réglages associés) est maintenant entouré d'un encadré à fond bleu clair — réutilisation de la classe `.branch-options-panel` déjà existante côté séquentiel plutôt qu'un nouveau style. Le bloc "Retour automatique vers la référence" est déplacé AVANT le bloc transition (dans l'ordre de lecture), pour éviter la confusion entre les deux réglages, qui n'ont pourtant aucun lien entre eux.

**3) Glisser-déposer pour l'ordre des morceaux d'un AdReel.** `wireArrayDragReorder()` généralisée pour accepter aussi bien un tableau d'objets `{id, ...}` (usage historique) qu'un tableau de simples identifiants (le cas ici) — nouvel `idOf()` interne, aucun changement de comportement pour les usages existants. Poignée de glisser-déposer (`dragHandleHtml()`, déjà existante) ajoutée à chaque ligne du sélecteur de morceaux d'un AdReel (`buildTrackSelectorWidget`, les deux variantes avec et sans éditeur de surcharge). Câblage fait UNE SEULE FOIS hors de `render()` (le conteneur est persistant à travers les rendus successifs du widget — le câbler depuis l'intérieur de `render()` aurait empilé un nouveau jeu d'écouteurs à chaque rendu). Styles CSS et filet de sécurité global (relâchement du `draggable` sur pointerup/pointercancel) étendus à la nouvelle classe `.sel-track-item`, en miroir exact de `.seq-master-item`. Les flèches ↑/↓ restent en place (repli accessible/clavier), comme demandé.

**Non traité, laissé en attente** : position du message d'aide "Boucle de détour" (formulation ambiguë, à clarifier avec Jules-Antoine avant d'y toucher) ; visualisation des pistes superposées (nouvelle fonctionnalité explicitement différée par Jules-Antoine lui-même — "quand ce sera réparé").

**Vérifications** : `node --check` OK. Balises `<div>` équilibrées (474/474). Couverture i18n complète, aucune nouvelle clé nécessaire (réutilisation totale). Suite de tests complète (12 fichiers, dont le nouveau) rejouée sans régression.

---

## [2026-08-29d] — Correctif audio critique (silence + boucles superposées), icône du contrôle de fichier, nom de fichier d'origine conservé

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `test_embr_vertical_transitions.js` (réécrit)

**Contexte** : Jules-Antoine a testé en conditions réelles le correctif de timing des transitions livré plus tôt dans la session (29/08c) et signalé deux régressions concrètes : silence pendant la transition, et boucles superposées (notamment en revenant sur la boucle de référence).

**1) Bug critique corrigé — architecture des transitions d'embranchement-vertical entièrement revue.** Diagnostic : l'approche précédente ne différait que la MONTÉE de gain de la boucle cible (via `refreshEmbrGains(idx, transDelay)`), tout en mettant à jour `embrActiveLoopIdx` immédiatement. Deux conséquences :
   - La boucle SOURCE redescendait à 0 tout de suite (fondu de 0.15s), pendant que la boucle CIBLE ne remontait qu'après la durée de la transition -> un vrai trou de silence entre les deux si la transition dure plus longtemps que le fondu de sortie.
   - Le planificateur périodique qui régénère les boucles à chaque cycle (`scheduleEmbrGeneration`) lit `embrActiveLoopIdx` (déjà mis à jour) pour décider du gain de chaque nouvelle génération — et l'affecte directement à 1, sans avoir la moindre connaissance de la bascule en attente. Si un nouveau cycle démarre avant la fin de la transition (cas fréquent, notamment pour la boucle de référence qui tourne en permanence), une nouvelle génération de la boucle cible démarre à plein volume en même temps que l'ancienne génération continue d'exister -> boucles superposées.

   **Correctif retenu** : toute la bascule (`embrActiveLoopIdx`, gains, UI, minuteur de retour) est désormais différée EN BLOC via un vrai délai JS (`setTimeout`), plutôt que le gain seul via l'automation Web Audio. Pendant l'attente, RIEN ne change dans le moteur — la boucle actuellement audible continue de jouer absolument normalement (la transition vient simplement se superposer par-dessus, en overlay, jamais de silence), et le planificateur périodique continue de fonctionner exactement comme avant, sans avoir besoin d'être rendu "conscient" d'une bascule en cours. Une fois la transition terminée, la bascule s'exécute d'un coup, exactement comme une coupure immédiate ordinaire. Nouveau minuteur `embrPendingTransitionSwitchTimeout`, annulé/remplacé si un nouveau clic arrive avant son exécution (même principe que `embrPendingSwitchTimeout` pour la quantification — les deux peuvent s'enchaîner). `refreshEmbrGains()` simplifiée en conséquence (paramètre de délai retiré, plus jamais utilisé).

   **Découverte annexe pendant ce diagnostic** : les réglages de durée de transition (mesures/temps/secondes/tempo propre, ajoutés en 29/08b) n'étaient en réalité JAMAIS persistés dans `data.json` pour l'embranchement-vertical (aucun champ chargé ni sauvé, seul le fichier lui-même survivait), et `durationBeats` manquait aussi côté chargement pour le séquentiel. Corrigé en même temps (chargement ET sauvegarde des deux modes désormais complets et symétriques).

   **Tests** : `test_embr_vertical_transitions.js` entièrement réécrit — l'ancienne méthode (inspection des paramètres passés aux appels Web Audio) ne reflète plus rien avec la nouvelle architecture, où le délai vit dans un `setTimeout` JS et non plus dans l'automation audio. Nouvelle méthode : mesure en temps réel écoulé (même principe que `test_seq_transitions.js`), observation de l'état des boutons. Nouveau scénario E de non-régression : un second clic pendant une transition en attente annule et remplace la première bascule plutôt que de laisser les deux s'exécuter.

**2) Icône du bouton de sélection de fichier trop grande.** Cause : la règle CSS `.btn-icon svg { width: 14px; height: 14px }` ne s'appliquait plus après le remplacement de la classe `btn-icon` par `btn btn-small` (29/08c, ajout du libellé texte). Nouvelle règle dédiée `.file-ctrl [data-role="pickBtn"] svg` dans le `<style>` inline du backstage. **Non reporté dans `backstage.css`** (fichier local, hors d'atteinte) — à synchroniser manuellement.

**3) Nom de fichier d'origine conservé et affiché.** Le nom affiché à côté de l'icône une fois un fichier publié était jusqu'ici le nom de STOCKAGE généré par l'app à partir du label (ex. `loop1-on-est-repere.ogg`), pas le nom donné par le compositeur (ex. `Lent.wav`), perdu à la publication. Nouveau champ `originalFileName`, capturé à la publication (juste avant que `pendingFile` soit vidé) et persisté au chargement/sauvegarde de `data.json`, pour la quasi-totalité des entités avec fichier : couches, intro/outro (séquentiel + vertical-random), alternatives (séquentiel, vertical-random, Sfx), boucles et transitions d'embranchement-vertical, transitions séquentielles, logo, photo, image de fond du thème, vignettes vidéo, galerie photo, illustration/filigrane Pack, illustration Collection, polices personnalisées. `updateFileStatus()` affiche ce nom en priorité, avec repli sur l'ancien comportement (nom de stockage) pour les fichiers déjà publiés avant ce chantier — jamais retouché rétroactivement. Seul le champ d'image de fond dynamique PAR BLOC (réglage d'apparence générique, décoratif) reste hors périmètre, jugé trop marginal.

**i18n** : `publishedFilePrefix` (session précédente) réutilisée, aucune nouvelle clé nécessaire pour ce tour.

**Vérifications** : `node --check` OK sur `player.js` et le script inline extrait du backstage. Balises `<div>` équilibrées (473/473). Couverture i18n complète. Suite de tests complète (11 fichiers) rejouée sans régression, y compris le fichier de test réécrit. `test_quantized_loop_engine.js` échoue toujours à l'identique (bug d'environnement pré-existant confirmé sans lien avec cette session).

---

## [2026-08-29c] — Dossiers fermés par défaut, bouton de boucle masqué pendant sa propre lecture, refonte des contrôles de fichier

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `test_embr_vertical_engine.js`

**Contexte** : trois retours de Jules-Antoine (captures d'écran des dossiers de bibliothèque ouverts par défaut, des boutons de boucle embranchement-vertical, et d'un contrôle de fichier de transition).

**1) Dossiers fermés par défaut à l'ouverture.** `collapsedLibraryFolderIds`/`collapsedSfxFolderIds`/`collapsedAdReelFolderIds` partaient d'un `Set()` vide (tous les dossiers ouverts). Peuplés désormais avec tous les dossiers existants juste après leur chargement depuis `data.json`, dans `loadData()`. Un dossier créé en cours de session (bouton "+ Dossier") n'est pas concerné et reste ouvert comme avant.

**2) Bouton d'une boucle masqué pendant qu'elle joue.** `updateEmbrButtonsUI()` (player.js) masque désormais (au lieu de simplement l'entourer d'une classe "active") le bouton de la boucle actuellement audible — qu'il s'agisse d'une boucle "paire" active ou d'un détour en cours — inutile d'afficher un bouton vers ce qui joue déjà. Uniquement pendant une lecture réelle (`playing`) : à l'état "Prêt" avant le premier clic sur Écouter, tous les boutons restent visibles malgré la référence déjà marquée active par défaut.

**3) Refonte des contrôles de fichier (icône seule → icône + libellé + nom du fichier), et repositionnement en tête de bloc.** Trois changements sur la fonction partagée `fileCtrlHtml()`/`updateFileStatus()`/`wireFileControl()`, qui se répercutent automatiquement partout où un fichier peut être uploadé (plus d'une vingtaine d'emplacements : intro/outro séquentiel et vertical-random, alternatives de pool/emplacement, boucles et transitions d'embranchement-vertical, couches, Sfx, logo/photo, illustrations, filigrane, polices personnalisées, vignettes vidéo) :
   - Bouton icône seule (`btn-icon`) remplacé par icône + libellé texte visible (`btn btn-small`) — une icône seule n'était pas assez explicite.
   - Nom du fichier affiché à côté de l'icône même une fois PUBLIÉ (pas seulement pour une sélection en attente) — nouvelle fonction `basenameOf()` (extrait le nom depuis le chemin distant) + nouvelle clé i18n `publishedFilePrefix` ("Publié : {name} ✓"), remplace l'ancien texte générique "Publié ✓" sans nom.
   - Contrôle de fichier déplacé en tête de chaque bloc concerné, avant les réglages qui décrivent CE fichier (libellé, durée, tempo...) — plus logique de choisir le fichier avant de régler ses paramètres. Laissé inchangé dans les blocs où il n'y avait rien à réordonner (logo/photo, apparence Pack/Collection, champs d'apparence par bloc AdReel), déjà positionnés juste après leur propre libellé sans autre champ intercalé.

**i18n** : `publishedFilePrefix` (nouvelle, FR/EN, remplace l'usage de l'ancienne `publishedStatus` désormais orpheline mais conservée par prudence) — symétrie vérifiée (685 clés de chaque côté, couverture complète confirmée programmatiquement).

**Vérifications** : `node --check` OK sur `player.js` et le script inline extrait du backstage. Balises `<div>` équilibrées (473/473). Nouvelles assertions dans `test_embr_vertical_engine.js` (visibilité des boutons avant/pendant/après lecture, pendant un détour, après Stop) — toutes au vert. Suite de tests complète (11 fichiers) rejouée deux fois sans régression ; `test_quantized_loop_engine.js` échoue toujours à l'identique (bug d'environnement pré-existant, confirmé sans lien avec cette session).

---

## [2026-08-29b] — Nouvelle unité "temps" pour la durée des transitions (séquentiel ET embranchement-vertical)

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `test_seq_transitions.js`, `test_embr_vertical_transitions.js`

**Contexte** : demande de Jules-Antoine, capture d'écran du réglage "Durée exprimée en" existant côté séquentiel — ajouter une unité "temps" (en plus de "mesures"/"secondes"), et appliquer le même réglage aux transitions d'embranchement-vertical, en maximisant la réutilisation entre les deux modes.

**Changement** : troisième valeur `durationUnit: 'beats'` ajoutée aux deux moteurs de transition (`transitionDurationSecFor()` côté séquentiel, `embrTransitionDurationSecFor()` côté embranchement-vertical, ajoutée le 29/08 plus tôt cette session) — même formule que "mesures" mais sans la multiplication par `beatsPerBar` (on compte directement des temps individuels, pratique pour un réglage plus fin qu'une mesure entière). Nouveau champ `transition.durationBeats` (parallèle à `durationSeconds`/`bars`), même tempo propre à la transition (bpm/beatsPerBar avec repli sur l'emplacement/la boucle source puis le morceau, via `transitionTiming()` déjà existante — aucune nouvelle logique de tempo, réutilisation totale).

**Backstage** : troisième option dans les deux menus déroulants "Durée exprimée en" (séquentiel ET embranchement-vertical), champ "Durée (temps)" affiché à la place de "Mesures" quand cette unité est choisie (BPM/temps par mesure restent partagés avec "Mesures", inchangés). Les deux dropdowns et tous les champs réutilisent les mêmes clés i18n (`transitionDurationUnitBeats`, `transitionDurationBeatsLabel`) — aucune duplication entre les deux modes.

**i18n** : `transitionDurationUnitBeats`, `transitionDurationBeatsLabel` (nouvelles, FR/EN) — symétrie vérifiée (685 clés de chaque côté).

**Vérifications** : `node --check` OK. Balises `<div>` équilibrées (473/473). Couverture i18n complète (aucune clé manquante). Nouveau scénario dans `test_seq_transitions.js` (transition de 3 temps à 240 BPM/4 temps par mesure = 0.75s, distincte des ~0.2s d'1 mesure au tempo du morceau) et dans `test_embr_vertical_transitions.js` (même principe sur une bascule "paire") — tous deux au vert. Suite de tests complète rejouée (11 fichiers dépendant de `player.js`/`layerpitch-backstage.html`) sans régression.

---

## [2026-08-29] — Embranchement-vertical : chevauchement transition/boucle cible corrigé, verrouillage pendant l'intro, message de propagation GitHub Pages

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, nouveau `test_embr_vertical_transitions.js`

**Contexte** : trois retours de Jules-Antoine sur la preview du mode embranchement-vertical (capture d'écran d'une boucle "On est repéré !" avec transition personnalisée) — traités ensemble.

**1) Bug — le fichier de transition sonnait EN MÊME TEMPS que la boucle cible.** Diagnostic : `refreshEmbrGains()` démarrait la montée de gain de la boucle cible ET jouait le fichier de transition au même instant `now`, plutôt que la seconde après la première. Corrigé en reprenant le mécanisme déjà en place côté branching séquentiel (`performSeqBranchCut()`/`transitionDurationSecFor()`), confirmé par Jules-Antoine comme référence à suivre :
- Nouvelle fonction `embrTransitionDurationSecFor()` (mesures/secondes/tempo propre à la transition, même conventions que le séquentiel). Sans réglage, repli sur la **durée réelle du fichier décodé** plutôt que `blockSeconds()` — une transition d'embranchement-vertical n'a par défaut aucune valeur "mesures" pré-remplie à la création (contrairement au séquentiel, toujours créé avec `bars: 4`), un repli par mesures y aurait donné un silence arbitraire (potentiellement plusieurs secondes) sur la cible.
- `refreshEmbrGains(targetIdx, upDelaySec)` restructurée : la montée de la boucle cible est désormais différée de `upDelaySec` (durée de la transition), pendant que le fondu de sortie de la voix quittée démarre toujours immédiatement — même répartition que le fondu de coupure + transition du séquentiel.
- Même correction appliquée aux deux cas : boucle "paire" (rampe de gain sur une boucle déjà en arrière-plan) et "détour" (nouvelle source déclenchée) — dans ce second cas, le démarrage du buffer lui-même (`src.start()`) est différé, pas seulement son fondu d'entrée.
- Champs de durée de transition ajoutés dans le backstage (unité mesures/secondes, mesures, BPM, mesure — réutilisation intégrale des clés i18n déjà existantes côté séquentiel) + nouvelle clé `transitionDurationUnitAuto` (FR/EN) pour le repli par défaut sur la durée du fichier.

**2) Verrouillage des boutons pendant le segment Départ→Entrée.** Au tout premier lancement, si la boucle de référence a un point d'Entrée réglé après son point de Départ (segment non-bouclé, joué une seule fois), les boutons de boucle sont désactivés le temps de ce segment puis réactivés automatiquement — sans réglage de Départ/Entrée, comportement inchangé (aucun verrouillage).

**3) Message dédié pendant la propagation GitHub Pages.** `loadArrayBuffer()` détecte désormais les réponses HTTP non-ok ; si TOUTES les requêtes réseau tentées pour une piste échouent (signe fort d'une publication toute récente pas encore propagée, plutôt qu'un vrai fichier manquant), le message affiché devient "Le site vient d'être mis à jour, les fichiers sont encore en cours de propagation. Réessayez dans quelques minutes." (nouvelle clé `loadErrorPropagating`) à la place du générique "Erreur de chargement". S'applique aux quatre points de chargement du fichier (séquentiel, vertical-random, embranchement-vertical, vertical/statique).

**i18n** : `loadErrorPropagating`, `transitionDurationUnitAuto` (nouvelles, FR/EN) — symétrie vérifiée programmatiquement (683 clés de chaque côté après ajout). `embrTransitionHint` reformulé pour refléter le nouveau comportement séquentiel (n'est plus un simple "overlay").

**Vérifications** : `node --check` sur `player.js` et sur le script inline extrait du backstage — OK. Balises `<div>` équilibrées (471/471). Toutes les clés `tr()`/`data-i18n` référencées dans le backstage couvertes en FR et EN (un seul faux positif pré-existant sans rapport, `socialPlatform_` — concaténation dynamique). Nouveau fichier `test_embr_vertical_transitions.js` (8 vérifications : timing différé sur bascule paire, sur détour, repli sur durée de fichier, verrouillage pendant l'intro) — toutes au vert. Suite de tests existante entièrement rejouée sans régression (`test_embr_vertical_engine.js` et les neuf autres fichiers de test dépendant de `player.js`/`layerpitch-backstage.html`) ; `test_quantized_loop_engine.js` échoue mais de façon strictement identique avec les fichiers originaux non modifiés (bug d'environnement de test pré-existant, sans lien avec cette session).

**Non vérifié** : `backstage.css` (fichier local, jamais commité sur GitHub) — sa synchronisation avec le `<style>` inline du backstage n'a pas pu être vérifiée depuis cette session ; aucune classe CSS nouvelle n'a cependant été introduite ici (réutilisation intégrale des classes `.row`, `.hint-inline` déjà existantes), donc aucune synchronisation attendue.

---

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : retour visuel (capture d'écran) sur trois points distincts, traités ensemble.

**1) Bug — clé i18n en collision.** Le bouton "Prévisualiser" (placeholder désactivé, entrée précédente) affichait "▶ Écouter" au lieu de "Prévisualiser". Diagnostic : la clé `previewBtn` utilisée pour ce nouveau bouton existait déjà dans `layerpitch-i18n.js`, réservée au bouton d'aperçu audio d'un morceau ("▶ Écouter", `data-action="preview-track"`). Les objets JavaScript acceptant des clés dupliquées avec la dernière déclaration qui l'emporte, et l'entrée préexistante (`▶ Écouter`) apparaissant plus loin dans le fichier que la mienne, c'est elle qui gagnait pour les deux boutons. Corrigé en renommant ma clé en `previewComingSoonBtn`, unique.

**2) Bouton "Prévisualiser" désactivé étendu aux Packs et Collections**, à côté de "Copier le lien"/"Partager" dans leur onglet Distribution, même infobulle explicative que celui de la barre d'actions globales.

**3) Tous les blocs de contenu d'un AdReel sont désormais supprimables**, y compris les 4 qui ne l'étaient pas jusque-là (Header, Bio, Témoignages, Musique — `SINGLETON_TYPES`) :
- `canDelete` n'exclut plus ces 4 types — bouton × disponible partout.
- Retrait de la réinjection forcée dans `migrateBlocks()` (`SINGLETON_TYPES.forEach(t => { if (!loaded.some(...)) loaded.push(...) })`) : sans ce retrait, un bloc supprimé aurait silencieusement réapparu, vide, au rechargement suivant.
- **Second problème trouvé en creusant le premier** : le test de détection "ancien format legacy" de `migrateBlocks()` (`loaded.length === 0`) aurait, lui aussi, traité un tableau de blocs intentionnellement vidé (tous supprimés) comme un cas corrompu à reconstruire depuis la liste par défaut — corrigé en distinguant explicitement "tableau vide légitime" de "champ absent/ancien format" (`loaded.length > 0 && typeof loaded[0] !== 'object'` plutôt que `loaded.length === 0 || ...`).
- Ajout de 4 nouveaux boutons "+ Bloc header/bio/témoignages/musique" dans la rangée d'ajout de blocs, visibles uniquement quand le type correspondant est absent de l'AdReel en cours (`updateSingletonAddButtons()`, appelée à chaque `layoutBlocks()`) — pas de risque de doublon, et un moyen de revenir en arrière après suppression.

**i18n** : `previewComingSoonBtn` (renommage, plus de collision), `addHeaderBlock`/`addBioBlock`/`addTestimonialsBlock`/`addTracksBlock` (nouvelles clés) — FR et EN.

**Vérifications** : `node --check` sur les deux fichiers — OK. Balises `<div>` équilibrées (452/452). 0 clé `tr()`/`data-i18n`/`data-i18n-title` manquante. Symétrie i18n vérifiée programmatiquement (663 clés FR = 663 clés EN). Nouveau `test_deletable_blocks.js` (32 assertions) : présence du bouton × sur les 4 singletons, masquage/réapparition conditionnelle des boutons "+ Bloc X", suppression de la totalité des blocs sans résurrection, non-régression du chemin `migrateBlocks()` legacy (ancien format tableau de chaînes) et du cas partiel (un seul type manquant), non-régression du bouton "Écouter" du lecteur d'aperçu track, présence du bouton "Prévisualiser" désactivé dans Pack et Collection. Les 9 suites précédentes de la session rejouées — 221 assertions au total, aucune régression.

---

## [2026-08-20] — Bouton "Prévisualiser" (désactivé, à venir) + réordonnancement des actions globales

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : retour visuel (capture d'écran) — "Visualiser le résultat" (qui ouvre la page publique déjà publiée) apparaissait avant "Sauvegarder / publier" dans la barre d'actions globales, alors qu'il n'a de sens qu'après. Discussion de suivi : est-il possible d'avoir une prévisualisation des modifications *non publiées* ? Diagnostic — le blocage n'est pas un choix mais une contrainte structurelle de l'architecture GitHub Pages actuelle : un fichier n'existe sur le réseau qu'à partir du clic "Sauvegarder / publier" ; avant ça, ce n'est qu'un objet en mémoire dans l'onglet backstage, non transférable directement vers un autre onglet. Cette contrainte disparaîtrait avec la migration backend prévue (Supabase + Cloudflare R2), où un fichier uploadé obtiendrait une URL réelle dès l'ajout, indépendamment de la publication. Décision : ne pas construire de contournement technique en attendant — un bouton désactivé avec explication suffit pour l'instant. Voir aussi l'entrée ajoutée dans `docs/extensions-roadmap.md` le même jour.

**Changement** :
- Réordonnancement de la barre d'actions globales : **Prévisualiser** (nouveau, désactivé) → **Sauvegarder / publier** → **Visualiser le résultat** — ordre chronologique logique.
- Nouveau bouton `#btnPreview`, désactivé, infobulle native (`title`, via `data-i18n-title` comme le bouton "Supprimer" désactivé de l'AdReel — plus fiable qu'une bulle d'aide personnalisée sur un élément `disabled`, certains navigateurs ne déclenchant pas les événements de survol dessus) expliquant que la fonctionnalité arrive avec le backend.
- Cadres séparés pour "Contenu"/"Apparence" (sidebar, retour visuel séparé le même jour) : les deux bascules vivaient dans un fond commun en pilule sans bordure individuelle — remplacé par le même principe que les items de la section "Compte" (bordure par item, accentuée en noir si actif).

**i18n** : 2 nouvelles clés en FR et en EN (`previewBtn`, `previewComingSoonHint`).

**Vérifications** : `node --check` sur les deux fichiers — OK. Balises `<div>` équilibrées. 0 clé `tr()`/`data-i18n`/`data-i18n-title` manquante. Aucune régression fonctionnelle (changement de position DOM + CSS uniquement, aucun gestionnaire d'événement touché) — suite de tests de la session rejouée par précaution, tout vert.

---

## [2026-08-20] — Relecture de nettoyage : dates de commentaires corrigées, petite factorisation

**Fichier touché** : `layerpitch-backstage.html`

**Contexte** : demande explicite de relecture ("optimise, corrige, nettoie") sur l'ensemble du code produit dans la session.

**Ce qui a été trouvé et corrigé** :
- **Erreur de date généralisée** : 21 commentaires ajoutés au fil de la session portaient la date "19/08" alors qu'ils documentaient du travail du jour même (20/08) — probablement hérité par habitude des dates déjà présentes dans le changelog au démarrage de la session. Seuls 2 commentaires préexistants (déjà présents avant le début de cette session, vérifiés par comparaison avec le fichier tel qu'uploadé en tout début de session) étaient légitimement datés du 19/08 et ont été laissés intacts. Correction faite par script plutôt qu'à la main, pour éviter d'en oublier un.
- **Variable alias inutile** dans `renderLibrary()` (`const container = detailHost`, reliquat du refactor minimalement invasif de l'entrée précédente) — supprimée, `detailHost.appendChild(el)` utilisé directement.
- **Duplication** : les 4 boutons d'ajout (+ Emplacement, + Section, + Boucle, + Couche — voir entrée suivante) étaient 4 blocs de 6 lignes quasi identiques — factorisés en une fonction unique `appendMasterAddButton(masterHost, action, ti, labelKey)`.

**Vérifié et confirmé sain** (donc non modifié) : aucun doublon de déclaration `let`/`const`/`function`, aucune référence morte résiduelle, le mécanisme générique `renderOrgMasterList`/`wireOrgDragDrop` est solide sur les cas limites déjà couverts par les tests, aucune clé i18n orpheline (les clés qui semblaient inutilisées à un premier grep textuel sont en réalité consommées via `data-i18n` ou des clés dynamiques passées en config).

**Vérifications** : `node --check` — OK. Balises `<div>` équilibrées (452/452). Les 9 suites de tests de la session rejouées après chaque modification — 189 assertions, aucune régression.

---

## [2026-08-20] — Boutons "+ Emplacement/Section/Boucle/Couche" repositionnés à la suite de la Structure

**Fichier touché** : `layerpitch-backstage.html`

**Contexte** : retour visuel (capture d'écran) — dans l'éditeur d'un morceau séquentiel, "+ Emplacement" apparaissait tout en bas de la colonne maître, après les entrées virtuelles partagées "Contenu additionnel" et "Infos additionnelles", au lieu de juste après la Structure (Intro/emplacements/Outro) à laquelle il se rapporte. Le même défaut de position touchait "+ Section" (vertical-random), "+ Boucle" (embranchement-vertical) et "+ Couche" (vertical) — les 4 étaient placés sous toute la colonne (`.actions` après le `.seq-two-col` complet) plutôt qu'insérés dans la liste maître elle-même.

**Changement** : les 4 boutons sont désormais des éléments DOM insérés directement dans leur liste maître respective, juste après le dernier élément de structure (Outro, dernière boucle, dernière couche) et avant les entrées virtuelles "Sfx"/"Infos additionnelles". Les 4 anciens blocs `.actions` correspondants, désormais vides, ont été retirés. Aucun changement des gestionnaires de clic (`add-segment-slot`, `add-section`, `add-embr-loop`, `add-layer`) : délégation déjà posée sur `#libraryContainer`, insensible à la position DOM du bouton déclencheur.

**Vérifications** : `node --check` — OK. Balises `<div>` équilibrées (-4, cohérent avec les 4 wrappers `.actions` retirés). Nouveau `test_add_button_position.js` (14 assertions) : position exacte du bouton avant les entrées partagées pour les 4 modes concernés, absence de doublon, non-régression sur le mode statique (toujours aucun bouton). Les 8 suites précédentes de la session rejouées — aucune régression.

---

## [2026-08-20] — Mécanisme de dossiers généralisé (AdReels → Sfx + Bibliothèque de morceaux)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : demande de suite directe à l'entrée précédente (dossiers d'AdReel) — étendre le même principe d'organisation à la bibliothèque Sfx, puis (élargi en cours de discussion) à la bibliothèque de morceaux également. Décision explicite : plutôt que dupliquer le mécanisme AdReel trois fois, le généraliser en un système partagé — impliquant de renommer les classes CSS et fonctions spécifiques aux AdReels en équivalents génériques.

**Changement** :
- **Généralisation** : `wireAdReelFolderDragDrop` → `wireOrgDragDrop(containerEl, getItems, getFolders, onDrop)`, paramétré par les tableaux réels à manipuler plutôt que codé en dur sur `adReels`/`adReelFolders`. Nouvelle fonction `renderOrgMasterList(masterHost, items, folders, collapsedFolderIds, opts)` factorisant la construction DOM (dossiers repliables + zone racine + lignes glissables) commune aux trois panneaux. Nouvelle fonction `deleteOrgFolder(folders, items, folderId)` (suppression non destructrice, factorisée). Classes CSS renommées `.adreel-*` → `.org-*`. Clés i18n généralisées (`adReelFolderFallback` → `orgFolderFallback`, `defaultAdReelFolderLabel` → `defaultOrgFolderLabel`, `adReelFolderEmptyHint`/`deleteAdReelFolderConfirm` → `orgFolderEmptyHint`/`deleteOrgFolderConfirm`, `addAdReelFolder` → `addOrgFolder`).
- **Bibliothèque Sfx** : panneau restructuré à l'identique de "Gérer les AdReels" — liste compacte à gauche (dossiers + racine, glisser-déposer), détail à droite. **Nouveauté propre à cette entrée** : à l'intérieur du Sfx sélectionné, une disposition maître-détail à 3 entrées — Identité (par défaut) / Comportement / Variations — remplaçant l'ancien empilement à plat (`sectionEyebrow`). Le double niveau de repli des variations (bouton "N variations" à l'intérieur de l'entrée Variations) est conservé tel quel (décision explicite). Titre synchronisé à 3 endroits (en-tête du détail, entrée Identité, ligne de la liste maître), sans re-rendu complet.
- **Bibliothèque de morceaux** : même traitement extérieur (dossiers, glisser-déposer, liste compacte). L'éditeur interne d'un morceau (déjà maître-détail depuis une session antérieure — modes vertical/séquentiel/vertical-random/statique/embranchement-vertical) n'a pas été restructuré, seulement déplacé dans le panneau de détail. Nettoyage associé : les boutons "replier"/"monter"/"descendre" de l'en-tête d'un morceau, devenus redondants avec la sélection et le glisser-déposer, ont été retirés (déclaration `collapsedTrackIds`, branches mortes du gestionnaire de clic, footer de repli — tout supprimé). **Bug trouvé et corrigé en cours de route** : deux appels résiduels à `collapsedTrackIds` (variable supprimée) seraient restés dans le chemin de chargement des données et auraient fait planter `loadData()` — repérés par relecture systématique des références avant livraison.
- Modèle de données étendu pour Sfx et morceaux : `sfxFolders`/`libraryFolders` (nouveaux tableaux), `folderId` par entrée — sérialisation mise à jour aux 3 points habituels (chargement, création par défaut, publication) pour les deux.

**i18n** : `sfxVariationsShortLabel` (libellé court "Variations" pour l'entrée de la disposition interne, l'existant `sfxAlternativesLabel` étant trop long), `sfxLibraryEmptyHint`, `libraryEmptyHint` — nouvelles clés en FR et en EN. Les 5 clés généralisées listées plus haut renommées (pas dupliquées).

**Vérifications** : `node --check` sur les deux fichiers — OK. Balises `<div>` équilibrées. 0 clé `tr()` manquante, symétrie i18n vérifiée programmatiquement (657 clés FR = 657 clés EN). `test_adreel_folders.js` adapté aux nouvelles classes génériques et rejoué (28 assertions, aucune régression du fait de la généralisation). Nouveaux `test_sfx_folders.js` (22 assertions : disposition interne à 3 entrées, synchronisation du titre à 3 endroits, glisser-déposer, suppression avec retombée de sélection) et `test_library_folders.js` (20 assertions : éditeur interne préservé, boutons repli/monter/descendre bien absents, glisser-déposer, round-trip persistance).

---

## [2026-08-20] — Dossiers d'AdReel : réorganisation de "Gérer les AdReels" en liste maître-détail à dossiers

**Fichier touché** : `layerpitch-backstage.html`

**Contexte** : demande d'extension de la disposition maître-détail (Packs/Collections) aux AdReels — précisée en cours de discussion comme portant sur la section "Gérer les AdReels" (vue d'ensemble de tous les AdReels), pas sur l'éditeur d'un AdReel donné. Discussion de suivi : possibilité de regrouper les AdReels en dossiers, comme un explorateur de fichiers. Décisions validées avant codage : assignation à un dossier par glisser-déposer (plutôt qu'un menu déroulant, malgré la complexité supplémentaire assumée) ; suppression d'un dossier non destructrice (les AdReels remontent à la racine, jamais supprimés — un AdReel représente trop de travail pour risquer une perte accidentelle) ; le petit sélecteur rapide en haut de la barre latérale reste une liste à plat, non concerné par les dossiers.

**Changement** :
- Panneau "Gérer les AdReels" restructuré : liste compacte à gauche (dossiers repliables + zone racine, titres de dossier éditables inline, glisser-déposer), détail (titre, badge "en cours d'édition", lien public, actions Éditer/Dupliquer/Copier/Partager/Supprimer) de l'AdReel sélectionné à droite. Sélection par défaut : l'AdReel actuellement en cours d'édition.
- Glisser-déposer complet : déposer un AdReel sur un autre le repositionne avant/après lui (au sein du même groupe ou en changeant de groupe en un seul geste) ; les dossiers eux-mêmes sont réordonnables entre eux via une poignée dédiée sur leur en-tête. Aucune notion d'ordre au sein d'un groupe autre que via glisser-déposer explicite sur un élément précis.
- Nouveau modèle de données : `adReelFolders` (tableau, `{ id, label }`), `folderId` par AdReel (`null` = racine) — sérialisation aux 3 points habituels.

**i18n** : 5 nouvelles clés en FR et en EN (`addAdReelFolder`, `adReelFolderFallback`, `defaultAdReelFolderLabel`, `adReelFolderEmptyHint`, `deleteAdReelFolderConfirm` — toutes renommées en équivalents génériques dans l'entrée suivante, qui étend ce mécanisme à Sfx et à la bibliothèque de morceaux).

**Vérifications** : `node --check` — OK. Balises `<div>` équilibrées (441/441). 0 clé `tr()` manquante. Nouveau `test_adreel_folders.js` (28 assertions : état initial, création/repli/dépli/suppression de dossier avec et sans confirmation, glisser-déposer réel — racine↔dossier, réordonnancement au sein d'un groupe, réordonnancement de dossiers, cas combiné groupe+position en un seul dépôt). Les 5 suites précédentes de la session rejouées — aucune régression.

---

## [2026-08-20] — Bug : réseaux sociaux non persistés à la publication quand le lien de référence est vide

**Fichier touché** : `layerpitch-backstage.html`

**Contexte** : retour utilisateur — le backstage "oublie" le réseau social configuré (LinkedIn) à chaque réouverture, obligeant à le reconfigurer systématiquement.

**Diagnostic** : dans `publishAll()`, la ligne `socials: socials.filter(s => s.url).map(...)` excluait de `data.json` toute entrée dont le champ "Lien vers ton profil" — explicitement documenté comme optionnel dans l'UI ("pour ta propre référence") — était vide. Or `buildSocialShareUrl()` n'utilise jamais ce champ pour construire l'URL de partage d'aucune plateforme (LinkedIn, X, etc. ne s'appuient que sur `platform` + l'URL de la page et le texte). Un réseau choisi sans lien de référence renseigné était donc silencieusement absent de la publication, et donc introuvable au rechargement suivant. Le chemin de chargement (`data.socials || []`) n'avait pas ce problème — seule la sérialisation à la publication filtrait à tort.

**Changement** : `socials.map(s => ({ id: s.id, platform: s.platform, url: s.url || '' }))` — persiste dès qu'une plateforme est choisie, lien de référence renseigné ou non.

**Vérifications** : `node --check` — OK. Nouveau `test_socials_persistence_fix.js` (6 assertions) : reproduit le cas exact (LinkedIn sans lien de référence + X avec lien renseigné), vérifie le round-trip sérialisation → rechargement, et que les réseaux persistés sont bien reconnus comme publiables. Les 4 suites précédentes de la session rejouées (`test_backstage_pack_collection_masterdetail`, `test_pack_collection_theme_font`, `test_share_socials_dialog`, `test_share_popup_dimensions`) — aucune régression.

---

## [2026-08-20] — Fenêtres de partage/publication en popup centrée plutôt qu'en plein onglet

**Fichier touché** : `layerpitch-backstage.html`

**Contexte** : retour utilisateur — même une fois le bouton "Partager" branché sur les réseaux configurés (entrée précédente), cliquer dessus ouvrait la fenêtre LinkedIn en plein onglet, faisant quitter le backstage. Référence donnée : le comportement de WordPress (popup dédiée, le site d'origine reste au premier plan).

**Changement** : nouvelle fonction `openSharePopup(url)` — popup centrée 600×600, `noopener,noreferrer`, nom de fenêtre réutilisable (`layerpitch-share`, un second clic pendant qu'une popup est déjà ouverte la réutilise plutôt que d'en empiler une nouvelle). Appliquée aux 4 points d'ouverture d'une fenêtre de publication : partage AdReel via un seul réseau, confirmation du dialogue à cocher (entrée précédente), bouton "Publier" d'un Pack, bouton "Publier" d'une Collection — décision de cohérence, les 4 partageaient déjà le même `window.open(url, '_blank', 'noopener')`. L'aperçu de l'AdReel (bouton séparé, sans rapport avec le partage social) n'est pas concerné et continue de s'ouvrir en plein onglet.

**Vérifications** : `node --check` — OK. Balises `<div>` équilibrées (435/435). Nouveau `test_share_popup_dimensions.js` (34 assertions) : dimensions/position calculée, `noopener`/`noreferrer`, réutilisation du nom de fenêtre, sur les 4 points d'ouverture. Les 3 suites précédentes de la session rejouées — aucune régression.

---

## [2026-08-20] — Bouton "Partager" branché sur les réseaux sociaux configurés (dialogue à cocher si plusieurs)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : retour utilisateur (capture d'écran) — sur Mac, le bouton "Partager" de l'AdReel en édition n'ouvrait rien vers LinkedIn alors que ce réseau était configuré dans l'onglet "Réseaux sociaux". Diagnostic : ce bouton appelait `shareOrCopy()` (Web Share API native, puis repli presse-papier silencieux) — un mécanisme générique du système, totalement indépendant de la liste de réseaux configurée, qui n'alimente que les boutons "Publier" des Packs/Collections. Sur Chrome/Firefox desktop Mac (`navigator.share` généralement absent), le clic ne faisait qu'une copie presse-papier invisible.

**Changement** : nouvelle fonction `shareViaSocialsOrFallback(url, title)` — tente `navigator.share()` en premier (inchangé, fonctionne bien sur mobile et Safari desktop), puis en cas d'indisponibilité ou d'échec :
- 0 réseau publiable configuré → repli sur `shareOrCopy()` (comportement d'origine, inchangé)
- 1 réseau publiable → ouverture directe de sa fenêtre de publication pré-remplie
- 2+ réseaux publiables → nouvelle modale à cocher (`#shareSocialsModalOverlay`, style réutilisé des modales existantes) : le compositeur choisit lesquels ouvrir cette fois-ci

Appliqué aux 3 boutons "Partager" du backstage (AdReel — barre latérale et action déléguée —, Pack, Collection) : décision de cohérence, les 3 partageaient déjà `shareOrCopy()`.

**i18n** : 3 nouvelles clés en FR et en EN (`shareSocialsModalTitle`, `shareSocialsModalHint`, `shareSocialsConfirmBtn`) ; réutilisation de la clé `cancel` existante pour le bouton d'annulation. Symétrie FR/EN vérifiée programmatiquement : 649 clés de chaque côté, 0 écart.

**Vérifications** : `node --check` sur les deux fichiers — OK. Nouveau `test_share_socials_dialog.js` (17 assertions, `navigator.share` simulé absent pour reproduire le cas Chrome/Firefox desktop) : les 4 scénarios (0/1/2+ réseaux, annulation) — tout vert. `test_backstage_pack_collection_masterdetail.js` et `test_pack_collection_theme_font.js` rejoués — aucune régression.

---

## [2026-08-20] — Packs/Collections : fusion Identité+Présentation, Apparence enrichie (couleurs, police, images), application publique

**Fichiers touchés** : `layerpitch-backstage.html`, `pack.html`, `collection.html`

**Contexte** : retour visuel (capture d'écran) sur la disposition maître-détail des Packs livrée dans l'entrée précédente — demande de fusionner Identité et Présentation sous un seul libellé, de faire remonter Contenu en 2ᵉ position, et de déplacer les images (illustration, filigrane) vers Apparence. Discussion de suivi : étendre Apparence des Collections (qui n'existait pas encore) avec les mêmes réglages que le Pack, couleurs et police comprises — ce qui impliquait d'ajouter un système de thème (couleurs + police) à Collections, qui n'en avait aucun, et de l'appliquer réellement sur `collection.html` (jusque-là purement visuel côté backstage sans effet public).

**Changement** :
- **Pack** — 4 entrées au lieu de 5 : **Présentation** (fusion Identité+Présentation : titre + textes FR/EN), **Contenu** (remonté en 2ᵉ position), **Apparence** (couleurs, police — nouveau champ `pack.font` —, illustration et filigrane désormais ici), **Distribution** (inchangée). Titre toujours éditable aux deux endroits (en-tête de carte + entrée Présentation), synchronisation en direct sans re-rendu.
- **Collection** — 4 entrées, même principe : **Présentation** (fusion), **Contenu**, **Apparence** (**nouvelle entrée** — couleurs `bgColor`/`textColor`, police `font`, illustration ; aucun de ces réglages n'existait avant pour les Collections), **Distribution**.
- **`pack.html`** : application de `pack.font` au chargement (nouveau — les couleurs `bgColor`/`textColor` étaient déjà appliquées, inchangé). Fonctions `fontCssFamily()`/`injectFontAssets()` copiées telles quelles depuis `index.html` (même encodage `default`/`google:Nom`/`custom:id`, même logique d'injection ciblée des assets).
- **`collection.html`** : application de `bgColor`/`textColor`/`font` au chargement — tout nouveau, Collections n'avait jusqu'ici aucune personnalisation de thème publique. Mêmes fonctions de police copiées, variable CSS `--font-body` ajoutée au `:root` (auparavant `font-family` en dur).
- Sérialisation mise à jour aux 3 points habituels pour les deux nouveaux champs/modèles : chargement (`loadData`), création par défaut (`btnAddPack`/`btnAddCollection`), publication (`publishAll`).

**i18n** : aucune nouvelle clé pour les libellés d'entrées (réutilisation de `trackSectionIdentity`, `sectionPresentation`, `sectionDistribution`, `sectionAppearance`, `trackSectionContent`, déjà en place). Réutilisation de `themeFontLabel` (déjà existante pour le thème général des AdReels) plutôt que d'inventer une clé dédiée pour le libellé "Police" du Pack/de la Collection.

**Vérifications** : `node --check` sur les 3 fichiers — OK. Balises `<div>` équilibrées sur le backstage. 0 clé `tr()` manquante sur les 3 fichiers. `test_backstage_pack_collection_masterdetail.js` étendu (39 assertions : nouvel ordre à 4 entrées, déplacement image/filigrane, synchronisation titre, fiche d'implémentation toujours en Distribution). Nouveau `test_pack_collection_theme_font.js` (9 assertions) : application réelle de `--bg`/`--text`/`--font-body` et injection du lien Google Fonts sur `pack.html` et `collection.html`, non-régression sur les couleurs de Pack.

**Non fait, à noter honnêtement** :
- Les clés `data-help` ajoutées (`packFont`, `collectionFont`, `collectionAppearance`) n'ont pas de bulle d'aide correspondante dans `layerpitch-help.js` — sans effet néfaste, juste pas de tooltip affichée.

---

## [2026-08-20] — Disposition maître-détail étendue aux Packs et Collections

**Fichier touché** : `layerpitch-backstage.html`

**Contexte** : session dédiée, prompt de reprise préparé en fin de session précédente. Objectif : étendre le principe de la disposition maître-détail (déjà en place pour les 4 modes de lecture d'un morceau) aux Packs et probablement aux Collections — mais pas le mécanisme littéral, un Pack/une Collection étant un formulaire à plat en zones thématiques plutôt qu'une liste de sous-éléments nommés à réordonner.

**Changement** :
- **Pack** — 5 entrées : Identité (titre, illustration, filigrane), Présentation (textes FR/EN), Distribution (téléchargement, vente, mode test, renvoi AdReel, lien direct, réseaux sociaux, **fiche d'implémentation déplacée ici depuis Contenu**), Apparence (couleurs), Contenu (sélecteurs morceaux/Sfx). Titre éditable à la fois dans l'en-tête de carte et dans l'entrée Identité (même donnée `pack.title`, synchronisée en direct sans re-rendu complet pour ne pas perdre le focus). Sélection par défaut à l'ouverture : Contenu.
- **Collection** — 4 entrées par symétrie (pas d'Apparence, Collections n'avait aucun réglage de couleur à l'époque) : Identité, Présentation, Contenu, Distribution. Mêmes principes (titre synchronisé, sélection par défaut Contenu).
- Nouvelles Maps d'état `packSelectedEntry`/`collectionSelectedEntry` (même principe que `seqSelectedSlotIndex` : affichage local à la session, jamais persisté).

**i18n** : aucune nouvelle clé — les 5 labels d'entrées réutilisent des clés déjà existantes en FR/EN.

**Vérifications** : `node --check` — OK. Balises `<div>` équilibrées (428/428). 0 clé `tr()` manquante. Nouveau `test_backstage_pack_collection_masterdetail.js` (28 assertions initiales) : ordre des entrées, sélection par défaut, position de la fiche d'implémentation, synchronisation des deux champs titre, non-régression du repli/dépli de carte.

**Non fait, à noter honnêtement** (au moment de cette entrée — traité dans les entrées suivantes de la même journée) :
- Widgets internes (sélecteurs morceaux/Sfx, contrôles de fichier) codés tels quels, pas d'ajustement préventif pour le panneau plus étroit — décision explicite, à corriger seulement si besoin après test visuel.
- Retour visuel reçu immédiatement après livraison → fusion Identité/Présentation, réorganisation Apparence, et extension aux Collections traitées dans l'entrée suivante.

---

## [2026-08-19] — Items de la section "Compte" (sidebar) encadrés individuellement

**Fichier touché** : `layerpitch-backstage.html`

**Contexte** : retour visuel (capture d'écran) — clarification de ce que signifiait "section compte" (la navigation de la sidebar : Bibliothèque musicale, Bibliothèque Sfx, Packs, Collections, Réseaux sociaux, Gérer les AdReels, Projet(s)).

**Changement** : ces 7 items sont désormais enveloppés dans un conteneur `.nav-account-group`, avec un encadré (bordure fine) individuel par item -- l'item actif garde son fond plein existant, avec la bordure qui prend juste la même couleur pour rester cohérente. Bouton "Faire un retour sur la version" non touché (avait déjà son propre encadré en pointillés). CSS scopé à ce seul groupe : ni le toggle Contenu/Apparence, ni les boutons de la carte "AdReel en édition" (qui partagent la classe `.nav-item` de base) ne sont affectés.

**Vérifications** : `node --check` -- OK. Balises `<div>` équilibrées (413/413, +1 partout pour le nouveau conteneur). Contenu du groupe vérifié programmatiquement contre le DOM généré (les 7 bons items, ni plus ni moins). `test_backstage_content_nav_redesign.js` (qui teste justement cette zone de la sidebar) rejoué -- vert.

---

## [2026-08-19] — Retrait visuel des items "enfants" de la catégorie Structure

**Fichier touché** : `layerpitch-backstage.html`

**Contexte** : retour visuel (capture d'écran) — la catégorie "Structure" (libellé non cliquable) et ses éléments (Intro/Outro/emplacements/couches/sections/boucles nommées) avaient exactement la même indentation que les 3 entrées virtuelles de premier niveau, rendant la hiérarchie peu lisible.

**Changement** : nouvelle classe CSS `.seq-master-item-child` (léger `margin-left`, pas un simple `padding` pour que la bordure de la carte elle-même se décale) appliquée aux items qui vivent sous "Structure", quel que soit le mode — Intro/Outro (séquentiel et vertical-random), emplacements (séquentiel), couches (vertical), sections (vertical-random), boucles nommées (embranchement-vertical). Les 3 entrées virtuelles de premier niveau (Infos du morceau, Contenu additionnel, Infos additionnelles) restent alignées à gauche, non affectées. `modeMasterItem()`/`seqMasterItem()` acceptent un nouveau paramètre optionnel `isChild`, et la construction directe de l'item d'emplacement séquentiel (qui n'utilise pas ces helpers) reçoit la classe directement.

**Vérifications** : `node --check` — OK. Balises `<div>` équilibrées (412/412). Vérification concrète du DOM généré pour les 4 modes concernés (séquentiel avec 2 emplacements, vertical, vertical-random, embranchement-vertical avec 2 boucles) : la classe `seq-master-item-child` est posée exactement sur les bons éléments dans tous les cas, jamais sur les 3 entrées de premier niveau. 5 suites de tests rejouées (`test_backstage_content_nav_redesign`, `test_backstage_maxchainloops`, `test_backstage_custom_cut_fade_roundtrip`, `test_seq_slot_tempo`, `test_seq_branching`) — toutes vertes.

---

## [2026-08-18] — Structure repositionnée sous Infos du morceau (tous modes), Intro/Outro séquentiel intégrés en sous-entrées, libellés courts corrigés

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : ajustements demandés après retour visuel (captures d'écran) sur l'état de la disposition maître-détail généralisée.

**Changement** :
- **Ordre des entrées, tous modes** : Infos du morceau → Structure → Contenu additionnel → Infos additionnelles (auparavant Structure arrivait après les deux dernières). Concerne vertical, vertical-random, embranchement-vertical.
- **Séquentiel restructuré** : Intro et Outro n'étaient jusqu'ici que deux blocs repliables à part, en dehors de la disposition maître-détail des emplacements. Ils deviennent deux entrées de la liste maître, dans la catégorie "Structure" avec les emplacements — même principe que vertical-random. L'ancien mécanisme de repli (`introBlockToggle`/`outroBlockToggle`, `collapsed` par défaut) disparaît : la sélection dans la liste maître fait désormais office d'affichage/masquage, comme pour tous les autres éléments de la disposition. Le mécanisme de reclassification de rôle (bouton "Segment/Intro/Outro", conversion d'un bloc glissé-déposé) est entièrement conservé, aucune donnée ni gestionnaire touché.
- **Catégorie "Structure"** : libellé non cliquable (confirmé), maintenant posé de façon universelle pour les 4 modes non-statiques (vertical, vertical-random, séquentiel, embranchement-vertical) plutôt que seulement vertical-random.
- **Bug de libellé trouvé et corrigé** (vérification manuelle après la restructuration) : les items "Intro"/"Outro" de la liste maître affichaient tout le texte descriptif long (`introSectionLabel`/`outroSectionLabel`, prévu à l'origine comme titre de bloc repliable) au lieu d'un mot court — présent à la fois dans le nouveau code séquentiel et dans le vertical-random de la session précédente (jamais remarqué faute de vérification aussi poussée à l'époque). Corrigé aux 4 emplacements concernés : nouvelles clés i18n `introShortLabel`/`outroShortLabel` ("Intro"/"Outro") pour le libellé de la liste, texte descriptif long déplacé en indication (`hint-inline`) dans le panneau de détail plutôt que perdu.
- Trois indications utiles (avertissement absence de fichier, ordre des emplacements compte, dépôt groupé) avaient disparu du template lors de la restructuration séquentielle — repérées et restaurées au bon endroit (au-dessus de la grille maître-détail).

**Bouton "Partager" (AdReel en édition)** : examen du code — appelle déjà `shareOrCopy()` (`player.js`), qui tente le partage natif du navigateur/OS puis retombe automatiquement sur la copie presse-papier si indisponible. Confirmé non redondant avec "Copier le lien" : ce dernier offre une copie garantie en un clic (utile pour coller ailleurs qu'un réseau social), quand "Partager" ouvre le menu natif avec ses apps installées. **Les deux boutons sont conservés**, aucun changement de code sur ce point.

**i18n** : 2 clés ajoutées en FR et en EN dans la zone `backstage` (`introShortLabel`, `outroShortLabel`). Symétrie FR/EN vérifiée programmatiquement (shared 12→12, player 47→47, backstage 530→530, 0 écart).

**Vérifications** : `node --check` sur les deux fichiers — OK. Balises `<div>` équilibrées (412/412). Recoupement de toutes les clés `tr('...')` utilisées contre le dictionnaire — 0 manquante. Les 3 suites backstage encore valides (`test_backstage_content_nav_redesign`, `test_backstage_maxchainloops`, `test_backstage_custom_cut_fade_roundtrip`) et les 12 suites moteur — toutes rejouées, toutes vertes.

**Non fait, à noter honnêtement** :
- `test_backstage_intro_outro_collapse_and_reorder.js` échoue désormais **par design** (sa partie 1 teste explicitement l'ancien mécanisme de repli Intro/Outro, remplacé cette session par la sélection dans "Structure") — vérifié manuellement que le nouveau comportement fonctionne (catégorie Structure présente, Intro/Outro sélectionnables, champs modifiables, ordre correct) et que sa partie 2 (réordonnancement des morceaux, fonctionnalité indépendante) n'est pas affectée. Le fichier de test lui-même a besoin d'être réécrit pour refléter le nouveau modèle d'interaction — non traité ici.
- "Section compte : encadrés sur les intitulés" — demande restée sans réponse claire de quelle section il s'agit, non traitée.
- AdReels organisables en dossiers, et généralisation de la disposition maître-détail aux autres sections (Packs, etc.) — chantiers d'architecture à part entière, mis de côté comme convenu pour une session dédiée.

---

## [2026-08-18] — Relecture/nettoyage de la généralisation maître-détail : fuite d'écouteurs corrigée, code mort retiré

**Fichier touché** : `layerpitch-backstage.html`

**Contexte** : passe de relecture demandée juste après la session précédente (généralisation maître-détail aux 4 modes restants) — "repasse sur le nouveau code, corrige, optimise, nettoie".

**Bug réel trouvé et corrigé** : `wireArrayDragReorder()` posait ses écouteurs de secours `pointerup`/`pointercancel` sur `document` à l'intérieur de la fonction elle-même — or cette fonction est appelée à chaque `renderLibrary()`, donc potentiellement des centaines de fois par session (à chaque frappe dans un champ). Chaque appel empilait deux écouteurs supplémentaires jamais retirés : fuite de mémoire/écouteurs qui grossit sans borne sur une session d'édition longue. Corrigé en reprenant le modèle déjà en place pour les blocs de contenu (16/08) : un seul écouteur global `releaseAllDragHandles`, posé une fois à portée module, balayant tout le document plutôt qu'un conteneur précis.

**Nettoyage** :
- Les 5 gestionnaires devenus orphelins après le passage au glisser-déposer (`toggle-collapse-layer`, `move-section-up`, `move-section-down`, `move-embr-loop-up`, `move-embr-loop-down`) sont retirés pour de bon, ainsi que `collapsedLayerKeys` (Set désormais sans utilité, y compris ses deux points de `.clear()`) — précédemment laissés en place par prudence, supprimés proprement maintenant que le contexte s'y prêtait.
- CSS `.list-block.dragging`/`.list-block.drag-over-*` retiré (ajouté par anticipation lors de la session précédente, jamais utilisé — `wireArrayDragReorder()` n'est appelée qu'avec `.seq-master-item` en pratique). Commentaire associé corrigé pour ne plus promettre un support déjà présent qui ne l'était pas.
- Variable `hasTempoSection`, devenue inutilisée après la restructuration du template, retirée.

**Vérifications** : `node --check` sur le script extrait — OK. Balises `<div>` équilibrées (408/408). Les 4 suites backstage pertinentes (`test_backstage_content_nav_redesign`, `test_backstage_maxchainloops`, `test_backstage_custom_cut_fade_roundtrip`, `test_backstage_intro_outro_collapse_and_reorder`) et les 12 suites moteur — toutes rejouées après nettoyage, toutes vertes, aucune régression.

**Non fait, à noter honnêtement** : la grille de mesures complète de l'intro (vertical-random) reste non branchée à `player.js` (déjà signalé dans l'entrée précédente, toujours vrai). `layerpitch-i18n.js` non modifié cette passe (aucune clé touchée).

---

## [2026-08-18] — Généralisation de la disposition maître-détail aux 4 modes restants (vertical, vertical-random, statique, embranchement-vertical)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : suite de l'incrément 1 (séquentiel uniquement, plus tôt le 18/08) — extension du même principe (liste compacte à gauche, détail à droite) validée mode par mode avant codage : glisser-déposer par poignée (remplace les flèches ↑/↓) pour couches/sections/boucles nommées, 3 entrées virtuelles communes à tous les modes (« Infos du morceau », « Sfx », « Infos additionnelles »), catégorie « Structure » (libellé non cliquable) pour vertical-random regroupant Intro/Sections/Outro.

**Changement** :
- En-tête de carte de morceau (titre + sélecteur de format éditables en place) unifié pour tous les modes — auparavant réservé au séquentiel.
- Sections Identité/Tempo/Contenu/Structure/Réglages avancés de l'ancien flux plat supprimées pour les 4 modes concernés ; tous les champs qu'elles contenaient sont **déplacés** (jamais dupliqués) dans le détail des entrées virtuelles ou des éléments spécifiques au mode.
- Nouvelle fonction JS partagée `wireArrayDragReorder()` (glisser-déposer par poignée, même principe exact que le réordonnancement des blocs de contenu du 16/08, généralisé à n'importe quel tableau) et helper `dragHandleHtml()`.
- **Vertical** : couches réordonnables par glisser-déposer (niveau d'intensité = position, jamais un champ saisissable). Migration douce : `id` ajouté à chaque couche existante (nécessaire au glisser-déposer), garde-fou si `track.layers` n'existait pas encore.
- **Statique** : fichier audio et case « bouclable » déplacés dans le détail de « Infos du morceau » — aucun élément sous les 3 entrées virtuelles, comme décidé.
- **Vertical-random** : catégorie « Structure » (libellé non cliquable) → Intro / chaque section / Outro, tous sélectionnables individuellement. Sections réordonnables par glisser-déposer (remplace les boutons ↑/↓ `move-section-up/down`, désormais orphelins — voir « Non fait » plus bas). Les pools d'une section restent repliables individuellement (`altPoolToggleHtml`, déjà en place, aucun changement nécessaire). **Nouveau** : l'intro gagne son propre BPM/temps par mesure (`track.intro.bpm`/`beatsPerBar`, additif, ne touche pas au champ `bars` déjà lu par `player.js` pour le chevauchement de queue).
- **Embranchement-vertical** : boucles nommées réordonnables par glisser-déposer (remplace `move-embr-loop-up/down`, désormais orphelins également).
- Ancien rendu à plat (couches/boucles/sections) entièrement supprimé, pas seulement désactivé — aucun code mort laissé en place pour ces trois blocs.

**i18n** : 4 clés ajoutées en FR et en EN dans la zone `shared` (`sectionFallback` y était déjà dupliquée depuis la zone `player`, nécessaire ici car `tr()` côté backstage ne lit jamais la zone `player`) : `embrLoopFallback`, `vrsPoolCountSingular`, `vrsPoolCountPlural`, plus `sectionFallback` dupliquée dans `shared`. Symétrie FR/EN vérifiée programmatiquement par zone (shared 12→12, player 47→47, backstage 528→528, 0 écart).

**Vérifications menées** : `node --check` sur `layerpitch-i18n.js` et sur le script principal extrait de `layerpitch-backstage.html` — les deux passent. Balises `<div>` équilibrées (408/408). Recoupement programmatique de toutes les clés `tr('...')` utilisées contre le dictionnaire — 0 manquante (seul `socialPlatform_` ressort, faux positif déjà documenté). Recoupement de tous les `data-role` interrogés contre ceux réellement posés — 0 orphelin.

**Non fait, à noter honnêtement** :
- **Grille de mesures complète de l'intro (vertical-random)** : seuls BPM/temps par mesure ont été ajoutés. La grille interactive Entrée/Boucle/Sortie (`buildLoopTimelineEl`) montrée en maquette n'a **pas** été branchée sur l'intro — ses champs (`loopInBeat`/`loopOutBeat`) ne sont actuellement lus par aucune logique de lecture réelle dans `player.js` pour l'intro. Brancher cette grille pour de vrai nécessite une coordination avec le canal Claude Code pour confirmer ce que `player.js` doit en faire, sans quoi ce serait une UI décorative sans effet à la lecture.
- **5 gestionnaires devenus orphelins** (`toggle-collapse-layer`, `move-section-up`, `move-section-down`, `move-embr-loop-up`, `move-embr-loop-down`) : plus aucun bouton ne les déclenche (remplacés par le glisser-déposer), mais laissés en place plutôt que supprimés à la hâte — inertes, sans risque, à nettoyer dans une prochaine passe d'audit si confirmé inutile pour de bon.
- `backstage.css` volontairement non touché, comme convenu — à synchroniser une fois cette session validée visuellement.

**Vérifications complémentaires menées après coup (tests jsdom réels, récupérés à la racine du repo)** :
- 12 suites moteur (`test-section-scheduler.js`, `test-slot-chain-advancer.js`, `test_seq_branching.js`, `test_embr_vertical_engine.js`, `test_vr_engine.js`, `test_player_regression.js`, `test_quantized_loop_engine.js`, `test_max_chain_loops_e2e.js`, `test_seq_transitions.js`, `test_seq_stage_description.js`, `test_seq_custom_cut_fade.js`, `test_seq_no_outro_goto_end.js`) — toutes vertes, sans surprise puisque `player.js` n'a pas été touché cette session.
- 4 suites backstage directement pertinentes — toutes vertes : `test_backstage_content_nav_redesign.js`, `test_backstage_maxchainloops.js` (bascules de mode répétées, y compris vers/depuis vertical-random et séquentiel, aucune régression), `test_backstage_custom_cut_fade_roundtrip.js`, `test_backstage_intro_outro_collapse_and_reorder.js`.
- 5 suites backstage en échec (`test_backstage_seq_transitions.js`, `test_backstage_slot_collapse.js`, `test_backstage_default_collapse.js`, `test_backstage_slot_autolabel.js`, `test_backstage_filename_bpm_bars_detection.js`) — **confirmées préexistantes** : échec strictement identique rejoué sur le fichier original non modifié (avant toute intervention de cette session). Tests devenus obsolètes suite à une restructuration antérieure, pas des régressions introduites ici.
- **Point technique trouvé en cours de vérification, sans rapport avec le code livré** : les fichiers de test comparent la ligne exacte `<script src="player.js"></script>` (sans paramètre) pour l'inliner — depuis l'ajout du cache-busting (13/08), les balises publiées portent `?v=<timestamp>`, donc plus aucun test ne trouve la ligne à remplacer et tous plantent au chargement (`window.LayerPlayerCore` jamais défini), y compris sur l'original. Contourné localement (copie de `layerpitch-backstage.html` avec les paramètres `?v=...` retirés) pour pouvoir exécuter les suites ; **les fichiers de test eux-mêmes, sur le repo, ont besoin du même correctif pour refonctionner tels quels** — non traité ici, hors périmètre de cette session (fichiers de test non demandés).

---

## [2026-08-18] — Audit complet de la session (i18n, CSS, data-role/action, bug de câblage sur emplacement dupliqué)

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : audit demandé explicitement sur l'ensemble du code du jour (disposition maître-détail + réconciliation textes narratifs), pas seulement le dernier changement.

**Vérifications programmatiques faites** :
- Extraction de toutes les clés `tr('...')` réellement utilisées dans le fichier (397) et contrôle une par une contre le dictionnaire FR/EN — 0 manquante (le seul signalement initial, `socialPlatform_`, est un faux positif : concaténation dynamique `'socialPlatform_' + platform`, pas une vraie clé).
- Comparaison des variables CSS `var(--xxx)` utilisées contre celles déclarées dans `:root`.
- Croisement automatique de tous les `data-role` interrogés par `querySelector` contre ceux réellement posés dans le HTML généré, et de tous les `data-action` vérifiés dans les gestionnaires délégués contre ceux réellement posés (en tenant compte des deux façons de les poser : littéral `data-action="..."` et construction dynamique via `deleteIconBtnHtml()`) — 0 orphelin, 0 gestionnaire mort des deux côtés.

**Bugs corrigés** :
1. **`var(--text)` non déclarée** (préexistant, sans rapport avec les sessions du jour) : utilisée par `.wwise-node-source`/`.wwise-node-bus` sans jamais être définie dans `:root`. Ajoutée (`--text: #24262b`, même teinte que le texte du body).
2. **Toggles inertes sur un emplacement dupliqué** : les boutons dépliants "Embranchements" et "Texte affiché pendant la lecture" s'affichent dans le gabarit qu'un emplacement soit un duplicata ou non (seul le contenu audio en dessous — alternatives/anti-répétition — diffère), mais leur câblage (`wireCollapsibleBlockToggle`) se faisait *après* le retour anticipé réservé aux duplicatas. Un clic sur ces boutons sur un emplacement dupliqué ne faisait donc rien. Corrigé en déplaçant leur câblage avant ce retour ; celui d'`altPoolToggleHtml` (pertinent seulement pour un emplacement non dupliqué) reste après. Le bug sur "Embranchements" était présent avant même les ajouts du texte narratif de cette session.
3. **Badge de sorties resté en français en dur** : celui affiché à côté de l'interrupteur "Embranchements" (`"2 sorties"`) n'était pas passé par `tr()`, contrairement à celui déjà corrigé plus tôt dans la liste maître. Aligné sur les mêmes clés `seqOutletsSingular`/`seqOutletsPlural` via `trCount()`.

**Vérifications finales** : `node --check` sur le script principal et sur `layerpitch-i18n.js`, balises `<div>` équilibrées sur tout le fichier (396/396), symétrie FR/EN reconfirmée après les correctifs (640 clés de chaque côté, 0 écart), suite de tests ciblés Node relancée (14 scénarios entre les deux fichiers de test du jour) — tout est vert.

**Non fait, à noter honnêtement** : pas de harnais de test jsdom complet construit pour cette session (uniquement des tests Node ciblés sur les fonctions extraites, sans rendu DOM réel) — la validation visuelle en conditions réelles reste entièrement celle de Jules-Antoine.

---

## [2026-08-18] — Réconciliation : disposition maître-détail + chantier textes narratifs par élément (descriptionFr/descriptionEn)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : le fichier `layerpitch-backstage.html` fourni en début de session par Jules-Antoine ne contenait pas un chantier récent mené côté canal Claude Code — un texte de présentation par morceau et par élément jouable (intro, chaque emplacement, outro, chaque fichier de transition), avec logique de repli si vide (le texte précédemment affiché reste tel quel plutôt que d'être effacé). Le mécanisme de lecture (`pickStageDescription()` dans `player.js`) était bien présent et fonctionnel ; c'est l'interface d'édition côté backstage qui manquait dans le fichier de départ. Après plusieurs allers-retours et un faux départ (un fichier réuploadé par erreur s'est révélé être une simple copie de mon propre travail du jour), le bon fichier de référence a été identifié et fourni.

**Décision de reconstruction** : plutôt que de repartir du fichier de référence et d'y rejouer toute la disposition maître-détail construite dans la session précédente (risque de régression sur un travail déjà construit et en partie validé), reconstruction dans l'autre sens — le fichier du jour (disposition maître-détail) sert de base, et les éléments du chantier textes narratifs y sont greffés un par un.

**Changement** :
- Bloc dépliable "Texte affiché pendant la lecture" (`descriptionFr`/`descriptionEn`) ajouté à l'intro et à l'outro (colonne de gauche, position inchangée), à chaque emplacement (colonne de droite, entre le résumé des répétitions et l'interrupteur Embranchements), et à chaque fichier de transition (à l'intérieur de sa carte "SORTIE N").
- Pour les transitions, deux champs supplémentaires manquaient aussi dans la simplification faite lors de la construction des cartes de sortie de la session précédente et ont été restaurés en même temps : l'unité de durée (mesures calées sur le tempo vs secondes fixes) et le tempo propre à la transition (BPM/temps par mesure, hérite de l'emplacement puis du morceau si vide).
- `buildPreviewTrack()` (aperçu "Écouter") : transmet désormais ces textes au lecteur — sans ça, rien ne se serait affiché en aperçu malgré la présence des champs de saisie.
- `loadData()` (migration au chargement) et la sérialisation de `publishAll()` : lisent et republient ces champs sans perte.
- Gestionnaire de saisie délégué complété pour tous les nouveaux champs (`introDescriptionFr/En`, `outroDescriptionFr/En`, `slot.descriptionFr/En`, `transition.descriptionFr/En`, `transition.durationUnit/durationSeconds/bpm/beatsPerBar`).

**i18n** : 9 clés ajoutées en FR et en EN (`stageDescriptionToggleLabel`, `stageDescriptionHint`, `stageDescriptionFrLabel`, `stageDescriptionEnLabel`, `transitionDurationUnitLabel`, `transitionDurationUnitBars`, `transitionDurationUnitSeconds`, `transitionDurationSecondsLabel`, `transitionBarsTempoHint`) — absentes non seulement du fichier de travail du jour mais aussi de la version de `layerpitch-i18n.js` récupérée depuis la racine du repo GitHub, confirmant que ce dernier est également en retard sur ce chantier.

**Vérifications** : `node --check` sur les deux fichiers, balises équilibrées (396/396), symétrie FR/EN programmatique (640 clés de chaque côté, 0 écart), test Node ciblé sur les fonctions de mapping (`mapBlockWithBars`/`mapTransition`) contre 5 formes de données (legacy sans les nouveaux champs, avec textes narratifs, transition en secondes, intro absente) — tous les cas passent sans exception.

---

## [2026-08-18] — Disposition maître-détail du mode séquentiel (incrément 1), en-tête titre/format, entrées virtuelles Infos du morceau/Contenu additionnel/Infos additionnelles

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : discussion approfondie (hors code, plusieurs maquettes générées par Claude Code passées en revue et pour la plupart écartées — voir décisions ci-dessous) aboutissant à un besoin réel identifié : l'éditeur d'un morceau séquentiel oblige à scroller une colonne unique et sans fin pour naviguer entre les emplacements, et manque de relief visuel entre ses sections. Portée volontairement limitée au **mode séquentiel uniquement** pour ce premier incrément — les autres modes (vertical, vertical-random, statique, embranchement-vertical) restent inchangés, dans l'attente d'une validation visuelle en conditions réelles avant extension.

**Explicitement écarté** (idées venues des maquettes Claude Code, discutées puis rejetées) : rail de navigation à icônes seules sans libellé, système d'onglets (Graphe/Liste/Fiche), panneau de simulation dédié (le mécanisme existe déjà via l'aperçu "Écouter" + `renderSeqBranchOptions`, jugé redondant).

**Changement** :
1. **Disposition à deux colonnes** pour la section "Chaîne de lecture" d'un morceau séquentiel : liste compacte cliquable à gauche (`.seq-master-list`), détail complet de l'élément sélectionné à droite (`.seq-detail-col`) — au lieu d'empiler tous les formulaires d'emplacement les uns sous les autres. Sélection gérée par `seqSelectedSlotIndex` (Map trackId → index ou clé spéciale), purement un état d'affichage local à la session, sans impact sur les données.
2. **En-tête de carte morceau** (mode séquentiel) : titre et sélecteur de Format déplacés dans l'en-tête, éditables en place, à côté des flèches ↑/↓.
3. **Trois entrées virtuelles** ajoutées à la liste maître, au même titre que les emplacements : "Infos du morceau" (BPM/mesures, cycles avant transition automatique, description, harmonisation — sélectionnée par défaut à l'ouverture), "Contenu additionnel" (Sfx attachés), "Infos additionnelles" (note d'implémentation, certification "sans IA"). Ces champs sont déplacés (pas dupliqués) depuis leur ancien emplacement dans le flux plat du formulaire.
4. **Cartes de sortie d'embranchement** : chaque sortie devient une carte encadrée en accent avec étiquette "SORTIE N", au lieu d'un bloc générique indifférencié.
5. **Interrupteurs** : cases à cocher "Embranchements" et "Fichier de transition" stylées en vrais interrupteurs (CSS pur, mêmes éléments `<input type="checkbox">`, aucun changement de câblage), badge de comptage des sorties à côté.
6. **Champs compactés** : Répétitions / Source du contenu / Tempo regroupés sur une seule ligne à 3 colonnes au lieu de deux blocs séparés. Repère "Variations de cet emplacement" ajouté au-dessus du pool de variations, qui n'avait auparavant aucun titre.
7. **Bug corrigé en cours de session** : la liste maître affichait un numéro d'emplacement en double (ex. "#3 #3 Battle") quand le libellé saisi par l'utilisateur commençait déjà par son propre préfixe manuel — une regex (`^#\d+\s*`) retire ce préfixe avant d'appliquer la numérotation automatique.
8. **Correctif CSS séparé, trouvé en cours de session** : `.list-block` avait un fond codé en dur (`#f7f7f8`) quasiment identique au fond de page par défaut (`--backstage-bg: #f7f6f3`), cassant le contraste page/contenu attendu. Remplacé par `var(--bg)` (blanc), conforme à la hiérarchie à trois niveaux documentée le 16/08 (les autres panneaux du fichier suivaient déjà cette règle, `.list-block` avait été oublié).

**i18n** : 9 clés ajoutées en FR et en EN (`seqTrackInfoLabel`, `seqContentAdditionalLabel`, `seqAdditionalInfoLabel`, `seqDuplicateTag`, `seqOutletsSingular`, `seqOutletsPlural`, `seqOutletLabel`, `seqCyclesInfinite`, `seqCyclesFinite`).

**Tests** : tests Node ciblés (pas de harnais jsdom complet, `player.js`/`layerpitch-i18n.js` non disponibles au moment de l'écriture initiale) sur les expressions nouvellement écrites de la liste maître (détection de duplicat, comptage de sorties, résolution du libellé, index de sélection par défaut et après suppression d'un emplacement) contre 6 formes de données représentatives, dont un morceau antérieur au 04/08 (avant l'existence des embranchements) — tous les cas passent. `node --check` sur les deux fichiers à chaque étape.

---

## [2026-08-18] — Correction d'une régression : `.page` revenue à 760px (perte de l'adaptation à la largeur d'écran)

**Fichiers touchés** : `layerpitch-backstage.html`

**Diagnostic** : `.page { max-width: 760px }` — la valeur d'avant le correctif du 13/08 (`min(1400px, 92vw)`), qui avait pourtant déjà corrigé ce même problème une première fois. Preuve la plus parlante : le commentaire du correctif du 16/08 sur `.page-top-row` affirmait lui-même "jamais plus large que `.page` (max 760px)" comme une évidence — signe que la régression était déjà en place au moment où ce commentaire a été écrit, entre le 13/08 et le 16/08, sans avoir été remarquée sur le coup.

**Correction** : `.page` restaurée à `max-width: min(1400px, 92vw)`, commentaire de `.page-top-row` corrigé pour ne plus affirmer la valeur erronée.

**Test** : `node --check` sur le script principal, une seule règle `.page` confirmée dans le fichier.

## [2026-08-16] — Hiérarchie de surfaces à trois niveaux, navigation Contenu/Apparence restructurée, liste de blocs (résumés, glisser-déposer, Tout replier)

**Fichiers touchés** : `layerpitch-backstage.html`, `backstage.css`, `layerpitch-i18n.js`, `test_backstage_content_nav_redesign.js` (nouveau)

**Contexte** : le backstage a été jugé peu lisible — sidebar, fond de page et blocs de contenu dans le même blanc, séparés seulement par de fines bordures. Direction validée en amont (hors code) pour la hiérarchie visuelle générale et pour la page Contenu spécifiquement.

**Changements** :
1. **Hiérarchie de surfaces à trois niveaux**, sur l'ensemble du backstage (pas seulement la page Contenu) : nouvelle variable `--bg-sidebar` (le plus sombre), `--backstage-bg` repositionnée comme niveau intermédiaire (fond de page, toujours personnalisable via le réglage existant "Apparence du backstage"/`#backstageBgColor` — seule sa valeur par défaut change, de `#ffffff` à `#f7f6f3`), `--bg` confirmée comme le niveau le plus clair (cartes/blocs). Appliqué explicitement (au lieu de couleurs codées en dur) sur `.backstage-sidebar`, `.block-editor-card`/`.block-editor-body`, `fieldset`, la carte "AdReel en édition" et les 5 modales (`#linkModal`, `#newAdReelModal`, `#feedbackModal`, `#implSheetModal`, `#themeConflictModal`). Écart de teinte volontairement discret entre les trois niveaux.
2. **Navigation Contenu/Apparence restructurée** :
   - La carte "AdReel en édition" (sélecteur + lien public + Copier/Partager) remonte en tête de sidebar, avant la section Compte — casse la hiérarchie logique habituelle (Compte > AdReel) volontairement, puisque c'est l'objet manipulé en continu pendant une session de travail.
   - Contenu/Apparence sortis de la liste verticale de `nav-item` et présentés côte à côte dans un nouveau `.content-appearance-toggle` (deux vues du même objet, pas une navigation vers un autre objet).
   - Aperçu et Publier sortis du flux de page (ils vivaient tout en bas, après le formulaire du token GitHub) et fixés en haut à droite (`.global-actions-bar`), **visibles sur toutes les pages** — Publier pousse tout `data.json` (bibliothèque, packs, collections, réseaux inclus), donc reste pertinent depuis n'importe quel panneau, pas seulement Contenu/Apparence. Bouton renommé `publishBtn` : "Publier sur GitHub" → "Sauvegarder / publier" (FR), "Publish to GitHub" → "Save / publish" (EN) — l'ancien libellé était trompeur une fois le bouton rendu global, mais "Sauvegarder" seul aurait fait l'erreur inverse (ce bouton pousse réellement en ligne, ce n'est pas un enregistrement local sans conséquence).
3. **Liste des blocs de contenu** :
   - Résumé compact toujours visible sur l'en-tête de chaque bloc (replié ou déplié), via `blockSummaryText(block)` — comptage ou aperçu selon le type (ex. "6 morceaux", "2 citations", "Email + formulaire"/"Formulaire non configuré" pour Contact). Rafraîchi (`refreshAllBlockSummaries()`) après tout changement pertinent, y compris ceux qui ne repassent pas par `layoutBlocks()` (sélecteur de morceaux, témoignages, photos, vidéos, packs/collections/Sfx, champs Header/Bio/Texte).
   - Bouton "Tout replier"/"Tout déplier" au-dessus de la liste (`btnToggleCollapseAllBlocks`), état dérivé de `collapsedBlockIds` — un repli individuel ne fait pas basculer le libellé global tant que tout n'est pas replié.
   - Réordonnancement : les boutons flèches ↑/↓ sont supprimés, remplacés par un glisser-déposer via une poignée dédiée à gauche de chaque bloc (API HTML5 native `draggable`/`dragstart`/`dragover`/`drop`, pas de dépendance externe). L'attribut `draggable` de la carte n'est activé que pendant que le pointeur est sur la poignée (`pointerdown`→`pointerup`/`pointercancel`, écouté sur tout le document) : cliquer ailleurs sur la carte (titre, boutons, champs) ne peut jamais déclencher un drag involontaire.
   - Position affichée au format compact "01"/"02"/… au lieu de "position 1"/"position 2"/….

**Explicitement écarté** : pastille de couleur par morceau dans la liste des morceaux d'un bloc Musique (présente sur la maquette Claude Design fournie en référence, jamais demandée ni validée — résidu de maquette, ignoré). De même, la maquette montrait encore des flèches ↑/↓ à côté de la poignée sur chaque bloc ; le brief écrit validé en amont était explicite sur leur suppression au profit du glisser-déposer seul — c'est ce dernier qui a été suivi.

**Différé à une session future** : les flèches de réordonnancement accessibles au clavier (pour malvoyants/navigation clavier) initialement envisagées comme réglage d'accessibilité persistant (`localStorage`) sont reportées — elles reviendront comme option dans un onglet Apparence dédié à l'accessibilité, pas dans cette session.

**Tests** : nouveau `test_backstage_content_nav_redesign.js` (jsdom, pattern habituel : `<script>` externes stripés, `window.LayerPlayerCore` stubbé, état seedé à la main plutôt que dépendance au réseau) — construction des cartes, absence des anciennes flèches, présence de la poignée, format de position compact, résumé compact pour Header/Musique/Témoignages/Contact (pluriel et singulier), bascule Tout replier/déplier (y compris qu'un repli individuel ne fait pas basculer le libellé global à tort), compteur de blocs, activation de `draggable` strictement liée à la poignée (`pointerdown` ailleurs sur la carte = aucun effet), réordonnancement effectif du tableau `blocks` via l'événement `drop`. Tous les cas passent. Vérifications habituelles également faites : `node --check` sur le script principal et sur `layerpitch-i18n.js`, symétrie FR/EN programmatique (501 clés de chaque côté, 0 écart), contrôles structurels (pas de carte AdReel dupliquée, pas d'identifiants dupliqués sur Publier/Aperçu/sélecteur d'AdReel).

**Rappel `backstage.css`** : synchronisé avec les mêmes changements CSS que le `<style>` inline de `layerpitch-backstage.html` (diff vérifié programmatiquement : les deux seules divergences restantes sont les deux déjà connues et volontairement préservées — couleur de `.nav-section-label` propre au sandbox, et les règles orphelines `.track-section-head/caret/body` du 10/08, toujours sans JS/HTML correspondant côté backstage).

---

## [2026-08-16] — Audit/nettoyage de la session précédente (hiérarchie, sidebar, liste de blocs, glisser-déposer)

**Fichiers touchés** : `layerpitch-backstage.html`, `backstage.css`, `test_backstage_content_nav_redesign.js`

**Contexte** : audit demandé explicitement sur le seul code de la session précédente (pas tout le fichier).

**Bugs corrigés** :
1. **Troncature du résumé de bloc inopérante** : `.block-editor-head-left` n'avait pas `flex: 1; min-width: 0`, donc le `flex: 1` posé sur `.block-summary` n'avait rien à quoi se contracter dans la ligne d'en-tête (`justify-content: space-between`) — un résumé long aurait débordé au lieu de s'ellipser proprement. Corrigé, et `flex-shrink: 0` ajouté explicitement (scopé à `.block-editor-head`, sans toucher les règles partagées `strong`/`.btn-toggle-collapse` utilisées ailleurs dans le fichier) sur la poignée, le chevron, la position et le libellé, pour que seul le résumé se resserre jamais eux.
2. **Dépôt (drop) impossible sur l'espace vide sous le dernier bloc** : `dragover` n'appelait `preventDefault()` que lorsque la cible était une carte — déposer en dehors de toute carte était donc rejeté par défaut par le navigateur. Corrigé (`preventDefault()` systématique dès qu'un drag de bloc est en cours) et le comportement du `drop` complété : déposer sur l'espace vide du conteneur déplace maintenant le bloc en toute fin de liste au lieu de ne rien faire. `#blocksEditorContainer` reçoit un peu de `padding-bottom` pour que cette zone de dépôt soit réellement atteignable.

**Nettoyage / DRY** :
- Règle CSS `.block-editor-head strong` dupliquée (une résiduelle de l'édition précédente, une nouvelle) → fusionnées en une seule.
- `margin-left` redondants sur `.pos`/`.block-summary` retirés (le `gap: 8px` du conteneur flex parent gère déjà l'espacement — les marges explicites cassaient légèrement le rythme visuel).
- Couleur du résumé de bloc : hex codé en dur (`#888`) → `var(--text-dimmer)`, cohérent avec la variable déjà utilisée pour ce rôle ailleurs dans le fichier.
- Condition "formulaire de contact configuré ?" dupliquée à l'identique dans `buildContactBlockCard` et `blockSummaryText` → extraite en fonction partagée `hasContactFormEndpoint()`, un seul point de vérité.

**Tests** : `test_backstage_content_nav_redesign.js` complété avec 4 nouveaux cas (drop sur l'espace vide → fin de liste, `hasContactFormEndpoint()` avec/sans endpoint). Suite complète relancée (25 assertions) — tout est vert. `node --check` refait sur le script principal après corrections. Contrôles de non-duplication (`grep -c`) confirmant une seule occurrence de la logique contact et une seule règle `.block-editor-head strong`. `backstage.css` resynchronisé et re-diffé (toujours seulement les 2 divergences connues).

---

## [2026-08-16] — Deuxième passe d'audit (même périmètre : hiérarchie, sidebar, liste de blocs, glisser-déposer)

**Fichiers touchés** : `layerpitch-backstage.html`, `backstage.css`

**Bug corrigé** : **chevauchement possible de la barre d'actions globale sur fenêtre étroite**. `.page` n'a pas de largeur minimale (`max-width: 760px` seulement) : sous ~800px de fenêtre, elle s'étend en pleine largeur, et le H1 ou le bandeau d'avertissement (`#backstageNoticeBanner`, fond plein) se seraient retrouvés directement sous la bande verticale occupée par `.global-actions-bar` (fixée, `top: 18px`, ~50-55px de hauteur) plutôt qu'à côté. `padding-top` du `body` porté de 32px à 76px pour réserver systématiquement cette bande, quelle que soit la largeur de fenêtre.

**Vérifications faites sans correction nécessaire** (pour mémoire, plutôt que de les re-vérifier à l'aveugle une prochaine fois) :
- Rafraîchissement des textes dynamiques (compteur de blocs, libellé Tout replier/déplier) au changement de langue : le bouton FR/EN déclenche un `location.reload()` complet, donc tout se recalcule proprement — pas de bug de libellé qui resterait dans l'ancienne langue.
- Symétrie des clés i18n utilisées par le code de cette session (`dragHandleTitle`, `blockSummary*`, `blocksList*`, `blocksCount*`, `collapseAllBlocksBtn`, `expandAllBlocksBtn`) : toutes présentes côté FR et EN. **Hors périmètre, trouvé au passage sans y toucher** : 18 clés i18n manquantes ailleurs dans le fichier, toutes liées au mode séquentiel (quantization/cutStyle/transition) — aucun rapport avec cette session, signalé pour une session future.

**Tests** : suite `test_backstage_content_nav_redesign.js` relancée à l'identique (25 assertions, non affectées par ce correctif purement CSS) — toutes vertes. `node --check` refait. `backstage.css` resynchronisé et re-diffé (toujours seulement les 2 divergences connues).

---

## [2026-08-16] — Ajout des 17 clés i18n manquantes (mode séquentiel : tempo par emplacement, embranchements, quantization, style de coupure, transition)

**Fichiers touchés** : `layerpitch-i18n.js`

**Contexte** : signalées au passage lors de la deuxième passe d'audit du 16/08 (hors périmètre de cette session-là, pas corrigées sur le coup) — Jules-Antoine a explicitement demandé de les ajouter.

**Changement** : 17 clés ajoutées en FR et en EN (`slotBpmOverrideLabel`/`Hint`, `branchOptionsToggleLabel`, `quantizationLabel`/`Immediate`/`Beat`/`Bar`, `cutStyleLabel`/`Fade`/`Hard`/`Custom`, `customCutFadeLabel`, `hasTransitionLabel`, `transitionHint`, `noTransitionFileWarning`, `transitionNamePlaceholder`, `transitionFallbackShort`), rédigées d'après le contexte d'usage réel dans `layerpitch-backstage.html` (section embranchements/quantization/transition de l'éditeur de mode séquentiel). La 18ème clé initialement listée (`socialPlatform_`) était un faux positif de la recherche par regex — les vraies clés `socialPlatform_twitter`/`facebook`/etc. existaient déjà des deux côtés, rien à ajouter là.

**Vérifications** : symétrie FR/EN programmatique (518 clés de chaque côté, 0 écart, contre 501 avant) ; balayage de tout le fichier confirmant qu'aucune clé `tr(...)` utilisée n'est plus manquante nulle part (0 résultat, faux positif `socialPlatform_` exclu explicitement du contrôle). `node --check` sur `layerpitch-i18n.js`. Suite `test_backstage_content_nav_redesign.js` relancée (25 assertions, non concernées par ce changement mais confirment l'absence de régression) — toutes vertes.

---

## [2026-08-16] — Correction d'une régression : perte d'adaptation à la taille d'écran (signalée par Jules-Antoine)

**Fichiers touchés** : `layerpitch-backstage.html`, `backstage.css`

**Cause** : le correctif du 16/08 pour le chevauchement de `.global-actions-bar` sur fenêtre étroite (`padding-top` du `body` porté à 76px) réservait cet espace **en permanence, sur toutes les tailles de fenêtre** — au lieu de s'adapter, la page perdait de la hauteur utile en haut quelle que soit la largeur réelle, ce qui se ressentait particulièrement sur petit écran. Un correctif "au marteau" (toujours réserver le pire cas) plutôt qu'une vraie solution adaptative.

**Correction** : `.global-actions-bar` (Aperçu + Sauvegarder/publier) sort de `position: fixed` (hors du flux de page) et rejoint le flux normal de `.page`, dans une nouvelle ligne `.page-top-row` partagée avec le H1 (`display:flex; justify-content:space-between`). Cette ligne est `position: sticky` (pas `fixed`) : elle reste visible en scrollant loin dans une longue liste de blocs — l'objectif d'origine —, mais étant dans le flux de `.page`, elle ne peut plus jamais dépasser la largeur de `.page` (max 760px), quelle que soit la largeur de fenêtre. Plus besoin de réserver un espace fixe artificiellement : `padding-top` du `body` revient à sa valeur d'origine (32px). Le H1 et la barre d'actions se retrouvent sur la même ligne, avec retour à la ligne automatique (`flex-wrap: wrap`) si la fenêtre devient vraiment trop étroite pour les deux côte à côte, plutôt qu'un chevauchement.

**Tests** : `node --check` refait sur le script principal, suite `test_backstage_content_nav_redesign.js` relancée (25 assertions, non affectées par ce changement structurel/CSS) — toutes vertes. Contrôles structurels : un seul `#btnPublish`, un seul `#btnView`, une seule `.page-top-row` (pas de duplication introduite par la restructuration). `backstage.css` resynchronisé et re-diffé (toujours seulement les 2 divergences connues).

---

## [2026-08-16] — Trois bugs signalés par capture d'écran (résumé Header incorrect, alignement sidebar, débordement du toggle Contenu/Apparence)

**Fichiers touchés** : `layerpitch-backstage.html`, `backstage.css`, `test_backstage_content_nav_redesign.js`

**Contexte** : Jules-Antoine a fourni 3 captures d'écran du backstage réel montrant des problèmes non détectés par les passes d'audit précédentes (données réelles avec historique, pas seulement l'état seedé à la main des tests).

**Bugs corrigés** :
1. **Résumé du bloc Header disait "Vide pour l'instant" alors que l'écran affichait un vrai sous-titre.** Cause : `buildHeaderCard` affiche `profile.subtitle`, et si celui-ci est `null` (AdReel publié avant l'existence de ce champ), retombe sur l'ancien `profile.tagline` pour l'affichage — mais `blockSummaryText('header')` ne lisait que `profile.subtitle` directement, sans ce même fallback. Résultat : le champ affiche du vrai contenu hérité (tagline) mais le résumé le voit comme vide. Corrigé en répliquant exactement le même fallback dans `blockSummaryText`.
2. **"Bibliothèque musicale" (et potentiellement tout item dont le texte s'approche de la largeur disponible) apparaissait visuellement décalée par rapport aux autres items de la sidebar.** Cause racine, pas seulement un symptôme du padding ajouté à la sidebar dans une session précédente : `.nav-item` utilise `justify-content: space-between`, mais l'icône (`<svg>`) et le texte (`<span>`) étaient des enfants flex **séparés**, pas groupés — avec deux enfants directs, `space-between` les pousse chacun vers un bord opposé du bouton. Pour la plupart des libellés, le texte est presque aussi large que le bouton donc l'écart est invisible ; pour un texte qui passe sur 2 lignes (donc plus étroit sur sa ligne la plus longue), l'écart devient visible et le texte semble "poussé à droite". Corrigé en groupant systématiquement icône + texte dans `.nav-item-label` (comme c'était déjà fait pour "Projets", seul item avec badge) sur les 8 autres `nav-item` de la sidebar — `.nav-item-label` a déjà `flex:1; min-width:0`, donc le texte peut désormais se replier sur 2 lignes normalement, à sa place, sans décalage.
3. **Le mot "Apparence" débordait de son onglet dans le nouveau toggle Contenu/Apparence.** Cause : l'espace réellement disponible dans la carte "AdReel en édition" pour les 2 boutons combinés est d'environ 140px (196px de sidebar − 2×14px de padding sidebar − 2×10px de padding de carte − 2×3px de padding du toggle − 4px de gap), soit ~61px de contenu par bouton une fois son propre padding déduit — trop étroit pour icône (16px) + interligne (9px) + le mot "Apparence" (~60-65px à 13px). Corrigé en retirant les icônes de ce toggle spécifiquement (un bascule à 2 boutons n'en a pas vraiment besoin, et ça libère la place nécessaire), et réduction légère du padding/font-size par précaution supplémentaire (6px 2px / 12px au lieu de 6px 4px / 13px).

**Tests** : 2 nouveaux cas ajoutés à `test_backstage_content_nav_redesign.js` (résumé Header avec tagline hérité sans subtitle → doit refléter le vrai contenu ; nav-item Bibliothèque musicale → icône et texte bien groupés dans `.nav-item-label`). Suite complète relancée (27 assertions) — tout est vert. `node --check` refait, équilibre des balises `<button>`/`<svg>`/`<span>` vérifié par comptage programmatique après la réécriture des 8 nav-item. `backstage.css` resynchronisé et re-diffé (toujours seulement les 2 divergences connues).

---

## [2026-08-15] — Repli des Sfx attachés à un morceau + repli par défaut étendu aux emplacements/bibliothèque Sfx

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`, `test_backstage_default_collapse.js` (nouveau)

**Contexte** : Jules-Antoine signale deux choses sur une capture d'écran de la section "Sfx (déclenchables à la main pendant la lecture)" d'un morceau : (1) pas de flèche de repli sur cette section (contrairement à Intro/Outro/embranchements), et (2) toutes les flèches du Backstage devraient être repliées par défaut à l'ouverture — pas seulement celles qui l'étaient déjà.

**Découverte en cours de route** : le repli par défaut au chargement existait déjà pour morceaux/packs/collections/blocs de contenu (`collapsedTrackIds`/`collapsedPackIds`/`collapsedCollectionIds`/`collapsedBlockIds`, peuplés avec tous les ids existants dans `loadData()`) — mais pas pour les emplacements séquentiels (`collapsedSlotIds`, ajoutés le 15/08 plus tôt dans la journée) ni pour la bibliothèque Sfx (`collapsedSfxIds`), qui restaient dépliés par défaut à l'ouverture.

**Changements** :
1. Nouveau bouton de repli sur "Sfx (déclenchables à la main pendant la lecture)" d'un morceau (widget `buildSfxSelectorWidget`), même pattern que les autres blocs (`collapsibleBlockToggleHtml`/`wireCollapsibleBlockToggle`, clé `trackSfx:${ti}`) — replié par défaut même sur un morceau fraîchement créé (convention `expandedAltPoolKeys`, vide = replié).
2. `collapsedSlotIds` et `collapsedSfxIds` ajoutés au bloc d'initialisation de `loadData()` qui peuple déjà les autres Sets avec tous les ids existants — tous les emplacements de tous les morceaux et tous les Sfx de la bibliothèque sont désormais repliés dès l'ouverture du Backstage, au même titre que les morceaux/packs/collections/blocs.

**i18n** : nouvelle clé `viewAttachedSfxBtn` (FR/EN, symétrie vérifiée).

**Tests** : nouveau `test_backstage_default_collapse.js` en deux volets — extraction littérale du bloc de peuplement des Sets (même technique que `test_backstage_custom_cut_fade_roundtrip.js`, pas besoin de mocker tout le flux réseau GitHub) vérifiant que tous les emplacements/Sfx sont bien repliés après chargement ; test UI en direct du nouveau bouton sur un morceau créé dans la session (présent, replié par défaut, bascule au clic). Suites Backstage concernées relancées — toutes vertes.

---

## [2026-08-15] — Message d'aide sur l'ordre des emplacements, nuancé en présence d'embranchements

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : Jules-Antoine signale que le message "L'ordre ci-dessous est celui de la chaîne de lecture [...] Une fois le dernier atteint, ça reboucle sur le premier" n'est vrai que pour un séquentiel SANS embranchement — dès qu'un embranchement existe, la lecture réelle peut dévier de cet ordre selon les choix du visiteur, et prétendre que "l'ordre" détermine la lecture devient trompeur.

**Changement** : message conditionnel selon `(track.segmentSlots || []).some(sl => sl.nextOptions && sl.nextOptions.length)`. Sans embranchement : texte original inchangé. Avec au moins un embranchement configuré : nouveau texte (`segmentSlotsOrderHintWithBranches`, FR/EN) précisant que l'ordre affiché est l'ordre PAR DÉFAUT (utilisé quand aucun embranchement n'est déclenché), que la lecture réelle peut en dévier, et que le rebouclage s'applique au dernier emplacement de la chaîne "par défaut ou par embranchement".

**Vérifications** : symétrie FR/EN vérifiée programmatiquement (0 écart). Suites Backstage concernées relancées — toutes vertes.

---

## [2026-08-15] — Repli/dépli individuel de chaque emplacement séquentiel

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_slot_collapse.js` (nouveau)

**Contexte** : demande de Jules-Antoine — l'éditeur d'un morceau séquentiel avec plusieurs emplacements (`segmentSlots`) devenait très long à faire défiler ; chaque emplacement doit pouvoir se replier pour ne laisser voir que son titre (comme Intro/Outro depuis le 13/08, ou un morceau entier dans la bibliothèque).

**Changement** : bouton de repli (▾/▸) ajouté dans l'en-tête de chaque emplacement, avant les flèches ↑/↓ — même position/style que celui de la carte morceau. Le corps de l'emplacement (tout sauf l'en-tête : répétitions, source du contenu, tempo propre, texte de présentation, embranchements, alternatives) enveloppé dans un `data-role="slotBody"`, replié via la même classe `list-block-body.collapsed` que partout ailleurs. Contrairement à Intro/Outro, un emplacement fraîchement créé est DÉPLIÉ par défaut (rien ne change pour l'existant tant qu'on n'a pas cliqué) — la demande portait sur la capacité à replier, pas sur un repli automatique.

**État suivi par id, pas par position** : `collapsedSlotIds` (nouveau `Set`, id de l'emplacement) plutôt qu'une clé positionnelle `ti:si` — un emplacement garde son état replié/déplié même après un réordonnancement ↑/↓, puisque sa position (`si`) change à chaque déplacement alors que son identité (`slot.id`) reste stable. Testé explicitement : après avoir replié le premier emplacement puis l'avoir déplacé en seconde position, c'est bien LUI qui reste replié (pas "la seconde position", qui elle affiche l'autre emplacement, désormais en premier, toujours déplié).

**Tests** : nouveau `test_backstage_slot_collapse.js` — création, repli/dépli, persistance du champ titre visible même replié, persistance après réordonnancement (le point ci-dessus) et après un re-rendu complet. `test_backstage_seq_transitions.js`, `test_backstage_intro_outro_collapse_and_reorder.js`, `test_backstage_maxchainloops.js`, `test_backstage_custom_cut_fade_roundtrip.js` relancées — toutes vertes, aucune régression.

---

## [2026-08-15] — Bug de repli visuel (panneau des embranchements) + libellés de section noircis/soulignés

**Fichiers touchés** : `layerpitch-backstage.html`

**Diagnostic** : Jules-Antoine signale que le panneau des embranchements ne se replie plus visuellement. Investigation : bug **préexistant**, confirmé identique sur le fichier d'origine non modifié (avant toute intervention de cette session) — donc pas une régression introduite par le chantier "texte de présentation" de plus tôt dans la journée. La règle CSS qui masque réellement un panneau replié est `.list-block-body.collapsed { display: none; }` — elle exige la classe `list-block-body` EN PLUS de `collapsed`. Le panneau des embranchements (`data-role="branchesBody"`) n'avait que la classe `collapsed` seule : le bouton et le chevron ▸/▾ réagissaient bien au clic (la classe changeait), mais rien ne se masquait jamais puisque la règle CSS ne matchait pas. Les 4 nouveaux blocs "Texte de présentation" ajoutés plus tôt dans la journée (intro/outro/emplacement/transition) reproduisaient exactement le même bug, copié depuis ce même pattern.

**Correctif** : classe `list-block-body` ajoutée aux 5 panneaux concernés (`branchesBody`, `introDescBody`, `outroDescBody`, `slotDescBody`, `transDescBody`).

**Second changement (demande directe, plusieurs itérations)** : les libellés de section ("IDENTITÉ", "TEMPO", "CONTENU", "STRUCTURE"...) passent de gris (`#999`) à noir (`#24262b`). Premier essai — un liseré (`border-bottom`) sous le texte — jugé peu concluant par Jules-Antoine ("ça fait plein de barres, on comprend encore moins", en plus du `border-top` déjà existant entre sections qui produisait un doublon visuel). Remplacé par un badge encadré (`border` + `border-radius:4px` + fond `#f4f4f5`, `display:inline-block`) à la suggestion de Jules-Antoine. Deux ajustements suite à retour visuel : texte recentré horizontalement (le `letter-spacing` ajoute de l'espace après la DERNIÈRE lettre aussi, décalant visuellement le texte vers la gauche dans un cadre — compensé par un `padding-right` réduit d'autant) ; centrage vertical fiabilisé via `display:inline-flex; align-items:center; line-height:1` plutôt qu'un simple padding symétrique (sensible aux métriques de la police). Marge au-dessus du tout premier badge d'une carte morceau ("IDENTITÉ") : une tentative intermédiaire ratée avait ANNULÉ la marge au lieu de l'augmenter (bug de ma part, corrigé) — la valeur finale retenue est la marge standard de 20px, comme tous les autres badges, sauf dans la barre latérale (`.backstage-sidebar > .nav-section-label:first-child`) où elle reste à 0, le badge y étant vraiment tout en haut sans rien au-dessus. Cette classe (`.nav-section-label`) est partagée avec les libellés de section de la barre latérale gauche ("COMPTE", "SITE (ADREEL)"), qui en bénéficient donc aussi — confirmé explicitement avec Jules-Antoine avant modification, puisque ça touchait plus large que la demande initiale.

**Troisième changement (omis du changelog sur le moment, rattrapé ici)** : `.page { max-width: 760px; margin: 0 auto; }` → `max-width: min(1400px, 92vw)`. Jules-Antoine signale un espace vide important sur un grand écran (largeur fixe à 760px, très étroite face à une fenêtre >1900px). Le contenu occupe désormais jusqu'à 92% de la largeur de la fenêtre, plafonné à 1400px pour éviter des lignes de texte/formulaire démesurément longues sur un très grand écran. `.row` (disposition en colonnes flexibles) s'adapte sans effet de bord à ce surcroît d'espace.

**Vérifications menées** : `test_backstage_branch_collapse_and_header_order.js` — le check "le panneau est réellement masqué visuellement" passe désormais (échouait avant, y compris sur le fichier d'origine). Un second échec dans cette même suite (ordre des boutons de l'en-tête de carte morceau) reste préexistant et sans rapport avec ce correctif — non traité, pas signalé par Jules-Antoine. `test_backstage_seq_transitions.js`, `test_backstage_intro_outro_collapse_and_reorder.js`, `test_backstage_maxchainloops.js`, `test_backstage_custom_cut_fade_roundtrip.js` relancées — toutes vertes, aucune régression.

**Note pour plus tard** : le même piège (`collapsed` seul, sans `list-block-body`) pourrait exister ailleurs dans le fichier — pas d'audit systématique fait sur ce point précis, seulement les 5 panneaux directement concernés cette session.

---

## [2026-08-15] — Texte de présentation optionnel par emplacement/intro/outro/transition (séquentiel)

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `test_seq_stage_description.js` (nouveau), `test_backstage_custom_cut_fade_roundtrip.js`

**Contexte** : demande de Jules-Antoine — chaque élément qui devient audible en mode séquentiel (un emplacement, l'intro, l'outro, un fichier de transition) peut porter un texte de présentation optionnel, affiché à la place de la description du morceau pendant qu'il joue. Architecture discutée en profondeur avant tout code : bilingue dès maintenant (`descriptionFr`/`descriptionEn`, pattern classique de l'existant) plutôt qu'un système de langues généralisé anticipé — jugé prématuré tant qu'aucune demande concrète au-delà de FR/EN ne s'est manifestée (piste notée dans `extensions-roadmap.md` pour plus tard). Portée précisée par un exemple concret de Jules-Antoine (Intro → WetDarkCave → transition "Secret Lever" → Corridor → Battle) : le texte suit les étapes RÉELLEMENT audibles (pas le clic du visiteur), et un champ vide ne doit JAMAIS écraser le texte précédemment affiché (attention explicite portée au cas d'une intro sans texte propre, qui doit laisser voir la description du morceau jusqu'au premier élément qui en a un — obtenu gratuitement par cette règle, sans cas particulier à coder).

**Schéma retenu** : `descriptionFr`/`descriptionEn` (chaînes optionnelles, `''`/absent = ne redéfinit rien) sur `segmentSlots[]`, `track.intro`, `track.outro`, et `nextOptions[].transition`.

**Incrément 1 — `player.js` (moteur)** : `pickStageDescription(obj)` (résolution bilingue, même pattern que `pickSfxDescription`, mais sans repli sur un ancien champ unique — nouveau champ, aucune migration à gérer). Un champ `desc` transite désormais dans toute la chaîne de programmation séquentielle (`decideNextSeqBlock()` → `forcedNextBlock` → `scheduleSeqGeneration()` → `scheduleSeqLabelUpdate()`), mis à jour au même instant que le libellé affiché (`seqCurrentEl`). Nouvel élément `data-role="trackDesc"` sur le conteneur de description (`.track-desc`), référencé une fois par lecteur (`trackDescEl`). Un texte vide ne touche jamais à `trackDescEl` — c'est cette règle, et non un repli explicite vers `track.description`, qui gère le cas "intro sans texte" demandé. Un vrai arrêt (`stopSequential()`) réinitialise vers `track.description` ; un `seek` (qui appelle `stopSequential()` en interne) capture et restaure le texte affiché avant/après — exactement le même piège que celui déjà rencontré et corrigé pour le libellé le 13/08, corrigé ici de la même manière.

**Incrément 2 — `layerpitch-backstage.html`** : bloc "Texte de présentation (facultatif)" repliable (réutilise le pattern générique existant `collapsibleBlockToggleHtml`/`wireCollapsibleBlockToggle`, replié par défaut — consigne explicite de Jules-Antoine de ne jamais surcharger l'UI en ajoutant une fonctionnalité) sur les 4 emplacements concernés : éditeur d'emplacement (`segmentSlots`), intro, outro, et éditeur de transition (imbriqué dans le panneau déjà repliable des embranchements). Les 3 points de sérialisation (aperçu, chargement, publication) mis à jour ensemble : `mapBlockWithBars()` porte maintenant `descriptionFr`/`descriptionEn` (partagé par l'intro et, via `mapTransition()`, par la transition), l'outro (qui n'utilise pas `mapBlockWithBars`, pas de notion de `bars`) et les `segmentSlots` mis à jour séparément aux 3 points.

**Piège rencontré en cours de route** : première version des nouveaux `<textarea>` utilisant `escapeHtml()`, qui n'existe QUE dans `player.js` (fonction interne à son IIFE, non exposée globalement) — `layerpitch-backstage.html` n'a que `escapeAttr()` (échappement de guillemets pour les attributs `value="..."`, pas pour du contenu de `<textarea>`). Corrigé en s'alignant sur le pattern déjà utilisé partout ailleurs pour les `<textarea>` de ce fichier (`description`, `presentationFr`/`presentationEn` des packs/collections) : interpolation directe, sans échappement — détecté immédiatement par la suite de tests (4 suites Backstage en échec dès le premier lancement après cet incrément), corrigé avant livraison.

**i18n/aide** : nouvelles clés `stageDescriptionToggleLabel`, `stageDescriptionHint`, `stageDescriptionFrLabel`, `stageDescriptionEnLabel` (FR/EN, symétrie vérifiée programmatiquement : 0 écart). Bulle d'aide `stageDescription` ajoutée (FR/EN).

**Tests** : nouveau `test_seq_stage_description.js`, qui reproduit exactement l'exemple donné par Jules-Antoine (Intro sans texte → WetDarkCave → Secret Lever → Corridor → Battle sans texte, plus une vérification de la résolution EN). `test_backstage_custom_cut_fade_roundtrip.js` mis à jour (ses ancres de texte littéral sur la ligne `outro:` ne correspondaient plus après l'ajout des nouveaux champs) et étendu avec des vérifications dédiées au nouveau texte de présentation, dans le même esprit que ce qu'il vérifiait déjà pour `customCutFadeSec`/`bpm`/`beatsPerBar`.

**Vérifications menées** : `node --check` sur tous les fichiers touchés — OK. Symétrie FR/EN vérifiée programmatiquement (0 écart dans les deux sens). 17 suites de tests concernées relancées ensemble après correction du piège `escapeHtml` — toutes vertes, aucune régression restante.

**Pas encore fait** : aucun test d'écoute réel (comme toujours, à valider par Jules-Antoine avant publication).

---

## [2026-08-14] — Durée explicite du fichier de transition avant bascule vers la cible (`durationUnit`)

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `test_seq_transitions.js`, `test_backstage_seq_transitions.js`

**Contexte** : demande de Jules-Antoine — pour un fichier de transition (`nextOptions[].transition`), pouvoir contrôler explicitement l'instant où la cible démarre, plutôt que de dépendre du seul champ `bars` existant (découverte en cours de discussion : ce champ existait déjà, câblé, mais utilisait systématiquement le tempo de l'emplacement SOURCE — aucune option n'existait pour un tempo propre à la transition, ni pour une durée en secondes indépendante de tout tempo). Architecture discutée et validée avant tout code (schéma, sémantique de repli, rétrocompatibilité).

**Schéma retenu** sur `nextOptions[].transition` :
- `durationUnit` (`'bars'` | `'seconds'`, absent = comportement historique inchangé : `blockSeconds(bars, sourceSlot)`, tempo de l'emplacement source).
- `durationUnit: 'bars'` : mesures sur le tempo **propre** à la transition (`bpm`/`beatsPerBar`), avec repli sur le tempo de l'emplacement source puis celui du morceau si non renseignés — utile pour un impact/riser à un tempo différent de l'emplacement qu'on quitte.
- `durationUnit: 'seconds'` : `durationSeconds`, durée brute sans notion de tempo — pour un fichier non quantifié musicalement. Exclusif du mode mesures (sélecteur, pas de repli entre les deux).

**Incrément 1 — `player.js` (moteur)** : `transitionTiming(tr, sourceSlot)` et `transitionDurationSecFor(opt, sourceSlot)` ajoutées, remplacent l'appel direct à `blockSeconds()` dans `performSeqBranchCut()`. Bascule vers le nouveau calcul uniquement si `durationUnit` est explicitement renseigné ; sinon appelle `blockSeconds()` exactement comme avant — zéro risque de régression sur les transitions déjà publiées.

**Incrément 2 — `layerpitch-backstage.html`** : sélecteur d'unité (mesures/secondes) sur chaque embranchement ayant une transition, affiché avec repli visuel `'bars'` par défaut sans rien écrire tant que l'utilisateur ne touche à rien (même convention que `cutStyle`). En mode mesures : champs BPM/temps-par-mesure propres à la transition (placeholder = ce qu'ils hériteraient, càd le tempo de l'emplacement source). En mode secondes : champ durée unique (défaut 1s). Les 3 points de sérialisation (aperçu, chargement, publication) mis à jour ensemble via une nouvelle fonction dédiée `mapTransition()` (distincte de `mapBlockWithBars`, réutilisée par l'intro, qui n'a pas cette notion de durée explicite).

**i18n/aide** : nouvelles clés `transitionDurationUnitLabel/Bars/Seconds`, `transitionDurationSecondsLabel`, `transitionBarsTempoHint` (FR/EN, symétrie vérifiée programmatiquement : 0 écart) ; `bpmLabel`/`beatsPerBarLabel` génériques réutilisés tels quels. Bulle d'aide `transitionDurationUnit` ajoutée (FR/EN) ; `slotBpmOverride` mise à jour pour ne plus affirmer que le fichier de transition suit systématiquement le tempo de l'emplacement source (ce n'est plus vrai en mode mesures avec tempo propre).

**Tests** : 2 nouveaux scénarios dans `test_seq_transitions.js` (mode `seconds`, durée indépendante du tempo source à 300 BPM ; mode `bars` avec tempo propre à 60 BPM très différent du tempo source, confirmant que le calcul utilise bien le tempo de la transition et non celui de l'emplacement quitté) — non-régression du scénario existant (transition sans `durationUnit`) confirmée. 6 nouveaux checks dans `test_backstage_seq_transitions.js` (apparition/disparition conditionnelle des champs selon l'unité choisie, valeurs par défaut, persistance après re-rendu y compris un aller-retour par le mode secondes).

**Vérifications menées** : `node --check` sur tous les fichiers touchés — OK. Symétrie FR/EN vérifiée programmatiquement (0 écart dans les deux sens). Les 5 suites de tests concernées (`test_seq_transitions.js`, `test_seq_branching.js`, `test_embr_vertical_engine.js`, `test_backstage_seq_transitions.js`, `test_seq_custom_cut_fade.js`) toutes vertes ensemble, aucune régression.

**Pas encore fait** : aucun test d'écoute réel (comme toujours, à valider par Jules-Antoine avant publication).

---

## [2026-08-13] — Passe de relecture/nettoyage sur tout le code de la session

**Fichiers touchés** : `player.js`, `test_seq_custom_cut_fade.js`, `backstage.css`

**Contexte** : demande explicite de Jules-Antoine de repasser sur tout le code produit cette session (vérifier, nettoyer, corriger, optimiser) avant de clore. Vérifications systématiques menées :
- Cohérence des 3 points fonctionnels de sérialisation `segmentSlots` (aperçu/publication/chargement) — comparaison automatisée des champs `bpm`/`beatsPerBar`/`customCutFadeSec`/`quantization`/`cutStyle`/`referencesSlotId`/`repeatCount` entre les trois : tous alignés, aucun oubli.
- Symétrie FR/EN complète de `layerpitch-i18n.js` et `layerpitch-help.js` (pas seulement les clés ajoutées cette session) : 0 clé orpheline dans les deux sens.
- Toutes les clés `tr()`/`t()` utilisées dans `player.js`/`layerpitch-backstage.html` existent bien dans le dictionnaire (1 faux positif du script de vérification, une clé construite dynamiquement, préexistante).
- Tous les blocs repliables (`.collapsed`) du backstage vérifiés un par un : aucun autre n'a le bug de classe CSS incomplète découvert plus tôt sur les embranchements (Intro/Outro/branches/pools/sfx/etc. — tous corrects).
- Cohérence des 4 fichiers portant le CSS du slider de volume (`index.html`, `pack.html`, `layerpitch-backstage.html`, `backstage.css`) — identiques.
- Absence de `console.log`/`debugger` oubliés.

**Deux bugs réels trouvés et corrigés** :
1. **`player.js`** — dans `performSeqBranchCut`, `sourceSlot.customCutFadeSec || 0.15` traitait un fondu personnalisé explicitement réglé à **0 seconde** (coupure instantanée voulue) comme une valeur absente, et retombait sur 0.15s au lieu de respecter le 0 — piège classique du `||` avec une valeur JS falsy légitime. Corrigé en `!= null`, comme c'était déjà fait partout ailleurs (formulaire backstage, publication, chargement) sauf ici. Nouveau scénario de test dédié (`test_seq_custom_cut_fade.js`) qui aurait détecté ce bug.
2. **`backstage.css`** — la couleur des repères de section (`IDENTITÉ`/`TEMPO`/`CONTENU`/`STRUCTURE`, assombris plus tôt dans la session) n'avait été mise à jour que côté `layerpitch-backstage.html`, pas dans `backstage.css` (le bac à sable local serait resté sur l'ancienne couleur claire). Synchronisé.

**Un vrai reliquat trouvé, non traité (hors scope de cette session)** : `backstage.css` contient des règles CSS orphelines (`.track-section-head`, `.track-section-caret`, `.track-section-body.collapsed`) commentées "demandé par Jules-Antoine le 10/08" pour rendre repliables les sections IDENTITÉ/TEMPO/CONTENU/STRUCTURE d'une carte de morceau — mais **aucun JS ni HTML correspondant n'existe nulle part**, ni dans `layerpitch-backstage.html` ni dans `backstage.css` lui-même : du CSS mort, une fonctionnalité apparemment jamais terminée ou perdue en route. Ni implémenté ni supprimé pour l'instant (implémenter serait une nouvelle fonctionnalité hors du cadre "nettoyer l'existant" de cette passe ; supprimer serait présomptueux si le besoin est toujours d'actualité) — signalé ici pour une prochaine session si le besoin est confirmé.

**Vérification** : `node --check` sur les trois fichiers JS — OK. Comparaison automatisée ligne à ligne de `backstage.css` contre le bloc `<style>` de `layerpitch-backstage.html` (hors le reliquat mentionné ci-dessus, plus aucune divergence). Les 20 suites de tests existantes relancées intégralement après chaque correctif — toutes vertes.

---

## [2026-08-13] — Détection du BPM et des mesures dans le nom de fichier au dépôt

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_slot_autolabel.js`, `test_backstage_filename_bpm_bars_detection.js` (nouveau)

**Contexte** : Jules-Antoine utilise une nomenclature de fichiers systématique (`#3_RobotAdventure_BattleFinal_160bpm_40M.wav`) et demande que le dépôt groupé en tienne compte pour pré-remplir le tempo et le nombre de mesures, plutôt que de tout ressaisir à la main. Ceci explique probablement le bug "l'embranchement ne boucle pas au nombre de mesures indiqué" signalé juste avant dans la session : le tempo par emplacement (fonctionnalité plus tôt le 13/08) doit être saisi manuellement, sans détection automatique — un emplacement dont le BPM n'a jamais été renseigné retombe silencieusement sur le tempo du morceau, ce qui expliquerait un écart si la valeur du nom de fichier n'a jamais été reportée dans le champ.

**Changement** :
- Nouvelle fonction `parseAudioFilenameHints(filename)` : détecte un BPM (`\d+bpm`) et un nombre de mesures (`\d+M`), chacun bordé par un séparateur (espace/underscore) ou une extrémité de nom, pour éviter un faux positif du genre "Room40Meters" (pas de séparateur entre "40M" et "eters" → pas de détection).
- `titleFromFilename()` retire désormais ces jetons du libellé généré automatiquement (redondants avec les champs structurés qu'ils viennent remplir) — ex. `#3_RobotAdventure_BattleFinal_160bpm_40M.wav` → libellé "`#3 RobotAdventure BattleFinal`", BPM et mesures dans leurs champs respectifs.
- Branché sur les créations de contenu par dépôt : nouvel emplacement (BPM sur l'emplacement + mesures sur son alternative) dans les deux points de création par lot (dépôt direct sur "Emplacements", dépôt global avec devinette de rôle) ; mesures seules (le BPM d'un emplacement déjà existant n'est jamais réécrit par un dépôt d'alternative supplémentaire) sur l'ajout d'alternatives à un emplacement existant ; mesures sur l'intro si détectées dans le dépôt global.
- `test_backstage_slot_autolabel.js` : assertion mise à jour (le libellé ne garde plus "120bpm", volontairement retiré désormais).

**Vérification** : `test_backstage_filename_bpm_bars_detection.js` (nouveau) — reprend l'exemple exact de sa capture d'écran (3 segments + 1 fichier de transition sans jeton) : `parseAudioFilenameHints` testée isolément (extraction correcte + deux cas de non-faux-positif), puis dépôt réel sur la zone "Emplacements" vérifiant que les 3 champs BPM, les 3 champs mesures et les 3 libellés nettoyés sont tous corrects. Les 19 autres suites relancées intégralement — toutes vertes.

---

## [2026-08-13] — Bug : la musique redémarre de zéro en revenant sur l'onglet (séquentiel + vertical-random)

**Fichiers touchés** : `player.js`, `test_visibility_resume.js` (nouveau)

**Contexte** : Jules-Antoine signale qu'en changeant d'onglet (musique en cours) puis en revenant sur celui de l'AdReel, la musique repart de zéro — en séquentiel et en vertical-random, mais pas en vertical classique. Diagnostic : le gestionnaire `visibilitychange` générique arrêtait tout puis relançait la chaîne via `playThisTrack(false, true)` — `isContinuation=true` préserve bien la position dans la CHAÎNE (`currentSlotIndex`/le cycle de sections en cours), mais ni `playSequential` ni `playVerticalRandom` ne tiennent compte d'un `offsetAt` : le bloc ou la section qui ÉTAIT en train de jouer au moment du passage en arrière-plan est purement abandonné, remplacé par un tout nouveau tirage qui, lui, repart de SA propre position 0 — perçu comme "ça repart de zéro". Le vertical classique n'est pas concerné : `playQuantized`/`playSimple` respectent déjà `offsetAt` correctement.

**Changement** : le gestionnaire `visibilitychange` réutilise maintenant, pour ces deux modes, les mêmes primitives de recherche (seek) déjà éprouvées pour le glissement manuel sur la waveform — `seekSequential(ctx.currentTime - currentSeqBlockInfo.virtualZero)` et `seekVerticalRandom(fraction calculée comme dans tick())` — qui rejouent précisément le bloc/section EN COURS à sa position réelle plutôt que d'en tirer un nouveau. Les autres modes (vertical classique, embranchement-vertical) ne sont pas touchés, leur chemin de reprise générique existant fonctionnait déjà correctement.

**Bug additionnel trouvé au passage** (préexistant, pas introduit par cette session) : dans `seekSequential`, le libellé du segment affiché était capturé *après* l'arrêt interne (`stopSequential()`), qui l'avait déjà remis à "—" — l'audio rejouait bien le bon segment à la bonne position, mais l'étiquette affichée retombait à "—" au lieu de son nom. Concernait donc aussi tout seek manuel sur la waveform, pas seulement la nouvelle reprise après changement d'onglet. Capture du libellé déplacée avant l'arrêt.

**Vérification** : `test_visibility_resume.js` (nouveau) simule un passage en arrière-plan puis un retour (`document.visibilityState` + événement `visibilitychange`) pendant la lecture d'un segment séquentiel et d'une section vertical-random longs — confirme que le même segment/section reste affiché après le retour (pas de nouveau tirage) et que la lecture continue. A d'abord détecté le bug du libellé "—" avant que je le corrige. Les 17 suites existantes relancées intégralement — toutes vertes.

---

## [2026-08-13] — Repères de section (IDENTITÉ, TEMPO, CONTENU, STRUCTURE…) assombris

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : Jules-Antoine trouve les libellés de section dans l'éditeur de morceau (IDENTITÉ, TEMPO, CONTENU, STRUCTURE) trop clairs (#999) pour bien se repérer visuellement.

**Changement** : couleur de `.nav-section-label` passée de `#999` à `#222`, déjà utilisé ailleurs dans le backstage comme couleur de texte principale (titres de modales) — réutilisation plutôt qu'une nouvelle teinte inventée. Cette classe est partagée par `sectionEyebrow()` (IDENTITÉ/TEMPO/CONTENU/STRUCTURE dans les cartes de morceau) et par la navigation latérale, donc les deux en bénéficient.

**Vérification** : changement CSS pur, pas de logique touchée. `node --check` sur `player.js` — OK. Quelques suites backstage relancées à titre de contrôle de non-régression général — toutes vertes.

---

## [2026-08-13] — Bug : repli des embranchements sans effet visuel (classe CSS incomplète)

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_branch_collapse_and_header_order.js`

**Contexte** : Jules-Antoine signale que le bouton de repli des embranchements (ajouté plus tôt dans la session) ne fonctionne pas — la flèche change d'état au clic, mais rien ne se replie visuellement. Diagnostic : la règle CSS qui masque un bloc replié est un sélecteur composé, `.list-block-body.collapsed { display: none; }` (jamais `.collapsed` seule) — Intro/Outro avaient bien la classe de base `list-block-body` en plus de `collapsed`, mais le corps du panneau d'embranchements (`branchesBody`, ajouté juste après) ne portait QUE `collapsed`, sans `list-block-body`. Le JS posait donc la classe correctement (`classList.toggle('collapsed')` fonctionnait, d'où la flèche qui changeait), mais aucune règle CSS ne matchait une classe `collapsed` isolée : rien ne se masquait. Mon test précédent ne l'avait pas attrapé car il vérifiait la présence de la classe, pas le rendu visuel réel.

**Changement** : classe de base `list-block-body` ajoutée au corps repliable du panneau d'embranchements, même schéma exact qu'Intro/Outro.

**Vérification** : `test_backstage_branch_collapse_and_header_order.js` renforcé pour vérifier le **rendu réel** (`getComputedStyle(...).display === 'none'`) plutôt que la seule présence de la classe CSS — jsdom résout correctement les sélecteurs composés simples (`.a.b`) via `getComputedStyle`, vérifié séparément avant de fiabiliser le test dessus. Contre-preuve : le test réintroduit temporairement le bug d'origine dans une copie et confirme qu'il est bien détecté (échec), puis repasse entièrement au vert sur le fichier corrigé. Les 17 autres suites relancées intégralement — toutes vertes.

---

## [2026-08-13] — "Aller vers la fin" masqué sans outro, repli des embranchements, ordre de l'en-tête

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `test_seq_no_outro_goto_end.js` (nouveau), `test_backstage_branch_collapse_and_header_order.js` (nouveau)

**Contexte** : trois demandes de Jules-Antoine.
1. En séquentiel (lecteur public), le bouton "Aller vers la fin" restait affiché même sans outro déclarée (avec un texte de repli "fin après le segment en cours") — jugé inutile/déroutant sans véritable outro.
2. Le panneau de réglages des embranchements (quantification, style de coupure, durée personnalisée, liste des options) n'était pas repliable, contrairement à Intro/Outro (13/08, plus tôt dans la session).
3. Dans l'en-tête de carte de morceau, l'ordre voulu est : bouton replier/déplier, puis le titre, puis Écouter, puis Supprimer, puis les flèches de réorganisation — deux tentatives précédentes incorrectes avant d'arriver au bon ordre.

**Changement** :
- `player.js` : le bouton `goToEndBtn` du mode séquentiel (`seqGraphHtml`) est maintenant masqué (`style="display:none"`) quand `layerHasSource(track.outro)` est faux — reste dans le DOM (pas retiré) pour que tout le code existant qui le référence (`goToEndBtn.disabled = ...`, `.textContent = ...`) continue de fonctionner sans risque de référence nulle. Le `goToEndBtn` du vertical-random (bloc séparé, `voiceGraphHtml`) n'est pas concerné — demande limitée au séquentiel.
- `layerpitch-backstage.html` : panneau "embranchements" enveloppé dans le même mécanisme générique que Intro/Outro (`collapsibleBlockToggleHtml`/`wireCollapsibleBlockToggle`, clé `branches:${ti}:${si}`) — mais avec un dépli automatique dès l'activation de la case "Prévoir des embranchements" (sinon le panneau disparaîtrait juste après l'avoir coché, déroutant), replié par défaut aux rendus suivants.
- `layerpitch-backstage.html` : en-tête de carte de morceau réordonné en un seul groupe linéaire (les deux `<div>` séparés — actions à gauche, Écouter/Supprimer à droite — fusionnés en un seul) — `[toggle▾][titre][Écouter][Supprimer][↑][↓]`.
- `layerpitch-i18n.js` (zone `backstage`, fr/en) : nouvelle clé `branchOptionsToggleLabel`.

**Vérification** : `test_seq_no_outro_goto_end.js` (nouveau) — bouton masqué sans outro, visible avec (non-régression). `test_backstage_branch_collapse_and_header_order.js` (nouveau) — panneau absent avant activation, déplié juste après, repli au clic, état persistant après re-rendu, champs toujours fonctionnels une fois redéplié, et ordre exact des boutons d'en-tête. Les 16 suites existantes relancées intégralement — toutes vertes.

---

## [2026-08-13] — Bug : durées de fondu personnalisées perdues à la publication

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_custom_cut_fade_roundtrip.js` (nouveau)

**Contexte** : Jules-Antoine signale que les durées de fondu personnalisées (`cutStyle: 'custom'`, ajouté plus tôt dans la session) ne fonctionnent pas. Diagnostic : `customCutFadeSec` avait bien été ajouté au formulaire et à l'aperçu local (`buildPreviewTrack`), mais **pas** aux deux autres endroits où `segmentSlots` est sérialisé — la vraie fonction de publication (`data.json`, autour de la ligne 5619) et la fonction de chargement d'un morceau déjà publié dans l'éditeur (autour de la ligne 5050). `cutStyle: 'custom'` partait bien en publication, mais `customCutFadeSec` lui-même se perdait en route : le site publié retombait silencieusement sur le fondu par défaut de 0.15s, sans erreur visible. Même trou exact pour le tempo par emplacement (`bpm`/`beatsPerBar`, fonctionnalité antérieure de cette même session) — présent nulle part ailleurs que dans l'aperçu local non plus, donc lui aussi cassé en publication sans que ça ait été signalé.

**Changement** : `customCutFadeSec`, `bpm`, `beatsPerBar` ajoutés aux deux mappings `segmentSlots` manquants (publication et chargement), en plus de celui de l'aperçu déjà corrigé. Trois points de sérialisation au total pour ces champs, désormais tous alignés. `describeSequential()` (texte descriptif généré, ex. pour les notes d'implémentation) corrigé au passage pour ne plus afficher "fondu de 0.15s" sur un emplacement en durée personnalisée.

**Vérification** : `test_backstage_custom_cut_fade_roundtrip.js` (nouveau) extrait directement les deux mappings corrigés du code source (même principe que `test-section-scheduler.js`/`test-slot-chain-advancer.js` pour `player.js` — aucune dépendance réseau/DOM nécessaire) et vérifie que `customCutFadeSec`/`bpm`/`beatsPerBar` survivent à un aller-retour publication et chargement. Les 14 suites existantes relancées intégralement — toutes vertes.

---

## [2026-08-13] — Intro/Outro repliés par défaut (séquentiel) + réorganisation de la bibliothèque

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_intro_outro_collapse_and_reorder.js` (nouveau)

**Contexte** : deux demandes indépendantes de Jules-Antoine.
1. Dans l'éditeur d'un morceau séquentiel, les blocs Intro et Outro étaient toujours entièrement dépliés (label, mesures, sélecteur de rôle, contrôle de fichier) — occupaient de la place même une fois configurés et plus besoin d'y toucher.
2. Aucun moyen de changer l'ordre des morceaux dans la bibliothèque — possible à tous les niveaux inférieurs (sections, emplacements, boucles nommées) mais pas au niveau de la bibliothèque elle-même.

**Changement** :
- Nouveau mécanisme générique `collapsibleBlockToggleHtml()`/`wireCollapsibleBlockToggle()` pour replier un bloc isolé (par opposition à `altPoolToggleHtml`/`wireAltPoolToggle`, déjà existant, qui replie une liste de *variations*) — réutilise la même Map `expandedAltPoolKeys` (clés `intro:${ti}`/`outro:${ti}`, distinctes des clés de pools existantes) plutôt que d'introduire un second Set redondant. Appliqué aux blocs Intro et Outro du mode séquentiel uniquement (pas touché au vertical-random, qui a son propre rendu intro/outro, non concerné par la demande). Repliés par défaut ; l'icône d'aide contextuelle (`data-help`) déplacée du `<label>` d'origine vers le bouton de repli, pour rester accessible même replié.
- Boutons ↑/↓ (`move-track-up`/`move-track-down`) ajoutés dans l'en-tête de chaque carte de morceau, même principe exact que `move-section-up`/`move-slot-up`/`move-embr-loop-up` déjà en place (échange de deux éléments adjacents du tableau `library`, désactivés en butée). Aucun impact sur les AdReels/Packs existants : ils référencent les morceaux par `id`, pas par position dans `library`.

**Vérification** : `test_backstage_intro_outro_collapse_and_reorder.js` (nouveau) — repli par défaut d'Intro et Outro, dépli/repli au clic, champs toujours fonctionnels une fois dépliés (non-régression), et réorganisation de trois morceaux (monter/descendre, boutons désactivés en butée). Les 13 suites existantes relancées intégralement — toutes vertes.

---

## [2026-08-13] — Troisième style de coupure : durée de fondu personnalisée

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `test_seq_custom_cut_fade.js` (nouveau)

**Contexte** : Jules-Antoine signale que le fondu de sortie (0.15s fixe) est trop court quand un fichier de transition est utilisé. Premier essai proposé (fondu automatiquement porté à la moitié de la durée de la transition) — revenu dessus après discussion : préférence pour un contrôle explicite plutôt qu'un auto-calcul. Décision finale : `cutStyle` passe de deux à trois valeurs — `hard` (coupure nette, inchangé), `fade` (fondu court fixe 0.15s, comportement historique inchangé, **pas** d'auto-calcul basé sur une transition), `custom` (nouveau — durée choisie par le compositeur en secondes réelles, via un curseur).

**Changement** :
- `player.js` (`performSeqBranchCut`) : `fadeOutSec = cutStyle === 'custom' ? (sourceSlot.customCutFadeSec || 0.15) : 0.15` — calcul de `opt`/`oi`/`transitionBuf`/`transitionDurationSec` remonté avant le fondu (nécessaire pour construire `forcedNextBlock` un peu plus loin, réutilisé tel quel, aucune duplication).
- `layerpitch-backstage.html` : troisième `<option value="custom">` sur le select `cutStyle` ; nouveau curseur (`<input type="range" min="0" max="8" step="0.05">`, `data-slot-field="customCutFadeSec"`) affiché uniquement quand `custom` est sélectionné, avec la valeur courante affichée à côté (`data-role="customCutFadeValue"`). Handler d'input : le changement de `cutStyle` déclenche un `renderLibrary()` (fait apparaître/disparaître le curseur) ; le curseur lui-même NE déclenche PAS de `renderLibrary()` sur chaque `input` (mise à jour directe du texte à côté à la place) — un re-rendu complet à chaque tick de glissement aurait recréé l'élément et interrompu le drag en cours.
- `layerpitch-backstage.html` (`buildPreviewTrack`) : au passage, deux oublis corrigés dans le mapping `segmentSlots` de l'aperçu "Écouter" — `bpm`/`beatsPerBar` par emplacement (fonctionnalité du 13/08, jamais transmise à l'aperçu jusqu'ici) et `customCutFadeSec` (nouveau). Sans ce correctif, l'aperçu local aurait fonctionné différemment de la version publiée pour ces deux réglages.
- `layerpitch-i18n.js` (zone `backstage`, fr/en) : `cutStyleCustom`, `customCutFadeLabel`.
- `layerpitch-help.js` (zone `library`, fr/en) : `slotCutStyle` mis à jour (mentionne le 3e choix), nouvelle clé `slotCustomCutFade`.

**Vérification** : `node --check` sur les trois fichiers JS — OK. `test_seq_custom_cut_fade.js` (nouveau) instrumente `createGain` pour capturer les appels `linearRampToValueAtTime(0, ...)` et mesure le délai réel : confirme qu'un emplacement `cutStyle: 'custom', customCutFadeSec: 1.5` produit un fondu d'environ 1.5s, et qu'un emplacement `cutStyle: 'fade'` (par défaut) reste à ~0.15s même avec une transition longue (0.8s) déclarée — non-régression explicite de la décision "pas d'auto-calcul". Les 12 suites existantes relancées intégralement — toutes vertes.

---

## [2026-08-13] — Nom d'emplacement séquentiel repris automatiquement du fichier déposé

**Fichiers touchés** : `layerpitch-backstage.html`, `test_backstage_slot_autolabel.js` (nouveau)

**Contexte** : Jules-Antoine signale (capture d'écran à l'appui) que quand un dépôt de fichier crée un nouvel emplacement séquentiel, le champ nom de l'emplacement lui-même (`#1 WetDarkCave` dans son exemple) reste vide — seule l'alternative à l'intérieur héritait du nom du fichier via `titleFromFilename()`. Obligeait à ouvrir "Voir les variations" à chaque fois pour savoir quel fichier avait atterri dans quel emplacement, alors que le texte d'aide (`segmentsDropHint`) promet déjà "le nom repris automatiquement".

**Changement** : trois points de création d'un `segmentSlot` identifiés, tous corrigés (`label: ''` → `label: titleFromFilename(f.name)`, ou `payload.label` quand un nom était déjà connu) :
- Dépôt direct sur la zone "Emplacements" (chaque fichier crée son propre emplacement).
- Dépôt groupé au niveau du morceau, avec devinette intro/segment/outro par nom de fichier (`guessSequentialRole`) — la branche "segment" ne remplissait pas le label de l'emplacement.
- Reclassification de rôle après un tel dépôt (sélecteur intro/segment/outro) — le label déjà connu (`payload.label`) n'était pas repris pour le nouvel emplacement créé.

Le nom reste évidemment modifiable ensuite (aucun champ verrouillé), exactement comme demandé.

**Vérification** : `test_backstage_slot_autolabel.js` (nouveau) simule un dépôt sur la zone "Emplacements" et vérifie que le champ `label` de l'emplacement créé est bien pré-rempli avec le nom du fichier (pas vide). Les 12 suites existantes relancées intégralement — toutes vertes, aucune régression.

---

## [2026-08-13] — Cache-busting : trou trouvé sur layerpitch-i18n.js/layerpitch-help.js, docs/infrastructure.md corrigé

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`, `docs/infrastructure.md`

**Contexte** : Jules-Antoine signale, d'après `docs/infrastructure.md`, un problème de cache non résolu — après publication, les visiteurs peuvent voir une version périmée du site sans vidage manuel du cache, cause probable étant l'absence de cache-busting sur `data.json`. Investigation menée sur les fichiers réellement livrés cette session (le repo GitHub étant en retard sur ces sessions, jamais utilisé comme source de vérité ici) :
- `data.json` : déjà cache-busté avec `?v=' + Date.now()` dans `index.html`/`pack.html`/`collection.html` (`video-test.html` n'en a pas besoin, ne charge pas `data.json`) — donc DÉJÀ résolu, contrairement à ce que dit encore le doc. Cette approche (timestamp de chargement, pas `publishedAt`) évite au passage le problème d'œuf-et-poule que Jules-Antoine anticipait (`publishedAt` ne vivant que dans `data.json` lui-même) : pas besoin d'un `version.json` séparé.
- `player.js` : déjà versionné à chaque publication (`updatePlayerScriptVersion()`, balise `<script>` réécrite avec `?v=<buildVersion>`, même timestamp que `publishedAt`).
- **Trou réel trouvé, jamais traité** : `layerpitch-i18n.js` (chargé par les 5 fichiers publics) et `layerpitch-help.js` (chargé par `collection.html` et le backstage) n'avaient aucun cache-busting — `updatePlayerScriptVersion()` ne touchait que `player.js`. Un visiteur pouvait voir des traductions ou une aide contextuelle périmées jusqu'à 10 min après une publication (TTL GitHub Pages, non configurable, non contournable côté navigateur puisque l'URL ne changeait jamais).

**Changement** :
- `layerpitch-backstage.html` : `updatePlayerScriptVersion()` remplacée par `updateScriptVersions()`, généralisée à une liste `VERSIONED_SCRIPTS = ['player.js', 'layerpitch-i18n.js', 'layerpitch-help.js']` — un seul fetch + une seule écriture par fichier HTML, quel que soit le nombre de balises concernées réellement présentes dans ce fichier (ex. `video-test.html` n'a que `layerpitch-i18n.js`). `video-test.html` ajouté à la liste des fichiers mis à jour dans `publishAll()` (chargeait déjà `layerpitch-i18n.js` sans jamais être touché par la version précédente de la fonction).
- `layerpitch-i18n.js` (zone `backstage`, fr/en) : clés `fileNotFoundVersionUpdate`, `scriptTagNotFound`, `versionUpdatedLog`, `updatingPlayerVersion` reformulées pour ne plus mentionner que `player.js` spécifiquement.
- `docs/infrastructure.md` : paragraphe cache corrigé pour refléter l'état réel (résolu, avec le détail de ce qui est déjà en place et le seul résiduel restant : le TTL de 10 min de GitHub Pages sur l'URL canonique de la page HTML elle-même, sans conséquence sur le contenu affiché puisque piloté par `data.json` toujours frais, auto-résolutif). Entrée ajoutée au journal des décisions d'infrastructure.

**Vérification** : `node --check` sur `layerpitch-i18n.js` — OK. Logique de `updateScriptVersions()` testée hors-ligne (regex extraite et rejouée sur 4 cas : première publication d'`index.html`, republication — pas de doublon de `?v=` —, `video-test.html` avec un seul script, `collection.html` avec les trois) — comportement correct dans les 4 cas. Les 11 suites de tests existantes + `test_seq_slot_tempo.js` relancées intégralement (aucune ne couvre `publishAll`/la publication GitHub, mais confirment l'absence de régression sur le reste du backstage et du moteur) — toutes vertes.

---

## [2026-08-13] — Slider de volume par voix (vertical classique + vertical-random)

**Fichiers touchés** : `player.js`, `layerpitch-i18n.js`, `index.html`, `pack.html`, `layerpitch-backstage.html`

**Contexte** : demande de Jules-Antoine — ajouter un réglage de volume continu par couche sur la page publique, en plus du Solo/Muet déjà existant dans le mixer (`vertGraph` pour le vertical classique, `voiceGraph` pour le vertical-random). Portée et comportement validés avec lui avant codage : les deux modes sont concernés ; en vertical-random, une position de pool peut tirer un slot vide (silence) à un cycle donné — le nœud correspondant (déjà masqué entièrement dans ce cas via `display:none`) embarque désormais le slider, qui se cache/réapparaît avec lui sans logique supplémentaire, la valeur réglée restant en mémoire pour le prochain tirage audible de cette position. Réglage volontairement non persisté (comme Solo/Muet), et démarrant à 100% (= volume du fichier source, rien d'atténué par défaut).

**Changement** :
- `player.js` : nouvelle `Map` `layerVolumes` (clé `layer-i` / `pool-i` → 0–1.5, défaut 1) à côté de `mutedVoices`/`soloedVoices`, même durée de vie (en mémoire, jamais persisté). `voiceGain(key)` multiplie désormais son résultat solo/muet par `getLayerVolume(key)` — un seul point de changement, tous les usages existants du gain (`refreshVoiceGains`, moteur simple, `playSimple`, `scheduleGeneration` quantifié, `scheduleSectionGeneration` vertical-random, ramp d'intensité sur clic des puces) en héritent automatiquement sans modification.
- `player.js` : nouveau `<input type="range">` (`voice-volume-slider`, min 0 / max 1.5 / step 0.01 / défaut 1) + valeur en % affichée à côté, ajouté dans `vertGraphHtml` (une ligne par couche, sous la ligne label/vumètre/S/M existante) et dans les `poolNodes` de `voiceGraphHtml` (sous la ligne du haut, au-dessus de la forme d'onde). Écouteurs `input` (retour audio + visuel immédiat, appelle `refreshVoiceGains()`) et `change` (tracking Umami `voice_volume_change` une seule fois à la valeur finale relâchée, pas à chaque pas du curseur) posés juste après ceux des boutons Solo/Muet.
- `layerpitch-i18n.js` : nouvelle clé `volumeTitle` (« Volume » / « Volume ») dans la zone `player`, fr et en, pour le `title`/`aria-label` du slider.
- `index.html`, `pack.html`, `layerpitch-backstage.html` : nouvelles règles CSS `.voice-row-wrap`, `.voice-volume-row` et `.voice-volume-value` (slider fin, thumb rond, couleur `--accent`, cohérent avec le reste du mixer), ajoutées à l'identique dans les trois fichiers juste après `.voice-ctrl-btn[data-voice-action="mute"].active`. Le slider s'aligne sous le vumètre en vertical classique (`padding-left: 138px`, largeur du label + l'espacement) ; en vertical-random, il occupe toute la largeur de la carte de pool (`padding-left: 0`).

**⚠️ Rappel de synchronisation** : `backstage.css` (feuille partagée du bac à sable local, non uploadée cette session) doit recevoir le même bloc CSS que `layerpitch-backstage.html` ci-dessus, sans quoi l'aperçu "Écouter" du bac à sable divergerait visuellement de la production.

**Vérification** : `node --check` sur `player.js` et `layerpitch-i18n.js` — OK. Symétrie FR/EN de la nouvelle clé `volumeTitle` vérifiée programmatiquement. Les 4 suites de tests jsdom existantes (`test_seq_transitions.js`, `test_seq_branching.js`, `test_embr_vertical_engine.js`, `test_backstage_seq_transitions.js`) n'ont pas été relancées cette session — fichiers de test non fournis dans les uploads ; aucune n'inspecte le mixer de voix (solo/muet/volume) donc risque de régression faible, mais à relancer côté Jules-Antoine avant publication.

---

## [2026-08-06] — Renommage "embranchement vertical" → "vertical à embranchement" + libellé dynamique pour le mode séquentiel

**Fichiers touchés** : `player.js`, `layerpitch-i18n.js`

**Contexte** : demande de Jules-Antoine — renommer le mode `embranchement-vertical` en "vertical à embranchement" (s'insère naturellement dans la même famille de libellés que "vertical additif" et "vertical randomisé"), et faire apparaître la possibilité d'embranchement dans le nom du mode séquentiel. Question ouverte tranchée avec lui : le mode séquentiel n'a l'embranchement que comme fonctionnalité optionnelle par emplacement (`nextOptions`), contrairement à l'embranchement-vertical où la bascule entre boucles nommées est la nature même du mode — un renommage statique aurait donc été trompeur pour un morceau séquentiel purement linéaire. Approche dynamique retenue : le badge affiché n'inclut "à embranchement" que pour les morceaux qui en ont réellement au moins un configuré.

**Changement** :
- `player.js` : `getModeLabel(mode)` devient `getModeLabel(mode, track)`. Pour `sequential`, vérifie si au moins un `segmentSlots[].nextOptions` est configuré (non vide) ; retourne alors `t('modeSequentialBranching')` au lieu de `t('modeSequential')`. Seul appelant existant (`buildTrackRow`, badge `.mode-tag` sur la page publique) mis à jour pour passer `track`.
- `layerpitch-i18n.js` (zones `player`, fr/en) : nouvelle clé `modeSequentialBranching` (« séquentiel à embranchement » / « branching sequential »). `modeEmbranchementVertical` fr renommé « embranchement vertical » → « vertical à embranchement » (l'anglais « vertical branching » restait déjà cohérent avec le nouvel ordre, inchangé).
- `layerpitch-i18n.js` (zone `backstage`, fr) : `modeOptionEmbranchementVertical` renommé en cohérence dans le sélecteur de mode du Backstage (« Embranchement vertical » → « Vertical à embranchement »). Le sélecteur `Séquentiel` reste volontairement statique — il précède la configuration du contenu, donc aucune information sur d'éventuels embranchements n'est disponible à ce stade.

**Vérification** : `node --check` sur les deux fichiers ; les 4 suites de tests existantes relancées sans modification (`test_seq_transitions.js`, `test_seq_branching.js`, `test_embr_vertical_engine.js`, `test_backstage_seq_transitions.js`) — 39/39 assertions passées, aucune régression (aucune n'inspecte le texte du badge de mode). Test manuel ad hoc confirmant les trois cas : séquentiel sans embranchement → "séquentiel", séquentiel avec au moins un embranchement → "séquentiel à embranchement", embranchement-vertical → "vertical à embranchement".

---

## [2026-08-06] — Backstage : panneaux visuels pour embranchements et pools d'alternatives

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : retour visuel de Jules-Antoine — dans l'éditeur d'un emplacement séquentiel ou d'un pool (vertical-random, alternatives séquentielles, variations Sfx), la section embranchements et la liste d'alternatives se fondaient visuellement dans la carte `.list-block` parente, sans repère pour les distinguer du reste du formulaire. Repris depuis la feuille de style partagée du bac à sable local (extraite du `<style>` de ce même fichier, qui avait déjà reçu ce correctif) — le principe du projet étant que ce fichier partagé fait foi et que le backstage en ligne doit suivre, jamais l'inverse.

**Changement** :
- Deux nouvelles règles CSS ajoutées au `<style>` de `layerpitch-backstage.html`, juste après `.list-block-head` (même emplacement que dans la feuille partagée) :
  - `.branch-options-panel` — liseré bleu (`var(--accent)`, la même couleur déjà associée au choix/à l'interactif via le retour visuel du glisser-déposer), fond `#f1f8fd`. Pour les embranchements, qui sont un choix laissé au visiteur.
  - `.alt-pool-panel` — liseré neutre (`#d8d8dc`), fond blanc. Pour les pools d'alternatives, qui ne sont pas un choix du visiteur mais du contenu (variations tirées au sort par le moteur).
- Markup : la classe `branch-options-panel` posée sur le conteneur des réglages `quantization`/`cutStyle` + liste d'embranchements d'un emplacement séquentiel (`hasBranches` coché). La classe `alt-pool-panel` ajoutée aux trois corps de pool existants (`data-role="altPoolBody"`) : alternatives d'un pool vertical-random, alternatives d'un emplacement séquentiel, variations round-robin d'un Sfx.
- Aucun changement de structure ni de logique — uniquement l'ajout de classes CSS sur des conteneurs déjà en place.

**Vérification** : `test_backstage_seq_transitions.js` relancé sans modification — 9/9 assertions passées, aucune régression sur la logique des embranchements séquentiels (case à cocher, sélecteurs quantization/cutStyle, fichier de transition).

---

## [2026-08-06] — Fix chevauchement audio à la coupure fine d'un embranchement séquentiel + repli de libellé cassé

**Fichiers touchés** : `player.js`, `layerpitch-i18n.js`

**Contexte** : bug signalé par Jules-Antoine — chevauchement audible entre l'ancien et le nouvel emplacement lors d'une coupure fine d'embranchement séquentiel (`performSeqBranchCut`, voir entrée du 04/08). Repéré en comparant la version corrigée dans le bac à sable local contre la version encore en ligne, qui n'avait pas reçu le fix.

**Diagnostic** : `performSeqBranchCut` n'annulait que la DERNIÈRE génération programmée (`seqNextScheduled`, référence unique). Le scheduler séquentiel programme jusqu'à 1s à l'avance (`seqSchedulerTick`) — un emplacement court pouvait donc empiler plusieurs générations futures (`source.start()` déjà appelé côté Web Audio, pas encore audibles) avant qu'une coupure ne survienne. Seule la plus récente était stoppée ; les autres continuaient de sonner par-dessus la nouvelle destination, Web Audio n'ayant aucun moyen de savoir qu'elles étaient devenues obsolètes tant qu'on ne les arrêtait pas explicitement une par une.

**Changement** :
- `player.js` : `seqNextScheduled` supprimé. Chaque entrée de `seqActiveSources` porte désormais son propre `ctxStartTime` (ajouté dans `scheduleSeqGeneration`). `performSeqBranchCut` filtre et stoppe maintenant TOUTES les générations dont `ctxStartTime > now` (pas encore audibles), pas seulement la dernière — la génération actuellement audible (`ctxStartTime <= now`) n'est jamais concernée, elle s'éteint séparément via son `gainNode`.
- `player.js` : `renderSeqBranchOptions` — un bouton d'embranchement sans `label` explicite ni `targetSlot.label` retombait sur l'id technique brut (`genId()`, illisible). Aligné sur le repli déjà utilisé côté éditeur Backstage : `t('slotFallback', {n})` → "Emplacement N" / "Slot N".
- `layerpitch-i18n.js` : `slotFallback` n'existait que dans la zone `backstage`, jamais consultée par `player.js` (qui ne lit que les zones `player`/`shared`) — sans ce déplacement, le repli ci-dessus aurait affiché la clé brute "slotFallback" au visiteur. Ajoutée à `fr.shared` et `en.shared`.

**Vérification** : `node --check` sur les deux fichiers ; suites Node/jsdom existantes relancées sans modification (`test_seq_transitions.js`, `test_seq_branching.js`, `test_embr_vertical_engine.js`, `test_backstage_seq_transitions.js`) — 39/39 assertions passées, aucune régression. `layerpitch-backstage.html` vérifié non affecté (n'expose ni ne consomme l'état interne modifié).

---

## [2026-08-04] — Embranchement séquentiel : coupure fine à la Wwise (`quantization`/`cutStyle`) + fichiers de transition par paire (`nextOptions[].transition`)

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `architecture.md`, `audio-engine.md`, `test_seq_transitions.js` (nouveau), `test_backstage_seq_transitions.js` (nouveau).

**Contexte** : objectif produit explicite du compositeur — que le passage de Wwise à LayerPitch ne demande aucune retouche de ses fichiers. Le modèle suit donc celui de Wwise : un fichier de transition est propre à une paire précise (source → cible), pas à l'emplacement dans son ensemble, exactement comme un Transition Object. Schéma discuté sur plusieurs allers-retours avant tout code (portée du réglage de quantification, granularité des transitions, comportement par défaut sans fichier, style de coupure) — voir décisions ci-dessous.

**Schéma** — deux nouveaux champs optionnels sur `segmentSlots[]` (`quantization`, `cutStyle`) et un troisième sur chaque entrée de `nextOptions[]` (`transition`) :
- `quantization` (`immediate` / `beat` / `bar`, défaut `bar`) : QUAND la bascule choisie prend effet — s'applique à tous les embranchements sortants de l'emplacement.
- `cutStyle` (`hard` / `fade`, défaut `fade` = 0.15s) : COMMENT l'emplacement source se termine à ce moment-là — même durée de fondu que les autres coupures courtes du morceau (solo/muet, embranchement-vertical).
- `nextOptions[].transition` (optionnel, `{label, bars, file}`) : fichier propre à CET embranchement précis. Absent : bascule directe. Présent : joué juste après la coupure, puis enchaînement classique vers la cible (chevauchement crossfade-tail existant, aucun mécanisme dupliqué).

**Le vrai chantier technique** : le scheduler séquentiel ne réévaluait jusqu'ici le bloc suivant qu'à la fin nominale du bloc en cours — rien ne pouvait l'interrompre en route. Ajout d'une surveillance de frontière fine (`armNextSeqBranchBoundary`) qui, tant qu'aucun choix n'est fait, se réarme frontière après frontière (temps ou mesure) sur l'emplacement actuellement audible ; dès qu'un choix est en attente à une frontière surveillée, `performSeqBranchCut()` coupe (net ou fondu), annule une répétition déjà programmée par le scheduler normal mais pas encore audible (fenêtre de programmation à l'avance d'1s), injecte la transition si elle existe (`forcedNextBlock`, consommée une seule fois par `decideNextSeqBlock`) puis rebascule sur le mécanisme normal pour la suite. `quantization: "immediate"` court-circuite entièrement cette surveillance : la coupure est déclenchée directement au clic. Protection par epoch (`seqBranchEpoch`) contre les chaînes de surveillance héritées d'un passage précédent tournant en double.

**Simplification en cours de route** : `pickNextSegmentSlot()`/`advanceFromSlot()` s'appuyaient sur un avancement automatique à la fin nominale du segment pour les emplacements à embranchements — devenu incohérent avec la coupure fine (qui doit pouvoir intervenir bien avant cette fin). Tranché avec le compositeur : l'avancement automatique n'a plus lieu d'être dès lors que le visiteur peut cliquer pour choisir — un tel emplacement ne quitte donc plus jamais sa position tout seul, `advanceFromSlot()` supprimé (mort), `pickNextSegmentSlot()` simplifié en conséquence.

**Décisions prises en cours de route** (schéma discuté avant code, conformément au protocole) :
- Granularité de `quantization`/`cutStyle` : par emplacement (pas par morceau, pas par embranchement individuel).
- Granularité de `transition` : par embranchement individuel (paire précise), pas par emplacement — c'est le point qui distingue ce chantier d'un simple "fichier de transition partagé".
- Enchaînement transition → cible : chevauchement crossfade-tail classique (comme un enchaînement normal), jamais de coupure nette à cette jonction précise (seulement à la sortie du segment source).
- Sans fichier de transition défini pour un embranchement donné : la quantification (`quantization`) s'applique quand même, juste sans fichier intermédiaire.
- Valeurs par défaut pour les emplacements existants sans ces champs (déjà publiés avant ce chantier) : `quantization: "bar"`, `cutStyle: "fade"` — rétrocompatibilité totale, comportement pratiquement inchangé pour eux (un segment d'une seule mesure, cas le plus courant, voit sa frontière de mesure coïncider avec sa fin naturelle).

**Bug réel trouvé et corrigé en cours de route** : `currentSeqBlockInfo.gain` contenait la valeur numérique du gain (utilisée pour l'affichage), pas le `GainNode` lui-même — `performSeqBranchCut()` plantait en tentant d'y appeler `cancelScheduledValues`. Corrigé en faisant remonter le vrai `GainNode` à travers toute la chaîne (`scheduleSeqGeneration` → `scheduleSeqLabelUpdate` → `activateSeqStage`, nouveau champ dédié `gainNode` dans `currentSeqBlockInfo`, distinct de `gain`).

**Backstage** : sélecteurs `quantization`/`cutStyle` affichés dès que "prévoir un ou plusieurs embranchements" est coché. Case à cocher + éditeur de fichier par embranchement (réutilise `fileCtrlHtml`/`wireFileControl`, même convention que partout ailleurs). Sérialisation complète (aperçu, import/export data.json, upload à la publication, fiche d'implémentation enrichie avec le détail quantification/coupure/transition par embranchement).

**Vérifications menées** : `node --check` sur tous les fichiers touchés — tout passe. Symétrie FR/EN vérifiée programmatiquement sur `layerpitch-i18n.js` (player 48→48, backstage 482→482, shared 8→8) et `layerpitch-help.js` (37→37) — aucun écart. Deux nouveaux tests : `test_seq_transitions.js` (coupure "bar" mi-segment avec transition, confirmée à ~85ms — bien avant les 800ms de fin naturelle du segment de test ; coupure "immediate" quasi instantanée à ~22ms, distincte de "bar") et `test_backstage_seq_transitions.js` (apparition conditionnelle des sélecteurs et du contrôle de fichier, valeurs par défaut, persistance après re-rendu). **Les 11 suites de tests (9 existantes + 2 nouvelles) toutes vertes ensemble, aucune régression.**

**Pas encore fait** : aucun test d'écoute réel (comme toujours, à valider par Jules-Antoine avant publication). Les commentaires de code de cette session référencent parfois "02/08" (date de la discussion de schéma) alors que le code a été livré le 04/08 — sans conséquence fonctionnelle, mentionné ici par souci d'exactitude.

**Passe de nettoyage/débogage supplémentaire (même jour)** — demande explicite de repasser sur le nouveau code avant de considérer le chantier refermé :
- **Bug réel n°1** : une demande "aller vers la fin" déjà en attente (bouton cliqué en premier) écrasait silencieusement un choix d'embranchement précis fait juste après — `decideNextSeqBlock()` routait vers l'outro au lieu de la cible choisie, sans que rien ne prévienne le visiteur que son clic avait été ignoré. Corrigé : un choix de cible précis (plus spécifique) annule maintenant la demande de fin en attente, plutôt que l'inverse.
- **Bug réel n°2, introduit par la correction du bug n°1** : le correctif remettait `goToEndBtn.disabled` à `true` au lieu de `false` (motif "désactiver" copié depuis un autre endroit du fichier sans être adapté au sens inverse voulu ici) — le bouton restait bloqué sur "en cours de fin" alors que la demande venait d'être annulée. Trouvé par le test de non-régression écrit pour le bug n°1 lui-même, corrigé dans la foulée.
- Micro-optimisation : suppression d'un appel `setValueAtTime` redondant dans la coupure nette (`cutStyle: "hard"`) — l'ancienne valeur du gain était ancrée puis immédiatement écrasée par la valeur cible, sans jamais être utilisée entretemps.
- Recherche exhaustive de références résiduelles à l'ancien `advanceFromSlot` (supprimé) : aucune trouvée. Fonctions dupliquées et cohérence `data-role` revérifiées : rien de nouveau par rapport aux passes précédentes.
- Un troisième scénario ajouté à `test_seq_transitions.js` pour figer le bug n°1 (et par ricochet le n°2, trouvé en écrivant ce test) en non-régression : demande "aller vers la fin" suivie d'un choix d'embranchement précis, doit atterrir sur la cible choisie et réinitialiser proprement le bouton.

**Les 11 suites de tests (dont le nouveau scénario) toutes vertes ensemble après ces deux correctifs.**

---



**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `index.html`, `pack.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `test_embr_vertical_engine.js` (nouveau), `test_seq_branching.js` (nouveau). `collection.html` relu, non modifié (voir plus bas).

**Contexte** : schéma discuté et validé avant tout code (architecture puis relecture de `player.js`/`layerpitch-backstage.html` avant implémentation, conformément au protocole habituel). Décision en cours de route : `embranchement-séquentiel`, envisagé un temps comme un mode à part entière, a été abandonné au profit d'une option (`nextOptions`) directement sur le mode `sequential` existant — plus cohérent avec la discipline de réutilisation maximale, la différence n'étant qu'un comportement local sur certains emplacements, pas un moteur différent.

**1. Mode `embranchement-vertical` (nouveau, entièrement inédit)** :
- N boucles nommées et autonomes, calées sur un même BPM/mesures au niveau du morceau. La boucle marquée `isInitial` sert de référence de cycle. Les boucles de même longueur (`bars` égal à la référence) tournent en continu en arrière-plan (silencieuses sauf celle active), verrouillées en phase — bascule entre elles par pure rampe de gain (0.15s, réutilise exactement le mécanisme du solo/muet existant, `refreshVoiceGains`), sans redémarrage audio donc sans décalage.
- Une boucle plus courte que la référence n'est PAS jouée en arrière-plan (pas de verrouillage de phase naturel) : au clic, lecture fraîche en fondu d'entrée, lecture unique, puis retour automatique à la boucle de référence une fois sa durée nominale (en mesures) écoulée. Bouton désactivé pendant ce détour (validé le 31/07 — pas de retrigger possible).
- Nouvelles fonctions dans `player.js` : `scheduleEmbrGeneration`, `embrSchedulerTick`, `refreshEmbrGains`, `playEmbrVertical`, `stopEmbrVertical`, `selectEmbrLoop`. Réutilise `blockSeconds()` du moteur séquentiel (une seule notion de "durée en mesures" dans tout le fichier), pas de moteur parallèle dupliqué.
- Backstage : nouvel éditeur de boucles nommées (label, mesures, radio "boucle de référence", contrôle de fichier, réordonnancement) dans la section Structure, bloc BPM/mesures dédié (sans le choix "simple vs quantifié", sans notion de chaîne — non pertinents ici). Sérialisation complète : aperçu (`buildPreviewTrackObject`), import/export data.json, upload des fichiers à la publication, fiche d'implémentation (`describeEmbrVert`).
- CSS : `.embr-loop-btn` (classe dédiée, volontairement distincte de `.intensity-chip` pour ne pas hériter du sélecteur de niveau d'intensité vertical classique).

**2. `nextOptions` sur `sequential` (option, rétrocompatible)** :
- Nouveau champ optionnel `nextOptions` sur `segmentSlots[]` : liste de `{ targetId, label }`. Absence du champ = comportement strictement inchangé pour tous les morceaux existants (avancement automatique par `advanceChainIndex`).
- Présence du champ : au lieu d'avancer automatiquement, le moteur affiche des boutons nommés (les cibles possibles) et attend un choix explicite du visiteur. Tant qu'aucun choix n'est fait, l'emplacement se rejoue à l'identique (`repeatCount` ignoré — n'a plus de sens dans ce cas, validé le 31/07). Un clic met en file le choix (`pendingNextSegmentId`) ; un second clic sur une autre option écrase le premier (dernier clic gagne, validé le 31/07) ; la bascule effective attend le prochain point de quantification du scheduler séquentiel existant (aucune modification du timing lui-même).
- Nouvelle fonction pure `advanceFromSlot()` dans `player.js`, remplace les deux appels directs à `advanceChainIndex()` dans `pickNextSegmentSlot()`. `slotIdx` propagé à travers toute la chaîne de scheduling (`decideNextSeqBlock` → `scheduleSeqGeneration` → `scheduleSeqLabelUpdate` → `activateSeqStage`) pour que les boutons affichés correspondent toujours à l'emplacement réellement audible. Choix en attente préservé à travers un `seek` (même principe que `goToEndRequested`), réinitialisé à un vrai arrêt.
- Backstage : case à cocher "prévoir un ou plusieurs embranchements" par emplacement, révélant un éditeur de cibles (sélecteur d'emplacement + libellé optionnel, ajout/suppression). Sérialisation complète (aperçu, import/export data.json, fiche d'implémentation avec note explicite sur les embranchements). L'option `branching` (placeholder grisé "à venir" dans le sélecteur de mode) est retirée — devenue obsolète, remplacée par ces deux chantiers concrets.
- CSS : `.seq-branch-options` / `.seq-branch-btn` / `.seq-branch-btn.pending` / `.seq-pending-indicator` ("en attente de bascule").

**Vérifications menées** : syntaxe (`node --check` sur `player.js`, `layerpitch-i18n.js`, `layerpitch-help.js`, et sur le bloc `<script>` extrait de `layerpitch-backstage.html`) — tout passe. Symétrie FR/EN vérifiée programmatiquement sur `layerpitch-i18n.js` (namespaces `player` 47→47, `backstage` 470→470, `shared` 8→8, aucun écart) et sur `layerpitch-help.js` (34→34, aucun écart). Recoupement automatique clés utilisées (`t()`/`tr()` dans `player.js`/`layerpitch-backstage.html`) vs clés définies : aucune clé manquante. Recoupement attributs `data-help` vs clés `layerpitch-help.js` : les 4 nouvelles clés (`bpmMeasuresEmbrVert`, `embrLoopsSection`, `slotHasBranches`, `embrLoopInitial`) correctement appariées (les autres écarts détectés par le script sont préexistants, hors périmètre de cette session). `collection.html` vérifié : ne restitue aucun lecteur de morceau (juste une liste de packs), donc aucun CSS à y ajouter — dossier refermé sans modification.

**Deux nouveaux tests écrits, même infrastructure que les suites existantes (horloge fictive temps réel, pas de faux "tick manuel")** :
- `test_embr_vertical_engine.js` : boutons nommés présents, boucle de référence active par défaut, bascule immédiate entre boucles de même longueur (pas d'attente de quantification), boucle courte désactivée pendant son détour puis retour automatique à la référence.
- `test_seq_branching.js` : aucun avancement automatique tant qu'aucun choix n'est fait (repeatCount ignoré), libellé personnalisé vs repli sur le nom de l'emplacement cible, indicateur "en attente" affiché/masqué au bon moment, dernier clic gagne (B puis C avant bascule → atterrit bien sur C).

**Bug réel trouvé et corrigé par `test_embr_vertical_engine.js`** : le retour automatique à la boucle de référence après un détour (boucle courte) remettait bien le gain audio à 1, mais oubliait d'appeler `updateEmbrButtonsUI()` — le bouton affiché comme "actif" restait figé sur l'ancien état alors que l'audio était déjà revenu à la référence. Corrigé dans `player.js` (callback du `setTimeout` de fin de détour).

**Les 9 suites de tests (7 existantes + 2 nouvelles) toutes vertes, exécutées ensemble sans régression.**

**Passe de nettoyage/débogage supplémentaire (même jour)** — demande explicite de repasser sur le code produit avant de considérer le chantier refermé, même discipline que la passe du 30/07 :
- **Second bug réel trouvé et corrigé** dans le moteur `embranchement-vertical` : interrompre un détour (boucle courte) avant sa fin naturelle — en cliquant sur une autre boucle, ou en arrêtant la lecture — laissait la source audio du détour orpheline (jamais coupée) et son bouton bloqué en désactivé. Cause : la source du détour n'était référencée que dans une fermeture locale, invisible pour `stopEmbrVertical()` ou un second appel à `selectEmbrLoop()`. Corrigé par une fonction dédiée `fadeOutCurrentDetour()`, réutilisée à la fois pour le retour naturel à la référence, l'interruption volontaire par un nouveau choix, et l'arrêt global — un seul chemin de nettoyage au lieu de plusieurs copies partielles.
- Variable morte retirée (`currentBranchSlotIdx`, assignée mais jamais lue).
- Recherche exhaustive de références résiduelles à l'ancien placeholder `branching` : aucune (les 3 occurrences du mot restantes sont des textes anglais légitimes, pas des vestiges).
- Fonctions dupliquées (`decodeAudioDataCompat`, `getVorbisDecoder`, `fractionFromEvent`, `render`, `renderList`) : toutes préexistantes à cette session (confirmé par comparaison avec les fichiers uploadés d'origine), fermetures indépendantes légitimes — aucune introduite ni aggravée ici.
- Cohérence `data-role` (déclarés dans les gabarits vs lus par `querySelector`/`querySelectorAll`) sur `player.js` : aucun écart, y compris pour les nouveaux rôles (`embrLoopPicker`, `seqBranchOptions`, `seqPendingIndicator`).
- Trois nouveaux scénarios ajoutés à `test_embr_vertical_engine.js` pour figer le bug corrigé en non-régression : interruption d'un détour avant sa fin naturelle (bouton réactivé immédiatement, bascule directe vers le nouveau choix), ré-déclenchement de la même boucle après une interruption (état bien nettoyé, pas de blocage permanent), arrêt complet pendant un détour en cours (aucune erreur, tous les boutons réactivés).

**Pas encore fait** : aucun test d'écoute réel (comme toujours, à valider par Jules-Antoine avant publication).

---



## [2026-07-31] — Nombre de boucles généralisé : `maxChainLoops` (chaîne entière), séquentiel + vertical-random

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `test-section-scheduler.js`, `test-slot-chain-advancer.js` (nouveau), `test_backstage_maxchainloops.js` (nouveau), `test_max_chain_loops_e2e.js` (nouveau)

**Contexte** : chantier discuté en fin de session le 30/07, pas encore codé — généraliser l'affichage/réglage du "nombre de boucles" à tous les modes qui peuvent en bénéficier. Nouveau champ partagé `track.maxChainLoops` (nullable, null = illimité) : combien de fois la **chaîne entière** se répète avant transition automatique vers l'outro (ou fin naturelle sans outro) — réglable compositeur (backstage) et visiteur (page publique), indépendant de `section.maxLoops` (par section, vertical-random) et de `track.maxLoops` (moteur quantifié classique, inchangé).

**Incrément 1 — logique pure, testée sans son réel** :
- Vertical-random (`createSectionPlaybackScheduler`) : `advanceOrder()` compte les cycles complets (retour à `orderPos = 0`) et déclenche `goToEndRequested` au seuil — réutilise le mécanisme "aller vers la fin" existant. `options.maxChainLoops` relu à chaque cycle (pas figé à la création) pour supporter un getter live côté appelant. 4 nouveaux scénarios dans `test-section-scheduler.js` (9 à 12), les 8 scénarios existants inchangés.
- Séquentiel : nouvelle fonction pure `advanceChainIndex` (aucune closure, aucune dépendance audio), factorise les deux avancements jusque-là dupliqués dans `pickNextSegmentSlot` (emplacement vide sauté / `repeatCount` épuisé — les deux avancent la chaîne pour la même raison). Compte les cycles, expose `capReached`, consommé par `pickNextSegmentSlot` pour déclencher `goToEndRequested`. Nouveau fichier `test-slot-chain-advancer.js`, 5 scénarios.
- `chainState` (séquentiel) remis à zéro à un vrai redémarrage (pas une reprise), même convention que `currentSlotIndex`.

**Incrément 2 — backstage** :
- **Bug trouvé et corrigé en route** (hors périmètre initial, corrigé sur confirmation) : le bloc "Tempo" affichait encore un sélecteur "moteur de bouclage" (+ BPM/mesures/points de boucle/nombre de boucles par défaut au niveau morceau) pour le **vertical-random** — mort depuis la fusion du 30/07, chaque section ayant désormais son propre tempo. `hasTempoSection` et le ternaire associé excluent maintenant `isVerticalRandom`.
- Nouveau sélecteur `maxChainLoops` : dans le bloc Tempo pour le séquentiel, dans le bloc Structure (à côté de "randomiser l'ordre") pour le vertical-random. Sérialisé partout où `maxLoops` l'était déjà au niveau morceau (aperçu, création par défaut, fiche technique texte + JSON, lecture/écriture `data.json`).
- Nouvelles clés `maxChainLoopsLabel`, `maxChainLoopsHint`, `maxChainLoopsHintVerticalRandom` (i18n) et `maxChainLoops`/`maxChainLoopsVerticalRandom` (help.js, édité directement sur confirmation malgré l'avertissement "jamais à la main" de l'en-tête du fichier — ajout simple, même format que l'existant). Symétrie FR/EN vérifiée programmatiquement (555→557 clés i18n, 77 clés help, 0 écart).
- Nouveau test `test_backstage_maxchainloops.js` : champ mort disparu pour le vertical-random, nouveau champ présent et persistant après re-rendu pour les deux modes, BPM/mesures séquentiel non cassés par le fix.

**Incrément 3 — page publique (`player.js`)** :
- `useQuantizedLoopForUI` restreint au moteur quantifié classique (retrait de `isVerticalRandom`, qui écrivait sans effet dans `track.maxLoops` — mort côté moteur depuis la fusion, confirmé via `useQuantizedLoop` qui l'exclut déjà explicitement).
- Nouveau sélecteur "nombre de cycles avant la fin" (séquentiel + vertical-random), lié à `track.maxChainLoops`, appliqué au vol (mutation directe de `track.maxChainLoops`, lu en direct par `pickNextSegmentSlot` et par un getter passé à `createSectionPlaybackScheduler`).
- Vertical-random : une ligne de petits sélecteurs sous les blocs de section (un par section, affichés en permanence — décision du 31/07), liés à `section.maxLoops`, mutant en place `vrPlayableSectionRefs[j]` (le même objet réellement lu par le scheduler) — aucun effet si la section n'est pas jouable (no-op silencieux).
- Nouveau test de bout en bout `test_max_chain_loops_e2e.js` : arrêt automatique réel sans clic manuel (VR et séquentiel), changement du sélecteur en cours de lecture, mutation live du nombre de boucles par section. Note : un changement en direct ne prend effet qu'après la fenêtre de lookahead du scheduler (jusqu'à ~1s de générations déjà programmées) — comportement préexistant, pas introduit ici, juste rendu visible par ce nouveau test.

**Vérifications menées** : syntaxe (`node --check` + extraction des blocs `<script>` du backstage), symétrie FR/EN programmatique (i18n + help), 7 suites de tests indépendantes toutes vertes (`test-slot-chain-advancer`, `test-section-scheduler`, `test_quantized_loop_engine`, `test_vr_engine`, `test_player_regression`, `test_backstage_maxchainloops`, `test_max_chain_loops_e2e`).

**Pas encore fait** : aucun test d'écoute réel (comme toujours, à valider par Jules-Antoine avant publication).

---

## [2026-07-30] — Passe de relecture/nettoyage sur l'ensemble du chantier du jour

**Fichiers touchés** : `player.js`, `layerpitch-i18n.js`, `test_quantized_loop_engine.js` (nouveau)

**Contexte** : demande explicite de repasser sur tout le code produit dans la journée (fusion des modes, moteur de lecture, barre de progression par section) avant de considérer le chantier refermé — même discipline de vérification exhaustive qu'après tout changement majeur (syntaxe, symétrie FR/EN, clés orphelines, fonctions dupliquées, cohérence des références DOM).

**Vérifications menées** :
- Symétrie FR/EN complète sur les ~540 clés de `layerpitch-i18n.js` : aucun écart.
- Recoupement clés définies / clés réellement utilisées sur `player.js`, `layerpitch-backstage.html`, `index.html`, `pack.html` (`collection.html`/`video-test.html` non touchés aujourd'hui, exclus du recoupement) : une seule clé orpheline trouvée et supprimée (`loadErrorNoFixedLayers`, FR+EN — reliquat de l'ancien éditeur couches fixes/groupes, remplacée depuis par `loadErrorNoSections`).
- Recherche exhaustive de toute référence résiduelle à l'ancien schéma (`fixedLayers`, `randomGroups`, `referencesGroupId`, `fixedBuffers`, `groupBuffers`, `vertical-random-sequential`) dans tous les fichiers touchés aujourd'hui : aucune, hors code de migration légitime et deux commentaires devenus obsolètes (corrigés — ils citaient encore `canonicalGroupKey`, remplacée par `canonicalPoolKey`).
- Vérification des noms de fonctions dupliqués dans `player.js` et `layerpitch-backstage.html` : les doublons trouvés (`getVorbisDecoder`, `fractionFromEvent`, `render`, `renderList`) sont tous des fermetures indépendantes dans des portées distinctes (une par piste, un widget par type de bloc) — légitimes, pré-existants pour la plupart, pas de conflit réel.
- Cohérence des références `data-role` (dynamiques et statiques) entre déclaration dans les gabarits et lecture par le code JS, pour tous les rôles liés au vertical-random : aucun écart.
- **Bug réel trouvé et corrigé** : `stopAllSources` calculait encore `offsetAt` pour le vertical-random à l'arrêt — un calcul devenu mort depuis la fusion (le moteur reprend désormais via l'état conservé de `sectionScheduler`, jamais via `offsetAt`, comme le séquentiel). Retiré, avec le même commentaire explicatif que pour le séquentiel.
- Commentaires obsolètes corrigés : `introBuffer`/`outroBuffer` étaient encore documentés comme "spécifique au séquentiel" alors qu'ils sont désormais partagés avec le vertical-random depuis la fusion.
- Nouveau test ciblé (`test_quantized_loop_engine.js`) : confirme que le moteur de boucle quantifiée classique (vertical/statique avec `loopEngine: 'quantized'`) fonctionne toujours après la généralisation de `buildLoopTimelineEl` pour un usage par section — n'avait pas été vérifié explicitement dans les passes précédentes.
- Les quatre suites de tests (`test-section-scheduler.js`, `test_vr_engine.js`, `test_player_regression.js`, `test_quantized_loop_engine.js`) rendues indépendantes et exécutables isolément (aucune ne dépend plus d'un fichier de montage généré séparément).

**Conclusion** : aucun autre problème trouvé. Le code du jour est cohérent, sans référence résiduelle à l'ancien schéma, sans clé i18n orpheline, et les quatre suites de tests passent de façon indépendante.

---

## [2026-07-30] — Barre de progression par section (vertical-random), cliquable

**Fichiers touchés** : `player.js`, `index.html`, `pack.html`, `layerpitch-backstage.html`, `test_vr_engine.js`

**Contexte** : suite de l'incrément 2 (moteur vertical-random) — demande explicite de remplacer la barre de progression unique (rendue non interactive lors de la fusion, faute de position temporelle cohérente sur plusieurs sections) par une barre **par section**, qui reste cliquable.

**Changement** :
- Un bloc de progression par section déclarée (réutilise le style `.seq-block` déjà existant du mode séquentiel — mêmes blocs visuels, principe déjà connu), affiché dans le graphe de voix.
- Seul le bloc de la section **actuellement audible** est cliquable/glissable (`.seq-block.active`) — chercher une position n'a de sens que dans la section qui joue réellement ; les autres restent de simples repères visuels.
- Nouvelle fonction `seekVerticalRandom(fraction)` : recherche à l'intérieur du cycle de la section en cours sans faire avancer la chaîne (même esprit que `rerollPool`, déjà existant).
- CSS ajoutée dans les trois pages qui affichent des morceaux (`index.html`, `pack.html`, `layerpitch-backstage.html` — `collection.html` n'affiche pas de lecteur de morceau directement, pas concernée).

**Bug réel découvert et corrigé grâce à cette extension** : le libellé "section en cours" et la mise en valeur du bloc actif se mettaient à jour **au moment où la lecture est programmée à l'avance** (jusqu'à 1 seconde avant qu'elle ne s'entende réellement), pas au moment où elle devient audible. Avec la fenêtre de programmation anticipée du scheduler, une section à très peu de boucles pouvait être décidée puis aussitôt dépassée en une seule fois — l'affichage risquait de sauter directement à la section suivante sans jamais montrer la précédente, ou de refléter une section jamais réellement entendue par le visiteur. Corrigé en alignant sur le mécanisme déjà utilisé ailleurs (le libellé de la section séquentielle, lui, était déjà correctement différé) : la mise à jour de l'affichage attend maintenant le moment réel où le son se fait entendre, via le même délai que l'indicateur des pools.

**Vérification** : suite de tests étendue (`test_vr_engine.js`, 14 vérifications au total désormais) — un bloc par section, mise en valeur correcte du bloc actif, clic sans effet sur un bloc inactif, recherche fonctionnelle sur le bloc actif sans faire avancer la chaîne, et non-régression complète sur le reste du moteur (avancement automatique, "section suivante", "aller vers la fin"). Le bug de timing ci-dessus n'a été repéré QUE grâce à ce test — sans lui, il serait passé inaperçu jusqu'à un usage réel.

**Points ouverts** : inchangés depuis l'entrée précédente (duplication de pool sans interface, bulles d'aide, finition visuelle du graphe) — plus un vrai test d'écoute qui reste nécessaire avant validation définitive.

---

## [2026-07-30] — Moteur de lecture vertical-random (incréments 1 et 2)

**Fichiers touchés** : `player.js`, `layerpitch-i18n.js`, `test-section-scheduler.js` (nouveau), `test_vr_engine.js` (nouveau), `test_player_regression.js` (nouveau)

**Contexte** : suite directe de la fusion "Vertical random séquentiel" → "Vertical random" (entrée précédente) — le schéma de données et l'éditeur backstage étaient prêts, restait le moteur de lecture réel dans `player.js`. Vu la nature différente de ce chantier (un moteur audio temps réel ne se vérifie pas par de simples tests structurels — il faut l'entendre pour juger du calage), découpage en deux incréments distincts plutôt qu'un bloc monolithique, décision actée explicitement avec Jules-Antoine.

**Incrément 1 — logique pure d'enchaînement** : `createSectionPlaybackScheduler`, une fonction sans aucune dépendance à Web Audio ni au DOM, qui décide uniquement *quoi jouer ensuite* (intro / quelle section / outro), jamais *comment*. Comportements couverts et testés indépendamment (`test-section-scheduler.js`, 8 scénarios, 13 vérifications) : boucle infinie à une seule section (rétrocompatibilité avec l'ancien vertical-random), avancement automatique par nombre de boucles, "Aller vers la section suivante" sans répétition superflue, "Départ" appliqué uniquement au tout premier passage de chaque section, "Aller vers la fin" avec et sans outro, brassage complet équitable (y compris avec des sections dupliquées type AABA, vérifié sur 100 cycles).

**Incrément 2 — branchement Web Audio** : traduction des décisions du scheduler pur en programmation réelle de sources sonores.
- Nouveau modèle de buffers `sectionBuffers[section][pool][alternative]`, remplaçant l'ancien `fixedBuffers`/`groupBuffers` — chargement en deux passes (contenu réel, puis alias pour les sections dupliquées), même principe que les autres duplications du projet.
- Chaque section garde son propre tempo/timeline au moment de jouer (`sectionTiming()`), plus de constantes figées au niveau du morceau pour ce mode.
- Graphe de voix (Wwise Voice Graph) généralisé en "emplacements de pool" génériques plutôt que couches fixes/groupes distincts — dimensionné au plus grand nombre de pools parmi toutes les sections, les emplacements excédentaires étant masqués section par section (même mécanisme que les tirages silencieux déjà existants).
- Moteur quantifié classique (vertical/statique en boucle quantifiée) et moteur vertical-random maintenant clairement séparés — le premier ne connaît plus du tout la logique de sections.
- `rerollPool` réécrit : rejoue la section en cours avec de nouveaux tirages sans faire avancer la chaîne d'un cran (ne consomme pas de budget de boucles).
- **Simplification assumée** : la barre de progression de ce mode n'est plus interactive (pas de recherche par glissement) — avec plusieurs sections potentiellement enchaînées dans un ordre mélangé, "une position dans le temps" n'a plus de cible de recherche unique et cohérente vers laquelle glisser. Elle reste un indicateur visuel de progression dans la section en cours. À confirmer avec Jules-Antoine si ce compromis lui convient, ou s'il préfère une autre approche.
- Zip de téléchargement gratuit (`collectTrackAudioFiles`) mis à jour pour inclure les fichiers du nouveau format sections/pools.

**Vérification** : `test_vr_engine.js` — test de bout en bout avec un faux `AudioContext` qui simule fidèlement le comportement réel (horloge basée sur le temps réel écoulé, `onended` déclenché après la durée du buffer ou un `stop()` explicite, exactement comme un vrai navigateur) : chargement, intro, avancement automatique par nombre de boucles, "section suivante" manuelle, "aller vers la fin" menant à l'outro puis à l'arrêt naturel — 9 vérifications, toutes passées. `test_player_regression.js` : non-régression confirmée sur les modes statique, vertical classique et séquentiel après le refactor (chacun charge, joue, et réagit à ses contrôles propres sans erreur).

**Limite assumée de cette vérification** : aucun son réel n'a été entendu — la suite de tests valide la logique de programmation (quoi se déclenche, quand, dans quel ordre) mais pas la qualité perçue du calage à l'oreille. Un vrai test d'écoute par Jules-Antoine reste nécessaire avant de considérer ce moteur définitivement validé.

**Points ouverts** :
- Barre de progression non interactive pour ce mode (voir simplification assumée ci-dessus) — à valider ou à revoir.
- Duplication de pool à l'intérieur d'une section (`referencesPoolId`) : toujours pas d'interface, cf. entrée précédente.
- Bulles d'aide contextuelles toujours pas ajoutées (étape 3, inchangé).
- Graphe de voix : plus de connecteurs SVG individualisés par couche fixe/groupe comme avant la fusion — désormais générique par emplacement de pool. Fonctionnellement équivalent, esthétiquement simplifié ; à revoir si Jules-Antoine souhaite plus de finition visuelle une fois le calage audio confirmé à l'oreille.

---

## [2026-07-30] — Fusion de "Vertical random séquentiel" dans "Vertical random" (bilan de la session)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : après l'étape 1 du nouveau mode "Vertical random séquentiel" (entrée précédente), constat avec Jules-Antoine que ce mode et le vertical-random existant se recouvrent largement — le vertical-random n'est jamais qu'un cas particulier à une seule section, qui rejoue en boucle sur elle-même. Décision de les fusionner sous l'identifiant `vertical-random` existant plutôt que de maintenir deux modes proches.

**Recherche menée avant l'architecture** : comportement du modèle de segments Wwise (Entry Cue/Exit Cue, pre-entry/post-exit, dovetailing) et de son ancêtre DirectMusic — confirme qu'un point de départ ne s'applique qu'à la toute première lecture d'un segment, jamais aux passages suivants même en boucle, ce qui valide directement le comportement voulu pour le repère "Départ" dans une chaîne à plusieurs sections.

**Décision d'architecture retenue** : chaque section porte désormais son **propre** tempo/timeline (BPM, mesures, repères Départ/Entrée/Sortie, nombre de boucles par défaut) — comme un vrai segment Wwise indépendant — plutôt qu'un tempo unique partagé par tout le morceau. Le cas à une seule section (l'ancien vertical-random) garde un comportement strictement identique à avant.

**Changement** :
- Mode `vertical-random-sequential` retiré du menu déroulant — entièrement fusionné dans `vertical-random`.
- Chaque section a maintenant son propre BPM/mesures/timeline (réutilise le composant `buildLoopTimelineEl`, généralisé pour accepter n'importe quel objet porteur de tempo — le morceau ou une section) et son propre nombre de boucles par défaut.
- L'éditeur "couches fixes + groupes aléatoires" au niveau du morceau est supprimé — tout vit désormais dans `sections[].pools[]`. Une couche fixe devient un pool à un seul fichier ; un groupe aléatoire devient un pool à plusieurs fichiers — même distinction que celle déjà actée pour ne garder qu'un seul concept de pool.
- **Migration douce automatique** au chargement : un morceau déjà publié dans l'ancien format vertical-random (tempo/timeline unique, couches fixes + groupes aléatoires au niveau du morceau) devient une unique section qui reprend tout à l'identique — mêmes fichiers, même timeline, mêmes probabilités, comportement de lecture strictement inchangé. Vérifiée directement sur le morceau réel publié ("Victory !", 1 couche fixe + 6 groupes) : migration correcte vers 1 section à 7 pools.
- `describeVerticalRandom`/`describeVerticalRandomSequential` fusionnés en une seule fonction pour la fiche d'implémentation, avec description du tempo par section.
- `publishAll`/`loadData`/`buildPreviewTrack`/`togglePreview` mis à jour pour le nouveau schéma ; ancien format `fixedLayers`/`randomGroups` retiré de la sortie publiée (toujours lu en entrée pour la migration).
- 15 clés i18n orphelines retirées (FR+EN, 30 lignes) : `fixedLayersLabel`, `randomGroupsLabel`, `noFixedFileWarning`, `fixedLayersDropHint`, `addFixedLayerBtn`, `addGroupBtn`, `groupNamePlaceholder`, `removeGroupBtn`, `namePlaceholderFixed`, `removeFixedLayerBtn`, `groupDuplicateHint`, `fixedLayerFallback`, `fixedLayerFallbackShort`, `groupAltLabel`, `modeOptionVerticalRandomSequential`.
- CSS de zone de dépôt vide (bordure pointillée + texte d'invite) recalée sur les data-role réellement utilisés aujourd'hui (`poolAlternatives`, `slotAlternatives`) — pointait vers des data-role obsolètes depuis un moment déjà, avant même cette session.

**Bug rencontré et corrigé en cours de route** : lors de la fusion, une étape de découpage/re-collage de blocs de code a supprimé par erreur le `} else {` séparant la branche séquentielle de la branche par défaut (vertical/statique) — les deux blocs se retrouvaient accolés sans séparateur. Conséquence : passer une piste de vertical-random vers séquentiel faisait planter le rendu (tentative d'insertion dans un conteneur DOM inexistant en mode séquentiel). Repéré uniquement grâce à la suite de tests de non-régression (le rendu plantait au changement de mode, pas à l'affichage initial) — sans cette suite, le bug serait passé inaperçu jusqu'à un usage réel. Un premier réflexe de déboguer via les numéros de ligne des traces d'erreur s'est avéré trompeur (la présence de plusieurs balises `<script>` distinctes dans le montage de test brouille la numérotation rapportée par le moteur JS) ; la localisation exacte a nécessité de poser des marqueurs de log directement dans le code, un par un, jusqu'à isoler la ligne fautive.

**Vérification** : suite de tests Node/jsdom étendue — mode vertical-random fusionné (timeline par section, duplication de section, aucune trace de l'ancien éditeur couches fixes/groupes), non-régression complète sur séquentiel/vertical/statique, **et** un test dédié rejouant le chargement du `data.json` réellement publié (12 morceaux, tous modes confondus) pour confirmer que la migration automatique fonctionne sur les vraies données de production, pas seulement des données de test fabriquées.

**Points ouverts** :
- Duplication de pool à l'intérieur d'une même section (l'équivalent de l'ancien `referencesGroupId`) : le champ `referencesPoolId` existe dans le schéma pour la fidélité d'aller-retour des données, mais aucune interface ne permet encore de le régler (aucun groupe du morceau réel migré ne l'utilisait, donc pas de perte constatée en pratique — mais fonctionnalité non reconstruite si un jour nécessaire).
- La surcharge de libellé de couche par AdReel (`trackOverrides`) ne couvre plus le vertical-random (elle ne couvrait déjà que les couches fixes avant, jamais les groupes) — dégradation mineure déjà partielle avant cette session, pas aggravée mais pas non plus corrigée.
- Bulles d'aide contextuelles toujours pas ajoutées (étape 3, inchangé depuis l'entrée précédente).
- Moteur de lecture (`player.js`) toujours pas mis à jour pour interpréter cette structure (étape 2, prochaine session).

---

## [2026-07-30] — Nouveau mode "Vertical random séquentiel" (étape 1 : schéma + éditeur backstage)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : besoin identifié d'un mode hybride distinct du vertical-random existant et du futur "vertical additif randomisé" (celui-ci porte sur un contrôle d'intensité par le visiteur, absent ici) — des sections chaînées dans le temps comme le séquentiel, mais chacune contenant plusieurs pools simultanés randomisés comme le vertical-random. Cas d'usage explicite : motifs de structure du type ABC ou AABA, chaque section ayant ses propres parties de basse/guitare/etc. tirées aléatoirement à chaque passage.

Architecture discutée et validée avant tout code (plusieurs allers-retours) :
- Distinction couches fixes/groupes aléatoires jugée obsolète par Jules-Antoine : un pool à un seul fichier est de fait non randomisé — donc un seul concept de "pool" par couche, pas deux.
- Pattern AABA obtenu en dupliquant/réordonnant des sections dans la liste, pas via un compteur de répétitions.
- "Aller vers la fin" et un nouveau "Aller vers la section suivante" (renvoie à la section 0 si on est déjà sur la dernière) attendent tous deux la fin de la section en cours, comme le séquentiel — prévu pour l'étape 2 (moteur de lecture).
- Case "Randomiser les séquences" : brassage complet retenu (chaque section joue exactement une fois par cycle, ordre mélangé) plutôt qu'une pioche libre pondérée — garantit qu'aucune section n'est jamais "perdue" sur un cycle donné, essentiel pour un outil de pitch.
- Queue de chevauchement de l'intro : aucun réglage séparé nécessaire, le mécanisme déjà utilisé par le séquentiel (fichier plus long que sa durée nominale en mesures = chevauchement automatique sur le début de la section suivante) suffit tel quel.

**Changement** (étape 1 uniquement — schéma de données et éditeur, le moteur de lecture dans `player.js` reste à faire) :
- Nouveau mode `vertical-random-sequential` ajouté au menu déroulant du format (actif, plus grisé), libellé "Vertical random séquentiel".
- Nouvelle structure `track.sections[]` : liste ordonnée, réorganisable (↑/↓) et duplicable (`referencesSectionId`, même principe de référence que les groupes vertical-random et les emplacements séquentiels — un pool dupliqué ne recharge jamais les fichiers, anti-répétition partagée). Chaque section contient `pools[]` (nom, anti-répétition immédiate, pool de variations pliable/dépliable via le bouton partagé existant).
- `track.intro` (nom + mesures) et `track.outro` (sans mesures) réutilisent tels quels les mêmes objets que le mode séquentiel.
- Nouvelle case à cocher `track.randomizeSections`.
- Tous les gestionnaires nécessaires ajoutés : ajout/suppression/réordonnancement de section, ajout/suppression de pool, ajout/suppression de variation, saisie de tous les champs.
- `loadData()`/`publishAll()` étendus pour lire/publier la nouvelle structure, y compris la conversion OGG des fichiers de chaque pool.
- `buildPreviewTrack()` transmet déjà la structure complète, en prévision du moteur de lecture à venir.
- Fiche d'implémentation : nouvelle fonction `describeVerticalRandomSequential`, prise en compte dans `describeTimingBlock`.

**Bug latent corrigé au passage** : le bouton "Écouter" (`togglePreview`) ne vérifiait la présence d'au moins un fichier que sur `track.layers` en dehors du vertical-random — ce qui ne correspond à aucun contenu réel en mode séquentiel (dont le contenu vit dans `segmentSlots`/`intro`/`outro`, jamais dans `layers`). Corrigé pour brancher correctement sur les trois modes non-classiques (vertical-random, séquentiel, vertical random séquentiel).

**Vérification** : suite de tests Node/jsdom dédiée (~25 assertions, vrais clics DOM) — ajout/suppression/réordonnancement de section, duplication via `referencesSectionId` avec repli correct du bouton "+ Pool" sur une section dupliquée, ajout/suppression de pool et de variation, persistance des champs après re-rendu. Non-régression vérifiée sur les modes séquentiel et vertical-random existants (hosts DOM toujours présents, `add-segment-slot`/`add-group` toujours fonctionnels après la restructuration des chaînes ternaires du gabarit).

**Points ouverts** :
- Bulles d'aide contextuelles (`data-help`) pour les nouveaux champs : prévues à l'étape 3, pas encore ajoutées (les `data-help` posés dans le HTML n'ont pas encore d'entrée dans `layerpitch-help.js` — sans effet néfaste, juste pas de bulle affichée).
- `player.js` ne sait toujours pas jouer ce mode (étape 2, prochaine session).

---

## [2026-07-29] — Bouton de repli en bas à droite des blocs, en plus de celui du haut

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : retour sur une capture d'écran — après avoir lu tout le contenu d'un bloc long (ex. la liste de packs sélectionnés), il fallait remonter tout en haut pour le replier. Demande explicite de garder aussi la commande du haut pour qui la préfère.

**Changement** : nouveau générateur partagé `collapseFooterHtml(action, dataAttrs)` — un bouton "▴ Replier" (jamais juste un triangle nu, plus explicite en bas de contenu) inséré en pied de bloc, aligné à droite, avec un filet de séparation au-dessus. Réutilise le **même** `data-action`/attributs `data-*` que le bouton du haut : pris en charge par le gestionnaire délégué déjà existant, sans mécanisme séparé. Appliqué aux 5 endroits ayant ce pattern replié/déplié :
- Blocs de contenu d'un AdReel (Header, Bio, Témoignages, Morceaux, Texte, Photo, Vidéo, Packs, Collections, Sfx, Contact) — point de passage unique `buildCardForBlock`.
- Éditeur de morceau, éditeur de pack, éditeur de collection, entrée de la Bibliothèque Sfx.

**Bug évité en cours de route** : les gestionnaires existants ne mettaient à jour que le glyphe du bouton **cliqué** (`btn.textContent = ...`) — correct tant qu'un seul bouton existait, mais aurait laissé le bouton du haut affiché dans le mauvais état après un clic sur celui du bas. Corrigé pour cibler explicitement le bouton du haut (`.list-block-head [data-action="..."]` / `.block-editor-head [data-action="toggle-collapse"]`), sans jamais écraser le libellé "Replier" du bouton du bas avec un simple triangle. La Bibliothèque Sfx échappe à ce problème par construction (repli déjà géré par un re-rendu complet de la liste).

**Vérification** : suite de tests Node/jsdom dédiée (17 assertions) — bouton présent aux 5 endroits, clic depuis le bas replie bien le bloc, le bouton du haut se resynchronise correctement, réouverture depuis le haut toujours fonctionnelle. Intégralité de la suite de tests de la session rejouée sans régression.

---

## [2026-07-28] — Passe de nettoyage et d'audit sur l'ensemble du projet

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : demande explicite de repasser sur tout le code pour le nettoyer/l'optimiser. Audit systématique plutôt qu'un nettoyage à l'aveugle : déclarations de fonctions dupliquées (dans un même fichier), sélecteurs CSS dupliqués/conflictuels, clés i18n orphelines, clés de bulles d'aide orphelines, classes CSS définies mais jamais utilisées, `console.log`/`TODO`/`FIXME` résiduels — sur les 11 fichiers du projet.

**Un vrai bug trouvé et corrigé** : `.nav-feedback-btn` était défini deux fois avec des propriétés contradictoires — la règle ajoutée pendant la refonte de la sidebar (filet de séparation `border-top` uni) et l'ancienne règle pré-existante (encadré pointillé). À cause de la cascade CSS, le `border` en raccourci de la seconde écrasait silencieusement le `border-top` de la première : **le filet de séparation ajouté lors de la refonte de la sidebar n'a en réalité jamais été visible**, le bouton a gardé son style pointillé d'origine tout du long. Corrigé en retirant la règle en doublon — l'encadré pointillé (déjà là avant cette session, assure déjà une séparation visuelle suffisante) fait foi.

**12 clés i18n orphelines retirées** (confirmées à 0 occurrence hors `layerpitch-i18n.js`, FR+EN, 26 lignes) :
- 3 restes de la Phase 1 de hiérarchisation (`verticalRandomBpmHint`, `sequentialBpmHint`, `normalizeVolumeHint`) — jamais nettoyées au moment où leur paragraphe a été retiré du formulaire.
- 1 reste du passage en pool unique de variations (`alternativeFallback` — l'ancien texte de repli des en-têtes individuels, supprimés depuis).
- 7 restes de l'ancien système "stinger" d'avant la migration vers la Bibliothèque Sfx (18-25 juillet) : `addStingerBtn`, `stingerLabelText`, `removeStingerBtn`, `stingerFallback`, `segmentFallbackShort`, `convertingStinger`, `stingerFallbackShort`.
- 1 clé plus ancienne, `buyBtn` (2 variantes, pack et collection) — supplantée depuis par `buyableLabel`/`packBuyable`.

**Ce qui n'a rien trouvé d'anormal** (audit fait, pas seulement supposé) : aucune fonction dupliquée au sein d'un même fichier, aucune bulle d'aide orpheline, aucune classe CSS définie sans jamais être utilisée, aucun `console.log`/`debugger`/`TODO`/`FIXME` résiduel. Les quelques "sélecteurs dupliqués" détectés dans `index.html`/`pack.html` (`.lightbox-close`, `.video-test-btn-secondary`) sont en réalité un pattern volontaire (règle de base groupée par virgule + réglage spécifique en plus) — vérifiés, pas de problème.

**Vérification** : syntaxe validée sur les 11 fichiers (JS purs + scripts inline de chaque page HTML), intégralité de la suite de tests de la session rejouée sans régression après le nettoyage.

---

## [2026-07-28] — Hiérarchisation par sections : Header, Sfx Library, Apparence générale de l'AdReel

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : passe finale sur "l'ensemble des blocs qui pourraient en tirer parti" — après sidebar, morceau, pack et collection, revue de tous les autres formulaires du backstage (Bio, Témoignages, Contact, Texte, Photo, Vidéo, blocs Packs/Collections/Sfx d'un AdReel, Réseaux sociaux, dépôt GitHub) : la plupart sont déjà assez courts (2-3 champs) ou déjà structurés en `<fieldset>` avec légende (GitHub) pour ne pas avoir besoin de repères supplémentaires. Trois endroits en revanche suivaient le même flux plat que les précédents :

- **Header** (3 sections) : Identité (titre, sous-titre, logo) → Contact (email, site) → Formulaire (endpoint Formspree).
- **Bibliothèque Sfx**, entrée d'un Sfx (2 sections) : Identité (titre, descriptions FR/EN) → Comportement (mode round robin, ducking) — le pool "Voir les variations" juste après sert déjà de troisième repère naturel.
- **Apparence — AdReel en cours d'édition** (HTML statique, 2 sections) : Langue → Thème (couleurs, police, image de fond). Les "Polices personnalisées", déjà dans leur propre `<fieldset><legend>`, laissées telles quelles.

Nouvelles clés i18n génériques (FR/EN) : `sectionContact`, `sectionForm`, `sectionBehavior`, `sectionLanguage`, `sectionTheme`.

**Vérification** : suite de tests Node/jsdom dédiée (flux "data.json introuvable" simulé via un mock de `ghGetContent` pour obtenir l'AdReel par défaut avec ses blocs, sans dépendre du réseau) + l'intégralité de la suite de tests de la session rejouée sans régression.

---

## [2026-07-28] — Hiérarchisation par sections étendue aux éditeurs de pack et de collection

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : suite de la Phase 2 (sidebar → éditeur de morceau → ici) — l'éditeur de pack et celui de collection avaient exactement le même défaut de formulaire plat que le morceau, avant la refonte.

**Changement** : réutilisation telle quelle de `sectionEyebrow()` (aucune nouvelle mécanique).
- **Pack** (5 sections) : Identité (titre, illustration, watermark) → Présentation (FR/EN) → Diffusion (téléchargement gratuit, vente, mode test gameplay, renvoi AdReel, lien direct, partage, réseaux sociaux) → Apparence (couleurs) → Contenu (sélecteur de morceaux, sélecteur de Sfx).
- **Collection** (4 sections) : Identité (titre, illustration) → Présentation (FR/EN) → Contenu (sélecteur de packs) → Diffusion (téléchargement gratuit, vente, lien direct, partage, réseaux sociaux).
- Nouvelles clés i18n génériques `sectionPresentation`/`sectionDistribution`/`sectionAppearance` (FR/EN) ; `trackSectionIdentity`/`trackSectionContent` réutilisées telles quelles (même libellé "Identité"/"Contenu" que dans l'éditeur de morceau, malgré le nom de clé).

**Vérification** : suite de tests Node/jsdom dédiée (ordre des sections, IDENTITÉ toujours en tête, aucun champ perdu) + l'intégralité de la suite de tests de la session rejouée sans régression.

---

## [2026-07-28] — Bulles d'aide enrichies avec le détail retiré des paragraphes permanents

**Fichiers touchés** : `layerpitch-help.js`

**Contexte** : retour après la Phase 1 — les bulles d'aide (`data-help`) qui remplaçaient les paragraphes permanents étaient globalement moins précises que ce qui avait été retiré, malgré le recoupement de contenu vérifié avant suppression.

**Changement** : fusion du détail manquant dans 3 bulles (FR/EN) :
- `bpmMeasuresSequential` — ajout de la précision sur le fondu de fin ("le fichier peut être plus long que ces mesures : la fin sonne en fondu pendant que le bloc suivant démarre déjà").
- `bpmMeasuresVerticalRandom` — mention explicite de la couche fixe (pas seulement les tirages aléatoires) parmi ce qui doit rester synchronisé.
- `normalizeVolume` — ajout de la précision sur le comportement par défaut ("décoché par défaut : sans ça, tes fichiers sonnent exactement à leur volume d'origine").

`trackDescription` non touchée : déjà complète (la phrase "Cmd+K" retirée en Phase 1 y figurait déjà mot pour mot).

**Vérification** : contenu des 3 bulles relu et confirmé présent après modification.

---

## [2026-07-28] — Éditeur de morceau : retrait des paragraphes redondants avec une bulle d'aide (Phase 1)

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : Phase 1 initialement mise de côté ("les explications doivent rester au moins jusqu'à la bêta multi"), validée après coup une fois la Phase 2 (sections) vue en pratique.

**Changement** : retrait des 4 paragraphes permanents identifiés comme strictement redondants avec une bulle d'aide déjà présente sur le même champ (contenu quasi identique, confirmé texte à texte avant suppression) :
- BPM/mesures (vertical-random) — doublon de la bulle `bpmMeasuresVerticalRandom`
- BPM/mesures (séquentiel) — doublon de la bulle `bpmMeasuresSequential`
- Description — le paragraphe "Sélectionne du texte puis Cmd+K..." était déjà la dernière phrase de la bulle `trackDescription`
- Harmoniser les volumes — doublon de la bulle `normalizeVolume`

Seuls ces 4 cas du formulaire de morceau ont été touchés — les usages de `linkHint` ailleurs dans le backstage (packs, collections, bio...) n'ont pas été vérifiés un par un et restent inchangés. Les avertissements orange, le texte des zones de dépôt et les instructions de la timeline de boucle (interaction non standard) restent également inchangés, comme prévu.

**Vérification** : suite de tests Node/jsdom mise à jour — confirme la disparition des 4 paragraphes tout en vérifiant que leur bulle d'aide respective (`data-help`) reste bien en place ; l'ensemble de la suite de tests de la session (sidebar, Sfx, pools de variations, panneau Apparence) rejoué sans régression.

---

## [2026-07-28] — Éditeur de morceau : hiérarchisation par sections (Phase 2)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : suite du travail de hiérarchisation visuelle entamé sur la sidebar — appliqué maintenant à l'éditeur de morceau, dont le formulaire déplié s'enchaînait jusqu'ici en un long flux plat (titre, format, tempo, description, structure, Sfx, note d'implémentation, certification, tout au même niveau visuel). **Phase 1 (retirer les paragraphes redondants avec les bulles d'aide) explicitement mise de côté par Jules-Antoine** — les explications restent visibles telles quelles, au moins jusqu'à la bêta multi.

**Changement** : 5 repères de section ajoutés (même langage visuel que les eyebrows de la sidebar — `.nav-section-label`, réutilisée telle quelle — avec un filet de séparation en plus, `.track-section-label`) :
- **Identité** — titre, format, case "bouclable" (mode statique)
- **Tempo** — BPM/mesures, points de boucle, nombre de boucles par défaut ; **absent si sans objet** (mode statique non bouclable) plutôt que de montrer un repère vide — calculé via un nouveau booléen `hasTempoSection`
- **Contenu** — description, harmonisation des volumes
- **Structure** — couches fixes/groupes aléatoires, ou intro/emplacements/outro, ou couches classiques/fichier statique selon le mode
- **Réglages avancés** — Sfx attachés, note d'implémentation, certification sans IA

Nouveau générateur partagé `sectionEyebrow(label)`. Aucun champ, aucune bulle d'aide, aucun texte explicatif existant déplacé ou supprimé — uniquement des repères insérés autour du contenu déjà en place.

**Vérification** : suite de tests Node/jsdom couvrant les 4 modes (statique non bouclable, statique bouclable, vertical-random, séquentiel) — les 5 sections apparaissent dans le bon ordre, Tempo disparaît proprement quand non pertinent, et tous les textes d'aide existants sont confirmés intacts.

---

## [2026-07-28] — Un seul bouton "Voir les variations" pour les pools de variations (Sfx, groupes, segments)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : retour en deux temps sur le repli individuel par variation ajouté un peu plus tôt dans la session — Jules-Antoine ne voulait pas un repli par ligne (un clic par variation), mais un seul bouton qui déplie **tout le pool d'un coup**. Clarifié à l'aide d'une seconde capture d'écran montrant un groupe vertical-random ("Alt Perc") : les réglages du groupe lui-même (nom, source du contenu, case "interdire la répétition") doivent rester toujours visibles ; seule la liste de ses variations (Vide, AltPerc#1, AltPerc#1.5...) doit se cacher derrière un unique repli.

**Changement** :
- Nouveau générateur partagé `altPoolToggleHtml(key, count)` — un seul bouton "Voir les variations (N)" avec un caret, replié par défaut (nouveau registre `expandedAltPoolKeys`, clé par pool). Câblé directement au clic (`wireAltPoolToggle`), sans passer par les gestionnaires délégués existants.
- Appliqué aux **3 pools de variations interchangeables** : variations d'un Sfx, alternatives d'un groupe aléatoire (vertical-random), alternatives d'un emplacement séquentiel — chacun n'affiche plus qu'un seul bouton, et les lignes individuelles (revenues à leur forme simple : label + fichier + suppression, sans en-tête propre) apparaissent toutes ensemble une fois déplié.
- **Couches fixes et couches classiques (vertical) laissées inchangées**, avec leur repli individuel par ligne existant : ce sont des éléments distincts qu'on veut pouvoir retrouver un par un (chaque couche fixe est un son différent, chaque couche classique un niveau d'intensité différent), pas un pool de variations interchangeables — distinction actée avec Jules-Antoine.
- Nettoyage du premier essai (repli individuel Sfx replié par défaut, `expandedSfxAltKeys`) : registre et gestionnaire retirés, remplacés par le pool unique.

**Vérification** : suite de tests Node/jsdom, entièrement pilotée en clics UI réels (création d'un morceau vertical-random avec un groupe, d'un morceau séquentiel avec un segment, ajout de variations) — un seul bouton par pool, replié par défaut, toutes les lignes apparaissent d'un coup au clic, et les couches fixes gardent bien leur comportement d'origine.

---

## [2026-07-28] — Panneau "Apparence de ce bloc" repliable, replié par défaut

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : retour sur une capture d'écran — la section "Apparence de ce bloc" (couleur de fond, couleur des titres, couleur du contenu, police, image de fond, opacité) s'affichait toujours en entier dans chaque bloc, alors que la plupart des blocs héritent simplement du réglage général et n'ont besoin de rien y toucher.

**Changement** : `appendBlockAppearanceSection()` enveloppe désormais les champs dans le même mécanisme de repli que le reste du backstage (`.list-block-head`/`.list-block-body.collapsed`, glyphe ▸/▾) — replié par défaut, un clic sur l'en-tête suffit à dérouler. L'état de repli est suivi par bloc (`expandedBlockAppearanceIds`, clé = `block.id`) et survit aux re-rendus des champs eux-mêmes (cocher une case ne referme pas le panneau, puisque `renderBlockAppearanceFields` ne touche qu'à son propre sous-conteneur, jamais à l'en-tête). Nouvelle clé i18n `blockAppearanceTitle` (FR/EN) pour le titre court de l'en-tête, distinct du texte d'explication complet qui reste dans le corps déplié.

**Vérification** : suite de tests Node/jsdom — replié par défaut, dépli/repli au clic, aucune duplication d'en-tête après re-rendu des champs, et deux blocs différents gardent chacun leur propre état de repli indépendant.

---

## [2026-07-28] — Boutons icône pour upload/suppression dans les listes de variations

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : retour sur une capture d'écran d'une variation Sfx — trop de texte pour ce que ça fait ("Choisir un fichier audio" / "Supprimer cette variation" en boutons pleine largeur, sur deux lignes séparées).

**Changement** : `fileCtrlHtml()` (fonction partagée, utilisée partout où on choisit un fichier) affiche désormais une icône seule (upload) au lieu d'un bouton texte — `title`/`aria-label` conservés pour l'accessibilité. Nouvelle fonction `deleteIconBtnHtml(action, dataAttrs, label)` : bouton de suppression icône (corbeille), injectable dans la même ligne que le contrôle de fichier plutôt que dans une rangée d'actions séparée en dessous. Appliqué aux 5 listes de variations qui suivaient ce pattern répétitif : variations Sfx, alternatives de groupe (vertical-random), alternatives de segment (séquentiel), couches fixes (vertical-random) et couches classiques (vertical). Les uploads "un seul exemplaire" sans suppression associée (logo, photo de bio, illustration de pack/collection, image de fond, police, vignette) gardent leur bouton d'upload en icône (cohérence visuelle) mais n'ont pas de bouton de suppression à déplacer, puisqu'ils n'en avaient pas.

**Vérification** : suite de tests Node/jsdom — icône présente sans texte résiduel, `aria-label`/`title` corrects, attributs `data-*` du bouton de suppression corrects, et test de bout en bout en pilotage UI pur (ajout d'un Sfx, ajout de 2 variations, clic sur le bouton de suppression icône, vérification qu'une seule variation reste — la bonne).

---

## [2026-07-28] — Refonte de la sidebar : icônes sur mesure, hiérarchie renforcée

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : retour sur la lisibilité globale du backstage, comparée à un concurrent (ReelCrafter) — la sidebar était du texte nu sans aucune icône, sans hiérarchie entre les items "Compte" et le groupe spécifique à l'AdReel sélectionné.

- 10 icônes ligne dessinées sur mesure (pas de librairie générique, pas d'emoji) — chacune conceptuellement liée à la fonction plutôt que décorative : trois barres ascendantes pour la Bibliothèque musicale (le motif même du layering vertical, déjà présent dans les puces d'intensité du site public), un éclat pour la Bibliothèque Sfx (one-shot, par opposition aux barres continues), une boîte pour les Packs, deux boîtes superposées pour les Collections, trois nœuds reliés pour les Réseaux sociaux, une grille de cartes pour "Gérer les AdReels", un cadenas pour Projet(s) (cohérent avec son état verrouillé), des lignes de blocs pour Contenu, un cercle mi-plein pour Apparence (rappel du toggle "Contraste renforcé" déjà présent côté public), une bulle de dialogue pour le retour sur version.
- `.nav-item` passe en flex (icône + libellé), `justify-content: space-between` conservé pour le badge "bientôt" de Projet(s).
- Séparation visuelle renforcée entre le groupe "Compte" (ressources globales) et le groupe "Site (AdReel)" (marge augmentée), et un séparateur (filet + marge) ajouté avant le bouton de retour, qui flottait seul auparavant.
- **Point de vigilance corrigé en cours de route** : les icônes avaient d'abord été ajoutées en gardant `data-i18n` sur le `<button>` lui-même en plus du nouveau `<span>` interne — `applyI18n()` fait `el.textContent = v`, ce qui aurait effacé les icônes SVG à chaque application des traductions. Corrigé en ne laissant `data-i18n` que sur le `<span>` du libellé.

**Vérification** : suite de tests Node/jsdom dédiée — icône présente sur chaque item, badge et attributs (`data-help`, `data-tab`) intacts, structure survivant à une application simulée de `applyI18n()`.

---

## [2026-07-28] — Sfx : le bouton Play déplie sa ligne et replie les autres, comme un morceau

**Fichiers touchés** : `player.js`

**Contexte** : retour explicite — le lecteur Sfx venait d'être aligné visuellement sur le morceau, mais le bouton Play ne participait pas encore au même comportement de dépli/repli collectif.

**Changement** : le Sfx rejoint le même registre partagé que les morceaux (`trackCollapsers`/`activeTrackId`, déjà utilisé par `playThisTrack()`). Cliquer sur le bouton Play rond d'un Sfx déplie désormais sa propre ligne et replie tout le reste de la page — morceaux et autres Sfx confondus —, arrête un morceau en cours de lecture s'il y en avait un (même mécanisme d'événement `stop-track`), et efface son statut d'élément actif à la fin naturelle du son. Seul le bouton Play déclenche ce comportement ; cliquer directement sur une variation RR reste une simple audition locale, sans repli des autres lignes.

**Vérification** : suite de tests étendue — jouer un second Sfx replie bien le premier resté déplié.

---

## [2026-07-28] — Ducking : plafond de baisse et remontée progressive

**Fichiers touchés** : `player.js`

**Contexte** : retour d'écoute — la baisse actuelle (65 %) était trop marquée, et la remontée, collée à la toute fin du Sfx, semblait abrupte.

- `DUCK_LEVEL` : 0.35 → **0.7** (baisse plafonnée à 30 % au lieu de 65 %).
- La remontée démarre désormais à **la moitié de la durée du Sfx** (`sfxDurationSec / 2`) au lieu de `sfxDurationSec - DUCK_RELEASE_SEC` (collée à la fin).
- `DUCK_RELEASE_SEC` : 0.35s → **1.2s** — remontée nettement plus progressive, quitte à se terminer après la fin du Sfx lui-même plutôt qu'exactement dessus.
- L'attaque (`DUCK_ATTACK_SEC = 0.08`) reste inchangée, jugée satisfaisante.

---

## [2026-07-28] — Bug persistant de chargement de `collection.html` : cause trouvée et corrigée

**Fichiers touchés** : `collection.html`

**Diagnostic** : contrairement à `pack.html`/`index.html`, `collection.html` n'a jamais déstructuré `escapeHtml`/`linkify`/`setupContrastToggle` depuis `window.LayerPlayerCore` — ces fonctions vivent dans la fermeture (IIFE) de `player.js` et ne sont pas des globales. Chaque appel nu (`escapeHtml(collection.title)`, etc.) déclenchait un `ReferenceError` dès le premier rendu dans `init()`, catché silencieusement par le `try/catch` → page systématiquement affichée en `loadError`, quel que soit l'état réel des données.

**Changement** : ajout de `const { escapeHtml, linkify, setupContrastToggle } = window.LayerPlayerCore;` en tête du script, comme dans `pack.html`.

**Vérification** : reproduit puis corrigé en conditions réelles (Node/jsdom, `fetch` mocké, vrai `player.js`) — la page charge sans erreur, affiche le titre de la collection et la liste des packs inclus.

---

## [2026-07-28] — Refonte du lecteur Sfx : architecture alignée sur le lecteur de morceau

**Fichiers touchés** : `player.js`, `index.html`, `pack.html`, `layerpitch-backstage.html`, `layerpitch-i18n.js`

**Contexte** : le lecteur Sfx (`buildSfxPlayer`) affichait jusqu'ici toutes les variations round robin côte à côte en permanence, chacune avec sa propre forme d'onde toujours visible, sans aucune vue repliée/dépliée — incohérent avec le reste du site.

**Changement** :
- `player.js` : `buildSfxPlayer` réécrit pour réutiliser telles quelles les classes `.track-row-wrapper`/`.track-row`/`.track-row-details`/`.track-row-details-inner`/`.track-desc` du lecteur de morceau — ligne compacte (bouton Play + titre + tag "Sfx"), **un seul repli** au clic sur le titre (pas de second niveau imbriqué, conformément à la demande explicite).
- Le repli affiche désormais **une seule forme d'onde principale**, qui reflète uniquement la variation RR effectivement en train de jouer (mise à jour à chaque tirage/clic), et non plus les N formes d'onde simultanément. Les blocs RR individuels (mini-forme d'onde + label, cliquables pour forcer une variation précise) restent visibles juste en dessous, dans ce même repli.
- **Animation de progression** ajoutée sur la forme d'onde principale (initialement oubliée dans la première passe, ajoutée après retour explicite) : remplissage via transition CSS `clip-path` sur la durée réelle du buffer joué — même mécanisme que celui déjà utilisé pour le mode séquentiel (`activateSeqStage`), plutôt qu'une boucle `requestAnimationFrame` (superflue pour un one-shot sans pause/seek).
- **Glisser-déposer groupé des variations RR** : `wireBatchDrop` (déjà utilisé pour les groupes vertical-random et les emplacements séquentiels) branché sur la liste d'alternatives Sfx du backstage — déposer plusieurs fichiers d'un coup crée une variation par fichier, avec le nom repris automatiquement du fichier.
- **Description bilingue** : `sfx.description` (champ unique) remplacé par `descriptionFr`/`descriptionEn` (même pattern que `presentationFr`/`presentationEn` des packs/collections). Repli automatique sur l'ancien champ unique pour tout Sfx publié avant ce changement (lu une fois au chargement, jamais réécrit dans l'ancien champ). Résolution de la langue faite directement dans `player.js` (nouvelle fonction `pickSfxDescription`, utilise `currentLang()`), pas dans chaque page hôte.
- `layerpitch-backstage.html` : éditeur Sfx mis à jour (deux textarea FR/EN au lieu d'un champ unique, indice de glisser-déposer groupé), migration au chargement et sérialisation à la publication adaptées aux nouveaux champs.
- `layerpitch-i18n.js` : nouvelles clés `sfxModeTag`/`sfxNoFilesYet` (zone `player`, FR/EN) et `descriptionLabelFr`/`descriptionLabelEn` (zone `backstage`, FR/EN).
- CSS : ancien bloc `.sfx-player`/`.sfx-player-title`/`.sfx-player-desc`/`.sfx-play-btn` retiré de `index.html` et `pack.html` (remplacé par la réutilisation des classes du morceau) ; `.sfx-rr-row`/`.sfx-rr-block` conservées à l'identique pour la liste RR en dessous.

**Vérification** : suite de tests Node/jsdom dédiée (`AudioContext` et `fetch` simulés) — structure DOM (repli/dépli à un seul niveau, forme d'onde principale unique, variations RR en dessous), résolution bilingue de la description (FR, EN avec repli sur FR si vide, repli sur l'ancien champ non migré), état désactivé du bouton Play si aucune variation, et — après correction suite au retour explicite sur l'oubli initial — l'animation de progression réelle (clip-path final `inset(0 0% 0 0)`, durée de transition correspondant exactement à la durée du buffer joué). 20 assertions, toutes passantes.

---

**Fichiers touchés** : `LAYERPITCH_MASTER.md`, ce changelog

- `LAYERPITCH_MASTER.md` : ajout de l'idée "AdReels temporaires" (réglage de temporalité + option "rendre permanent"), section 12 — avec le point technique honnête que sur l'architecture statique actuelle, une vraie expiration ne peut être qu'un garde-fou visuel côté visiteur, pas une restriction d'accès réelle (même limite déjà documentée pour "liens protégés/expirants", auquel l'idée est reliée sans être confondue avec elle).
- Compilation du changelog de toute la session du 25 juillet, à la demande explicite de Jules-Antoine.

---

## [2026-07-25] — Téléchargement gratuit pour les Collections + code de téléchargement partagé avec les Packs

**Fichiers touchés** : `player.js`, `collection.html`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`

- `player.js` : `ensureJSZipLoaded`, `collectTrackAudioFiles`, `downloadTracksAsZip` déplacées depuis `pack.html` (où elles avaient été écrites quelques échanges plus tôt) vers `player.js`, pour être réellement partagées entre `pack.html` et `collection.html` plutôt que dupliquées une seconde fois.
- **Erreur de manipulation repérée et corrigée en cours de route** : le déplacement a d'abord effacé accidentellement `setSfxLibrary` (`str_replace` mal ciblé) — repéré par la vérification syntaxique immédiate, restauré, revérifié.
- `collection.html` : même traitement que les packs — case "Téléchargement gratuit" générant un zip de tous les morceaux de **tous les packs inclus** dans la collection, dédupliqués (un même morceau peut apparaître dans plusieurs packs) ; vente toujours affichée grisée pendant la bêta, quel que soit `buyUrl`.
- `layerpitch-backstage.html` : champ `freeDownloadEnabled` ajouté à l'éditeur de collection (chargement, sauvegarde, publication), même principe que pour les packs.
- Nouvelles clés i18n (zone `collection`) et tooltip d'aide `collectionFreeDownload` — FR/EN.

---

## [2026-07-25] — Téléchargement gratuit pour les Packs, vente toujours grisée pendant la bêta

**Fichiers touchés** : `pack.html`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`

**Contexte** : remplace le mécanisme précédent (case "Achetable" + lien externe `buyUrl`, à moitié fonctionnel) par un système à deux options distinctes, à la demande de Jules-Antoine.

- `pack.html` : nouveau bouton "Télécharger gratuitement", réel dès aujourd'hui — génère un zip côté navigateur (JSZip chargé au clic seulement, jamais au chargement de la page) avec tous les fichiers audio publiés des morceaux du pack, quel que soit leur mode (couches, variations, intro/segment/outro, tout est inclus plutôt qu'un seul fichier choisi arbitrairement par morceau).
- La vente s'affiche désormais **toujours** grisée ("Bientôt disponible") sur la page publique, même si `buyable`/`buyUrl` sont renseignés côté backstage — pour ne jamais laisser croire aux bêta-testeurs à un système de paiement qui n'existe pas encore. Le champ reste éditable en backstage, prêt pour le jour où la vente sera réellement construite.
- `layerpitch-backstage.html` : case "Téléchargement gratuit" ajoutée à l'éditeur de pack, note explicite ajoutée sous le champ `buyUrl` pour clarifier qu'il n'est pas encore exploité publiquement.
- Nouvelles clés i18n (`freeDownloadLabel`, `freeDownloadBtn`, `downloadPreparing`, `downloadError`, `buyUrlNotLiveHint`) et tooltip d'aide `packFreeDownload` — FR/EN. Tooltip `packBuyable` existant mis à jour (son texte précédent était devenu inexact).

---

## [2026-07-25] — Master : mise à jour complète intégrant toute la session

**Fichiers touchés** : `LAYERPITCH_MASTER.md`

- Réécrit en partant de la version du 18 juillet fournie par Jules-Antoine (collée depuis un autre appareil, faute de pouvoir pousser un document depuis son téléphone) — intègre l'intégralité des chantiers de la session du 25 juillet (voir entrées ci-dessous et ci-dessus).
- Confirme, en vérifiant l'état réel des fichiers plutôt qu'en recopiant l'ancien statut, que la restructuration du backstage en onglets — listée "pas encore codée" le 18 juillet — était en réalité déjà terminée avant même le début de cette session (vérifié tout au début, avant toute autre tâche).
- Schéma de données mis à jour : trois nouvelles bibliothèques globales (`sfxLibrary[]`, `customFonts[]`, `socials[]`), nouveaux champs sur les packs (`sfxIds`, `linkedAdReelId`), nouveau modèle de thème par AdReel (`profile.theme` remplace `bgColor`/`textColor`), nouveaux types de bloc de contenu (`collections`, `sfx`).
- Redemandé à Jules-Antoine s'il voulait une intégration complète ou seulement la note ponctuelle demandée — a choisi l'intégration complète.

---

## [2026-07-25] — Réseaux sociaux : bibliothèque de comptes + boutons "Publier" pré-remplis sur Packs et Collections

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-beta-sync.js`, `admin-beta-console.html`

- Écart clarifié avant tout code : Jules-Antoine voulait initialement une "publication directe" sur les réseaux — impossible sans backend (OAuth, secrets), et impossible tout court pour Instagram/TikTok (pas d'API de publication ouverte) et pour X (API désormais payante pour cet usage). Version réaliste retenue après clarification : partage pré-rempli, un clic pour ouvrir la fenêtre de publication du réseau, pas de publication automatique.
- `layerpitch-backstage.html` : nouvel onglet "Réseaux sociaux" (section Compte), gestion de `socials[]` (plateforme + lien de référence) — 10 plateformes possibles, dont 5 "publiables" (X, Facebook, LinkedIn, WhatsApp, Telegram) qui font apparaître un vrai bouton "Publier" sur chaque pack et chaque collection ; les 5 autres (Instagram, TikTok, YouTube, SoundCloud, site web) gardées en simple aide-mémoire de lien, sans bouton (aucun mécanisme de partage pré-rempli de leur côté).
- Nettoyage automatique : supprimer ou changer la plateforme d'un réseau réactualise les boutons "Publier" affichés partout où c'est pertinent.
- Deux oublis trouvés et corrigés en préparant cette fonctionnalité, sans lien direct avec elle : `sfxLibrary` manquait au squelette de démarrage d'un nouveau testeur bêta depuis la Phase 1 du chantier Sfx (jamais rattrapé) ; ajouté en même temps que `socials`, dans `layerpitch-beta-sync.js` et `admin-beta-console.html`.
- Nouvelles clés i18n (FR/EN) et tooltip d'aide `publishToSocial`.

---

## [2026-07-25] — Bouton "Partager" sur les pages publiques + boutons "Partager" dans le backstage

**Fichiers touchés** : `player.js`, `index.html`, `pack.html`, `collection.html`, `layerpitch-backstage.html`

- `player.js` : nouvelle fonction partagée `shareOrCopy(url, title)` — utilise la Web Share API du navigateur si disponible (ouvre le menu natif : WhatsApp, Messages, Discord... surtout sur mobile), sinon copie le lien dans le presse-papier avec retour visuel. Exportée via `LayerPlayerCore`, réutilisée partout (pages publiques et backstage).
- `index.html`, `pack.html`, `collection.html` : bouton rond fixe en haut à droite (icône carré + flèche, glyphe de partage iOS) sur chaque page publique.
- `layerpitch-backstage.html` : bouton "Partager" ajouté à côté du bouton "Copier le lien" déjà existant pour l'AdReel en cours, et pour chaque pack et chaque collection (qui n'avaient jusqu'ici aucun lien direct affiché du tout — ajouté au passage).

---

## [2026-07-25] — Renvoi Pack → AdReel (partage d'un pack seul, hors Marketplace)

**Fichiers touchés** : `layerpitch-backstage.html`, `pack.html`

**Contexte** : répond à une question de Jules-Antoine sur l'intérêt d'envoyer un pack directement à un studio, sans passer par un AdReel complet — déjà techniquement possible (`pack.html?id=...` est déjà une page publique autonome) mais avec un vrai trou repéré en vérifiant : la page pack ne montrait ni nom, ni bio, ni contact, juste une ligne de crédit générique.

- `layerpitch-backstage.html` : nouveau champ `pack.linkedAdReelId` — sélecteur "Renvoi vers un AdReel" par pack, dans son propre onglet Contenu. Un pack supprimé ou un AdReel supprimé nettoie proprement les références qui pointaient dessus.
- `pack.html` : si un renvoi est configuré, lien visible "Voir le travail complet de {nom}" — le nom est lu directement depuis le titre renseigné dans le Header de l'AdReel visé (champ ajouté un peu plus tôt dans la session, voir Apparence Phase 4).
- Concrétise directement le principe produit déjà noté dans le master ("Les Packs restent des objets autonomes").

---

## [2026-07-25] — Passe d'éco-conception (audit RGESN 2024 / GR491)

**Fichiers touchés** : `index.html`, `pack.html`, `collection.html`

- Audit demandé par Jules-Antoine avec une grille de critères fournie (stratégie, architecture, UX/UI, contenus, frontend, backend, algorithmie/IA), classés par impact.
- Corrections appliquées après vérification précise du code réel, pas à l'aveugle :
  - `loading="lazy"` ajouté sur les images qui ne sont pas visibles au premier écran (photo bio, blocs photo, vignettes de packs/collections) — laissé de côté sur le logo du Header et les illustrations hero de pack/collection, déjà visibles au chargement.
  - Graisse 600 de Space Grotesk ajoutée à l'import Google Fonts (`index.html`, `pack.html`) : en vérifiant les graisses réellement utilisées avant toute réduction, un vrai bug de rendu a été repéré — deux titres s'affichaient en gras synthétique faute d'avoir la vraie graisse chargée.
- **Faux positif corrigé dans l'audit lui-même** : l'autoplay vidéo initialement signalé "Élevé" ne l'est pas — la vidéo ne se charge qu'au clic explicite du visiteur, jamais au chargement de la page (déjà commenté ainsi dans le code).
- Laissés en l'état, décision assumée et expliquée à Jules-Antoine : chargement d'Umami sans attendre d'interaction (compromis produit, pas juste technique) ; pipeline de compression/conversion WebP à l'upload d'image (chantier réel, mis de côté pour une session dédiée).

---

## [2026-07-25] — Passe d'audit complet du code (demandée explicitement) — plusieurs oublis trouvés et corrigés

**Fichiers touchés** : `player.js`, `index.html`, `pack.html`, `layerpitch-backstage.html`, `layerpitch-i18n.js`

- Vérification systématique sur tous les fichiers touchés dans la session : déclarations de fonctions/variables dupliquées (aucune), id HTML dupliqués (aucun), couverture i18n et tooltips d'aide (100 % après correction), classes CSS orphelines (aucune).
- **Régression trouvée et corrigée** : un `cp` accidentel plus tôt dans la session (au début de la Phase 2 du chantier Apparence) avait écrasé tout le travail i18n du bloc de contenu Collections fait en tout début de session — repéré en cherchant les clés Collections pour construire le bloc Sfx par analogie, entièrement restauré, revérifié par recoupement avec d'autres clés d'autres phases pour s'assurer qu'aucun autre écrasement du même genre n'était passé inaperçu.
- Clé i18n `trackSfxHint` manquante — trouvée et corrigée.
- Filtre de type de fichier incohérent sur l'upload d'une variation Sfx (`audio/*` au lieu de `.wav,audio/wav,.mp3,audio/mp3,audio/mpeg` utilisé partout ailleurs) — harmonisé.
- Classe CSS interne `.stingers` renommée en `.track-sfx-row` (`player.js`, `index.html`, `pack.html`) — cohérence terminologique avec le renommage stingers→Sfx fait plus tôt dans la session. Attribut `data-role="stingers"` jamais interrogé par le JS — retiré.
- Deux commentaires de code obsolètes mis à jour : le vocabulaire fermé des événements analytics (incomplet, manquait plusieurs événements ajoutés en cours de session), une référence à `admin-analytics.html` devenu obsolète.

---

## [2026-07-25] — Chantier Sfx — Phase 5 : Packs music/sfx/hybride

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`

- Sélecteur de Sfx ajouté à l'éditeur de pack, en plus du sélecteur de morceaux déjà existant. Badge de genre ("Musique"/"Sfx"/"Hybride") affiché à côté du titre de chaque pack — calculé automatiquement à chaque rendu depuis son contenu réel, jamais stocké.
- **Dette trouvée et corrigée au passage** : supprimer un Sfx de la bibliothèque ne nettoyait ses références nulle part (morceaux, packs, blocs de contenu) — corrigé, comme c'était déjà fait pour les morceaux et les polices personnalisées.
- Nouvelles clés i18n (`packSfxLabel`, `packKindMusic/Sfx/Hybrid`) et tooltip d'aide `packSfx` — FR/EN.

---

## [2026-07-25] — Chantier Sfx — Phase 4 : Ducking

**Fichiers touchés** : `player.js`

- Introduction d'un gain maître par morceau (`trackMasterGain`) — jusqu'ici, chaque mode de lecture (statique, vertical, vertical-random, séquentiel) connectait ses couches/générations directement à la sortie audio, sans point commun pour agir sur "tout le morceau en cours" en une fois. Les 5 points de connexion directe à la destination audio, à l'intérieur du lecteur de piste, routent désormais par ce gain unique.
- Au clic sur un bouton Sfx dont `duckMainTrack` est coché : rampe descendante rapide (0,08s) vers 35 % du volume, maintenue, puis rampe remontante plus douce (0,35s), calée pour que le morceau ait retrouvé son plein volume à peu près au moment où le Sfx s'éteint. Constantes regroupées à un seul endroit pour un réglage rapide.
- Réinitialisation systématique du gain maître à l'arrêt du morceau (manuel ou en fin naturelle), pour qu'un ducking en cours ne laisse jamais un morceau bloqué à volume réduit.
- **Niveaux non calés sur du contenu réel** : choix par défaut raisonnables, pas testés à l'oreille — Jules-Antoine informé explicitement que ce sont des valeurs de départ, à ajuster après écoute.

---

## [2026-07-25] — Chantier Sfx — Phase 3 : migration automatique, bouton Sfx d'un morceau, ducking préparé

**Fichiers touchés** : `layerpitch-backstage.html`, `player.js`, `pack.html`

- Migration automatique des anciens stingers déjà publiés (upload direct par morceau, jamais de round robin) vers la Sfx Library — une variation chacun au départ, enrichissable ensuite. Se déclenche une seule fois à l'ouverture d'un ancien `data.json`, avec message d'avertissement invitant à publier pour valider la migration (sinon elle se referait à la prochaine ouverture). Fichiers audio copiés vers leur nouveau dossier à la publication suivante — copie directe du contenu existant, sans décodage/réencodage.
- `layerpitch-backstage.html` : l'ancien bouton "Stingers" de l'éditeur de morceau (upload direct de fichier) remplacé par un sélecteur vers la Sfx Library — un morceau référence désormais des Sfx par id (`track.sfxIds`).
- `player.js` : le bouton Sfx d'un morceau tire désormais une variation round robin (aléatoire anti-répétition ou séquentielle, selon le réglage du Sfx) au lieu de jouer un fichier unique — nouvelle variable partagée `SFX_LIBRARY_BY_ID` + `setSfxLibrary()` pour que le rendu des morceaux résolve `track.sfxIds` sans threader ce paramètre dans toute la chaîne d'appel.
- Système de surcharge par AdReel adapté : le renommage du libellé d'un Sfx pour un morceau donné fonctionne désormais par id de Sfx plutôt que par index (nécessaire puisque les Sfx sont des entrées de bibliothèque partagées, pas des fichiers propres au morceau).
- `pack.html` : même branchement (`setSfxLibrary`) que `index.html`, pour que les boutons Sfx fonctionnent aussi sur les pages de pack.
- Fiche d'implémentation (texte et JSON) mise à jour pour décrire les Sfx attachés (nombre de variations, mode de lecture) au lieu des anciens stingers.
- Une erreur de syntaxe (apostrophe mal échappée dans une chaîne) trouvée et corrigée par la vérification systématique avant livraison.

---

## [2026-07-25] — Chantier Sfx — Phase 2 : bloc de contenu "Sfx"

**Fichiers touchés** : `player.js`, `layerpitch-backstage.html`, `index.html`

- `player.js` : 5 fonctions de calcul/dessin de waveform (jusqu'ici enfermées dans le lecteur de piste, mais ne dépendant d'aucune donnée de piste) hissées au niveau module — nécessaire pour les réutiliser sans dupliquer cette logique une troisième fois. Nouvelle fonction `buildSfxPlayer()` : lecteur autonome par Sfx — titre, description, une case cliquable par variation round robin (chacune avec sa propre forme d'onde), bouton "Play" principal qui tire une variation selon le réglage aléatoire/séquentiel et l'allume visuellement pendant qu'elle joue. Chargement dès l'affichage du bloc (les Sfx sont de courts one-shots, contrairement aux morceaux complets qui restent chargés à la demande).
- `layerpitch-backstage.html` : nouveau type de bloc de contenu "Sfx" (bouton "+ Bloc Sfx", sélecteur miroir de celui des Collections), publication.
- `index.html` : rendu du bloc, CSS dédié.

---

## [2026-07-25] — Chantier Sfx — Phase 1 : renommage stingers→Sfx, Sfx Library

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : chantier engagé après clarification d'architecture avec Jules-Antoine : les stingers existants étaient des fichiers uploadés directement sur chaque morceau (aucune bibliothèque partagée, aucun round robin) — ce qui était demandé est une vraie bibliothèque indépendante avec variations, référencée depuis les morceaux et un nouveau bloc de contenu.

- Renommage des libellés "Stinger(s)" → "Sfx" partout où affiché (FR/EN), "Bibliothèque" → "Bibliothèque musicale" dans la navigation.
- Nouvelle "Bibliothèque Sfx" (onglet + panneau dédié) — titre, description, mode de lecture des variations (aléatoire anti-répétition ou séquentiel), ducking à cocher, variations round robin avec upload de fichier chacune.
- **Décision prise en cours de route, signalée explicitement** : migration automatique des anciens stingers différée à la Phase 3 (quand le mécanisme du bouton change réellement de mécanisme), plutôt que faite immédiatement comme initialement prévu dans le découpage annoncé — migrer les données sans encore rebrancher la lecture publique dessus aurait fait disparaître les stingers déjà publiés le temps que les deux phases se rejoignent.
- Bug de manipulation trouvé et corrigé par la vérification syntaxique : une insertion de code avait supprimé par erreur la ligne d'ouverture du bouton "+ Morceau".

---

## [2026-07-25] — Chantier Apparence — Phase 4 : Header enrichi

**Fichiers touchés** : `index.html`, `layerpitch-backstage.html`

- `profile.title`/`profile.subtitle` remplacent l'ancien champ `tagline` unique — titre + sous-titre, avec repli automatique sur l'ancien contenu pour les AdReels déjà publiés (lu une fois, jamais réécrit).
- Logo et image de fond (générique par bloc, héritée de la Phase 3) peuvent désormais coexister — décision de Jules-Antoine après clarification (les deux options plutôt qu'un choix exclusif).
- Nouvelles classes `.header-title`/`.header-subtitle` remplacent `.logo-fallback`/`.logo-tag`.

---

## [2026-07-25] — Chantier Apparence — Phase 3 : image de fond + opacité

**Fichiers touchés** : `layerpitch-backstage.html`, `index.html`

- Général (thème de l'AdReel) et par bloc — calque de rendu séparé du contenu, pour que l'opacité de l'image n'affecte jamais la lisibilité du texte par-dessus.
- Upload d'image de fond avec le même principe de fichier en attente que le logo/la photo (mirroré au changement d'AdReel, uploadé à la publication).
- Point technique repéré et corrigé en cours de route : la première tentative pour l'opacité par bloc recopiait le contenu via `innerHTML`, ce qui aurait détruit silencieusement les gestionnaires d'événements déjà attachés (formulaire de contact, lecteur de morceaux) — corrigé pour déplacer les vrais nœuds DOM plutôt que les recopier.

---

## [2026-07-25] — Chantier Apparence — Phase 2 : polices

**Fichiers touchés** : `layerpitch-backstage.html`, `index.html`

- 12 Google Fonts pré-intégrées (mélange sans-serif/serif/display) + upload de polices personnalisées, réutilisables depuis n'importe quel AdReel ou bloc.
- La page publique n'injecte que les polices réellement utilisées par l'AdReel affiché, jamais toute la bibliothèque du compositeur — chargement Google Fonts ou `@font-face` dynamique selon le cas.
- Gestion des polices personnalisées (upload, renommage, suppression, avec repli propre sur "Par défaut" si une police utilisée quelque part est supprimée).

---

## [2026-07-25] — Chantier Apparence — Phase 1 : thème général + réglages par bloc

**Fichiers touchés** : `layerpitch-backstage.html`, `index.html`

- Remplace les deux anciens champs `profile.bgColor`/`textColor` par un thème complet : couleur de fond, couleur des titres, couleur du contenu — réglable au niveau de l'AdReel entier, et individuellement pour chaque bloc de contenu (bascule "Personnaliser" par champ, tous les types de blocs sans exception, y compris Header/Bio/Témoignages/Morceaux, décision actée avec Jules-Antoine avant de coder).
- Boîte de dialogue de conflit : si un réglage général est modifié alors qu'un ou plusieurs blocs l'ont déjà personnalisé, propose de garder les réglages par bloc ou de tout aligner.
- Repli automatique sur l'ancien schéma pour les AdReels déjà publiés avant ce changement.
- Architecture discutée et validée avec Jules-Antoine avant tout code, découpée en 4 phases dès le départ vu l'ampleur du chantier.

---

## [2026-07-25] — Fusion de la console admin et des analytics bêta-testeurs

**Fichiers touchés** : `admin-beta-console.html`, `layerpitch-beta-sync.js`

- `admin-beta-console.html` absorbe `admin-analytics.html` (devenu obsolète, à supprimer du dossier d'outils) — même connexion (organisation + token), vue générale (agrégée) + vue par testeur (panneau dédié sur chaque carte).
- `createTester()` initialise désormais `events.json` avec le nom choisi (`testerId`) dès la création du repo — un testeur apparaît par son nom dans les analytics dès la création, plus besoin d'attendre une première activité. Fait à la fois dans `admin-beta-console.html` et `layerpitch-beta-sync.js` (équivalent CLI), gardés synchronisés.
- Token GitHub du backstage compositeur (`layerpitch-backstage.html`) désormais retenu en `localStorage` plutôt qu'à recoller à chaque session — justifié par le fait qu'il s'agit d'un fichier ouvert en local, jamais servi ni publié.
- **Vrai bug trouvé en creusant** : le squelette de démarrage d'un nouveau testeur bêta copiait en réalité les blocs de contenu de l'AdReel **personnel** de Jules-Antoine (donc potentiellement des blocs texte/photo/packs propres à son portfolio), avec les 4 blocs vides (Header/Bio/Témoignages/Morceaux) seulement en repli si aucun AdReel personnel n'était trouvé. Simplifié pour toujours partir des 4 blocs vierges canoniques, peu importe le contenu de l'AdReel personnel — corrigé aux deux mêmes endroits (console + CLI).

---

## [2026-07-25] — Corrections initiales de session : seek séquentiel, bloc Collections public, waveform

**Fichiers touchés** : `player.js`, `index.html`, `layerpitch-backstage.html`

- `seekSequential` : la demande "Aller vers la fin" se perdait si le visiteur avançait la tête de lecture pendant le segment en cours (`stopSequential()` l'effaçait silencieusement) — corrigé en sauvegardant/restaurant l'état autour de l'appel.
- Le curseur visuel du bloc Outro se recalait à tort au début après un seek dans ce bloc précis, alors que l'audio jouait déjà correctement depuis la bonne position (durée restante après seek jetée à `null` pour les blocs terminaux) — corrigé.
- Nouveau bloc de contenu "Collections" sur la page publique d'un AdReel, en miroir exact du bloc "Packs" déjà existant.
- Waveform "plate sur la deuxième moitié" en mode séquentiel : diagnostiquée comme non-bug de calcul (la forme montrait bien le fichier réel dans son intégralité, queue de recouvrement crossfade comprise) mais comportement indésirable une fois confirmé par Jules-Antoine — rognage de l'affichage à la durée nominale pour les blocs Intro/Segment ajouté, Outro laissé intact (pas de notion de durée nominale, fin ouverte).

---

## [2026-07-20] — Mise en place réelle de l'organisation GitHub bêta (première fois en conditions réelles)

**Fichiers touchés** : organisation GitHub `layerpitch-beta` (infrastructure, hors code)

- Organisation `layerpitch-beta` créée (compte perso, plan gratuit), skip de l'ajout de membres (les bêta-testeurs n'ont jamais besoin d'être membres de l'organisation — accès uniquement via token scopé à leur repo).
- Repo `layerpitch-beta-template` créé en public, case "Template repository" cochée.
- Token d'administration fine-grained généré (`Resource owner` = organisation, `Repository access` = All repositories, permissions Contents + Administration en Read/write).
- Confirmation que `Julzantoine/layerpitch` (repo perso) reste inchangé : aucune modification nécessaire pour accueillir la bêta, tout se passe côté organisation séparée.

---

## [2026-07-20] — Correction de `admin-beta-console.html` : bug de synchronisation de `layerpitch-backstage.html` (bug réel, pas une question de configuration)

**Fichiers touchés** : `admin-beta-console.html`

- Symptôme rencontré lors du premier `promote` réel : `layerpitch-backstage.html` systématiquement ignoré ("introuvable dans le repo perso"). Cause confirmée en session : ce fichier n'est jamais publié sur GitHub par conception (outil local uniquement) — la console tentait de le lire via l'API GitHub sur le repo perso, où il ne peut structurellement pas se trouver.
- Correctif : ajout d'un champ d'upload local (`<input type="file">` + `FileReader`) dans le bloc "Promouvoir le template" — le fichier est fourni à la main à chaque promotion plutôt que lu depuis GitHub, gardé en mémoire pour la session uniquement.
- Vérifié en conditions réelles après correctif : `rollout` sur le premier repo testeur (« Bêta test #1 ») confirmé fonctionnel, backstage bien présent et ouvrable.
- Point non traité dans cette session, à corriger côté nommage : le nom "Bêta test #1" contient un espace et un accent, transformé par GitHub en `layerpitch-beta-B-ta-test-1` — recommandation de renommer en `test1` si ce repo est gardé comme avant-poste de test permanent.

---

## [2026-07-20] — Fausse alerte clarifiée : `collection.html`

**Fichiers touchés** : aucun (clarification uniquement)

- Signalé comme "introuvable" lors du premier `promote`, initialement suspecté comme un reliquat du renommage UI "pack" → "collection" (18 juillet, textes uniquement, notait explicitement que `pack.html` restait le nom de fichier réel). Clarifié en session : `collection.html` est en réalité un vrai fichier distinct, correspondant à une entité "Collection" (regroupement de plusieurs Packs) — sans lien avec ce renommage UI. La liste `ENGINE_FILES` de la console était déjà correcte (contenait bien les deux fichiers) ; aucune correction de code nécessaire sur ce point, seulement un doute levé.

---

## [2026-07-20] — Décision confirmée en session : repos testeurs publics, pas privés

- Recherche effectuée sur les tarifs GitHub actuels : GitHub Pages sur repo privé nécessite un plan payant (Team, ~4$/mois par utilisateur facturé — les bêta-testeurs eux-mêmes ne comptant pas comme utilisateurs facturés puisqu'ils n'ont jamais de compte GitHub propre). Décision confirmée par Jules-Antoine : rester sur repos publics (gratuit), le code n'ayant aucun secret en dur et les compositeurs étant censés déposer leurs morceaux avant de les exposer publiquement. Risque assumé, pas vérifiable côté outil (chaque testeur reste responsable d'avoir fait son propre dépôt).

---

## [2026-07-20] — Nouvelle fonctionnalité dans `admin-beta-console.html` : téléchargement d'un kit testeur prêt à l'emploi

**Fichiers touchés** : `admin-beta-console.html`

- Ajout du bouton "Télécharger le kit" par testeur dans la liste, utilisant JSZip (CDN) pour générer un `.zip` contenant `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js` (les trois fichiers dont le backstage a besoin en local pour fonctionner en `file://`, hypothèse posée puis confirmée fonctionnelle en test réel) et un fichier `LISEZMOI.txt`.
- Le token n'est volontairement jamais inclus dans ce zip — à transmettre séparément, par un canal distinct.
- `LISEZMOI.txt` mis à jour en session pour être bilingue (français puis anglais), avec un repère `TUTORIAL_PLAYLIST_URL` (actuellement vide) à remplir dès que la playlist de tutos vidéo existera — n'affiche la ligne correspondante que si l'URL est renseignée.

---

## [2026-07-20] — Contenus rédactionnels de lancement bêta (pas du code)

- Relecture d'une lettre de présentation aux bêta-testeurs : quelques coquilles identifiées (accords, une formule de fin ambiguë), suggestion d'ajouter une mention explicite du caractère public des repos avant l'upload de morceaux, nuance proposée sur la formulation du tracking (accès futur du testeur à ses propres stats, distinct du tracking Umami déjà actif côté Jules-Antoine), prudence suggérée sur l'engagement de date "courant 2027".
- Scénario rédigé pour une vidéo de présentation courte (~85 secondes, format screencast + voix off façon Wwise, sans apparition à l'écran) : problème → démo live (vertical-classic puis séquentiel) → aperçu du Backstage → appel à retours honnêtes. Traduction anglaise non faite dans cette session (délégée en externe, comme le reste des traductions du projet).

---

## [2026-07-18] — Session complète : Test Gameplay, aide à l'implémentation, mode séquentiel avancé, retour "pack", console admin bêta

**Fichiers créés durant cette session** : `collection.html`, `admin-beta-console.html`.
**Fichiers modifiés en profondeur** : `player.js`, `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`, `pack.html`, `index.html`, `layerpitch-beta-sync.js`, `layerpitch-i18n-editor.html`.
**Documents projet mis à jour** : `LAYERPITCH_MASTER.md`, `LAYERPITCH_CHANGELOG.md`, `LAYERPITCH_EXTENSIONS_ENVISAGEES.md` (sections 1.5/1.6 ajoutées en tout début de session).

**1. Mode Test Gameplay — écran intégré ou détachable, bouton son**
- `video-test.html` : bouton flottant (🔇/🔊) pour réactiver/couper le son de la vidéo elle-même (utile si elle embarque déjà ses propres fx/musique). Muet par défaut au premier affichage.
- `pack.html` : détection `window.screen.isExtended` — écran unique → vidéo intégrée dans un panneau sur la page ; multi-écrans détecté → fenêtre séparée comme avant, avec tentative de positionnement sur le second écran. Disposition adaptative (empilée sous 1280px, côte à côte au-delà).

**2. Aide à l'implémentation — réglage global + message public**
- `layerpitch-backstage.html` : section avec quatre cases à cocher (Wwise, FMOD, Unity, Unreal) — réglage global pour tout le site, pas par pack.
- `pack.html` : si au moins une case cochée, message public listant uniquement les logiciels cochés.

**3. Traduction du lien "fait partie du pack"**
- `player.js` : passait par du texte français en dur, jamais traduit en anglais — corrigé, passe par `t()` avec une vraie clé i18n FR/EN.

**4. Fiche d'implémentation générée par pack (texte + JSON)**
- `layerpitch-backstage.html` : bouton "Voir la fiche d'implémentation" par pack, ouvrant une fenêtre avec deux onglets (Texte/JSON), Copier/Télécharger. Générateur structuré mode par mode (statique, vertical, vertical-random, séquentiel), description neutre/trans-middleware.
- Nouveau champ "Note d'implémentation" libre par morceau (jargon spécifique à un moteur autorisé, contrairement au reste de la fiche).

**5. Gros chantier de fond (backlog compilé en une fois)**
- Renommage complet de l'UI "pack" → "collection" (première passe, **annulée plus tard dans la session**, voir point 14).
- Présentation bilingue FR/EN des packs, avec repli sur l'autre langue si l'une est vide.
- Vignette d'illustration des packs dans le bloc "Packs" d'un AdReel.
- Redesign du message "Aide à l'implémentation" en badge discret.
- Correctif waveform du mode séquentiel figée après un changement de taille (`ResizeObserver` manquant).
- Recherche Wwise (format des tutos vidéo — épisodes courts, chaîne Audiokinetic) pour préparer une future série de tutos.

**6. Relecture complète #1 (demandée explicitement)**
- **Bug trouvé** : deux fonctions `buildPackSelectorWidget` déclarées (une préexistante pour le bloc Packs d'un AdReel, une recréée par erreur pour les Collections) — la plus tardive écrasait l'autre silencieusement. Doublon supprimé, clés i18n orphelines retirées.
- Vérifications systématiques (symétrie FR/EN, clés orphelines, `ZONE_ORDER` des éditeurs, `getElementById`) — tout confirmé propre après correctif.

**7. Waveforms affinées**
- `player.js` : résolution calculée dynamiquement selon la largeur réelle affichée (au lieu d'un nombre de barres fixe), barres arrondies et aérées, léger lissage — les trois usages (statique, vertical-random, séquentiel) partagent maintenant le même code de rendu (`renderWaveformPair`).

**8. Compilation des changelogs partiels + dates reconstruites**
- Recherche dans le project knowledge de plusieurs changelogs partiels non visibles depuis l'explorateur de fichiers — historique complet du 1er au 18 juillet reconstitué dans `LAYERPITCH_CHANGELOG.md`.
- Date du fix iOS/Safari corrigée : le 11 juillet (date exacte retrouvée), pas le 12 approximatif retenu au départ.

**9. Sauvegarde / restauration / notification pour la bêta GitHub**
- Discussion d'architecture avant code (limite du nombre de sauvegardes, permissions du token, canal de notification au testeur).
- `layerpitch-beta-sync.js` : `rollout` crée automatiquement une branche de sauvegarde (`backup-AAAA-MM-JJ[-HHhMM]`) avant toute modification, jamais de purge automatique. Nouvelles commandes `restore <nom> [branche] [--notify]`, `list-backups <nom>`, `notify <nom|--all> --fr "…" --en "…"` (bandeau d'alerte dans le Backstage du testeur, fusion ciblée d'un seul champ `data.backstageNotice`, jamais un remplacement de contenu).
- `layerpitch-backstage.html` : bandeau d'alerte affiché si `data.backstageNotice` présent, bouton "J'ai vu" qui republie le `data.json` du testeur pour l'effacer.

**10. Console admin bêta (nouveau fichier)**
- `admin-beta-console.html` : interface web reprenant toute la logique de `layerpitch-beta-sync.js` (mêmes fonctions), pour piloter promote/create/rollout/restore/notify sans taper de commandes dans un terminal. Liste des testeurs, panneau "Sauvegardes" dépliable par testeur.

**11. Réharmonisation avec du code généré dans un autre canal (plusieurs fois)**
- **Repos testeurs passés en public** (`private: false`) — décision confirmée après avoir expliqué l'implication (contenu visible publiquement), appliquée dans `layerpitch-beta-sync.js` et `admin-beta-console.html`.
- **Bug préexistant trouvé** : `layerpitch-backstage.html` n'est jamais poussé sur le repo perso GitHub (outil local, jamais publié) — `promote()` essayait de le lire via l'API GitHub et échouait silencieusement depuis le début. Corrigé (lecture locale sur disque côté script Node, upload manuel côté console web).
- **Kit testeur téléchargeable** adopté (bouton par testeur, `.zip` via JSZip) — `player.js` ajouté à la liste des fichiers empaquetés (oublié dans la version reçue, aurait cassé l'aperçu local du testeur).
- README du kit rendu bilingue (langue du testeur) + ligne vers une playlist de tutos vidéo, uniquement si son URL est renseignée (vide tant qu'elle n'existe pas).

**12. Corrections du master (à la demande, en vérifiant)**
- "Structure à trois concepts" → **quatre concepts**, `collections[]` manquant ajouté (+ liste des onglets sidebar backstage, qui n'incluait pas non plus Collections).
- Modes de lecture hybrides (décidés dans une autre conversation) ajoutés au master, avec pointeur vers `LAYERPITCH_EXTENSIONS_ENVISAGEES.md` section 0 — signalé mais **pas fusionné** : une section stratégie de communication (Guy Michelmore, ThinkSpace, cible bêta) mise à jour dans cette même autre conversation, restée en attente d'une décision explicite sur la méthode de fusion. *(Point resté en suspens à la fin de cette session.)*

**13. Renommage "layering vertical" → "layering vertical additif" + modes grisés**
- Vérification exhaustive de toute occurrence avant renommage (aucune collision trouvée, contrairement au précédent connu du projet). Renommage du texte affiché uniquement, identifiant interne `mode: 'vertical'` inchangé.
- Trois nouveaux modes hybrides ajoutés en grisé dans le menu déroulant du mode (Backstage), aux côtés de "Embranchement (à venir)" — signal visible que d'autres modes sont envisagés.

**14. Retour en arrière complet "collection" → "pack" + nouvelle entité Collection**
- Le vocabulaire UI redevient "pack" partout (annule le point 5) ; "Collection" désigne désormais un **regroupement de packs**, un niveau au-dessus.
- Nouveau fichier `collection.html` (page publique dédiée), nouvel onglet "Collections" dans le Backstage (titre, illustration, présentation bilingue, sélecteur de packs à inclure).
- Mention "Fait partie de la collection : X" sur `pack.html`. Vignette d'illustration des packs listés. Redesign du message "Aide à l'implémentation" en badge discret (repris tel quel après le retour en arrière).

**15. Mode séquentiel — emplacements multiples chaînés, duplication, répétitions**
- `track.segments[]` (pool plat) remplacé par `track.segmentSlots[]` — emplacements chaînés dans un ordre défini et réordonnable, chacun avec son propre pool d'alternatives. Structure confirmée : Intro → Séquence A → B → C → ... → reboucle sur A, jusqu'à "Aller vers la fin" → Outro.
- **Duplication de pool** (économie mémoire), pour les emplacements séquentiels *et* les groupes vertical-random : un emplacement/groupe peut référencer le contenu d'un autre déjà défini plutôt que de recharger deux fois les mêmes fichiers — anti-répétition partagée entre les occurrences d'un même pool dupliqué.
- **Répétitions par emplacement** (`repeatCount`) — combien de fois un emplacement rejoue avant de passer au suivant, pour une structure type AABA sans dupliquer l'emplacement lui-même.
- Garde-fou ajouté : un emplacement qui sert déjà de source à d'autres ne peut pas à son tour devenir un duplicata (empêche une chaîne de références à deux niveaux, non gérée par le lecteur).

**16. Relecture complète #2 (trois bugs réels trouvés)**
- Plantage en exécution (`rerollPool()` appelait `.map()` sur un objet, hérité d'avant la conversion en clé canonique).
- Anti-répétition cassée pour tous les groupes vertical-random (lecture d'une clé au mauvais format).
- Gain de correction et libellé ignorés pour les emplacements/groupes dupliqués (résolution du mauvais objet source) — corrigé via `resolveSlotAlternative()`.

**17. Correctifs beta-sync découverts en compilant le changelog**
- `layerpitch-i18n-editor.html` : `ZONE_ORDER` ne listait pas la nouvelle zone `collection` — une sauvegarde depuis cet outil aurait silencieusement supprimé toute la zone.
- `layerpitch-beta-sync.js` : `collection.html` (nouveau fichier) manquait dans `ENGINE_FILES` — lien mort pour un testeur.

**18. Certification "sans IA"**
- Réglage global (case à cocher + texte légal complet affiché en clair dans le Backstage), exception possible par morceau (suivre le réglage global / toujours certifier / ne jamais certifier).
- Badge public à côté du titre du morceau — d'abord en texte encadré, puis **rendu plus discret** sur demande : petite icône graphique (bouclier + coche), tooltip au survol. Si **tout** un bloc rendu est certifié, un seul badge apparaît une fois à côté de "Musique" plutôt que de répéter l'icône sur chaque ligne.
- Bloc "Je certifie…" du Backstage également allégé (plus de cadre, texte discret).

**19. Relecture complète #3 (un oubli trouvé)**
- L'aperçu local "▶ Écouter" du Backstage appelait la fonction de rendu sans les nouveaux paramètres — le badge sans IA n'aurait jamais reflété le réglage global dans l'aperçu. Corrigé.

**20. Option d'achat pour les collections**
- Mêmes champs `buyable`/`buyUrl` que pour un pack, même UI Backstage, même bouton d'achat sur `collection.html` — indépendant du bouton d'achat de chaque pack qui compose la collection.

**21. Diagnostic d'une erreur de chargement sur `collection.html`**
- Logique de chargement comparée ligne à ligne à `pack.html`/`index.html` — identique, aucun bug de fond trouvé.
- Erreur avalée silencieusement dans les trois pages publiques (aucune trace en console) — corrigé, `console.error()` ajouté avant le message affiché au visiteur.
- Trou séparé trouvé en vérifiant : `collection.html` charge `player.js` mais n'était pas inclus dans la réécriture automatique de version à la publication (`updatePlayerScriptVersion`) — corrigé.
- Cause exacte de l'erreur d'hier non confirmée avec certitude (fichier pas encore re-uploadé au moment du test, ou propagation du cache GitHub Pages) — à reproduire avec la console ouverte pour trancher définitivement si ça se reproduit.

**22. Note de sécurité ajoutée au master**
- Principe "ne jamais faire confiance au client" (retour d'expérience externe sur un cas de triche de leaderboard déjoué par Row Level Security + RPC côté serveur) noté dans la section Bascule backend — à appliquer le jour où LayerPitch aura de vrais comptes/paiements.

---

## [2026-07-16] — (Ré)implémentation du tracking d'usage interne du backstage

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`

**Contexte** : suite du chantier "bêta multi-github" — le master mentionnait ce système comme "implémenté, non testé en conditions réelles", mais un audit exhaustif (fait dans le cadre de la revue de `admin-analytics.html`) a confirmé son absence totale du backstage actuel. Reconstruit entièrement, avec le format exact déjà attendu par `admin-analytics.html` (jamais modifié) : `{ testerId, events: [{ type, name, ts, context, detail }] }`.

**Architecture** :
- Vocabulaire fermé : `tab_switch`, `track_add`, `track_delete`, `pack_add`, `pack_delete`, `adreel_add`, `adreel_delete`, `block_add`, `preview_play`, `publish_click`, `publish_success`. Erreurs capturées automatiquement (`window.onerror` + `unhandledrejection`), sans action du testeur.
- Tamponné en `localStorage` (`layerpitch_backstage_events_buffer`) — jamais son propre appel réseau, aucune latence perçue, aucune dépendance à un service tiers.
- Case **"Mode test"** dans le fieldset Dépôt GitHub, persistée en `localStorage`, distingue `context: "real"` de `context: "test"` — permet à Jules-Antoine de tester l'outil sans polluer les vraies statistiques d'usage des testeurs.
- À la publication : le tampon est fusionné avec l'`events.json` existant du repo (jamais un écrasement — plusieurs sessions/navigateurs pourraient sinon se marcher dessus), publié, puis le tampon local est vidé. Échec silencieux si la fusion échoue (le tampon reste intact, retenté à la prochaine publication) — ne doit jamais faire capoter une publication réelle.
- FR/EN comme le reste du backstage (nouvelle clé `modeTestLabel`) ; bulle d'aide ajoutée (`modeTestToggle`, zone `misc`).

**Vérification** : syntaxe validée sur les 3 fichiers, cycle complet testé en conditions réelles (Node/jsdom, GitHub simulé en mémoire) — changement d'onglet, ajout de morceau, ajout de bloc capturés dans le tampon ; publication déclenchée ; `publish_click`/`publish_success` ajoutés ; tampon fusionné et publié dans `events.json` avec la structure exacte attendue par `admin-analytics.html` ; tampon local vidé après succès.

---

## [2026-07-16] — Tracking Umami : interactions d'adaptativité (intensité, solo/mute, stingers, rafraîchissement)

**Fichiers touchés** : `player.js`

**Contexte** : suite du chantier "tracking Umami par AdReel/Pack" (voir entrée précédente, menée dans une autre session le même jour) — celle-ci couvrait déjà `track_play`, `track_loop_change`, `go_to_end_click`, `contact_submit`, `video_test_open`/`invalid_url`, tous enrichis automatiquement du contexte `adreel`/`pack` via `window.__lpTrackContext`. Il manquait les interactions propres à l'adaptativité elle-même.

**⚠️ Note de synchronisation** : au moment de reprendre ce chantier, les copies de travail locales n'avaient pas cette avancée (menée ailleurs). Resynchronisé depuis les fichiers du projet avant toute modification pour ne rien écraser — `layerpitch-backstage.html` avait également reçu une fonctionnalité de couleur de fond locale au même moment, préservée intacte.

**Changement** : quatre nouveaux événements, tous bénéficiant automatiquement du même enrichissement de contexte (`adreel`/`pack`) que les événements existants, aucune modification du mécanisme lui-même nécessaire :
- `intensity_change` — clic sur une puce d'intensité (mode vertical layering), `{ trackId, level }`.
- `voice_solo_toggle` / `voice_mute_toggle` — bascule solo ou muet sur une voix individuelle (couche fixe, groupe aléatoire, ou couche classique selon le mode), `{ trackId, voice, active }`.
- `stinger_play` — déclenchement manuel d'un stinger, `{ trackId, stingerIndex }`.
- `pool_refresh` — clic sur "Rafraîchir le pool" (mode vertical-random), `{ trackId }`.

**Vérification** : testé en conditions réelles (Node/jsdom, `window.umami.track` intercepté) sur `index.html` avec le vrai `data.json` — clic simulé sur une puce d'intensité et un bouton solo, événements `intensity_change` et `voice_solo_toggle` confirmés reçus avec `adreel: "main"` correctement attaché.

---

## [2026-07-16] — `layerpitch-beta-sync.js` : audit complet + deux correctifs (ENGINE_FILES obsolète, rollout non résilient)

**Fichiers touchés** : `layerpitch-beta-sync.js`

**Contexte** : reprise du chantier "bêta multi-testeurs" resté en pause depuis le 14 juillet. Le script n'était pas dans le projet (jamais uploadé après sa rédaction initiale) — récupéré auprès de Jules-Antoine puis audité en détail contre l'état réel actuel des fichiers moteur et du schéma `data.json`.

**Bug 1 — `ENGINE_FILES` obsolète** : ne listait que `index.html`, `pack.html`, `player.js`, `layerpitch-backstage.html`. Or `layerpitch-i18n.js` (chargé par ces quatre fichiers **et** `video-test.html`) et `layerpitch-help.js` (chargé par le backstage) ont été créés après ce script et n'y avaient jamais été ajoutés. Sans correctif, chaque repo testeur créé via `create` se serait retrouvé avec des clés de traduction brutes affichées à l'écran, aucune bulle d'aide, et une page "Mode Test Gameplay" cassée (404 sur `video-test.html`, jamais copié). `ENGINE_FILES` étendue à 7 fichiers. `layerpitch-i18n-editor.html`/`layerpitch-help-editor.html` restent volontairement exclus (outils locaux, jamais destinés aux repos testeurs).

**Bug 2 — `rollout` non résilient à l'échec d'un repo** : aucun `try/catch` autour du traitement par repo — un seul testeur en échec (repo supprimé, accès token, erreur réseau ponctuelle) interrompait tout le processus, y compris en `rollout --all` sur l'ensemble des testeurs. Corrigé : chaque repo est maintenant traité indépendamment, un échec est journalisé et reporté en fin d'exécution (nouvelle catégorie "en échec", distincte des repos ignorés pour incompatibilité de schéma), sans jamais bloquer le traitement des suivants.

**Vérifications effectuées** (au-delà des deux bugs) : schéma de `buildStarterDataJson` comparé champ par champ au vrai `data.json` de production (clés de `profile`, types de blocs `text`/`photo`/`video`/`packs`/`contact`/singletons) — cohérent, aucun écart. Substitution owner/repo dans le backstage du template — un seul `value="Julzantoine"`/`value="layerpitch"` dans le fichier actuel, pas de risque de remplacement partiel.

**Vérification (Node, GitHub simulé en mémoire avec les vrais fichiers du projet)** : `promote` → les 7 fichiers moteur + `data.json` (squelette) correctement copiés et régénérés, ordre des blocs et champs vidés conformes à l'AdReel "main" réel ; `create` → repo testeur simulé, placeholder `__TESTER_REPO__` correctement remplacé par le vrai nom de repo ; `rollout` ciblé → mise à jour correcte ; `rollout` avec un repo inexistant au milieu du lot → échec isolé et journalisé, les autres repos traités normalement, script non interrompu.

**Reste à faire côté Jules-Antoine avant la première utilisation réelle** (inchangé depuis le 14 juillet, toujours valable) : créer l'organisation GitHub dédiée à la bêta, renseigner son nom dans `CONFIG.BETA_ORG`, créer le repo `layerpitch-beta-template` dans cette organisation et cocher "Template repository" dans ses paramètres GitHub, générer un token fine-grained avec accès au repo perso et à l'organisation bêta.

---

## [2026-07-16] — Bug : l'ordre des blocs n'était pas conservé à l'import d'un AdReel source

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : signalé par Jules-Antoine — en créant un nouvel AdReel en important le contenu d'un autre, la Bio se retrouvait toujours en 2ᵉ position même si elle avait été déplacée tout en bas dans l'AdReel source.

**Diagnostic** : `freshBlocks()` (ordre figé `header → bio → testimonials → tracks`) servait de base à **tout** nouvel AdReel, y compris ceux créés par import ; les blocs "extra" (texte/photo/vidéo/packs/contact) de la source étaient ensuite collés à la fin via `cloneExtraBlocks()`. La position réelle des blocs dans la source n'était donc jamais lue.

**Changement** : `cloneExtraBlocks()` remplacée par `buildBlocksForNewAdReel(source, importExtraBlocks)`, qui reconstruit la liste de blocs dans l'**ordre exact** de `source.blocks` quand une source est utilisée (les cases à cocher du formulaire d'import ne contrôlent que le **contenu** copié — profil, témoignages, morceaux — jamais la position des blocs). `freshBlocks()` reste utilisée telle quelle pour un AdReel vraiment vierge (aucune case cochée, ou aucune source choisie).

**Vérification** : logique testée isolément (Node) sur le cas signalé (bio déplacée en dernier dans la source) — l'ordre du nouvel AdReel reproduit exactement celui de la source.

---

## [2026-07-16] — Sidebar backstage : regroupement visuel de la section AdReel

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : retour direct de Jules-Antoine sur une capture — la hiérarchie de la sidebar (Bibliothèque/Packs vs sélecteur d'AdReel vs Contenu/Apparence) n'était pas assez lisible visuellement, contrairement au bouton de retour bêta (encadré en pointillés) qui, lui, se distinguait bien.

**Changement** : le sélecteur d'AdReel (menu déroulant, +Nouveau/Suppr., lien public) et les boutons "Contenu"/"Apparence" sont désormais regroupés dans un même cadre visuel (fond légèrement grisé, bordure arrondie) — rend explicite que ces trois éléments concernent tous l'AdReel actuellement sélectionné, par opposition à "Bibliothèque"/"Packs" au-dessus (globaux, partagés entre tous les AdReels). Un doublon du bouton "Apparence" introduit lors d'une édition précédente a été supprimé au passage.

---

## [2026-07-16] — Formulaire de retour bêta dans le backstage

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-i18n.js`, `layerpitch-help.js`

**Contexte** : jusqu'ici, le retour des bêta testeurs passait uniquement par un contact manuel (mail/message, voir `LAYERPITCH_TUTO_BETA_TESTEURS.md`). Objectif : un moyen direct depuis le backstage, sans en sortir.

**Décisions actées avant codage** : endpoint Formspree fixe appartenant à Jules-Antoine (pas celui du testeur — sinon chaque testeur recevrait ses propres retours au lieu de les envoyer) ; contexte du repo testeur (`owner/repo`) inclus automatiquement dans l'envoi ; bouton discret et permanent dans la sidebar plutôt qu'un nouvel onglet ; fait partie des fichiers "moteur" à promouvoir vers le template bêta (`layerpitch-beta-sync.js` → `promote`), comme `index.html`/`pack.html`/`player.js`/`layerpitch-backstage.html`.

**Changement** : bouton "Faire un retour sur la version" en bas de la sidebar, ouvrant une modale (même pattern visuel que les modales existantes — lien, nouvel AdReel) avec un simple champ message. À l'envoi : POST vers Formspree avec le message, le repo (`owner/repo`) et un sujet auto-généré. FR/EN comme le reste du backstage (nouvelles clés dans `layerpitch-i18n.js`, zone `backstage`) ; bulle d'aide contextuelle ajoutée (nouvelle zone `misc` dans `layerpitch-help.js`).

**Endpoint** : réutilise le même Formspree que le formulaire de contact public (`https://formspree.io/f/mojognrj`, compte Jules-Antoine) — décision prise pour éviter de créer un second formulaire ; les deux flux se distinguent dans la boîte mail via le sujet auto-généré (repo/testeur).

**Vérification** : syntaxe validée, testé en conditions réelles (Node/jsdom) — ouverture de la modale, saisie, envoi intercepté et inspecté (contenu du `FormData` confirmé correct : message, repo, sujet), message de confirmation affiché.

---

## [2026-07-16] — Bulles d'aide contextuelle : moteur + première section (Bibliothèque)

**Fichiers touchés** : `layerpitch-backstage.html`, `layerpitch-help.js` (nouveau), `layerpitch-help-editor.html` (nouveau)

**Contexte** : chantier identifié depuis plusieurs sessions ("aide contextuelle dans le backstage"), deux décisions bloquantes tranchées cette session : portée = tous les contrôles, rédaction = Claude écrit les textes (éditables ensuite par Jules-Antoine), langue = FR/EN suivant la langue du backstage (même mécanisme que `tr()`).

**Architecture** (même principe que l'i18n) :
- Attribut `data-help="clé"` posé sur les libellés/contrôles concernés — aucune modification des contrôles existants.
- `layerpitch-help.js` : nouveau fichier séparé de `layerpitch-i18n.js` (contenu pédagogique, pas de la traduction d'interface), structure `{ fr: { zone: {...} }, en: { zone: {...} } }`. Une seule zone au départ : `library`.
- Moteur générique dans `layerpitch-backstage.html` : un seul listener délégué sur `document` (`mouseover`/`mouseout`, pas `mouseenter`/`mouseleave` qui ne remontent pas — indispensable puisque le contenu se reconstruit en permanence via `innerHTML`), délai d'affichage ~500ms, positionnement automatique au-dessus ou en dessous selon la place disponible.
- `layerpitch-help-editor.html` : nouvel éditeur, sur le modèle de celui de l'i18n, mais les deux langues sont éditables directement (pas un flux de traduction depuis un français figé, puisque c'est du contenu rédigé, pas traduit) — inclut suppression de clé.

**Portée finale (toutes sections couvertes)** : 47 bulles au total. `library` (20), `packs` (7), `appearance` (3), `github` (4), `content` (12 — endpoint Formspree, alignement de bloc, tagline/logo/email/site du Header, photo/texte du Bio, sélecteur de morceaux du bloc Tracks, surcharges de texte par AdReel, lien/vignette vidéo), `misc` (1 — bouton de retour bêta). Champs simples et auto-explicites (titre, nom d'une couche/segment, auteur d'un témoignage) restent volontairement sans bulle — à réévaluer au cas par cas si besoin.

**Vérification** : syntaxe validée sur les 3 fichiers, moteur testé en conditions réelles (Node/jsdom) — affichage après délai, texte correct, disparition au survol sorti, bascule FR→EN confirmée par un changement direct de `tHelp()`.

**Statut** : chantier considéré complet pour la portée "tous les contrôles non-triviaux" validée en début de session — reste ouvert si Jules-Antoine identifie des champs "simples" qui mériteraient quand même une bulle à l'usage.

---

## [2026-07-16] — Traduction complète du dictionnaire i18n (FR → EN)

**Fichiers touchés** : `layerpitch-i18n.js`

**Contexte** : Toutes les valeurs anglaises du dictionnaire (zones `shared`, `index`, `pack`, `player`, `backstage`, `videoTest`) étaient vides depuis la mise en place du système i18n — seul le français était rempli.

**Changement** : les 347 clés anglaises vides ont été traduites à partir de leur équivalent français, zone par zone. Le vocabulaire technique standard du game audio (Wwise, layering, stinger, BPM, AdReel, etc.) a été conservé tel quel plutôt que traduit littéralement. Les placeholders (`{n}`, `{label}`, `{path}`, `{title}`, etc.) ont été préservés à l'identique, position vérifiée par script pour chaque paire FR/EN. Le bloc `fr` n'a pas été touché (diff vérifié identique à l'original).

**Vérification** : syntaxe validée, aucune valeur anglaise vide restante, rendu réel testé en environnement Node/jsdom avec `lang: 'en'` sur un AdReel réel (`index.html` + `player.js` + le nouveau dictionnaire) — libellés d'interface bien en anglais, contenu du compositeur (témoignages, titres) resté intact dans sa langue d'origine.

**Point de vigilance pour la suite** : ces traductions sont une première passe automatisée, pas une relecture par un locuteur natif — à faire relire si le AdReel anglais est destiné à un studio/éditeur important.

---

## [2026-07-16] — Bug critique : collision globale `t` avec le décodeur Ogg Vorbis (site public + backstage vides)

**Fichiers touchés** : `index.html`, `pack.html`, `layerpitch-backstage.html`

**Contexte** : Après la mise en place du système i18n FR/EN, le backstage local s'affichait vide (sidebar et boutons visibles, mais aucun contenu — bibliothèque, packs, AdReel — ne se chargeait). Une fois republié sur GitHub, le site public (`index.html`) présentait le même symptôme : page quasi blanche.

**Diagnostic** :
- Premier correctif tenté (insuffisant) : `currentLang()` dans le backstage utilisait `localStorage.getItem(...)` sans `try/catch`, contrairement à `player.js` qui protège déjà cet accès. Corrigé par précaution, mais ce n'était pas la cause racine (l'erreur réelle survenait ailleurs).
- Pistes écartées après tests : extension de navigateur (persistant en navigation privée), cache/déploiement GitHub Pages stale (le code livré via Cmd+U était identique au code source), fichier `layerpitch-i18n.js` corrompu ou désynchronisé (identique en MD5 à la version testée), bug de logique dans le code métier (aucune reproduction obtenue via un environnement Node/jsdom exécutant le vrai code avec le vrai `data.json`, sur les 3 AdReels réels).
- Instrumentation du `catch` de `init()` avec un `console.error` a révélé l'erreur réelle, jusque-là masquée : `TypeError: t is not a function`, survenant dès le tout premier appel à `applyI18n()`.
- **Cause racine trouvée** : le fichier tiers `ogg-vorbis-decoder.min.js` (chargé via `<script defer src="https://unpkg.com/@wasm-audio-decoders/ogg-vorbis/...">`) déclare, à la racine de son bundle minifié (hors de toute IIFE), `var t, s; t = this; ...`. Chargé comme script classique (pas de module, pas isolé), cette déclaration devient `window.t` et écrase silencieusement la fonction de traduction globale `t()` définie dans `index.html`, `pack.html` et `layerpitch-backstage.html` — juste avant l'événement `load`, donc juste avant que `init()` ne s'exécute.
- `player.js` n'était pas affecté : sa propre fonction `t()` interne vit dans une IIFE, isolée de cette collision globale.
- Confirmation par reproduction fidèle : un faux script simulant exactement ce `var t; t = this;` a reproduit l'erreur exacte sur la version non corrigée, et a tourné sans erreur sur la version corrigée.

**Changement** : renommage de la fonction de traduction globale `t()` → `tr()` dans les trois fichiers concernés (déclaration + tous les appels, ~335 occurrences au total). Les usages locaux non liés (`.forEach(t => ...)`, `t.id`, `t.title`, etc., où `t` désigne un morceau/testimonial et non la traduction) n'ont pas été touchés — ils ne posent aucun problème, la collision ne concernait que la fonction globale. `player.js`, `layerpitch-i18n.js` et `video-test.html` inchangés.

**Point de vigilance pour la suite** : éviter les noms de fonctions globales trop génériques (`t`, `s`, `e`, etc.) dans tout fichier chargé comme script classique (non-IIFE, non-module) — ce type de collision avec des bundles tiers minifiés est difficile à diagnostiquer (l'erreur apparaît loin de sa cause réelle) et silencieux tant qu'on ne regarde pas l'erreur brute (elle était masquée par le `catch` qui affichait un message générique).

---

## [2026-07-06] — Fenêtres dépliables du backstage, convertisseur multi-format, consolidation

**Fichiers touchés** : `layerpitch-backstage.html`

**Contexte** : Le formulaire du backstage s'allongeait à mesure que blocs/morceaux/packs s'accumulaient. Deux améliorations notées comme faisables immédiatement (sans dépendance à un système de comptes), extraites des pistes "petites améliorations" du document d'extensions.

**Changement** :
- Ajout d'une flèche ▾/▸ de repli/dépli sur chaque carte de bloc (Header, Bio, Témoignages, Musique, Packs, Texte, Photo, Vidéo), sur chaque morceau individuel et sur chaque pack individuel, sans toucher aux données ni à l'ordre. *Retour utilisateur : la flèche est jugée trop discrète visuellement — amélioration à prévoir.*
- Convertisseur audio étendu au MP3 en entrée (en plus du WAV) : le décodage `decodeAudioData` du navigateur gère nativement les deux formats, aucune librairie de décodage supplémentaire n'a été nécessaire. Changement limité aux attributs `accept` des sélecteurs de fichier et au renommage de la fonction `wavFileToOgg` → `audioFileToOgg` (purement cosmétique/clarté).
- Basculement du thème visuel du backstage vers un fond blanc (demande esthétique, aucun changement fonctionnel).
- Ajout du champ HTML d'un sélecteur de couleur pour le fond du backstage lui-même (`#backstageBgColor`) — **câblage JavaScript non terminé** (pas de persistance ni d'application effective à ce stade). À reprendre via `localStorage` (légitime ici, fichier ouvert localement hors du cadre des artifacts Claude).
- Correction de couleurs résiduelles du thème sombre oubliées lors du passage au thème clair (`color:#ccc` illisible sur fond blanc → `#444`).
- Rédaction d'un master consolidé complet (architecture, schéma de données, comportement du lecteur, bugs, roadmap, extensions envisagées, modèle économique) à repousser dans le Project.

---

## [2026-07-05] — Apparence personnalisable, page publique élargie, corrections visuelles

**Fichiers touchés** : `index.html`, `pack.html`, `layerpitch-backstage.html`

**Contexte** : Retour sur l'esthétique après plusieurs jours centrés sur le fonctionnel. Demande de personnalisation de couleurs (page publique et pages de pack), et deux défauts visuels remontés par capture d'écran (vignette vidéo custom assombrie inutilement, images de grille ne remplissant pas la largeur, logo trop petit).

**Changement** :
- Nouvelle section "Apparence" dans le backstage : deux sélecteurs de couleur (fond, texte) appliqués à `index.html` via `profile.bgColor`/`profile.textColor`, injectés en JS sur les custom properties CSS `--bg`/`--text` au chargement.
- Chaque pack gagne ses propres `bgColor`/`textColor`, indépendants de la page principale, appliqués sur `pack.html` de la même façon.
- Page publique élargie de 760px à 1100px (demande explicite de se rapprocher de la largeur utilisée par ReelCrafter).
- Grilles photo (`.photo-grid`) et vidéo multi-items (`.video-grid-multi`) passées d'un nombre de colonnes fixe (3, ou calculé par racine carrée) à `grid-template-columns: repeat(auto-fit, minmax(...))` : remplissage automatique de toute la largeur disponible en une seule ligne quand la place le permet, sans reste isolé.
- Suppression du dégradé sombre systématique plaqué sur les vignettes vidéo avec image (pensé pour la lisibilité du titre superposé) : assombrissait des vignettes ayant déjà leur propre design/texte intégré sans qu'aucun titre n'ait besoin d'être protégé. Remplacé par un `text-shadow` porté uniquement par le texte du titre, l'image reste intacte quand elle est utilisée seule.
- Correction taille du logo : le CSS ne faisait que plafonner une taille maximale (`max-width`/`max-height`) sans jamais forcer l'agrandissement d'une image source de faible résolution, qui s'affichait donc à sa taille native (petite). Remplacé par un `width` en `clamp()` qui force la mise à l'échelle.
- Décision de design actée (non codée) : sortir le curseur d'intensité et l'en-tête commun "Intensité" de la vue compacte de la playlist, pour ne les afficher que dans la vue dépliée d'un morceau — motivé par le fait que les futurs modes (séquentiel, embranchement) auront leur propre zone de contrôle, pas une réutilisation forcée du curseur à crans (spécifique au layering vertical et vertical randomisé).
- Idée notée (non codée) : visualisation façon vue "Voice/Signal Graph" de Wwise pour le futur mode vertical randomisé (une ligne par instrument, mise en évidence de la variante piochée à chaque itération) — dépend du développement du mode lui-même, non commencé.

---

## [2026-07-04] — Packs (regroupement de morceaux, page dédiée)

**Fichiers touchés** : `index.html`, `layerpitch-backstage.html`, nouveau fichier `pack.html`

**Contexte** : Besoin de regrouper plusieurs morceaux liés (ex. les 3 pistes "Robotic Adventure Game") sous une page dédiée plutôt que de toutes les afficher dans la playlist principale, avec un bouton d'achat (fictif à ce stade).

**Changement** :
- Nouvelle entité `packs` dans `data.json` (id, title, illustration, presentation, buyable, buyUrl), gérée dans une nouvelle section "Packs" du backstage (liste, création rapide "+ Nouveau pack..." directement depuis le sélecteur de pack d'un morceau).
- Chaque morceau gagne `packId` (rattachement optionnel) et `showInMainPlaylist` (bool, permet de le retirer de la playlist principale tout en le gardant accessible via la page de son pack).
- Nouveau fichier `pack.html`, autonome, lit `data.json`, filtré par paramètre d'URL `?id=...` : illustration, texte de présentation, morceaux du pack (même moteur de lecture que la page principale), bouton d'achat en bas (actif seulement si achetable + lien renseigné, sinon "Bientôt disponible" grisé).
- Lien "Fait partie du pack : [titre]" ajouté dans la vue dépliée d'un morceau rattaché à un pack, renvoyant vers `pack.html?id=...`.

**Diagnostic (bug de test)** : le lien "Fait partie du pack" n'apparaissait pas après publication malgré des données correctes des deux côtés (`data.json` et formulaire). Cause : le fichier `index.html` en ligne sur GitHub n'était pas encore la version incluant la fonctionnalité — confirmé en comparant le code source réellement servi (`Cmd+U`) à la recherche d'une chaîne de caractères unique au nouveau code. Un deuxième épisode du même type a révélé un vrai échec de déploiement GitHub Pages ("Deployment failed, try again later", visible dans l'onglet Actions du repo) — résolu par un simple "Re-run jobs", sans changement de code nécessaire.

**Diagnostic (bug de données)** : deux morceaux ("Attack Of The Robots_The Corridor" et "_The Final Battle") partageaient le même `id`, donc le même dossier audio — l'un des deux fichiers avait probablement écrasé l'autre sur GitHub. Cause : l'`id` n'était généré qu'une fois, au moment de la première publication, à partir du titre — deux morceaux créés avec un titre par défaut identique (ou jamais renommés avant publication) produisaient le même `id`. Corrigé manuellement dans `data.json` (nouvel `id` + `base` cohérents), puis fichier audio manquant reuploadé via le backstage.

---

## [2026-07-03] — Modes statique/vertical, stingers, coordination inter-pistes

**Fichiers touchés** : `index.html`, `layerpitch-backstage.html`

**Contexte** : Le prototype V1 (layering vertical uniquement) fonctionnait mais ne couvrait pas les morceaux à piste unique (thèmes, ambiances). Ajout d'un second mode de lecture et d'un mécanisme de clips déclenchables à la main (stingers), avec une refonte de la présentation de la playlist pour rester lisible à mesure que le nombre de morceaux augmente.

**Changement** :
- Ajout du champ `mode` par morceau : `static` (une seule piste) en plus de `vertical` (couches). Les futurs modes (`vertical-random`, `sequential`, `branching`) réservés dans le schéma et le sélecteur du backstage (grisés, non sélectionnables) pour anticiper sans construire.
- Ajout du champ `loopable` (bool) pour les morceaux statiques : détermine si la piste boucle en continu (ambiance) ou joue une fois puis s'arrête (thème/générique, remise à zéro automatique en fin de lecture).
- Ajout des **stingers** : clips courts déclenchables à la main pendant la lecture, d'abord réservés au mode statique puis étendus à tous les modes sur demande. Superposables librement entre eux. Disponibles dès que la piste est dépliée et chargée (pas seulement quand elle joue).
- Refonte de la présentation de la playlist : ligne compacte par défaut (bouton play/pause unique, titre, étiquette de format), dépliable au clic pour voir description/barre de progression/stingers. Curseur d'intensité à crans (chiffres seulement, pas de libellés adjectifs), en-tête commun "Intensité" affiché une fois en haut du bloc Musique.
- Un seul morceau actif à la fois : lancer la lecture d'un morceau stoppe la musique et les stingers d'un autre morceau, et replie sa vue.

**Diagnostic (bugs de coordination inter-pistes, deux corrections successives)** :
1. Cliquer sur play d'une autre piste ne coupait pas la précédente : le mécanisme de coordination n'existait pas encore lors du premier test — ajouté (événement `stop-track` diffusé + registre de fonctions de repli/arrêt de stingers par piste).
2. Une piste dépliée manuellement (sans avoir été jouée) ne se repliait pas quand une autre démarrait : le repli ne ciblait que la dernière piste *active*, pas l'ensemble des pistes ouvertes. Corrigé en repliant systématiquement toutes les pistes du registre sauf celle qui démarre.

---

## [2026-07-02] — Corrections de lecture, portfolio à blocs réordonnables

**Fichiers touchés** : `index.html`, `layerpitch-backstage.html`

**Contexte** : Premiers tests réels du prototype V1 (Battle Loop, 3 couches) après la mise en ligne initiale, puis élargissement de la page publique vers une structure complète façon ReelCrafter (bio, témoignages, vidéos), demandée éditable sans toucher au code.

**Changement / diagnostic** :
- Bug : zone cliquable de la barre de progression trop fine (3px, alignée sur la barre visuelle) → hitbox invisible élargie à 24px de hauteur.
- Bug : retours à la ligne non affichés dans les descriptions (le CSS ne préservait pas les `\n`) → `white-space: pre-wrap` ajouté.
- Bug : clic sur la barre de progression pendant la lecture n'avait aucun effet → la position cliquée était calculée puis immédiatement écrasée par le recalcul de position fait par la fonction d'arrêt (`stopAllSources`), appelée juste après. Corrigé en réordonnant les opérations (arrêt, puis application de la position cliquée, puis relance).
- Ajout d'un bouton "Visualiser le résultat" dans le backstage, ouvrant directement la page publique dans un nouvel onglet à partir des champs owner/repo.
- Reconstruction de la page publique sur le modèle de la page ReelCrafter existante de l'utilisateur (logo, tagline, témoignages, grille vidéo, section bio, playlist), avec un système de **blocs génériques réordonnables** (flèches ↑/↓ sur chaque bloc) : blocs uniques non supprimables (Header, Bio, Témoignages, Musique) et blocs dupliables à volonté (Texte avec alignement, Photo — seul ou en grille —, Vidéo — seule ou en grille, avec vignette optionnelle).
- Migration automatique intégrée pour toute ancienne structure de données (anciens formats de blocs, anciennes listes "galerie"/"vidéos" groupées) vers le nouveau schéma, sans perte de contenu déjà publié.

---

## [2026-07-01 / 2026-07-02] — Prototype V1 : premier lecteur adaptatif fonctionnel

**Fichiers touchés** : création initiale de `index.html`, `data.json`, `layerpitch-backstage.html` (repo GitHub `layerpitch`)

**Contexte** : Point de départ du projet. Recherche préalable (voir master) confirmant qu'aucune plateforme de pitch existante ne permet à un destinataire d'expérimenter lui-même un changement d'intensité musicale en temps réel. Décision de construire un prototype personnel plutôt qu'un produit généralisable, en architecture statique (aucun backend) pour rester dans les moyens d'un usage solo.

**Changement** :
- Architecture à trois fichiers, hébergement GitHub Pages, sans serveur : `index.html` (lecteur, lit `data.json` au runtime), `data.json` (contenu), `layerpitch-backstage.html` (formulaire d'édition local, jamais publié).
- Moteur de layering vertical : plusieurs couches audio jouées en boucle simultanée, volume de chaque couche piloté par un profil cumulatif selon le niveau d'intensité sélectionné (niveau *i* active les couches 0 à *i*).
- Pipeline de conversion audio côté navigateur : upload WAV → décodage (`AudioContext.decodeAudioData`) → encodage Ogg Vorbis (`wasm-media-encoders`, sans dépendance serveur) → upload direct dans le repo GitHub via l'API REST (authentification par token d'accès personnel fine-grained, restreint au seul repo, permission `Contents: Read/write`).
- `data.json` chargé côté backstage pour permettre l'édition/l'ajout de morceaux sans réécrire le fichier à la main.
- Premier test réel de bout en bout réussi : morceau "Battle Loop" (3 couches d'intensité), conversion, publication, lecture, et bouclage sans coupure confirmés à l'oreille.

---

**Fin du changelog reconstitué au 25 juillet 2026.**
