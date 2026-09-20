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

Le site et l'application Poket Restaurants partagent le même projet Firebase, donc **le même
jeu de règles Firestore** : Firestore n'en garde qu'un d'actif, et chaque déploiement remplace
le précédent. `firestore.rules` est le **fichier unique** ; ne jamais déployer d'autres règles
Firestore vers ce projet (notamment depuis le projet Flutter, dont `firebase.json` doit
pointer vers ce fichier ou ne plus déployer de règles).

```bash
firebase deploy --only firestore:rules,storage
```

Modèle de rôles, identique partout (fonctions `isRestaurantMember`, `isAdmin`,
`isManagerOrAdmin`) :

- le rôle vient de la fiche `restaurants/{id}/staff/{uid}` (ou `staff_users`) : `admin`,
  `manager` ou `staff` ; « owner » = admin ; le créateur du restaurant (`createdBy` ou
  `ownerUid`) est admin ;
- **staff** : caisse (commandes, appareils, synchronisation), création et modification des
  clients et des réservations ; **manager** : en plus catalogue, réglages, suppression de
  clients ; **admin** : en plus équipe, invitations, profil, page publique, menu QR ;
- tout ce qui n'est pas listé dans le fichier est refusé (pas de règle « manager écrit partout »).

Pour le site : les pages publiques lisent `publicRestaurants/{slug}` (le document
`restaurants/{id}` n'est jamais public), les invitations suivent le format de l'application
(`restaurant_invites`, statut `active`, rôle `admin|manager|staff`). Un code d'invitation ne
donne **pas** d'accès direct : il crée une demande (`access_requests`) que valide un admin,
dans l'onglet Équipe du site ou dans l'application, qui choisit le rôle et le poste et crée
les fiches `staff` / `staff_users`.

Les tests (`tests/rules`, Java 21 requis) doivent passer avant tout déploiement :

```bash
cd tests/rules && npm install && npm test
```
