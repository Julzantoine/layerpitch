# LAYERPITCH — INFRASTRUCTURE
*Extrait de `MASTER.md` le 28 juillet 2026 lors de la restructuration en fichiers spécialisés. Partie A inchangée sur le fond. Partie B mise à jour le 27 août 2026 — canal dédié à la bascule backend, cinq décisions d'architecture actées avant tout code.*

## Vue d'ensemble — deux chantiers de nature différente

- **Partie A — Bêta de retour qualitatif** (décidée le 12 juillet, en cours) : ne nécessite aucun développement backend.
- **Partie B — Bascule backend réelle** (cadrée le 12 juillet, architecture actée le 27 août, développement pas encore commencé) : comptes, base de données, paiement — pour une version ultérieure du produit.

**Changement de calendrier (27 août)** : la roadmap datée dans `business-marche.md` visait un démarrage "début 2027". Décision volontaire d'avancer ce chantier en tâche de fond dès maintenant, en parallèle du reste — motivée par l'avancement du travail de fond, pas par l'urgence de sécurité (celle-ci est traitée séparément via Cloudflare Access, voir plus bas).

## Partie A — Bêta de retour qualitatif

### Objectif et contrainte

Faire tester LayerPitch à une dizaine de compositeurs (ordre de grandeur, non figé), qui créent leurs propres AdReels et donnent des retours d'usage. Contrainte actée : minimiser au maximum la friction d'entrée — pas question de demander au testeur de comprendre ou manipuler GitHub lui-même.

### Solution retenue — duplication de repo préconfigurée, sans backend

