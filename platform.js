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
  android: "https://poksol.com/downloads/poket-restaurants/android/chez_marwan_pos_1.0.6+39.apk",
  windows: "https://poksol.com/downloads/poket-restaurants/windows/poket_restaurants_windows_1.0.6+39.zip"
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
    const memberSnap = await getDoc(doc(services.db, "restaurants", id, "members", uid));
    const memberRole = memberSnap.exists() ? normalizeRole(memberSnap.data().role) : "";
    const role = highestRole([restaurant.ownerUid === uid || restaurant.createdBy === uid ? "owner" : "", memberRole]) || "staff";
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
  await setDoc(doc(services.db, "restaurants", slug, "members", user.uid), {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    role: "owner",
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
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

async function joinRestaurantWithCode(code, user) {
  const services = await getServices();
  const { arrayUnion, collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where } = services.firestoreModule;
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) throw new Error("Code invitation obligatoire.");

  let inviteRef = doc(services.db, "invitations", normalizedCode);
  let inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) {
    const topLevel = await getDocs(query(collection(services.db, "invitations"), where("code", "==", normalizedCode), limit(1)));
    if (!topLevel.empty) {
      inviteSnap = topLevel.docs[0];
      inviteRef = inviteSnap.ref;
    }
  }
  if (!inviteSnap.exists()) {
    inviteRef = doc(services.db, "restaurant_invites", normalizedCode);
    inviteSnap = await getDoc(inviteRef);
  }
  if (!inviteSnap.exists()) throw new Error("Invitation introuvable.");

  const invite = inviteSnap.data();
  if (["revoked", "expired"].includes(invite.status) || invite.active === false) {
    throw new Error("Invitation inactive ou expiree.");
  }
  if (invite.expiresAt?.toDate && invite.expiresAt.toDate() < new Date()) {
    throw new Error("Invitation expiree.");
  }
  if (invite.email && user.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new Error("Cette invitation est reservee a une autre adresse email.");
  }
  const restaurantId = invite.restaurantId;
  if (!restaurantId) throw new Error("Invitation incomplete : restaurant manquant.");

  const role = invite.role || "staff";
  const staffPayload = {
    uid: user.uid,
    userId: user.uid,
    restaurantId,
    email: user.email || "",
    displayName: user.displayName || "",
    role,
    active: true,
    status: "active",
    inviteCode: normalizedCode,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(services.db, "restaurants", restaurantId, "staff", user.uid), staffPayload, { merge: true });
  await setDoc(doc(services.db, "restaurants", restaurantId, "members", user.uid), {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    role,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  await setDoc(doc(services.db, "restaurants", restaurantId, "staff_users", user.uid), {
    ...staffPayload,
    updatedAt: new Date().toISOString()
  }, { merge: true });
  await setDoc(doc(services.db, "users", user.uid), {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    activeRestaurantId: restaurantId,
    restaurantIds: arrayUnion(restaurantId),
    joinedInviteCode: normalizedCode,
    updatedAt: serverTimestamp()
  }, { merge: true });
  await updateDoc(inviteRef, {
    acceptedBy: arrayUnion(user.uid),
    lastAcceptedBy: user.uid,
    lastAcceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }).catch(() => {});
  localStorage.setItem("poksolActiveRestaurantId", restaurantId);
  saveAccessSessionForRestaurant(user, restaurantId, normalizedCode, role);
  return getRestaurant(restaurantId);
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
  const logoUrl = logoFile ? await uploadRestaurantImage(restaurantId, logoFile, "logo") : text(data, "logoUrl") || existing?.logoUrl || "";
  const coverUrl = coverFile ? await uploadRestaurantImage(restaurantId, coverFile, "cover") : text(data, "coverUrl") || existing?.coverUrl || "";
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
  await setDoc(doc(services.db, "restaurants", restaurantId), {
    publicPageEnabled: data.get("publicPageEnabled") === "on",
    qrMenuEnabled: data.get("qrMenuEnabled") === "on",
    reservationEnabled: data.get("reservationEnabled") === "on",
    publicPageSettings: {
      visibleSections: {
        hero: true,
        hours: true,
        menu: true,
        reservations: data.get("reservationEnabled") === "on",
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

  await setDoc(doc(services.db, "restaurants", restaurantId), {
    qrMenuEnabled: data.get("isActive") === "on",
    updatedAt: serverTimestamp()
  }, { merge: true });
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
      return {
        collectionName,
        customers: snaps.docs.map((snap) => ({ id: snap.id, customerCollection: collectionName, ...snap.data() }))
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

async function createCustomerAccount(restaurantId, form, user) {
  const services = await getServices();
  const { addDoc, collection, serverTimestamp } = services.firestoreModule;
  const data = customerAccountPayload(form);
  if (!data.displayName && !data.phone && !data.email) {
    throw new Error("Renseignez au moins un nom, un telephone ou un email.");
  }
  await addDoc(collection(services.db, "restaurants", restaurantId, "customers"), {
    ...data,
    active: true,
    createdBy: user?.uid || "",
    createdByEmail: user?.email || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function updateCustomerAccount(restaurantId, form) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const customerId = form.dataset.customerId;
  const customerCollection = customerCollectionName(form.dataset.customerCollection);
  if (!customerId) throw new Error("Client introuvable.");
  const data = customerAccountPayload(form);
  if (!data.displayName && !data.phone && !data.email) {
    throw new Error("Renseignez au moins un nom, un telephone ou un email.");
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
  return {
    type: text(data, "type") || "individual",
    displayName: text(data, "displayName"),
    firstName: text(data, "firstName"),
    lastName: text(data, "lastName"),
    companyName: text(data, "companyName"),
    contactName: text(data, "contactName"),
    phone: text(data, "phone"),
    email: text(data, "email"),
    address: text(data, "address"),
    taxId: text(data, "taxId"),
    vatNumber: text(data, "vatNumber"),
    notes: text(data, "notes")
  };
}

async function getActiveMenu(restaurantId) {
  const services = await getServices();
  const { doc, getDoc } = services.firestoreModule;
  const snap = await getDoc(doc(services.db, "restaurants", restaurantId, "menus", "main"));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
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
  const [membersSnap, staffSnap, staffUsersSnap] = await Promise.all([
    getDocs(collection(services.db, "restaurants", restaurantId, "members")).catch(() => null),
    getDocs(collection(services.db, "restaurants", restaurantId, "staff")).catch(() => null),
    getDocs(collection(services.db, "restaurants", restaurantId, "staff_users")).catch(() => null)
  ]);
  const byUid = new Map();
  [membersSnap, staffSnap, staffUsersSnap].forEach((snap) => {
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
  const invite = {
    restaurantId,
    email: text(data, "email"),
    role: text(data, "role") || "staff",
    code,
    createdByUid: user.uid,
    status: "pending",
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(services.db, "invitations", code), invite);
  await setDoc(doc(services.db, "restaurant_invites", code), invite, { merge: true });
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
    throw new Error("Ce crÃ©neau est en dehors des horaires d'ouverture. Choisissez une heure ouverte ou contactez le restaurant.");
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
        const restaurant = await joinRestaurantWithCode(form.code.value, currentUser);
        status.textContent = `Restaurant rejoint : ${restaurant?.name || "OK"}.`;
        await renderAccount(root, currentUser);
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
  root.innerHTML = accountSignedInHtml(user, restaurants);
}

function initDashboardPage() {
  const root = document.querySelector("[data-dashboard-root]");
  if (!root) return;
  root.innerHTML = alertHtml("Chargement du dashboard...");
  root.addEventListener("click", (event) => {
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
    const clientExport = event.target.closest("[data-client-export]");
    if (clientExport) {
      event.preventDefault();
      exportVisibleCustomers(root);
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
    try {
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
    } catch (error) {
      status.textContent = error.message || String(error);
    }
  });
  root.addEventListener("change", async (event) => {
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
    if (event.target.matches("[data-client-filter], [data-client-sort]")) {
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
  const [reservations, customerAccounts, members, menu, catalogMenu] = await Promise.all([
    listReservations(restaurant.id).catch(() => []),
    listCustomers(restaurant.id).catch((error) => ({ customers: [], errors: [readableFirebaseError(error)], checkedCollections: [] })),
    listMembers(restaurant.id).catch(() => []),
    getActiveMenu(restaurant.id).catch(() => null),
    listCatalogMenu(restaurant.id).catch(() => null)
  ]);
  const dashboardMenu = catalogMenu?.categories?.length
    ? { ...(menu || {}), ...catalogMenu, title: menu?.title || catalogMenu.title, type: menu?.type || "catalog" }
    : menu;
  root.innerHTML = dashboardHtml(restaurant, role, reservations, customerAccounts, members, dashboardMenu, activeTab);
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
  const services = await getServices();
  const { doc, getDoc, serverTimestamp, setDoc } = services.firestoreModule;
  const restaurantId = restaurant.id;
  const ownerLike = restaurant.ownerUid === user.uid || restaurant.createdBy === user.uid;
  if (ownerLike) {
    await setDoc(doc(services.db, "restaurants", restaurantId, "members", user.uid), {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "",
      role: "owner",
      status: "active",
      updatedAt: serverTimestamp()
    }, { merge: true }).catch(() => {});
    return "owner";
  }
  const memberSnap = await getDoc(doc(services.db, "restaurants", restaurantId, "members", user.uid)).catch(() => null);
  const memberRole = memberSnap?.exists() ? normalizeRole(memberSnap.data().role) : "";
  const staffSnap = await getDoc(doc(services.db, "restaurants", restaurantId, "staff", user.uid)).catch(() => null);
  const staffRole = staffSnap?.exists() ? normalizeRole(staffSnap.data().role) : "";
  const staffUserSnap = await getDoc(doc(services.db, "restaurants", restaurantId, "staff_users", user.uid)).catch(() => null);
  const staffUserRole = staffUserSnap?.exists() ? normalizeRole(staffUserSnap.data().role) : "";
  return highestRole([memberRole, staffRole, staffUserRole]) || "staff";
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
  setText("[data-public-address]", [restaurant.address, restaurant.postalCode, restaurant.city].filter(Boolean).join(", "));
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

function dashboardHtml(restaurant, role, reservations, customers, members, menu, activeTab = "overview") {
  const canEditProfile = ["owner", "admin", "manager"].includes(role);
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
        ${["overview", "profile", "hours", "public", "menu", "reservations", "clients", "team", "downloads"].map((tab, index) => `
          <button class="${tab === activeTab ? "is-active" : ""}" type="button" data-dashboard-tab="${tab}">${tabLabel(tab)}</button>
        `).join("")}
      </nav>
      <section class="dashboard-panel ${activeTab === "overview" ? "is-active" : ""}" data-dashboard-panel="overview">${overviewHtml(restaurant, publicUrl)}</section>
      <section class="dashboard-panel ${activeTab === "profile" ? "is-active" : ""}" data-dashboard-panel="profile">${profileFormHtml(restaurant, canEditProfile)}</section>
      <section class="dashboard-panel ${activeTab === "hours" ? "is-active" : ""}" data-dashboard-panel="hours">${hoursFormHtml(restaurant, canEditProfile)}</section>
      <section class="dashboard-panel ${activeTab === "public" ? "is-active" : ""}" data-dashboard-panel="public">${publicSettingsHtml(restaurant, publicUrl, canEditProfile)}</section>
      <section class="dashboard-panel ${activeTab === "menu" ? "is-active" : ""}" data-dashboard-panel="menu">${menuFormHtml(restaurant, menu, canEditProfile)}</section>
      <section class="dashboard-panel ${activeTab === "reservations" ? "is-active" : ""}" data-dashboard-panel="reservations">${reservationsHtml(reservations, role)}</section>
      <section class="dashboard-panel ${activeTab === "clients" ? "is-active" : ""}" data-dashboard-panel="clients">${clientsHtml(customers, reservations)}</section>
      <section class="dashboard-panel ${activeTab === "team" ? "is-active" : ""}" data-dashboard-panel="team">${teamHtml(members, canManageTeam)}</section>
      <section class="dashboard-panel ${activeTab === "downloads" ? "is-active" : ""}" data-dashboard-panel="downloads">${downloadsHtml()}</section>
    </div>
  `;
}

function overviewHtml(restaurant, publicUrl) {
  const generalInfo = [
    ["Nom", restaurant.name],
    ["Type cuisine", restaurant.cuisineType],
    ["Telephone", restaurant.phone],
    ["Email", restaurant.email],
    ["Adresse", restaurant.addressLine1 || restaurant.address],
    ["Ville", [restaurant.postalCode, restaurant.city].filter(Boolean).join(" ")],
    ["Pays", restaurant.country || "France"],
    ["Site web", restaurant.website]
  ].filter(([, value]) => String(value || "").trim().length);
  return `
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
        <label>Adresse<input name="address" value="${escapeAttr(restaurant.addressLine1 || restaurant.address)}" ${disabled(canEdit)} /></label>
        <label>Ville<input name="city" value="${escapeAttr(restaurant.city)}" ${disabled(canEdit)} /></label>
        <label>Code postal<input name="postalCode" value="${escapeAttr(restaurant.postalCode)}" ${disabled(canEdit)} /></label>
        <label>Pays<input name="country" value="${escapeAttr(restaurant.country || "France")}" ${disabled(canEdit)} /></label>
        <label>Site web<input name="website" value="${escapeAttr(restaurant.website)}" ${disabled(canEdit)} /></label>
        <label>Instagram<input name="instagram" value="${escapeAttr(restaurant.instagram)}" ${disabled(canEdit)} /></label>
        <label>Facebook<input name="facebook" value="${escapeAttr(restaurant.facebook)}" ${disabled(canEdit)} /></label>
        <label>Google Maps URL<input name="googleMapsUrl" value="${escapeAttr(restaurant.googleMapsUrl)}" ${disabled(canEdit)} /></label>
        <input type="hidden" name="logoUrl" value="${escapeAttr(restaurant.logoUrl)}" />
        <input type="hidden" name="coverUrl" value="${escapeAttr(restaurant.coverUrl)}" />
        ${profileImageFieldHtml("Logo", "logoFile", restaurant.logoUrl, canEdit, "Logo restaurant")}
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

function publicSettingsHtml(restaurant, publicUrl, canEdit) {
  const settings = restaurant.publicPageSettings || {};
  const theme = settings.theme || {};
  const primaryColor = normalizeHexColor(theme.primaryColor, "#0A2540");
  const accentColor = normalizeHexColor(theme.accentColor, "#1976F3");
  const previewUrl = `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}preview=${Date.now()}`;
  return `
    <form class="platform-form" data-dashboard-public-form>
      <div class="toggle-grid">
        <label><input type="checkbox" name="publicPageEnabled" ${restaurant.publicPageEnabled !== false ? "checked" : ""} ${disabled(canEdit)} /> Page publique active</label>
        <label><input type="checkbox" name="reservationEnabled" ${restaurant.reservationEnabled !== false ? "checked" : ""} ${disabled(canEdit)} /> Reservations actives</label>
        <label><input type="checkbox" name="qrMenuEnabled" ${restaurant.qrMenuEnabled ? "checked" : ""} ${disabled(canEdit)} /> QR menu actif</label>
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
    <label class="profile-image-field">${escapeHtml(label)}
      ${imageUrl ? `
        <span class="profile-image-preview">
          <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(alt)}" loading="lazy" />
          <a href="${escapeAttr(imageUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir</a>
        </span>
      ` : `<span class="profile-image-empty">Aucune image enregistree</span>`}
      <input name="${escapeAttr(inputName)}" type="file" accept="image/png,image/jpeg,image/webp${inputName === "logoFile" ? ",image/svg+xml" : ""}" ${disabled(canEdit)} />
    </label>
  `;
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
          <label>Image<input name="${escapeAttr(fieldPrefix)}.imageFile" type="file" accept="image/png,image/jpeg,image/webp" data-catalog-image-file data-catalog-type="item" data-category-id="${escapeAttr(item.categoryId)}" data-item-id="${escapeAttr(item.id)}" ${disabled(canEdit)} /></label>
          <label class="wide-field">Description article<textarea name="${escapeAttr(fieldPrefix)}.publicDescription" rows="2" data-catalog-autosave data-catalog-type="item" data-category-id="${escapeAttr(item.categoryId)}" data-item-id="${escapeAttr(item.id)}" ${disabled(canEdit)}>${escapeHtml(item.description || "")}</textarea></label>
        </div>
      </div>
    </article>
  `;
}

function previewCatalogImageFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const preview = input.closest(".catalog-item-editor")?.querySelector("[data-catalog-image-preview]");
  if (!preview) return;
  const url = URL.createObjectURL(file);
  setCatalogImagePreview(preview, url, file.name || "Image article", () => URL.revokeObjectURL(url));
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

function clientsHtml(customerAccounts = {}, reservations = []) {
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
  return `
    <div class="clients-dashboard">
      <div class="client-stats">
        ${statusCardHtml("Comptes clients", String(clients.length))}
        ${statusCardHtml("Actifs", String(activeClients))}
        ${statusCardHtml("Avec telephone", String(withPhone))}
        ${statusCardHtml("Avec email", String(withEmail))}
        ${statusCardHtml("Societes", String(companyClients))}
      </div>
      <div class="clients-section-head">
        <div>
          <p class="eyebrow">Restaurant</p>
          <h2>Gestion clients</h2>
        </div>
        <p>Ajoutez, retrouvez, modifiez et exploitez les comptes clients rattaches au restaurant actif.</p>
      </div>
      <details class="client-add-panel">
        <summary>
          <span>Ajouter un client</span>
          <strong>Ouvrir</strong>
        </summary>
        <form class="platform-form customer-account-form" data-dashboard-customer-form data-customer-type-scope data-customer-type="individual">
          ${customerFieldsHtml()}
          <button class="primary-btn button-reset" type="submit">Ajouter un compte client</button>
          <small data-form-status></small>
        </form>
      </details>
      ${readErrors.length ? `<p class="alert-note">Lecture des comptes clients incomplete ou impossible : ${escapeHtml(readErrors.join(" | "))}</p>` : ""}
      ${duplicateWarnings.length ? `
        <div class="client-duplicates" role="status">
          <strong>Doublons possibles</strong>
          ${duplicateWarnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}
        </div>
      ` : ""}
      ${clients.length ? `
        <div class="client-tools" data-client-tools>
          <label>Rechercher
            <input data-client-search placeholder="Nom, telephone, email, societe..." />
          </label>
          <label>Filtrer
            <select data-client-filter>
              <option value="all">Tous les clients</option>
              <option value="active">Actifs</option>
              <option value="inactive">Inactifs</option>
              <option value="with-phone">Avec telephone</option>
              <option value="with-email">Avec email</option>
              <option value="company">Societes</option>
              <option value="individual">Particuliers</option>
            </select>
          </label>
          <label>Trier
            <select data-client-sort>
              <option value="updated-desc">Derniere mise a jour</option>
              <option value="name-asc">Nom A-Z</option>
              <option value="name-desc">Nom Z-A</option>
              <option value="type-asc">Type</option>
              <option value="status-asc">Statut</option>
            </select>
          </label>
          <button class="outline-dark-btn button-reset" type="button" data-client-export>Exporter CSV</button>
          <button class="ghost-action button-reset is-hidden" type="button" data-client-reset>Reinitialiser</button>
          <label>Par page
            <select data-client-page-size>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <span data-client-result-count>${clients.length} client${clients.length > 1 ? "s" : ""}</span>
        </div>
        <div class="responsive-table clients-table">
          <div class="table-row table-head client-row">
            <span>Client</span>
            <span>Contact</span>
            <span>Adresse</span>
            <span>Statut</span>
            <span>Mis a jour</span>
            <span>Compte</span>
          </div>
          ${clients.map((client) => clientCardHtml(client, normalizedReservations)).join("")}
        </div>
        <div class="client-empty-results is-hidden" data-client-empty-results>Aucun client ne correspond a cette recherche.</div>
        <div class="client-pagination ${clients.length <= 25 ? "is-hidden" : ""}" data-client-pagination>
          <button class="outline-dark-btn button-reset" type="button" data-client-page="-1">Precedent</button>
          <span data-client-page-label>Page 1</span>
          <button class="outline-dark-btn button-reset" type="button" data-client-page="1">Suivant</button>
        </div>
      ` : `<div class="empty-state">Aucun compte client pour le moment.</div>`}
    </div>
  `;
}

function clientCardHtml(client, reservations = []) {
  const contactLines = [
    client.phone ? `Tel. ${client.phone}` : "",
    client.email || ""
  ].filter(Boolean);
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
  const statusLabel = client.active === false ? "Inactif" : "Actif";
  const collectionName = customerCollectionName(client.customerCollection);
  const metrics = clientAccountMetrics(client, reservations);
  return `
    <details class="customer-account-card"
      data-client-card
      data-client-name="${escapeAttr((client.displayName || "").toLocaleLowerCase("fr"))}"
      data-client-type="${escapeAttr(client.type)}"
      data-client-active="${client.active === false ? "false" : "true"}"
      data-client-has-phone="${client.phone ? "true" : "false"}"
      data-client-has-email="${client.email ? "true" : "false"}"
      data-client-updated="${String(updatedTime)}"
      data-client-created="${String(createdTime)}"
      data-client-reservations="${String(metrics.reservationCount)}"
      data-client-last-visit="${escapeAttr(metrics.lastVisitLabel)}"
      data-client-search-text="${escapeAttr(normalizeClientSearch(searchText))}">
      <summary class="table-row client-row">
        <span>
          <strong>${escapeHtml(identity[0])}</strong>
          ${identity.slice(1).map((line) => `<small>${escapeHtml(line)}</small>`).join("")}
        </span>
        <span>${contactLines.length ? contactLines.map((line) => `<small>${escapeHtml(line)}</small>`).join("") : "Contact non renseigne"}</span>
        <span>${escapeHtml(client.address || "-")}</span>
        <span><mark class="client-status ${client.active === false ? "is-inactive" : ""}">${statusLabel}</mark></span>
        <span>${escapeHtml(clientDateLabel(client.updatedAt || client.createdAt) || "-")}</span>
        <span class="client-open-label">Ouvrir compte</span>
      </summary>
      <div class="client-account-details">
        ${reservationDetailItemHtml("ID compte", client.id)}
        ${reservationDetailItemHtml("Type", client.type === "company" ? "Societe" : "Particulier")}
        ${reservationDetailItemHtml("Prenom", client.firstName)}
        ${reservationDetailItemHtml("Nom", client.lastName)}
        ${reservationDetailItemHtml("Societe", client.companyName)}
        ${reservationDetailItemHtml("Contact", client.contactName)}
        ${reservationDetailItemHtml("Telephone", client.phone)}
        ${reservationDetailItemHtml("Email", client.email)}
        ${reservationDetailItemHtml("Adresse", client.address)}
        ${reservationDetailItemHtml("Tax ID", client.taxId)}
        ${reservationDetailItemHtml("TVA", client.vatNumber)}
        ${reservationDetailItemHtml("Notes", client.notes)}
        ${reservationDetailItemHtml("Date creation", clientDateLabel(client.createdAt))}
      </div>
      <div class="client-management-grid">
        <details class="client-edit-panel">
          <summary>
            <span>Modifier le client</span>
            <strong>Ouvrir</strong>
          </summary>
          <form class="platform-form client-edit-form" data-dashboard-customer-update-form data-customer-id="${escapeAttr(client.id)}" data-customer-collection="${escapeAttr(collectionName)}" data-customer-type-scope data-customer-type="${escapeAttr(client.type === "company" ? "company" : "individual")}">
            ${customerFieldsHtml(client)}
            <button class="primary-btn button-reset" type="submit">Enregistrer le client</button>
            <small data-form-status></small>
          </form>
        </details>
        <aside class="client-account-side">
          <div>
            <h3>Compte</h3>
            <dl>
              <div><dt>Solde</dt><dd>Non disponible</dd></div>
              <div><dt>Tickets</dt><dd>Non disponible</dd></div>
              <div><dt>Reservations</dt><dd>${escapeHtml(metrics.reservationCount ? String(metrics.reservationCount) : "0")}</dd></div>
              <div><dt>Dernier passage</dt><dd>${escapeHtml(metrics.lastVisitLabel || "Non disponible")}</dd></div>
            </dl>
          </div>
          <div class="client-actions">
            <form data-dashboard-customer-state-form data-customer-id="${escapeAttr(client.id)}" data-customer-collection="${escapeAttr(collectionName)}" data-customer-active="${client.active === false ? "false" : "true"}">
              <button class="outline-dark-btn button-reset" type="submit">${client.active === false ? "Reactiver" : "Desactiver"}</button>
              <small data-form-status></small>
            </form>
            <form data-dashboard-customer-delete-form data-customer-id="${escapeAttr(client.id)}" data-customer-collection="${escapeAttr(collectionName)}" data-customer-name="${escapeAttr(identity[0])}">
              <button class="ghost-action button-reset danger-action" type="button" data-client-delete-arm>Supprimer</button>
              <div class="client-delete-confirm">
                <span>Suppression definitive</span>
                <button class="ghost-action button-reset" type="button" data-client-delete-cancel>Annuler</button>
                <button class="ghost-action button-reset danger-action" type="submit">Confirmer</button>
              </div>
              <small data-form-status></small>
            </form>
          </div>
        </aside>
      </div>
    </details>
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
      <label>Nom affichage<input name="displayName" placeholder="Nom du client" value="${escapeAttr(client.displayName)}" /></label>
      <label data-customer-field="individual">Prenom<input name="firstName" value="${escapeAttr(client.firstName)}" /></label>
      <label data-customer-field="individual">Nom<input name="lastName" value="${escapeAttr(client.lastName)}" /></label>
      <label data-customer-field="company">Societe<input name="companyName" value="${escapeAttr(client.companyName)}" /></label>
      <label data-customer-field="company">Contact<input name="contactName" value="${escapeAttr(client.contactName)}" /></label>
      <label>Telephone<input name="phone" value="${escapeAttr(client.phone)}" /></label>
      <label>Email<input name="email" type="email" value="${escapeAttr(client.email)}" /></label>
      <label class="wide-field">Adresse<input name="address" value="${escapeAttr(client.address)}" /></label>
      <label data-customer-field="company">Tax ID<input name="taxId" value="${escapeAttr(client.taxId)}" /></label>
      <label data-customer-field="company">TVA<input name="vatNumber" value="${escapeAttr(client.vatNumber)}" /></label>
      <label class="wide-field">Notes<textarea name="notes" rows="3">${escapeHtml(client.notes)}</textarea></label>
    </div>
  `;
}

function clientDuplicateWarnings(clients) {
  const groups = new Map();
  clients.forEach((client) => {
    [
      ["telephone", client.phone],
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
  const displayName = firstText(
    customer.displayName,
    customer.name,
    [customer.firstName, customer.lastName].filter(Boolean).join(" "),
    customer.contactName,
    customer.companyName
  );
  return {
    id: customer.id,
    customerCollection: customerCollectionName(customer.customerCollection),
    type: firstText(customer.type) || "individual",
    displayName,
    firstName: firstText(customer.firstName),
    lastName: firstText(customer.lastName),
    contactName: firstText(customer.contactName),
    companyName: firstText(customer.companyName),
    phone: firstText(customer.phone, customer.telephone, customer.mobile),
    email: firstText(customer.email),
    address: firstText(customer.address),
    taxId: firstText(customer.taxId),
    vatNumber: firstText(customer.vatNumber),
    notes: firstText(customer.notes),
    active: customer.active !== false,
    createdAt: customer.createdAt || null,
    updatedAt: customer.updatedAt || customer.createdAt || null
  };
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

function applyClientTools(root) {
  const tools = root.querySelector("[data-client-tools]");
  const table = root.querySelector(".clients-table");
  if (!tools || !table) return;
  const query = normalizeClientSearch(tools.querySelector("[data-client-search]")?.value || "");
  const filter = tools.querySelector("[data-client-filter]")?.value || "all";
  const sort = tools.querySelector("[data-client-sort]")?.value || "updated-desc";
  const pageSize = Number(tools.querySelector("[data-client-page-size]")?.value || 25);
  const currentPage = clientCurrentPage(root);
  const cards = [...table.querySelectorAll("[data-client-card]")];
  const sortedCards = cards.sort((a, b) => compareClientCards(a, b, sort));
  sortedCards.forEach((card) => table.appendChild(card));
  const filteredCards = sortedCards.filter((card) => {
    const matchesQuery = !query || card.dataset.clientSearchText.includes(query);
    const matchesFilter = clientCardMatchesFilter(card, filter);
    return matchesQuery && matchesFilter;
  });
  const pageCount = Math.max(1, Math.ceil(filteredCards.length / pageSize));
  const page = Math.min(currentPage, pageCount);
  setClientPage(root, page);
  const pageStart = (page - 1) * pageSize;
  const pageEnd = pageStart + pageSize;
  sortedCards.forEach((card) => {
    const isVisible = filteredCards.includes(card) && filteredCards.indexOf(card) >= pageStart && filteredCards.indexOf(card) < pageEnd;
    card.classList.toggle("is-hidden", !isVisible);
  });
  const count = tools.querySelector("[data-client-result-count]");
  if (count) count.textContent = `${filteredCards.length} client${filteredCards.length > 1 ? "s" : ""}`;
  root.querySelector("[data-client-empty-results]")?.classList.toggle("is-hidden", filteredCards.length !== 0);
  const reset = tools.querySelector("[data-client-reset]");
  const hasTools = !!query || filter !== "all" || sort !== "updated-desc";
  reset?.classList.toggle("is-hidden", !hasTools);
  const pagination = root.querySelector("[data-client-pagination]");
  if (pagination) {
    pagination.classList.toggle("is-hidden", filteredCards.length <= pageSize);
    pagination.querySelector("[data-client-page-label]").textContent = `Page ${page} / ${pageCount}`;
    const prev = pagination.querySelector('[data-client-page="-1"]');
    const next = pagination.querySelector('[data-client-page="1"]');
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= pageCount;
  }
}

function compareClientCards(a, b, sort) {
  if (sort === "name-asc") return a.dataset.clientName.localeCompare(b.dataset.clientName, "fr");
  if (sort === "name-desc") return b.dataset.clientName.localeCompare(a.dataset.clientName, "fr");
  if (sort === "type-asc") return a.dataset.clientType.localeCompare(b.dataset.clientType, "fr");
  if (sort === "status-asc") return b.dataset.clientActive.localeCompare(a.dataset.clientActive, "fr");
  return Number(b.dataset.clientUpdated || 0) - Number(a.dataset.clientUpdated || 0);
}

function clientCardMatchesFilter(card, filter) {
  if (filter === "active") return card.dataset.clientActive === "true";
  if (filter === "inactive") return card.dataset.clientActive === "false";
  if (filter === "with-phone") return card.dataset.clientHasPhone === "true";
  if (filter === "with-email") return card.dataset.clientHasEmail === "true";
  if (filter === "company") return card.dataset.clientType === "company";
  if (filter === "individual") return card.dataset.clientType !== "company";
  return true;
}

function resetClientTools(root) {
  const tools = root.querySelector("[data-client-tools]");
  if (!tools) return;
  const search = tools.querySelector("[data-client-search]");
  const filter = tools.querySelector("[data-client-filter]");
  const sort = tools.querySelector("[data-client-sort]");
  if (search) search.value = "";
  if (filter) filter.value = "all";
  if (sort) sort.value = "updated-desc";
  setClientPage(root, 1);
  applyClientTools(root);
}

function clientCurrentPage(root) {
  return Math.max(1, Number(root.dataset.clientPage || 1));
}

function setClientPage(root, page) {
  root.dataset.clientPage = String(Math.max(1, Number(page) || 1));
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

function exportVisibleCustomers(root) {
  const cards = [...root.querySelectorAll("[data-client-card]")].filter((card) => !card.classList.contains("is-hidden"));
  const rows = cards.map(customerCsvRow);
  const headers = ["Type", "Nom affichage", "Prenom", "Nom", "Societe", "Contact", "Telephone", "Email", "Adresse", "Tax ID", "TVA", "Statut", "Date creation", "Mis a jour", "Reservations", "Dernier passage", "Notes", "ID compte"];
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `clients-restaurant-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function customerCsvRow(card) {
  const summaryCells = [...card.querySelectorAll(":scope > summary > span")].map((cell) => cell.textContent.trim().replace(/\s+/g, " "));
  const detailMap = new Map([...card.querySelectorAll(".client-account-details .reservation-detail-item")].map((item) => {
    const label = item.querySelector("span")?.textContent.trim() || "";
    const value = item.querySelector("strong")?.textContent.trim() || "";
    return [label, value === "-" ? "" : value];
  }));
  return [
    detailMap.get("Type") || "",
    summaryCells[0] || "",
    detailMap.get("Prenom") || "",
    detailMap.get("Nom") || "",
    detailMap.get("Societe") || "",
    detailMap.get("Contact") || "",
    detailMap.get("Telephone") || "",
    detailMap.get("Email") || "",
    detailMap.get("Adresse") || "",
    detailMap.get("Tax ID") || "",
    detailMap.get("TVA") || "",
    summaryCells[3] || "",
    detailMap.get("Date creation") || "",
    summaryCells[4] || "",
    card.dataset.clientReservations || "",
    card.dataset.clientLastVisit || "",
    detailMap.get("Notes") || "",
    detailMap.get("ID compte") || ""
  ];
}

function csvCell(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function reservationsHtml(reservations, role) {
  const canUpdate = ["owner", "admin", "manager"].includes(role);
  return `
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
            ${reservationDetailItemHtml("Date", reservationDate || "Date non renseignee")}
            ${reservationDetailItemHtml("Heure", reservationTime || "Heure non renseignee")}
            ${reservationDetailItemHtml("Source", source || "Source non renseignee")}
            ${reservationDetailItemHtml("Created by", createdBy || "Created by non renseigne")}
            ${reservationDetailItemHtml("Telephone", firstText(reservation.customerPhone, reservation.phone, reservation.telephone, reservation.customer?.phone))}
            ${reservationDetailItemHtml("Email", firstText(reservation.customerEmail, reservation.email, reservation.contactEmail, reservation.customer?.email))}
            ${reservationDetailItemHtml("Notes", firstText(reservation.notes, reservation.message, reservation.comment))}
            ${reservationDetailItemHtml("ID reservation", reservation.id)}
          </div>
        </details>
      `;
      }).join("") : `<div class="empty-state">Aucune reservation pour le moment.</div>`}
    </div>
  `;
}

function reservationDetailItemHtml(label, value) {
  return `
    <div class="reservation-detail-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "-")}</strong>
    </div>
  `;
}

function reservationDateLabel(reservation = {}) {
  const explicitDate = firstText(reservation.date, reservation.reservationDate, reservation.day, reservation.bookingDate);
  const explicitTime = firstText(reservation.time, reservation.reservationTime, reservation.hour, reservation.bookingTime);
  if (explicitDate || explicitTime) return `${explicitDate} ${explicitTime}`.trim();
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

function teamHtml(members, canManageTeam) {
  return `
    <div class="responsive-table">
      <div class="table-row table-head"><span>Nom</span><span>Email</span><span>Role</span><span>Statut</span></div>
      ${members.length ? members.map((member) => `
        <div class="table-row">
          <span>${escapeHtml(member.displayName || member.uid)}</span>
          <span>${escapeHtml(member.email || "")}</span>
          <span>${escapeHtml(ROLE_LABELS[member.role] || member.role || "staff")}</span>
          <span>${escapeHtml(member.status || "active")}</span>
        </div>
      `).join("") : `<div class="empty-state">Aucun membre trouve.</div>`}
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

function tabLabel(tab) {
  return {
    overview: "Overview",
    profile: "Profil",
    hours: "Horaires",
    public: "Page publique",
    menu: "QR menu",
    reservations: "Reservations",
    clients: "Comptes clients",
    team: "Equipe",
    downloads: "Downloads"
  }[tab] || tab;
}

function normalizeRestaurant(id, data) {
  const profile = data.restaurantProfile || {};
  const addressLine1 = data.addressLine1 || profile.addressLine1 || "";
  const addressLine2 = data.addressLine2 || profile.addressLine2 || "";
  const city = data.city || profile.city || "";
  const postalCode = data.postalCode || profile.postalCode || "";
  const country = data.country || profile.country || "France";
  const address = data.address || profile.address || fullAddress(addressLine1, postalCode, city, country);
  return {
    id,
    ...data,
    name: data.name || profile.name || profile.tradeName || id,
    slug: data.slug || profile.slug || id,
    logoUrl: data.logoUrl || profile.logoUrl || "",
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
    openingHours: resolveOpeningHours(data, profile)
  };
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
      : "Le restaurant est fermÃ© ce jour-lÃ . Choisissez une autre date.";
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





