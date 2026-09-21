# Règles Firebase communes (site + application de caisse)

Le site (poksol.com) et l'application Poket Restaurants utilisent le **même projet Firebase**
(`restaurantpos-7a4f0d11`). Firestore ne garde qu'**un seul jeu de règles actif** : chaque
déploiement remplace le précédent. D'où **un seul fichier**, lu par les deux projets :

| Fichier | Contenu |
|---|---|
| `firestore.rules` | Règles Firestore, en trois sections repérables |
| `storage.rules` | Règles Cloud Storage (logos et photos, envoyés par le site) |

## Les trois sections de `firestore.rules`

Chaque bloc est précédé d'une bannière portant son étiquette :

- **`[COMMUN]`** : partagé par le site et l'application. Rôles (`isRestaurantMember`, `isAdmin`,
  `isManagerOrAdmin`), équipe (`staff`, `staff_users`), invitations et demandes d'accès, clients,
  réservations, réglages, catalogue, utilisateurs.
- **`[APPLI]`** : propre à la caisse. Commandes en salle, appareils et licences, sessions,
  impressions, synchronisation, mise à jour de l'application (`app_release`).
- **`[SITE]`** : propre au site. Pages publiques (`publicRestaurants`), formulaire de contact,
  menu QR, réservations faites depuis une page publique.

**Un seul calcul de rôle** pour tout le monde : un même compte a les mêmes droits par le site et
par l'application. « owner » = admin ; le créateur du restaurant est admin. Tout ce qui n'est pas
listé est refusé (aucun bloc « joker »).

## Qui utilise ce dossier

- **Site** : `firebase.json` de ce dépôt pointe vers `firebase/firestore.rules` et
  `firebase/storage.rules`.
- **Application** : le `firebase.json` du projet Flutter pointe vers
  `../../poksol-site/firebase/firestore.rules`. L'ancien `firestore_rules.txt` n'est plus utilisé.
  Ne pas le redéployer : il remplacerait les règles du site.

## Déployer

Depuis l'un ou l'autre projet, le résultat est le même :

```bash
firebase deploy --only firestore:rules            # règles Firestore
firebase deploy --only firestore:rules,storage    # depuis le site : Firestore + Storage
```

**Avant de déployer**, lancer les tests (Java 21 requis) :

```bash
cd tests/rules && npm install && npm test
```

Ils rejouent les gestes du site **et** de la caisse (staff, manager, admin sur les mêmes chemins) et
vérifient que chaque bloc est dans la bonne section.

## Ajouter ou modifier une règle

1. Choisir la section : utilisé par les deux → `[COMMUN]` ; par la caisse seule → `[APPLI]` ; par
   le site seul → `[SITE]`. Une fonction va dans la section de la collection qui l'utilise.
2. Une règle `[SITE]` ou `[APPLI]` ne doit jamais élargir les droits d'un rôle dans une collection
   `[COMMUN]` : le site ne doit pas donner à un staff plus que ce que l'application lui donne.
3. Ajouter un test dans `tests/rules/rules.test.mjs`. Si c'est une nouvelle fonction ou collection
   propre à l'application ou au site, l'ajouter aux listes `APPLI` / `SITE` de
   `tests/rules/structure.test.mjs`.
