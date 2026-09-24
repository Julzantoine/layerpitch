# LayerPitch

Site statique servi par GitHub Pages (`beta.layerpitch.com`). Les données vivent dans Supabase (Postgres + Edge
Functions), les médias sur Cloudflare R2 (`media.layerpitch.com`). La documentation interne (changelog, décisions,
feuille de route) est dans le dépôt privé `layerpitch-docs`, jamais ici.

## Organisation

| Fichier / dossier | Rôle |
|---|---|
| `index.html`, `pack.html`, `collection.html` | Pages publiques (AdReel, pack, collection). Jamais derrière une connexion. |
| `public-page.js` | Briques communes aux trois pages publiques : chargement des scripts, suivi Umami, polices, bandeau cookies. |
| `player.js` | Moteur de lecture adaptatif (modes, effets, triggers, curseurs, spatialisation), exposé sous `window.LayerPlayerCore`. |
| `capture-render.js` | Rendu audio hors-ligne de l'outil vidéo, avec les briques de `player.js`. |
| `layerpitch-backstage.html` | Espace compositeur : édition et publication (écrit uniquement dans la base). |
| `admin.html`, `mon-compte.html`, `bienvenue.html`, `library.html` | Administration, compte, connexion, achats. |
| `layerpitch-i18n.js` | Tous les textes, en français et en anglais. |
| `api/*.js` | Accès à la base (lecture directe, écriture uniquement par RPC). |
| `supabase/migrations/` | Schéma et fonctions SQL, appliqués par `npm run migrate` (écrit en production). |
| `supabase/functions/` | Edge Functions (paiement, médias signés, invitations…). |

## Commandes

```bash
npm install            # outils de développement uniquement (jsdom, pg)
npm test               # tous les tests hors base de données
npm run bump-version   # après toute modification d'un .js servi aux navigateurs : un seul ?v= pour toutes les pages
npm run migrate        # applique les migrations en attente à la VRAIE base (.env requis)
python3 -m http.server 8420   # site en local : http://localhost:8420
```

## Règles

- Une migration = un numéro neuf, jamais réutilisé, et idempotente autant que possible (`if exists` / `if not exists`).
- Un champ ajouté à un morceau doit l'être partout : `test_schema_roundtrip.js` échoue sinon.
- Tout texte venu d'un utilisateur passe par `escapeHtml` avant d'être inséré dans du HTML (texte comme attribut).
- Les nouvelles fonctions restent grisées pour les non-admins jusqu'au feu vert (voir `layerpitch-docs/feux-verts-admin.md`).
