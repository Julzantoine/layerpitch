# Aperçu des liens partagés (Worker Cloudflare)

Quand on colle un lien LayerPitch dans LinkedIn, Facebook, WhatsApp, Discord, X…, le réseau envoie un robot lire la page. Ce robot
n'exécute pas le JavaScript des pages publiques, et les adresses `/<nom>/` répondent « 404 » (rattrapées ensuite par `404.html`) :
sans ce programme, l'aperçu est vide. Le Worker répond **seulement aux robots de partage** (reconnus à leur User-Agent) avec une
page minimale contenant le titre, la description et l'image de l'AdReel, du pack, de la collection ou de l'album. Les visiteurs
humains ne passent pas par là, et en cas de doute (adresse inconnue, base injoignable) la requête est transmise comme avant.

Fichier : `apercu-liens-worker.mjs`. Il lit la fonction publique `get_share_preview` (migration `20260930030000`) et l'image par
défaut `og-default.png` (1200 × 630, à la racine du site).

## Mise en place (une fois), dans l'ordre

1. Fusionner la branche dans `main` (apporte `og-default.png` et la migration), puis `npm run migrate`.
2. Cloudflare → **Workers & Pages** → **Create** → **Create Worker** → nom `apercu-liens` → **Deploy** (le code d'exemple, peu importe).
3. **Edit code** : effacer tout, coller le contenu de `apercu-liens-worker.mjs`, **Deploy**.
4. Onglet **Settings → Domains & Routes → Add → Route** : zone `layerpitch.com`, route `beta.layerpitch.com/*`, Worker `apercu-liens`.
5. Essayer depuis le Terminal (doit afficher des balises `og:title`, `og:image`…) :
   `curl -s -A "LinkedInBot/1.0" https://beta.layerpitch.com/<ton-nom>/ | head -20`
6. LinkedIn garde les aperçus en mémoire : pour rafraîchir un lien déjà partagé, le coller dans le **Post Inspector**
   (https://www.linkedin.com/post-inspector/) puis « Inspect ».

## Pour l'annuler
Cloudflare → le Worker → **Settings → Domains & Routes** : supprimer la route. Le site redevient exactement comme avant.

## Limites
- Image : idéalement 1200 × 630 ; une photo plus petite s'affiche plus petite (ou en vignette). Sans image, c'est `og-default.png`.
- Les vitrines de Projet (`/vitrine/<nom>`) et le Catalogue audio (`/shop`) n'ont pas d'aperçu propre : à ajouter si besoin.
- Plan gratuit de Cloudflare : 100 000 requêtes par jour, très au-dessus des besoins ; seules les visites de robots sont traitées.
