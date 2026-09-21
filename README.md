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

Elles vivent dans le dossier commun **`firebase/`** : `firebase/firestore.rules` est le fichier
unique, lu par le site et par l'application, découpé en sections `[COMMUN]`, `[APPLI]` et
`[SITE]`. Tout est expliqué dans [`firebase/README.md`](firebase/README.md) (sections, déploiement
depuis l'un ou l'autre projet, comment ajouter une règle).

Points clés :

- Firestore n'a qu'un jeu de règles actif : ne jamais déployer d'autres règles vers ce projet.
- Un seul calcul de rôle (fiche `staff` / `staff_users`, « owner » = admin, créateur = admin) :
  un compte a les mêmes droits par le site et par l'application.
- Les pages publiques lisent `publicRestaurants/{slug}` ; le document `restaurants/{id}` n'est
  jamais public.
- Un code d'invitation ne donne pas d'accès direct : il crée une demande (`access_requests`) que
  valide un admin, dans l'onglet Équipe du site ou dans l'application.

```bash
cd tests/rules && npm install && npm test        # avant tout déploiement (Java 21 requis)
firebase deploy --only firestore:rules,storage   # depuis ce dépôt
```
