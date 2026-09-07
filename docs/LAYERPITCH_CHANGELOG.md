# LayerPitch — Changelog technique

Journal des modifications de code et sessions de débogage. Entrées classées de la plus récente à la plus ancienne. Chaque entrée liste les fichiers touchés, le contexte, le diagnostic (si débogage) et le changement effectué.

*Note du 7 septembre 2026 : ce fichier n'existait plus sur la branche `main` (des copies existent dans d'anciennes worktrees de sessions précédentes — `.claude/worktrees/*` — jamais fusionnées, non reprises ici) ; réétabli directement sur `main` à partir de cette entrée, sans tenter de reconstituer l'historique antérieur.*

---

## [2026-09-07b] — Carte des chemins : bordures pointillées héritées retirées d'un CSS jamais nettoyé au redesign

**Fichiers touchés** : `index.html`, `pack.html`, `layerpitch-backstage.html`

**Signalement de Jules-Antoine** : la carte des chemins ("Robot Adventure", AdReel principal) s'affichait encore avec des traits en pointillés, alors qu'un redesign récent (session "ARCH_Carte des chemins", voir son propre changelog non fusionné ici) les avait supposément retirés.

**Diagnostic, en plusieurs fausses pistes avant la vraie cause** — dans l'ordre suivi avec Jules-Antoine :
1. Cache navigateur / fenêtre privée / VPN coupé / cache DNS local vidé (`dscacheutil -flushcache`) : aucun effet, tous vérifiés à sa demande.
2. `player.js` lui-même vérifié à plusieurs reprises (recherche de `dasharray`/`dashed` dans le fichier réellement servi, DOM inspecté en direct via la console du navigateur de Jules-Antoine) : confirmé propre, aucune trace de pointillés dans le SVG généré — fausse piste.
3. `?v=` (cache-busting) de `player.js`/`layerpitch-i18n.js`/`layerpitch-help.js` bumpé manuellement dans les 5 fichiers publics qui les chargent, au cas où un CDN d'origine servirait une copie ancienne malgré le nom de fichier inchangé — sans effet non plus (mais changement conservé, sans risque).
4. Cause réelle, trouvée en élargissant la recherche au-delà de `player.js` : `.seq-map-edge.branch { stroke-dasharray: 3 3; }`, une règle CSS vivant dans le `<style>` de chacun des 3 fichiers publics/backstage (pas dans `player.js`, d'où l'angle mort des vérifications précédentes) — appliquait des pointillés à *tous* les traits d'un morceau séquentiel à embranchement. Contrairement à `.seq-map-node.pending` (bordure pointillée des nœuds "en attente de choix", justifiée par un commentaire du code, toujours voulue), rien ne justifiait cette règle — reste manifeste d'un ancien style jamais retiré lors du redesign réel des traits/boucles (session "ARCH_Carte des chemins").

**Corrigé** : la règle `.seq-map-edge.branch { stroke-dasharray: 3 3; }` supprimée dans les 3 fichiers. Confirmé en ligne après déploiement.

**Découverte annexe, documentée séparément** (voir `docs/infrastructure.md` si présent, ou mémoire de session) : la page marketing (`landing.html`/`landing-en.html` du repo `layerpitch`, ET `index.html`/`en.html` du repo séparé `Julzantoine.github.io`, custom domain `www.layerpitch.com`/`layerpitch.com`) contient sa propre maquette statique de la carte des chemins, dupliquée dans les deux repos, elle aussi restée en pointillés — corrigée dans les deux repos (les deux ont leur propre historique git, pas de synchronisation automatique entre eux). `www.layerpitch.com` a par ailleurs présenté une erreur SSL Cloudflare 525 pendant l'investigation (repropagation en cours suite à un retrait/rajout du domaine personnalisé sur GitHub Pages, fait plus tôt le même jour) — résolue d'elle-même, purge du cache Cloudflare nécessaire en plus pour voir le contenu à jour.

---

## [2026-09-07a] — Code d'intégration (packs/collections/AdReels), Prévisualiser, réglage "Autoriser l'intégration publique"

**Fichiers touchés** : `layerpitch-backstage.html`, `index.html`, `pack.html`, `collection.html`, `layerpitch-i18n.js`, `api/settings.js`, `api/site-data.js`, `supabase/migrations/20260907110000_settings_allow_embedding.sql` (nouveau)

**Contexte** : trois demandes successives de Jules-Antoine — pouvoir intégrer (iframe) ses packs/playlists ailleurs, prévisualiser ses modifications non publiées, et laisser (ou non) ses visiteurs générer eux-mêmes un code d'intégration.

**Code d'intégration (packs, collections, listes de morceaux d'AdReel)** :
- Bouton "Code d'intégration" dans l'onglet Distribution de chaque pack/collection, et dans le sélecteur d'AdReel (backstage) — génère un `<iframe>` vers la page publique concernée avec `&embed=1`.
- En mode `?embed=1` : `pack.html`/`collection.html` remplacent le discret lien "← Retour" par un vrai bouton visible ramenant l'auditeur vers l'AdReel principal du compositeur, ouvert dans un nouvel onglet (jamais dans l'iframe). `index.html?embed=1` n'affiche que les blocs de type "Morceaux" de l'AdReel visé (bio/témoignages/packs/collections/contact naturellement exclus, ce sont des blocs du même tableau) — bouton désactivé côté backstage si l'AdReel n'a aucun bloc "Morceaux".

**Prévisualiser** : bouton auparavant désactivé ("Bientôt disponible"), maintenant fonctionnel (global + par pack/collection). Dépose l'état en mémoire du backstage dans `localStorage` (partagé entre onglets de même origine, contrairement à `sessionStorage`) puis ouvre la page publique avec `?preview=1` — `loadSiteData()` y lit ce dépôt local au lieu d'interroger Postgres, sans effet de bord ni appel réseau. Limite assumée et documentée par un bandeau "Mode aperçu" sur la page : un fichier audio/image tout juste ajouté ou remplacé ne peut pas s'y afficher (n'existe pas encore ailleurs qu'en local sur l'ordinateur du compositeur) — seule la dernière version déjà publiée peut apparaître. Umami (analytics) désactivé en mode aperçu pour ne pas fausser les statistiques réelles de Jules-Antoine.

**Réglage "Autoriser l'intégration publique"** : nouveau réglage global (backstage, panneau "Réseaux sociaux"), décoché par défaut. Contrôle uniquement si un bouton "Intégrer" est proposé aux VISITEURS sur les pages publiques (à côté du bouton Partager) — ne bloque jamais un lien `?embed=1` déjà généré par le compositeur lui-même, toujours disponible quel que soit ce réglage. Nouvelle colonne `settings.allow_embedding` (migration appliquée en production via `scripts/apply-migrations.js`), lue/écrite par `api/settings.js`/`api/site-data.js`/`upsert_settings`.

**Vérifications** : `node --check` (syntaxe des 3 scripts inline) OK. Symétrie des clés FR/EN de `layerpitch-i18n.js` vérifiée (`node test_i18n_symmetry.js`). Testé en local (serveur statique + `data.json` factice déposé dans `localStorage`) : aperçu, code d'intégration (pack/collection/AdReel), bouton public conditionnel au réglage — tous confirmés fonctionnels avant publication. Migration confirmée appliquée à la base de production.
