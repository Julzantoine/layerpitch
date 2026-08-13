# LAYERPITCH — INFRASTRUCTURE
*Extrait de `MASTER.md` le 28 juillet 2026 lors de la restructuration en fichiers spécialisés. Contenu inchangé sur le fond, réorganisé uniquement.*

## Vue d'ensemble — deux chantiers de nature différente

- **Partie A — Bêta de retour qualitatif** (décidée le 12 juillet, en cours) : ne nécessite aucun développement backend.
- **Partie B — Bascule backend réelle** (cadrée le 12 juillet, chantier futur) : comptes, base de données, paiement — pour une version ultérieure du produit.

## Partie A — Bêta de retour qualitatif

### Objectif et contrainte

Faire tester LayerPitch à une dizaine de compositeurs (ordre de grandeur, non figé), qui créent leurs propres AdReels et donnent des retours d'usage. Contrainte actée : minimiser au maximum la friction d'entrée — pas question de demander au testeur de comprendre ou manipuler GitHub lui-même.

### Solution retenue — duplication de repo préconfigurée, sans backend

Pour chaque testeur : duplication du repo GitHub existant, `data.json` de départ préremplit (état d'exemple), génération d'un **token GitHub fine-grained restreint à ce seul repo**, transmission d'un lien direct vers son propre backstage déjà fonctionnel. Le testeur ne sait jamais que GitHub existe derrière.

**Pourquoi cette solution plutôt qu'un vrai système de comptes** : zéro développement backend nécessaire, isolation naturelle sans risque (repo par testeur, pas de fuite de données entre testeurs), correspond exactement à l'objectif (retours qualitatifs), pas à un vrai lancement produit.

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

## Partie B — Bascule backend (cadrée, non commencée)

**Stack retenue** : Supabase (Postgres + auth), Cloudflare R2 (média, egress-free) pour l'audio et la vidéo — Supabase réservé au Postgres. Thin custom API layer entre le produit et Supabase (jamais d'appel direct à Supabase depuis le client). Sécurité en deux niveaux : validation API + Postgres RLS (défense en profondeur, même logique que la protection anti-triche côté serveur évoquée dans le retour d'expérience externe sur les leaderboards).

**Estimation de temps** : ~46-74 jours de temps fondateur piloté par IA pour les étapes 1 à 3 (**estimation**, pas un fait vérifié).

**Roadmap séquencée proposée** : Phase 0 (fondation comptes/BDD/stockage) → Phase 1 (Packs V2 minimal, paiement) → Phase 2 (Analytics détaillé, liens multiples) → Phase 3 (Smart Import IA, Interface à prompt) → Phase 4 (Espace Projet, Bibliothèque acheteur vidéo).

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
- **À trancher** : Supabase managé vs auto-hébergé sur OVH ; date d'ouverture réelle de la bêta A (dépend de l'essai à blanc + correctif cache).
