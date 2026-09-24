const firebaseConfig = {
  apiKey: "AIzaSyCRhBXuuJhbSDo9e4kQEEvc1x28HfxAi_E",
  authDomain: "restaurantpos-7a4f0d11.firebaseapp.com",
  projectId: "restaurantpos-7a4f0d11",
  storageBucket: "restaurantpos-7a4f0d11.firebasestorage.app",
  messagingSenderId: "486823214144",
  appId: "1:486823214144:web:a6253af9f0821929e8f3a5"
};

const DOWNLOADS = {
  web: "/apps/poket-restaurants/",
  android: "https://poksol.com/downloads/poket-restaurants/android/chez_marwan_pos_1.0.6+42.apk",
  windows: "https://poksol.com/downloads/poket-restaurants/windows/poket_restaurants_windows_1.0.6+40.zip"
};

// Les liens ci-dessus servent de repli : latest.json fait foi pour la version publiee.
const releaseReady = fetch("/downloads/poket-restaurants/latest.json", { cache: "no-cache" })
  .then((response) => (response.ok ? response.json() : null))
  .then((release) => {
    if (release?.downloadUrl) DOWNLOADS.android = release.downloadUrl;
    if (release?.windowsDownloadUrl) DOWNLOADS.windows = release.windowsDownloadUrl;
  })
  .catch(() => {});

// Permissions du module clients (alignees sur firestore.rules) :
// creation / modification / desactivation : owner, admin, manager ; suppression : owner, admin.
const CLIENT_MANAGER_ROLES = ["owner", "admin", "manager"];
const CLIENT_DELETE_ROLES = ["owner", "admin"];
const CLIENT_IMPORT_LIMIT = 500;

// Remplace le champ libre "Nom affichage" pour un particulier : le nom affiche partout
// (liste clients, devis, factures...) est calcule comme "Titre Nom Prenom", jamais retape.
const CIVILITY_OPTIONS = ["", "M.", "Mme"];

function customerDisplayName(civility, lastName, firstName, companyName, contactName) {
  return firstText(
    [civility, lastName, firstName].filter(Boolean).join(" "),
    companyName,
    contactName
  );
}

const CUSTOMER_ACCOUNT_FIELDS = [
  "movements", "accountMovements", "transactions", "ledger", "history",
  "balance", "solde", "accountBalance", "currentBalance", "balanceDue", "amountDue",
  "debitTotal", "totalDebits", "totalDebit", "creditTotal", "totalCredits", "totalCredit",
  "openTicketCount", "openTickets", "unpaidTickets", "pendingTicketCount",
  "movementCount", "movementsCount"
];

const CLIENT_COLUMNS = [
  { key: "name", label: "Name", kind: "text", className: "col-name" },
  { key: "email", label: "Email", kind: "text", className: "col-email" },
  { key: "phone", label: "Phone", kind: "text", className: "col-phone" },
  { key: "country", label: "Country", kind: "text", className: "col-country" },
  { key: "created", label: "Created", kind: "date", className: "col-created" },
  { key: "balance", label: "Solde", kind: "number", className: "col-balance" }
];

const CLIENT_SORT_LABELS = {
  text: ["Trier de A a Z", "Trier de Z a A"],
  date: ["Du plus ancien au plus recent", "Du plus recent au plus ancien"],
  number: ["Du plus petit au plus grand", "Du plus grand au plus petit"]
};

const CLIENT_IMPORT_HEADERS = {
  "type": "type",
  "nom affichage": "displayName",
  "display name": "displayName",
  "displayname": "displayName",
  "name": "displayName",
  "titre": "civility",
  "civilite": "civility",
  "civility": "civility",
  "prenom": "firstName",
  "first name": "firstName",
  "nom": "lastName",
  "last name": "lastName",
  "societe": "companyName",
  "company": "companyName",
  "entreprise": "companyName",
  "contact": "contactName",
  "telephone": "phone",
  "phone": "phone",
  "phone number": "phone",
  "tel": "phone",
  "email": "email",
  "e-mail": "email",
  "mail": "email",
  "pays": "country",
  "country": "country",
  "adresse": "address",
  "address": "address",
  "tax id": "taxId",
  "tva": "vatNumber",
  "vat": "vatNumber",
  "notes": "notes",
  "note": "notes",
  "statut": "status",
  "status": "status"
};

const DAYS = [
  ["monday", "Lundi"],
  ["tuesday", "Mardi"],
  ["wednesday", "Mercredi"],
  ["thursday", "Jeudi"],
  ["friday", "Vendredi"],
  ["saturday", "Samedi"],
  ["sunday", "Dimanche"]
];

const ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  staff: "Staff"
};

// Ce que chaque autorite permet (aligne sur firestore.rules).
const ROLE_SCOPES = {
  owner: "Acces complet : restaurant, equipe, clients, suppressions.",
  admin: "Gere l'equipe, les clients et la page publique ; peut supprimer.",
  manager: "Modifie le restaurant, les clients et les reservations ; ne supprime pas.",
  staff: "Consultation du dashboard, sans modification."
};

const MENU_TRANSLATION_LANGUAGES = new Set(["fr", "de", "en", "es", "it", "tr", "ar"]);
const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

let servicesPromise = null;
let currentUser = null;
const catalogAutosaveTimers = new Map();
let draggedCatalogCategory = null;

function getServices() {
  if (!servicesPromise) {
    servicesPromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js"),
      import("https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js")
    ]).then(([appModule, authModule, firestoreModule, storageModule]) => {
      const app = appModule.getApps().length
        ? appModule.getApp()
        : appModule.initializeApp(firebaseConfig);
      return {
        app,
        auth: authModule.getAuth(app),
        db: firestoreModule.getFirestore(app),
        storage: storageModule.getStorage(app),
        authModule,
        firestoreModule,
        storageModule
      };
    });
  }
  return servicesPromise;
}

async function signIn() {
  const services = await getServices();
  const provider = new services.authModule.GoogleAuthProvider();
  const result = await services.authModule.signInWithPopup(services.auth, provider);
  await ensureUser(result.user);
  return result.user;
}

async function signOut() {
  const services = await getServices();
  await services.authModule.signOut(services.auth);
}

async function ensureUser(user) {
  if (!user) return;
  const services = await getServices();
  const { doc, setDoc, serverTimestamp } = services.firestoreModule;
  await setDoc(doc(services.db, "users", user.uid), {
    uid: user.uid,
    displayName: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    lastLoginAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function getUserDoc(uid) {
  const services = await getServices();
  const { doc, getDoc } = services.firestoreModule;
  const snap = await getDoc(doc(services.db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function getRestaurant(id) {
  if (!id) return null;
  const services = await getServices();
  const { doc, getDoc } = services.firestoreModule;
  const snap = await getDoc(doc(services.db, "restaurants", id));
  if (!snap.exists()) return null;
  const baseData = snap.data();
  const settingsSnap = await getDoc(doc(services.db, "restaurants", id, "settings", "restaurant_profile")).catch(() => null);
  const settingsData = settingsSnap?.exists() ? settingsSnap.data() : {};
  const settingsProfile = settingsData.restaurantProfile || {};
  return normalizeRestaurant(snap.id, {
    ...baseData,
    ...settingsProfile,
    ...settingsData,
    restaurantProfile: {
      ...(baseData.restaurantProfile || {}),
      ...settingsProfile,
      ...settingsData
    }
  });
}

async function getPublicRestaurantBySlug(slug) {
  const cleanSlug = normalizeSlug(slug);
  if (!cleanSlug) return null;
  const services = await getServices();
  const { doc, getDoc } = services.firestoreModule;
  const candidates = uniqueValues([
    cleanSlug,
    legacyRestaurantIdFromSlug(cleanSlug),
    cleanSlug.replace(/-/g, "_"),
    cleanSlug.toUpperCase()
  ]);
  for (const id of candidates) {
    const snap = await getDoc(doc(services.db, "publicRestaurants", id)).catch(() => null);
    if (snap?.exists()) return normalizeRestaurant(snap.id, snap.data());
  }
  return null;
}

async function getRestaurantBySlug(slug) {
  const cleanSlug = normalizeSlug(slug);
  if (!cleanSlug) return null;
  const publicRestaurant = await getPublicRestaurantBySlug(cleanSlug);
  if (publicRestaurant) return publicRestaurant;
  const directIds = uniqueValues([
    cleanSlug,
    legacyRestaurantIdFromSlug(cleanSlug),
    cleanSlug.replace(/-/g, "_"),
    cleanSlug.toUpperCase()
  ]);
  for (const id of directIds) {
    const direct = await getRestaurant(id).catch(() => null);
    if (direct) return direct;
  }
  const services = await getServices();
  const { collection, getDocs, limit, query, where } = services.firestoreModule;
  const snaps = await getDocs(query(
    collection(services.db, "restaurants"),
    where("slug", "==", cleanSlug),
    limit(1)
  )).catch(() => null);
  if (!snaps) return null;
  if (snaps.empty) return null;
  const snap = snaps.docs[0];
  return getRestaurant(snap.id);
}

async function listUserRestaurants(uid) {
  if (!uid) return [];
  const services = await getServices();
  const { collection, doc, getDoc, getDocs, query, where } = services.firestoreModule;
  const userData = await getUserDoc(uid);
  const ids = new Set();
  if (userData?.activeRestaurantId) ids.add(userData.activeRestaurantId);
  if (Array.isArray(userData?.restaurantIds)) {
    userData.restaurantIds.forEach((id) => id && ids.add(id));
  }

  const owned = await getDocs(query(collection(services.db, "restaurants"), where("ownerUid", "==", uid)));
  owned.forEach((snap) => ids.add(snap.id));

  const restaurants = [];
  for (const id of ids) {
    const restaurant = await getRestaurant(id);
    if (!restaurant) continue;
    const staffSnap = await getDoc(doc(services.db, "restaurants", id, "staff", uid)).catch(() => null);
    const staffUserSnap = await getDoc(doc(services.db, "restaurants", id, "staff_users", uid)).catch(() => null);
    const staffRole = normalizeRole(staffSnap?.exists() ? staffSnap.data().role : "");
    const staffUserRole = normalizeRole(staffUserSnap?.exists() ? staffUserSnap.data().role : "");
    const role = highestRole([restaurant.ownerUid === uid || restaurant.createdBy === uid ? "owner" : "", staffRole, staffUserRole]) || "staff";
    restaurants.push({ ...restaurant, role });
  }
  return restaurants;
}

async function createRestaurantFromForm(form, user) {
  const services = await getServices();
  const { arrayUnion, collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } = services.firestoreModule;
  const data = new FormData(form);
  const name = text(data, "name");
  const slug = normalizeSlug(text(data, "slug") || name);
  if (!name || !slug) throw new Error("Nom et slug obligatoires.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Slug invalide. Utilisez lettres, chiffres et tirets.");
  }

  const restaurantRef = doc(services.db, "restaurants", slug);
  const existingById = await getDoc(restaurantRef);
  const existingBySlug = await getDocs(query(
    collection(services.db, "restaurants"),
    where("slug", "==", slug),
    limit(1)
  ));
  if (existingById.exists() || !existingBySlug.empty) {
    throw new Error("Ce slug est deja utilise.");
  }

  const restaurant = {
    id: slug,
    restaurantId: slug,
    name,
    tradeName: name,
    slug,
    ownerUid: user.uid,
    createdBy: user.uid,
    logoUrl: "",
    coverUrl: "",
    description: text(data, "description"),
    cuisineType: text(data, "cuisineType"),
    address: text(data, "address"),
    addressLine1: text(data, "address"),
    city: text(data, "city"),
    postalCode: text(data, "postalCode"),
    country: text(data, "country") || "France",
    phone: text(data, "phone"),
    email: text(data, "email") || user.email || "",
    website: "",
    instagram: "",
    facebook: "",
    googleMapsUrl: "",
    publicPageEnabled: true,
    qrMenuEnabled: false,
    reservationEnabled: true,
    openingHours: defaultOpeningHours(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(restaurantRef, restaurant);
  // Meme modele que l'application : une fiche staff « admin » pour le createur.
  await setDoc(doc(services.db, "restaurants", slug, "staff", user.uid), {
    uid: user.uid,
    userId: user.uid,
    restaurantId: slug,
    email: user.email || "",
    displayName: user.displayName || "",
    role: "admin",
    active: true,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await setDoc(doc(services.db, "users", user.uid), {
    uid: user.uid,
    displayName: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    activeRestaurantId: slug,
    restaurantIds: arrayUnion(slug),
    updatedAt: serverTimestamp()
  }, { merge: true });
  await syncPublicRestaurant(slug, restaurant);
  localStorage.setItem("poksolActiveRestaurantId", slug);
  return restaurant;
}

// Rattachement par invitation, comme dans l'application : le code ne donne pas
// d'acces direct, il cree une demande que valide un admin du restaurant
// (reviewAccessRequest). La fiche staff n'est creee que par cette validation.
async function requestRestaurantAccess(code, user) {
  const services = await getServices();
  const { doc, getDoc, serverTimestamp, setDoc } = services.firestoreModule;
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) throw new Error("Code invitation obligatoire.");

  const inviteSnap = await getDoc(doc(services.db, "restaurant_invites", normalizedCode)).catch(() => null);
  if (!inviteSnap?.exists()) throw new Error("Invitation introuvable ou expiree.");
  const invite = inviteSnap.data();
  if (["revoked", "expired", "cancelled", "used"].includes(invite.status) || invite.active === false) {
    throw new Error("Invitation inactive ou expiree.");
  }
  if (invite.expiresAt?.toDate && invite.expiresAt.toDate() < new Date()) {
    throw new Error("Invitation expiree.");
  }
  const reservedEmail = invite.invitedEmail || invite.email || "";
  if (reservedEmail && user.email && reservedEmail.toLowerCase() !== user.email.toLowerCase()) {
    throw new Error("Cette invitation est reservee a une autre adresse email.");
  }
  const restaurantId = invite.restaurantId;
  if (!restaurantId) throw new Error("Invitation incomplete : restaurant manquant.");
  const role = invite.role || "staff";
  if (!["admin", "manager", "staff"].includes(role)) throw new Error("Invitation invalide : role non autorise.");

  const staffSnap = await getDoc(doc(services.db, "restaurants", restaurantId, "staff", user.uid)).catch(() => null);
  if (staffSnap?.exists()) throw new Error("Vous etes deja membre de ce restaurant.");

  await setDoc(doc(services.db, "restaurants", restaurantId, "access_requests", user.uid), {
    userId: user.uid,
    restaurantId,
    restaurantName: invite.restaurantName || "",
    email: user.email || "",
    displayName: user.displayName || invite.displayName || "",
    status: "pending",
    requestType: "invite_code_join_request",
    requestedRole: role,
    joinInput: normalizedCode,
    inviteCode: normalizedCode,
    ...(reservedEmail ? { invitedEmail: reservedEmail } : {}),
    ...(invite.phone ? { phone: invite.phone } : {}),
    ...(invite.jobTitle ? { jobTitle: invite.jobTitle } : {}),
    provider: user.providerData?.[0]?.providerId || "google",
    emailVerified: user.emailVerified === true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  await setDoc(doc(services.db, "users", user.uid), {
    uid: user.uid,
    displayName: user.displayName || "",
    email: user.email || "",
    updatedAt: serverTimestamp()
  }, { merge: true });
  return { restaurantId, restaurantName: invite.restaurantName || restaurantId };
}

async function listAccessRequests(restaurantId) {
  const services = await getServices();
  const { collection, getDocs } = services.firestoreModule;
  const snaps = await getDocs(collection(services.db, "restaurants", restaurantId, "access_requests"));
  return snaps.docs
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .sort((a, b) => clientTimeValue(b.createdAt) - clientTimeValue(a.createdAt));
}

// Validation ou refus d'une demande par un admin : memes ecritures que l'application
// (fiches staff et staff_users, profil utilisateur, demande, invitation).
async function reviewAccessRequest(restaurantId, form, decision, admin) {
  if (!admin) throw new Error("Connexion requise.");
  const services = await getServices();
  const { arrayUnion, doc, getDoc, serverTimestamp, setDoc, writeBatch } = services.firestoreModule;
  const userId = form.dataset.requestId;
  if (!userId) throw new Error("Demande introuvable.");
  const requestRef = doc(services.db, "restaurants", restaurantId, "access_requests", userId);
  const requestSnap = await getDoc(requestRef);
  if (!requestSnap.exists()) throw new Error("Demande introuvable.");
  const request = requestSnap.data();
  if (request.status !== "pending") throw new Error("Cette demande a deja ete traitee.");

  const batch = writeBatch(services.db);
  if (decision !== "approve") {
    batch.set(requestRef, {
      status: "rejected",
      reviewedBy: admin.uid,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    await batch.commit();
    return "rejected";
  }

  const data = new FormData(form);
  const role = text(data, "role");
  if (!["admin", "manager", "staff"].includes(role)) throw new Error("Choisissez un role.");
  const jobTitle = text(data, "jobTitle").slice(0, 80);
  const email = String(request.email || "");
  const displayName = String(request.displayName || "");
  const nowIso = new Date().toISOString();
  const member = {
    uid: userId,
    email,
    displayName,
    username: displayName || (email.includes("@") ? email.split("@")[0] : ""),
    phone: String(request.phone || ""),
    jobTitle,
    provider: String(request.provider || "google"),
    emailVerified: request.emailVerified === true,
    role,
    active: true,
    restaurantId
  };
  batch.set(doc(services.db, "restaurants", restaurantId, "staff", userId), {
    ...member,
    joinedAt: serverTimestamp(),
    approvedAt: serverTimestamp(),
    approvedBy: admin.uid,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  }, { merge: true });
  batch.set(doc(services.db, "restaurants", restaurantId, "staff_users", userId), {
    ...member,
    approvedAt: nowIso,
    approvedBy: admin.uid,
    updatedAt: nowIso,
    createdAt: nowIso
  }, { merge: true });
  batch.update(doc(services.db, "users", userId), {
    activeRestaurantId: restaurantId,
    restaurantIds: arrayUnion(restaurantId),
    updatedAt: serverTimestamp()
  });
  batch.set(requestRef, {
    status: "approved",
    approvedRole: role,
    approvedDisplayName: displayName,
    approvedJobTitle: jobTitle,
    reviewedBy: admin.uid,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  await batch.commit();
  if (request.inviteCode) {
    // Invitation a usage unique. Ecriture a part : d'anciennes invitations du site
    // n'ont pas le champ inviteCode que la regle exige, sans que cela doive bloquer.
    await setDoc(doc(services.db, "restaurant_invites", request.inviteCode), {
      inviteCode: request.inviteCode,
      status: "used",
      active: false,
      usedBy: userId,
      usedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true }).catch(() => {});
  }
  return "approved";
}

async function uploadRestaurantImage(restaurantId, file, kind) {
  if (!file) return "";
  validateImageUpload(file);
  const services = await getServices();
  const { getDownloadURL, ref, uploadBytes } = services.storageModule;
  const extension = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `restaurants/${restaurantId}/branding/${kind}.${extension}`;
  const imageRef = ref(services.storage, path);
  await uploadBytes(imageRef, file, { contentType: file.type || "application/octet-stream" });
  return getDownloadURL(imageRef);
}

async function saveRestaurantProfile(restaurantId, form) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const data = new FormData(form);
  const existing = await getRestaurant(restaurantId);
  const logoFile = form.querySelector('[name="logoFile"]')?.files?.[0];
  const coverFile = form.querySelector('[name="coverFile"]')?.files?.[0];
  const documentLogoFile = form.querySelector('[name="documentLogoFile"]')?.files?.[0];
  const logoUrl = logoFile ? await uploadRestaurantImage(restaurantId, logoFile, "logo") : text(data, "logoUrl") || existing?.logoUrl || "";
  const coverUrl = coverFile ? await uploadRestaurantImage(restaurantId, coverFile, "cover") : text(data, "coverUrl") || existing?.coverUrl || "";
  const documentLogoUrl = documentLogoFile ? await uploadRestaurantImage(restaurantId, documentLogoFile, "logo-document") : text(data, "documentLogoUrl") || existing?.documentLogoUrl || "";
  const addressLine1 = text(data, "address");
  const postalCode = text(data, "postalCode");
  const city = text(data, "city");
  const country = text(data, "country");
  const address = fullAddress(addressLine1, postalCode, city, country);
  const payload = {
    name: text(data, "name"),
    tradeName: text(data, "name"),
    logoUrl,
    coverUrl,
    documentLogoUrl,
    description: text(data, "description"),
    cuisineType: text(data, "cuisineType"),
    address,
    addressLine1,
    addressLine2: "",
    city,
    postalCode,
    country,
    phone: text(data, "phone"),
    email: text(data, "email"),
    website: text(data, "website"),
    instagram: text(data, "instagram"),
    facebook: text(data, "facebook"),
    googleMapsUrl: text(data, "googleMapsUrl"),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(services.db, "restaurants", restaurantId), payload, { merge: true });
  await syncPublicRestaurant(restaurantId);
}

async function saveOpeningHours(restaurantId, form) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const data = new FormData(form);
  const openingHoursByDay = {};
  DAYS.forEach(([key]) => {
    const lunchEnabled = data.get(`${key}.lunchEnabled`) === "on";
    const dinnerEnabled = data.get(`${key}.dinnerEnabled`) === "on";
    openingHoursByDay[key] = {
      open: lunchEnabled || dinnerEnabled,
      lunchStart: lunchEnabled ? text(data, `${key}.lunchStart`) || "12:00" : "",
      lunchEnd: lunchEnabled ? text(data, `${key}.lunchEnd`) || "14:30" : "",
      dinnerStart: dinnerEnabled ? text(data, `${key}.dinnerStart`) || "19:00" : "",
      dinnerEnd: dinnerEnabled ? text(data, `${key}.dinnerEnd`) || "22:30" : ""
    };
  });
  const openingHours = openingHoursToList(openingHoursByDay);
  await setDoc(doc(services.db, "restaurants", restaurantId), {
    openingHours,
    openingHoursByDay,
    updatedAt: serverTimestamp()
  }, { merge: true });
  await syncPublicRestaurant(restaurantId);
}

async function savePublicSettings(restaurantId, form) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const data = new FormData(form);
  const primaryColor = normalizeHexColor(text(data, "primaryColor"), "#0A2540");
  const accentColor = normalizeHexColor(text(data, "accentColor"), "#1976F3");
  const publicPageEnabled = data.get("publicPageEnabled") === "on";
  const reservationEnabled = data.get("reservationEnabled") === "on";
  await setDoc(doc(services.db, "restaurants", restaurantId), {
    publicPageEnabled,
    // QR menu and reservations are disabled/greyed in the UI whenever the public page
    // is off, so their fields aren't submitted then: only write them while the page is
    // on, otherwise this merge would silently erase their last saved state.
    ...(publicPageEnabled ? {
      qrMenuEnabled: data.get("qrMenuEnabled") === "on",
      reservationEnabled
    } : {}),
    publicPageSettings: {
      visibleSections: {
        hero: true,
        hours: true,
        menu: true,
        reservations: publicPageEnabled && reservationEnabled,
        gallery: true,
        contact: true
      },
      customMessage: text(data, "customMessage"),
      theme: {
        primaryColor,
        accentColor
      },
      updatedAt: serverTimestamp()
    },
    updatedAt: serverTimestamp()
  }, { merge: true });
  await syncPublicRestaurant(restaurantId);
}

async function saveQrMenu(restaurantId, form, menu = null) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const data = new FormData(form);
  const catalogMenu = menu?.categories ? menu : await listCatalogMenu(restaurantId).catch(() => null);
  const categoryIds = new Set(catalogMenu?.categories?.map((category) => category.id) || []);
  const categoryOrder = catalogCategoryOrderMap(form);
  const itemRefs = [];
  catalogMenu?.categories?.forEach((category) => {
    category.items.forEach((item) => itemRefs.push({ categoryId: category.id, itemId: item.id }));
  });

  await Promise.all([
    ...[...categoryIds].map((categoryId) => setDoc(
      doc(services.db, "restaurants", restaurantId, "catalog_categories", categoryId),
      {
        publicVisible: data.get(`category.${categoryId}.publicVisible`) === "on",
        publicDisplayName: text(data, `category.${categoryId}.publicDisplayName`),
        publicDescription: text(data, `category.${categoryId}.publicDescription`),
        ...(categoryOrder.has(categoryId) ? { publicDisplayOrder: categoryOrder.get(categoryId) } : {}),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    )),
    ...itemRefs.map(async ({ categoryId, itemId }) => {
      const itemField = `item.${categoryId}.${itemId}`;
      const file = form.querySelector(`[name="${CSS.escape(itemField)}.imageFile"]`)?.files?.[0];
      const imageUrl = file ? await uploadCatalogItemImage(restaurantId, categoryId, itemId, file) : "";
      await setDoc(
        doc(services.db, "restaurants", restaurantId, "catalog_categories", categoryId, "items", itemId),
        {
          publicVisible: data.get(`${itemField}.publicVisible`) === "on",
          publicDisplayName: text(data, `${itemField}.publicDisplayName`),
          publicDescription: text(data, `${itemField}.publicDescription`),
          ...(data.has(`${itemField}.publicPrice`) ? { publicPrice: text(data, `${itemField}.publicPrice`) } : {}),
          imageUrl: imageUrl || text(data, `${itemField}.imageUrl`),
          ...(imageUrl ? { imageUrl } : {}),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    })
  ]);

  await setDoc(doc(services.db, "restaurants", restaurantId, "menus", "main"), {
    title: text(data, "title") || "Menu principal",
    type: text(data, "type") || "catalog",
    externalUrl: text(data, "externalUrl"),
    pdfUrl: text(data, "pdfUrl"),
    isActive: data.get("isActive") === "on",
    updatedAt: serverTimestamp()
  }, { merge: true });
  await syncPublicRestaurant(restaurantId);
}

async function saveCatalogCategoryOrder(restaurantId, form) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const order = catalogCategoryOrderMap(form);
  await Promise.all([...order].map(([categoryId, publicDisplayOrder]) => setDoc(
    doc(services.db, "restaurants", restaurantId, "catalog_categories", categoryId),
    { publicDisplayOrder, updatedAt: serverTimestamp() },
    { merge: true }
  )));
  await syncPublicRestaurant(restaurantId);
}

async function uploadCatalogItemImage(restaurantId, categoryId, itemId, file) {
  validateImageUpload(file);
  const services = await getServices();
  const { getDownloadURL, ref, uploadBytes } = services.storageModule;
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `restaurants/${restaurantId}/catalog/${categoryId}/${itemId}.${extension}`;
  const imageRef = ref(services.storage, path);
  await uploadBytes(imageRef, file, { contentType: file.type || "application/octet-stream" });
  return getDownloadURL(imageRef);
}

async function listReservations(restaurantId) {
  const services = await getServices();
  const { collection, getDocs } = services.firestoreModule;
  const snaps = await getDocs(collection(services.db, "restaurants", restaurantId, "reservations"));
  return snaps.docs
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .sort((a, b) => reservationSortTime(b) - reservationSortTime(a));
}

async function listCustomers(restaurantId) {
  const services = await getServices();
  const { collection, getDocs } = services.firestoreModule;
  const collectionNames = ["customers", "Customers"];
  const results = await Promise.all(collectionNames.map(async (collectionName) => {
    try {
      const snaps = await getDocs(collection(services.db, "restaurants", restaurantId, collectionName));
      const customers = await Promise.all(snaps.docs.map(async (snap) => {
        const movements = await listCustomerMovements(restaurantId, collectionName, snap.id).catch(() => []);
        return {
          id: snap.id,
          customerCollection: collectionName,
          ...snap.data(),
          movements
        };
      }));
      return {
        collectionName,
        customers
      };
    } catch (error) {
      return { collectionName, error };
    }
  }));
  const byPath = new Map();
  const errors = [];
  results.forEach((result) => {
    if (result.error) {
      errors.push(`${result.collectionName}: ${readableFirebaseError(result.error)}`);
      return;
    }
    result.customers.forEach((customer) => {
      byPath.set(`${customer.customerCollection}/${customer.id}`, customer);
    });
  });
  return {
    customers: [...byPath.values()],
    errors,
    checkedCollections: collectionNames
  };
}

async function listCustomerMovements(restaurantId, collectionName, customerId) {
  const services = await getServices();
  const { collection, getDocs } = services.firestoreModule;
  const snaps = await getDocs(collection(
    services.db,
    "restaurants",
    restaurantId,
    customerCollectionName(collectionName),
    customerId,
    "movements"
  ));
  return snaps.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
}

async function createCustomerAccount(restaurantId, form, user) {
  const services = await getServices();
  const { addDoc, collection, serverTimestamp } = services.firestoreModule;
  const data = customerAccountPayload(form);
  if (!hasCustomerIdentity(data)) {
    throw new Error("Renseignez au moins un nom, une societe, un telephone ou un email.");
  }
  const docRef = await addDoc(collection(services.db, "restaurants", restaurantId, "customers"), {
    ...data,
    active: true,
    createdBy: user?.uid || "",
    createdByEmail: user?.email || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return docRef.id;
}

async function updateCustomerAccount(restaurantId, form) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const customerId = form.dataset.customerId;
  const customerCollection = customerCollectionName(form.dataset.customerCollection);
  if (!customerId) throw new Error("Client introuvable.");
  const data = customerAccountPayload(form);
  if (!hasCustomerIdentity(data)) {
    throw new Error("Renseignez au moins un nom, une societe, un telephone ou un email.");
  }
  await setDoc(doc(services.db, "restaurants", restaurantId, customerCollection, customerId), {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function setCustomerAccountActive(restaurantId, customerId, active, collectionName = "customers") {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  if (!customerId) throw new Error("Client introuvable.");
  await setDoc(doc(services.db, "restaurants", restaurantId, customerCollectionName(collectionName), customerId), {
    active,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function deleteCustomerAccount(restaurantId, customerId, collectionName = "customers") {
  const services = await getServices();
  const { deleteDoc, doc } = services.firestoreModule;
  if (!customerId) throw new Error("Client introuvable.");
  await deleteDoc(doc(services.db, "restaurants", restaurantId, customerCollectionName(collectionName), customerId));
}

function customerCollectionName(value) {
  return value === "Customers" ? "Customers" : "customers";
}

function customerAccountPayload(form) {
  const data = new FormData(form);
  const companyName = text(data, "companyName");
  const taxId = text(data, "taxId");
  const vatNumber = text(data, "vatNumber");
  const type = normalizeCustomerType(text(data, "type"), { companyName, taxId, vatNumber });
  const civility = text(data, "civility");
  const firstName = text(data, "firstName");
  const lastName = text(data, "lastName");
  const contactName = text(data, "contactName");
  return {
    type,
    displayName: customerDisplayName(civility, lastName, firstName, companyName, contactName),
    civility,
    firstName,
    lastName,
    companyName,
    contactName,
    phone: text(data, "phone"),
    email: text(data, "email"),
    address: text(data, "address"),
    country: text(data, "country") || "France",
    taxId,
    vatNumber,
    notes: text(data, "notes")
  };
}

function hasCustomerIdentity(data = {}) {
  return !!firstText(
    data.displayName,
    data.firstName,
    data.lastName,
    data.companyName,
    data.contactName,
    data.phone,
    data.email
  );
}

function normalizeCustomerType(type, customer = {}) {
  if (type === "company") return "company";
  return firstText(customer.companyName, customer.taxId, customer.vatNumber) ? "company" : "individual";
}

async function getActiveMenu(restaurantId) {
  const services = await getServices();
  const { doc, getDoc } = services.firestoreModule;
  const snap = await getDoc(doc(services.db, "restaurants", restaurantId, "menus", "main"));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// Reglage global de l'application (restaurants/{id}/settings/catalogRules, meme doc que le POS) :
// coupe-circuit qui masque le mode "par piece" partout sans toucher a la config des categories.
async function getCatalogPieceSaleEnabled(restaurantId) {
  const services = await getServices();
  const { doc, getDoc } = services.firestoreModule;
  const snap = await getDoc(doc(services.db, "restaurants", restaurantId, "settings", "catalogRules")).catch(() => null);
  return snap?.exists() ? snap.data()?.pieceSale?.pieceSaleOrderingEnabled === true : false;
}

async function listCatalogMenu(restaurantId, options = {}) {
  const services = await getServices();
  const { collection, getDocs } = services.firestoreModule;
  const categorySnaps = await getDocs(collection(services.db, "restaurants", restaurantId, "catalog_categories"));
  const categories = await Promise.all(categorySnaps.docs.map(async (categorySnap) => {
    const category = { id: categorySnap.id, ...categorySnap.data() };
    const itemSnaps = await getDocs(collection(services.db, "restaurants", restaurantId, "catalog_categories", categorySnap.id, "items"));
    const items = itemSnaps.docs
      .map((itemSnap) => normalizeCatalogItem({ id: itemSnap.id, categoryId: categorySnap.id, ...itemSnap.data() }))
      .filter((item) => !options.publicOnly || isPublicCatalogEntry(item))
      .sort(sortByDisplayOrder);
    return {
      ...normalizeCatalogCategory(category),
      items
    };
  }));
  return {
    title: "Menu",
    type: "catalog",
    isActive: true,
    categories: categories
      .filter((category) => !options.publicOnly || isPublicCatalogEntry(category) && category.items.length)
      .sort(sortByDisplayOrder)
  };
}

async function syncPublicRestaurant(restaurantId, restaurantOverride = null) {
  if (!restaurantId) return;
  const services = await getServices();
  const { doc, getDoc, serverTimestamp, setDoc } = services.firestoreModule;
  const restaurant = restaurantOverride || await getRestaurant(restaurantId).catch(() => null);
  if (!restaurant) return;
  const menuSnap = await getDoc(doc(services.db, "restaurants", restaurant.id || restaurantId, "menus", "main")).catch(() => null);
  const catalogMenu = await listCatalogMenu(restaurant.id || restaurantId, { publicOnly: true }).catch(() => null);
  const savedMenu = menuSnap?.exists() ? { id: menuSnap.id, ...menuSnap.data() } : null;
  const menu = catalogMenu?.categories?.length
    ? { ...(savedMenu || {}), ...catalogMenu, title: savedMenu?.title || catalogMenu.title, type: savedMenu?.type || "catalog", isActive: restaurant.qrMenuEnabled === true }
    : savedMenu;
  const publicData = buildPublicRestaurantPayload(restaurant, menu, serverTimestamp());
  const publicId = publicData.slug || normalizeSlug(publicData.id || restaurantId);
  if (!publicId) return;
  await setDoc(doc(services.db, "publicRestaurants", publicId), publicData, { merge: true });
}

function buildPublicRestaurantPayload(restaurant, menu, updatedAt) {
  const normalized = normalizeRestaurant(restaurant.id || restaurant.restaurantId || restaurant.slug, restaurant);
  const slug = normalizeSlug(normalized.slug || normalized.name || normalized.id);
  const openingHours = normalizeHours(normalized.openingHours);
  const openingHoursByDay = resolveOpeningHoursByDay(normalized.openingHours, restaurant);
  return {
    id: normalized.id,
    restaurantId: normalized.restaurantId || normalized.id,
    slug,
    name: normalized.name,
    tradeName: normalized.tradeName || normalized.name,
    logoUrl: normalized.logoUrl || "",
    coverUrl: normalized.coverUrl || "",
    description: normalized.description || "",
    cuisineType: normalized.cuisineType || "",
    address: normalized.address || normalized.addressLine1 || "",
    addressLine1: normalized.addressLine1 || normalized.address || "",
    city: normalized.city || "",
    postalCode: normalized.postalCode || "",
    country: normalized.country || "France",
    phone: normalized.phone || "",
    email: normalized.email || "",
    website: normalized.website || "",
    instagram: normalized.instagram || "",
    facebook: normalized.facebook || "",
    googleMapsUrl: normalized.googleMapsUrl || "",
    publicPageEnabled: normalized.publicPageEnabled !== false,
    qrMenuEnabled: normalized.qrMenuEnabled === true || menu?.isActive === true,
    reservationEnabled: normalized.reservationEnabled !== false,
    publicPageSettings: {
      ...(restaurant.publicPageSettings || normalized.publicPageSettings || {}),
      theme: {
        primaryColor: normalizeHexColor(restaurant.publicPageSettings?.theme?.primaryColor || normalized.publicPageSettings?.theme?.primaryColor, "#0A2540"),
        accentColor: normalizeHexColor(restaurant.publicPageSettings?.theme?.accentColor || normalized.publicPageSettings?.theme?.accentColor, "#1976F3")
      }
    },
    openingHours,
    openingHoursByDay,
    menu: menu ? {
      title: menu.title || "Menu principal",
      type: menu.type || "",
      externalUrl: menu.externalUrl || "",
      pdfUrl: menu.pdfUrl || "",
      items: Array.isArray(menu.items) ? menu.items : [],
      categories: Array.isArray(menu.categories) ? menu.categories : [],
      isActive: menu.isActive === true
    } : null,
    updatedAt
  };
}

async function updateReservationStatus(restaurantId, reservationId, status) {
  const services = await getServices();
  const { doc, serverTimestamp, updateDoc } = services.firestoreModule;
  await updateDoc(doc(services.db, "restaurants", restaurantId, "reservations", reservationId), {
    status,
    updatedAt: serverTimestamp()
  });
}

async function listMembers(restaurantId) {
  const services = await getServices();
  const { collection, getDocs } = services.firestoreModule;
  const [staffSnap, staffUsersSnap] = await Promise.all([
    getDocs(collection(services.db, "restaurants", restaurantId, "staff")).catch(() => null),
    getDocs(collection(services.db, "restaurants", restaurantId, "staff_users")).catch(() => null)
  ]);
  const byUid = new Map();
  [staffSnap, staffUsersSnap].forEach((snap) => {
    snap?.docs.forEach((docSnap) => {
      const data = { id: docSnap.id, ...docSnap.data() };
      const uid = data.uid || data.userId || docSnap.id;
      const existing = byUid.get(uid) || {};
      byUid.set(uid, {
        ...existing,
        ...data,
        uid,
        role: highestRole([existing.role, data.role]) || data.role || existing.role || "staff",
        status: data.status || existing.status || (data.active === false ? "inactive" : "active")
      });
    });
  });
  return [...byUid.values()];
}

async function createInvitation(restaurantId, form, user) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const data = new FormData(form);
  const code = normalizeCode(text(data, "code") || `${restaurantId}-${Math.random().toString(36).slice(2, 8)}`);
  const requestedRole = text(data, "role");
  const invite = {
    inviteCode: code,
    code,
    restaurantId,
    email: text(data, "email").toLowerCase(),
    role: ["admin", "manager", "staff"].includes(requestedRole) ? requestedRole : "staff",
    status: "active",
    active: true,
    createdBy: user.uid,
    createdByUid: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(services.db, "restaurant_invites", code), invite);
  return code;
}

async function submitReservation(restaurant, form) {
  const services = await getServices();
  const { addDoc, collection, serverTimestamp } = services.firestoreModule;
  const data = new FormData(form);
  if (!restaurant?.id) throw new Error("Restaurant introuvable.");
  if (restaurant.reservationEnabled === false) throw new Error("Les reservations ne sont pas actives pour ce restaurant.");
  const date = text(data, "date");
  const time = text(data, "time");
  const customerName = text(data, "name");
  const customerPhone = text(data, "phone");
  const customerEmail = text(data, "email");
  if (!customerName || !customerPhone || !date || !time) {
    throw new Error("Nom, telephone, date et heure sont obligatoires.");
  }
  const reservedAt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(reservedAt.getTime())) {
    throw new Error("Date ou heure invalide.");
  }
  const restaurantId = restaurant.restaurantId || restaurant.id;
  const creation = publicReservationCreationMeta(restaurant);
  const payload = {
    restaurantId,
    customerName,
    customerPhone,
    customerEmail,
    customer: {
      name: customerName,
      phone: customerPhone,
      email: customerEmail
    },
    date,
    time,
    phone: customerPhone,
    email: customerEmail,
    guests: Number(text(data, "guests") || 1),
    notes: text(data, "message"),
    status: "planned",
    reservedAt: services.firestoreModule.Timestamp.fromDate(reservedAt),
    source: creation.source,
    sourceLabel: creation.sourceLabel,
    reservationSource: creation.reservationSource,
    channel: "web",
    createdBy: creation.createdBy,
    createdByName: creation.createdByName,
    createdByType: creation.createdByType,
    sourceHost: creation.sourceHost,
    referrer: creation.referrer,
    origin: window.location.href,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (!isReservationWithinOpeningHours(restaurant.openingHours, date, time)) {
    throw new Error("Ce créneau est en dehors des horaires d'ouverture. Choisissez une heure ouverte ou contactez le restaurant.");
  }
  await addDoc(collection(services.db, "restaurants", restaurantId, "reservations"), payload);
}

function publicReservationCreationMeta(restaurant = {}) {
  const params = new URLSearchParams(window.location.search);
  const explicitSource = firstText(params.get("source"), params.get("utm_source"));
  const explicitHost = firstText(params.get("sourceHost"), params.get("host"), params.get("site"));
  const referrerHost = safeHostname(document.referrer);
  const currentHost = window.location.hostname || "";
  const sourceHost = explicitHost || referrerHost || currentHost;
  const restaurantHost = safeHostname(restaurant.website);
  const isPoksolHost = /(^|\.)poksol\.com$/i.test(currentHost);
  const isExternalHook = explicitSource === "hook" ||
    explicitSource === "external_site_hook" ||
    explicitHost ||
    (referrerHost && !/(^|\.)poksol\.com$/i.test(referrerHost));
  if (isExternalHook) {
    const labelHost = explicitHost || referrerHost || restaurantHost || sourceHost;
    return {
      source: "external_site_hook",
      sourceLabel: labelHost ? `Site ${labelHost} via hook` : "Site externe via hook",
      reservationSource: "external_site_hook",
      createdBy: "external_site_hook",
      createdByName: labelHost ? `Hook ${labelHost}` : "Hook site externe",
      createdByType: "hook",
      sourceHost: labelHost || sourceHost,
      referrer: document.referrer || ""
    };
  }
  return {
    source: "poksol_public_page",
    sourceLabel: isPoksolHost ? "Page publique Poksol" : `Page publique ${currentHost || "Poksol"}`,
    reservationSource: "poksol_public_page",
    createdBy: "poksol_public_page",
    createdByName: "Page publique Poksol",
    createdByType: "public_page",
    sourceHost,
    referrer: document.referrer || ""
  };
}

function safeHostname(value) {
  if (!value) return "";
  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`).hostname;
  } catch (_) {
    return "";
  }
}

async function submitContact(form) {
  const services = await getServices();
  const { addDoc, collection, serverTimestamp } = services.firestoreModule;
  const data = new FormData(form);
  await addDoc(collection(services.db, "contactMessages"), {
    name: text(data, "name"),
    email: text(data, "email"),
    company: text(data, "company"),
    message: text(data, "message"),
    status: "new",
    createdAt: serverTimestamp()
  });
}

function initAuthObserver(callback) {
  getServices().then((services) => {
    services.authModule.onAuthStateChanged(services.auth, async (user) => {
      try {
        currentUser = user;
        if (user) await ensureUser(user).catch(() => {});
        await callback(user);
      } catch (error) {
        await callback(null, error);
      }
    });
  }).catch((error) => callback(null, error));
}

function initAccountPage() {
  const root = document.querySelector("[data-platform-account]");
  if (!root) return;
  root.innerHTML = accountSignedOutHtml();
  root.addEventListener("click", async (event) => {
    const login = event.target.closest("[data-platform-login]");
    const logout = event.target.closest("[data-platform-logout]");
    if (login) await signIn();
    if (logout) await signOut();
  });
  root.addEventListener("input", (event) => {
    if (event.target.name === "name") {
      const slugField = root.querySelector('[name="slug"]');
      if (slugField && !slugField.dataset.touched) slugField.value = normalizeSlug(event.target.value);
    }
    if (event.target.name === "slug") event.target.dataset.touched = "true";
  });
  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const status = form.querySelector("[data-form-status]");
    try {
      status.textContent = "Enregistrement en cours...";
      if (form.matches("[data-create-restaurant-form]")) {
        const restaurant = await createRestaurantFromForm(form, currentUser);
        status.textContent = "Restaurant cree.";
        window.location.href = `admin.html?restaurant=${encodeURIComponent(restaurant.id)}`;
      }
      if (form.matches("[data-join-restaurant-form]")) {
        const request = await requestRestaurantAccess(form.code.value, currentUser);
        status.textContent = `Demande envoyee${request.restaurantName ? ` a ${request.restaurantName}` : ""}. Un administrateur du restaurant doit la valider ; vous serez rattache ensuite.`;
        form.reset();
      }
    } catch (error) {
      status.textContent = error.message || String(error);
    }
  });
  initAuthObserver((user, error) => {
    if (error) root.innerHTML = alertHtml("Firebase indisponible pour le moment.");
    else renderAccount(root, user).catch((accountError) => {
      root.innerHTML = accountErrorHtml(accountError);
    });
  });
}

async function renderAccount(root, user) {
  if (!user) {
    root.innerHTML = accountSignedOutHtml();
    return;
  }
  const restaurants = await listUserRestaurants(user.uid).catch(() => []);
  await releaseReady;
  root.innerHTML = accountSignedInHtml(user, restaurants);
}

function initDashboardPage() {
  const root = document.querySelector("[data-dashboard-root]");
  if (!root) return;
  root.innerHTML = alertHtml("Chargement du dashboard...");
  root.addEventListener("click", async (event) => {
    if (!event.target.closest(".quote-client-combobox")) {
      root.querySelectorAll("[data-quote-client-combobox-list]:not([hidden])").forEach((list) => { list.hidden = true; });
    }
    const quoteClientOption = event.target.closest("[data-quote-client-option]");
    if (quoteClientOption) {
      event.preventDefault();
      selectQuoteClientOption(root, quoteClientOption);
      return;
    }
    const login = event.target.closest("[data-platform-login]");
    if (login) signIn();
    const tabButton = event.target.closest("[data-dashboard-tab]");
    if (tabButton) {
      root.querySelectorAll("[data-dashboard-tab]").forEach((button) => button.classList.toggle("is-active", button === tabButton));
      root.querySelectorAll("[data-dashboard-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.dashboardPanel === tabButton.dataset.dashboardTab));
      root.querySelector(".dashboard-shell")?.classList.remove("is-nav-open");
    }
    const navToggle = event.target.closest("[data-dashboard-nav-toggle]");
    if (navToggle) {
      root.querySelector(".dashboard-shell")?.classList.toggle("is-nav-open");
    }
    const navBackdrop = event.target.closest("[data-dashboard-nav-backdrop]");
    if (navBackdrop) {
      root.querySelector(".dashboard-shell")?.classList.remove("is-nav-open");
    }
    const tabLink = event.target.closest("[data-dashboard-tab-link]");
    if (tabLink) {
      event.preventDefault();
      const targetTab = tabLink.dataset.dashboardTabLink;
      root.querySelectorAll("[data-dashboard-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.dashboardTab === targetTab));
      root.querySelectorAll("[data-dashboard-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.dashboardPanel === targetTab));
    }
    const copyButton = event.target.closest("[data-copy]");
    if (copyButton) navigator.clipboard?.writeText(copyButton.dataset.copy);
    const columnToggle = event.target.closest("[data-client-col-toggle]");
    if (columnToggle) {
      event.preventDefault();
      toggleClientColumnMenu(root, columnToggle.dataset.clientColToggle);
      return;
    }
    const columnSort = event.target.closest("[data-client-col-sort]");
    if (columnSort) {
      event.preventDefault();
      setClientColumnSort(root, columnSort.dataset.clientColSort);
      return;
    }
    const columnClear = event.target.closest("[data-client-col-clear]");
    if (columnClear) {
      event.preventDefault();
      clearClientColumn(root, columnClear.dataset.clientColClear);
      closeClientColumnMenus(root);
      return;
    }
    if (!event.target.closest(".client-col-head")) closeClientColumnMenus(root);
    const reservationAddOpen = event.target.closest("[data-reservation-add-open]");
    if (reservationAddOpen) {
      event.preventDefault();
      openDashboardReservationAdd(root);
      return;
    }
    const quoteRow = event.target.closest("[data-quote-row]");
    if (quoteRow) {
      event.preventDefault();
      openQuoteDetail(root, quoteRow.dataset.quoteRow);
      return;
    }
    const invoiceRow = event.target.closest("[data-invoice-row]");
    if (invoiceRow) {
      event.preventDefault();
      openInvoiceDetail(root, invoiceRow.dataset.invoiceRow);
      return;
    }
    const quoteCreateOpen = event.target.closest("[data-quote-create-open]");
    if (quoteCreateOpen) {
      event.preventDefault();
      const section = quoteCreateOpen.closest("[data-quotes-section]");
      resetQuoteCreateForm(root, section?.querySelector("[data-dashboard-quote-form]"));
      section?.querySelector("[data-quotes-list-view]")?.classList.add("is-hidden");
      section?.querySelector("[data-quote-create-page]")?.classList.remove("is-hidden");
      return;
    }
    const quoteCreateClose = event.target.closest("[data-quote-create-close]");
    if (quoteCreateClose) {
      event.preventDefault();
      const section = quoteCreateClose.closest("[data-quotes-section]");
      section?.querySelector("[data-quote-create-page]")?.classList.add("is-hidden");
      section?.querySelector("[data-quotes-list-view]")?.classList.remove("is-hidden");
      return;
    }
    const invoiceCreateOpen = event.target.closest("[data-invoice-create-open]");
    if (invoiceCreateOpen) {
      event.preventDefault();
      const section = invoiceCreateOpen.closest("[data-invoices-section]");
      resetQuoteCreateForm(root, section?.querySelector("[data-dashboard-invoice-form]"));
      section?.querySelector("[data-invoices-list-view]")?.classList.add("is-hidden");
      section?.querySelector("[data-invoice-create-page]")?.classList.remove("is-hidden");
      return;
    }
    const invoiceCreateClose = event.target.closest("[data-invoice-create-close]");
    if (invoiceCreateClose) {
      event.preventDefault();
      const section = invoiceCreateClose.closest("[data-invoices-section]");
      section?.querySelector("[data-invoice-create-page]")?.classList.add("is-hidden");
      section?.querySelector("[data-invoices-list-view]")?.classList.remove("is-hidden");
      return;
    }
    const quoteAddClient = event.target.closest("[data-quote-add-client]");
    if (quoteAddClient) {
      event.preventDefault();
      openQuoteAddClient(root, quoteAddClient.closest("form"));
      return;
    }
    const quoteAddLine = event.target.closest("[data-quote-add-line]");
    if (quoteAddLine) {
      event.preventDefault();
      quoteAddLine.closest("form")?.querySelector("[data-quote-lines]")?.insertAdjacentHTML("beforeend", quoteLineRowHtml());
      return;
    }
    const quoteRemoveLine = event.target.closest("[data-quote-line-remove]");
    if (quoteRemoveLine) {
      event.preventDefault();
      const quoteForm = quoteRemoveLine.closest("form");
      quoteRemoveLine.closest("[data-quote-line]")?.remove();
      updateQuoteFormTotals(quoteForm);
      return;
    }
    const quoteLineCatalog = event.target.closest("[data-quote-line-catalog]");
    if (quoteLineCatalog) {
      event.preventDefault();
      openQuoteCatalogPicker(root, quoteLineCatalog.closest("form"), quoteLineCatalog.closest("[data-quote-line]"));
      return;
    }
    const quotePreview = event.target.closest("[data-quote-preview]");
    if (quotePreview) {
      event.preventDefault();
      const form = quotePreview.closest("form");
      const status = form?.querySelector("[data-form-status]");
      try {
        await previewQuoteFromForm(root, form);
      } catch (error) {
        if (status) status.textContent = error.message || String(error);
      }
      return;
    }
    const invoicePreview = event.target.closest("[data-invoice-preview]");
    if (invoicePreview) {
      event.preventDefault();
      const form = invoicePreview.closest("form");
      const status = form?.querySelector("[data-form-status]");
      try {
        await previewInvoiceFromForm(root, form);
      } catch (error) {
        if (status) status.textContent = error.message || String(error);
      }
      return;
    }
    const quoteSaveDraft = event.target.closest("[data-quote-save-draft]");
    if (quoteSaveDraft) {
      event.preventDefault();
      const form = quoteSaveDraft.closest("form");
      const status = form?.querySelector("[data-form-status]");
      try {
        await saveQuoteFormAsDraft(root, form);
      } catch (error) {
        if (status) status.textContent = error.message || String(error);
      }
      return;
    }
    const quoteDraftResume = event.target.closest("[data-quote-draft-resume]");
    if (quoteDraftResume) {
      event.preventDefault();
      const draftId = quoteDraftResume.closest("[data-quote-draft-id]")?.dataset.quoteDraftId;
      resumeQuoteDraft(root, draftId);
      return;
    }
    const quoteDraftDelete = event.target.closest("[data-quote-draft-delete]");
    if (quoteDraftDelete) {
      event.preventDefault();
      const draftRow = quoteDraftDelete.closest("[data-quote-draft-id]");
      const draftId = draftRow?.dataset.quoteDraftId;
      if (draftId && window.confirm("Supprimer ce brouillon ?")) {
        await deleteQuoteDraft(root.dataset.restaurantId, draftId).catch(() => {});
        root.quoteDrafts = (root.quoteDrafts || []).filter((item) => item.id !== draftId);
        draftRow.remove();
      }
      return;
    }
    const invoiceSaveDraft = event.target.closest("[data-invoice-save-draft]");
    if (invoiceSaveDraft) {
      event.preventDefault();
      const form = invoiceSaveDraft.closest("form");
      const status = form?.querySelector("[data-form-status]");
      try {
        await saveInvoiceFormAsDraft(root, form);
      } catch (error) {
        if (status) status.textContent = error.message || String(error);
      }
      return;
    }
    const invoiceDraftResume = event.target.closest("[data-invoice-draft-resume]");
    if (invoiceDraftResume) {
      event.preventDefault();
      const draftId = invoiceDraftResume.closest("[data-invoice-draft-id]")?.dataset.invoiceDraftId;
      resumeInvoiceDraft(root, draftId);
      return;
    }
    const invoiceDraftDelete = event.target.closest("[data-invoice-draft-delete]");
    if (invoiceDraftDelete) {
      event.preventDefault();
      const draftRow = invoiceDraftDelete.closest("[data-invoice-draft-id]");
      const draftId = draftRow?.dataset.invoiceDraftId;
      if (draftId && window.confirm("Supprimer ce brouillon ?")) {
        await deleteInvoiceDraft(root.dataset.restaurantId, draftId).catch(() => {});
        root.invoiceDrafts = (root.invoiceDrafts || []).filter((item) => item.id !== draftId);
        draftRow.remove();
      }
      return;
    }
    const clientMovement = event.target.closest("[data-client-movement]");
    if (clientMovement) {
      event.preventDefault();
      openClientMovement(root, clientMovement.dataset.clientMovement);
      return;
    }
    const clientExport = event.target.closest("[data-client-export]");
    if (clientExport) {
      event.preventDefault();
      exportVisibleCustomers(root, clientExport.dataset.clientExport || "xlsx");
    }
    const clientReset = event.target.closest("[data-client-reset]");
    if (clientReset) {
      event.preventDefault();
      resetClientTools(root);
    }
    const clientPage = event.target.closest("[data-client-page]");
    if (clientPage) {
      event.preventDefault();
      changeClientPage(root, Number(clientPage.dataset.clientPage || 0));
    }
    const clientBack = event.target.closest("[data-client-back]");
    if (clientBack) {
      event.preventDefault();
      closeClientDetail(root);
      return;
    }
    const clientEditToggle = event.target.closest("[data-client-edit-toggle]");
    if (clientEditToggle) {
      event.preventDefault();
      const detail = clientEditToggle.closest("[data-client-detail]");
      detail?.querySelector("[data-client-edit-panel]")?.classList.toggle("is-hidden");
      return;
    }
    const clientCard = event.target.closest("[data-client-card]");
    if (clientCard && !event.target.closest("button, a, input, select, textarea, label")) {
      event.preventDefault();
      openClientDetail(root, clientCard.dataset.clientDetailTarget);
      return;
    }
    const deleteArm = event.target.closest("[data-client-delete-arm]");
    if (deleteArm) {
      event.preventDefault();
      const form = deleteArm.closest("[data-dashboard-customer-delete-form]");
      form?.classList.add("is-confirming");
    }
    const deleteCancel = event.target.closest("[data-client-delete-cancel]");
    if (deleteCancel) {
      event.preventDefault();
      const form = deleteCancel.closest("[data-dashboard-customer-delete-form]");
      form?.classList.remove("is-confirming");
    }
    const categoryMove = event.target.closest("[data-category-move]");
    if (categoryMove) {
      event.preventDefault();
      moveCatalogCategory(root, categoryMove);
    }
    const dragHandleClick = event.target.closest("[data-category-drag-handle]");
    if (dragHandleClick) event.preventDefault();
    const colorChoice = event.target.closest("[data-color-choice]");
    if (colorChoice) {
      const form = colorChoice.closest("form");
      const input = form?.elements[colorChoice.dataset.colorTarget];
      if (input) {
        input.value = colorChoice.dataset.colorChoice;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  });
  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const restaurantId = root.dataset.restaurantId;
    const status = form.querySelector("[data-form-status]") || root.querySelector("[data-dashboard-status]");
    const openClientId = root.querySelector("[data-client-detail]:not(.is-hidden)")?.dataset.clientDetail || "";
    try {
      requireClientPermission(root, form);
      status.textContent = "Sauvegarde...";
      if (form.matches("[data-dashboard-profile-form]")) await saveRestaurantProfile(restaurantId, form);
      if (form.matches("[data-dashboard-hours-form]")) await saveOpeningHours(restaurantId, form);
      if (form.matches("[data-dashboard-public-form]")) await savePublicSettings(restaurantId, form);
      if (form.matches("[data-dashboard-menu-form]")) await saveQrMenu(restaurantId, form);
      if (form.matches("[data-dashboard-customer-form]")) await createCustomerAccount(restaurantId, form, currentUser);
      if (form.matches("[data-dashboard-customer-update-form]")) await updateCustomerAccount(restaurantId, form);
      if (form.matches("[data-dashboard-customer-state-form]")) {
        const nextActive = form.dataset.customerActive !== "true";
        await setCustomerAccountActive(restaurantId, form.dataset.customerId, nextActive, form.dataset.customerCollection);
      }
      if (form.matches("[data-dashboard-customer-delete-form]")) {
        await deleteCustomerAccount(restaurantId, form.dataset.customerId, form.dataset.customerCollection);
      }
      if (form.matches("[data-dashboard-quote-form]")) {
        requireQuotePermission(root);
        await submitQuoteForm(root, form, restaurantId);
      }
      if (form.matches("[data-dashboard-invoice-form]")) {
        requireQuotePermission(root);
        await submitInvoiceForm(root, form, restaurantId);
      }
      if (form.matches("[data-dashboard-invoice-numbering-form]")) {
        await saveInvoiceNumbering(root, form);
      }
      if (form.matches("[data-dashboard-jobtitle-form]")) await saveUserJobTitle(restaurantId, form, currentUser);
      if (form.matches("[data-dashboard-access-form]")) await reviewAccessRequest(restaurantId, form, event.submitter?.value, currentUser);
      if (form.matches("[data-dashboard-invite-form]")) {
        const code = await createInvitation(restaurantId, form, currentUser);
        form.code.value = code;
        const inviteUrl = `${window.location.origin}/poket-access.html?invite=${encodeURIComponent(code)}`;
        const inviteQr = `https://quickchart.io/qr?size=160&text=${encodeURIComponent(inviteUrl)}`;
        status.innerHTML = `
          Invitation creee : <strong>${escapeHtml(code)}</strong><br>
          <a href="${escapeAttr(inviteUrl)}">${escapeHtml(inviteUrl)}</a><br>
          <img class="inline-qr" src="${inviteQr}" alt="QR invitation" loading="lazy" />
        `;
        return;
      }
      status.textContent = "Enregistre.";
      const activePanel = root.querySelector("[data-dashboard-panel].is-active")?.dataset.dashboardPanel || "overview";
      await renderDashboard(root, currentUser, restaurantId, activePanel);
      if (openClientId && !form.matches("[data-dashboard-customer-delete-form]")) openClientDetail(root, openClientId);
    } catch (error) {
      status.textContent = error?.code === "permission-denied"
        ? "Action refusee par Firestore : votre role ne permet pas cette operation."
        : (error.message || String(error));
    }
  });
  root.addEventListener("change", async (event) => {
    if (event.target.matches("[data-profile-image-file]")) {
      previewProfileImageFile(event.target);
      return;
    }
    if (event.target.matches("[data-master-toggle]")) {
      applyMasterToggleCascade(event.target);
      return;
    }
    if (event.target.matches("[data-catalog-image-file]")) {
      previewCatalogImageFile(event.target);
      autoSaveCatalogField(root, event.target, { immediate: true });
      return;
    }
    if (event.target.matches("[data-catalog-image-url]")) {
      previewCatalogImageUrl(event.target);
      autoSaveCatalogField(root, event.target, { immediate: true });
      return;
    }
    if (event.target.matches("[data-catalog-autosave]")) {
      autoSaveCatalogField(root, event.target, { immediate: true });
      return;
    }
    if (event.target.matches("[data-client-import-file]")) {
      await handleClientImport(root, event.target);
      return;
    }
    if (event.target.matches("[data-client-filter]")) {
      setClientPage(root, 1);
      applyClientTools(root);
      return;
    }
    if (event.target.matches("[data-client-page-size]")) {
      setClientPage(root, 1);
      applyClientTools(root);
      return;
    }
    if (event.target.matches("[data-customer-type-select]")) {
      updateCustomerTypeScope(event.target);
      return;
    }
    if (event.target.matches("[data-quote-customer-select]")) {
      applyQuoteClientSelection(root, event.target.closest("form"));
      return;
    }
    if (event.target.matches("[data-quote-covers-label]")) {
      localStorage.setItem("poksolQuoteCoversLabel", event.target.value);
      return;
    }
    if (event.target.matches("[data-quote-line-qty], [data-quote-line-price], [data-quote-line-vat]")) {
      const quoteRowEl = event.target.closest("[data-quote-line]");
      updateQuoteLineRow(quoteRowEl);
      updateQuoteFormTotals(quoteRowEl?.closest("form"));
      return;
    }
    if (event.target.matches("[data-quote-line-name]")) {
      const quoteRowEl = event.target.closest("[data-quote-line]");
      const match = findCatalogItemByName(root.quoteCatalogItems || [], event.target.value);
      if (match) {
        quoteRowEl.querySelector("[data-quote-line-price]").value = match.price.toFixed(2);
        const vatSelect = quoteRowEl.querySelector("[data-quote-line-vat]");
        const vatValue = String(match.vat);
        if ([...vatSelect.options].some((option) => option.value === vatValue)) vatSelect.value = vatValue;
        quoteRowEl.dataset.catalogItemId = match.itemId;
        quoteRowEl.dataset.catalogCategoryId = match.categoryId;
        quoteRowEl.dataset.catalogCategoryName = match.categoryName;
        updateQuoteLineRow(quoteRowEl);
        updateQuoteFormTotals(quoteRowEl.closest("form"));
      }
      return;
    }
    if (!event.target.matches("[data-reservation-status]")) return;
    const restaurantId = root.dataset.restaurantId;
    await updateReservationStatus(restaurantId, event.target.dataset.reservationStatus, event.target.value);
      const activePanel = root.querySelector("[data-dashboard-panel].is-active")?.dataset.dashboardPanel || "overview";
      await renderDashboard(root, currentUser, restaurantId, activePanel);
  });
  root.addEventListener("input", (event) => {
    if (event.target.matches("[data-catalog-image-url]")) previewCatalogImageUrl(event.target);
    if (event.target.matches("[data-catalog-autosave], [data-catalog-image-url]")) autoSaveCatalogField(root, event.target);
    if (event.target.matches("[data-color-input]")) updateColorPreview(event.target);
    if (event.target.matches("[data-client-search]")) {
      setClientPage(root, 1);
      applyClientTools(root);
    }
    if (event.target.matches("[data-client-col-filter]")) {
      setClientColumnFilter(root, event.target.dataset.clientColFilter, event.target.value);
    }
    if (event.target.matches("[data-quote-line-qty], [data-quote-line-price]")) {
      const quoteRowEl = event.target.closest("[data-quote-line]");
      updateQuoteLineRow(quoteRowEl);
      updateQuoteFormTotals(quoteRowEl?.closest("form"));
    }
    if (event.target.matches("[data-quote-client-search]")) {
      filterQuoteClientCombobox(event.target);
    }
  });
  root.addEventListener("focusin", (event) => {
    if (event.target.matches("[data-quote-client-search]")) {
      filterQuoteClientCombobox(event.target);
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeClientColumnMenus(root);
      root.querySelectorAll("[data-quote-client-combobox-list]:not([hidden])").forEach((list) => { list.hidden = true; });
    }
  });
  root.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-category-drag-handle]");
    if (!handle) return;
    const category = handle.closest("[data-catalog-category-editor]");
    if (!category) return;
    event.preventDefault();
    draggedCatalogCategory = category;
    category.classList.add("is-dragging");
    handle.setPointerCapture?.(event.pointerId);
  });
  root.addEventListener("pointermove", (event) => {
    if (!draggedCatalogCategory) return;
    const list = draggedCatalogCategory.closest("[data-catalog-category-list]");
    if (!list) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-catalog-category-editor]");
    if (!target || target === draggedCatalogCategory || target.closest("[data-catalog-category-list]") !== list) return;
    event.preventDefault();
    const afterTarget = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
    list.insertBefore(draggedCatalogCategory, afterTarget ? target.nextSibling : target);
  });
  root.addEventListener("pointerup", () => finishCatalogCategoryDrag(root));
  root.addEventListener("pointercancel", () => finishCatalogCategoryDrag(root));
  initAuthObserver(async (user, error) => {
    try {
      if (error) {
        root.innerHTML = dashboardErrorHtml(error);
        return;
      }
      if (!user) {
        root.innerHTML = dashboardSignedOutHtml();
        return;
      }
      const userDoc = await getUserDoc(user.uid).catch(() => null);
      const restaurantId = new URLSearchParams(window.location.search).get("restaurant") ||
        localStorage.getItem("poksolActiveRestaurantId") ||
        userDoc?.activeRestaurantId;
      await renderDashboard(root, user, restaurantId);
    } catch (dashboardError) {
      root.innerHTML = dashboardErrorHtml(dashboardError);
    }
  });
}

async function renderDashboard(root, user, restaurantId, activeTab = "overview") {
  await releaseReady;
  if (!user) {
    root.innerHTML = dashboardSignedOutHtml();
    return;
  }
  if (!restaurantId) {
    const restaurants = await listUserRestaurants(user.uid).catch(() => []);
    root.innerHTML = restaurantChooserHtml(restaurants);
    return;
  }
  const restaurant = await getRestaurant(restaurantId).catch((error) => {
    root.innerHTML = dashboardErrorHtml(error);
    return null;
  });
  if (!restaurant) return;
  if (!restaurant) {
    root.innerHTML = restaurantChooserHtml(await listUserRestaurants(user.uid), "Restaurant introuvable.");
    return;
  }
  localStorage.setItem("poksolActiveRestaurantId", restaurant.id);
  root.dataset.restaurantId = restaurant.id;
  const role = await resolveRestaurantRole(restaurant, user);
  root.dataset.restaurantRole = role;
  const [reservations, customerAccounts, members, menu, catalogMenu, userProfile, accessRequests, quotes, pieceSaleEnabled, quoteDrafts, invoices, invoiceDrafts] = await Promise.all([
    listReservations(restaurant.id).catch(() => []),
    listCustomers(restaurant.id).catch((error) => ({ customers: [], errors: [readableFirebaseError(error)], checkedCollections: [] })),
    listMembers(restaurant.id).catch(() => []),
    getActiveMenu(restaurant.id).catch(() => null),
    listCatalogMenu(restaurant.id).catch(() => null),
    getUserDoc(user.uid).catch(() => null),
    ["owner", "admin"].includes(role) ? listAccessRequests(restaurant.id).catch(() => []) : Promise.resolve([]),
    listQuotes(restaurant.id).catch(() => []),
    getCatalogPieceSaleEnabled(restaurant.id).catch(() => false),
    listQuoteDrafts(restaurant.id).catch(() => []),
    listInvoices(restaurant.id).catch(() => []),
    listInvoiceDrafts(restaurant.id).catch(() => [])
  ]);
  const dashboardMenu = catalogMenu?.categories?.length
    ? { ...(menu || {}), ...catalogMenu, title: menu?.title || catalogMenu.title, type: menu?.type || "catalog" }
    : menu;
  const account = currentUserSummary(user, userProfile, members, role, restaurant.id);
  root.clientExportSource = { customers: customerAccounts, reservations };
  root.dashboardRestaurant = restaurant;
  root.dashboardQuotes = quotes;
  root.dashboardInvoices = invoices;
  root.invoiceDrafts = invoiceDrafts;
  root.quoteCatalogItems = catalogItemsForQuotes(dashboardMenu);
  root.quotePieceSaleEnabled = pieceSaleEnabled;
  root.quoteDrafts = quoteDrafts;
  root.quoteClients = (Array.isArray(customerAccounts) ? customerAccounts : customerAccounts.customers || []).map(normalizeCustomerAccount);
  root.innerHTML = dashboardHtml(restaurant, role, reservations, customerAccounts, members, dashboardMenu, activeTab, account, accessRequests, quotes, quoteDrafts, invoices, invoiceDrafts);
  applyClientTools(root);
}

async function autoSaveCatalogField(root, field, options = {}) {
  const form = field.closest("[data-dashboard-menu-form]");
  if (!form) return;
  const restaurantId = root.dataset.restaurantId;
  const target = resolveCatalogAutosaveTarget(field);
  if (!restaurantId || !target) return;
  const key = `${target.type}.${target.categoryId || ""}.${target.itemId || ""}`;
  clearTimeout(catalogAutosaveTimers.get(key));
  const run = async () => {
    const status = catalogAutosaveStatus(field);
    try {
      setAutosaveStatus(status, "Sauvegarde...", "saving");
      await saveCatalogAutosaveTarget(restaurantId, form, target);
      setAutosaveStatus(status, "Publie", "saved");
    } catch (error) {
      setAutosaveStatus(status, "Erreur", "error");
      console.error(error);
    }
  };
  if (options.immediate) {
    await run();
    return;
  }
  setAutosaveStatus(catalogAutosaveStatus(field), "Modification...", "pending");
  catalogAutosaveTimers.set(key, setTimeout(run, 900));
}

function resolveCatalogAutosaveTarget(field) {
  const type = field.dataset.catalogType;
  if (type === "category") return { type, categoryId: field.dataset.categoryId };
  if (type === "item") return { type, categoryId: field.dataset.categoryId, itemId: field.dataset.itemId };
  return null;
}

async function saveCatalogAutosaveTarget(restaurantId, form, target) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  if (target.type === "category") {
    const categoryId = target.categoryId;
    await setDoc(doc(services.db, "restaurants", restaurantId, "catalog_categories", categoryId), {
      publicVisible: form.elements[`category.${categoryId}.publicVisible`]?.checked === true,
      publicDisplayName: form.elements[`category.${categoryId}.publicDisplayName`]?.value.trim() || "",
      publicDescription: form.elements[`category.${categoryId}.publicDescription`]?.value.trim() || "",
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  if (target.type === "item") {
    const { categoryId, itemId } = target;
    const fieldPrefix = `item.${categoryId}.${itemId}`;
    const fileInput = form.elements[`${fieldPrefix}.imageFile`];
    const urlInput = form.elements[`${fieldPrefix}.imageUrl`];
    const file = fileInput?.files?.[0];
    const imageUrl = file ? await uploadCatalogItemImage(restaurantId, categoryId, itemId, file) : urlInput?.value.trim() || "";
    if (file && urlInput) urlInput.value = imageUrl;
    if (fileInput) fileInput.value = "";
    await setDoc(doc(services.db, "restaurants", restaurantId, "catalog_categories", categoryId, "items", itemId), {
      publicVisible: form.elements[`${fieldPrefix}.publicVisible`]?.checked === true,
      publicDisplayName: form.elements[`${fieldPrefix}.publicDisplayName`]?.value.trim() || "",
      publicDescription: form.elements[`${fieldPrefix}.publicDescription`]?.value.trim() || "",
      ...(form.elements[`${fieldPrefix}.publicPrice`] ? { publicPrice: form.elements[`${fieldPrefix}.publicPrice`].value.trim() || "" } : {}),
      imageUrl,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  await syncPublicRestaurant(restaurantId);
}

function catalogAutosaveStatus(field) {
  return field.closest(".catalog-category-editor, .catalog-item-editor")?.querySelector("[data-catalog-autosave-status]");
}

function setAutosaveStatus(status, label, state) {
  if (!status) return;
  status.textContent = label;
  status.dataset.state = state;
}

async function resolveRestaurantRole(restaurant, user) {
  if (!restaurant || !user) return "staff";
  // Meme calcul que firestore.rules : le createur est admin (affiche « Owner »),
  // sinon le role le plus eleve des fiches staff / staff_users.
  if (restaurant.ownerUid === user.uid || restaurant.createdBy === user.uid) return "owner";
  const services = await getServices();
  const { doc, getDoc } = services.firestoreModule;
  const restaurantId = restaurant.id;
  const staffSnap = await getDoc(doc(services.db, "restaurants", restaurantId, "staff", user.uid)).catch(() => null);
  const staffRole = staffSnap?.exists() ? normalizeRole(staffSnap.data().role) : "";
  const staffUserSnap = await getDoc(doc(services.db, "restaurants", restaurantId, "staff_users", user.uid)).catch(() => null);
  const staffUserRole = staffUserSnap?.exists() ? normalizeRole(staffUserSnap.data().role) : "";
  return highestRole([staffRole, staffUserRole]) || "staff";
}

function initPublicRestaurantPage() {
  const root = document.querySelector("[data-public-restaurant]");
  if (!root) return;
  const slug = root.dataset.restaurantSlug || new URLSearchParams(window.location.search).get("slug") || "chez-marwan";
  let loadedRestaurant = null;
  getRestaurantBySlug(slug).then(async (restaurant) => {
    loadedRestaurant = restaurant;
    if (restaurant && restaurant.publicPageEnabled !== false) {
      const embeddedMenu = restaurant.menu?.categories?.length ? restaurant.menu : null;
      const menu = embeddedMenu || await getActiveMenu(restaurant.restaurantId || restaurant.id).catch(() => null);
      hydratePublicRestaurant(root, restaurant, menu || restaurant.menu || null);
    }
  }).catch(() => {});
  const reservationForm = document.querySelector("[data-public-reservation-form]");
  if (reservationForm) {
    reservationForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = reservationForm.querySelector("[data-form-status]");
      try {
        if (!loadedRestaurant) loadedRestaurant = await getRestaurantBySlug(slug);
        await submitReservation(loadedRestaurant || { id: slug, reservationEnabled: true }, reservationForm);
        status.textContent = "Demande envoyee. Le restaurant vous recontactera.";
        reservationForm.reset();
      } catch (error) {
        status.textContent = error.message || "Reservation impossible pour le moment.";
      }
    });
  }
}

function initPublicMenuPage() {
  const root = document.querySelector("[data-public-menu-page]");
  if (!root) return;
  initMenuLanguageSelector();
  updateMenuStickyOffset();
  window.addEventListener("resize", updateMenuStickyOffset);
  root.addEventListener("click", (event) => {
    const lightboxImage = event.target.closest("[data-menu-lightbox-image]");
    if (lightboxImage) {
      event.preventDefault();
      event.stopPropagation();
      openMenuImageLightbox(lightboxImage.src, lightboxImage.alt);
      return;
    }
    const imageToggle = event.target.closest("[data-menu-image-toggle]");
    if (!imageToggle) return;
    event.preventDefault();
    event.stopPropagation();
    const item = imageToggle.closest("[data-menu-item-row]");
    if (!item) return;
    item.open = true;
    item.classList.toggle("is-image-expanded");
    imageToggle.setAttribute("aria-expanded", item.classList.contains("is-image-expanded") ? "true" : "false");
  });
  root.addEventListener("toggle", (event) => {
    const item = event.target.closest?.("[data-menu-item-row]");
    if (!item || item.open) return;
    item.classList.remove("is-image-expanded");
    item.querySelector("[data-menu-image-toggle]")?.setAttribute("aria-expanded", "false");
  }, true);
  document.querySelectorAll("[data-menu-drawer-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleMenuDrawer(true));
  });
  document.querySelectorAll("[data-menu-drawer-close]").forEach((button) => {
    button.addEventListener("click", () => toggleMenuDrawer(false));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenuImageLightbox();
  });
  const slug = root.dataset.restaurantSlug || new URLSearchParams(window.location.search).get("slug") || "chez-marwan";
  getRestaurantBySlug(slug).then((restaurant) => {
    if (!restaurant || restaurant.publicPageEnabled === false) {
      root.innerHTML = publicMenuEmptyHtml("Menu indisponible");
      return;
    }
    hydratePublicMenuPage(root, restaurant, restaurant.menu || null);
    updateMenuStickyOffset();
  }).catch(() => {
    root.innerHTML = publicMenuEmptyHtml("Menu indisponible");
    updateMenuStickyOffset();
  });
}

function updateMenuStickyOffset() {
  const stickyShell = document.querySelector("[data-menu-sticky-shell]");
  if (!stickyShell) return;
  document.body.style.setProperty("--menu-sticky-offset", `${Math.ceil(stickyShell.getBoundingClientRect().height)}px`);
}

function initMenuLanguageSelector() {
  const select = document.querySelector("[data-menu-language-select]");
  if (!select) return;
  const currentLanguage = currentMenuTranslationLanguage();
  select.value = currentLanguage;
  applyMenuLanguageDocumentState(currentLanguage);
  suppressGoogleTranslateBanner();
  select.addEventListener("change", () => {
    const language = MENU_TRANSLATION_LANGUAGES.has(select.value) ? select.value : "fr";
    setMenuTranslationLanguage(language);
  });
  if (currentLanguage !== "fr") loadGoogleMenuTranslate();
}

function loadGoogleMenuTranslate() {
  if (window.google?.translate?.TranslateElement) {
    setupGoogleMenuTranslate();
    return;
  }
  window.googleTranslateElementInit = setupGoogleMenuTranslate;
  if (document.querySelector("[data-google-translate-script]")) return;
  const script = document.createElement("script");
  script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
  script.async = true;
  script.dataset.googleTranslateScript = "true";
  document.head.appendChild(script);
}

function setupGoogleMenuTranslate() {
  const host = document.getElementById("google_translate_element");
  if (!host || !window.google?.translate?.TranslateElement) return;
  if (host.dataset.ready === "true") return;
  host.dataset.ready = "true";
  new window.google.translate.TranslateElement({
    pageLanguage: "fr",
    includedLanguages: "fr,de,en,es,it,tr,ar",
    autoDisplay: false
  }, "google_translate_element");
  suppressGoogleTranslateBanner();
}

function currentMenuTranslationLanguage() {
  const stored = localStorage.getItem("poksolQrMenuLanguage") || readGoogleTranslateLanguage();
  return MENU_TRANSLATION_LANGUAGES.has(stored) ? stored : "fr";
}

function setMenuTranslationLanguage(language) {
  localStorage.setItem("poksolQrMenuLanguage", language);
  applyMenuLanguageDocumentState(language);
  writeGoogleTranslateLanguage(language);
  window.location.reload();
}

function readGoogleTranslateLanguage() {
  const match = document.cookie.match(/(?:^|;\s*)googtrans=([^;]+)/);
  const value = match ? decodeURIComponent(match[1]) : "";
  const language = value.split("/").filter(Boolean).pop();
  return MENU_TRANSLATION_LANGUAGES.has(language) ? language : "";
}

function writeGoogleTranslateLanguage(language) {
  const value = language === "fr" ? "" : `/fr/${language}`;
  writeCookie("googtrans", value);
  if (window.location.hostname.includes(".")) {
    const parts = window.location.hostname.split(".");
    const parentDomain = `.${parts.slice(-2).join(".")}`;
    writeCookie("googtrans", value, parentDomain);
  }
}

function writeCookie(name, value, domain = "") {
  const expires = value ? "Fri, 31 Dec 9999 23:59:59 GMT" : "Thu, 01 Jan 1970 00:00:00 GMT";
  const domainPart = domain ? `; domain=${domain}` : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/${domainPart}`;
}

function applyMenuLanguageDocumentState(language) {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
}

function suppressGoogleTranslateBanner() {
  const hide = () => {
    document.documentElement.style.top = "0px";
    document.body.style.top = "0px";
    document.body.style.marginTop = "0px";
    document.querySelectorAll("iframe.goog-te-banner-frame, .goog-te-banner-frame, .skiptranslate iframe").forEach((element) => {
      element.style.display = "none";
      element.style.visibility = "hidden";
      element.style.height = "0";
    });
  };
  hide();
  window.setTimeout(hide, 200);
  window.setTimeout(hide, 800);
  if (document.body.dataset.googleBannerObserver === "true") return;
  document.body.dataset.googleBannerObserver = "true";
  new MutationObserver(hide).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
}

function initContactForms() {
  document.querySelectorAll("[data-contact-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-form-status]");
      try {
        await submitContact(form);
        status.textContent = "Message envoye. Merci, nous revenons vers vous rapidement.";
        form.reset();
      } catch (error) {
        status.textContent = error.message || "Envoi impossible pour le moment.";
      }
    });
  });
}

function hydratePublicRestaurant(root, restaurant, menu) {
  applyPublicRestaurantTheme(restaurant);
  setText("[data-public-name]", restaurant.name);
  setText("[data-public-description]", restaurant.description);
  setText("[data-public-cuisine]", restaurant.cuisineType || "Restaurant");
  setText("[data-public-phone]", restaurant.phone);
  setText("[data-public-email]", restaurant.email);
  setText("[data-public-address]", [restaurant.addressLine1 || restaurant.address, restaurant.postalCode, restaurant.city].filter(Boolean).join(", "));
  setHref("[data-public-phone-link]", restaurant.phone ? `tel:${restaurant.phone}` : "");
  setHref("[data-public-email-link]", restaurant.email ? `mailto:${restaurant.email}` : "");
  setHref("[data-public-maps-link]", restaurant.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.name + " " + restaurant.city)}`);
  const logo = document.querySelector("[data-public-logo]");
  if (logo && restaurant.logoUrl) logo.src = restaurant.logoUrl;
  const cover = document.querySelector("[data-public-cover]");
  if (cover && restaurant.coverUrl) cover.style.backgroundImage = `url("${restaurant.coverUrl}")`;
  const hours = document.querySelector("[data-public-hours]");
  if (hours) hours.innerHTML = hoursHtml(restaurant.openingHours);
  setupReservationHoursUi(restaurant);
  const menuHasContent = !!(menu?.categories?.length || menu?.items?.length || menu?.externalUrl || menu?.pdfUrl);
  const menuIsVisible = menu?.isActive === true || restaurant.qrMenuEnabled === true && menuHasContent;
  const menuPageUrl = publicMenuUrl(restaurant);
  document.querySelectorAll("[data-public-menu-link]").forEach((menuLink) => {
    const menuUrl = menu?.type === "external_link" && menu?.externalUrl
      ? menu.externalUrl
      : menu?.type === "pdf" && menu?.pdfUrl
        ? menu.pdfUrl
        : menuPageUrl;
    menuLink.href = menuUrl;
    if (menuUrl !== menuPageUrl) {
      menuLink.target = "_blank";
      menuLink.rel = "noopener noreferrer";
    } else {
      menuLink.removeAttribute("target");
      menuLink.removeAttribute("rel");
    }
    menuLink.textContent = menuIsVisible ? "Afficher le menu" : "Menu bientot disponible";
  });
  document.querySelector("[data-public-menu-items]")?.closest(".restaurant-section")?.remove();
  if (restaurant.reservationEnabled === false) {
    const reservation = document.querySelector("[data-public-reservation-form]");
    if (reservation) reservation.innerHTML = `<p class="alert-note">Les reservations en ligne ne sont pas encore activees pour ce restaurant.</p>`;
  }
}

function applyPublicRestaurantTheme(restaurant = {}) {
  const theme = restaurant.publicPageSettings?.theme || {};
  const primaryColor = normalizeHexColor(theme.primaryColor, "#0A2540");
  const accentColor = normalizeHexColor(theme.accentColor, "#1976F3");
  document.body.style.setProperty("--restaurant-primary", primaryColor);
  document.body.style.setProperty("--restaurant-accent", accentColor);
}

function hydratePublicMenuPage(root, restaurant, menu) {
  const title = root.querySelector("[data-menu-page-title]");
  const subtitle = root.querySelector("[data-menu-page-subtitle]");
  const backLink = root.querySelector("[data-menu-page-back]");
  const logo = root.querySelector("[data-menu-page-logo]");
  const content = root.querySelector("[data-menu-page-content]");
  if (title) title.textContent = restaurant.name || "Menu";
  if (subtitle) subtitle.textContent = menu?.title || "Menu";
  if (backLink) backLink.href = `${window.location.origin}/restaurants/?slug=${encodeURIComponent(restaurant.slug || restaurant.id)}`;
  if (logo) logo.src = restaurant.logoUrl || "../poksol_icon.svg";
  renderPublicMenuContent(content, restaurant, menu);
  hydrateMenuCategoryNavigation(menu);
}

function renderPublicMenuContent(menuContainer, restaurant, menu) {
  const menuHasContent = !!(menu?.categories?.length || menu?.items?.length);
  const menuIsVisible = menu?.isActive === true || restaurant.qrMenuEnabled === true && menuHasContent;
  const fallbackLogo = restaurant.logoUrl || "../poksol_icon.svg";
  if (!menuContainer) return;
  if (!menuIsVisible) {
    menuContainer.classList.remove("public-menu-category-list");
    menuContainer.innerHTML = publicMenuEmptyHtml("Menu bientot disponible");
  } else if (menu?.categories?.length) {
    menuContainer.classList.add("public-menu-category-list");
    menuContainer.innerHTML = menu.categories.map((category, index) => {
      const categoryId = menuCategoryDomId(category, index);
      return `
      <section class="public-menu-category" id="${escapeAttr(categoryId)}" data-menu-category-section="${escapeAttr(categoryId)}">
        <div class="public-menu-category-heading">
          <span>${escapeHtml(category.displayName || category.name || "Menu")}</span>
          ${category.description ? `<p>${escapeHtml(category.description)}</p>` : ""}
        </div>
        <div class="menu-grid">
          ${category.items.map((item) => menuItemRowHtml(item, category, fallbackLogo)).join("")}
        </div>
      </section>
    `;
    }).join("");
  } else if (menuContainer && menu?.items?.length) {
    menuContainer.classList.remove("public-menu-category-list");
    menuContainer.innerHTML = menu.items.map((item) => menuItemRowHtml(item, { displayName: item.category || "Menu" }, fallbackLogo)).join("");
  }
}

function menuItemRowHtml(item, category, fallbackLogo) {
  const title = item.displayName || item.name;
  const description = item.description || "";
  const price = displayMenuItemPrice(item);
  const imageUrl = item.imageUrl || fallbackLogo;
  const imageClass = item.imageUrl ? "" : "menu-photo-logo";
  return `
    <details class="menu-item-card menu-item-card-live menu-item-row" data-menu-item-row>
      <summary class="menu-item-summary">
        <span class="menu-photo-wrap">
          <img class="menu-photo ${imageClass}" src="${escapeAttr(imageUrl)}" alt="${escapeAttr(title)}" loading="lazy" />
        </span>
        <span class="menu-item-main">
          <span class="menu-item-name">${escapeHtml(title)}</span>
          ${price ? `<strong>${escapeHtml(price)}</strong>` : ""}
        </span>
      </summary>
      <div class="menu-item-detail">
        <span class="menu-item-detail-media">
          <button class="menu-photo-toggle button-reset" type="button" data-menu-image-toggle aria-label="Agrandir l'image" aria-expanded="false">+</button>
          <img class="menu-photo-large ${imageClass}" src="${escapeAttr(imageUrl)}" alt="${escapeAttr(title)}" loading="lazy" data-menu-lightbox-image />
        </span>
        ${description ? `<p class="menu-item-description">${escapeHtml(description)}</p>` : `<p class="menu-item-description">Aucune description disponible.</p>`}
      </div>
    </details>
  `;
}

function hydrateMenuCategoryNavigation(menu) {
  const categories = Array.isArray(menu?.categories) ? menu.categories : [];
  const strip = document.querySelector("[data-menu-category-strip]");
  const drawerList = document.querySelector("[data-menu-drawer-list]");
  const html = categories.map((category, index) => {
    const categoryId = menuCategoryDomId(category, index);
    const label = category.displayName || category.name || "Menu";
    return `<a href="#${escapeAttr(categoryId)}" data-menu-category-jump>${escapeHtml(label)}</a>`;
  }).join("");
  if (strip) {
    strip.innerHTML = html;
    strip.hidden = !categories.length;
  }
  if (drawerList) drawerList.innerHTML = html || `<span>Aucune catégorie publiée.</span>`;
  document.querySelectorAll("[data-menu-category-jump]").forEach((link) => {
    link.addEventListener("click", () => toggleMenuDrawer(false));
  });
  updateMenuStickyOffset();
}

function toggleMenuDrawer(open) {
  const drawer = document.querySelector("[data-menu-category-drawer]");
  if (!drawer) return;
  drawer.classList.toggle("is-open", open);
  drawer.setAttribute("aria-hidden", open ? "false" : "true");
  document.body.classList.toggle("menu-drawer-open", open);
}

function openMenuImageLightbox(src, alt = "") {
  if (!src) return;
  let lightbox = document.querySelector("[data-menu-image-lightbox]");
  if (!lightbox) {
    lightbox = document.createElement("div");
    lightbox.className = "menu-image-lightbox";
    lightbox.dataset.menuImageLightbox = "";
    lightbox.innerHTML = `
      <button class="menu-image-lightbox-backdrop button-reset" type="button" data-menu-lightbox-close aria-label="Fermer l'image"></button>
      <figure>
        <button class="menu-image-lightbox-close button-reset" type="button" data-menu-lightbox-close aria-label="Fermer">×</button>
        <img src="" alt="" />
      </figure>
    `;
    lightbox.addEventListener("click", (event) => {
      if (event.target.closest("[data-menu-lightbox-close]")) closeMenuImageLightbox();
    });
    document.body.appendChild(lightbox);
  }
  const image = lightbox.querySelector("img");
  image.src = src;
  image.alt = alt || "";
  lightbox.classList.add("is-open");
  document.body.classList.add("menu-lightbox-open");
}

function closeMenuImageLightbox() {
  const lightbox = document.querySelector("[data-menu-image-lightbox]");
  if (!lightbox) return;
  lightbox.classList.remove("is-open");
  document.body.classList.remove("menu-lightbox-open");
}

function publicMenuEmptyHtml(title) {
  return `
    <article class="menu-item-card">
      <div>
        <span>Menu</span>
        <h3>${escapeHtml(title)}</h3>
        <p>Le restaurant n'a pas encore publie son menu en ligne.</p>
        <strong></strong>
      </div>
    </article>
  `;
}

function publicMenuUrl(restaurant) {
  return `${window.location.origin}/restaurants/menu.html?slug=${encodeURIComponent(restaurant.slug || restaurant.id)}`;
}

function displayMenuItemPrice(item = {}) {
  return item.priceLabel || formatPrice(firstDefinedMenuPrice(item.price, item.priceOnSite, item.priceTakeaway, item.priceTtc, item.salePrice, item.defaultPrice, item.unitPrice, item.amount, item.publicPrice, item.menuPrice));
}

function menuCategoryDomId(category = {}, index = 0) {
  return `categorie-${normalizeSlug(category.displayName || category.name || category.id || index) || index}`;
}

function accountSignedOutHtml() {
  return `
    <section class="platform-card platform-auth-card">
      <p class="eyebrow">Connexion requise</p>
      <h2>Connectez-vous pour gerer vos restaurants</h2>
      <p>Votre compte Poksol donne acces a la creation restaurant, aux invitations, au dashboard, aux telechargements et a l'application navigateur.</p>
      <button class="primary-btn button-reset" type="button" data-platform-login>Se connecter avec Google</button>
    </section>
  `;
}

function accountErrorHtml(error) {
  return `
    <section class="platform-card">
      <p class="eyebrow">Compte indisponible</p>
      <h2>Impossible de charger vos restaurants</h2>
      <p class="alert-note">${escapeHtml(readableFirebaseError(error))}</p>
      <button class="primary-btn button-reset" type="button" onclick="window.location.reload()">Reessayer</button>
    </section>
  `;
}

function accountSignedInHtml(user, restaurants) {
  return `
    <section class="platform-card">
      <div class="platform-card-header">
        <div>
          <p class="eyebrow">Compte connecte</p>
          <h2>${escapeHtml(user.displayName || "Utilisateur Poksol")}</h2>
          <p>${escapeHtml(user.email || "")}</p>
        </div>
        <button class="ghost-action" type="button" data-platform-logout>Se deconnecter</button>
      </div>
    </section>

    <section class="platform-grid-two">
      <article class="platform-card">
        <p class="eyebrow">Mes restaurants</p>
        <h2>Restaurants rattaches</h2>
        <div class="restaurant-list">
          ${restaurants.length ? restaurants.map(restaurantCardHtml).join("") : emptyHtml("Aucun restaurant rattache pour le moment.")}
        </div>
        <a class="ghost-action" href="poket-access.html?mode=new">Creer un nouveau restaurant</a>
      </article>

      <article class="platform-card">
        <p class="eyebrow">Rejoindre</p>
        <h2>Code invitation</h2>
        <form class="platform-form" data-join-restaurant-form>
          <label>Code invitation<input name="code" placeholder="INVITATION" required /></label>
          <button class="primary-btn button-reset" type="submit">Rejoindre</button>
          <small data-form-status></small>
        </form>
      </article>
    </section>

    <section class="platform-card">
      <p class="eyebrow">Creation restaurant</p>
      <h2>Creer un restaurant</h2>
      ${createRestaurantFormHtml()}
    </section>

    ${downloadsHtml()}
  `;
}

function restaurantCardHtml(restaurant) {
  return `
    <article class="restaurant-mini-card">
      <div>
        <strong>${escapeHtml(restaurant.name || restaurant.id)}</strong>
        <span>${escapeHtml(ROLE_LABELS[restaurant.role] || restaurant.role || "Membre")}</span>
      </div>
      <div class="mini-actions">
        <a href="admin.html?restaurant=${encodeURIComponent(restaurant.id)}">Dashboard</a>
        <a href="restaurants/?slug=${encodeURIComponent(restaurant.slug || restaurant.id)}">Page publique</a>
      </div>
    </article>
  `;
}

function createRestaurantFormHtml() {
  return `
    <form class="platform-form" data-create-restaurant-form>
      <div class="form-grid">
        <label>Nom du restaurant<input name="name" required /></label>
        <label>Slug public<input name="slug" placeholder="mon-restaurant" required /></label>
        <label>Type de cuisine<input name="cuisineType" placeholder="Libanais, snack, boulangerie..." /></label>
        <label>Telephone<input name="phone" type="tel" /></label>
        <label>Email<input name="email" type="email" /></label>
        <label>Adresse<input name="address" required /></label>
        <label>Ville<input name="city" required /></label>
        <label>Code postal<input name="postalCode" required /></label>
        <label>Pays<input name="country" value="France" /></label>
        <label class="wide-field">Description<textarea name="description" rows="4"></textarea></label>
      </div>
      <button class="primary-btn button-reset" type="submit">Creer le restaurant</button>
      <small data-form-status></small>
    </form>
  `;
}

function dashboardSignedOutHtml() {
  return `
    <section class="platform-card">
      <p class="eyebrow">Dashboard protege</p>
      <h2>Connexion necessaire</h2>
      <p>Connectez-vous depuis le portail compte pour ouvrir le dashboard restaurant.</p>
      <button class="primary-btn button-reset" type="button" data-platform-login>Se connecter avec Google</button>
    </section>
  `;
}

function dashboardErrorHtml(error) {
  const message = readableFirebaseError(error);
  return `
    <section class="platform-card">
      <p class="eyebrow">Dashboard indisponible</p>
      <h2>Impossible de charger l'espace admin</h2>
      <p class="alert-note">${escapeHtml(message)}</p>
      <div class="quick-links">
        <a href="account.html">Retour au compte</a>
        <a href="poket-access.html">Creer ou rejoindre un restaurant</a>
        <button class="ghost-action" type="button" onclick="window.location.reload()">Reessayer</button>
      </div>
      <p>
        Si le compte est bien connecte, verifiez aussi que les regles Firestore V1/V2
        sont publiees et que l'utilisateur est membre du restaurant.
      </p>
    </section>
  `;
}

function restaurantChooserHtml(restaurants, message = "") {
  return `
    <section class="platform-card">
      <p class="eyebrow">Dashboard restaurant</p>
      <h2>Choisissez un restaurant</h2>
      ${message ? `<p class="alert-note">${escapeHtml(message)}</p>` : ""}
      <div class="restaurant-list">
        ${restaurants.length ? restaurants.map(restaurantCardHtml).join("") : emptyHtml("Aucun restaurant rattache. Creez ou rejoignez un restaurant depuis le compte.")}
      </div>
      <a class="primary-btn" href="account.html">Aller au compte</a>
    </section>
  `;
}

function dashboardHtml(restaurant, role, reservations, customers, members, menu, activeTab = "overview", account = null, accessRequests = [], quotes = [], quoteDrafts = [], invoices = [], invoiceDrafts = []) {
  const canEditProfile = ["owner", "admin"].includes(role);
  const canManageTeam = ["owner", "admin"].includes(role);
  const publicUrl = `${window.location.origin}/restaurants/?slug=${encodeURIComponent(restaurant.slug || restaurant.id)}`;
  return `
    <div class="dashboard-shell">
      <button class="dashboard-nav-toggle button-reset" type="button" aria-label="Ouvrir les sections" data-dashboard-nav-toggle>
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
      </button>
      <button class="dashboard-nav-backdrop button-reset" type="button" aria-label="Fermer les sections" data-dashboard-nav-backdrop></button>
      <nav class="dashboard-tabs" aria-label="Sections dashboard">
        ${DASHBOARD_NAV_GROUPS.map((group) => `
          <div class="dashboard-tab-group">
            ${group.map((tab) => `
              <button class="${tab === activeTab ? "is-active" : ""}" type="button" data-dashboard-tab="${tab}">${tabLabel(tab)}</button>
            `).join("")}
          </div>
        `).join("")}
      </nav>
      <section class="dashboard-panel ${activeTab === "overview" ? "is-active" : ""}" data-dashboard-panel="overview">${overviewHtml(restaurant, publicUrl, account)}</section>
      <section class="dashboard-panel ${activeTab === "profile" ? "is-active" : ""}" data-dashboard-panel="profile">${profileFormHtml(restaurant, canEditProfile)}</section>
      <section class="dashboard-panel ${activeTab === "hours" ? "is-active" : ""}" data-dashboard-panel="hours">${hoursFormHtml(restaurant, canEditProfile)}</section>
      <section class="dashboard-panel ${activeTab === "public" ? "is-active" : ""}" data-dashboard-panel="public">${publicSettingsHtml(restaurant, publicUrl, canEditProfile)}</section>
      <section class="dashboard-panel ${activeTab === "menu" ? "is-active" : ""}" data-dashboard-panel="menu">${menuFormHtml(restaurant, menu, canEditProfile)}</section>
      <section class="dashboard-panel ${activeTab === "reservations" ? "is-active" : ""}" data-dashboard-panel="reservations">${reservationsHtml(reservations, role)}</section>
      <section class="dashboard-panel ${activeTab === "clients" ? "is-active" : ""}" data-dashboard-panel="clients">${clientsHtml(customers, reservations, role)}</section>
      <section class="dashboard-panel ${activeTab === "quotes" ? "is-active" : ""}" data-dashboard-panel="quotes">${quotesHtml(quotes, customers, menu, role, quoteDrafts)}</section>
      <section class="dashboard-panel ${activeTab === "invoices" ? "is-active" : ""}" data-dashboard-panel="invoices">${invoicesHtml(invoices, role, restaurant, customers, invoiceDrafts)}</section>
      <section class="dashboard-panel ${activeTab === "team" ? "is-active" : ""}" data-dashboard-panel="team">${teamHtml(members, canManageTeam, accessRequests)}</section>
      <section class="dashboard-panel ${activeTab === "downloads" ? "is-active" : ""}" data-dashboard-panel="downloads">${downloadsHtml()}</section>
    </div>
  `;
}

function currentUserSummary(user, profile, members = [], role = "staff", restaurantId = "") {
  const member = members.find((item) => item.uid === user?.uid) || {};
  return {
    displayName: firstText(user?.displayName, member.displayName, profile?.displayName, user?.email),
    email: firstText(user?.email, member.email, profile?.email),
    // Poste choisi par l'utilisateur (users/{uid}), sinon celui de l'invitation.
    jobTitle: firstText(profile?.jobTitles?.[restaurantId], member.jobTitle, member.position, member.title),
    role,
    roleLabel: ROLE_LABELS[role] || role || "Staff"
  };
}

function userInitials(name, email) {
  const parts = String(name || email || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(parts[0] || "?").slice(0, 2).toUpperCase();
}

function userOverviewHtml(account) {
  return `
    <section class="overview-general-info overview-user" aria-labelledby="overview-user-title">
      <div class="overview-user-head">
        <span class="profile-avatar" aria-hidden="true">${escapeHtml(userInitials(account.displayName, account.email))}</span>
        <div>
          <p class="eyebrow">Utilisateur connecte</p>
          <h2 id="overview-user-title">Mon compte</h2>
        </div>
        <span class="role-badge role-${escapeAttr(account.role)}">${escapeHtml(account.roleLabel)}</span>
      </div>
      <dl class="overview-info-grid">
        <div>
          <dt>Nom</dt>
          <dd>${escapeHtml(account.displayName || "Non renseigne")}</dd>
        </div>
        <div>
          <dt>Poste</dt>
          <dd>${escapeHtml(account.jobTitle || "Non renseigne")}</dd>
        </div>
        <div>
          <dt>Autorite</dt>
          <dd>${escapeHtml(account.roleLabel)}<small>${escapeHtml(ROLE_SCOPES[account.role] || "")}</small></dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>${escapeHtml(account.email || "Non renseigne")}</dd>
        </div>
      </dl>
      <details class="overview-user-edit">
        <summary>Modifier mon poste</summary>
        <form class="platform-form" data-dashboard-jobtitle-form>
          <label>Poste
            <input name="jobTitle" maxlength="80" value="${escapeAttr(account.jobTitle)}" placeholder="Ex : Gerant, Chef de salle" />
          </label>
          <button class="primary-btn button-reset" type="submit">Enregistrer</button>
          <small data-form-status></small>
        </form>
      </details>
    </section>
  `;
}

async function saveUserJobTitle(restaurantId, form, user) {
  if (!user) throw new Error("Connexion requise.");
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const jobTitle = text(new FormData(form), "jobTitle").slice(0, 80);
  // Stocke dans le profil de l'utilisateur, modifiable par lui seul (firestore.rules : users/{uid}).
  await setDoc(doc(services.db, "users", user.uid), {
    uid: user.uid,
    jobTitles: { [restaurantId]: jobTitle },
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function overviewHtml(restaurant, publicUrl, account = null) {
  const generalInfo = [
    ["Nom", restaurant.name],
    ["Type cuisine", restaurant.cuisineType],
    ["Telephone", restaurant.phone],
    ["Email", restaurant.email],
    ["Adresse", restaurant.addressLine1],
    ["Ville", [restaurant.postalCode, restaurant.city].filter(Boolean).join(" ")],
    ["Pays", restaurant.country || "France"],
    ["Site web", restaurant.website]
  ].filter(([, value]) => String(value || "").trim().length);
  return `
    ${account ? userOverviewHtml(account) : ""}
    <div class="dashboard-stats">
      ${statusCardHtml("Page publique", restaurant.publicPageEnabled !== false ? "Active" : "Desactivee")}
      ${statusCardHtml("QR menu", restaurant.qrMenuEnabled ? "Actif" : "A completer")}
      ${statusCardHtml("Reservations", restaurant.reservationEnabled !== false ? "Actives" : "Desactivees")}
    </div>
    <section class="overview-general-info" aria-labelledby="overview-general-title">
      <div>
        <p class="eyebrow">Restaurant</p>
        <h2 id="overview-general-title">Informations generales</h2>
      </div>
      <dl class="overview-info-grid">
        ${generalInfo.length ? generalInfo.map(([label, value]) => `
          <div>
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>
        `).join("") : `
          <div>
            <dt>Profil</dt>
            <dd>Aucune information generale renseignee.</dd>
          </div>
        `}
      </dl>
    </section>
    <div class="quick-links">
      <a href="${publicUrl}" target="_blank" rel="noopener noreferrer">Voir page publique</a>
      <a href="${DOWNLOADS.web}" target="_blank" rel="noopener noreferrer">Ouvrir web app</a>
      <a href="#downloads" data-dashboard-tab-link="downloads">Telechargements</a>
      <button class="quick-link-logout button-reset" type="button" data-platform-logout>Deconnexion</button>
    </div>
  `;
}

function profileFormHtml(restaurant, canEdit) {
  return `
    <form class="platform-form" data-dashboard-profile-form>
      <div class="form-grid">
        <label>Nom<input name="name" value="${escapeAttr(restaurant.name)}" ${disabled(canEdit)} /></label>
        <label>Type cuisine<input name="cuisineType" value="${escapeAttr(restaurant.cuisineType)}" ${disabled(canEdit)} /></label>
        <label>Telephone<input name="phone" value="${escapeAttr(restaurant.phone)}" ${disabled(canEdit)} /></label>
        <label>Email<input name="email" type="email" value="${escapeAttr(restaurant.email)}" ${disabled(canEdit)} /></label>
        <label>Adresse<input name="address" value="${escapeAttr(restaurant.addressLine1)}" ${disabled(canEdit)} /></label>
        <label>Ville<input name="city" value="${escapeAttr(restaurant.city)}" ${disabled(canEdit)} /></label>
        <label>Code postal<input name="postalCode" value="${escapeAttr(restaurant.postalCode)}" ${disabled(canEdit)} /></label>
        <label>Pays<input name="country" value="${escapeAttr(restaurant.country || "France")}" ${disabled(canEdit)} /></label>
        <label>Site web<input name="website" value="${escapeAttr(restaurant.website)}" ${disabled(canEdit)} /></label>
        <label>Instagram<input name="instagram" value="${escapeAttr(restaurant.instagram)}" ${disabled(canEdit)} /></label>
        <label>Facebook<input name="facebook" value="${escapeAttr(restaurant.facebook)}" ${disabled(canEdit)} /></label>
        <label>Google Maps URL<input name="googleMapsUrl" value="${escapeAttr(restaurant.googleMapsUrl)}" ${disabled(canEdit)} /></label>
        <input type="hidden" name="logoUrl" value="${escapeAttr(restaurant.logoUrl)}" />
        <input type="hidden" name="coverUrl" value="${escapeAttr(restaurant.coverUrl)}" />
        <input type="hidden" name="documentLogoUrl" value="${escapeAttr(restaurant.documentLogoUrl)}" />
        ${profileImageFieldHtml("Logo", "logoFile", restaurant.logoUrl, canEdit, "Logo restaurant")}
        ${profileImageFieldHtml("Logo pour documents (fond blanc)", "documentLogoFile", restaurant.documentLogoUrl, canEdit, "Logo pour documents")}
        ${profileImageFieldHtml("Image couverture", "coverFile", restaurant.coverUrl, canEdit, "Image couverture")}
        <label class="wide-field">Description<textarea name="description" rows="4" ${disabled(canEdit)}>${escapeHtml(restaurant.description)}</textarea></label>
      </div>
      ${canEdit ? `<button class="primary-btn button-reset" type="submit">Enregistrer le profil</button>` : `<p class="alert-note">Votre role permet la lecture uniquement.</p>`}
      <small data-form-status></small>
    </form>
  `;
}

function hoursFormHtml(restaurant, canEdit) {
  const services = resolveOpeningHoursByDay(restaurant.openingHours, restaurant);
  return `
    <form class="platform-form" data-dashboard-hours-form>
      <div class="weekly-hours">
        ${DAYS.map(([key, label]) => {
          const day = services[key] || {};
          const lunchEnabled = !!(day.lunchStart && day.lunchEnd);
          const dinnerEnabled = !!(day.dinnerStart && day.dinnerEnd);
          return `
            <div class="weekly-hour-row">
              <strong>${label}</strong>
              <div class="hours-service-row">
                <label class="day-toggle"><input type="checkbox" name="${key}.lunchEnabled" ${lunchEnabled ? "checked" : ""} ${disabled(canEdit)} /> Service midi</label>
                <label>Debut midi<input type="time" name="${key}.lunchStart" value="${escapeAttr(day.lunchStart || "12:00")}" ${disabled(canEdit)} /></label>
                <label>Fin midi<input type="time" name="${key}.lunchEnd" value="${escapeAttr(day.lunchEnd || "14:30")}" ${disabled(canEdit)} /></label>
              </div>
              <div class="hours-service-row">
                <label class="day-toggle"><input type="checkbox" name="${key}.dinnerEnabled" ${dinnerEnabled ? "checked" : ""} ${disabled(canEdit)} /> Service soir</label>
                <label>Debut soir<input type="time" name="${key}.dinnerStart" value="${escapeAttr(day.dinnerStart || "19:00")}" ${disabled(canEdit)} /></label>
                <label>Fin soir<input type="time" name="${key}.dinnerEnd" value="${escapeAttr(day.dinnerEnd || "22:30")}" ${disabled(canEdit)} /></label>
              </div>
            </div>
          `;
        }).join("")}
      </div>
      ${canEdit ? `<button class="primary-btn button-reset" type="submit">Enregistrer les horaires</button>` : ""}
      <small data-form-status></small>
    </form>
  `;
}

function switchFieldHtml(label, inputName, checked, canEdit, extraAttrs = "") {
  return `
    <label class="switch-field">
      <span class="switch-field-label">${escapeHtml(label)}</span>
      <span class="switch">
        <input type="checkbox" name="${escapeAttr(inputName)}" ${checked ? "checked" : ""} ${disabled(canEdit)} ${extraAttrs} />
        <span class="switch-track"></span>
      </span>
    </label>
  `;
}

function publicSettingsHtml(restaurant, publicUrl, canEdit) {
  const settings = restaurant.publicPageSettings || {};
  const theme = settings.theme || {};
  const primaryColor = normalizeHexColor(theme.primaryColor, "#0A2540");
  const accentColor = normalizeHexColor(theme.accentColor, "#1976F3");
  const previewUrl = `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}preview=${Date.now()}`;
  const publicPageOn = restaurant.publicPageEnabled !== false;
  const qrMenuOn = restaurant.qrMenuEnabled === true;
  const reservationOn = restaurant.reservationEnabled !== false;
  return `
    <form class="platform-form" data-dashboard-public-form>
      <div class="toggle-grid">
        ${switchFieldHtml("Page publique active", "publicPageEnabled", publicPageOn, canEdit, "data-master-toggle")}
        ${switchFieldHtml("QR menu actif", "qrMenuEnabled", publicPageOn && qrMenuOn, canEdit && publicPageOn, `data-dependent-toggle data-last-checked="${qrMenuOn}"`)}
        ${switchFieldHtml("Reservations actives", "reservationEnabled", publicPageOn && reservationOn, canEdit && publicPageOn, `data-dependent-toggle data-last-checked="${reservationOn}"`)}
      </div>
      <div class="form-grid">
        ${colorPickerFieldHtml("Couleur principale", "primaryColor", primaryColor, canEdit, ["#0A2540", "#123C63", "#17324D", "#2D3748", "#1F2937", "#0F766E"])}
        ${colorPickerFieldHtml("Couleur accent", "accentColor", accentColor, canEdit, ["#1976F3", "#42C96F", "#F59E0B", "#EF4444", "#8B5CF6", "#14B8A6"])}
        <label class="wide-field">Message public<textarea name="customMessage" rows="3" ${disabled(canEdit)}>${escapeHtml(settings.customMessage || "")}</textarea></label>
      </div>
      <div class="quick-links">
        <a href="${escapeAttr(previewUrl)}" target="_blank" rel="noopener noreferrer">Previsualiser</a>
        <button class="ghost-action" type="button" data-copy="${escapeAttr(publicUrl)}">Copier l'URL</button>
      </div>
      ${canEdit ? `<button class="primary-btn button-reset" type="submit">Enregistrer la page publique</button>` : ""}
      <small data-form-status></small>
    </form>
  `;
}

function menuFormHtml(restaurant, menu, canEdit) {
  const qrUrl = publicMenuUrl(restaurant);
  const qrImage = `https://quickchart.io/qr?size=180&text=${encodeURIComponent(qrUrl)}`;
  const hasCatalog = Array.isArray(menu?.categories) && menu.categories.length > 0;
  return `
    <form class="platform-form" data-dashboard-menu-form>
      <div class="qr-menu-preview">
        <div>
          <p class="alert-note">Destination QR : ${escapeHtml(qrUrl)}</p>
          <button class="ghost-action" type="button" data-copy="${escapeAttr(qrUrl)}">Copier le lien QR menu</button>
        </div>
        <img src="${qrImage}" alt="QR menu" loading="lazy" />
      </div>
      <input type="hidden" name="title" value="${escapeAttr(menu?.title || "Menu")}" />
      <input type="hidden" name="type" value="catalog" />
      <input type="hidden" name="externalUrl" value="" />
      <input type="hidden" name="pdfUrl" value="" />
      ${(restaurant.qrMenuEnabled || menu?.isActive) ? `<input type="hidden" name="isActive" value="on" />` : ""}
      <section class="catalog-menu-editor">
        <div class="section-title-row">
          <div>
            <p class="eyebrow">Catalogue Poket</p>
            <h3>Articles affiches sur la page publique</h3>
            <p>Activez les categories et articles a publier, puis personnalisez leur nom, description et image pour le menu QR.</p>
          </div>
        </div>
        ${hasCatalog ? `<div class="catalog-category-list" data-catalog-category-list>${menu.categories.map((category, index) => catalogCategoryEditorHtml(category, canEdit, index, menu.categories.length)).join("")}</div>` : emptyHtml("Aucune categorie catalogue trouvee dans Firestore pour ce restaurant.")}
      </section>
      ${canEdit ? `
        <div class="menu-save-bar">
          <small data-form-status></small>
          <button class="primary-btn button-reset" type="submit">Enregistrer le menu</button>
        </div>
      ` : `<small data-form-status></small>`}
    </form>
  `;
}

function profileImageFieldHtml(label, inputName, imageUrl, canEdit, alt) {
  return `
    <div class="profile-image-field">
      <span class="field-label">${escapeHtml(label)}</span>
      <span class="profile-image-preview${imageUrl ? "" : " is-empty"}" data-profile-image-preview>
        ${imageUrl
          ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(alt)}" loading="lazy" /><a href="${escapeAttr(imageUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir</a>`
          : "Aucune image enregistree"}
      </span>
      ${fileUploadButtonHtml(inputName, `image/png,image/jpeg,image/webp${inputName === "logoFile" ? ",image/svg+xml" : ""}`, !!imageUrl, canEdit, "data-profile-image-file")}
    </div>
  `;
}

// Bouton de televersement stylise : le texte natif du navigateur (« Choisir un fichier »)
// ne peut pas etre modifie, on cache donc l'input (toujours accessible au clavier, le
// <label> le porte) derriere un bouton dont le texte dit ce qu'il fait, et change des
// qu'un fichier existe deja ou vient d'etre choisi.
function fileUploadButtonHtml(inputName, accept, hasExisting, canEdit, extraAttrs = "") {
  return `
    <label class="file-upload-control${canEdit ? "" : " is-disabled"}">
      <input name="${escapeAttr(inputName)}" type="file" accept="${escapeAttr(accept)}" class="file-upload-input" ${extraAttrs} ${disabled(canEdit)} />
      <span class="file-upload-button" data-file-upload-button>${hasExisting ? "Modifier le fichier" : "Ajouter un fichier"}</span>
    </label>
  `;
}

// Apercu immediat au choix du fichier, avant meme d'enregistrer le profil (le fichier
// n'est envoye a Storage qu'a la soumission du formulaire).
function previewProfileImageFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const field = input.closest(".profile-image-field");
  const preview = field?.querySelector("[data-profile-image-preview]");
  if (!preview) return;
  preview.classList.remove("is-empty");
  const url = URL.createObjectURL(file);
  preview.innerHTML = `<img src="${escapeAttr(url)}" alt="${escapeAttr(file.name || "Apercu")}" />`;
  preview.querySelector("img")?.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
  const button = field?.querySelector("[data-file-upload-button]");
  if (button) button.textContent = "Modifier le fichier";
}

function applyMasterToggleCascade(masterInput) {
  const grid = masterInput.closest(".toggle-grid");
  if (!grid) return;
  const dependents = grid.querySelectorAll("[data-dependent-toggle]");
  if (masterInput.checked) {
    dependents.forEach((input) => {
      input.disabled = false;
      input.checked = input.dataset.lastChecked === "true";
    });
  } else {
    dependents.forEach((input) => {
      input.dataset.lastChecked = String(input.checked);
      input.checked = false;
      input.disabled = true;
    });
  }
}

function colorPickerFieldHtml(label, name, value, canEdit, palette) {
  return `
    <label class="color-picker-field">${escapeHtml(label)}
      <span class="color-picker-control">
        <span class="color-preview" style="background:${escapeAttr(value)}"></span>
        <input type="color" name="${escapeAttr(name)}" value="${escapeAttr(value)}" data-color-input ${disabled(canEdit)} />
      </span>
      <span class="color-swatch-grid" aria-label="${escapeAttr(label)}">
        ${palette.map((color) => `
          <button class="color-swatch button-reset" type="button" style="background:${escapeAttr(color)}" title="${escapeAttr(color)}" aria-label="${escapeAttr(color)}" data-color-target="${escapeAttr(name)}" data-color-choice="${escapeAttr(color)}" ${disabled(canEdit)}></button>
        `).join("")}
      </span>
    </label>
  `;
}

function updateColorPreview(input) {
  const preview = input.closest(".color-picker-control")?.querySelector(".color-preview");
  if (preview) preview.style.background = input.value;
}

function normalizeHexColor(value, fallback) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color.slice(1).split("").map((char) => char + char).join("")}`;
  }
  return fallback;
}

function catalogCategoryEditorHtml(category, canEdit, index = 0, total = 0) {
  const visibleItems = category.items.filter((item) => item.publicVisible).length;
  return `
    <details class="catalog-category-editor" data-catalog-category-editor data-category-id="${escapeAttr(category.id)}">
      <summary class="catalog-category-summary">
        ${canEdit ? `<button class="catalog-drag-handle button-reset" type="button" aria-label="Deplacer ${escapeAttr(category.name || category.id)}" title="Deplacer" data-category-drag-handle>⋮⋮</button>` : ""}
        <span class="catalog-category-chevron" aria-hidden="true"></span>
        <span class="catalog-category-name">${escapeHtml(category.name || category.id)}</span>
        ${canEdit ? `
          <span class="catalog-category-order-actions">
            <button class="catalog-order-btn button-reset" type="button" aria-label="Monter ${escapeAttr(category.name || category.id)}" title="Monter" data-category-move="up" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="catalog-order-btn button-reset" type="button" aria-label="Descendre ${escapeAttr(category.name || category.id)}" title="Descendre" data-category-move="down" ${index === total - 1 ? "disabled" : ""}>↓</button>
          </span>
        ` : ""}
        <span class="catalog-category-count">${category.items.length} article${category.items.length > 1 ? "s" : ""} - ${visibleItems} affiche${visibleItems > 1 ? "s" : ""}</span>
        <span class="catalog-autosave-status" data-catalog-autosave-status data-state="${category.publicVisible ? "saved" : "idle"}">${category.publicVisible ? "Publie" : "Non publie"}</span>
      </summary>
      <div class="catalog-category-body">
        <div class="catalog-category-head">
          <label class="inline-toggle">
            <input type="checkbox" name="category.${escapeAttr(category.id)}.publicVisible" data-catalog-autosave data-catalog-type="category" data-category-id="${escapeAttr(category.id)}" ${category.publicVisible ? "checked" : ""} ${disabled(canEdit)} />
            Afficher la categorie
          </label>
        </div>
        <div class="form-grid compact-form-grid">
          <label>Nom d'affichage<input name="category.${escapeAttr(category.id)}.publicDisplayName" value="${escapeAttr(category.displayName !== category.name ? category.displayName : "")}" placeholder="${escapeAttr(category.name || "Nom catalogue")}" data-catalog-autosave data-catalog-type="category" data-category-id="${escapeAttr(category.id)}" ${disabled(canEdit)} /></label>
          <label class="wide-field">Description categorie<textarea name="category.${escapeAttr(category.id)}.publicDescription" rows="2" data-catalog-autosave data-catalog-type="category" data-category-id="${escapeAttr(category.id)}" ${disabled(canEdit)}>${escapeHtml(category.description || "")}</textarea></label>
        </div>
        <div class="catalog-items-editor">
          ${category.items.length ? category.items.map((item) => catalogItemEditorHtml(item, canEdit)).join("") : emptyHtml("Aucun article dans cette categorie.")}
        </div>
      </div>
    </details>
  `;
}

function catalogCategoryOrderMap(form) {
  return new Map([...form.querySelectorAll("[data-catalog-category-editor][data-category-id]")]
    .map((category, index) => [category.dataset.categoryId, index + 1]));
}

function moveCatalogCategory(root, button) {
  const category = button.closest("[data-catalog-category-editor]");
  const list = category?.closest("[data-catalog-category-list]");
  if (!category || !list) return;
  if (button.dataset.categoryMove === "up" && category.previousElementSibling) {
    list.insertBefore(category, category.previousElementSibling);
  }
  if (button.dataset.categoryMove === "down" && category.nextElementSibling) {
    list.insertBefore(category.nextElementSibling, category);
  }
  persistCatalogCategoryOrder(root, list);
}

function finishCatalogCategoryDrag(root) {
  if (!draggedCatalogCategory) return;
  const list = draggedCatalogCategory.closest("[data-catalog-category-list]");
  draggedCatalogCategory.classList.remove("is-dragging");
  draggedCatalogCategory = null;
  if (list) persistCatalogCategoryOrder(root, list);
}

async function persistCatalogCategoryOrder(root, list) {
  updateCatalogOrderButtons(list);
  const form = list.closest("[data-dashboard-menu-form]");
  const restaurantId = root.dataset.restaurantId;
  const status = form?.querySelector("[data-form-status]");
  if (!form || !restaurantId) return;
  try {
    if (status) status.textContent = "Ordre des categories...";
    await saveCatalogCategoryOrder(restaurantId, form);
    if (status) status.textContent = "Ordre publie";
  } catch (error) {
    if (status) status.textContent = "Erreur ordre categories";
    console.error(error);
  }
}

function updateCatalogOrderButtons(list) {
  const categories = [...list.querySelectorAll("[data-catalog-category-editor]")];
  categories.forEach((category, index) => {
    const up = category.querySelector('[data-category-move="up"]');
    const down = category.querySelector('[data-category-move="down"]');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === categories.length - 1;
  });
}

function catalogItemEditorHtml(item, canEdit) {
  const fieldPrefix = `item.${item.categoryId}.${item.id}`;
  const needsMenuPrice = !item.catalogPriceLabel;
  return `
    <article class="catalog-item-editor">
      <div class="catalog-item-visual" data-catalog-image-preview>
        ${item.imageUrl ? `<img src="${escapeAttr(item.imageUrl)}" alt="${escapeAttr(item.displayName || item.name)}" loading="lazy" />` : `<span>Image</span>`}
      </div>
      <div class="catalog-item-fields">
        <div class="catalog-item-title">
          <label class="inline-toggle">
            <input type="checkbox" name="${escapeAttr(fieldPrefix)}.publicVisible" data-catalog-autosave data-catalog-type="item" data-category-id="${escapeAttr(item.categoryId)}" data-item-id="${escapeAttr(item.id)}" ${item.publicVisible ? "checked" : ""} ${disabled(canEdit)} />
            Afficher
          </label>
          <strong>${escapeHtml(item.name || item.id)}</strong>
          ${item.catalogPriceLabel ? `<span>${escapeHtml(item.catalogPriceLabel)}</span>` : ""}
          <small class="catalog-autosave-status" data-catalog-autosave-status data-state="${item.publicVisible || item.imageUrl ? "saved" : "idle"}">${item.publicVisible || item.imageUrl ? "Publie" : "Non publie"}</small>
        </div>
        <div class="form-grid compact-form-grid">
          <label>Nom d'affichage<input name="${escapeAttr(fieldPrefix)}.publicDisplayName" value="${escapeAttr(item.displayName !== item.name ? item.displayName : "")}" placeholder="${escapeAttr(item.name || "Nom catalogue")}" data-catalog-autosave data-catalog-type="item" data-category-id="${escapeAttr(item.categoryId)}" data-item-id="${escapeAttr(item.id)}" ${disabled(canEdit)} /></label>
          ${needsMenuPrice ? `<label>Prix menu<input name="${escapeAttr(fieldPrefix)}.publicPrice" value="${escapeAttr(item.publicPrice || "")}" placeholder="Ex: 12,50" inputmode="decimal" data-catalog-autosave data-catalog-type="item" data-category-id="${escapeAttr(item.categoryId)}" data-item-id="${escapeAttr(item.id)}" ${disabled(canEdit)} /></label>` : ""}
          <label>URL image<input name="${escapeAttr(fieldPrefix)}.imageUrl" value="${escapeAttr(item.imageUrl || "")}" placeholder="https://..." data-catalog-image-url data-catalog-type="item" data-category-id="${escapeAttr(item.categoryId)}" data-item-id="${escapeAttr(item.id)}" ${disabled(canEdit)} /></label>
          <div class="field-label-group">Image${fileUploadButtonHtml(`${fieldPrefix}.imageFile`, "image/png,image/jpeg,image/webp", !!item.imageUrl, canEdit, `data-catalog-image-file data-catalog-type="item" data-category-id="${escapeAttr(item.categoryId)}" data-item-id="${escapeAttr(item.id)}"`)}</div>
          <label class="wide-field">Description article<textarea name="${escapeAttr(fieldPrefix)}.publicDescription" rows="2" data-catalog-autosave data-catalog-type="item" data-category-id="${escapeAttr(item.categoryId)}" data-item-id="${escapeAttr(item.id)}" ${disabled(canEdit)}>${escapeHtml(item.description || "")}</textarea></label>
        </div>
      </div>
    </article>
  `;
}

function previewCatalogImageFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const editor = input.closest(".catalog-item-editor");
  const preview = editor?.querySelector("[data-catalog-image-preview]");
  if (!preview) return;
  const url = URL.createObjectURL(file);
  setCatalogImagePreview(preview, url, file.name || "Image article", () => URL.revokeObjectURL(url));
  const button = input.closest(".file-upload-control")?.querySelector("[data-file-upload-button]");
  if (button) button.textContent = "Modifier le fichier";
}

function previewCatalogImageUrl(input) {
  const value = input.value.trim();
  const preview = input.closest(".catalog-item-editor")?.querySelector("[data-catalog-image-preview]");
  if (!preview || !value) return;
  setCatalogImagePreview(preview, value, "Image article");
}

function setCatalogImagePreview(preview, src, alt, onLoad = null) {
  preview.classList.add("has-preview");
  preview.innerHTML = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy" />`;
  if (onLoad) preview.querySelector("img")?.addEventListener("load", onLoad, { once: true });
}

function clientsHtml(customerAccounts = {}, reservations = [], role = "") {
  const customers = Array.isArray(customerAccounts) ? customerAccounts : customerAccounts.customers || [];
  const readErrors = Array.isArray(customerAccounts.errors) ? customerAccounts.errors : [];
  const normalizedReservations = Array.isArray(reservations) ? reservations : [];
  const clients = customers.map(normalizeCustomerAccount).sort((a, b) => {
    const dateDiff = clientTimeValue(b.updatedAt || b.createdAt) - clientTimeValue(a.updatedAt || a.createdAt);
    if (dateDiff) return dateDiff;
    return (a.displayName || "").localeCompare(b.displayName || "", "fr");
  });
  const activeClients = clients.filter((client) => client.active !== false).length;
  const companyClients = clients.filter((client) => client.type === "company").length;
  const withPhone = clients.filter((client) => client.phone).length;
  const withEmail = clients.filter((client) => client.email).length;
  const duplicateWarnings = clientDuplicateWarnings(clients);
  const canManageClients = CLIENT_MANAGER_ROLES.includes(role);
  return `
    <div class="clients-dashboard client-ledger">
      <div class="clients-section-head">
        <div class="client-title-block">
          <h2>Clients</h2>
          <div class="client-tab-count">
            <strong>Clients</strong>
            <span>${clients.length}</span>
          </div>
        </div>
        <div class="client-top-actions">
          ${canManageClients ? `
          <details class="client-add-panel">
            <summary class="client-create-btn">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/></svg>
              <strong>Creer client</strong>
            </summary>
            <form class="platform-form customer-account-form" data-dashboard-customer-form data-customer-type-scope data-customer-type="individual">
              ${customerFieldsHtml()}
              <button class="primary-btn button-reset" type="submit">Ajouter le contact</button>
              <small data-form-status></small>
            </form>
          </details>
          ` : ""}
          <details class="client-more-menu">
            <summary>More</summary>
            <div>
              <button class="button-reset" type="button" data-client-export="xlsx">Exporter en Excel (.xlsx)</button>
              <button class="button-reset" type="button" data-client-export="csv">Exporter en CSV</button>
              ${canManageClients ? `<label class="client-import-action">Import contacts<input type="file" accept=".csv,text/csv" data-client-import-file hidden /></label>` : ""}
              <small class="client-import-status" data-client-import-status role="status"></small>
            </div>
          </details>
        </div>
      </div>
      ${readErrors.length ? `<p class="alert-note">Lecture des comptes clients incomplete ou impossible : ${escapeHtml(readErrors.join(" | "))}</p>` : ""}
      ${duplicateWarnings.length ? `
        <div class="client-duplicates" role="status">
          <strong>Doublons possibles</strong>
          ${duplicateWarnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}
        </div>
      ` : ""}
      ${clients.length ? `
        <div class="client-tools" data-client-tools>
          <label class="client-search-field">
            <span>Rechercher</span>
            <input data-client-search placeholder="Nom, telephone, email, societe..." />
          </label>
          <label>
            <span>Filtrer</span>
            <select data-client-filter>
              <option value="all">Tous les clients</option>
              <option value="active">Actifs</option>
              <option value="inactive">Inactifs</option>
              <option value="with-phone">Avec telephone</option>
              <option value="with-email">Avec email</option>
              <option value="owing">Solde a encaisser</option>
              <option value="credit">Credit client</option>
              <option value="company">Societes</option>
              <option value="individual">Particuliers</option>
            </select>
          </label>
          <button class="ghost-action button-reset is-hidden" type="button" data-client-reset>Reinitialiser</button>
          <span data-client-result-count>${clients.length} client${clients.length > 1 ? "s" : ""}</span>
        </div>
        <div class="responsive-table clients-table">
          <div class="table-row table-head client-row">
            ${CLIENT_COLUMNS.map(clientColumnHeadHtml).join("")}
          </div>
          ${clients.map((client) => clientCardHtml(client, normalizedReservations)).join("")}
        </div>
        <div class="client-empty-results is-hidden" data-client-empty-results>Aucun client ne correspond a cette recherche.</div>
        <div class="client-pagination" data-client-pagination>
          <label>
            <select data-client-page-size>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
            <span>per page</span>
          </label>
          <div>
            <span data-client-page-label>Page 1</span>
            <button class="button-reset" type="button" data-client-page="-1">&lt;</button>
            <button class="button-reset" type="button" data-client-page="1">&gt;</button>
          </div>
        </div>
        <div class="client-detail-stack">
          ${clients.map((client) => clientDetailHtml(client, normalizedReservations, role)).join("")}
        </div>
      ` : `<div class="empty-state">Aucun compte client pour le moment.</div>`}
    </div>
  `;
}

function clientColumnHeadHtml(column) {
  const [ascLabel, descLabel] = CLIENT_SORT_LABELS[column.kind];
  const placeholder = column.kind === "date" ? "JJ/MM/AAAA" : "Contient...";
  return `
    <div class="client-col-head ${column.className}" data-client-col="${column.key}">
      <span class="client-col-title">${escapeHtml(column.label)}</span>
      <button class="client-col-toggle button-reset" type="button" data-client-col-toggle="${column.key}" aria-haspopup="true" aria-expanded="false" aria-label="Filtrer et trier : ${escapeAttr(column.label)}"></button>
      <div class="client-col-menu" role="group" aria-label="Filtre et tri : ${escapeAttr(column.label)}">
        <button class="button-reset" type="button" data-client-col-sort="${column.key}:asc" aria-pressed="false">${ascLabel}</button>
        <button class="button-reset" type="button" data-client-col-sort="${column.key}:desc" aria-pressed="false">${descLabel}</button>
        <label>Filtrer
          <input type="search" data-client-col-filter="${column.key}" placeholder="${placeholder}" autocomplete="off" />
        </label>
        <button class="button-reset client-col-clear" type="button" data-client-col-clear="${column.key}" disabled>Effacer le filtre et le tri</button>
      </div>
    </div>
  `;
}

function clientCardHtml(client, reservations = []) {
  const identity = [
    client.displayName || "Client sans nom",
    client.companyName ? `Societe : ${client.companyName}` : "",
    client.contactName ? `Contact : ${client.contactName}` : "",
    client.taxId ? `Tax ID : ${client.taxId}` : "",
    client.vatNumber ? `TVA : ${client.vatNumber}` : ""
  ].filter(Boolean);
  const searchText = [
    client.displayName,
    client.firstName,
    client.lastName,
    client.companyName,
    client.contactName,
    client.phone,
    client.email,
    client.address,
    client.taxId,
    client.vatNumber,
    client.notes
  ].join(" ");
  const updatedTime = clientTimeValue(client.updatedAt || client.createdAt);
  const createdTime = clientTimeValue(client.createdAt);
  const metrics = clientAccountMetrics(client, reservations);
  const account = clientAccountSummary(client);
  const phoneLabel = formatClientPhone(client.phone);
  return `
    <div class="customer-account-card table-row client-row"
      data-client-card
      data-client-detail-target="${escapeAttr(client.id)}"
      data-client-name="${escapeAttr(normalizeClientSearch(client.displayName || ""))}"
      data-client-type="${escapeAttr(client.type)}"
      data-client-active="${client.active === false ? "false" : "true"}"
      data-client-has-phone="${client.phone ? "true" : "false"}"
      data-client-has-email="${client.email ? "true" : "false"}"
      data-client-updated="${String(updatedTime)}"
      data-client-created="${String(createdTime)}"
      data-client-reservations="${String(metrics.reservationCount)}"
      data-client-last-visit="${escapeAttr(metrics.lastVisitLabel)}"
      data-client-email="${escapeAttr(normalizeClientSearch(client.email))}"
      data-client-phone="${escapeAttr(normalizeClientPhone(client.phone))}"
      data-client-country="${escapeAttr(normalizeClientSearch(client.country || "France"))}"
      data-client-created-label="${escapeAttr(normalizeClientSearch(clientDateLabel(client.createdAt || client.updatedAt)))}"
      data-client-balance="${escapeAttr(normalizeClientSearch(account.balanceLabel))}"
      data-client-balance-value="${String(account.balanceValue)}"
      data-client-search-text="${escapeAttr(normalizeClientSearch(searchText))}">
      <span class="col-name">
        <strong>${escapeHtml(identity[0])}</strong>
        ${identity.slice(1).map((line) => `<small>${escapeHtml(line)}</small>`).join("")}
      </span>
      <span class="col-email">${escapeHtml(client.email || "-")}</span>
      <span class="col-phone">${escapeHtml(phoneLabel || "-")}</span>
      <span class="col-country">${escapeHtml(client.country || "France")}</span>
      <span class="col-created">${escapeHtml(clientDateLabel(client.createdAt || client.updatedAt) || "-")}</span>
      <span class="col-balance client-balance-cell is-${account.balanceTone}">${escapeHtml(account.balanceLabel)}</span>
    </div>
  `;
}

function clientDetailHtml(client, reservations = [], role = "") {
  const canManageClients = CLIENT_MANAGER_ROLES.includes(role);
  const canDeleteClients = CLIENT_DELETE_ROLES.includes(role);
  const collectionName = customerCollectionName(client.customerCollection);
  const metrics = clientAccountMetrics(client, reservations);
  const account = clientAccountSummary(client);
  const displayName = client.displayName || client.companyName || "Client sans nom";
  const statusLabel = client.active === false ? "Inactif" : "Actif";
  return `
    <article class="client-detail-page is-hidden" data-client-detail="${escapeAttr(client.id)}">
      <header class="client-detail-header">
        <button class="button-reset client-back-btn" type="button" data-client-back aria-label="Retour aux clients">&larr;</button>
        <div>
          <span>Compte client</span>
          <h2>${escapeHtml(displayName)}</h2>
        </div>
        ${canManageClients ? `<button class="outline-dark-btn button-reset" type="button" data-client-edit-toggle>Modifier les informations</button>` : ""}
      </header>

      <section class="client-account-hero">
        <article>
          <span>Solde</span>
          <strong class="is-${account.balanceTone}">${escapeHtml(account.balanceLabel)}</strong>
          <small>${escapeHtml(account.balanceStateLabel)}</small>
        </article>
        <article>
          <span>Mouvements</span>
          <strong>${escapeHtml(account.movementCountLabel)}</strong>
          <small>Journal du compte</small>
        </article>
        <article>
          <span>Tickets ouverts</span>
          <strong>${escapeHtml(account.openTicketCountLabel)}</strong>
          <small>Sur compte client</small>
        </article>
        <article>
          <span>Dernier passage</span>
          <strong>${escapeHtml(metrics.lastVisitLabel || "-")}</strong>
          <small>${escapeHtml(metrics.reservationCount ? `${metrics.reservationCount} reservation${metrics.reservationCount > 1 ? "s" : ""}` : "Aucune reservation")}</small>
        </article>
      </section>

      <details class="client-info-section">
        <summary><span>Informations du compte</span><small>Identite, contact, adresse, notes</small></summary>
      <div class="client-account-details">
        ${reservationDetailItemHtml("ID compte", client.id)}
        ${reservationDetailItemHtml("Type", client.type === "company" ? "Societe" : "Particulier")}
        ${reservationDetailItemHtml("Titre", client.civility)}
        ${reservationDetailItemHtml("Nom", client.lastName)}
        ${reservationDetailItemHtml("Prenom", client.firstName)}
        ${reservationDetailItemHtml("Societe", client.companyName)}
        ${reservationDetailItemHtml("Contact", client.contactName)}
        ${reservationDetailItemHtml("Telephone", client.phone)}
        ${reservationDetailItemHtml("Email", client.email)}
        ${reservationDetailItemHtml("Adresse", client.address)}
        ${reservationDetailItemHtml("Pays", client.country || "France")}
        ${reservationDetailItemHtml("Tax ID", client.taxId)}
        ${reservationDetailItemHtml("TVA", client.vatNumber)}
        ${reservationDetailItemHtml("Statut", statusLabel)}
        ${reservationDetailItemHtml("Mis a jour", clientDateLabel(client.updatedAt || client.createdAt))}
        ${reservationDetailItemHtml("Notes", client.notes)}
        ${reservationDetailItemHtml("Date creation", clientDateLabel(client.createdAt))}
      </div>
      </details>

      ${canManageClients ? `
      <section class="client-detail-edit is-hidden" data-client-edit-panel>
        <h3>Modifier les informations</h3>
          <form class="platform-form client-edit-form" data-dashboard-customer-update-form data-customer-id="${escapeAttr(client.id)}" data-customer-collection="${escapeAttr(collectionName)}" data-customer-type-scope data-customer-type="${escapeAttr(client.type === "company" ? "company" : "individual")}">
            ${customerFieldsHtml(client)}
            <button class="primary-btn button-reset" type="submit">Enregistrer le client</button>
            <small data-form-status></small>
          </form>
      </section>
      ` : ""}

${clientJournalHtml(account)}

      ${canManageClients ? `
      <section class="client-danger-zone">
        <div class="client-actions">
          <form data-dashboard-customer-state-form data-customer-id="${escapeAttr(client.id)}" data-customer-collection="${escapeAttr(collectionName)}" data-customer-active="${client.active === false ? "false" : "true"}">
            <button class="outline-dark-btn button-reset" type="submit">${client.active === false ? "Reactiver" : "Desactiver"}</button>
            <small data-form-status></small>
          </form>
          ${canDeleteClients ? `
          <form data-dashboard-customer-delete-form data-customer-id="${escapeAttr(client.id)}" data-customer-collection="${escapeAttr(collectionName)}" data-customer-name="${escapeAttr(displayName)}">
            <button class="ghost-action button-reset danger-action" type="button" data-client-delete-arm>Supprimer</button>
            <div class="client-delete-confirm">
              <span>Suppression definitive</span>
              <button class="ghost-action button-reset" type="button" data-client-delete-cancel>Annuler</button>
              <button class="ghost-action button-reset danger-action" type="submit">Confirmer</button>
            </div>
            <small data-form-status></small>
          </form>
          ` : `<p class="client-permission-note">La suppression est reservee aux owners et aux admins.</p>`}
        </div>
      </section>
      ` : `<p class="client-permission-note">Votre role permet la lecture uniquement.</p>`}
    </article>
  `;
}

function customerFieldsHtml(client = {}) {
  const type = client.type || "individual";
  return `
    <div class="form-grid">
      <label>Type
        <select name="type" data-customer-type-select>
          <option value="individual" ${type !== "company" ? "selected" : ""}>Particulier</option>
          <option value="company" ${type === "company" ? "selected" : ""}>Societe</option>
        </select>
      </label>
      <label data-customer-field="individual">Titre
        <select name="civility">
          ${CIVILITY_OPTIONS.map((option) => `<option value="${escapeAttr(option)}" ${option === (client.civility || "") ? "selected" : ""}>${option || "—"}</option>`).join("")}
        </select>
      </label>
      <label data-customer-field="individual">Nom<input name="lastName" value="${escapeAttr(client.lastName)}" /></label>
      <label data-customer-field="individual">Prenom<input name="firstName" value="${escapeAttr(client.firstName)}" /></label>
      <label data-customer-field="company">Societe<input name="companyName" value="${escapeAttr(client.companyName)}" /></label>
      <label data-customer-field="company">Contact<input name="contactName" value="${escapeAttr(client.contactName)}" /></label>
      <label>Telephone<input name="phone" value="${escapeAttr(client.phone)}" /></label>
      <label>Email<input name="email" type="email" value="${escapeAttr(client.email)}" /></label>
      <label>Pays<input name="country" value="${escapeAttr(client.country || "France")}" /></label>
      <label class="wide-field">Adresse<input name="address" value="${escapeAttr(client.address)}" /></label>
      <label data-customer-field="company">Tax ID<input name="taxId" value="${escapeAttr(client.taxId)}" /></label>
      <label data-customer-field="company">TVA<input name="vatNumber" value="${escapeAttr(client.vatNumber)}" /></label>
      <label class="wide-field">Notes<textarea name="notes" rows="3">${escapeHtml(client.notes)}</textarea></label>
    </div>
  `;
}

function requireClientPermission(root, target) {
  const role = root.dataset.restaurantRole || "";
  let needed = typeof target === "string" ? target : "";
  if (target && typeof target !== "string") {
    if (target.matches("[data-dashboard-customer-delete-form]")) needed = "delete";
    else if (target.matches("[data-dashboard-customer-form], [data-dashboard-customer-update-form], [data-dashboard-customer-state-form]")) needed = "manage";
  }
  if (needed === "delete" && !CLIENT_DELETE_ROLES.includes(role)) {
    throw new Error("La suppression est reservee aux owners et aux admins.");
  }
  if (needed === "manage" && !CLIENT_MANAGER_ROLES.includes(role)) {
    throw new Error("Action reservee aux owners, admins et managers.");
  }
}

function parseCsv(input) {
  const source = String(input || "").replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      endRow();
    } else {
      cell += char;
    }
  }
  endRow();
  return rows;
}

function planCustomerImport(rows, cards) {
  if (rows.length < 2) return { customers: [], skipped: 0, message: "Le fichier ne contient aucune ligne de donnees." };
  const fields = rows[0].map((header) => CLIENT_IMPORT_HEADERS[normalizeClientSearch(header)] || "");
  if (!fields.some((field) => field && field !== "status")) {
    return { customers: [], skipped: 0, message: "Colonnes non reconnues : utilisez l'export de contacts comme modele." };
  }
  const knownEmails = new Set(cards.map((card) => card.dataset.clientEmail).filter(Boolean));
  const knownPhones = new Set(cards.map((card) => card.dataset.clientPhone).filter(Boolean));
  const customers = [];
  let skipped = 0;
  rows.slice(1).forEach((row) => {
    const data = {};
    fields.forEach((field, index) => {
      if (!field) return;
      // Retire l'apostrophe ajoutee a l'export pour neutraliser les formules.
      data[field] = String(row[index] ?? "").trim().replace(/^'(?=[=+\-@])/, "").slice(0, field === "notes" ? 2000 : 500);
    });
    const typeLabel = normalizeClientSearch(data.type || "");
    const type = normalizeCustomerType(["societe", "company", "entreprise"].includes(typeLabel) ? "company" : "individual", data);
    const payload = {
      type,
      displayName: data.displayName || "",
      civility: data.civility || "",
      firstName: data.firstName || "",
      lastName: data.lastName || "",
      companyName: data.companyName || "",
      contactName: data.contactName || "",
      phone: data.phone || "",
      email: data.email || "",
      address: data.address || "",
      country: data.country || "France",
      taxId: data.taxId || "",
      vatNumber: data.vatNumber || "",
      notes: data.notes || "",
      active: !["inactif", "inactive", "desactive"].includes(normalizeClientSearch(data.status || ""))
    };
    if (!hasCustomerIdentity(payload)) {
      skipped += 1;
      return;
    }
    if (!payload.displayName) {
      payload.displayName = customerDisplayName(payload.civility, payload.lastName, payload.firstName, payload.companyName, payload.contactName);
    }
    const email = normalizeClientSearch(payload.email);
    const phone = normalizeClientPhone(payload.phone);
    const duplicate = (email && knownEmails.has(email)) || (phone.length >= 6 && knownPhones.has(phone));
    if (duplicate || customers.length >= CLIENT_IMPORT_LIMIT) {
      skipped += 1;
      return;
    }
    if (email) knownEmails.add(email);
    if (phone.length >= 6) knownPhones.add(phone);
    customers.push(payload);
  });
  return { customers, skipped, message: skipped ? "Toutes les lignes sont vides ou deja presentes." : "" };
}

async function importCustomerAccounts(restaurantId, customers, user) {
  const services = await getServices();
  const { collection, doc, serverTimestamp, writeBatch } = services.firestoreModule;
  const target = collection(services.db, "restaurants", restaurantId, "customers");
  for (let start = 0; start < customers.length; start += 400) {
    const batch = writeBatch(services.db);
    customers.slice(start, start + 400).forEach((customer) => {
      batch.set(doc(target), {
        ...customer,
        source: "csv_import",
        createdBy: user?.uid || "",
        createdByEmail: user?.email || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
  }
}

async function handleClientImport(root, input) {
  const file = input.files?.[0];
  input.value = "";
  const status = root.querySelector("[data-client-import-status]");
  const setStatus = (message) => {
    if (status) status.textContent = message;
  };
  if (!file) return;
  try {
    requireClientPermission(root, "manage");
    if (file.size > 2 * 1024 * 1024) throw new Error("Fichier trop volumineux (2 Mo maximum).");
    setStatus("Lecture du fichier...");
    const plan = planCustomerImport(parseCsv(await file.text()), [...root.querySelectorAll("[data-client-card]")]);
    if (!plan.customers.length) throw new Error(plan.message || "Aucun contact a importer.");
    const ignored = plan.skipped ? ` ${plan.skipped} ligne${plan.skipped > 1 ? "s" : ""} ignoree${plan.skipped > 1 ? "s" : ""} (doublons ou lignes vides).` : "";
    if (!window.confirm(`Importer ${plan.customers.length} contact${plan.customers.length > 1 ? "s" : ""} ?${ignored}`)) {
      setStatus("Import annule.");
      return;
    }
    setStatus("Import en cours...");
    await importCustomerAccounts(root.dataset.restaurantId, plan.customers, currentUser);
    await renderDashboard(root, currentUser, root.dataset.restaurantId, "clients");
    const done = root.querySelector("[data-client-import-status]");
    if (done) done.textContent = `${plan.customers.length} contact${plan.customers.length > 1 ? "s" : ""} importe${plan.customers.length > 1 ? "s" : ""}.`;
  } catch (error) {
    setStatus(error?.code === "permission-denied"
      ? "Import refuse par Firestore : votre role ne permet pas cette operation."
      : (error.message || String(error)));
  }
}

function clientDuplicateWarnings(clients) {
  const groups = new Map();
  clients.forEach((client) => {
    [
      ["telephone", normalizeClientPhone(client.phone)],
      ["email", client.email]
    ].forEach(([label, value]) => {
      const key = normalizeClientSearch(value || "");
      if (!key) return;
      const groupKey = `${label}:${key}`;
      const group = groups.get(groupKey) || { label, value, names: [] };
      group.names.push(client.displayName || client.companyName || client.id || "Client sans nom");
      groups.set(groupKey, group);
    });
  });
  return [...groups.values()]
    .filter((group) => group.names.length > 1)
    .map((group) => `${group.label} ${group.value} partage par ${group.names.join(", ")}`);
}

function clientAccountMetrics(client, reservations = []) {
  const matches = reservations.filter((reservation) => reservationMatchesClient(reservation, client));
  const lastDate = matches
    .map((reservation) => dateFromFirestoreValue(
      reservation.reservedAt ||
      reservation.reservationAt ||
      reservation.dateTime ||
      reservation.startAt ||
      reservation.createdFor ||
      reservation.createdAt ||
      reservation.updatedAt
    ))
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    reservationCount: matches.length,
    lastVisitLabel: lastDate ? clientDateLabel(lastDate) : ""
  };
}

// ---------------------------------------------------------------------------
// Solde d'un compte client : CREDITS - DEBITS.
// Chaque mouvement est un debit (ticket mis sur le compte) ou un credit (paiement
// recu), avec un montant toujours positif. Solde = total des credits - total des
// debits : negatif = le client doit de l'argent, positif = credit disponible.
// ---------------------------------------------------------------------------
function roundMoney(value) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function balanceTone(value) {
  if (value < -0.004) return "owed";
  if (value > 0.004) return "credit";
  return "even";
}

function clientAccountSummary(client = {}) {
  const movements = normalizeClientMovements(client);
  const debitFromMovements = movements.filter((movement) => movement.direction === "debit").reduce((total, movement) => total + movement.amount, 0);
  const creditFromMovements = movements.filter((movement) => movement.direction === "credit").reduce((total, movement) => total + movement.amount, 0);
  const debitTotal = roundMoney(firstNumber(client.debitTotal, client.totalDebits, client.totalDebit) ?? debitFromMovements);
  const creditTotal = roundMoney(firstNumber(client.creditTotal, client.totalCredits, client.totalCredit) ?? creditFromMovements);
  const storedBalance = firstNumber(client.balance, client.solde);
  // Sans journal, un solde enregistre sur la fiche sert de repli.
  const balance = movements.length || storedBalance === null ? roundMoney(creditTotal - debitTotal) : roundMoney(storedBalance);
  const tone = balanceTone(balance);
  const openTickets = firstNumber(client.openTicketCount, client.openTickets, client.unpaidTickets, client.pendingTicketCount);
  return {
    clientKey: `${customerCollectionName(client.customerCollection)}/${client.id}`,
    balanceValue: balance,
    debitValue: debitTotal,
    creditValue: creditTotal,
    balanceLabel: formatMoney(balance),
    balanceTone: tone,
    balanceStateLabel: tone === "owed" ? "A encaisser" : tone === "credit" ? "Credit client" : "A jour",
    movementCountLabel: String(movements.length || firstNumber(client.movementCount, client.movementsCount) || 0),
    openTicketCountLabel: String(openTickets ?? 0),
    debitLabel: formatMoney(debitTotal),
    creditLabel: formatMoney(creditTotal),
    movements: withRunningBalance(movements)
  };
}

function normalizeClientMovements(client = {}) {
  const sources = [
    client.movements,
    client.accountMovements,
    client.transactions,
    client.ledger,
    client.history
  ].find(Array.isArray) || [];
  return sources.map((movement) => {
    const { direction, amount } = movementDirectionAndAmount(movement);
    const date = dateFromFirestoreValue(movement.createdAt || movement.date || movement.paidAt || movement.ticketAt || movement.updatedAt);
    return {
      id: movement.id || "",
      direction,
      amount,
      signed: direction === "credit" ? amount : -amount,
      amountLabel: formatMoney(amount),
      dateLabel: date ? clientDateLabel(date) : "-",
      timeValue: date?.getTime() || 0,
      label: firstText(movement.label, movement.title, movement.reason) || (direction === "credit" ? "Encaissement" : "Ticket mis sur compte"),
      detail: [movement.ticketLabel, movement.paymentMethodLabel, movement.note]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" · ")
    };
  });
}

// Le type (« debit » / « credit ») decide du sens ; le montant est toujours positif.
function movementDirectionAndAmount(movement = {}) {
  const type = String(movement.type || movement.kind || "").trim().toLowerCase();
  const raw = firstNumber(
    movement.amount,
    movement.total,
    movement.value,
    movement.balanceDelta,
    movement.delta,
    movement.remainingDue,
    movement.due
  );
  if (type === "credit" || type === "debit") return { direction: type, amount: Math.abs(raw ?? 0) };
  const debit = firstNumber(movement.debit, movement.debitAmount, movement.charge, movement.ticketTotal);
  const credit = firstNumber(movement.credit, movement.creditAmount, movement.payment, movement.paidAmount);
  if (raw === null) {
    const net = (credit || 0) - (debit || 0);
    return net >= 0 ? { direction: "credit", amount: net } : { direction: "debit", amount: -net };
  }
  // Ancien format sans type : montant positif = debit, negatif = credit.
  return raw >= 0 ? { direction: "debit", amount: raw } : { direction: "credit", amount: Math.abs(raw) };
}

// Solde cumule apres chaque mouvement (calcule dans l'ordre du temps), affiche du plus recent au plus ancien.
function withRunningBalance(movements) {
  let running = 0;
  const chronological = [...movements].sort((a, b) => a.timeValue - b.timeValue);
  chronological.forEach((movement) => {
    running = roundMoney(running + movement.signed);
    movement.runningValue = running;
    movement.runningLabel = formatMoney(running);
  });
  return chronological.reverse();
}

function clientJournalHtml(account) {
  return `
      <section class="client-journal">
        <div>
          <h3>Journal des mouvements</h3>
          <p>Debits ${escapeHtml(account.debitLabel)} · Credits ${escapeHtml(account.creditLabel)} · Solde (credits − debits) <strong class="is-${account.balanceTone}">${escapeHtml(account.balanceLabel)}</strong></p>
          ${account.movements.some((movement) => movement.id) ? `<p class="client-ledger-hint">Cliquez sur une ligne : un ticket affiche son contenu (avec le PDF a telecharger), un encaissement affiche son mode de reglement.</p>` : ""}
        </div>
        ${account.movements.length ? `
          <div class="client-ledger-table">
            <div class="client-ledger-row client-ledger-head"><span>Date</span><span>Libelle</span><span>Debit</span><span>Credit</span><span>Solde</span></div>
            ${account.movements.map((movement) => `
              <${movement.id ? `button type="button" data-client-movement="${escapeAttr(`${account.clientKey}/${movement.id}`)}" title="${movement.direction === "credit" ? "Voir le mode d'encaissement" : "Voir le ticket"}"` : "div"} class="client-ledger-row${movement.id ? " is-clickable" : ""}">
                <span>${escapeHtml(movement.dateLabel)}</span>
                <span><strong>${escapeHtml(movement.label)}</strong>${movement.detail ? `<small>${escapeHtml(movement.detail)}</small>` : ""}</span>
                <span class="is-debit">${movement.direction === "debit" ? escapeHtml(movement.amountLabel) : ""}</span>
                <span class="is-credit">${movement.direction === "credit" ? escapeHtml(movement.amountLabel) : ""}</span>
                <span class="client-ledger-balance is-${balanceTone(movement.runningValue)}">${escapeHtml(movement.runningLabel)}</span>
              </${movement.id ? "button" : "div"}>
            `).join("")}
          </div>
        ` : `<div class="client-account-empty">Aucun mouvement disponible pour ce client.</div>`}
      </section>
  `;
}


// ---------------------------------------------------------------------------
// Journal : detail d'un mouvement. Ligne « ticket » = ticket de caisse reconstitue
// depuis restaurants/{id}/room_orders/{ticketId} (avec PDF A4 + filigrane COPIE) ;
// ligne « encaissement » = mode de reglement, note et date.
// ---------------------------------------------------------------------------
const TICKET_WIDTH = 42;
const NL = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const EURO = String.fromCharCode(8364);
// Caracteres hors Latin-1 encodables en WinAnsi (police standard du PDF).
// 8239/8201 : espace fine insecable et espace fine, utilisees par Intl.NumberFormat("fr-FR", ...)
// entre les groupes de milliers (« 1 500,00 ») ; on les rend par l'espace insecable (160), deja geree
// correctement plus bas (>= 127, echappee en octal), WinAnsi n'ayant pas ce glyphe fin.
const PDF_WINANSI_EXTRA = new Map([[8364, 128], [8230, 133], [8216, 145], [8217, 146], [8220, 147], [8221, 148], [8226, 149], [8211, 150], [8212, 151], [8239, 160], [8201, 160]]);

function ticketMoney(value) {
  return `${roundMoney(value).toFixed(2).replace(".", ",")} ${EURO}`;
}

function ticketAmount(value) {
  return roundMoney(value).toFixed(2).replace(".", ",");
}

function ticketQuantity(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 1000) / 1000).replace(".", ",");
}

function ticketWrap(text, width) {
  const lines = [];
  let current = "";
  String(text || "").split(" ").filter(Boolean).forEach((word) => {
    let rest = word;
    while (rest.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (!current) current = rest;
    else if (current.length + 1 + rest.length <= width) current += ` ${rest}`;
    else {
      lines.push(current);
      current = rest;
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

// Texte a gauche, montant aligne a droite sur la derniere ligne.
function ticketRow(left, right, width = TICKET_WIDTH, indent = 0) {
  const amount = String(right || "");
  const pad = " ".repeat(indent);
  const parts = ticketWrap(left, Math.max(width - amount.length - 1 - indent, 8));
  const last = parts.pop();
  const rows = parts.map((part) => pad + part);
  rows.push(pad + last + " ".repeat(Math.max(1, width - indent - last.length - amount.length)) + amount);
  return rows;
}

function ticketLineTotal(line = {}) {
  const quantity = Number(line.quantity) || 0;
  const unit = Number(line.unitPrice) || 0;
  const supplements = (line.selectedSupplements || []).reduce((sum, item) => sum + (item?.includedInBasePrice ? 0 : Number(item?.unitPrice) || 0), 0);
  const type = String(line.lineType || "product");
  if (type === "productCancellation") return -((unit + supplements) * quantity);
  if (type === "supplementAddition") return supplements * quantity;
  if (type === "supplementRemoval") return -(supplements * quantity);
  return (unit + supplements) * quantity;
}

function ticketSupplementName(item = {}) {
  const name = String(item.name || "").trim();
  const prefix = String(item.categoryPrefix || "").trim();
  if (!prefix || name.toUpperCase().startsWith(`${prefix.toUpperCase()} `)) return name;
  return `${prefix} ${name}`;
}

function ticketDateLabel(value) {
  const date = dateFromFirestoreValue(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .format(date)
    .split(String.fromCharCode(8239))
    .join(" ");
}

// Le ticket est construit ligne par ligne (police a chasse fixe) : le meme contenu sert
// a l'apercu a l'ecran et au PDF, donc les deux sont identiques.
function buildTicketReceipt({ ticket, movement, restaurant, clientName }) {
  const width = TICKET_WIDTH;
  const lines = [];
  const add = (text = "", bold = false) => lines.push({ text: String(text), bold });
  const rule = (char = "-") => add(char.repeat(width));
  const center = (text, bold = false) => ticketWrap(text, width).forEach((part) => add(" ".repeat(Math.floor((width - part.length) / 2)) + part, bold));
  const row = (left, right, indent = 0, bold = false) => ticketRow(left, right, width, indent).forEach((text) => add(text, bold));

  center(String(firstText(restaurant?.name, restaurant?.tradeName, "Restaurant")).toUpperCase(), true);
  const street = cleanStreetLine(firstText(restaurant?.addressLine1, restaurant?.address), restaurant?.postalCode);
  if (street) center(street);
  const cityLine = [restaurant?.postalCode, restaurant?.city].filter(Boolean).join(" ");
  if (cityLine) center(cityLine);
  if (restaurant?.phone) center(`Tel : ${formatClientPhone(restaurant.phone)}`);
  const { siret, siren } = legalIdentifiers(restaurant);
  if (siret) center(`SIRET : ${formatSiret(siret)}`);
  else if (siren) center(`SIREN : ${formatSiret(siren)}`);
  if (restaurant?.vatNumber) center(`TVA : ${restaurant.vatNumber}`);
  const legalForm = restaurant?.legalForm && restaurant?.shareCapital ? `${restaurant.legalForm} au capital de ${restaurant.shareCapital}` : restaurant?.legalForm;
  const registry = [
    restaurant?.rcsCity && siren ? `RCS ${restaurant.rcsCity} ${formatSiret(siren)}` : "",
    restaurant?.apeCode ? `APE ${restaurant.apeCode}` : ""
  ].filter(Boolean).join(" - ");
  [legalForm, registry].filter(Boolean).forEach((legalLine) => center(legalLine));
  rule("=");

  const ticketLines = Array.isArray(ticket?.lines) ? ticket.lines : [];
  const payments = Array.isArray(ticket?.payments) ? ticket.payments : [];
  const number = ticket?.continuousNumber || ticket?.dailyNumber || "";
  row(number ? `Ticket n° ${number}` : "Ticket", firstText(ticket?.label, movement?.ticketLabel));
  const when = ticketDateLabel(ticket?.closedAt || ticket?.paidAt || payments[0]?.createdAt || movement?.createdAt);
  if (when) add(when);
  if (ticket?.dailyNumber && ticket?.continuousNumber) add(`N° du jour : ${ticket.dailyNumber}`);
  if (Number(ticket?.covers) > 0) add(`Couverts : ${ticket.covers}`);
  if (clientName) ticketWrap(`Client : ${clientName}`, width).forEach((part) => add(part));
  rule();

  let total = 0;
  const vatBuckets = new Map();
  ticketLines.forEach((line) => {
    const lineTotal = ticketLineTotal(line);
    total += lineTotal;
    const type = String(line.lineType || "product");
    const quantity = Number(line.quantity) || 0;
    const unit = Number(line.unitPrice) || 0;
    const title = type === "productCancellation" ? `Annulation - ${line.name || ""}`
      : type === "supplementAddition" ? "Ajout supplement"
        : type === "supplementRemoval" ? "Annulation supplement"
          : String(line.name || "Article");
    row(`${ticketQuantity(quantity)} x ${title}`, ticketAmount(lineTotal));
    if (type === "product" && quantity !== 1 && unit) add(`   ${ticketQuantity(quantity)} x ${ticketAmount(unit)}`);
    (line.selectedSupplements || []).forEach((item) => {
      const price = item?.includedInBasePrice ? 0 : Number(item?.unitPrice) || 0;
      row(`+ ${ticketSupplementName(item)}`, price ? ticketAmount(price) : "", 3);
    });
    (line.removedConstituents || []).forEach((item) => ticketWrap(`sans ${item?.name || item?.displayName || ""}`, width - 3).forEach((part) => add(`   ${part}`)));
    if (line.note) ticketWrap(`Note : ${line.note}`, width - 3).forEach((part) => add(`   ${part}`));
    const takeaway = String(line.saleMode || "").toLowerCase().includes("take");
    const rate = Number(takeaway ? line.vatTakeaway : line.vatOnSite);
    if (Number.isFinite(rate)) vatBuckets.set(rate, (vatBuckets.get(rate) || 0) + lineTotal);
  });
  if (!ticketLines.length) center("Detail du ticket indisponible");
  rule();

  total = roundMoney(total);
  const discount = ticketLines.length ? roundMoney(Math.min(Math.max(Number(ticket?.discountAmount) || 0, 0), Math.max(total, 0))) : 0;
  const payable = roundMoney(total - discount);
  if (ticketLines.length) {
    if (discount > 0) {
      row("Sous-total", ticketMoney(total));
      row(ticket?.discountLabel ? `Remise - ${ticket.discountLabel}` : "Remise", `-${ticketMoney(discount)}`);
    }
    row("TOTAL A PAYER", ticketMoney(payable), 0, true);
    rule();
  }

  const paymentRows = payments.length ? payments : (ticket?.isPaid && ticket?.paymentMethodLabel ? [{ methodLabel: ticket.paymentMethodLabel, amount: payable }] : []);
  if (paymentRows.length) {
    add("Reglements", true);
    paymentRows.forEach((payment) => {
      row(firstText(payment.methodLabel, payment.methodKey, "Reglement"), ticketMoney(payment.amount));
      if (Number(payment.tipAmount) > 0) row("Pourboire", ticketMoney(payment.tipAmount), 3);
      if (Number(payment.changeDue) > 0) row("Rendu monnaie", ticketMoney(payment.changeDue), 3);
    });
    rule();
  }

  if (vatBuckets.size && total > 0) {
    const factor = payable / total;
    add("TVA incluse", true);
    [...vatBuckets.entries()].sort((a, b) => a[0] - b[0]).forEach(([rate, amount]) => {
      const ttc = amount * factor;
      const vat = ttc - ttc / (1 + rate / 100);
      row(`TVA ${String(rate).replace(".", ",")} %  (HT ${ticketAmount(ttc - vat)})`, ticketMoney(vat));
    });
    rule();
  }

  if (movement) {
    add("Compte client", true);
    row(clientName ? `Mis sur le compte de ${clientName}` : "Mis sur le compte client", ticketMoney(movement.amount));
    if (movement.correctedAt) add(`Corrige le ${ticketDateLabel(movement.correctedAt)}`);
    rule();
  }
  center("Merci de votre visite");
  center("COPIE - non contractuelle");
  return lines;
}

function ticketPreviewHtml(lines) {
  return `<pre class="ticket-paper">${lines.map((line) => (line.bold ? `<b>${escapeHtml(line.text)}</b>` : escapeHtml(line.text))).join(NL)}</pre>`;
}

// --- PDF ecrit a la main : pas de librairie, polices standard, ticket centre sur une A4.
function pdfText(value) {
  let out = "";
  String(value || "").normalize("NFC").split("").forEach((char) => {
    const code = char.charCodeAt(0);
    let byte = null;
    if (code >= 32 && code < 127) byte = code;
    else if (code >= 160 && code <= 255) byte = code;
    else if (PDF_WINANSI_EXTRA.has(code)) byte = PDF_WINANSI_EXTRA.get(code);
    if (byte === null) out += "?";
    else if (byte === 40 || byte === 41 || byte === 92) out += BACKSLASH + char;
    else if (byte >= 127) out += BACKSLASH + byte.toString(8).padStart(3, "0");
    else out += char;
  });
  return out;
}

function pdfNumber(value) {
  return (Math.round(value * 100) / 100).toString();
}

// PDF A4 ecrit ligne par ligne (police a chasse fixe), avec filigrane diagonal optionnel :
// commun au ticket de caisse (filigrane « COPIE ») et au devis (sans filigrane, plus large).
function buildDocumentPdf(lines, { width = TICKET_WIDTH, fontSize = 9, watermarkText = "" } = {}) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const leading = fontSize * 1.28;
  const blockWidth = width * fontSize * 0.6;
  const padding = 18;
  const perPage = Math.max(20, Math.floor((pageHeight - 140) / leading));
  const chunks = [];
  for (let index = 0; index < lines.length; index += perPage) chunks.push(lines.slice(index, index + perPage));
  if (!chunks.length) chunks.push([]);

  // Filigrane en diagonale au centre de la page (Helvetica-Bold, gris clair).
  let watermark = "";
  if (watermarkText) {
    const markSize = 130;
    const markWidth = 3.112 * markSize;
    const markHeight = markSize * 0.36;
    const cos = Math.cos(Math.PI / 4);
    const sin = Math.sin(Math.PI / 4);
    const markX = pageWidth / 2 - (cos * markWidth / 2 - sin * markHeight);
    const markY = pageHeight / 2 - (sin * markWidth / 2 + cos * markHeight);
    watermark = `q 0.9 g BT /F3 ${markSize} Tf ${pdfNumber(cos)} ${pdfNumber(sin)} ${pdfNumber(-sin)} ${pdfNumber(cos)} ${pdfNumber(markX)} ${pdfNumber(markY)} Tm (${pdfText(watermarkText)}) Tj ET Q${NL}`;
  }

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontRegular = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  const fontBold = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>");
  const fontMark = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds = [];
  chunks.forEach((chunk) => {
    const blockHeight = chunk.length * leading;
    const left = (pageWidth - blockWidth) / 2;
    const top = chunks.length === 1 && watermarkText ? (pageHeight + blockHeight) / 2 : pageHeight - 60;
    let stream = watermark;
    if (watermarkText) stream += `q 0.75 G 0.6 w ${pdfNumber(left - padding)} ${pdfNumber(top - blockHeight - padding + leading * 0.3)} ${pdfNumber(blockWidth + padding * 2)} ${pdfNumber(blockHeight + padding * 2)} re S Q${NL}`;
    chunk.forEach((line, index) => {
      const y = top - (index + 1) * leading + leading * 0.3;
      stream += `BT /${line.bold ? "F2" : "F1"} ${fontSize} Tf ${pdfNumber(left)} ${pdfNumber(y)} Td (${pdfText(line.text)}) Tj ET${NL}`;
    });
    const contentId = addObject(`<< /Length ${stream.length} >>${NL}stream${NL}${stream}endstream`);
    pageIds.push(addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R /F3 ${fontMark} 0 R >> >> /Contents ${contentId} 0 R >>`));
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

  let pdf = `%PDF-1.4${NL}`;
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj${NL}${body}${NL}endobj${NL}`;
  });
  const xrefAt = pdf.length;
  pdf += `xref${NL}0 ${objects.length + 1}${NL}0000000000 65535 f ${NL}`;
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n ${NL}`;
  });
  pdf += `trailer${NL}<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>${NL}startxref${NL}${xrefAt}${NL}%%EOF${NL}`;
  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 255;
  return new Blob([bytes], { type: "application/pdf" });
}

function buildTicketPdf(lines) {
  return buildDocumentPdf(lines, { width: TICKET_WIDTH, fontSize: 9, watermarkText: "COPIE" });
}

function findClientMovement(root, key) {
  const [collectionName, clientId, movementId] = String(key || "").split("/");
  const source = root.clientExportSource?.customers;
  const client = (source?.customers || source || [])
    .find((item) => item.id === clientId && customerCollectionName(item.customerCollection) === collectionName);
  const movement = (client?.movements || []).find((item) => item.id === movementId);
  return { client, movement };
}

async function readRoomOrder(restaurantId, ticketId) {
  if (!ticketId) return null;
  const services = await getServices();
  const { doc, getDoc } = services.firestoreModule;
  const snap = await getDoc(doc(services.db, "restaurants", restaurantId, "room_orders", ticketId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function closeDashboardModal() {
  document.querySelector("[data-client-modal]")?.remove();
  document.removeEventListener("keydown", closeDashboardModalOnEscape);
}

function closeDashboardModalOnEscape(event) {
  if (event.key === "Escape") closeDashboardModal();
}

function showDashboardModal(title, bodyHtml, { wide = false } = {}) {
  closeDashboardModal();
  const overlay = document.createElement("div");
  overlay.className = "client-modal-overlay";
  overlay.dataset.clientModal = "";
  overlay.innerHTML = `
    <div class="client-modal${wide ? " is-wide" : ""}" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
      <header>
        <h3>${escapeHtml(title)}</h3>
        <button class="button-reset client-modal-close" type="button" data-client-modal-close aria-label="Fermer">&times;</button>
      </header>
      <div class="client-modal-body">${bodyHtml}</div>
    </div>
  `;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-client-modal-close]")) closeDashboardModal();
  });
  document.body.appendChild(overlay);
  document.addEventListener("keydown", closeDashboardModalOnEscape);
  overlay.querySelector("[data-client-modal-close]")?.focus();
  return overlay;
}

function paymentDetailHtml(client, movement) {
  const date = dateFromFirestoreValue(movement.createdAt);
  const rows = [
    ["Client", client.displayName || client.companyName || ""],
    ["Date", date ? ticketDateLabel(date) : ""],
    ["Montant encaisse", formatMoney(movement.amount)],
    ["Mode d'encaissement", firstText(movement.paymentMethodLabel, movement.paymentMethodKey) || "Non renseigne"],
    ["Note", movement.note || ""],
    ["Correction", movement.correctedAt ? `${ticketDateLabel(movement.correctedAt)}${movement.correctionReason ? ` - ${movement.correctionReason}` : ""}` : ""]
  ].filter(([, value]) => String(value || "").trim());
  return `<dl class="client-payment-detail">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}

async function openClientMovement(root, key) {
  const { client, movement } = findClientMovement(root, key);
  if (!client || !movement) return;
  const { direction, amount } = movementDirectionAndAmount(movement);
  const clientName = client.displayName || client.companyName || "";
  const flat = { ...movement, amount };
  if (direction === "credit") {
    showDashboardModal("Encaissement compte client", paymentDetailHtml(client, flat));
    return;
  }
  const overlay = showDashboardModal(movement.ticketLabel ? `Ticket ${movement.ticketLabel}` : "Ticket", `<p class="client-modal-wait">Chargement du ticket...</p>`);
  let ticket = null;
  let failure = "";
  try {
    ticket = await readRoomOrder(root.dataset.restaurantId, movement.ticketId);
  } catch (error) {
    failure = readableFirebaseError(error);
  }
  if (!document.body.contains(overlay)) return;
  const receipt = buildTicketReceipt({ ticket, movement: flat, restaurant: root.dashboardRestaurant || {}, clientName });
  const restaurantInfo = root.dashboardRestaurant || {};
  const notice = [
    ticket ? "" : failure || "Le detail de ce ticket n'est plus disponible : seul le montant mis sur le compte est affiche.",
    legalIdentifiers(restaurantInfo).siret && restaurantInfo.vatNumber ? "" : "SIRET et/ou n° de TVA non renseignes : completez la section Facturation du profil restaurant pour qu'ils figurent sur le ticket."
  ].filter(Boolean).map((line) => `<p class="client-modal-note">${escapeHtml(line)}</p>`).join("");
  overlay.querySelector(".client-modal-body").innerHTML = `${notice}<div class="ticket-sheet">${ticketPreviewHtml(receipt)}</div>`;
  const footer = document.createElement("footer");
  footer.innerHTML = `
    <button class="primary-btn button-reset" type="button" data-ticket-download>Telecharger le ticket (PDF)</button>
    <button class="outline-dark-btn button-reset" type="button" data-client-modal-close>Fermer</button>
  `;
  overlay.querySelector(".client-modal").appendChild(footer);
  footer.querySelector("[data-ticket-download]").addEventListener("click", () => {
    const stamp = String(ticket?.continuousNumber || ticket?.dailyNumber || movement.ticketId || "ticket").replace(/[^a-zA-Z0-9_-]/g, "_");
    downloadClientFile(buildTicketPdf(receipt), `ticket-${stamp}-copie.pdf`, "application/pdf");
  });
}


// ===========================================================================
// Devis : liste des devis emis (lecture partagee avec l'application, meme
// numerotation DEV-AAAAMMJJ-CODE-NNNN), telechargement PDF, et creation avec
// autocompletion des libelles du catalogue (comme le champ « Select or type »
// d'un logiciel de facturation).
// ===========================================================================
const QUOTE_MANAGER_ROLES = CLIENT_MANAGER_ROLES;
const QUOTE_STATUS_LABELS = {
  issued: "Emis",
  accepted: "Accepte",
  refused: "Refuse",
  expired: "Expire",
  transformed_to_order: "Transforme en commande"
};
const QUOTE_STATUS_TONES = {
  issued: "even",
  accepted: "credit",
  refused: "owed",
  expired: "owed",
  transformed_to_order: "credit"
};

function quoteStatusLabel(status) {
  return QUOTE_STATUS_LABELS[status] || "Emis";
}

async function listQuotes(restaurantId) {
  const services = await getServices();
  const { collection, getDocs } = services.firestoreModule;
  const snaps = await getDocs(collection(services.db, "restaurants", restaurantId, "quotes"));
  return snaps.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a, b) => quoteSortTime(b) - quoteSortTime(a));
}

function quoteSortTime(quote = {}) {
  return dateFromFirestoreValue(quote.createdAt || quote.issuedAt)?.getTime() || 0;
}

// Brouillons de devis : collection separee (restaurants/{id}/quote_drafts), invisible pour
// l'application (elle ne lit que quotes) et le compteur partage restaurants/{id}/counters/quotes
// n'est consomme qu'a la creation reelle du devis (voir createQuote), jamais pour un brouillon.
async function listQuoteDrafts(restaurantId) {
  const services = await getServices();
  const { collection, getDocs } = services.firestoreModule;
  const snaps = await getDocs(collection(services.db, "restaurants", restaurantId, "quote_drafts"));
  return snaps.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a, b) => quoteSortTime(b) - quoteSortTime(a));
}

async function saveQuoteDraft(restaurantId, draftId, payload, user) {
  const services = await getServices();
  const { doc, collection, serverTimestamp, setDoc } = services.firestoreModule;
  const isNew = !draftId;
  const draftRef = isNew
    ? doc(collection(services.db, "restaurants", restaurantId, "quote_drafts"))
    : doc(services.db, "restaurants", restaurantId, "quote_drafts", draftId);
  await setDoc(draftRef, {
    ...payload,
    ...(isNew ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: user?.uid || ""
  }, { merge: true });
  return draftRef.id;
}

async function deleteQuoteDraft(restaurantId, draftId) {
  if (!draftId) return;
  const services = await getServices();
  const { doc, deleteDoc } = services.firestoreModule;
  await deleteDoc(doc(services.db, "restaurants", restaurantId, "quote_drafts", draftId));
}

// Le code client du numero de devis : les 4 derniers chiffres du telephone, sinon 4 lettres
// du nom (completees par des X) ; identique au calcul fait par l'application.
function quoteClientCode(customer = {}) {
  const digits = String(customer.phone || "").replace(/[^0-9]/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  const letters = String(customer.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (letters.length >= 4) return letters.slice(0, 4);
  if (letters) return letters.padEnd(4, "X");
  return "CLNT";
}

function buildQuoteNumber(issuedAt, clientCode, sequence) {
  const year = issuedAt.getFullYear();
  const month = String(issuedAt.getMonth() + 1).padStart(2, "0");
  const day = String(issuedAt.getDate()).padStart(2, "0");
  return `DEV-${year}${month}${day}-${clientCode}-${String(sequence).padStart(4, "0")}`;
}

// Meme numerotation que l'application (compteur partage restaurants/{id}/counters/quotes) :
// un devis cree sur le site et un devis cree dans l'application ne se percutent jamais.
async function createQuote(restaurantId, payload, user) {
  const services = await getServices();
  const { doc, collection, runTransaction, serverTimestamp } = services.firestoreModule;
  const quoteRef = doc(collection(services.db, "restaurants", restaurantId, "quotes"));
  const counterRef = doc(services.db, "restaurants", restaurantId, "counters", "quotes");
  const now = new Date();
  const clientCode = quoteClientCode(payload.customer);
  await runTransaction(services.db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    const current = Number(counterSnap.data()?.next) || 1;
    const quoteNumber = buildQuoteNumber(now, clientCode, current);
    transaction.set(quoteRef, {
      quoteNumber,
      status: "issued",
      sourceTableId: quoteRef.id,
      sourceTable: payload.sourceTable,
      customer: payload.customer,
      issuedAt: now.toISOString(),
      validUntil: payload.validUntil,
      totalTtc: payload.totalTtc,
      eventLabel: payload.eventLabel || "",
      eventDate: payload.eventDate || null,
      depositAmount: payload.depositAmount || 0,
      conditions: payload.conditions || "",
      sourceQuoteId: "",
      orderHistory: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      restaurantId,
      quoteId: quoteRef.id,
      createdBy: user?.uid || "",
      createdByEmail: user?.email || "",
      createdAtServer: serverTimestamp(),
      updatedAtServer: serverTimestamp()
    });
    transaction.set(counterRef, { next: current + 1, updatedAt: now.toISOString(), updatedAtServer: serverTimestamp() }, { merge: true });
  });
  return quoteRef.id;
}

// Corrige un devis deja emis (client, lignes, montants...) sans toucher a son numero, sa date
// d'emission ni son historique : contrairement a une facture, un devis n'a pas de contrainte
// legale de numerotation continue, il reste modifiable tant qu'il n'a pas ete transforme en facture.
async function updateQuoteRecord(restaurantId, quoteId, payload, user) {
  const services = await getServices();
  const { doc, setDoc, serverTimestamp } = services.firestoreModule;
  const now = new Date();
  await setDoc(doc(services.db, "restaurants", restaurantId, "quotes", quoteId), {
    sourceTable: payload.sourceTable,
    customer: payload.customer,
    validUntil: payload.validUntil,
    totalTtc: payload.totalTtc,
    eventLabel: payload.eventLabel || "",
    eventDate: payload.eventDate || null,
    depositAmount: payload.depositAmount || 0,
    conditions: payload.conditions || "",
    updatedAt: now.toISOString(),
    updatedBy: user?.uid || "",
    updatedByEmail: user?.email || "",
    updatedAtServer: serverTimestamp()
  }, { merge: true });
}

async function updateQuoteStatus(restaurantId, quoteId, status) {
  const services = await getServices();
  const { doc, setDoc, serverTimestamp } = services.firestoreModule;
  await setDoc(doc(services.db, "restaurants", restaurantId, "quotes", quoteId), {
    status,
    updatedAt: new Date().toISOString(),
    updatedAtServer: serverTimestamp()
  }, { merge: true });
}

function requireQuotePermission(root) {
  const role = root.dataset.restaurantRole || "";
  if (!QUOTE_MANAGER_ROLES.includes(role)) throw new Error("La creation de devis est reservee aux managers, admins et owners.");
}

// ---- lignes d'un devis : forme compatible avec les lignes de commande de l'application,
// pour qu'un devis cree sur le site reste lisible dans l'application (et inversement).
function quoteLineTotal(line = {}) {
  return roundMoney((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0));
}

function quoteLinesTotals(lines) {
  let totalTtc = 0;
  const vatBuckets = new Map();
  lines.forEach((line) => {
    const lineTotal = quoteLineTotal(line);
    totalTtc += lineTotal;
    const rate = Number(line.vat) || 0;
    if (rate > 0 && lineTotal > 0) {
      const vatAmount = lineTotal - lineTotal / (1 + rate / 100);
      vatBuckets.set(rate, roundMoney((vatBuckets.get(rate) || 0) + vatAmount));
    }
  });
  return { totalTtc: roundMoney(totalTtc), vatBuckets };
}

function quoteLineToRoomOrderLine(line, index) {
  return {
    id: `site-${index}`,
    itemId: line.itemId || "",
    categoryId: line.categoryId || "",
    name: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    printerRoles: [],
    sendStatus: "pending",
    vatOnSite: line.vat,
    vatTakeaway: line.vat,
    constituents: [],
    selectedSupplements: [],
    removedConstituents: [],
    ingredientAdjustments: [],
    isPieceMode: false,
    categoryName: line.categoryName || "Devis",
    categoryPrefix: "",
    pieceSalePrefix: null,
    saleMode: "on_site",
    course: "suite",
    lineType: "product",
    note: null
  };
}

// ---- catalogue : liste aplatie depuis le menu du restaurant, utilisee pour l'autocompletion
// d'une ligne et pour le widget de selection multiple (openQuoteCatalogPicker).
function catalogItemsForQuotes(catalogMenu) {
  const categories = catalogMenu?.categories || [];
  const items = [];
  categories.forEach((category) => {
    // Vente a la piece : reglage de categorie (comme dans l'app POS), pas de l'article.
    // Categorie divisible en N parts egales, prix piece = prix entier / N.
    const divisibilityQuantity = Number(category.divisibilityQuantity) || 0;
    const pieceSaleEligible = category.isDivisibleInSupplements === true && category.pieceSaleEnabled === true && divisibilityQuantity > 0;
    const pieceSalePrefix = String(category.pieceSalePrefix || "").trim();
    (category.items || []).forEach((item) => {
      if (!item.name) return;
      const price = Number(item.price) || 0;
      items.push({
        name: item.name,
        price,
        vat: firstNumber(item.vatOnSite) ?? 10,
        itemId: item.id || "",
        categoryId: item.categoryId || category.id || "",
        categoryName: category.displayName || category.name || "",
        pieceSaleEligible,
        divisibilityQuantity,
        piecePrice: pieceSaleEligible ? roundMoney(price / divisibilityQuantity) : 0,
        pieceSalePrefix
      });
    });
  });
  return items;
}

function findCatalogItemByName(items, name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return null;
  return items.find((item) => item.name.trim().toLowerCase() === target) || null;
}

function groupCatalogItemsByCategory(items) {
  const groups = [];
  const byCategory = new Map();
  items.forEach((item) => {
    const key = item.categoryId || item.categoryName || "";
    if (!byCategory.has(key)) {
      const group = { categoryName: item.categoryName || "Autres", items: [] };
      byCategory.set(key, group);
      groups.push(group);
    }
    byCategory.get(key).items.push(item);
  });
  return groups;
}

// Widget de selection multiple (comme le catalogue de prise de commande de l'application) :
// permet d'ajouter plusieurs lignes de devis en une seule fois, avec une quantite par article.
// Le mode "Par piece" reprend le fonctionnement de l'app : categories divisibles en N parts,
// prix = prix entier / N, nom prefixe (voir catalogItemsForQuotes).
function quoteCatalogPickerHtml(items = [], pieceSaleEnabled = false) {
  const groups = groupCatalogItemsByCategory(items);
  const hasPieceEligibleItem = items.some((item) => item.pieceSaleEligible);
  const showPieceToggle = pieceSaleEnabled && hasPieceEligibleItem;
  return `
    <div class="quote-catalog-picker" data-quote-catalog-picker data-catalog-picker-mode="normal">
      ${showPieceToggle ? `
        <div class="quote-catalog-mode-toggle" data-catalog-picker-mode-toggle role="group" aria-label="Mode de vente">
          <button class="button-reset is-active" type="button" data-catalog-picker-mode-btn="normal">Normal</button>
          <button class="button-reset" type="button" data-catalog-picker-mode-btn="piece">Par piece</button>
        </div>
      ` : ""}
      <input type="search" class="quote-catalog-search" placeholder="Rechercher un article..." data-catalog-picker-search />
      <div class="quote-catalog-picker-groups" data-catalog-picker-groups>
        ${groups.length ? groups.map((group) => `
          <section class="quote-catalog-picker-group" data-catalog-picker-group>
            <h4>${escapeHtml(group.categoryName)}</h4>
            <div class="quote-catalog-picker-items">
              ${group.items.map((item) => `
                <div class="quote-catalog-picker-item" data-catalog-picker-item
                  data-catalog-picker-name="${escapeAttr(item.name.toLowerCase())}"
                  data-item-name="${escapeAttr(item.name)}" data-item-price="${item.price}" data-item-vat="${item.vat}"
                  data-item-id="${escapeAttr(item.itemId)}" data-item-category-id="${escapeAttr(item.categoryId)}" data-item-category-name="${escapeAttr(item.categoryName)}"
                  data-item-piece-eligible="${item.pieceSaleEligible ? "1" : ""}" data-item-piece-price="${item.piecePrice || 0}"
                  data-item-piece-qty="${item.divisibilityQuantity || 0}" data-item-piece-prefix="${escapeAttr(item.pieceSalePrefix || "")}">
                  <span class="quote-catalog-picker-name">
                    ${escapeHtml(item.name)}
                    ${item.pieceSaleEligible ? `<small class="quote-catalog-piece-tag">Vente a la piece (${item.divisibilityQuantity})</small>` : ""}
                  </span>
                  <span class="quote-catalog-picker-price" data-catalog-picker-item-price>${escapeHtml(formatMoney(item.price))}</span>
                  <div class="quote-catalog-picker-qty">
                    <button class="button-reset" type="button" data-catalog-picker-decrement aria-label="Diminuer la quantite">&minus;</button>
                    <input type="number" min="0" step="1" value="0" data-catalog-picker-qty />
                    <button class="button-reset" type="button" data-catalog-picker-increment aria-label="Augmenter la quantite">+</button>
                  </div>
                </div>
              `).join("")}
            </div>
          </section>
        `).join("") : `<p class="empty-state">Aucun article dans le catalogue.</p>`}
      </div>
      <div class="quote-catalog-picker-footer">
        <span data-catalog-picker-summary>Aucun article selectionne</span>
        <button class="primary-btn button-reset" type="button" data-catalog-picker-confirm>Ajouter au devis</button>
      </div>
    </div>
  `;
}

function openQuoteCatalogPicker(root, form, triggerRow) {
  if (!form) return;
  const overlay = showDashboardModal("Choisir dans le catalogue", quoteCatalogPickerHtml(root.quoteCatalogItems || [], root.quotePieceSaleEnabled === true), { wide: true });
  const picker = overlay.querySelector("[data-quote-catalog-picker]");
  const summary = picker.querySelector("[data-catalog-picker-summary]");
  const qtyInputs = [...picker.querySelectorAll("[data-catalog-picker-qty]")];

  const updateSummary = () => {
    const total = qtyInputs.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    summary.textContent = total > 0 ? `${total} article${total > 1 ? "s" : ""} selectionne${total > 1 ? "s" : ""}` : "Aucun article selectionne";
  };

  picker.querySelectorAll("[data-catalog-picker-item]").forEach((itemEl) => {
    const qtyInput = itemEl.querySelector("[data-catalog-picker-qty]");
    itemEl.querySelector("[data-catalog-picker-decrement]").addEventListener("click", () => {
      qtyInput.value = Math.max(0, (Number(qtyInput.value) || 0) - 1);
      updateSummary();
    });
    itemEl.querySelector("[data-catalog-picker-increment]").addEventListener("click", () => {
      qtyInput.value = (Number(qtyInput.value) || 0) + 1;
      updateSummary();
    });
    qtyInput.addEventListener("input", updateSummary);
  });

  picker.querySelectorAll("[data-catalog-picker-mode-btn]").forEach((modeBtn) => {
    modeBtn.addEventListener("click", () => {
      const mode = modeBtn.dataset.catalogPickerModeBtn;
      picker.dataset.catalogPickerMode = mode;
      picker.querySelectorAll("[data-catalog-picker-mode-btn]").forEach((btn) => btn.classList.toggle("is-active", btn === modeBtn));
      picker.querySelectorAll("[data-catalog-picker-item]").forEach((itemEl) => {
        const priceEl = itemEl.querySelector("[data-catalog-picker-item-price]");
        const isEligible = itemEl.dataset.itemPieceEligible === "1";
        if (mode === "piece" && isEligible) {
          priceEl.textContent = `${formatMoney(Number(itemEl.dataset.itemPiecePrice) || 0)} / piece`;
        } else {
          priceEl.textContent = formatMoney(Number(itemEl.dataset.itemPrice) || 0);
        }
      });
    });
  });

  picker.querySelector("[data-catalog-picker-search]").addEventListener("input", (event) => {
    const term = event.target.value.trim().toLowerCase();
    picker.querySelectorAll("[data-catalog-picker-group]").forEach((group) => {
      let visibleCount = 0;
      group.querySelectorAll("[data-catalog-picker-item]").forEach((itemEl) => {
        const match = !term || itemEl.dataset.catalogPickerName.includes(term);
        itemEl.classList.toggle("is-hidden", !match);
        if (match) visibleCount++;
      });
      group.classList.toggle("is-hidden", visibleCount === 0);
    });
  });

  picker.querySelector("[data-catalog-picker-confirm]").addEventListener("click", () => {
    const pieceMode = picker.dataset.catalogPickerMode === "piece";
    const selections = [...picker.querySelectorAll("[data-catalog-picker-item]")]
      .map((itemEl) => {
        const isPieceLine = pieceMode && itemEl.dataset.itemPieceEligible === "1";
        const prefix = itemEl.dataset.itemPiecePrefix || "";
        return {
          item: {
            name: isPieceLine && prefix ? `${prefix} ${itemEl.dataset.itemName}` : itemEl.dataset.itemName,
            price: isPieceLine ? Number(itemEl.dataset.itemPiecePrice) || 0 : Number(itemEl.dataset.itemPrice) || 0,
            vat: Number(itemEl.dataset.itemVat) || 0,
            itemId: itemEl.dataset.itemId,
            categoryId: itemEl.dataset.itemCategoryId,
            categoryName: itemEl.dataset.itemCategoryName
          },
          qty: Number(itemEl.querySelector("[data-catalog-picker-qty]").value) || 0
        };
      })
      .filter((entry) => entry.qty > 0);
    if (!selections.length) {
      closeDashboardModal();
      return;
    }
    const linesContainer = form.querySelector("[data-quote-lines]");
    const triggerIsEmpty = !!triggerRow && !triggerRow.querySelector("[data-quote-line-name]")?.value.trim();
    selections.forEach(({ item, qty }) => {
      linesContainer.insertAdjacentHTML("beforeend", quoteLineRowHtml(item, qty));
    });
    if (triggerIsEmpty) triggerRow.remove();
    linesContainer.querySelectorAll("[data-quote-line]").forEach(updateQuoteLineRow);
    updateQuoteFormTotals(form);
    closeDashboardModal();
  });

  updateSummary();
}

// ===========================================================================
// Affichage
// ===========================================================================
function quotesHtml(quotes = [], customerAccounts = {}, catalogMenu = null, role = "", drafts = []) {
  const customers = Array.isArray(customerAccounts) ? customerAccounts : customerAccounts.customers || [];
  const clients = customers.map(normalizeCustomerAccount);
  const canManage = QUOTE_MANAGER_ROLES.includes(role);
  const sorted = [...quotes].sort((a, b) => quoteSortTime(b) - quoteSortTime(a));
  const sortedDrafts = [...drafts].sort((a, b) => quoteSortTime(b) - quoteSortTime(a));
  return `
    <div class="quotes-section" data-quotes-section>
      <div class="quotes-list-view" data-quotes-list-view>
        <div class="quotes-head">
          <div>
            <h2>Devis</h2>
            <p>${sorted.length} devis emis.</p>
          </div>
          ${canManage ? `
            <button class="client-create-btn button-reset" type="button" data-quote-create-open>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6M9 15h6"/></svg>
              <strong>Nouveau devis</strong>
            </button>
          ` : ""}
        </div>
        ${canManage && sortedDrafts.length ? `
          <section class="quote-drafts" aria-labelledby="quote-drafts-title">
            <h3 id="quote-drafts-title">Brouillons <span class="quote-drafts-count">${sortedDrafts.length}</span></h3>
            <div class="quote-drafts-list">
              ${sortedDrafts.map((draft) => quoteDraftRowHtml(draft, clients)).join("")}
            </div>
          </section>
        ` : ""}
        ${sorted.length ? `
          <div class="client-ledger-table quotes-table">
            <div class="client-ledger-row client-ledger-head quote-row"><span>Numero</span><span>Client</span><span>Emis le</span><span>Valable jusqu'au</span><span>Total TTC</span><span>Statut</span></div>
            ${sorted.map((quote) => quoteRowHtml(quote)).join("")}
          </div>
        ` : `<div class="client-account-empty">Aucun devis pour le moment.</div>`}
      </div>
      ${canManage ? quoteCreatePageHtml(clients) : ""}
    </div>
  `;
}

function quoteDraftRowHtml(draft = {}, clients = []) {
  const client = clients.find((item) => item.id === draft.customerId);
  const clientName = client?.displayName || client?.companyName || "Client non choisi";
  const totalTtc = quoteLinesTotals(draft.lines || []).totalTtc;
  return `
    <div class="quote-draft-row" data-quote-draft-id="${escapeAttr(draft.id)}">
      <div class="quote-draft-info">
        <strong>${escapeHtml(draft.eventLabel || clientName)}</strong>
        <small>${escapeHtml([clientName, clientDateLabel(draft.updatedAt) ? `modifie le ${clientDateLabel(draft.updatedAt)}` : "", formatMoney(totalTtc)].filter(Boolean).join(" · "))}</small>
      </div>
      <div class="quote-draft-actions">
        <button class="outline-dark-btn button-reset" type="button" data-quote-draft-resume>Reprendre</button>
        <button class="button-reset quote-line-remove" type="button" data-quote-draft-delete aria-label="Supprimer le brouillon">&times;</button>
      </div>
    </div>
  `;
}

function quoteRowHtml(quote = {}) {
  const customer = quote.customer || {};
  const tone = QUOTE_STATUS_TONES[quote.status] || "even";
  return `
    <button type="button" class="client-ledger-row quote-row is-clickable" data-quote-row="${escapeAttr(quote.id)}">
      <span><strong>${escapeHtml(quote.quoteNumber || quote.id)}</strong></span>
      <span>${escapeHtml(customer.name || "Client non renseigne")}</span>
      <span>${escapeHtml(clientDateLabel(quote.issuedAt) || "-")}</span>
      <span>${escapeHtml(clientDateLabel(quote.validUntil) || "-")}</span>
      <span>${escapeHtml(formatMoney(quote.totalTtc))}</span>
      <span><span class="quote-status-badge is-${tone}">${escapeHtml(quoteStatusLabel(quote.status))}</span></span>
    </button>
  `;
}

// Un client choisi (ou cree a la volee) porte deja son nom/telephone/email/adresse/SIRET/TVA :
// pas besoin de les retaper, la fiche client fait foi. « Ajouter un client » ouvre le meme
// formulaire que l'onglet Comptes clients (customerFieldsHtml), dans une fenetre.
function quoteCoversLabelPreference() {
  return localStorage.getItem("poksolQuoteCoversLabel") === "Convives" ? "Convives" : "Couverts";
}

function quoteCreatePageHtml(clients = []) {
  const validUntil = new Date(Date.now() + 30 * 86400000);
  return `
    <section class="quote-create-page is-hidden" data-quote-create-page>
      <header class="client-detail-header">
        <button class="button-reset client-back-btn" type="button" data-quote-create-close aria-label="Retour aux devis">&larr;</button>
        <div>
          <span>Devis</span>
          <h2>Nouveau devis</h2>
        </div>
      </header>
      <form class="platform-form quote-form" data-dashboard-quote-form>
        <div class="quote-client-picker">
          ${quoteClientPickerFieldHtml(clients)}
          <button class="outline-dark-btn button-reset" type="button" data-quote-add-client>+ Ajouter un client</button>
        </div>
        <div class="quote-client-summary" data-quote-client-summary>${quoteClientSummaryHtml(null)}</div>

        <div class="form-grid">
          <label>Intitule de la prestation<input name="eventLabel" placeholder="Anniversaire, mariage, buffet d'entreprise..." /></label>
          <label>Date de l'evenement<input name="eventDate" type="date" /></label>
          <label>
            <select class="label-select" data-quote-covers-label>
              ${["Couverts", "Convives"].map((word) => `<option value="${word}" ${word === quoteCoversLabelPreference() ? "selected" : ""}>${word}</option>`).join("")}
            </select>
            <input name="covers" type="number" min="0" step="1" />
          </label>
          <label>Valable jusqu'au<input name="validUntil" type="date" value="${validUntil.toISOString().slice(0, 10)}" required /></label>
          <label>Acompte demande (EUR)<input name="depositAmount" type="number" min="0" step="0.01" /></label>
        </div>
        <label class="wide-field">Notes<textarea name="notes" rows="2"></textarea></label>

        <div class="quote-lines" data-quote-lines>
          <div class="quote-line-row quote-line-head"><span>Libelle</span><span>Qte</span><span>PU TTC</span><span>TVA</span><span>Total TTC</span><span></span></div>
          ${quoteLineRowHtml()}
        </div>
        <button class="outline-dark-btn button-reset" type="button" data-quote-add-line>+ Ajouter une ligne</button>

        <div class="quote-totals" data-quote-totals>
          <span>Total HT <strong data-quote-total-ht>0,00 &euro;</strong></span>
          <span>TVA <strong data-quote-total-vat>0,00 &euro;</strong></span>
          <span>Total TTC <strong data-quote-total-ttc>0,00 &euro;</strong></span>
        </div>

        <label class="wide-field">Conditions<textarea name="conditions" rows="3">Devis valable jusqu'a la date indiquee. Prix TTC.</textarea></label>
        <div class="quote-form-actions">
          <button class="outline-dark-btn button-reset" type="button" data-quote-preview>Previsualiser</button>
          <button class="outline-dark-btn button-reset" type="button" data-quote-save-draft>Enregistrer comme brouillon</button>
          <button class="primary-btn button-reset" type="submit">Creer le devis</button>
        </div>
        <small data-form-status></small>
      </form>
    </section>
  `;
}

function quoteClientOptionsHtml(clients = [], selectedId = "") {
  return `
    <option value="">${clients.length ? "Choisir un client..." : "Aucun client enregistre"}</option>
    ${clients.map((client) => `<option value="${escapeAttr(client.id)}" ${client.id === selectedId ? "selected" : ""}>${escapeHtml(client.displayName || client.companyName || "Client")}</option>`).join("")}
  `;
}

// Champ client "combobox" : un champ texte pour taper/filtrer (comme la recherche du widget
// catalogue), avec un <select> cache qui reste la source de verite pour tout le reste du code
// (applyQuoteClientSelection, submitQuoteForm/submitInvoiceForm, resumeQuoteDraft...). Choisir
// une suggestion met a jour le select et declenche son evenement "change" comme d'habitude.
function quoteClientComboboxOptionsHtml(clients = []) {
  return clients.map((client) => `
    <button type="button" class="button-reset quote-client-combobox-option" data-quote-client-option="${escapeAttr(client.id)}" data-quote-client-option-name="${escapeAttr((client.displayName || client.companyName || "Client").toLowerCase())}">
      ${escapeHtml(client.displayName || client.companyName || "Client")}
    </button>
  `).join("");
}

function quoteClientPickerFieldHtml(clients = [], selectedId = "") {
  const selected = clients.find((client) => client.id === selectedId);
  return `
    <div class="quote-client-select" data-quote-client-combo>
      <span class="field-label">Client</span>
      <div class="quote-client-combobox">
        <input type="text" class="quote-client-search" data-quote-client-search autocomplete="off"
          placeholder="${clients.length ? "Rechercher un client..." : "Aucun client enregistre"}"
          value="${escapeAttr(selected ? (selected.displayName || selected.companyName || "") : "")}" />
        <select data-quote-customer-select class="quote-client-select-hidden">
          ${quoteClientOptionsHtml(clients, selectedId)}
        </select>
        <div class="quote-client-combobox-list" data-quote-client-combobox-list hidden>
          ${quoteClientComboboxOptionsHtml(clients)}
        </div>
      </div>
    </div>
  `;
}

function quoteClientSummaryHtml(client) {
  if (!client) {
    return `<p class="quote-client-empty">Choisissez un client existant, ou ajoutez-en un avec le bouton ci-dessus.</p>`;
  }
  const rows = [
    client.phone ? escapeHtml(client.phone) : "",
    client.email ? escapeHtml(client.email) : "",
    client.address ? escapeHtml(client.address) : "",
    client.taxId ? `SIRET / fiscal : ${escapeHtml(client.taxId)}` : "",
    client.vatNumber ? `TVA : ${escapeHtml(client.vatNumber)}` : ""
  ].filter(Boolean);
  return `
    <strong>${escapeHtml(client.displayName || client.companyName || "Client")}</strong>
    ${rows.map((row) => `<span>${row}</span>`).join("")}
  `;
}

// Repercute le client choisi dans le formulaire (resume en lecture seule + champ de recherche).
function applyQuoteClientSelection(root, form) {
  const select = form.querySelector("[data-quote-customer-select]");
  const summary = form.querySelector("[data-quote-client-summary]");
  if (!select || !summary) return;
  const client = (root.quoteClients || []).find((item) => item.id === select.value) || null;
  summary.innerHTML = quoteClientSummaryHtml(client);
  const search = form.querySelector("[data-quote-client-search]");
  if (search) search.value = client ? (client.displayName || client.companyName || "") : "";
}

function filterQuoteClientCombobox(input, { openOnly = false } = {}) {
  const combo = input.closest("[data-quote-client-combo]");
  const list = combo?.querySelector("[data-quote-client-combobox-list]");
  if (!list) return;
  if (!openOnly) {
    const term = normalizeClientSearch(input.value);
    let visibleCount = 0;
    list.querySelectorAll("[data-quote-client-option]").forEach((option) => {
      const match = !term || normalizeClientSearch(option.dataset.quoteClientOptionName).includes(term);
      option.classList.toggle("is-hidden", !match);
      if (match) visibleCount += 1;
    });
  }
  list.hidden = false;
}

function selectQuoteClientOption(root, optionEl) {
  const combo = optionEl.closest("[data-quote-client-combo]");
  const select = combo?.querySelector("[data-quote-customer-select]");
  const list = combo?.querySelector("[data-quote-client-combobox-list]");
  if (!select) return;
  select.value = optionEl.dataset.quoteClientOption;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  if (list) list.hidden = true;
}

// « Ajouter un client » : le meme formulaire que Comptes clients, dans une fenetre. La fenetre
// est ajoutee hors de #dashboard-root (voir showDashboardModal), donc son propre gestionnaire
// de soumission est cable ici plutot que de compter sur la delegation du formulaire principal.
function openQuoteAddClient(root, form) {
  const overlay = showDashboardModal("Ajouter un client", `
    <form class="platform-form customer-account-form" data-dashboard-customer-form data-customer-type-scope data-customer-type="individual">
      ${customerFieldsHtml()}
      <button class="primary-btn button-reset" type="submit">Ajouter le client</button>
      <small data-form-status></small>
    </form>
  `);
  const inlineForm = overlay.querySelector("[data-dashboard-customer-form]");
  const status = inlineForm.querySelector("[data-form-status]");
  inlineForm.addEventListener("change", (event) => {
    if (event.target.matches("[data-customer-type-select]")) updateCustomerTypeScope(event.target);
  });
  inlineForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      requireClientPermission(root, "manage");
      status.textContent = "Enregistrement...";
      const restaurantId = root.dataset.restaurantId;
      const newId = await createCustomerAccount(restaurantId, inlineForm, currentUser);
      const newClient = normalizeCustomerAccount({ id: newId, customerCollection: "customers", ...customerAccountPayload(inlineForm), active: true });
      root.quoteClients = [...(root.quoteClients || []), newClient];
      closeDashboardModal();
      const select = form.querySelector("[data-quote-customer-select]");
      if (select) {
        select.innerHTML = quoteClientOptionsHtml(root.quoteClients, newClient.id);
        const combobox = form.querySelector("[data-quote-client-combobox-list]");
        if (combobox) combobox.innerHTML = quoteClientComboboxOptionsHtml(root.quoteClients);
        applyQuoteClientSelection(root, form);
      }
    } catch (error) {
      status.textContent = error?.code === "permission-denied"
        ? "Action refusee par Firestore : votre role ne permet pas cette operation."
        : (error.message || String(error));
    }
  });
}

function quoteLineRowHtml(item = null, qty = 1) {
  const price = item ? item.price : 0;
  const vat = item && [0, 5.5, 10, 20].includes(Number(item.vat)) ? Number(item.vat) : 10;
  const catalogAttrs = item
    ? ` data-catalog-item-id="${escapeAttr(item.itemId)}" data-catalog-category-id="${escapeAttr(item.categoryId)}" data-catalog-category-name="${escapeAttr(item.categoryName)}"`
    : "";
  return `
    <div class="quote-line-row" data-quote-line${catalogAttrs}>
      <div class="quote-line-name-field">
        <input type="text" placeholder="Nom de l'article ou texte libre" data-quote-line-name required value="${escapeAttr(item?.name || "")}" />
        <button class="button-reset quote-line-catalog-btn" type="button" data-quote-line-catalog aria-label="Choisir dans le catalogue">&#9662;</button>
      </div>
      <input type="number" min="0" step="1" value="${qty}" data-quote-line-qty />
      <input type="number" min="0" step="0.01" value="${price.toFixed(2)}" data-quote-line-price />
      <select data-quote-line-vat>
        ${[0, 5.5, 10, 20].map((rate) => `<option value="${rate}" ${rate === vat ? "selected" : ""}>${String(rate).replace(".", ",")} %</option>`).join("")}
      </select>
      <span data-quote-line-total>0,00 &euro;</span>
      <button class="button-reset quote-line-remove" type="button" data-quote-line-remove aria-label="Supprimer la ligne">&times;</button>
    </div>
  `;
}

function updateQuoteLineRow(row) {
  if (!row) return;
  const qty = Number(row.querySelector("[data-quote-line-qty]")?.value) || 0;
  const price = Number(row.querySelector("[data-quote-line-price]")?.value) || 0;
  const total = row.querySelector("[data-quote-line-total]");
  if (total) total.textContent = formatMoney(roundMoney(qty * price));
}

function updateQuoteFormTotals(form) {
  if (!form) return;
  const rows = [...form.querySelectorAll("[data-quote-line]")];
  const lines = rows.map((row) => ({
    quantity: Number(row.querySelector("[data-quote-line-qty]")?.value) || 0,
    unitPrice: Number(row.querySelector("[data-quote-line-price]")?.value) || 0,
    vat: Number(row.querySelector("[data-quote-line-vat]")?.value) || 0
  }));
  const { totalTtc, vatBuckets } = quoteLinesTotals(lines);
  const totalVat = roundMoney([...vatBuckets.values()].reduce((sum, value) => sum + value, 0));
  const totalHt = roundMoney(totalTtc - totalVat);
  const ht = form.querySelector("[data-quote-total-ht]");
  const vat = form.querySelector("[data-quote-total-vat]");
  const ttc = form.querySelector("[data-quote-total-ttc]");
  if (ht) ht.textContent = formatMoney(totalHt);
  if (vat) vat.textContent = formatMoney(totalVat);
  if (ttc) ttc.textContent = formatMoney(totalTtc);
}

function quoteFormLines(form) {
  return [...form.querySelectorAll("[data-quote-line]")].map((row) => ({
    name: row.querySelector("[data-quote-line-name]").value.trim(),
    quantity: Number(row.querySelector("[data-quote-line-qty]").value) || 0,
    unitPrice: Number(row.querySelector("[data-quote-line-price]").value) || 0,
    vat: Number(row.querySelector("[data-quote-line-vat]").value) || 0,
    itemId: row.dataset.catalogItemId || "",
    categoryId: row.dataset.catalogCategoryId || "",
    categoryName: row.dataset.catalogCategoryName || ""
  })).filter((line) => line.name && line.quantity > 0);
}

// Reunit ce que le formulaire "Nouveau devis" contient, sous une forme partagee par la
// creation reelle (submitQuoteForm), l'apercu PDF (previewQuoteFromForm) et l'enregistrement
// en brouillon (saveQuoteFormAsDraft) : evite de retaper trois fois la meme extraction du DOM.
function quotePayloadFromForm(root, form) {
  const lines = quoteFormLines(form);
  const { totalTtc } = quoteLinesTotals(lines);
  const data = new FormData(form);
  const customerId = form.querySelector("[data-quote-customer-select]")?.value || "";
  const selectedClient = (root.quoteClients || []).find((item) => item.id === customerId) || null;
  const customer = selectedClient ? {
    customerId: selectedClient.id,
    name: selectedClient.displayName || selectedClient.companyName || "",
    phone: selectedClient.phone || "",
    email: selectedClient.email || "",
    address: selectedClient.address || "",
    taxId: selectedClient.taxId || "",
    vatNumber: selectedClient.vatNumber || ""
  } : null;
  const eventDateValue = data.get("eventDate");
  const validUntilValue = data.get("validUntil");
  const now = new Date();
  const sourceTable = {
    label: String(data.get("eventLabel") || "").trim() || "Prestation",
    displayNumber: 0,
    continuousNumber: 0,
    dailyNumber: 0,
    sessionKind: "room",
    serviceKey: "",
    dailyNumberScope: "",
    covers: Number(data.get("covers")) || 0,
    lines: lines.map(quoteLineToRoomOrderLine),
    isOpen: false,
    isClosed: false,
    revision: 0,
    tableNote: String(data.get("notes") || "").trim() || null,
    customerName: customer?.name || null,
    customerPhone: customer?.phone || null,
    quotedAt: now.toISOString()
  };
  return {
    lines,
    totalTtc,
    customerId,
    customer,
    sourceTable,
    validUntil: validUntilValue ? new Date(`${validUntilValue}T12:00:00`).toISOString() : new Date(now.getTime() + 30 * 86400000).toISOString(),
    eventLabel: String(data.get("eventLabel") || "").trim(),
    eventDate: eventDateValue ? new Date(`${eventDateValue}T12:00:00`).toISOString() : null,
    covers: Number(data.get("covers")) || 0,
    depositAmount: Number(data.get("depositAmount")) || 0,
    notes: String(data.get("notes") || "").trim(),
    conditions: String(data.get("conditions") || "").trim()
  };
}

async function submitQuoteForm(root, form, restaurantId) {
  const payload = quotePayloadFromForm(root, form);
  if (!payload.lines.length) throw new Error("Ajoutez au moins une ligne avec un libelle et une quantite.");
  if (!payload.customer) throw new Error("Choisissez un client (ou ajoutez-en un avec le bouton « Ajouter un client »).");
  const editQuoteId = form.dataset.editQuoteId;
  if (editQuoteId) {
    await updateQuoteRecord(restaurantId, editQuoteId, {
      customer: payload.customer,
      sourceTable: payload.sourceTable,
      totalTtc: payload.totalTtc,
      validUntil: payload.validUntil,
      eventLabel: payload.eventLabel,
      eventDate: payload.eventDate,
      depositAmount: payload.depositAmount,
      conditions: payload.conditions
    }, currentUser);
    delete form.dataset.editQuoteId;
    return;
  }
  await createQuote(restaurantId, {
    customer: payload.customer,
    sourceTable: payload.sourceTable,
    totalTtc: payload.totalTtc,
    validUntil: payload.validUntil,
    eventLabel: payload.eventLabel,
    eventDate: payload.eventDate,
    depositAmount: payload.depositAmount,
    conditions: payload.conditions
  }, currentUser);
  if (form.dataset.draftId) await deleteQuoteDraft(restaurantId, form.dataset.draftId).catch(() => {});
}

async function previewQuoteFromForm(root, form) {
  const payload = quotePayloadFromForm(root, form);
  if (!payload.lines.length) throw new Error("Ajoutez au moins une ligne avec un libelle et une quantite.");
  const restaurant = root.dashboardRestaurant || {};
  const previewQuote = {
    quoteNumber: "APERCU",
    status: "issued",
    issuedAt: new Date().toISOString(),
    customer: payload.customer || { name: "Client non renseigne" },
    sourceTable: payload.sourceTable,
    totalTtc: payload.totalTtc,
    validUntil: payload.validUntil,
    eventLabel: payload.eventLabel,
    eventDate: payload.eventDate,
    depositAmount: payload.depositAmount,
    conditions: payload.conditions
  };
  const overlay = showDashboardModal("Apercu du devis", `<p class="client-modal-wait">Generation du PDF...</p>`, { wide: true });
  const blob = await buildQuotePdf(previewQuote, restaurant);
  if (!document.body.contains(overlay)) return;
  const objectUrl = URL.createObjectURL(blob);
  overlay.dataset.quoteObjectUrl = objectUrl;
  overlay.querySelector(".client-modal-body").innerHTML = `<div class="quote-preview"><iframe src="${escapeAttr(objectUrl)}" title="Apercu du devis"></iframe></div>`;
  const cleanupUrl = () => URL.revokeObjectURL(objectUrl);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-client-modal-close]")) cleanupUrl();
  });
  const footer = document.createElement("footer");
  footer.innerHTML = `
    <p class="quote-preview-note">Apercu uniquement : le devis n'est pas encore enregistre, le vrai numero sera attribue a la creation.</p>
    <button class="outline-dark-btn button-reset" type="button" data-client-modal-close>Fermer l'apercu</button>
  `;
  overlay.querySelector(".client-modal").appendChild(footer);
}

async function saveQuoteFormAsDraft(root, form) {
  const status = form.querySelector("[data-form-status]");
  const payload = quotePayloadFromForm(root, form);
  if (!payload.lines.length && !payload.customer && !payload.eventLabel) {
    if (status) status.textContent = "Rien a enregistrer pour l'instant.";
    return;
  }
  const restaurantId = root.dataset.restaurantId;
  if (status) status.textContent = "Enregistrement du brouillon...";
  const draftId = await saveQuoteDraft(restaurantId, form.dataset.draftId || "", {
    customerId: payload.customerId,
    eventLabel: payload.eventLabel,
    eventDate: payload.eventDate,
    covers: payload.covers,
    validUntil: payload.validUntil,
    depositAmount: payload.depositAmount,
    notes: payload.notes,
    conditions: payload.conditions,
    lines: payload.lines
  }, currentUser);
  form.dataset.draftId = draftId;
  if (status) status.textContent = "Brouillon enregistre. Vous pouvez continuer a modifier ce devis.";
}

// Reouvre la page de creation et pre-remplit tout depuis un brouillon (restaurants/{id}/quote_drafts).
// "Nouveau devis" repart toujours d'une page vierge, meme si un brouillon etait en cours
// d'edition juste avant (sinon on risquerait d'ecraser ce brouillon en cliquant "Creer").
function resetQuoteCreateForm(root, form) {
  if (!form) return;
  delete form.dataset.draftId;
  delete form.dataset.editQuoteId;
  form.reset();
  applyQuoteClientSelection(root, form);
  const linesContainer = form.querySelector("[data-quote-lines]");
  linesContainer.querySelectorAll("[data-quote-line]").forEach((row) => row.remove());
  linesContainer.insertAdjacentHTML("beforeend", quoteLineRowHtml());
  updateQuoteFormTotals(form);
  const status = form.querySelector("[data-form-status]");
  if (status) status.textContent = "";
  const submitBtn = form.querySelector("button[type=submit]");
  if (submitBtn) submitBtn.textContent = form.matches("[data-dashboard-invoice-form]") ? "Creer la facture" : "Creer le devis";
}

function resumeQuoteDraft(root, draftId) {
  const draft = (root.quoteDrafts || []).find((item) => item.id === draftId);
  if (!draft) return;
  const section = document.querySelector("[data-quotes-section]");
  const form = section?.querySelector("[data-dashboard-quote-form]");
  if (!form) return;
  form.dataset.draftId = draft.id;
  form.querySelector("[data-quote-customer-select]").value = draft.customerId || "";
  applyQuoteClientSelection(root, form);
  form.elements.eventLabel.value = draft.eventLabel || "";
  form.elements.eventDate.value = draft.eventDate ? String(draft.eventDate).slice(0, 10) : "";
  form.elements.covers.value = draft.covers || "";
  form.elements.validUntil.value = draft.validUntil ? String(draft.validUntil).slice(0, 10) : "";
  form.elements.depositAmount.value = draft.depositAmount || "";
  form.elements.notes.value = draft.notes || "";
  form.elements.conditions.value = draft.conditions || "";
  const linesContainer = form.querySelector("[data-quote-lines]");
  linesContainer.querySelectorAll("[data-quote-line]").forEach((row) => row.remove());
  const lines = Array.isArray(draft.lines) && draft.lines.length ? draft.lines : [null];
  lines.forEach((line) => {
    linesContainer.insertAdjacentHTML("beforeend", quoteLineRowHtml(line ? {
      name: line.name,
      price: Number(line.unitPrice) || 0,
      vat: Number(line.vat) || 0,
      itemId: line.itemId || "",
      categoryId: line.categoryId || "",
      categoryName: line.categoryName || ""
    } : null, line ? Number(line.quantity) || 1 : 1));
  });
  linesContainer.querySelectorAll("[data-quote-line]").forEach(updateQuoteLineRow);
  updateQuoteFormTotals(form);
  section.querySelector("[data-quotes-list-view]")?.classList.add("is-hidden");
  section.querySelector("[data-quote-create-page]")?.classList.remove("is-hidden");
}

// Corrige un devis deja emis : reouvre la page de creation, pre-remplie depuis le devis reel
// (pas un brouillon), et bascule submitQuoteForm en mode mise a jour via editQuoteId.
function openQuoteEditForm(root, quote) {
  const section = document.querySelector("[data-quotes-section]");
  const form = section?.querySelector("[data-dashboard-quote-form]");
  if (!form) return;
  delete form.dataset.draftId;
  form.dataset.editQuoteId = quote.id;
  form.querySelector("[data-quote-customer-select]").value = quote.customer?.customerId || "";
  applyQuoteClientSelection(root, form);
  form.elements.eventLabel.value = quote.eventLabel || "";
  form.elements.eventDate.value = quote.eventDate ? String(quote.eventDate).slice(0, 10) : "";
  form.elements.covers.value = quote.sourceTable?.covers || "";
  form.elements.validUntil.value = quote.validUntil ? String(quote.validUntil).slice(0, 10) : "";
  form.elements.depositAmount.value = quote.depositAmount || "";
  form.elements.notes.value = quote.sourceTable?.tableNote || "";
  form.elements.conditions.value = quote.conditions || "";
  const linesContainer = form.querySelector("[data-quote-lines]");
  linesContainer.querySelectorAll("[data-quote-line]").forEach((row) => row.remove());
  const lines = Array.isArray(quote.sourceTable?.lines) && quote.sourceTable.lines.length ? quote.sourceTable.lines : [null];
  lines.forEach((line) => {
    linesContainer.insertAdjacentHTML("beforeend", quoteLineRowHtml(line ? {
      name: line.name,
      price: Number(line.unitPrice) || 0,
      vat: Number(line.vatOnSite) || 0,
      itemId: line.itemId || "",
      categoryId: line.categoryId || "",
      categoryName: line.categoryName || ""
    } : null, line ? Number(line.quantity) || 1 : 1));
  });
  linesContainer.querySelectorAll("[data-quote-line]").forEach(updateQuoteLineRow);
  updateQuoteFormTotals(form);
  const submitBtn = form.querySelector("button[type=submit]");
  if (submitBtn) submitBtn.textContent = "Enregistrer les modifications";
  const status = form.querySelector("[data-form-status]");
  if (status) status.textContent = "";
  section.querySelector("[data-quotes-list-view]")?.classList.add("is-hidden");
  section.querySelector("[data-quote-create-page]")?.classList.remove("is-hidden");
}

// ===========================================================================
// Detail d'un devis : apercu (meme rendu que le PDF) et telechargement.
// ===========================================================================
function quoteDefaultConditions(restaurant = {}) {
  const terms = String(restaurant.paymentTerms || "").trim();
  const notice = String(restaurant.invoiceLegalNotice || "").trim();
  return ["Devis valable jusqu'a la date indiquee. Prix TTC.", terms, notice].filter(Boolean).join(NL);
}

// ===========================================================================
// PDF du devis : mise en page proche de celle de l'application (Helvetica
// proportionnelle, encadres Client/Prestation/Conditions, tableau borde avec
// en-tete grise), plutot que le rendu "ticket" en police a chasse fixe.
// Le logo du restaurant (documentLogoUrl en priorite) est incorpore en pixels ;
// si aucun logo n'est disponible, le nom du restaurant en gras le remplace.
// ===========================================================================

// Largeurs Helvetica standard (unites pour 1000, table Adobe AFM), codes 32-126.
const HELVETICA_WIDTHS = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191, 40: 333, 41: 333,
  42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556,
  52: 556, 53: 556, 54: 556, 55: 556, 56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584,
  62: 584, 63: 556, 64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778,
  82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 278,
  92: 278, 93: 278, 94: 469, 95: 556, 96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556,
  102: 278, 103: 556, 104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556, 118: 500, 119: 722,
  120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334, 126: 584
};
const HELVETICA_BOLD_WIDTHS = {
  32: 278, 33: 333, 34: 474, 35: 556, 36: 556, 37: 889, 38: 722, 39: 238, 40: 333, 41: 333,
  42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556,
  52: 556, 53: 556, 54: 556, 55: 556, 56: 556, 57: 556, 58: 333, 59: 333, 60: 584, 61: 584,
  62: 584, 63: 611, 64: 975, 65: 722, 66: 722, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 556, 75: 722, 76: 611, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778,
  82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 333,
  92: 278, 93: 333, 94: 584, 95: 556, 96: 333, 97: 556, 98: 611, 99: 556, 100: 611, 101: 556,
  102: 333, 103: 611, 104: 611, 105: 278, 106: 278, 107: 556, 108: 278, 109: 889, 110: 611,
  111: 611, 112: 611, 113: 611, 114: 389, 115: 556, 116: 333, 117: 611, 118: 556, 119: 778,
  120: 556, 121: 556, 122: 500, 123: 389, 124: 280, 125: 389, 126: 584
};

// Un caractere accentue reprend la chasse de sa lettre de base (tres proche en Helvetica) ;
// l'Euro a une chasse fixe connue.
function glyphWidth(char, bold) {
  const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  const code = char.charCodeAt(0);
  if (table[code] != null) return table[code];
  if (code === 8364) return 556;
  const base = char.normalize("NFD").charCodeAt(0);
  if (table[base] != null) return table[base];
  return bold ? 611 : 556;
}

function pdfTextWidth(text, bold = false, size = 10) {
  return [...String(text)].reduce((sum, char) => sum + glyphWidth(char, bold), 0) * size / 1000;
}

// Retour a la ligne par largeur reelle (et non plus par nombre de caracteres).
function wrapProportional(text, maxWidth, bold = false, size = 10) {
  const words = String(text || "").split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const attempt = current ? `${current} ${word}` : word;
    if (!current || pdfTextWidth(attempt, bold, size) <= maxWidth) current = attempt;
    else {
      lines.push(current);
      current = word;
    }
  });
  if (current || !lines.length) lines.push(current);
  return lines;
}

// Compresse des octets bruts en deflate/zlib (compatible /Filter /FlateDecode d'un PDF),
// via l'API native du navigateur : pas de librairie de compression a embarquer.
async function deflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Un octet == un caractere (code 0-255) : c'est ainsi que build() assemble le PDF final
// avant de le reconvertir en octets. Par blocs pour eviter la limite d'arguments de
// String.fromCharCode sur un tableau de plusieurs dizaines de milliers d'octets.
function bytesToBinaryString(bytes) {
  let out = "";
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    out += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return out;
}

// Logo du restaurant : recupere l'image, la redimensionne (canvas) a la taille d'affichage
// pour garder le PDF leger, et renvoie ses pixels RGB (+ alpha si l'image en a un). Echoue
// silencieusement (repli sur le nom du restaurant en gras) si le fichier est inaccessible.
async function loadLogoPixels(url, maxWidth = 170, maxHeight = 64) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`logo HTTP ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(maxWidth / bitmap.width, maxHeight / bitmap.height, 1);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  let hasAlpha = false;
  for (let pixel = 0, offset = 0; pixel < width * height; pixel += 1, offset += 4) {
    rgb[pixel * 3] = data[offset];
    rgb[pixel * 3 + 1] = data[offset + 1];
    rgb[pixel * 3 + 2] = data[offset + 2];
    alpha[pixel] = data[offset + 3];
    if (data[offset + 3] !== 255) hasAlpha = true;
  }
  return { width, height, rgb, alpha: hasAlpha ? alpha : null };
}

// ---------------------------------------------------------------------------
// Un petit « canvas » PDF multi-pages : texte Helvetica positionne au point pres,
// rectangles/lignes vectoriels. Les blocs (voir buildQuotePdf) sont dessines dans
// l'ordre ; un bloc qui ne tient plus sur la page en cours passe sur une nouvelle page.
// ---------------------------------------------------------------------------
class PdfDocument {
  constructor({ pageWidth = 595.28, pageHeight = 841.89, margin = 40 } = {}) {
    this.pageWidth = pageWidth;
    this.pageHeight = pageHeight;
    this.margin = margin;
    this.pages = [];
    this._images = [];
    this.newPage();
  }

  newPage() {
    this.stream = "";
    this.pages.push(this);
    this.y = this.pageHeight - this.margin;
    if (!this._pages) this._pages = [];
    this._pages.push({ stream: "" });
    this._current = this._pages[this._pages.length - 1];
  }

  get contentWidth() {
    return this.pageWidth - this.margin * 2;
  }

  // Fait passer a une nouvelle page si la hauteur demandee ne tient plus au-dessus de la marge.
  ensureSpace(height) {
    if (this.y - height < this.margin) this.newPage();
  }

  emit(op) {
    this._current.stream += `${op}${NL}`;
  }

  text(x, yTop, value, { bold = false, size = 10, color = "0 0 0" } = {}) {
    const y = this.pageHeight - yTop - size * 0.8;
    this.emit(`q ${color} rg BT /${bold ? "FB" : "FR"} ${pdfNumber(size)} Tf ${pdfNumber(x)} ${pdfNumber(y)} Td (${pdfText(value)}) Tj ET Q`);
  }

  textRight(xRight, yTop, value, options = {}) {
    this.text(xRight - pdfTextWidth(value, options.bold, options.size ?? 10), yTop, value, options);
  }

  // Ecrit un paragraphe (retour a la ligne automatique) et renvoie la hauteur utilisee.
  paragraph(x, yTop, maxWidth, value, { bold = false, size = 10, leading = size * 1.32 } = {}) {
    const lines = wrapProportional(value, maxWidth, bold, size);
    lines.forEach((line, index) => this.text(x, yTop + index * leading, line, { bold, size }));
    return lines.length * leading;
  }

  rect(x, yTop, width, height, { stroke = "0.6 0.6 0.6", fill = null, lineWidth = 0.6 } = {}) {
    const y = this.pageHeight - yTop - height;
    let op = "q ";
    if (fill) op += `${fill} rg `;
    if (stroke) op += `${stroke} RG ${pdfNumber(lineWidth)} w `;
    op += `${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(width)} ${pdfNumber(height)} re `;
    op += fill && stroke ? "B" : fill ? "f" : "S";
    this.emit(`${op} Q`);
  }

  line(x1, yTop1, x2, yTop2, { color = "0.6 0.6 0.6", lineWidth = 0.6 } = {}) {
    const y1 = this.pageHeight - yTop1;
    const y2 = this.pageHeight - yTop2;
    this.emit(`q ${color} RG ${pdfNumber(lineWidth)} w ${pdfNumber(x1)} ${pdfNumber(y1)} m ${pdfNumber(x2)} ${pdfNumber(y2)} l S Q`);
  }

  // Enregistre une image (pixels RGB deja extraits, canal alpha optionnel) et renvoie le
  // nom de ressource a passer a image(). La compression (FlateDecode) se fait ici, une
  // seule fois, plutot qu'a chaque usage.
  async addImageAsset({ width, height, rgb, alpha }) {
    const name = `Im${this._images.length + 1}`;
    let smaskName = null;
    if (alpha) {
      smaskName = `${name}Mask`;
      this._images.push({ name: smaskName, width, height, colorSpace: "DeviceGray", data: await deflateBytes(alpha), isMask: true });
    }
    this._images.push({ name, width, height, colorSpace: "DeviceRGB", data: await deflateBytes(rgb), smaskName });
    return name;
  }

  image(x, yTop, width, height, name) {
    const y = this.pageHeight - yTop - height;
    this.emit(`q ${pdfNumber(width)} 0 0 ${pdfNumber(height)} ${pdfNumber(x)} ${pdfNumber(y)} cm /${name} Do Q`);
  }

  // ---- assemblage final ----
  build() {
    const objects = [];
    const addObject = (body) => {
      objects.push(body);
      return objects.length;
    };
    const catalogId = addObject("");
    const pagesId = addObject("");
    const fontRegular = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBold = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const imageObjIds = {};
    this._images.forEach((image) => {
      const smaskRef = !image.isMask && image.smaskName ? ` /SMask ${imageObjIds[image.smaskName]} 0 R` : "";
      const id = addObject(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.colorSpace} /BitsPerComponent 8 /Filter /FlateDecode${smaskRef} /Length ${image.data.length} >>${NL}stream${NL}${bytesToBinaryString(image.data)}${NL}endstream`);
      imageObjIds[image.name] = id;
    });
    const xObjectDict = Object.keys(imageObjIds).length
      ? ` /XObject << ${Object.entries(imageObjIds).map(([name, id]) => `/${name} ${id} 0 R`).join(" ")} >>`
      : "";
    const pageIds = this._pages.map((page) => {
      const contentId = addObject(`<< /Length ${page.stream.length} >>${NL}stream${NL}${page.stream}endstream`);
      return addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << /FR ${fontRegular} 0 R /FB ${fontBold} 0 R >>${xObjectDict} >> /Contents ${contentId} 0 R >>`);
    });
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

    let pdf = `%PDF-1.4${NL}`;
    const offsets = [];
    objects.forEach((body, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj${NL}${body}${NL}endobj${NL}`;
    });
    const xrefAt = pdf.length;
    pdf += `xref${NL}0 ${objects.length + 1}${NL}0000000000 65535 f ${NL}`;
    offsets.forEach((offset) => {
      pdf += `${String(offset).padStart(10, "0")} 00000 n ${NL}`;
    });
    pdf += `trailer${NL}<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>${NL}startxref${NL}${xrefAt}${NL}%%EOF${NL}`;
    const bytes = new Uint8Array(pdf.length);
    for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 255;
    return new Blob([bytes], { type: "application/pdf" });
  }
}

// Encadre avec titre en gras : renvoie la hauteur reellement utilisee.
function measurePdfBoxHeight(width, bodyLines, { minHeight = 60, pad = 10, size = 9.5 } = {}) {
  const leading = size * 1.35;
  const innerWidth = width - pad * 2;
  const wrapped = bodyLines.flatMap((line) => wrapProportional(line, innerWidth, false, size));
  return Math.max(minHeight, pad * 2 + leading * (1.3 + wrapped.length));
}

// Plus petite taille (parmi PDF_BOX_FIT_SIZES) qui fait tenir bodyLines sous maxHeight,
// pour des encadres a hauteur plafonnee (ex. Mentions legales / Coordonnees bancaires cote a
// cote sur une facture) sans jamais faire disparaitre de texte : si meme la plus petite taille
// deborde encore, on la garde quand meme plutot que de tronquer des mentions legales.
const PDF_BOX_FIT_SIZES = [9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5];

function fitPdfBoxSize(width, bodyLines, maxHeight, opts = {}) {
  for (const size of PDF_BOX_FIT_SIZES) {
    const height = measurePdfBoxHeight(width, bodyLines, { ...opts, size });
    if (height <= maxHeight) return size;
  }
  return PDF_BOX_FIT_SIZES[PDF_BOX_FIT_SIZES.length - 1];
}

function pdfBox(doc, x, yTop, width, title, bodyLines, { minHeight = 60, pad = 10, size = 9.5, height: fixedHeight } = {}) {
  const leading = size * 1.35;
  const innerWidth = width - pad * 2;
  const wrapped = bodyLines.flatMap((line) => wrapProportional(line, innerWidth, false, size));
  const height = fixedHeight || Math.max(minHeight, pad * 2 + leading * (1.3 + wrapped.length));
  doc.rect(x, yTop, width, height, { stroke: "0.6 0.6 0.6" });
  doc.text(x + pad, yTop + pad, title, { bold: true, size: 10.5 });
  wrapped.forEach((line, index) => doc.text(x + pad, yTop + pad + leading * (1.3 + index), line, { size }));
  return height;
}

function quoteHeaderLegalLine(restaurant) {
  const { siret, siren } = legalIdentifiers(restaurant);
  const identifier = siret ? `SIRET : ${formatSiret(siret)}` : siren ? `SIREN : ${formatSiret(siren)}` : "";
  return [identifier, restaurant.vatNumber ? `TVA : ${restaurant.vatNumber}` : ""].filter(Boolean).join("   -   ");
}

// ---------------------------------------------------------------------------
// Construit le PDF complet du devis (une page, plus si le contenu deborde).
// ---------------------------------------------------------------------------
async function buildQuotePdf(quote = {}, restaurant = {}) {
  const doc = new PdfDocument();
  const margin = doc.margin;
  const width = doc.contentWidth;
  const customer = quote.customer || {};
  const table = quote.sourceTable || {};
  const lineItems = Array.isArray(table.lines) ? table.lines.filter((line) => Number(line.quantity) !== 0) : [];

  // -- en-tete : logo (ou nom en gras a defaut) a gauche, "DEVIS" + reperes a droite --
  // Le logo "documentLogoUrl" (variante pour fond blanc) est prioritaire sur le logo
  // general du restaurant, souvent clair/blanc et pense pour un fond fonce.
  let logo = null;
  const logoUrl = firstText(restaurant.documentLogoUrl, restaurant.logoUrl);
  if (logoUrl) {
    try {
      const pixels = await loadLogoPixels(logoUrl);
      logo = { name: await doc.addImageAsset(pixels), width: pixels.width, height: pixels.height };
    } catch (error) {
      logo = null; // logo inaccessible (reseau, image invalide...) : repli sur le nom en gras
    }
  }
  const restaurantName = String(firstText(restaurant.name, restaurant.tradeName, "Restaurant"));
  const headerTop = doc.pageHeight - doc.y;
  let leftY;
  if (logo) {
    doc.image(margin, headerTop, logo.width, logo.height, logo.name);
    leftY = headerTop + logo.height + 8;
  } else {
    doc.text(margin, headerTop, restaurantName, { bold: true, size: 16 });
    leftY = headerTop + 22;
  }
  const street = cleanStreetLine(firstText(restaurant.addressLine1, restaurant.address), restaurant.postalCode);
  const addressLines = [
    street,
    [restaurant.postalCode, restaurant.city].filter(Boolean).join(" "),
    restaurant.phone ? `Tel : ${formatClientPhone(restaurant.phone)}` : "",
    restaurant.email || "",
    quoteHeaderLegalLine(restaurant)
  ].filter(Boolean);
  addressLines.forEach((line) => {
    doc.text(margin, leftY, line, { size: 9.5 });
    leftY += 13.5;
  });

  const rightX = doc.pageWidth - margin;
  doc.textRight(rightX, doc.pageHeight - doc.y, "DEVIS", { bold: true, size: 22 });
  let rightY = doc.pageHeight - doc.y + 26;
  [
    quote.quoteNumber || "",
    `Date : ${clientDateLabel(quote.issuedAt) || "-"}`,
    `Valable jusqu'au : ${clientDateLabel(quote.validUntil) || "-"}`
  ].forEach((line) => {
    doc.textRight(rightX, rightY, line, { size: 10 });
    rightY += 14;
  });

  doc.y -= Math.max(leftY, rightY) - (doc.pageHeight - doc.y) + 6;
  doc.line(margin, doc.pageHeight - doc.y, doc.pageWidth - margin, doc.pageHeight - doc.y);
  doc.y -= 16;

  // -- client / prestation, cote a cote --
  const boxWidth = (width - 16) / 2;
  const clientLines = [
    customer.name || "Client non renseigne",
    customer.phone ? `Tel. : ${formatClientPhone(customer.phone)}` : "",
    customer.email ? `Email : ${customer.email}` : "",
    customer.address || "",
    customer.taxId ? `SIRET/Fiscal : ${customer.taxId}` : "",
    customer.vatNumber ? `TVA : ${customer.vatNumber}` : ""
  ].filter(Boolean);
  const prestationLines = [
    quote.eventLabel || (table.sessionKind === "takeaway" ? "A emporter" : "Sur place"),
    quote.eventDate ? `Date evenement : ${clientDateLabel(quote.eventDate)}` : "",
    table.covers ? `${table.covers} couverts` : "",
    table.tableNote ? `Note : ${table.tableNote}` : ""
  ].filter(Boolean);
  doc.ensureSpace(100);
  const topY = doc.pageHeight - doc.y;
  const clientHeight = pdfBox(doc, margin, topY, boxWidth, "Client", clientLines);
  const prestationHeight = pdfBox(doc, margin + boxWidth + 16, topY, boxWidth, "Prestation", prestationLines);
  doc.y -= Math.max(clientHeight, prestationHeight) + 20;

  // -- tableau des articles --
  const columns = [
    { label: "Designation", width: width * 0.46, align: "left" },
    { label: "Qte", width: width * 0.09, align: "right" },
    { label: "PU TTC", width: width * 0.15, align: "right" },
    { label: "TVA", width: width * 0.10, align: "right" },
    { label: "Total TTC", width: width * 0.20, align: "right" }
  ];
  const colX = [margin];
  columns.forEach((column, index) => colX.push(colX[index] + column.width));

  const drawTableHeader = () => {
    doc.ensureSpace(30);
    const rowTop = doc.pageHeight - doc.y;
    doc.rect(margin, rowTop, width, 22, { stroke: "0.6 0.6 0.6", fill: "0.91 0.91 0.91" });
    columns.forEach((column, index) => {
      const cellX = colX[index];
      if (column.align === "right") doc.textRight(cellX + column.width - 6, rowTop + 6, column.label, { bold: true, size: 9.5 });
      else doc.text(cellX + 6, rowTop + 6, column.label, { bold: true, size: 9.5 });
    });
    doc.y -= 22;
  };
  drawTableHeader();

  let total = 0;
  const vatBuckets = new Map();
  lineItems.forEach((line) => {
    const quantity = Number(line.quantity) || 0;
    const unitPrice = Number(line.unitPrice) || 0;
    const rate = Number(line.vatOnSite) || 0;
    const lineTotal = roundMoney(quantity * unitPrice);
    total += lineTotal;
    if (rate > 0 && lineTotal > 0) {
      const vatAmount = lineTotal - lineTotal / (1 + rate / 100);
      vatBuckets.set(rate, roundMoney((vatBuckets.get(rate) || 0) + vatAmount));
    }
    const cells = [line.name || "Article", ticketQuantity(quantity), ticketAmount(unitPrice), `${String(rate).replace(".", ",")}%`, ticketAmount(lineTotal)];
    const wrapped = wrapProportional(cells[0], columns[0].width - 12, false, 9.5);
    const rowHeight = Math.max(20, wrapped.length * 13 + 6);
    doc.ensureSpace(rowHeight);
    if (doc.pageHeight - doc.y === doc.margin) drawTableHeader();
    const rowTop = doc.pageHeight - doc.y;
    doc.rect(margin, rowTop, width, rowHeight, { stroke: "0.75 0.75 0.75", lineWidth: 0.4 });
    wrapped.forEach((part, index) => doc.text(colX[0] + 6, rowTop + 6 + index * 13, part, { size: 9.5 }));
    cells.slice(1).forEach((value, index) => {
      const column = columns[index + 1];
      doc.textRight(colX[index + 1] + column.width - 6, rowTop + 6, value, { size: 9.5 });
    });
    doc.y -= rowHeight;
  });
  if (!lineItems.length) {
    doc.ensureSpace(24);
    const rowTop = doc.pageHeight - doc.y;
    doc.rect(margin, rowTop, width, 22, { stroke: "0.75 0.75 0.75", lineWidth: 0.4 });
    doc.text(margin + 6, rowTop + 6, "Aucune ligne", { size: 9.5 });
    doc.y -= 22;
  }
  doc.y -= 16;

  // -- totaux, alignes a droite comme le tableau --
  total = roundMoney(total);
  const totalVat = roundMoney([...vatBuckets.values()].reduce((sum, value) => sum + value, 0));
  const totalHt = roundMoney(total - totalVat);
  const deposit = roundMoney(Number(quote.depositAmount) || 0);
  const totalsRows = [
    ...[...vatBuckets.entries()].sort((a, b) => a[0] - b[0]).map(([rate, amount]) => [`TVA ${String(rate).replace(".", ",")} %`, formatMoney(amount), false]),
    ["Total HT", formatMoney(totalHt), false],
    ["Total TTC", formatMoney(total), true]
  ];
  if (deposit > 0) {
    totalsRows.push(["Acompte demande", formatMoney(deposit), false]);
    totalsRows.push(["Reste a regler", formatMoney(roundMoney(Math.max(total - deposit, 0))), true]);
  }
  const totalsWidth = 230;
  const totalsX = doc.pageWidth - margin - totalsWidth;
  doc.ensureSpace(totalsRows.length * 15 + 6);
  totalsRows.forEach(([label, value, bold]) => {
    const rowTop = doc.pageHeight - doc.y;
    doc.text(totalsX, rowTop, label, { bold, size: 10 });
    doc.textRight(doc.pageWidth - margin, rowTop, value, { bold, size: 10 });
    doc.y -= 15;
  });
  doc.y -= 12;

  // -- conditions --
  const conditions = String(quote.conditions || "").trim() || quoteDefaultConditions(restaurant);
  doc.ensureSpace(60);
  let boxTop = doc.pageHeight - doc.y;
  let boxHeight = pdfBox(doc, margin, boxTop, width, "Conditions", conditions.split(NL));
  doc.y -= boxHeight + 16;

  // -- coordonnees bancaires --
  if (restaurant.iban || restaurant.bic) {
    const holder = firstText(restaurant.legalName, restaurant.tradeName, restaurant.name);
    const bankLines = [
      holder ? `Titulaire : ${holder}` : "",
      restaurant.iban ? `IBAN : ${restaurant.iban}` : "",
      restaurant.bic ? `BIC : ${restaurant.bic}` : "",
      `Reference a indiquer : ${quote.quoteNumber || ""}`
    ].filter(Boolean);
    doc.ensureSpace(60);
    boxTop = doc.pageHeight - doc.y;
    boxHeight = pdfBox(doc, margin, boxTop, width, "Coordonnees bancaires", bankLines);
    doc.y -= boxHeight + 16;
  }

  // -- signature --
  doc.ensureSpace(40);
  const signTop = doc.pageHeight - doc.y;
  doc.text(margin, signTop, "Bon pour accord", { size: 10 });
  doc.textRight(doc.pageWidth - margin, signTop, "Signature client", { size: 10 });

  return doc.build();
}

async function openQuoteDetail(root, quoteId) {
  const quote = (root.dashboardQuotes || []).find((item) => item.id === quoteId);
  if (!quote) return;
  const restaurant = root.dashboardRestaurant || {};
  const canManage = QUOTE_MANAGER_ROLES.includes(root.dataset.restaurantRole || "");
  const overlay = showDashboardModal(
    `Devis ${quote.quoteNumber || ""}`,
    `<p class="client-modal-wait">Generation du PDF...</p>`,
    { wide: true }
  );
  const blob = await buildQuotePdf(quote, restaurant);
  if (!document.body.contains(overlay)) return;
  const objectUrl = URL.createObjectURL(blob);
  overlay.dataset.quoteObjectUrl = objectUrl;
  overlay.querySelector(".client-modal-body").innerHTML = `<div class="quote-preview"><iframe src="${escapeAttr(objectUrl)}" title="Apercu du devis"></iframe></div>`;
  const cleanupUrl = () => URL.revokeObjectURL(objectUrl);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-client-modal-close]")) cleanupUrl();
  });
  const footer = document.createElement("footer");
  footer.innerHTML = `
    ${canManage ? `
      <label class="quote-status-inline">Statut
        <select data-quote-status-select>
          ${Object.keys(QUOTE_STATUS_LABELS).map((status) => `<option value="${status}" ${quote.status === status ? "selected" : ""}>${QUOTE_STATUS_LABELS[status]}</option>`).join("")}
        </select>
      </label>
    ` : ""}
    ${canManage && !quote.invoiceId ? `<button class="outline-dark-btn button-reset" type="button" data-quote-edit>Modifier</button>` : ""}
    ${canManage ? (quote.invoiceId
      ? `<span class="quote-preview-note">Facture ${escapeHtml(quote.invoiceNumber || "")} deja creee.</span>`
      : `<button class="outline-dark-btn button-reset" type="button" data-quote-to-invoice>Transformer en facture</button>`
    ) : ""}
    <button class="primary-btn button-reset" type="button" data-quote-download>Telecharger en PDF</button>
    <button class="outline-dark-btn button-reset" type="button" data-client-modal-close>Fermer</button>
  `;
  overlay.querySelector(".client-modal").appendChild(footer);
  footer.querySelector("[data-quote-download]").addEventListener("click", () => {
    const stamp = String(quote.quoteNumber || quote.id).replace(/[^a-zA-Z0-9_-]/g, "_");
    downloadClientFile(blob, `${stamp}.pdf`, "application/pdf");
  });
  footer.querySelector("[data-quote-status-select]")?.addEventListener("change", async (event) => {
    await updateQuoteStatus(root.dataset.restaurantId, quote.id, event.target.value);
    cleanupUrl();
    closeDashboardModal();
    await renderDashboard(root, currentUser, root.dataset.restaurantId, "quotes");
  });
  footer.querySelector("[data-quote-to-invoice]")?.addEventListener("click", () => {
    openQuoteToInvoiceConfirm(root, quote);
  });
  footer.querySelector("[data-quote-edit]")?.addEventListener("click", () => {
    cleanupUrl();
    closeDashboardModal();
    openQuoteEditForm(root, quote);
  });
}

// ===========================================================================
// Factures : creees uniquement depuis un devis existant (bouton "Transformer
// en facture" dans le detail du devis). Numerotation legale sequentielle,
// propre (compteur restaurants/{id}/counters/invoices, amorce sur le
// "Prochain numero de facture" configure dans poket-access.html > Facturation),
// jamais reutilisee par l'application (aucun equivalent cote app a ce jour).
// ===========================================================================
const INVOICE_STATUS_LABELS = {
  issued: "Emise",
  paid: "Payee",
  cancelled: "Annulee"
};
const INVOICE_STATUS_TONES = {
  issued: "even",
  paid: "credit",
  cancelled: "owed"
};

function invoiceStatusLabel(status) {
  return INVOICE_STATUS_LABELS[status] || "Emise";
}

async function listInvoices(restaurantId) {
  const services = await getServices();
  const { collection, getDocs } = services.firestoreModule;
  const snaps = await getDocs(collection(services.db, "restaurants", restaurantId, "invoices"));
  return snaps.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a, b) => invoiceSortTime(b) - invoiceSortTime(a));
}

function invoiceSortTime(invoice = {}) {
  return dateFromFirestoreValue(invoice.createdAt || invoice.issuedAt)?.getTime() || 0;
}

// Brouillons de facture : meme principe que les brouillons de devis (restaurants/{id}/quote_drafts) :
// collection separee (restaurants/{id}/invoice_drafts), aucun numero de facture consomme
// tant que ce n'est pas transforme en facture reelle (voir createInvoiceRecord).
async function listInvoiceDrafts(restaurantId) {
  const services = await getServices();
  const { collection, getDocs } = services.firestoreModule;
  const snaps = await getDocs(collection(services.db, "restaurants", restaurantId, "invoice_drafts"));
  return snaps.docs.map((snap) => ({ id: snap.id, ...snap.data() })).sort((a, b) => invoiceSortTime(b) - invoiceSortTime(a));
}

async function saveInvoiceDraft(restaurantId, draftId, payload, user) {
  const services = await getServices();
  const { doc, collection, serverTimestamp, setDoc } = services.firestoreModule;
  const isNew = !draftId;
  const draftRef = isNew
    ? doc(collection(services.db, "restaurants", restaurantId, "invoice_drafts"))
    : doc(services.db, "restaurants", restaurantId, "invoice_drafts", draftId);
  await setDoc(draftRef, {
    ...payload,
    ...(isNew ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: user?.uid || ""
  }, { merge: true });
  return draftRef.id;
}

async function deleteInvoiceDraft(restaurantId, draftId) {
  if (!draftId) return;
  const services = await getServices();
  const { doc, deleteDoc } = services.firestoreModule;
  await deleteDoc(doc(services.db, "restaurants", restaurantId, "invoice_drafts", draftId));
}

// Coeur partage par les deux chemins de creation (depuis un devis, ou directe) : reserve le
// prochain numero (compteur restaurants/{id}/counters/invoices, amorce sur restaurant.nextInvoiceNumber
// tant qu'aucune facture n'existe), ecrit la facture, et tague le devis d'origine s'il y en a un.
async function createInvoiceRecord(restaurantId, invoiceData, restaurant, user) {
  const services = await getServices();
  const { doc, collection, runTransaction, serverTimestamp } = services.firestoreModule;
  const invoiceRef = doc(collection(services.db, "restaurants", restaurantId, "invoices"));
  const counterRef = doc(services.db, "restaurants", restaurantId, "counters", "invoices");
  const now = new Date();
  const prefix = String(restaurant.invoicePrefix || "FAC").trim() || "FAC";
  const seed = Number(restaurant.nextInvoiceNumber) || 1;
  let invoiceNumber = "";
  await runTransaction(services.db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    const current = counterSnap.exists() ? Number(counterSnap.data()?.next) || seed : seed;
    invoiceNumber = `${prefix}-${String(current).padStart(4, "0")}`;
    transaction.set(invoiceRef, {
      invoiceNumber,
      status: "issued",
      quoteId: invoiceData.quoteId || "",
      quoteNumber: invoiceData.quoteNumber || "",
      customer: invoiceData.customer,
      sourceTable: invoiceData.sourceTable,
      totalTtc: invoiceData.totalTtc,
      eventLabel: invoiceData.eventLabel || "",
      eventDate: invoiceData.eventDate || null,
      depositAmount: invoiceData.depositAmount || 0,
      conditions: invoiceData.conditions || "",
      issuedAt: now.toISOString(),
      dueDate: invoiceData.dueDate,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      restaurantId,
      invoiceId: invoiceRef.id,
      createdBy: user?.uid || "",
      createdByEmail: user?.email || "",
      createdAtServer: serverTimestamp(),
      updatedAtServer: serverTimestamp()
    });
    transaction.set(counterRef, { next: current + 1, updatedAt: now.toISOString(), updatedAtServer: serverTimestamp() }, { merge: true });
    if (invoiceData.quoteId) {
      transaction.set(doc(services.db, "restaurants", restaurantId, "quotes", invoiceData.quoteId), {
        invoiceId: invoiceRef.id,
        invoiceNumber,
        invoicedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        updatedAtServer: serverTimestamp()
      }, { merge: true });
    }
  });
  return { id: invoiceRef.id, invoiceNumber };
}

async function createInvoiceFromQuote(restaurantId, quote, restaurant, dueDate, user) {
  return createInvoiceRecord(restaurantId, {
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber || "",
    customer: quote.customer,
    sourceTable: quote.sourceTable,
    totalTtc: quote.totalTtc,
    eventLabel: quote.eventLabel || "",
    eventDate: quote.eventDate || null,
    depositAmount: quote.depositAmount || 0,
    conditions: quote.conditions || "",
    dueDate
  }, restaurant, user);
}

// Facture creee directement (sans devis) : meme formulaire que "Nouveau devis" (client,
// lignes, catalogue, totaux reutilises via quotePayloadFromForm), plus une echeance.
async function submitInvoiceForm(root, form, restaurantId) {
  const payload = quotePayloadFromForm(root, form);
  if (!payload.lines.length) throw new Error("Ajoutez au moins une ligne avec un libelle et une quantite.");
  if (!payload.customer) throw new Error("Choisissez un client (ou ajoutez-en un avec le bouton « Ajouter un client »).");
  const dueDateValue = new FormData(form).get("dueDate");
  if (!dueDateValue) throw new Error("Indiquez une date d'echeance.");
  const restaurant = root.dashboardRestaurant || {};
  await createInvoiceRecord(restaurantId, {
    customer: payload.customer,
    sourceTable: payload.sourceTable,
    totalTtc: payload.totalTtc,
    eventLabel: payload.eventLabel,
    eventDate: payload.eventDate,
    depositAmount: payload.depositAmount,
    conditions: payload.conditions,
    dueDate: new Date(`${dueDateValue}T12:00:00`).toISOString()
  }, restaurant, currentUser);
  if (form.dataset.draftId) await deleteInvoiceDraft(restaurantId, form.dataset.draftId).catch(() => {});
}

async function saveInvoiceFormAsDraft(root, form) {
  const status = form.querySelector("[data-form-status]");
  const payload = quotePayloadFromForm(root, form);
  const dueDateValue = new FormData(form).get("dueDate");
  if (!payload.lines.length && !payload.customer && !payload.eventLabel) {
    if (status) status.textContent = "Rien a enregistrer pour l'instant.";
    return;
  }
  const restaurantId = root.dataset.restaurantId;
  if (status) status.textContent = "Enregistrement du brouillon...";
  const draftId = await saveInvoiceDraft(restaurantId, form.dataset.draftId || "", {
    customerId: payload.customerId,
    eventLabel: payload.eventLabel,
    eventDate: payload.eventDate,
    covers: payload.covers,
    dueDate: dueDateValue ? new Date(`${dueDateValue}T12:00:00`).toISOString() : null,
    depositAmount: payload.depositAmount,
    notes: payload.notes,
    conditions: payload.conditions,
    lines: payload.lines
  }, currentUser);
  form.dataset.draftId = draftId;
  if (status) status.textContent = "Brouillon enregistre. Vous pouvez continuer a modifier cette facture.";
}

// Reouvre la page de creation et pre-remplit tout depuis un brouillon (restaurants/{id}/invoice_drafts).
function resumeInvoiceDraft(root, draftId) {
  const draft = (root.invoiceDrafts || []).find((item) => item.id === draftId);
  if (!draft) return;
  const section = document.querySelector("[data-invoices-section]");
  const form = section?.querySelector("[data-dashboard-invoice-form]");
  if (!form) return;
  form.dataset.draftId = draft.id;
  form.querySelector("[data-quote-customer-select]").value = draft.customerId || "";
  applyQuoteClientSelection(root, form);
  form.elements.eventLabel.value = draft.eventLabel || "";
  form.elements.eventDate.value = draft.eventDate ? String(draft.eventDate).slice(0, 10) : "";
  form.elements.covers.value = draft.covers || "";
  form.elements.dueDate.value = draft.dueDate ? String(draft.dueDate).slice(0, 10) : "";
  form.elements.depositAmount.value = draft.depositAmount || "";
  form.elements.notes.value = draft.notes || "";
  form.elements.conditions.value = draft.conditions || "";
  const linesContainer = form.querySelector("[data-quote-lines]");
  linesContainer.querySelectorAll("[data-quote-line]").forEach((row) => row.remove());
  const lines = Array.isArray(draft.lines) && draft.lines.length ? draft.lines : [null];
  lines.forEach((line) => {
    linesContainer.insertAdjacentHTML("beforeend", quoteLineRowHtml(line ? {
      name: line.name,
      price: Number(line.unitPrice) || 0,
      vat: Number(line.vat) || 0,
      itemId: line.itemId || "",
      categoryId: line.categoryId || "",
      categoryName: line.categoryName || ""
    } : null, line ? Number(line.quantity) || 1 : 1));
  });
  linesContainer.querySelectorAll("[data-quote-line]").forEach(updateQuoteLineRow);
  updateQuoteFormTotals(form);
  section.querySelector("[data-invoices-list-view]")?.classList.add("is-hidden");
  section.querySelector("[data-invoice-create-page]")?.classList.remove("is-hidden");
}

// Comme previewQuoteFromForm : PDF genere a la volee depuis le formulaire, rien n'est
// enregistre ni numerote (le vrai numero de facture n'est reserve qu'a la creation reelle).
async function previewInvoiceFromForm(root, form) {
  const payload = quotePayloadFromForm(root, form);
  if (!payload.lines.length) throw new Error("Ajoutez au moins une ligne avec un libelle et une quantite.");
  const dueDateValue = new FormData(form).get("dueDate");
  const restaurant = root.dashboardRestaurant || {};
  const previewInvoice = {
    invoiceNumber: "APERCU",
    status: "issued",
    issuedAt: new Date().toISOString(),
    dueDate: dueDateValue ? new Date(`${dueDateValue}T12:00:00`).toISOString() : null,
    customer: payload.customer || { name: "Client non renseigne" },
    sourceTable: payload.sourceTable,
    totalTtc: payload.totalTtc,
    eventLabel: payload.eventLabel,
    eventDate: payload.eventDate,
    depositAmount: payload.depositAmount,
    conditions: payload.conditions
  };
  const overlay = showDashboardModal("Apercu de la facture", `<p class="client-modal-wait">Generation du PDF...</p>`, { wide: true });
  const blob = await buildInvoicePdf(previewInvoice, restaurant);
  if (!document.body.contains(overlay)) return;
  const objectUrl = URL.createObjectURL(blob);
  overlay.dataset.invoiceObjectUrl = objectUrl;
  overlay.querySelector(".client-modal-body").innerHTML = `<div class="quote-preview"><iframe src="${escapeAttr(objectUrl)}" title="Apercu de la facture"></iframe></div>`;
  const cleanupUrl = () => URL.revokeObjectURL(objectUrl);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-client-modal-close]")) cleanupUrl();
  });
  const footer = document.createElement("footer");
  footer.innerHTML = `
    <p class="quote-preview-note">Apercu uniquement : la facture n'est pas encore enregistree, le vrai numero sera attribue a la creation.</p>
    <button class="outline-dark-btn button-reset" type="button" data-client-modal-close>Fermer l'apercu</button>
  `;
  overlay.querySelector(".client-modal").appendChild(footer);
}

async function updateInvoiceStatus(restaurantId, invoiceId, status) {
  const services = await getServices();
  const { doc, setDoc, serverTimestamp } = services.firestoreModule;
  await setDoc(doc(services.db, "restaurants", restaurantId, "invoices", invoiceId), {
    status,
    updatedAt: new Date().toISOString(),
    updatedAtServer: serverTimestamp()
  }, { merge: true });
}

// Prefixe/prochain numero de facture : reserve a l'owner et l'admin (voir user, 2026-09-23 :
// exception a la regle generale "legal/billing info = owner only" pour ce champ precis), et
// seulement avant la toute premiere facture (voir invoiceNumberingStatusHtml). Ecrit dans
// restaurants/{id}.restaurantProfile (map imbriquee, comme poket-access.html) : un setDoc
// merge:true fusionne cette map en profondeur, les autres champs (siret, iban...) ne sont pas touches.
async function saveInvoiceNumbering(root, form) {
  if (!["owner", "admin"].includes(root.dataset.restaurantRole || "")) {
    throw new Error("Seuls le owner et les admins peuvent choisir le numero de depart des factures.");
  }
  if ((root.dashboardInvoices || []).length > 0) {
    throw new Error("Impossible : des factures existent deja, la numerotation est verrouillee.");
  }
  const services = await getServices();
  const { doc, setDoc, serverTimestamp } = services.firestoreModule;
  const data = new FormData(form);
  const prefix = text(data, "invoicePrefix") || "FAC";
  const nextNumber = Math.max(1, Number(text(data, "nextInvoiceNumber")) || 1);
  await setDoc(doc(services.db, "restaurants", root.dataset.restaurantId), {
    restaurantProfile: {
      invoicePrefix: prefix,
      nextInvoiceNumber: nextNumber,
      updatedAt: serverTimestamp()
    },
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Reglage sensible (exception a [[firebase-rules-single-source]] "legal/billing info = owner
// only" : owner ET admin peuvent modifier celui-ci), et seulement tant qu'aucune facture
// n'existe (sinon la numerotation legale deja emise ne serait plus fiable). Deplace depuis
// poket-access.html pour plus de securite : cette page est geree au quotidien, pas l'onboarding.
function invoiceNumberingStatusHtml(restaurant = {}, invoiceCount = 0, role = "") {
  const prefix = String(restaurant.invoicePrefix || "FAC").trim() || "FAC";
  const nextNumber = Number(restaurant.nextInvoiceNumber) || 1;
  const preview = `${prefix}-${String(nextNumber).padStart(4, "0")}`;
  if (invoiceCount > 0) {
    return `
      <div class="invoice-numbering-status">
        <span>Numerotation en cours depuis <strong>${escapeHtml(preview)}</strong> (verrouillee : ${invoiceCount} facture${invoiceCount > 1 ? "s" : ""} deja emise${invoiceCount > 1 ? "s" : ""}, la loi interdit les trous dans la sequence).</span>
      </div>
    `;
  }
  if (!["owner", "admin"].includes(role)) {
    return `
      <div class="invoice-numbering-status">
        <span>Prochaine facture : <strong>${escapeHtml(preview)}</strong> (seuls le owner et les admins peuvent choisir le numero de depart).</span>
      </div>
    `;
  }
  return `
    <form class="invoice-numbering-form" data-dashboard-invoice-numbering-form>
      <div class="invoice-numbering-status">
        <span>Prochaine facture : <strong>${escapeHtml(preview)}</strong></span>
      </div>
      <p class="alert-note">Ce numero ne sera plus modifiable des la premiere facture creee : verifiez-le avec soin (reprise d'une numerotation existante, ou nouveau depart) avant de continuer.</p>
      <div class="form-grid">
        <label>Prefixe<input name="invoicePrefix" value="${escapeAttr(prefix)}" maxlength="12" required /></label>
        <label>Prochain numero<input name="nextInvoiceNumber" type="number" min="1" step="1" value="${nextNumber}" required /></label>
      </div>
      <button class="outline-dark-btn button-reset" type="submit">Enregistrer la numerotation</button>
      <small data-form-status></small>
    </form>
  `;
}

function invoicesHtml(invoices = [], role = "", restaurant = {}, customerAccounts = {}, drafts = []) {
  const canManage = QUOTE_MANAGER_ROLES.includes(role);
  const sorted = [...invoices].sort((a, b) => invoiceSortTime(b) - invoiceSortTime(a));
  const sortedDrafts = [...drafts].sort((a, b) => invoiceSortTime(b) - invoiceSortTime(a));
  const customers = Array.isArray(customerAccounts) ? customerAccounts : customerAccounts.customers || [];
  const clients = customers.map(normalizeCustomerAccount);
  return `
    <div class="invoices-section" data-invoices-section>
      <div class="invoices-list-view" data-invoices-list-view>
        <div class="quotes-head">
          <div>
            <h2>Factures</h2>
            <p>${sorted.length} facture${sorted.length > 1 ? "s" : ""}.</p>
          </div>
          ${canManage ? `
            <button class="client-create-btn button-reset" type="button" data-invoice-create-open>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6M9 15h6"/></svg>
              <strong>Nouvelle facture</strong>
            </button>
          ` : ""}
        </div>
        ${canManage ? invoiceNumberingStatusHtml(restaurant, sorted.length, role) : ""}
        ${canManage && sortedDrafts.length ? `
          <section class="quote-drafts" aria-labelledby="invoice-drafts-title">
            <h3 id="invoice-drafts-title">Brouillons <span class="quote-drafts-count">${sortedDrafts.length}</span></h3>
            <div class="quote-drafts-list">
              ${sortedDrafts.map((draft) => invoiceDraftRowHtml(draft, clients)).join("")}
            </div>
          </section>
        ` : ""}
        ${sorted.length ? `
          <div class="client-ledger-table quotes-table">
            <div class="client-ledger-row client-ledger-head quote-row"><span>Numero</span><span>Client</span><span>Emise le</span><span>Echeance</span><span>Total TTC</span><span>Statut</span></div>
            ${sorted.map((invoice) => invoiceRowHtml(invoice)).join("")}
          </div>
        ` : `<div class="client-account-empty">Aucune facture pour le moment. Creez-en une directement, ou transformez un devis depuis l'onglet Devis.</div>`}
        ${!canManage ? `<p class="alert-note">Votre role ne permet pas de creer des factures.</p>` : ""}
      </div>
      ${canManage ? invoiceCreatePageHtml(clients, restaurant) : ""}
    </div>
  `;
}

function invoiceDraftRowHtml(draft = {}, clients = []) {
  const client = clients.find((item) => item.id === draft.customerId);
  const clientName = client?.displayName || client?.companyName || "Client non choisi";
  const totalTtc = quoteLinesTotals(draft.lines || []).totalTtc;
  return `
    <div class="quote-draft-row" data-invoice-draft-id="${escapeAttr(draft.id)}">
      <div class="quote-draft-info">
        <strong>${escapeHtml(draft.eventLabel || clientName)}</strong>
        <small>${escapeHtml([clientName, clientDateLabel(draft.updatedAt) ? `modifie le ${clientDateLabel(draft.updatedAt)}` : "", formatMoney(totalTtc)].filter(Boolean).join(" · "))}</small>
      </div>
      <div class="quote-draft-actions">
        <button class="outline-dark-btn button-reset" type="button" data-invoice-draft-resume>Reprendre</button>
        <button class="button-reset quote-line-remove" type="button" data-invoice-draft-delete aria-label="Supprimer le brouillon">&times;</button>
      </div>
    </div>
  `;
}

// Reutilise volontairement les selecteurs/fonctions du formulaire Devis (client, lignes,
// catalogue, totaux) : le comportement est identique, seuls les champs propres a la facture
// (echeance au lieu de validite) et la soumission (submitInvoiceForm) different.
function invoiceCreatePageHtml(clients = [], restaurant = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return `
    <section class="quote-create-page is-hidden" data-invoice-create-page>
      <header class="client-detail-header">
        <button class="button-reset client-back-btn" type="button" data-invoice-create-close aria-label="Retour aux factures">&larr;</button>
        <div>
          <span>Facture</span>
          <h2>Nouvelle facture</h2>
        </div>
      </header>
      <form class="platform-form quote-form" data-dashboard-invoice-form>
        <div class="quote-client-picker">
          ${quoteClientPickerFieldHtml(clients)}
          <button class="outline-dark-btn button-reset" type="button" data-quote-add-client>+ Ajouter un client</button>
        </div>
        <div class="quote-client-summary" data-quote-client-summary>${quoteClientSummaryHtml(null)}</div>

        <div class="form-grid">
          <label>Intitule<input name="eventLabel" placeholder="Reception, buffet d'entreprise..." /></label>
          <label>Date d'emission<input name="eventDate" type="date" value="${today}" /></label>
          <label>
            <select class="label-select" data-quote-covers-label>
              ${["Couverts", "Convives"].map((word) => `<option value="${word}" ${word === quoteCoversLabelPreference() ? "selected" : ""}>${word}</option>`).join("")}
            </select>
            <input name="covers" type="number" min="0" step="1" />
          </label>
          <label>Date d'echeance<input name="dueDate" type="date" value="${dueDate}" required /></label>
          <label>Acompte deja verse (EUR)<input name="depositAmount" type="number" min="0" step="0.01" /></label>
        </div>
        <label class="wide-field">Notes<textarea name="notes" rows="2"></textarea></label>

        <div class="quote-lines" data-quote-lines>
          <div class="quote-line-row quote-line-head"><span>Libelle</span><span>Qte</span><span>PU TTC</span><span>TVA</span><span>Total TTC</span><span></span></div>
          ${quoteLineRowHtml()}
        </div>
        <button class="outline-dark-btn button-reset" type="button" data-quote-add-line>+ Ajouter une ligne</button>

        <div class="quote-totals" data-quote-totals>
          <span>Total HT <strong data-quote-total-ht>0,00 &euro;</strong></span>
          <span>TVA <strong data-quote-total-vat>0,00 &euro;</strong></span>
          <span>Total TTC <strong data-quote-total-ttc>0,00 &euro;</strong></span>
        </div>

        <label class="wide-field">Conditions<textarea name="conditions" rows="3">${escapeHtml(restaurant.paymentTerms || "Paiement a reception de facture.")}</textarea></label>
        <div class="quote-form-actions">
          <button class="outline-dark-btn button-reset" type="button" data-invoice-preview>Previsualiser</button>
          <button class="outline-dark-btn button-reset" type="button" data-invoice-save-draft>Enregistrer comme brouillon</button>
          <button class="primary-btn button-reset" type="submit">Creer la facture</button>
        </div>
        <small data-form-status></small>
      </form>
    </section>
  `;
}

function invoiceRowHtml(invoice = {}) {
  const customer = invoice.customer || {};
  const tone = INVOICE_STATUS_TONES[invoice.status] || "even";
  return `
    <button type="button" class="client-ledger-row quote-row is-clickable" data-invoice-row="${escapeAttr(invoice.id)}">
      <span><strong>${escapeHtml(invoice.invoiceNumber || invoice.id)}</strong></span>
      <span>${escapeHtml(customer.name || "Client non renseigne")}</span>
      <span>${escapeHtml(clientDateLabel(invoice.issuedAt) || "-")}</span>
      <span>${escapeHtml(clientDateLabel(invoice.dueDate) || "-")}</span>
      <span>${escapeHtml(formatMoney(invoice.totalTtc))}</span>
      <span><span class="quote-status-badge is-${tone}">${escapeHtml(invoiceStatusLabel(invoice.status))}</span></span>
    </button>
  `;
}

// Petite confirmation avant conversion : la date d'echeance n'est pas sur le devis
// (le devis a une "date de validite", la facture a une echeance de paiement distincte).
function openQuoteToInvoiceConfirm(root, quote) {
  const today = new Date().toISOString().slice(0, 10);
  const overlay = showDashboardModal("Transformer en facture", `
    <form class="platform-form" data-quote-to-invoice-form>
      <p class="quote-preview-note">Le devis ${escapeHtml(quote.quoteNumber || "")} sera transforme en facture avec un numero definitif. Cette action est irreversible.</p>
      <label>Date d'echeance<input name="dueDate" type="date" value="${today}" required /></label>
      <button class="primary-btn button-reset" type="submit">Confirmer et creer la facture</button>
      <small data-form-status></small>
    </form>
  `);
  const form = overlay.querySelector("[data-quote-to-invoice-form]");
  const status = form.querySelector("[data-form-status]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      requireQuotePermission(root);
      if (quote.invoiceId) throw new Error("Ce devis a deja ete transforme en facture.");
      status.textContent = "Creation de la facture...";
      const restaurantId = root.dataset.restaurantId;
      const restaurant = root.dashboardRestaurant || {};
      const dueDateValue = new FormData(form).get("dueDate");
      const dueDate = dueDateValue ? new Date(`${dueDateValue}T12:00:00`).toISOString() : new Date().toISOString();
      const { id } = await createInvoiceFromQuote(restaurantId, quote, restaurant, dueDate, currentUser);
      closeDashboardModal();
      await renderDashboard(root, currentUser, restaurantId, "invoices");
      await openInvoiceDetail(root, id);
    } catch (error) {
      status.textContent = error?.code === "permission-denied"
        ? "Action refusee par Firestore : votre role ne permet pas cette operation."
        : (error.message || String(error));
    }
  });
}

// ---------------------------------------------------------------------------
// Construit le PDF complet de la facture : meme mise en page que le devis
// (PdfDocument, pdfBox, tableau), en-tete "FACTURE", echeance au lieu de
// validite, et un encadre "Mentions legales" (penalites de retard, indemnite
// forfaitaire de recouvrement) obligatoire sur une facture B2B francaise.
// ---------------------------------------------------------------------------
async function buildInvoicePdf(invoice = {}, restaurant = {}) {
  const doc = new PdfDocument();
  const margin = doc.margin;
  const width = doc.contentWidth;
  const customer = invoice.customer || {};
  const table = invoice.sourceTable || {};
  const lineItems = Array.isArray(table.lines) ? table.lines.filter((line) => Number(line.quantity) !== 0) : [];

  let logo = null;
  const logoUrl = firstText(restaurant.documentLogoUrl, restaurant.logoUrl);
  if (logoUrl) {
    try {
      const pixels = await loadLogoPixels(logoUrl);
      logo = { name: await doc.addImageAsset(pixels), width: pixels.width, height: pixels.height };
    } catch (error) {
      logo = null;
    }
  }
  const restaurantName = String(firstText(restaurant.name, restaurant.tradeName, "Restaurant"));
  const headerTop = doc.pageHeight - doc.y;
  let leftY;
  if (logo) {
    doc.image(margin, headerTop, logo.width, logo.height, logo.name);
    leftY = headerTop + logo.height + 8;
  } else {
    doc.text(margin, headerTop, restaurantName, { bold: true, size: 16 });
    leftY = headerTop + 22;
  }
  const street = cleanStreetLine(firstText(restaurant.addressLine1, restaurant.address), restaurant.postalCode);
  const addressLines = [
    street,
    [restaurant.postalCode, restaurant.city].filter(Boolean).join(" "),
    restaurant.phone ? `Tel : ${formatClientPhone(restaurant.phone)}` : "",
    restaurant.email || "",
    quoteHeaderLegalLine(restaurant)
  ].filter(Boolean);
  addressLines.forEach((line) => {
    doc.text(margin, leftY, line, { size: 9.5 });
    leftY += 13.5;
  });

  const rightX = doc.pageWidth - margin;
  doc.textRight(rightX, doc.pageHeight - doc.y, "FACTURE", { bold: true, size: 22 });
  let rightY = doc.pageHeight - doc.y + 26;
  [
    invoice.invoiceNumber || "",
    `Date : ${clientDateLabel(invoice.issuedAt) || "-"}`,
    `Echeance : ${clientDateLabel(invoice.dueDate) || "-"}`,
    invoice.quoteNumber ? `Devis d'origine : ${invoice.quoteNumber}` : ""
  ].filter(Boolean).forEach((line) => {
    doc.textRight(rightX, rightY, line, { size: 10 });
    rightY += 14;
  });

  doc.y -= Math.max(leftY, rightY) - (doc.pageHeight - doc.y) + 6;
  doc.line(margin, doc.pageHeight - doc.y, doc.pageWidth - margin, doc.pageHeight - doc.y);
  doc.y -= 16;

  const boxWidth = (width - 16) / 2;
  const clientLines = [
    customer.name || "Client non renseigne",
    customer.phone ? `Tel. : ${formatClientPhone(customer.phone)}` : "",
    customer.email ? `Email : ${customer.email}` : "",
    customer.address || "",
    customer.taxId ? `SIRET/Fiscal : ${customer.taxId}` : "",
    customer.vatNumber ? `TVA : ${customer.vatNumber}` : ""
  ].filter(Boolean);
  const prestationLines = [
    invoice.eventLabel || (table.sessionKind === "takeaway" ? "A emporter" : "Sur place"),
    invoice.eventDate ? `Date evenement : ${clientDateLabel(invoice.eventDate)}` : "",
    table.covers ? `${table.covers} couverts` : "",
    table.tableNote ? `Note : ${table.tableNote}` : ""
  ].filter(Boolean);
  doc.ensureSpace(100);
  const topY = doc.pageHeight - doc.y;
  const clientHeight = pdfBox(doc, margin, topY, boxWidth, "Client", clientLines);
  const prestationHeight = pdfBox(doc, margin + boxWidth + 16, topY, boxWidth, "Prestation", prestationLines);
  doc.y -= Math.max(clientHeight, prestationHeight) + 20;

  const columns = [
    { label: "Designation", width: width * 0.46, align: "left" },
    { label: "Qte", width: width * 0.09, align: "right" },
    { label: "PU TTC", width: width * 0.15, align: "right" },
    { label: "TVA", width: width * 0.10, align: "right" },
    { label: "Total TTC", width: width * 0.20, align: "right" }
  ];
  const colX = [margin];
  columns.forEach((column, index) => colX.push(colX[index] + column.width));

  const drawTableHeader = () => {
    doc.ensureSpace(30);
    const rowTop = doc.pageHeight - doc.y;
    doc.rect(margin, rowTop, width, 22, { stroke: "0.6 0.6 0.6", fill: "0.91 0.91 0.91" });
    columns.forEach((column, index) => {
      const cellX = colX[index];
      if (column.align === "right") doc.textRight(cellX + column.width - 6, rowTop + 6, column.label, { bold: true, size: 9.5 });
      else doc.text(cellX + 6, rowTop + 6, column.label, { bold: true, size: 9.5 });
    });
    doc.y -= 22;
  };
  drawTableHeader();

  let total = 0;
  const vatBuckets = new Map();
  lineItems.forEach((line) => {
    const quantity = Number(line.quantity) || 0;
    const unitPrice = Number(line.unitPrice) || 0;
    const rate = Number(line.vatOnSite) || 0;
    const lineTotal = roundMoney(quantity * unitPrice);
    total += lineTotal;
    if (rate > 0 && lineTotal > 0) {
      const vatAmount = lineTotal - lineTotal / (1 + rate / 100);
      vatBuckets.set(rate, roundMoney((vatBuckets.get(rate) || 0) + vatAmount));
    }
    const cells = [line.name || "Article", ticketQuantity(quantity), ticketAmount(unitPrice), `${String(rate).replace(".", ",")}%`, ticketAmount(lineTotal)];
    const wrapped = wrapProportional(cells[0], columns[0].width - 12, false, 9.5);
    const rowHeight = Math.max(20, wrapped.length * 13 + 6);
    doc.ensureSpace(rowHeight);
    if (doc.pageHeight - doc.y === doc.margin) drawTableHeader();
    const rowTop = doc.pageHeight - doc.y;
    doc.rect(margin, rowTop, width, rowHeight, { stroke: "0.75 0.75 0.75", lineWidth: 0.4 });
    wrapped.forEach((part, index) => doc.text(colX[0] + 6, rowTop + 6 + index * 13, part, { size: 9.5 }));
    cells.slice(1).forEach((value, index) => {
      const column = columns[index + 1];
      doc.textRight(colX[index + 1] + column.width - 6, rowTop + 6, value, { size: 9.5 });
    });
    doc.y -= rowHeight;
  });
  if (!lineItems.length) {
    doc.ensureSpace(24);
    const rowTop = doc.pageHeight - doc.y;
    doc.rect(margin, rowTop, width, 22, { stroke: "0.75 0.75 0.75", lineWidth: 0.4 });
    doc.text(margin + 6, rowTop + 6, "Aucune ligne", { size: 9.5 });
    doc.y -= 22;
  }
  doc.y -= 16;

  total = roundMoney(total);
  const totalVat = roundMoney([...vatBuckets.values()].reduce((sum, value) => sum + value, 0));
  const totalHt = roundMoney(total - totalVat);
  const deposit = roundMoney(Number(invoice.depositAmount) || 0);
  const totalsRows = [
    ...[...vatBuckets.entries()].sort((a, b) => a[0] - b[0]).map(([rate, amount]) => [`TVA ${String(rate).replace(".", ",")} %`, formatMoney(amount), false]),
    ["Total HT", formatMoney(totalHt), false],
    ["Total TTC", formatMoney(total), true]
  ];
  if (deposit > 0) {
    totalsRows.push(["Acompte deja verse", formatMoney(deposit), false]);
    totalsRows.push(["Net a payer", formatMoney(roundMoney(Math.max(total - deposit, 0))), true]);
  }
  const totalsWidth = 230;
  const totalsX = doc.pageWidth - margin - totalsWidth;
  doc.ensureSpace(totalsRows.length * 15 + 6);
  totalsRows.forEach(([label, value, bold]) => {
    const rowTop = doc.pageHeight - doc.y;
    doc.text(totalsX, rowTop, label, { bold, size: 10 });
    doc.textRight(doc.pageWidth - margin, rowTop, value, { bold, size: 10 });
    doc.y -= 15;
  });
  doc.y -= 12;

  // -- mentions legales obligatoires (penalites de retard, indemnite de recouvrement) et
  // coordonnees bancaires, cote a cote et a la meme hauteur, plafonnees a 15% de la page --
  const legalLines = [
    restaurant.paymentTerms || "Paiement a reception de facture.",
    restaurant.latePenaltyTerms || "En cas de retard de paiement, penalites au taux d'interet legal en vigueur, exigibles sans rappel.",
    restaurant.recoveryIndemnity ? `Indemnite forfaitaire de recouvrement : ${restaurant.recoveryIndemnity}` : "Indemnite forfaitaire de recouvrement : 40 EUR (art. L441-10 du code de commerce).",
    restaurant.invoiceLegalNotice || ""
  ].filter(Boolean).join(NL).split(NL);
  const hasBankDetails = !!(restaurant.iban || restaurant.bic);
  const bankLines = hasBankDetails ? [
    firstText(restaurant.legalName, restaurant.tradeName, restaurant.name) ? `Titulaire : ${firstText(restaurant.legalName, restaurant.tradeName, restaurant.name)}` : "",
    restaurant.iban ? `IBAN : ${restaurant.iban}` : "",
    restaurant.bic ? `BIC : ${restaurant.bic}` : "",
    `Reference a indiquer : ${invoice.invoiceNumber || ""}`
  ].filter(Boolean) : [];

  const maxBoxHeight = doc.pageHeight * 0.15;
  const bottomBoxWidth = hasBankDetails ? (width - 16) / 2 : width;
  const legalSize = fitPdfBoxSize(bottomBoxWidth, legalLines, maxBoxHeight);
  const legalFitHeight = measurePdfBoxHeight(bottomBoxWidth, legalLines, { size: legalSize });
  const bankSize = hasBankDetails ? fitPdfBoxSize(bottomBoxWidth, bankLines, maxBoxHeight) : legalSize;
  const bankFitHeight = hasBankDetails ? measurePdfBoxHeight(bottomBoxWidth, bankLines, { size: bankSize }) : 0;
  const bottomBoxHeight = Math.max(legalFitHeight, bankFitHeight);

  doc.ensureSpace(bottomBoxHeight + 16);
  const bottomBoxTop = doc.pageHeight - doc.y;
  pdfBox(doc, margin, bottomBoxTop, bottomBoxWidth, "Mentions legales", legalLines, { size: legalSize, height: bottomBoxHeight });
  if (hasBankDetails) {
    pdfBox(doc, margin + bottomBoxWidth + 16, bottomBoxTop, bottomBoxWidth, "Coordonnees bancaires", bankLines, { size: bankSize, height: bottomBoxHeight });
  }
  doc.y -= bottomBoxHeight + 16;

  if (invoice.status === "paid") {
    doc.ensureSpace(30);
    doc.text(margin, doc.pageHeight - doc.y, "Facture acquittee", { bold: true, size: 12 });
  }

  return doc.build();
}

async function openInvoiceDetail(root, invoiceId) {
  const invoices = root.dashboardInvoices || [];
  const invoice = invoices.find((item) => item.id === invoiceId);
  if (!invoice) return;
  const restaurant = root.dashboardRestaurant || {};
  const canManage = QUOTE_MANAGER_ROLES.includes(root.dataset.restaurantRole || "");
  const overlay = showDashboardModal(
    `Facture ${invoice.invoiceNumber || ""}`,
    `<p class="client-modal-wait">Generation du PDF...</p>`,
    { wide: true }
  );
  const blob = await buildInvoicePdf(invoice, restaurant);
  if (!document.body.contains(overlay)) return;
  const objectUrl = URL.createObjectURL(blob);
  overlay.dataset.invoiceObjectUrl = objectUrl;
  overlay.querySelector(".client-modal-body").innerHTML = `<div class="quote-preview"><iframe src="${escapeAttr(objectUrl)}" title="Apercu de la facture"></iframe></div>`;
  const cleanupUrl = () => URL.revokeObjectURL(objectUrl);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-client-modal-close]")) cleanupUrl();
  });
  const footer = document.createElement("footer");
  footer.innerHTML = `
    ${canManage ? `
      <label class="quote-status-inline">Statut
        <select data-invoice-status-select>
          ${Object.keys(INVOICE_STATUS_LABELS).map((status) => `<option value="${status}" ${invoice.status === status ? "selected" : ""}>${INVOICE_STATUS_LABELS[status]}</option>`).join("")}
        </select>
      </label>
    ` : ""}
    <button class="primary-btn button-reset" type="button" data-invoice-download>Telecharger en PDF</button>
    <button class="outline-dark-btn button-reset" type="button" data-client-modal-close>Fermer</button>
  `;
  overlay.querySelector(".client-modal").appendChild(footer);
  footer.querySelector("[data-invoice-download]").addEventListener("click", () => {
    const stamp = String(invoice.invoiceNumber || invoice.id).replace(/[^a-zA-Z0-9_-]/g, "_");
    downloadClientFile(blob, `${stamp}.pdf`, "application/pdf");
  });
  footer.querySelector("[data-invoice-status-select]")?.addEventListener("change", async (event) => {
    await updateInvoiceStatus(root.dataset.restaurantId, invoice.id, event.target.value);
    cleanupUrl();
    closeDashboardModal();
    await renderDashboard(root, currentUser, root.dataset.restaurantId, "invoices");
  });
}


function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value.replace(",", "."));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function formatMoney(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR"
  }).format(number);
}

function reservationMatchesClient(reservation = {}, client = {}) {
  const reservationPhone = normalizeClientPhone(firstText(
    reservation.customerPhone,
    reservation.phone,
    reservation.telephone,
    reservation.mobile,
    reservation.contactPhone,
    reservation.customer?.phone,
    reservation.contact?.phone
  ));
  const reservationEmail = normalizeClientSearch(firstText(
    reservation.customerEmail,
    reservation.email,
    reservation.contactEmail,
    reservation.customer?.email,
    reservation.contact?.email
  ));
  const reservationName = normalizeClientSearch(firstText(
    reservation.customerName,
    reservation.name,
    reservation.clientName,
    reservation.customer?.name,
    reservation.customer?.displayName,
    reservation.contact?.name
  ));
  const clientPhone = normalizeClientPhone(client.phone);
  const clientEmail = normalizeClientSearch(client.email);
  const clientNames = [
    client.displayName,
    [client.firstName, client.lastName].filter(Boolean).join(" "),
    client.companyName,
    client.contactName
  ].map(normalizeClientSearch).filter(Boolean);
  return !!(
    clientPhone && reservationPhone && clientPhone === reservationPhone ||
    clientEmail && reservationEmail && clientEmail === reservationEmail ||
    reservationName && clientNames.includes(reservationName)
  );
}

function normalizeCustomerAccount(customer = {}) {
  const civility = firstText(customer.civility);
  const displayName = firstText(
    customer.displayName,
    customer.name,
    [civility, customer.lastName, customer.firstName].filter(Boolean).join(" "),
    customer.contactName,
    customer.companyName
  );
  return {
    id: customer.id,
    customerCollection: customerCollectionName(customer.customerCollection),
    type: normalizeCustomerType(firstText(customer.type), customer),
    displayName,
    civility,
    firstName: firstText(customer.firstName),
    lastName: firstText(customer.lastName),
    contactName: firstText(customer.contactName),
    companyName: firstText(customer.companyName),
    phone: firstText(customer.phone, customer.telephone, customer.mobile),
    email: firstText(customer.email),
    address: firstText(customer.address),
    country: firstText(customer.country, customer.countryCode) || "France",
    taxId: firstText(customer.taxId),
    vatNumber: firstText(customer.vatNumber),
    notes: firstText(customer.notes),
    active: customer.active !== false,
    createdAt: customer.createdAt || null,
    updatedAt: customer.updatedAt || customer.createdAt || null,
    // Solde et journal : sans ces champs, clientAccountSummary() ne voyait jamais
    // les mouvements charges depuis Firestore et affichait toujours 0,00 EUR.
    ...pickCustomerAccountFields(customer)
  };
}

function pickCustomerAccountFields(customer = {}) {
  const fields = {};
  CUSTOMER_ACCOUNT_FIELDS.forEach((key) => {
    if (customer[key] !== undefined) fields[key] = customer[key];
  });
  return fields;
}

function clientTimeValue(value) {
  return dateFromFirestoreValue(value)?.getTime() || 0;
}

function clientDateLabel(value) {
  const date = dateFromFirestoreValue(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function normalizeClientSearch(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .trim();
}

function normalizeClientPhone(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function formatClientPhone(value = "") {
  const raw = String(value || "").trim();
  const digits = normalizeClientPhone(raw);
  if (!digits) return "";
  if (raw.startsWith("+")) return raw;
  if (digits.length === 10) return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  return raw;
}

function clientColumnState(root) {
  if (!root.clientColumns) root.clientColumns = { sort: null, filters: {} };
  return root.clientColumns;
}

function clientToolState(root) {
  const tools = root.querySelector("[data-client-tools]");
  const columns = clientColumnState(root);
  return {
    tools,
    query: normalizeClientSearch(tools?.querySelector("[data-client-search]")?.value || ""),
    filter: tools?.querySelector("[data-client-filter]")?.value || "all",
    sort: columns.sort,
    columnFilters: columns.filters
  };
}

function clientCardMatchesTools(card, state) {
  return (!state.query || card.dataset.clientSearchText.includes(state.query))
    && clientCardMatchesFilter(card, state.filter)
    && clientCardMatchesColumns(card, state.columnFilters);
}

function applyClientTools(root) {
  const table = root.querySelector(".clients-table");
  const state = clientToolState(root);
  const tools = state.tools;
  if (!tools || !table) return;
  const pageSize = Number(root.querySelector("[data-client-page-size]")?.value || 25);
  const currentPage = clientCurrentPage(root);
  const cards = [...table.querySelectorAll("[data-client-card]")];
  const sortedCards = cards.sort((a, b) => compareClientCards(a, b, state.sort));
  sortedCards.forEach((card) => table.appendChild(card));
  const filteredCards = sortedCards.filter((card) => clientCardMatchesTools(card, state));
  const pageCount = Math.max(1, Math.ceil(filteredCards.length / pageSize));
  const page = Math.min(currentPage, pageCount);
  setClientPage(root, page);
  const pageStart = (page - 1) * pageSize;
  const pageEnd = pageStart + pageSize;
  const visibleCards = new Set(filteredCards.slice(pageStart, pageEnd));
  sortedCards.forEach((card) => {
    card.classList.toggle("is-hidden", !visibleCards.has(card));
  });
  const count = tools.querySelector("[data-client-result-count]");
  if (count) count.textContent = `${filteredCards.length} client${filteredCards.length > 1 ? "s" : ""}`;
  root.querySelector("[data-client-empty-results]")?.classList.toggle("is-hidden", filteredCards.length !== 0);
  const reset = tools.querySelector("[data-client-reset]");
  const hasTools = !!state.query
    || state.filter !== "all"
    || !!state.sort
    || Object.values(state.columnFilters).some(Boolean);
  reset?.classList.toggle("is-hidden", !hasTools);
  syncClientColumnUi(root);
  const pagination = root.querySelector("[data-client-pagination]");
  if (pagination) {
    pagination.querySelector("[data-client-page-label]").textContent = filteredCards.length
      ? `${pageStart + 1} - ${Math.min(pageEnd, filteredCards.length)} of ${filteredCards.length}`
      : "0 - 0 of 0";
    const prev = pagination.querySelector('[data-client-page="-1"]');
    const next = pagination.querySelector('[data-client-page="1"]');
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= pageCount;
  }
}

function clientColumnValue(card, key) {
  const data = card.dataset;
  if (key === "name") return data.clientName || "";
  if (key === "email") return data.clientEmail || "";
  if (key === "phone") return data.clientPhone || "";
  if (key === "country") return data.clientCountry || "";
  if (key === "created") return Number(data.clientCreated || 0);
  if (key === "balance") return Number(data.clientBalanceValue || 0);
  return "";
}

function clientColumnFilterText(card, key) {
  if (key === "created") return card.dataset.clientCreatedLabel || "";
  if (key === "balance") return card.dataset.clientBalance || "";
  return String(clientColumnValue(card, key));
}

function clientCardMatchesColumns(card, filters = {}) {
  return Object.entries(filters).every(([key, raw]) => {
    if (!raw) return true;
    const needle = key === "phone" ? normalizeClientPhone(raw) : normalizeClientSearch(raw);
    return !needle || clientColumnFilterText(card, key).includes(needle);
  });
}

function syncClientColumnUi(root) {
  const { sort, filters } = clientColumnState(root);
  root.querySelectorAll("[data-client-col]").forEach((head) => {
    const key = head.dataset.clientCol;
    const isFiltered = !!filters[key];
    const isSorted = sort?.key === key;
    head.classList.toggle("is-filtered", isFiltered);
    head.classList.toggle("is-sorted", isSorted);
    head.dataset.sortDir = isSorted ? sort.dir : "";
    head.querySelectorAll("[data-client-col-sort]").forEach((button) => {
      const active = isSorted && button.dataset.clientColSort === `${key}:${sort.dir}`;
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const input = head.querySelector("[data-client-col-filter]");
    if (input && input.value !== (filters[key] || "")) input.value = filters[key] || "";
    const clear = head.querySelector("[data-client-col-clear]");
    if (clear) clear.disabled = !isFiltered && !isSorted;
  });
}

function toggleClientColumnMenu(root, key) {
  const head = root.querySelector(`[data-client-col="${CSS.escape(key)}"]`);
  if (!head) return;
  const willOpen = !head.classList.contains("is-open");
  closeClientColumnMenus(root);
  if (!willOpen) return;
  head.classList.add("is-open");
  head.querySelector("[data-client-col-toggle]")?.setAttribute("aria-expanded", "true");
  head.querySelector("[data-client-col-filter]")?.focus();
}

function closeClientColumnMenus(root) {
  root.querySelectorAll(".client-col-head.is-open").forEach((head) => {
    head.classList.remove("is-open");
    head.querySelector("[data-client-col-toggle]")?.setAttribute("aria-expanded", "false");
  });
}

function isClientColumnKey(key) {
  return CLIENT_COLUMNS.some((column) => column.key === key);
}

function setClientColumnSort(root, value) {
  const [key, dir] = String(value || "").split(":");
  if (!isClientColumnKey(key) || !["asc", "desc"].includes(dir)) return;
  const state = clientColumnState(root);
  state.sort = state.sort?.key === key && state.sort.dir === dir ? null : { key, dir };
  setClientPage(root, 1);
  closeClientColumnMenus(root);
  applyClientTools(root);
}

function setClientColumnFilter(root, key, value) {
  if (!isClientColumnKey(key)) return;
  const state = clientColumnState(root);
  if (String(value || "").trim()) state.filters[key] = String(value);
  else delete state.filters[key];
  setClientPage(root, 1);
  applyClientTools(root);
}

function clearClientColumn(root, key) {
  if (!isClientColumnKey(key)) return;
  const state = clientColumnState(root);
  delete state.filters[key];
  if (state.sort?.key === key) state.sort = null;
  setClientPage(root, 1);
  applyClientTools(root);
}

function openClientDetail(root, clientId) {
  if (!clientId) return;
  const dashboard = root.querySelector(".client-ledger");
  const detail = root.querySelector(`[data-client-detail="${CSS.escape(clientId)}"]`);
  if (!dashboard || !detail) return;
  dashboard.querySelectorAll("[data-client-detail]").forEach((panel) => panel.classList.add("is-hidden"));
  detail.classList.remove("is-hidden");
  detail.querySelector(".client-info-section")?.removeAttribute("open");
  dashboard.classList.add("is-client-detail-open");
  detail.scrollIntoView({ block: "start", behavior: "smooth" });
}

function closeClientDetail(root) {
  const dashboard = root.querySelector(".client-ledger");
  if (!dashboard) return;
  dashboard.classList.remove("is-client-detail-open");
  dashboard.querySelectorAll("[data-client-detail]").forEach((panel) => panel.classList.add("is-hidden"));
  dashboard.scrollIntoView({ block: "start", behavior: "smooth" });
}

function compareClientCards(a, b, sort) {
  const byUpdate = Number(b.dataset.clientUpdated || 0) - Number(a.dataset.clientUpdated || 0);
  if (!sort) return byUpdate;
  const left = clientColumnValue(a, sort.key);
  const right = clientColumnValue(b, sort.key);
  // Comme dans Excel, les cellules vides restent en bas quel que soit le sens du tri.
  const leftEmpty = left === "";
  const rightEmpty = right === "";
  if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
  const direction = sort.dir === "desc" ? -1 : 1;
  const result = typeof left === "number"
    ? left - right
    : String(left).localeCompare(String(right), "fr", { numeric: true });
  return result * direction || byUpdate;
}

function clientCardMatchesFilter(card, filter) {
  if (filter === "active") return card.dataset.clientActive === "true";
  if (filter === "inactive") return card.dataset.clientActive === "false";
  if (filter === "with-phone") return card.dataset.clientHasPhone === "true";
  if (filter === "with-email") return card.dataset.clientHasEmail === "true";
  if (filter === "owing") return Number(card.dataset.clientBalanceValue || 0) < -0.004;
  if (filter === "credit") return Number(card.dataset.clientBalanceValue || 0) > 0.004;
  if (filter === "company") return card.dataset.clientType === "company";
  if (filter === "individual") return card.dataset.clientType !== "company";
  return true;
}

function resetClientTools(root) {
  const tools = root.querySelector("[data-client-tools]");
  if (!tools) return;
  const search = tools.querySelector("[data-client-search]");
  const filter = tools.querySelector("[data-client-filter]");
  if (search) search.value = "";
  if (filter) filter.value = "all";
  root.clientColumns = { sort: null, filters: {} };
  closeClientColumnMenus(root);
  setClientPage(root, 1);
  applyClientTools(root);
}

// La page courante vit dans une propriete JS : un attribut data-client-page sur la
// racine serait retrouve par closest("[data-client-page]") dans le gestionnaire de
// clic, qui annulerait alors chaque clic du dashboard (cases, <details>...).
function clientCurrentPage(root) {
  return Math.max(1, Number(root.clientPageIndex || 1));
}

function setClientPage(root, page) {
  root.clientPageIndex = Math.max(1, Number(page) || 1);
}

function changeClientPage(root, delta) {
  setClientPage(root, clientCurrentPage(root) + delta);
  applyClientTools(root);
}

function updateCustomerTypeScope(select) {
  const scope = select.closest("[data-customer-type-scope]");
  if (!scope) return;
  scope.dataset.customerType = select.value === "company" ? "company" : "individual";
}

// ---------------------------------------------------------------------------
// Export des contacts : un vrai tableau (Excel .xlsx) ou un CSV ouvrable dans Excel
// en francais (separateur « ; », UTF-8 avec BOM). Chaque client = une ligne.
// ---------------------------------------------------------------------------
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// [libelle, largeur de colonne, type : "money" | "int" | texte par defaut]
const CLIENT_EXPORT_COLUMNS = [
  ["Type", 14],
  ["Nom affichage", 26],
  ["Titre", 10],
  ["Prénom", 16],
  ["Nom", 18],
  ["Société", 24],
  ["Contact", 20],
  ["Téléphone", 16],
  ["Email", 30],
  ["Pays", 12],
  ["Adresse", 36],
  ["Tax ID", 18],
  ["TVA", 18],
  ["Statut", 10],
  ["Total débits (€)", 16, "money"],
  ["Total crédits (€)", 16, "money"],
  ["Solde (€) = crédits − débits", 26, "money"],
  ["Réservations", 13, "int"],
  ["Dernier passage", 16],
  ["Date création", 14],
  ["Mis à jour", 14],
  ["Notes", 36],
  ["ID compte", 24]
];

function clientExportRow(rawCustomer, reservations = []) {
  const client = normalizeCustomerAccount(rawCustomer);
  const account = clientAccountSummary(client);
  const metrics = clientAccountMetrics(client, reservations);
  return [
    client.type === "company" ? "Société" : "Particulier",
    client.displayName,
    client.civility,
    client.firstName,
    client.lastName,
    client.companyName,
    client.contactName,
    formatClientPhone(client.phone),
    client.email,
    client.country || "France",
    client.address,
    client.taxId,
    client.vatNumber,
    client.active === false ? "Inactif" : "Actif",
    account.debitValue,
    account.creditValue,
    account.balanceValue,
    metrics.reservationCount,
    metrics.lastVisitLabel,
    clientDateLabel(client.createdAt),
    clientDateLabel(client.updatedAt || client.createdAt),
    client.notes,
    client.id
  ];
}

function exportVisibleCustomers(root, format = "xlsx") {
  const state = clientToolState(root);
  const source = root.clientExportSource || { customers: [], reservations: [] };
  const customers = Array.isArray(source.customers) ? source.customers : source.customers?.customers || [];
  const reservations = Array.isArray(source.reservations) ? source.reservations : [];
  const byId = new Map(customers.map((customer) => [customer.id, customer]));
  const rows = [...root.querySelectorAll("[data-client-card]")]
    .filter((card) => clientCardMatchesTools(card, state))
    .sort((a, b) => compareClientCards(a, b, state.sort))
    .map((card) => byId.get(card.dataset.clientDetailTarget))
    .filter(Boolean)
    .map((customer) => clientExportRow(customer, reservations));
  const day = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    downloadClientFile(buildClientCsv(rows), `clients-restaurant-${day}.csv`, "text/csv;charset=utf-8");
  } else {
    downloadClientFile(buildClientXlsx(rows), `clients-restaurant-${day}.xlsx`, XLSX_MIME);
  }
}

function downloadClientFile(content, filename, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  // Une cellule commencant par = + - @ serait interpretee comme une formule par Excel.
  const text = String(value || "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function buildClientCsv(rows) {
  const format = (value, index) => {
    if (typeof value === "number") {
      return CLIENT_EXPORT_COLUMNS[index][2] === "money" ? value.toFixed(2).replace(".", ",") : String(value);
    }
    return csvCell(value);
  };
  const lines = [
    CLIENT_EXPORT_COLUMNS.map(([label]) => csvCell(label)).join(";"),
    ...rows.map((row) => row.map(format).join(";"))
  ];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

function xlsxColumn(index) {
  let number = index + 1;
  let name = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

function xmlText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Classeur Excel minimal (OOXML) : en-tete fige et colore, filtres, largeurs de colonnes,
// montants en vrais nombres. Aucune bibliotheque : un zip « stocke » ecrit a la main.
function buildClientXlsx(rows) {
  const columns = CLIENT_EXPORT_COLUMNS;
  const lastColumn = xlsxColumn(columns.length - 1);
  const lastRow = rows.length + 1;
  const sheetRows = [
    `<row r="1" ht="26" customHeight="1">${columns.map(([label], index) => `<c r="${xlsxColumn(index)}1" s="1" t="inlineStr"><is><t>${xmlText(label)}</t></is></c>`).join("")}</row>`
  ];
  rows.forEach((row, rowIndex) => {
    const number = rowIndex + 2;
    const cells = row.map((value, index) => {
      const reference = `${xlsxColumn(index)}${number}`;
      const kind = columns[index][2];
      if ((kind === "money" || kind === "int") && typeof value === "number") {
        return `<c r="${reference}" s="${kind === "money" ? 2 : 3}"><v>${value}</v></c>`;
      }
      const text = String(value ?? "");
      return text === "" ? "" : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
    }).join("");
    sheetRows.push(`<row r="${number}">${cells}</row>`);
  });
  const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";
  const sheet = `${header}<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${columns.map(([, width], index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows.join("")}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`;
  const styles = `${header}<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0A2540"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const workbook = `${header}<workbook xmlns="${main}" xmlns:r="${relationships}"><sheets><sheet name="Clients" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Clients!$A$1:$${lastColumn}$${lastRow}</definedName></definedNames></workbook>`;
  const workbookRelationships = `${header}<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationships}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relationships}/styles" Target="styles.xml"/></Relationships>`;
  const rootRelationships = `${header}<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const encoder = new TextEncoder();
  return new Blob(zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRelationships) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRelationships) },
    { name: "xl/styles.xml", data: encoder.encode(styles) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(sheet) }
  ]), { type: XLSX_MIME });
}

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[n] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Ecrit un fichier zip sans compression ; renvoie la liste des morceaux binaires.
function zipStore(files) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  files.forEach((file) => {
    const name = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, 0x0800, true);
    head.setUint16(10, 0, true);
    head.setUint16(12, dosTime, true);
    head.setUint16(14, dosDate, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, data.length, true);
    head.setUint32(24, data.length, true);
    head.setUint16(28, name.length, true);
    head.setUint32(42, offset, true);
    central.push(new Uint8Array(head.buffer), name);
    offset += 30 + name.length + data.length;
  });
  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return [...parts, ...central, new Uint8Array(end.buffer)];
}


function reservationsHtml(reservations, role) {
  const canUpdate = ["owner", "admin", "manager"].includes(role);
  return `
    <div class="reservations-head">
      <div>
        <h2>Reservations</h2>
        <p>${reservations.length} reservation${reservations.length > 1 ? "s" : ""}.</p>
      </div>
      ${canUpdate ? `
        <button class="client-create-btn button-reset" type="button" data-reservation-add-open>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          <strong>Nouvelle reservation</strong>
        </button>
      ` : ""}
    </div>
    <div class="responsive-table reservations-table">
      <div class="table-row table-head reservation-summary"><span>Date</span><span>Client</span><span>Contact</span><span>Couverts</span><span>Statut</span><span>Infos</span></div>
      ${reservations.length ? reservations.map((reservation) => {
        const reservationDate = reservationDateLabel(reservation);
        const reservationTime = reservationTimeLabel(reservation);
        const contact = reservationContactLabel(reservation);
        const source = reservationSourceLabel(reservation);
        const createdBy = reservationCreatedByLabel(reservation);
        return `
        <details class="reservation-card">
          <summary class="table-row reservation-summary">
          <span>${escapeHtml(reservationDate || "Date non renseignee")}</span>
          <span>${escapeHtml(reservation.customerName || reservation.name || reservation.clientName || "")}</span>
          <span>${escapeHtml(contact || "Contact non renseigne")}</span>
          <span>${escapeHtml(reservation.guests || "")}</span>
          <span>${canUpdate ? statusSelectHtml(reservation) : escapeHtml(reservation.status || "pending")}</span>
          <span class="reservation-more-label">Details</span>
          </summary>
          <div class="reservation-details">
            ${reservationDetailItemHtml("Date de la reservation", reservationDayLabel(reservation) || "Date non renseignee")}
            ${reservationDetailItemHtml("Heure", reservationTime || "Heure non renseignee")}
            ${reservationDetailItemHtml("Enregistree le", reservationRecordedLabel(reservation) || "Non renseignee", true)}
            ${reservationDetailItemHtml("Source", source || "Source non renseignee")}
            ${reservationDetailItemHtml("Created by", createdBy || "Created by non renseigne")}
            ${reservationDetailItemHtml("Telephone", firstText(reservation.customerPhone, reservation.phone, reservation.telephone, reservation.customer?.phone))}
            ${reservationDetailItemHtml("Email", firstText(reservation.customerEmail, reservation.email, reservation.contactEmail, reservation.customer?.email))}
            ${reservationDetailItemHtml("Notes", firstText(reservation.notes, reservation.message, reservation.comment), true)}
            ${reservationDetailItemHtml("ID reservation", reservation.id, true)}
          </div>
        </details>
      `;
      }).join("") : `<div class="empty-state">Aucune reservation pour le moment.</div>`}
    </div>
  `;
}

function dashboardReservationFormHtml() {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <form class="platform-form" data-dashboard-reservation-form>
      <div class="form-grid">
        <label>Nom du client<input name="name" required /></label>
        <label>Telephone<input name="phone" type="tel" required /></label>
        <label>Email<input name="email" type="email" /></label>
        <label>Couverts<input name="guests" type="number" min="1" step="1" value="2" required /></label>
        <label>Date<input name="date" type="date" value="${today}" required /></label>
        <label>Heure<input name="time" type="time" required /></label>
      </div>
      <label class="wide-field">Notes<textarea name="message" rows="3" placeholder="Table pres de la fenetre, allergie..."></textarea></label>
      <button class="primary-btn button-reset" type="submit">Ajouter la reservation</button>
      <small data-form-status></small>
    </form>
  `;
}

// Reservation ajoutee manuellement par l'equipe depuis le dashboard : memes regles que le
// formulaire public (horaires d'ouverture, champs obligatoires), source distincte pour
// que "Reservations > Details > Source" indique clairement qui l'a creee.
async function submitDashboardReservation(root, form) {
  const services = await getServices();
  const { addDoc, collection, serverTimestamp, Timestamp } = services.firestoreModule;
  const restaurant = root.dashboardRestaurant || {};
  const restaurantId = root.dataset.restaurantId;
  const data = new FormData(form);
  const date = text(data, "date");
  const time = text(data, "time");
  const customerName = text(data, "name");
  const customerPhone = text(data, "phone");
  const customerEmail = text(data, "email");
  if (!customerName || !customerPhone || !date || !time) {
    throw new Error("Nom, telephone, date et heure sont obligatoires.");
  }
  const reservedAt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(reservedAt.getTime())) throw new Error("Date ou heure invalide.");
  if (!isReservationWithinOpeningHours(restaurant.openingHours, date, time)) {
    throw new Error("Ce creneau est en dehors des horaires d'ouverture.");
  }
  await addDoc(collection(services.db, "restaurants", restaurantId, "reservations"), {
    restaurantId,
    customerName,
    customerPhone,
    customerEmail,
    customer: { name: customerName, phone: customerPhone, email: customerEmail },
    date,
    time,
    phone: customerPhone,
    email: customerEmail,
    guests: Number(text(data, "guests")) || 1,
    notes: text(data, "message"),
    status: "planned",
    reservedAt: Timestamp.fromDate(reservedAt),
    source: "dashboard_admin",
    sourceLabel: "Ajoutee depuis le dashboard",
    reservationSource: "dashboard_admin",
    channel: "dashboard",
    createdBy: currentUser?.uid || "",
    createdByName: currentUser?.displayName || currentUser?.email || "Equipe restaurant",
    createdByType: "staff",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function openDashboardReservationAdd(root) {
  const overlay = showDashboardModal("Nouvelle reservation", dashboardReservationFormHtml());
  const form = overlay.querySelector("[data-dashboard-reservation-form]");
  const status = form.querySelector("[data-form-status]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      status.textContent = "Enregistrement...";
      await submitDashboardReservation(root, form);
      closeDashboardModal();
      await renderDashboard(root, currentUser, root.dataset.restaurantId, "reservations");
    } catch (error) {
      status.textContent = error?.code === "permission-denied"
        ? "Action refusee par Firestore : votre role ne permet pas cette operation."
        : (error.message || String(error));
    }
  });
}

function reservationDetailItemHtml(label, value, wide = false) {
  return `
    <div class="reservation-detail-item${wide ? " is-wide" : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "-")}</strong>
    </div>
  `;
}

function reservationDateLabel(reservation = {}) {
  const explicitDate = firstText(reservation.date, reservation.reservationDate, reservation.day, reservation.bookingDate);
  const explicitTime = firstText(reservation.time, reservation.reservationTime, reservation.hour, reservation.bookingTime);
  if (explicitDate || explicitTime) return `${reservationDayLabel(reservation)} ${explicitTime}`.trim();
  const date = dateFromFirestoreValue(reservation.reservedAt || reservation.reservationAt || reservation.dateTime || reservation.startAt || reservation.createdFor);
  if (!date) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

// Jour du service seul (l'heure a son propre champ) : « 19/09/2026 ».
function reservationDayLabel(reservation = {}) {
  const explicitDate = firstText(reservation.date, reservation.reservationDate, reservation.day, reservation.bookingDate);
  if (explicitDate) {
    const parts = explicitDate.split("-");
    if (parts.length === 3 && parts[0].length === 4) return `${parts[2].slice(0, 2)}/${parts[1]}/${parts[0]}`;
    return explicitDate;
  }
  const date = dateFromFirestoreValue(reservation.reservedAt || reservation.reservationAt || reservation.dateTime || reservation.startAt || reservation.createdFor);
  return date ? clientDateLabel(date) : "";
}

// Moment ou la reservation a ete prise (createdAt), pas celui du repas : « 19/09/2026 a 18:57 ».
function reservationRecordedLabel(reservation = {}) {
  const date = dateFromFirestoreValue(reservation.createdAt);
  if (!date) return "";
  const day = clientDateLabel(date);
  const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${day} a ${time}`;
}

function reservationTimeLabel(reservation = {}) {
  const explicitTime = firstText(reservation.time, reservation.reservationTime, reservation.hour, reservation.bookingTime);
  if (explicitTime) return explicitTime;
  const date = dateFromFirestoreValue(reservation.reservedAt || reservation.reservationAt || reservation.dateTime || reservation.startAt || reservation.createdFor);
  if (!date) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function reservationContactLabel(reservation = {}) {
  const customer = reservation.customer || {};
  const contact = reservation.contact || {};
  return firstText(
    reservation.customerPhone,
    reservation.phone,
    reservation.telephone,
    reservation.mobile,
    reservation.contactPhone,
    customer.phone,
    typeof contact === "object" ? contact.phone : "",
    reservation.customerEmail,
    reservation.email,
    reservation.contactEmail,
    customer.email,
    typeof contact === "object" ? contact.email : "",
    typeof contact === "string" ? contact : ""
  );
}

function reservationSourceLabel(reservation = {}) {
  const rawSource = firstText(reservation.sourceLabel, reservation.reservationSource, reservation.source, reservation.channel);
  const originHost = safeHostname(firstText(reservation.origin, reservation.referrer, reservation.sourceHost));
  const normalized = rawSource.toLowerCase();
  if (!rawSource && isLegacyAppReservation(reservation)) return "Application Poket Restaurants";
  if (normalized.includes("external_site_hook") || normalized.includes("hook")) {
    return originHost ? `Site ${originHost} via hook` : "Site externe via hook";
  }
  if (normalized.includes("poksol_public_page") || normalized.includes("public_site")) return "Page publique Poksol";
  if (normalized.includes("app_user") || normalized.includes("application") || normalized.includes("poket_app")) return "Application Poket Restaurants";
  if (originHost && !/(^|\.)poksol\.com$/i.test(originHost)) return `Site ${originHost}`;
  return rawSource;
}

function reservationCreatedByLabel(reservation = {}) {
  const createdBy = reservation.createdBy || {};
  const creatorName = firstText(
    reservation.createdByName,
    reservation.createdByDisplayName,
    typeof createdBy === "object" ? createdBy.name : "",
    typeof createdBy === "object" ? createdBy.email : "",
    typeof createdBy === "string" ? createdBy : "",
    reservation.createdByUid,
    reservation.userId,
    reservation.uid
  );
  const normalized = creatorName.toLowerCase();
  if (!creatorName && isLegacyAppReservation(reservation)) return "Application Poket Restaurants";
  if (normalized === "poksol_public_page") return "Page publique Poksol";
  if (normalized === "external_site_hook") return reservationSourceLabel(reservation) || "Hook site externe";
  return creatorName;
}

function isLegacyAppReservation(reservation = {}) {
  const hasKnownSource = firstText(reservation.sourceLabel, reservation.reservationSource, reservation.source, reservation.channel, reservation.origin, reservation.referrer, reservation.sourceHost);
  if (hasKnownSource) return false;
  const id = String(reservation.id || "");
  const looksImported = id.startsWith("wp_");
  return !looksImported && Boolean(
    reservation.customerName ||
    reservation.phone ||
    reservation.customerPhone ||
    reservation.reservedAt ||
    reservation.createdAt ||
    reservation.updatedAt
  );
}

function dateFromFirestoreValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function reservationSortTime(reservation = {}) {
  return dateFromFirestoreValue(
    reservation.createdAt ||
    reservation.reservedAt ||
    reservation.reservationAt ||
    reservation.dateTime ||
    reservation.startAt ||
    reservation.updatedAt
  )?.getTime() || 0;
}

function accessRequestsHtml(requests = []) {
  const pending = requests.filter((request) => request.status === "pending");
  return `
    <section class="access-requests" aria-labelledby="access-requests-title">
      <div class="access-requests-head">
        <h3 id="access-requests-title">Demandes d'acces</h3>
        <span class="access-requests-count">${pending.length}</span>
      </div>
      ${pending.length ? pending.map((request) => `
        <form class="access-request-row" data-dashboard-access-form data-request-id="${escapeAttr(request.id)}">
          <div class="access-request-who">
            <strong>${escapeHtml(request.displayName || request.email || request.id)}</strong>
            <small>${escapeHtml([request.email, clientDateLabel(request.createdAt), request.inviteCode ? `code ${request.inviteCode}` : ""].filter(Boolean).join(" · "))}</small>
          </div>
          <label>Role
            <select name="role">
              ${["staff", "manager", "admin"].map((value) => `<option value="${value}" ${normalizeRole(request.requestedRole) === value ? "selected" : ""}>${escapeHtml(ROLE_LABELS[value])}</option>`).join("")}
            </select>
          </label>
          <label>Poste
            <input name="jobTitle" maxlength="80" value="${escapeAttr(request.jobTitle || "")}" placeholder="Ex : Serveur" />
          </label>
          <div class="access-request-actions">
            <button class="primary-btn button-reset" type="submit" value="approve">Valider</button>
            <button class="ghost-action button-reset" type="submit" value="reject">Refuser</button>
          </div>
          <small data-form-status></small>
        </form>
      `).join("") : `<p class="portal-muted">Aucune demande en attente.</p>`}
    </section>
  `;
}

function sortedTeamMembers(members) {
  return [...members].sort((a, b) => {
    const activeA = (a.status || "active") === "active" ? 0 : 1;
    const activeB = (b.status || "active") === "active" ? 0 : 1;
    if (activeA !== activeB) return activeA - activeB;
    const nameA = (a.displayName || a.email || "").toLowerCase();
    const nameB = (b.displayName || b.email || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

function teamStatusBadgeHtml(status) {
  const isActive = (status || "active") === "active";
  return `<span class="team-status-badge ${isActive ? "is-active" : "is-inactive"}">${isActive ? "Actif" : "Inactif"}</span>`;
}

function teamHtml(members, canManageTeam, accessRequests = []) {
  const sorted = sortedTeamMembers(members);
  return `
    ${canManageTeam ? accessRequestsHtml(accessRequests) : ""}
    <div class="responsive-table team-table">
      <div class="table-row table-head"><span>Nom</span><span>Email</span><span>Role</span><span>Statut</span></div>
      ${sorted.length ? sorted.map((member) => {
        const hasProfile = !!(member.displayName || member.email);
        return `
        <div class="table-row ${(member.status || "active") === "active" ? "" : "is-inactive-row"}">
          <span class="team-member-name">
            <span class="team-avatar" aria-hidden="true">${escapeHtml(userInitials(member.displayName, member.email))}</span>
            ${hasProfile ? escapeHtml(member.displayName || member.email) : `<em class="team-member-incomplete">Profil incomplet</em>`}
          </span>
          <span>${escapeHtml(member.email || "—")}</span>
          <span>${escapeHtml(ROLE_LABELS[member.role] || member.role || "staff")}</span>
          <span>${teamStatusBadgeHtml(member.status)}</span>
        </div>
      `;
      }).join("") : `<div class="empty-state">Aucun membre trouve.</div>`}
    </div>
    ${canManageTeam ? `
      <form class="platform-form invite-form" data-dashboard-invite-form>
        <h3>Inviter un membre</h3>
        <div class="form-grid">
          <label>Email<input name="email" type="email" /></label>
          <label>Role
            <select name="role">
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label>Code invitation<input name="code" placeholder="Auto si vide" /></label>
        </div>
        <button class="primary-btn button-reset" type="submit">Creer l'invitation</button>
        <small data-form-status></small>
      </form>
    ` : `<p class="alert-note">Votre role ne permet pas de gerer l'equipe.</p>`}
  `;
}

function downloadsHtml() {
  return `
    <section class="platform-card downloads-card">
      <p class="eyebrow">Telechargements</p>
      <h2>Poket Restaurants</h2>
      <div class="download-grid">
        <a href="${DOWNLOADS.web}" target="_blank" rel="noopener noreferrer">Ouvrir l'application navigateur</a>
        <a href="${DOWNLOADS.android}" download>Telecharger Android APK</a>
        <a href="${DOWNLOADS.windows}" download>Telecharger Windows</a>
        <span class="disabled-download">iOS bientot disponible</span>
      </div>
    </section>
  `;
}

function parseMenuItems(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [category, name, description, price] = line.split("|").map((part) => (part || "").trim());
      return { category, name, description, price };
    })
    .filter((item) => item.name);
}

function normalizeCatalogCategory(category = {}) {
  const name = firstText(category.name, category.label, category.title, category.categoryName, category.categoryPrefix, category.id);
  const publicDisplayName = firstText(category.publicDisplayName, category.menuDisplayName, category.displayName);
  const publicDisplayOrder = numberValue(category.publicDisplayOrder, category.menuDisplayOrder, category.qrDisplayOrder);
  return {
    ...category,
    id: category.id || "",
    name,
    displayName: publicDisplayName || name,
    description: firstText(category.publicDescription, category.menuDescription, category.description),
    publicVisible: category.publicVisible === true,
    publicDisplayOrder,
    catalogDisplayOrder: numberValue(category.displayOrder, category.order, category.position, category.sortOrder),
    displayOrder: publicDisplayOrder || numberValue(category.displayOrder, category.order, category.position, category.sortOrder)
  };
}

function normalizeCatalogItem(item = {}) {
  const name = firstText(item.name, item.label, item.title, item.itemName, item.productName, item.designation, item.id);
  const publicDisplayName = firstText(item.publicDisplayName, item.menuDisplayName, item.displayName);
  const catalogPrice = firstDefinedMenuPrice(item.price, item.priceOnSite, item.priceTakeaway, item.priceTtc, item.salePrice, item.defaultPrice, item.unitPrice, item.amount);
  const publicPrice = firstDefinedMenuPrice(item.publicPrice, item.menuPrice);
  const price = catalogPrice || publicPrice;
  return {
    ...item,
    id: item.id || "",
    categoryId: item.categoryId || "",
    name,
    displayName: publicDisplayName || name,
    description: firstText(item.publicDescription, item.menuDescription, item.description, item.shortDescription),
    imageUrl: firstText(item.imageUrl, item.publicImageUrl, item.photoUrl, item.pictureUrl, item.image),
    publicPrice,
    price,
    catalogPrice,
    catalogPriceLabel: formatPrice(catalogPrice),
    priceLabel: formatPrice(price),
    publicVisible: item.publicVisible === true,
    displayOrder: numberValue(item.displayOrder, item.order, item.position, item.sortOrder)
  };
}

function isPublicCatalogEntry(entry = {}) {
  return entry.publicVisible === true && entry.active !== false && !entry.deletedAt && entry.deleted !== true;
}

function sortByDisplayOrder(a = {}, b = {}) {
  const orderDelta = numberValue(a.displayOrder) - numberValue(b.displayOrder);
  if (orderDelta) return orderDelta;
  return String(a.displayName || a.name || a.id || "").localeCompare(String(b.displayName || b.name || b.id || ""), "fr");
}

function firstText(...values) {
  const found = values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
  return found === undefined ? "" : String(found).trim();
}

function firstDefinedMenuPrice(...values) {
  const found = values.find((value) => value !== undefined && value !== null && String(value).trim() !== "" && !isUndefinedMenuPrice(value));
  return found === undefined ? "" : String(found).trim();
}

function isUndefinedMenuPrice(value) {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized === "undefined" ||
    normalized === "nan" ||
    normalized === "null" ||
    normalized.includes("indefini") ||
    normalized.includes("non defini") ||
    normalized.includes("non renseigne") ||
    normalized.includes("a saisir") ||
    normalized.includes("sur le champ");
}

function numberValue(...values) {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null && candidate !== "");
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatPrice(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string" && /[€$£]|eur|usd|cad/i.test(value)) return value;
  const number = Number(String(value).replace(",", "."));
  if (!Number.isFinite(number)) return String(value);
  const amount = number > 1000 ? number / 100 : number;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
}

function statusCardHtml(label, value) {
  return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function statusSelectHtml(reservation) {
  const selectedStatus = reservation.status === "pending" ? "planned" : reservation.status;
  return `
    <select data-reservation-status="${escapeAttr(reservation.id)}">
      ${["planned", "arrived", "cancelled", "pending", "confirmed", "refused"].map((status) => `
        <option value="${status}" ${selectedStatus === status ? "selected" : ""}>${status}</option>
      `).join("")}
    </select>
  `;
}

const DASHBOARD_NAV_GROUPS = [
  ["overview", "profile", "hours", "public", "menu"],
  ["reservations", "team"],
  ["clients", "quotes", "invoices"],
  ["downloads"]
];

function tabLabel(tab) {
  return {
    overview: "Overview",
    profile: "Profil",
    hours: "Horaires",
    public: "Page publique",
    menu: "QR menu",
    reservations: "Reservations",
    clients: "Comptes clients",
    quotes: "Devis",
    invoices: "Factures",
    team: "Equipe",
    downloads: "Downloads"
  }[tab] || tab;
}

function normalizeRestaurant(id, data) {
  const profile = data.restaurantProfile || {};
  const addressLine2 = data.addressLine2 || profile.addressLine2 || "";
  const city = data.city || profile.city || "";
  const postalCode = data.postalCode || profile.postalCode || "";
  const country = data.country || profile.country || "France";
  const addressLine1 = cleanStreetLine(data.addressLine1 || profile.addressLine1 || data.address || profile.address || "", postalCode);
  const address = addressLine1
    ? fullAddress(addressLine1, postalCode, city, country)
    : String(data.address || profile.address || "").split(String.fromCharCode(10)).join(", ");
  return {
    id,
    ...data,
    name: data.name || profile.name || profile.tradeName || id,
    slug: data.slug || profile.slug || id,
    logoUrl: data.logoUrl || profile.logoUrl || "",
    documentLogoUrl: data.documentLogoUrl || profile.documentLogoUrl || "",
    description: data.description || profile.description || "",
    cuisineType: data.cuisineType || profile.cuisineType || data.businessType || profile.businessType || "",
    address,
    addressLine1,
    addressLine2,
    city,
    postalCode,
    country,
    phone: data.phone || profile.phone || "",
    email: data.email || profile.email || "",
    siren: data.siren || profile.siren || "",
    siret: data.siret || profile.siret || "",
    vatNumber: data.vatNumber || profile.vatNumber || "",
    legalForm: data.legalForm || profile.legalForm || "",
    shareCapital: data.shareCapital || profile.shareCapital || "",
    rcsCity: data.rcsCity || profile.rcsCity || "",
    apeCode: data.apeCode || profile.apeCode || "",
    iban: data.iban || profile.iban || "",
    bic: data.bic || profile.bic || "",
    billingEmail: data.billingEmail || profile.billingEmail || "",
    billingPhone: data.billingPhone || profile.billingPhone || "",
    paymentTerms: data.paymentTerms || profile.paymentTerms || "",
    latePenaltyTerms: data.latePenaltyTerms || profile.latePenaltyTerms || "",
    recoveryIndemnity: data.recoveryIndemnity || profile.recoveryIndemnity || "",
    invoiceLegalNotice: data.invoiceLegalNotice || profile.invoiceLegalNotice || "",
    // Rempli par poket-access.html (section Facturation), jamais consomme cote app : le site
    // les utilise pour numeroter ses factures (voir createInvoiceFromQuote / buildInvoicePdf).
    invoicePrefix: data.invoicePrefix || profile.invoicePrefix || "FAC",
    nextInvoiceNumber: numberValue(data.nextInvoiceNumber, profile.nextInvoiceNumber) || 1,
    defaultVatOnSite: firstNumber(data.defaultVatOnSite, profile.defaultVatOnSite) ?? 10,
    defaultVatTakeaway: firstNumber(data.defaultVatTakeaway, profile.defaultVatTakeaway) ?? 10,
    openingHours: resolveOpeningHours(data, profile)
  };
}

// SIRET affiche en groupes (890 295 520 00013) quand il compte bien 14 chiffres.
function formatSiret(value = "") {
  const raw = String(value || "").trim();
  const digits = raw.split(" ").join("");
  if ((digits.length !== 14 && digits.length !== 9) || !digits.split("").every((char) => char >= "0" && char <= "9")) return raw;
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9), digits.slice(9)].filter(Boolean).join(" ");
}

// Le SIRET compte 14 chiffres, le SIREN 9 : on les reconnait a leur longueur, meme si les
// deux ont ete saisis dans la mauvaise case du formulaire Facturation.
function legalIdentifiers(restaurant = {}) {
  const digitsOf = (value) => String(value || "").split("").filter((char) => char >= "0" && char <= "9").join("");
  const found = [restaurant.siret, restaurant.siren].map(digitsOf).filter(Boolean);
  const siret = found.find((digits) => digits.length === 14) || "";
  const siren = found.find((digits) => digits.length === 9) || siret.slice(0, 9);
  return { siret, siren };
}

// Ligne de rue seule. Une fiche enregistree avec « rue + code postal + ville + pays » colles
// (retours a la ligne perdus dans un champ texte) est ramenee a la rue : premiere ligne
// seulement, coupee au code postal quand il s'y trouve. Sans code postal dans la ligne,
// la rue est laissee telle quelle (« Rue de Marseille » reste intacte).
function cleanStreetLine(value, postalCode = "") {
  const street = String(value || "").split(String.fromCharCode(13)).join("").split(String.fromCharCode(10))[0].trim();
  const zip = String(postalCode || "").trim();
  const at = zip ? street.indexOf(zip) : -1;
  return (at > 0 ? street.slice(0, at) : street).replace(/[ ,;-]+$/, "").trim();
}

function fullAddress(addressLine1, postalCode, city, country) {
  return [
    addressLine1,
    [postalCode, city].filter(Boolean).join(" "),
    country
  ].filter(Boolean).join(", ");
}

function readableFirebaseError(error) {
  const raw = error?.code || error?.message || String(error || "");
  if (raw.includes("storage/unauthorized")) {
    return "Upload refuse par Firebase Storage. Verifiez que vous etes connecte, que les regles Storage sont deployees et que l'image fait moins de 5 Mo.";
  }
  if (raw.includes("permission-denied")) {
    return "Acces refuse par Firestore. Les regles Firebase doivent autoriser le membre du restaurant a lire ce dashboard.";
  }
  if (raw.includes("unauthorized-domain")) {
    return "Domaine non autorise dans Firebase Authentication.";
  }
  if (raw.includes("network")) {
    return "Connexion reseau ou Firebase indisponible.";
  }
  return raw || "Erreur inconnue pendant le chargement du dashboard.";
}

function validateImageUpload(file) {
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    throw new Error(`Fichier invalide : "${file.name}" n'est pas une image.`);
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error(`Image trop volumineuse : "${file.name}" fait ${formatFileSize(file.size)}. La limite est ${formatFileSize(MAX_IMAGE_UPLOAD_BYTES)}.`);
  }
}

function formatFileSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1).replace(".", ",")} Mo`;
  if (value >= 1024) return `${Math.round(value / 1024)} Ko`;
  return `${value} octets`;
}

function normalizeHours(hours) {
  if (!hours) return defaultOpeningHours();
  if (!Array.isArray(hours)) {
    const normalized = emptyOpeningHours();
    DAYS.forEach(([key]) => {
      normalized[key] = normalizeDaySlots(hours[key]);
    });
    Object.entries(hours).forEach(([rawKey, value]) => {
      const dayKey = dayKeyFromValue(value?.day ?? value?.dayKey ?? value?.weekday ?? rawKey);
      if (!dayKey) return;
      const slots = normalizeDaySlots(value);
      if (slots.length || !normalized[dayKey]?.length) normalized[dayKey] = slots;
    });
    return normalized;
  }
  return hours.reduce((acc, item) => {
    const day = dayKeyFromValue(item.day ?? item.dayKey ?? item.weekday);
    if (!day) return acc;
    acc[day] = normalizeDaySlots(item);
    return acc;
  }, emptyOpeningHours());
}

function defaultOpeningHours() {
  return DAYS.reduce((acc, [key], index) => {
    acc[key] = index === 6 ? [] : [{ open: "09:00", close: "22:00" }];
    return acc;
  }, {});
}

function emptyOpeningHours() {
  return DAYS.reduce((acc, [key]) => {
    acc[key] = [];
    return acc;
  }, {});
}

function normalizeDaySlots(day) {
  if (!day) return [];
  if (Array.isArray(day)) return day.map(normalizeSlot).filter(Boolean);
  if (day.open === false || day.isOpen === false || day.closed === true) return [];
  const nestedSlots = day.slots || day.periods || day.ranges || day.services;
  if (Array.isArray(nestedSlots)) return nestedSlots.map(normalizeSlot).filter(Boolean);
  const slots = [];
  const lunch = day.lunch || day.midi || day.noon;
  const dinner = day.dinner || day.soir || day.evening;
  const lunchStart = day.lunchStart || day.midiStart || day.noonStart || lunch?.start || lunch?.open || lunch?.from;
  const lunchEnd = day.lunchEnd || day.midiEnd || day.noonEnd || lunch?.end || lunch?.close || lunch?.to;
  const dinnerStart = day.dinnerStart || day.soirStart || day.eveningStart || dinner?.start || dinner?.open || dinner?.from;
  const dinnerEnd = day.dinnerEnd || day.soirEnd || day.eveningEnd || dinner?.end || dinner?.close || dinner?.to;
  if (lunchStart && lunchEnd) slots.push({ open: lunchStart, close: lunchEnd });
  if (dinnerStart && dinnerEnd) slots.push({ open: dinnerStart, close: dinnerEnd });
  if (!slots.length) {
    const open = day.openTime || day.openingTime || day.opensAt || day.startTime || day.start || day.from || day.open;
    const close = day.closeTime || day.closingTime || day.closesAt || day.endTime || day.end || day.to || day.close;
    if (open && close && open !== true) slots.push({ open, close });
  }
  return slots.map(normalizeSlot).filter(Boolean);
}

function normalizeSlot(slot) {
  if (!slot) return null;
  const open = normalizeTime(slot.open || slot.start || slot.from);
  const close = normalizeTime(slot.close || slot.end || slot.to);
  return open && close ? { open, close } : null;
}

function normalizeTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function dayKeyFromValue(value) {
  if (typeof value === "number" || /^\d+$/.test(String(value || ""))) {
    const number = Number(value);
    if (number >= 1 && number <= 7) return DAYS[number - 1]?.[0] || "";
    if (number >= 0 && number <= 6) return DAYS[number]?.[0] || "";
    return "";
  }
  const clean = normalizeSlug(value);
  const aliases = {
    lundi: "monday",
    mardi: "tuesday",
    mercredi: "wednesday",
    jeudi: "thursday",
    vendredi: "friday",
    samedi: "saturday",
    dimanche: "sunday",
    mon: "monday",
    tue: "tuesday",
    tuesday: "tuesday",
    wed: "wednesday",
    thu: "thursday",
    fri: "friday",
    sat: "saturday",
    sun: "sunday"
  };
  return aliases[clean] || DAYS.find(([key, label]) => clean === key || clean === normalizeSlug(label))?.[0] || "";
}

function hoursHtml(hours) {
  const normalized = normalizeHours(hours);
  return DAYS.map(([key, label]) => {
    const slots = normalized[key] || [];
    return `<li><span>${label}</span><strong>${slots.length ? slots.map((slot) => `${slot.open} - ${slot.close}`).join(" / ") : "Ferme"}</strong></li>`;
  }).join("");
}

function openingHoursToList(hoursByDay) {
  return DAYS.map(([key], index) => {
    const day = hoursByDay[key] || {};
    return {
      day: index + 1,
      isOpen: day.open !== false,
      lunchStart: normalizeTime(day.lunchStart),
      lunchEnd: normalizeTime(day.lunchEnd),
      dinnerStart: normalizeTime(day.dinnerStart),
      dinnerEnd: normalizeTime(day.dinnerEnd)
    };
  });
}

function isReservationWithinOpeningHours(hours, dateValue, timeValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const dayKey = DAYS[(date.getDay() + 6) % 7]?.[0];
  const slots = normalizeHours(hours)[dayKey] || [];
  const requested = minutesFromTime(timeValue);
  return slots.some((slot) => {
    const open = minutesFromTime(slot.open);
    const close = minutesFromTime(slot.close);
    return requested >= open && requested <= close;
  });
}

function minutesFromTime(value) {
  const [hours, minutes] = normalizeTime(value).split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function saveAccessSessionForRestaurant(user, restaurantId, inviteCode = "", role = "") {
  localStorage.setItem("poksolAccessSession", JSON.stringify({
    active: true,
    userId: user?.uid || "",
    email: user?.email || "",
    restaurantId,
    profileComplete: true,
    source: inviteCode ? "invite" : "account",
    inviteCode,
    role,
    updatedAt: new Date().toISOString()
  }));
}

function setupReservationHoursUi(restaurant) {
  const form = document.querySelector("[data-public-reservation-form]");
  if (!form || restaurant.reservationEnabled === false) return;
  const dateInput = form.elements.date;
  let timeInput = form.elements.time;
  if (dateInput && !dateInput.min) dateInput.min = new Date().toISOString().slice(0, 10);
  if (timeInput && timeInput.tagName !== "SELECT") {
    const select = document.createElement("select");
    select.name = timeInput.name;
    select.required = timeInput.required;
    select.className = timeInput.className;
    timeInput.replaceWith(select);
    timeInput = select;
  }
  timeInput?.addEventListener("change", () => {
    form.dataset.selectedTime = timeInput.value || "";
  });
  const submitButton = form.querySelector('button[type="submit"]');
  let note = form.querySelector("[data-reservation-hours-note]");
  if (!note) {
    note = document.createElement("p");
    note.className = "reservation-hours-note";
    note.dataset.reservationHoursNote = "";
    form.insertBefore(note, form.querySelector("[data-form-status]"));
  }
  const updateNote = () => {
    if (!dateInput?.value) {
      note.textContent = "Choisissez une date pour afficher les horaires disponibles.";
      populateReservationTimes(timeInput, [], "Choisissez une date");
      if (submitButton) submitButton.disabled = true;
      return;
    }
    const date = new Date(`${dateInput.value}T00:00:00`);
    const dayKey = DAYS[(date.getDay() + 6) % 7]?.[0];
    const slots = normalizeHours(restaurant.openingHours)[dayKey] || [];
    populateReservationTimes(timeInput, slots, "Choisissez une heure");
    if (submitButton) submitButton.disabled = !slots.length;
    note.textContent = slots.length
      ? `Horaires disponibles : ${slots.map((slot) => `${slot.open} - ${slot.close}`).join(" / ")}.`
      : "Le restaurant est fermé ce jour-là. Choisissez une autre date.";
  };
  dateInput?.addEventListener("change", updateNote);
  dateInput?.addEventListener("input", updateNote);
  updateNote();
}

function resolveOpeningHours(data, profile) {
  const candidates = [
    data.openingHoursByDay,
    profile.openingHoursByDay,
    data.publicOpeningHours,
    profile.publicOpeningHours,
    data.businessHours,
    profile.businessHours,
    data.hours,
    profile.hours,
    data.openingHours,
    profile.openingHours
  ];
  const defined = candidates.filter((candidate) => candidate && (Array.isArray(candidate) || typeof candidate === "object"));
  const withSlots = defined.find((candidate) => hasAnyOpeningSlot(normalizeHours(candidate)));
  return withSlots || defined[0] || defaultOpeningHours();
}

function resolveOpeningHoursByDay(hours, restaurant = {}) {
  const profile = restaurant.restaurantProfile || {};
  const explicit = restaurant.openingHoursByDay || profile.openingHoursByDay;
  if (explicit && !Array.isArray(explicit)) return normalizeOpeningHoursByDay(explicit);
  const source = explicit || hours || restaurant.openingHours || profile.openingHours || defaultOpeningHours();
  return normalizeOpeningHoursByDay(source);
}

function normalizeOpeningHoursByDay(source) {
  if (!source) return emptyOpeningHoursByDay();
  if (!Array.isArray(source)) {
    return DAYS.reduce((acc, [key]) => {
      acc[key] = normalizeDayServices(source[key]);
      return acc;
    }, emptyOpeningHoursByDay());
  }
  return source.reduce((acc, item) => {
    const key = dayKeyFromValue(item.day ?? item.dayKey ?? item.weekday);
    if (key) acc[key] = normalizeDayServices(item);
    return acc;
  }, emptyOpeningHoursByDay());
}

function emptyOpeningHoursByDay() {
  return DAYS.reduce((acc, [key]) => {
    acc[key] = { open: false, lunchStart: "", lunchEnd: "", dinnerStart: "", dinnerEnd: "" };
    return acc;
  }, {});
}

function normalizeDayServices(day) {
  const empty = { open: false, lunchStart: "", lunchEnd: "", dinnerStart: "", dinnerEnd: "" };
  if (!day) return empty;
  if (day.open === false || day.isOpen === false || day.closed === true) return empty;
  const lunchStart = normalizeTime(day.lunchStart || day.midiStart || day.noonStart || day.lunch?.start || day.lunch?.open || day.lunch?.from);
  const lunchEnd = normalizeTime(day.lunchEnd || day.midiEnd || day.noonEnd || day.lunch?.end || day.lunch?.close || day.lunch?.to);
  const dinnerStart = normalizeTime(day.dinnerStart || day.soirStart || day.eveningStart || day.dinner?.start || day.dinner?.open || day.dinner?.from);
  const dinnerEnd = normalizeTime(day.dinnerEnd || day.soirEnd || day.eveningEnd || day.dinner?.end || day.dinner?.close || day.dinner?.to);
  if (lunchStart && lunchEnd || dinnerStart && dinnerEnd) {
    return { open: true, lunchStart, lunchEnd, dinnerStart, dinnerEnd };
  }
  const slots = normalizeDaySlots(day);
  const inferred = { ...empty };
  slots.forEach((slot) => {
    const openMinutes = minutesFromTime(slot.open);
    if (openMinutes < 17 * 60 && !inferred.lunchStart) {
      inferred.lunchStart = slot.open;
      inferred.lunchEnd = slot.close;
    } else if (!inferred.dinnerStart) {
      inferred.dinnerStart = slot.open;
      inferred.dinnerEnd = slot.close;
    }
  });
  inferred.open = !!(inferred.lunchStart && inferred.lunchEnd || inferred.dinnerStart && inferred.dinnerEnd);
  return inferred;
}

function hasAnyOpeningSlot(hours) {
  return DAYS.some(([key]) => (hours[key] || []).length > 0);
}

function populateReservationTimes(input, slots, placeholder = "Aucun horaire disponible") {
  if (!input) return;
  const selectedTime = input.form?.dataset.selectedTime || input.value;
  const options = slots.flatMap((slot) => buildTimeOptions(slot.open, slot.close));
  input.innerHTML = [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...options.map((time) => `<option value="${escapeAttr(time)}">${escapeHtml(time)}</option>`)
  ].join("");
  if (options.includes(selectedTime)) input.value = selectedTime;
  else if (input.form) input.form.dataset.selectedTime = "";
  input.disabled = options.length === 0;
}

function buildTimeOptions(open, close) {
  const start = minutesFromTime(open);
  const end = minutesFromTime(close);
  if (end <= start) return [];
  const result = [];
  for (let minutes = start; minutes <= end; minutes += 30) {
    result.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  }
  return result;
}

function normalizeSlug(value) {
  return (value || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function legacyRestaurantIdFromSlug(value) {
  return normalizeSlug(value).replace(/-/g, "_").toUpperCase();
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeCode(value) {
  return (value || "").toString().trim().replace(/[^a-zA-Z0-9_-]/g, "").toUpperCase();
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ["owner", "admin", "manager", "staff"].includes(role) ? role : "";
}

function highestRole(values) {
  const priority = {
    owner: 4,
    admin: 3,
    manager: 2,
    staff: 1
  };
  return values
    .map(normalizeRole)
    .filter(Boolean)
    .sort((a, b) => priority[b] - priority[a])[0] || "";
}

function text(data, key) {
  return (data.get(key) || "").toString().trim();
}

function disabled(canEdit) {
  return canEdit ? "" : "disabled";
}

function setText(selector, value) {
  document.querySelectorAll(selector).forEach((element) => {
    if (value) element.textContent = value;
  });
}

function setHref(selector, value) {
  document.querySelectorAll(selector).forEach((element) => {
    if (value) element.href = value;
  });
}

function emptyHtml(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function alertHtml(message) {
  return `<section class="platform-card"><p class="alert-note">${escapeHtml(message)}</p></section>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function escapeAttr(value = "") {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

initAccountPage();
initDashboardPage();
initPublicRestaurantPage();
initPublicMenuPage();
initContactForms();

