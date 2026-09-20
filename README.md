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

## Règles de sécurité

Les règles se déploient séparément du site :

```bash
firebase deploy --only firestore:rules,storage
```

Points à connaître avant de déployer :

- `restaurants/{id}` n'est plus lisible publiquement : les pages publiques lisent
  `publicRestaurants/{slug}`. Vérifier que chaque restaurant avec une page publique a bien un
  document `publicRestaurants` (il est créé par le dashboard et par `poket-access`).
- Les listings `invitations` et `restaurant_invites` sont réservés aux owners/admins ; la
  lecture par code (identifiant du document) reste ouverte aux utilisateurs connectés.
- Les écritures Storage exigent d'être owner/admin/manager du restaurant (rôle dans
  `members/{uid}` ou `ownerUid`). Storage ne peut lire que 2 documents Firestore par requête :
  les anciennes collections `staff` et `staff_users` ne sont pas prises en compte.
- Les réservations anonymes doivent avoir le statut `planned` et des champs bornés ; les
  messages de contact n'acceptent que les champs du formulaire.