Pour chaque testeur : duplication du repo GitHub existant, `data.json` de départ préremplit (état d'exemple), génération d'un **token GitHub fine-grained restreint à ce seul repo**, transmission d'un lien direct vers son propre backstage déjà fonctionnel. Le testeur ne sait jamais que GitHub existe derrière.

**Pourquoi cette solution plutôt qu'un vrai système de comptes** : zéro développement backend nécessaire, isolation naturelle sans risque (repo par testeur, pas de fuite de données entre testeurs), correspond exactement à l'objectif (retours qualitatifs), pas à un vrai lancement produit.

**Note de transition (27 août)** : ce système sera remplacé par l'authentification Supabase (Partie B, Décision 4) une fois la bascule backend effective — mais reste inchangé et pleinement fonctionnel jusque-là. Aucune régression entre-temps.

### Précautions opérationnelles

- Token GitHub distinct et restreint par testeur — jamais un token donnant accès au repo principal ou à ceux des autres testeurs.
- Tous les repos de bêta hébergés sous une **organisation GitHub dédiée** (`layerpitch-beta`), séparée du compte personnel — facilite le nettoyage en fin de bêta (suppression de l'organisation entière).

### Limite assumée

Pas de tableau de bord unifié listant tous les testeurs — chaque repo consulté séparément. Adapté jusqu'à une dizaine de testeurs, pas à une ouverture à grande échelle ; revoir l'approche si le nombre visé dépassait significativement la dizaine.

### Outillage — `layerpitch-beta-sync.js` (Node.js, `GH_TOKEN` en variable d'environnement)

Trois commandes :
- **`promote`** — copie les fichiers moteur (`index.html`, `pack.html`, `player.js`, `layerpitch-backstage.html`) vers `layerpitch-beta-template` (repo "Template repository" côté GitHub), régénère automatiquement un `data.json` de départ (mêmes types de blocs que l'AdReel principal, vidés de contenu).
- **`create <nom>`** — crée `layerpitch-beta-<nom>` depuis le template, remplace le repère `__TESTER_REPO__` du backstage par le vrai nom.
- **`rollout`** — pousse une mise à jour des fichiers moteur vers tous les repos testeurs existants.

**Cache navigateur/CDN — résolu le 13/08** : après publication depuis le backstage, les changements pouvaient ne pas apparaître de façon fiable côté public sans vidage manuel du cache. Cause : absence de cache-busting sur `data.json` et sur les scripts moteur partagés. État actuel :
- `data.json` : chargé avec `?v=' + Date.now()` dans `index.html`/`pack.html`/`collection.html` — requête réseau fraîche à chaque chargement de page, jamais de cache, ni navigateur ni CDN.
- `player.js`, `layerpitch-i18n.js`, `layerpitch-help.js` : leurs balises `<script>` sont réécrites à chaque publication avec `?v=<buildVersion>` (même timestamp que `publishedAt`), via `updateScriptVersions()` — un seul fetch+écriture par fichier concerné (`index.html`, `pack.html`, `collection.html`, `video-test.html`, `layerpitch-backstage.html`).
- **Résiduel, hors de notre contrôle** : le TTL de 10 min de GitHub Pages (non configurable) s'applique toujours à l'URL canonique de la page HTML elle-même (celle du lien partagé, qui ne change jamais). Sans conséquence sur le *contenu* affiché (toujours piloté par `data.json`, toujours frais), seulement sur le *code* (nouvelle fonctionnalité, changement de structure) — s'autorésout tout seul en 10 min maximum après une publication.

## Partie B — Bascule backend (architecture actée le 27 août, développement non commencé)

**Stack retenue** : Supabase (Postgres + auth), Cloudflare R2 (média, egress-free) — Supabase réservé au Postgres. Couche d'abstraction API fine (service layer JS côté client, pas de serveur dédié) entre le produit et Supabase, pensée pour la réversibilité. Sécurité en deux niveaux : validation applicative + Postgres RLS.

**Estimation de temps** : ~46-74 jours de temps fondateur piloté par IA pour les étapes 1 à 3 (**estimation**, pas un fait vérifié — posée le 14 juillet, non révisée depuis).

### Décision 1 — Schéma de données Postgres

**Approche retenue : hybride.** Tables relationnelles pour les entités de premier niveau et tout ce qui porte une vraie logique de graphe ou de transaction ; colonnes JSONB pour les sous-structures propres à un mode de lecture, sans intégrité référentielle critique.

**Tables "dures" (avec contraintes/FK réelles)** :
- `tracks`, `track_folders`
- `segment_slots` — FK `track_id` ; FK auto-référentielle `references_slot_id` (`ON DELETE SET NULL`, cohérent avec le comportement actuel du backstage qui nettoie déjà cette référence à la suppression)
- `segment_slot_transitions` — les `nextOptions[]` du mode séquentiel/embranchement ; FK `from_slot_id` et `target_slot_id` vers `segment_slots.id` (`ON DELETE CASCADE` : une option de branchement qui pointe vers un segment supprimé disparaît proprement avec lui, plutôt que de laisser un bouton mort dans un AdReel publié)
- `sfx_library`, `sfx_folders`
- `packs`, `collections`, `ad_reels`, `ad_reel_folders`
- `albums` — entité séparée de `packs` (décision de fond actée le 31 juillet dans `extensions-roadmap.md` 5.5 : différence d'audience et de finalité commerciale, pas un simple champ `type`). Réutilise le moteur de lecture adaptative (mêmes `tracks` référencés), champs éditoriaux propres (`presentationFr/En`, réutilisation du champ existant côté Pack).
- `pack_purchases`, `album_purchases` — achat unitaire (one-time payment, pas d'abonnement), `buyer_id` → `profiles`, `pack_id`/`album_id`, `purchased_at`, `price_paid`, `stripe_payment_intent_id` (nullable, en attente de la Phase 1 paiement)
- `profiles` — une ligne par compte (voir Décision 4), sans `role` figé
- `composer_profiles`, `buyer_profiles` — profils optionnels rattachés à un compte, activables/cumulables (modèle "un compte, plusieurs profils" façon YouTube Studio, acté le 30 juillet dans `extensions-roadmap.md` 5.4)
- `plan_quotas` — quotas par palier (`free`/`starter`/`pro`), table plutôt que valeurs codées en dur, ajustable sans migration
- Tables de liaison pour les listes d'IDs référencés (`pack_tracks`, `collection_packs`, `ad_reel_tracks`, etc.) plutôt que des tableaux d'IDs bruts, pour garantir l'intégrité sans code de validation supplémentaire
- `socials`, et une table "réglages globaux" (une seule ligne : `publishedAt`, `implementationSkills`, `noAiCertifiedGlobal`, `customFonts`)

**Colonnes JSONB (souple, propre au mode, pas de graphe critique)** : `layers`, `sections` (avec `pools[]` imbriqués, y compris `referencesPoolId`/`referencesSectionId` en référence molle non contrainte — cohérent avec leur usage actuel), `alternatives`, `intro`/`outro`, `profile`/`theme`, `testimonials`, `blocks`, `trackOverrides`.

**Colonnes provisionnées vides, en attente d'un chantier de conception ultérieur mais déjà destination actée** :
- `packs.tags` (tableau de texte) — pour la vraie Marketplace organisée (catalogue parcourable, filtres), Phase 2, une fois qu'il y aura assez de packs en vente pour la justifier.

**Explicitement hors périmètre du schéma actuel** (destination non tranchée, pour éviter de deviner un modèle pas encore pensé) : tout ce qui touche à Moodboard Studios (nom et modèle de rémunération studio exclus de toute communication externe, cf. règle de canal) ; `playlists`, `playlist_tracks`, `user_track_settings`, et toute table liée au bouton "Figer" (exports) — la conception de `extensions-roadmap.md` 5.5 reste incomplète sur ces pans ("Playlists et Figer restent à finir").

### Décision 2 — Couche d'abstraction API

**Pas de serveur API séparé** (type NestJS/FastAPI) — disproportionné pour un solo founder qui ne code pas lui-même.

**Architecture retenue** :
```
Front statique (index.html, backstage, player.js)
        │
        ▼
  api/*.js  ← couche d'abstraction (service layer)
   ├── api/auth.js       → wrappe supabase.auth.* (isolé en priorité — point de sortie le plus "collant" de Supabase)
   ├── api/tracks.js      → CRUD simple via SDK Supabase
   ├── api/packs.js       → idem
   ├── api/adreels.js     → idem
   └── api/publish.js     → appelle des RPC (fonctions Postgres versionnées en SQL)
        │
        ▼
  Postgres (RLS + fonctions RPC pour la logique métier : intégrité segment_slots, publication atomique)
```

- **RPC (fonctions Postgres, PL/pgSQL)** pour toute logique métier proche des données : validation du graphe `segment_slots`/`nextOptions`, publication atomique multi-tables. Plus rapide qu'un aller-retour réseau supplémentaire, versionné comme SQL dans les migrations (réversibilité maximale).
- **Edge Functions réservées** aux seuls cas nécessitant un secret serveur ou un appel externe : envoi d'invitation bêta-testeur (`invite-tester`, utilise la clé secrète Supabase Auth Admin, ne doit jamais toucher le client), futurs webhooks Stripe. Aucun besoin à ce stade au-delà de l'invitation.
- **RLS Postgres** pour la sécurité d'accès — logique de permission en SQL versionné, portable par nature (`pg_dump`).

### Décision 3 — Migration des médias vers Cloudflare R2

- **Un seul bucket** (`layerpitch-media`), distinction par préfixe de clé plutôt que par bucket.
- **Structure de clés miroir de l'actuelle** : `audio/<trackId>/<filename>`, `sfx/<sfxId>/<filename>`, `images/<packId ou adReelId>/<filename>` — réécriture d'URL quasi mécanique (changement du seul domaine de base).
- **Accès public via domaine personnalisé `media.layerpitch.com`** — nécessite que `layerpitch.com` soit une zone gérée par Cloudflare (nameservers pointés dessus). **Bloqué tant que le domaine n'est pas acheté** (voir section Domaine ci-dessous). En attendant, le sous-domaine `r2.dev` sert uniquement de bac à sable technique, jamais de lien partagé réel (rate-limité, non prévu pour la production).
- **Pas de presigned URLs / auth par objet à ce stade** — cohérent avec le modèle de sécurité par obscurité déjà en place aujourd'hui (ID de dossier non devinables dans les chemins GitHub Pages actuels), réévaluable une fois Cloudflare Access branché.
- **Migration = copie 1:1** des fichiers `images/` et `audio/` du repo GitHub vers le bucket, chemins conservés.

### Décision 4 — Authentification

- **Supabase Auth, connexion par magic link (passwordless)** — pas de mot de passe, adapté à des testeurs non-techniques, cohérent avec "aucun processus de paiement à ce stade".
- **Inscriptions publiques désactivées** — seuls les comptes créés via invitation admin peuvent se connecter. Bascule vers inscription publique = simple changement de configuration au moment de l'ouverture grand public, pas une refonte.
- **Invitation envoyée via l'Edge Function `invite-tester`**, appelée depuis `api/auth.js`.
- **Modèle de comptes : un seul compte, plusieurs profils cumulables** (acté le 30 juillet dans `extensions-roadmap.md` 5.4, façon YouTube/YouTube Studio) — `profiles` (une ligne par compte) + `composer_profiles`/`buyer_profiles` optionnels et non exclusifs. Un compositeur qui achète aussi des packs a les deux profils sur le même compte.
- **Point de vigilance opérationnel** (implémentation, pas architecture) : la limite par défaut de 2 emails d'invitation/heure de Supabase nécessitera soit un SMTP personnalisé, soit un espacement des invitations lors du rollout bêta.

### Décision 5 — Ordre de bascule

Migration incrémentale (pattern "Strangler Fig"), pas de big bang — chaque étape validée en production avant la suivante, le prototype actuel reste fonctionnel à chaque étape :

1. **Médias vers R2** — isolé, aucune dépendance auth/DB, changement du seul champ `base` dans `data.json` une fois copié et vérifié.
2. **Authentification Supabase** — isolable, testable en parallèle de l'usage normal, remplace le système bêta GitHub sans coupure.
3. **Base Postgres + migration des données** — étape la plus délicate. Le script de migration peuple Postgres depuis `data.json` (validation du graphe `segmentSlots`/`nextOptions` incluse) sans faire dépendre le site public de cette base tant qu'un AdReel de test servi depuis Postgres n'a pas été vérifié identique en comportement à l'original.
4. **Logique d'achat** (`pack_purchases`/`album_purchases`, bibliothèque acheteur) — dépend des trois étapes précédentes, dernière pièce.

### Périmètre fonctionnel de l'ouverture (au-delà de la simple bascule technique)

Décidé le 27 août, en s'appuyant sur des features déjà conçues dans `extensions-roadmap.md` mais jusque-là non priorisées pour un lancement :
- **Achat de pack depuis l'AdReel** (pas de catalogue global à l'ouverture) — remplace `packs[].buyUrl` (lien externe) par un flux d'achat interne enregistré dans `pack_purchases`.
- **Bibliothèque acheteur** (packs achetés + packs custom réorganisables) — `extensions-roadmap.md` 5.3, conception déjà validée dans le détail, "aucune valeur avant le backend".
- **Vente d'OST façon Bandcamp** (`albums`, achat définitif/téléchargement) — anticipée par Jules-Antoine comme un axe d'attraction studios, potentiellement avant l'horizon initialement prévu. Schéma provisionné (`albums`, `album_purchases`) ; mécanique de lecture auditeur (playlists, "Figer") non provisionnée, conception incomplète à ce stade.
- **Vraie Marketplace organisée** (catalogue, tags, filtres) — repoussée à la Phase 2, une fois "assez de packs en vente" ; `packs.tags` provisionné vide dès maintenant pour éviter une migration ultérieure.
- **Extension `admin-analytics.html`** — comptages directs sur les nouvelles tables (nombre de comptes, d'AdReels, de morceaux, de packs créés/en vente) en complément du suivi comportemental existant (`events.json`/Umami). Implémentation triviale une fois Postgres en place, aucune décision d'architecture supplémentaire requise.

### Domaine — `layerpitch.com` (statut : pas encore acheté)

Décidé le 27 août comme hypothèse de travail, à corriger dès l'achat effectif :
- **`layerpitch.com` (apex)** → landing page Framer (pré-lancement)
- **`www.layerpitch.com`** → réservé pour le site final (l'app LayerPitch réelle) ; pointera vers GitHub Pages (ou son successeur) au moment du lancement — bascule DNS pure, aucun impact code
- **`media.layerpitch.com`** → bucket R2 (Décision 3)

**Prérequis technique** : les nameservers du domaine doivent pointer vers Cloudflare (zone DNS complète), pas seulement un enregistrement isolé — condition pour activer un domaine personnalisé sur R2. Framer n'a pas besoin d'être le gestionnaire des nameservers, un enregistrement DNS chez Cloudflare suffit pour `www`.

**Piège à connaître pour la bascule `www` → GitHub Pages** : Cloudflare proxifie les enregistrements par défaut (nuage orange), ce qui empêche GitHub de terminer son challenge HTTP pour émettre son certificat Let's Encrypt (HTTPS ne se met jamais en place, risque de boucle de redirection si le TLS Cloudflare est forcé en plus). Mettre l'enregistrement en "DNS only" (nuage gris) le temps que le certificat GitHub soit émis, avant de repasser en proxifié si souhaité.

### Roadmap séquencée proposée (12 juillet, non révisée depuis)

Phase 0 (fondation comptes/BDD/stockage) → Phase 1 (Packs V2 minimal, paiement) → Phase 2 (Analytics détaillé, liens multiples, vraie Marketplace) → Phase 3 (Smart Import IA, Interface à prompt) → Phase 4 (Espace Projet, Bibliothèque acheteur vidéo).

### Batterie de tests prévue

*Inspirée d'un échange sur la pratique d'Uncle Bob Martin ("extreme constraints" plutôt que relire chaque ligne de code générée).*

- **Tests unitaires** — priorité sur le moteur audio (`player.js`) : calcul beat/mesure, points de boucle (cas limites y compris), anti-répétition vertical-random et Sfx round robin, ducking. Chaque bug déjà corrigé devient un test de non-régression figé.
- **Tests de sécurité**, une fois le backend en place : isolation stricte entre comptes même via une requête bricolée contre l'API, respect des quotas par palier, respect de la casquette active, non-contournement du calcul de commission.
- **Tests Gherkin** (langage quasi naturel, lisible par Jules-Antoine sans lire de code) — réservés aux comportements qu'il doit pouvoir vérifier lui-même.
- **Tests d'intégration** : parcours backstage → publication → vérification du contenu réellement publié ; parcours de paiement de bout en bout (webhook Stripe simulé).
- **Mutation testing** : une fois la suite ci-dessus posée, teste les tests eux-mêmes.
- **Couverture priorisée, pas uniforme** : élevée sur moteur audio et sécurité/paiement/quotas ; tolérante sur l'apparence.
- **QA manuelle formalisée en checklist**, à répéter avant chaque publication importante.

**Outils concrets retenus** : Vitest (tests unitaires et d'intégration), Gherkin allégé dans Vitest, couverture via Istanbul/c8, Stryker pour le mutation testing (à n'installer qu'une fois une vraie suite existante à challenger).

**Mécanisme d'automatisation** : GitHub Actions lance la suite à chaque push (gratuit à ce volume), qu'il vienne de Jules-Antoine ou d'une session Claude Code.

**Ordre de mise en place recommandé** : (1) Vitest + tests unitaires moteur audio d'abord ; (2) GitHub Actions ; (3) Gherkin, mutation testing, couverture ciblée progressivement.

**Point non négociable avant tout lancement réel** : audit ponctuel par un développeur humain (cloisonnement des comptes, non-fuite de clés, permissions BDD) — pas requis pour la bêta Partie A. Environnement recommandé : Claude Code plutôt qu'un chat classique.

### Journal des décisions d'infrastructure

- **12 juillet** — cadrage Partie A/B, six briques manquantes identifiées, script `layerpitch-beta-sync.js` conçu.
- **14 juillet** — décision Cloudflare R2 pour l'audio et la vidéo, Supabase réservé au Postgres ; coûts et marge post-bascule chiffrés ; garde-fous de plafonds actés.
- **13 août** — cache navigateur/CDN sur publication : `data.json` déjà cache-busté (`Date.now()`) ; trou trouvé et corrigé sur `layerpitch-i18n.js`/`layerpitch-help.js` (jamais versionnés, contrairement à `player.js`) — `updateScriptVersions()` généralisée aux trois scripts, `video-test.html` ajouté à la liste des fichiers mis à jour à la publication.
- **27 août** — canal dédié à la bascule backend ouvert. Cinq décisions d'architecture actées : (1) schéma hybride Postgres relationnel + JSONB, avec tables dures sur tout ce qui porte une logique de graphe/transaction (`segment_slots`, `segment_slot_transitions`, achats) ; (2) couche d'abstraction API en service layer JS côté client, RPC Postgres pour la logique métier, Edge Functions réservées aux secrets/appels externes ; (3) migration médias vers R2, bucket unique, domaine personnalisé bloqué en attendant l'achat de `layerpitch.com` ; (4) auth Supabase magic link invite-only, modèle de comptes à profils multiples ; (5) ordre de bascule incrémental (médias → auth → BDD → achats), pattern Strangler Fig. Périmètre fonctionnel d'ouverture élargi pour inclure l'achat de packs depuis l'AdReel, la bibliothèque acheteur, et une entité `Album` provisionnée (vente d'OST façon Bandcamp). Décision explicite de tenir Moodboard Studios (nom et modèle de rémunération) et les mécaniques non finalisées (playlists, "Figer") hors du schéma actuel.
- **À trancher** : Supabase managé vs auto-hébergé sur OVH ; date d'ouverture réelle de la bêta A (dépend de l'essai à blanc + correctif cache) ; achat effectif du domaine `layerpitch.com` (bloque l'exposition publique propre du bucket R2) ; ADR formalisant la révision de calendrier de la Partie B (documentée ici, ADR séparé à rédiger une fois ces docs poussées sur GitHub).
