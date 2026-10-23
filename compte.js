/* Espace "Mon compte" : informations de l'utilisateur et applications actives ou souscrites.
   Lecture seule. Les restaurants se lisent comme dans platform.js (users/{uid}.restaurantIds,
   restaurants.ownerUid, role dans staff). Les autres applications se lisent dans
   users/{uid}.apps : { "vtc-hero": { status: "active" | "trial" | "pending" | "suspended",
   plan: "Pro", since: Timestamp, trialEndsAt: Timestamp } }. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRhBXuuJhbSDo9e4kQEEvc1x28HfxAi_E",
  authDomain: "restaurantpos-7a4f0d11.firebaseapp.com",
  projectId: "restaurantpos-7a4f0d11",
  storageBucket: "restaurantpos-7a4f0d11.firebasestorage.app",
  messagingSenderId: "486823214144",
  appId: "1:486823214144:web:a6253af9f0821929e8f3a5"
};

const ROLE_LABELS = { owner: "Propriétaire", admin: "Administrateur", manager: "Manager", staff: "Équipe" };
const ROLE_ORDER = ["owner", "admin", "manager", "staff"];
const APP_STATUS = {
  active: { label: "Actif", tone: "live" },
  trial: { label: "Essai en cours", tone: "live" },
  pending: { label: "Demande en cours", tone: "soon" },
  suspended: { label: "Suspendu", tone: "soon" }
};
const VTC_LOGIN_URL = "https://vtc-hero-prod.web.app/login";
const ACCESS_MAIL = "mailto:contact@poksol.com?subject=Acc%C3%A8s%20VTC%20HERO";

const root = document.querySelector("[data-compte]");
const loginButtons = document.querySelectorAll("[data-compte-login]");
const logoutButtons = document.querySelectorAll("[data-compte-logout]");
const auth = getAuth(initializeApp(firebaseConfig));
const db = getFirestore(auth.app);

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([key, value]) => {
    if (value === false || value == null) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : value);
  });
  children.flat().forEach((child) => {
    if (child != null && child !== false) node.append(child);
  });
  return node;
}

function link(text, href, className = "rf-link", extra = {}) {
  return el("a", { href, class: className, ...extra }, text);
}

function toDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, withTime) {
  const date = toDate(value);
  if (!date) return "";
  return withTime
    ? date.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
    : date.toLocaleDateString("fr-FR", { dateStyle: "long" });
}

function initials(name, email) {
  const parts = String(name || email || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(parts[0] || "?").slice(0, 2).toUpperCase();
}

function highestRole(roles) {
  return ROLE_ORDER.find((role) => roles.includes(role)) || "staff";
}

async function listRestaurants(uid, userData) {
  const ids = new Set();
  if (userData?.activeRestaurantId) ids.add(userData.activeRestaurantId);
  if (Array.isArray(userData?.restaurantIds)) userData.restaurantIds.forEach((id) => id && ids.add(id));
  const owned = await getDocs(query(collection(db, "restaurants"), where("ownerUid", "==", uid)));
  owned.forEach((snap) => ids.add(snap.id));

  const restaurants = [];
  for (const id of ids) {
    const snap = await getDoc(doc(db, "restaurants", id)).catch(() => null);
    if (!snap?.exists()) continue;
    const data = snap.data();
    const profile = data.restaurantProfile || {};
    const roles = [];
    if (data.ownerUid === uid || data.createdBy === uid) roles.push("owner");
    for (const sub of ["staff", "staff_users"]) {
      const staff = await getDoc(doc(db, "restaurants", id, sub, uid)).catch(() => null);
      const role = String(staff?.exists() ? staff.data().role : "").toLowerCase();
      if (ROLE_ORDER.includes(role)) roles.push(role);
    }
    restaurants.push({
      id,
      slug: data.slug || profile.slug || id,
      name: data.tradeName || data.name || profile.tradeName || profile.name || id,
      role: highestRole(roles)
    });
  }
  return restaurants.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

async function loadAccount(user) {
  const userSnap = await getDoc(doc(db, "users", user.uid)).catch(() => null);
  const userData = userSnap?.exists() ? userSnap.data() : {};
  let restaurants = [];
  let restaurantsFailed = false;
  try {
    restaurants = await listRestaurants(user.uid, userData);
  } catch (_) {
    restaurantsFailed = true;
  }
  return { userData, restaurants, restaurantsFailed };
}

async function loadRelease() {
  try {
    const response = await fetch("/downloads/poket-restaurants/latest.json", { cache: "no-cache" });
    if (!response.ok) return {};
    return await response.json();
  } catch (_) {
    return {};
  }
}

function releasePath(url) {
  try {
    const parsed = new URL(url, window.location.href);
    return /(^|\.)poksol\.com$/i.test(parsed.hostname) ? parsed.pathname : parsed.href;
  } catch (_) {
    return "";
  }
}

function fact(label, value) {
  return el("li", null, el("div", null, el("strong", { text: label }), el("span", { text: value || "Non renseigné" })));
}

function infoSection(user, userData) {
  const created = formatDate(user.metadata?.creationTime);
  const lastLogin = formatDate(userData.lastLoginAt || user.metadata?.lastSignInTime, true);
  const provider = user.providerData?.[0]?.providerId === "google.com" ? "Google" : (user.providerData?.[0]?.providerId || "Google");
  return el("section", { class: "rf-section", "aria-labelledby": "compte-info" },
    el("div", { class: "rf-wrap rf-split" },
      el("div", { class: "rf-copy" },
        el("h2", { id: "compte-info", text: "Mes informations" }),
        el("p", { text: "Ces informations viennent du compte avec lequel vous vous connectez à Poksol." }),
        el("div", { class: "rf-profile" },
          user.photoURL
            ? el("img", { class: "rf-avatar rf-avatar--photo", src: user.photoURL, alt: "", referrerpolicy: "no-referrer", width: "48", height: "48" })
            : el("div", { class: "rf-avatar", "aria-hidden": "true", text: initials(user.displayName, user.email) }),
          el("div", null, el("strong", { text: user.displayName || "Utilisateur Poksol" }), el("span", { text: user.email || "" }))
        ),
        el("div", { class: "rf-buttons" }, el("button", { class: "rf-btn rf-btn--outline", type: "button", "data-compte-logout": true, text: "Se déconnecter" }))
      ),
      el("ul", { class: "rf-rows rf-facts" },
        fact("Nom", user.displayName),
        fact("Adresse e-mail", user.email),
        fact("Connexion", provider),
        fact("Compte créé le", created),
        fact("Dernière connexion", lastLogin)
      )
    )
  );
}

function appStatusBadge(status) {
  const known = APP_STATUS[status];
  return el("p", { class: `rf-status rf-status--${known ? known.tone : "soon"}`, text: known ? known.label : "Bientôt disponible" });
}

function appDetails(entry) {
  const details = [];
  if (entry.plan) details.push(`Formule ${entry.plan}`);
  const trialEnd = formatDate(entry.trialEndsAt);
  const since = formatDate(entry.since);
  if (entry.status === "trial" && trialEnd) details.push(`Essai jusqu'au ${trialEnd}`);
  else if (since) details.push(`Depuis le ${since}`);
  return details.join(", ");
}

function poketApp(account, release) {
  const { restaurants, restaurantsFailed } = account;
  const active = restaurants.length > 0;
  const head = el("div", { class: "rf-app-head" },
    restaurantsFailed
      ? el("p", { class: "rf-status rf-status--soon", text: "Statut indisponible" })
      : el("p", { class: `rf-status rf-status--${active ? "live" : "soon"}`, text: active ? "Actif" : "Non activé" }),
    el("h3", { text: "Poket Restaurants" }),
    el("p", { text: "Caisse, prise de commandes et impression cuisine pour votre restaurant." })
  );

  const rows = [];
  if (restaurantsFailed) {
    rows.push(el("li", null, el("div", null, el("strong", { text: "Restaurants" }), el("span", { text: "Impossible de charger vos restaurants pour le moment. Rechargez la page pour réessayer." }))));
  } else if (!active) {
    rows.push(el("li", null, el("div", null, el("strong", { text: "Restaurants" }), el("span", { text: "Aucun restaurant rattaché à ce compte pour le moment." }))));
  } else {
    restaurants.forEach((restaurant) => {
      rows.push(el("li", null, el("div", null,
        el("strong", { text: restaurant.name }),
        el("span", { class: "rf-restaurant-meta" },
          el("span", { text: ROLE_LABELS[restaurant.role] || "Équipe" }),
          el("span", { class: "rf-inline-links" },
            link("Dashboard", `admin.html?restaurant=${encodeURIComponent(restaurant.id)}`),
            link("Page publique", `restaurants/?slug=${encodeURIComponent(restaurant.slug)}`)
          )
        )
      )));
    });
  }
  rows.push(el("li", null, el("a", { href: "poket-access.html" }, el("strong", { text: active ? "Ouvrir l'application" : "Créer ou rejoindre" }), el("span", { text: active ? "L'application navigateur, sans rien installer." : "Créez votre restaurant ou rejoignez-en un avec un code d'invitation." }))));
  if (active) rows.push(el("li", null, el("a", { href: "poket-access.html?mode=new" }, el("strong", { text: "Ajouter un restaurant" }), el("span", { text: "Créer un deuxième établissement sur ce compte." }))));
  const android = release.downloadUrl && releasePath(release.downloadUrl);
  const windows = release.windowsDownloadUrl && releasePath(release.windowsDownloadUrl);
  rows.push(el("li", null, el("a", { href: android || "/downloads/poket-restaurants/android/chez_marwan_pos_1.0.6+44.apk", download: true }, el("strong", { text: "Android" }), el("span", { text: "Télécharger l'APK pour tablette ou téléphone." }))));
  rows.push(el("li", null, el("a", { href: windows || "/downloads/poket-restaurants/windows/poket_restaurants_windows_1.0.6+44.zip", download: true }, el("strong", { text: "Windows" }), el("span", { text: "Télécharger l'archive ZIP pour ordinateur." }))));
  return el("article", { class: "rf-app" }, head, el("ul", { class: "rf-rows" }, rows));
}

function vtcApp(userData) {
  const entry = (userData.apps && userData.apps["vtc-hero"]) || null;
  const known = entry && APP_STATUS[entry.status];
  const head = el("div", { class: "rf-app-head" },
    known ? appStatusBadge(entry.status) : el("p", { class: "rf-status rf-status--soon", text: "Bientôt disponible" }),
    el("h3", { text: "VTC HERO" }),
    el("p", { text: "Réservations, devis, courses et factures pour les sociétés de VTC." })
  );
  const rows = [];
  if (known) {
    const detail = appDetails(entry);
    if (detail) rows.push(el("li", null, el("div", null, el("strong", { text: "Abonnement" }), el("span", { text: detail }))));
    if (entry.status === "active" || entry.status === "trial") {
      rows.push(el("li", null, el("a", { href: VTC_LOGIN_URL }, el("strong", { text: "Ouvrir l'application" }), el("span", { text: "Connectez-vous avec l'adresse utilisée pour VTC HERO." }))));
    }
  } else {
    rows.push(el("li", null, el("a", { href: ACCESS_MAIL }, el("strong", { text: "Demander un accès" }), el("span", { text: "Nous vous ouvrons VTC HERO dès que possible." }))));
  }
  rows.push(el("li", null, el("a", { href: "vtc-hero.html" }, el("strong", { text: "Découvrir VTC HERO" }), el("span", { text: "Fonctions, déroulé d'une course, formules." }))));
  return el("article", { class: "rf-app" }, head, el("ul", { class: "rf-rows" }, rows));
}

function appsSection(account, release) {
  return el("section", { class: "rf-section rf-section--mist", "aria-labelledby": "compte-apps" },
    el("div", { class: "rf-wrap" },
      el("h2", { id: "compte-apps", text: "Mes applications" }),
      el("p", { class: "rf-lead", text: "Les applications Poksol auxquelles vous avez accès, et celles que vous pouvez demander." }),
      el("div", { class: "rf-apps" }, poketApp(account, release), vtcApp(account.userData)),
      el("p", { class: "rf-note", text: "Poket Retail, Poket Services et Poket Booking apparaîtront ici dès leur ouverture." })
    )
  );
}

function signedOutSection(message) {
  return el("section", { class: "rf-section" },
    el("div", { class: "rf-wrap rf-split" },
      el("div", { class: "rf-copy" },
        el("h2", { text: "Connectez-vous pour voir votre compte" }),
        el("p", { text: "Avec votre compte Google, retrouvez vos informations et vos applications Poksol : celles qui sont actives et celles auxquelles vous avez souscrit." }),
        el("div", { class: "rf-buttons" }, el("button", { class: "rf-btn", type: "button", "data-compte-login": true, text: "Se connecter avec Google" })),
        message ? el("p", { class: "rf-fine", role: "alert", text: message }) : null
      ),
      el("ul", { class: "rf-rows" },
        fact("Vos informations", "Nom, adresse e-mail, dates de connexion."),
        fact("Poket Restaurants", "Vos restaurants, votre rôle, l'application et les téléchargements."),
        fact("VTC HERO", "Votre accès et votre formule, dès l'ouverture du service.")
      )
    )
  );
}

function render(...sections) {
  root.replaceChildren(...sections.filter(Boolean));
  bindButtons();
}

function setHeroState(signedIn) {
  loginButtons.forEach((button) => button.classList.toggle("is-hidden", signedIn));
  logoutButtons.forEach((button) => button.classList.toggle("is-hidden", !signedIn));
}

function readableAuthError(error) {
  if (error?.code === "auth/unauthorized-domain") return "Ce domaine n'est pas encore autorisé pour la connexion Google.";
  if (error?.code === "auth/popup-closed-by-user") return "La fenêtre Google a été fermée avant la fin de la connexion.";
  return "Connexion impossible pour le moment. Réessayez dans quelques instants.";
}

function bindButtons() {
  document.querySelectorAll("[data-compte-login]").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", async () => {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch (error) {
        render(signedOutSection(readableAuthError(error)));
      }
    });
  });
  document.querySelectorAll("[data-compte-logout]").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => signOut(auth));
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    setHeroState(false);
    render(signedOutSection());
    return;
  }
  setHeroState(true);
  render(el("section", { class: "rf-section" }, el("div", { class: "rf-wrap" }, el("p", { class: "rf-fine", role: "status", text: "Chargement de votre compte…" }))));
  const [account, release] = await Promise.all([loadAccount(user), loadRelease()]);
  render(infoSection(user, account.userData), appsSection(account, release));
});
