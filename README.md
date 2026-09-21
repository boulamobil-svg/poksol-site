# poksol-site

Site officiel de Poksol (poksol.com) : site statique (HTML, CSS, JS sans build) hébergé sur
**GitHub Pages** (domaine personnalisé via `CNAME`). Firebase ne sert que de backend : Auth
Google, Firestore et Storage (projet `restaurantpos-7a4f0d11`).

## Publication

- **Site** : publié en poussant sur la branche `main` (GitHub Pages sert tout le dépôt).
  Tout fichier du dépôt est donc public, y compris `firestore.rules` et `README.md` ; ne jamais
  y mettre de secret. Limites de GitHub : 100 Mo par fichier (l'APK Android approche 96 Mo),
  1 Go pour le site publié.
- **Règles Firebase** : déployées à part avec le CLI (voir plus bas). Le bloc `hosting` de
  `firebase.json` n'est pas utilisé.

## Structure

| Chemin | Rôle |
|---|---|
| `index.html`, `poket-restaurants.html` | Vitrine Poksol et fiche produit |
| `account.html`, `admin.html` | Portail client et dashboard restaurant (`admin.html` reste le nom historique) |
| `poket-access.html` / `poket-access.js` | Création, rattachement et invitation d'un restaurant |
| `restaurants/` | Pages publiques des restaurants (page, menu, réservation) |
| `platform.js` | Logique Firebase : dashboard, clients, réservations, menu, équipe, pages publiques |
| `app.js` | Auth du portail, carrousel, liens de téléchargement (`latest.json`) |
| `apps/poket-restaurants/` | Build web Flutter (compilé, sans les sources) |
| `downloads/poket-restaurants/` | APK, zips web et Windows, `latest.json` |
| `firestore.rules`, `storage.rules` | Règles de sécurité Firebase |

## Publier une release Poket Restaurants

1. Déposer les fichiers de la nouvelle version dans `downloads/poket-restaurants/{android,web,windows}`
   et mettre à jour `latest.json` (les pages du site lisent ce fichier : versions et liens
   de téléchargement n'ont pas besoin d'être modifiés dans le HTML).
2. Ne garder dans git que la version courante : les anciens binaires alourdissent chaque
   clone et chaque déploiement (chaque build pèse ~130 Mo).
3. Après avoir modifié `style.css`, `app.js` ou `platform.js`, changer le paramètre `?v=`
   **sur toutes les pages** (une seule valeur partagée, par exemple `20260920-2`).

## Règles de sécurité (site ET application)

**Les règles Firebase ne se modifient et ne se déploient pas depuis ce dépôt.** Le site et
l'application Poket Restaurants partagent le même projet Firebase et donc le même jeu de règles
Firestore (il n'y en a qu'un d'actif : chaque déploiement remplace le précédent). Le fichier
unique vit dans le projet de l'application :

- `C:\AI_WORKSPACE\AppLab\chez_marwan_posirestore_rules.txt` (Firestore) et `storage_rules.txt` ;
- les règles propres au site y sont annotées **`[SITE]`** (les règles propres à la caisse
  `[APPLI]`, les règles partagées `[COMMUN]`) ;
- procédure, tests et déploiement : `docs/FIREBASE_RULES.md` de ce même projet.

Ce que le site attend de ces règles :

- les pages publiques lisent `publicRestaurants/{slug}` ; le document `restaurants/{id}` n'est
  jamais public ;
- un seul calcul de rôle (fiche `staff` / `staff_users`, « owner » = admin, créateur = admin) :
  un compte a les mêmes droits par le site et par l'application ;
- un code d'invitation ne donne pas d'accès direct : il crée une demande (`access_requests`) que
  valide un admin, dans l'onglet Équipe du site ou dans l'application ;
- profil, horaires, page publique et menu QR : administrateurs seulement.

Si le site a besoin d'une nouvelle règle, la modifier dans le projet de l'application (section
`[SITE]`), lancer ses tests, puis déployer depuis ce dossier-là.
