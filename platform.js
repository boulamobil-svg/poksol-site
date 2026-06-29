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
  android: "https://poksol.com/downloads/poket-restaurants/android/chez_marwan_pos_1.0.6+16.apk",
  windows: "https://poksol.com/downloads/poket-restaurants/windows/poket_restaurants_windows_1.0.6+12.zip"
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

let servicesPromise = null;
let currentUser = null;

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

async function getRestaurantBySlug(slug) {
  const cleanSlug = normalizeSlug(slug);
  if (!cleanSlug) return null;
  const direct = await getRestaurant(cleanSlug);
  if (direct) return direct;
  const services = await getServices();
  const { collection, getDocs, limit, query, where } = services.firestoreModule;
  const snaps = await getDocs(query(
    collection(services.db, "restaurants"),
    where("slug", "==", cleanSlug),
    limit(1)
  ));
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
    const role = memberSnap.exists() ? memberSnap.data().role : restaurant.ownerUid === uid ? "owner" : "staff";
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
    restaurantProfile: {
      name,
      tradeName: name,
      restaurantId: slug,
      slug,
      description: text(data, "description"),
      cuisineType: text(data, "cuisineType"),
      addressLine1: text(data, "address"),
      postalCode: text(data, "postalCode"),
      city: text(data, "city"),
      country: text(data, "country") || "France",
      phone: text(data, "phone"),
      email: text(data, "email") || user.email || ""
    },
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
  if (["accepted", "revoked", "expired"].includes(invite.status) || invite.active === false) {
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
  await setDoc(doc(services.db, "restaurants", restaurantId, "members", user.uid), {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    role,
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  await setDoc(doc(services.db, "users", user.uid), {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    activeRestaurantId: restaurantId,
    restaurantIds: arrayUnion(restaurantId),
    updatedAt: serverTimestamp()
  }, { merge: true });
  await updateDoc(inviteRef, {
    status: "accepted",
    acceptedAt: serverTimestamp(),
    acceptedByUid: user.uid,
    updatedAt: serverTimestamp()
  });
  localStorage.setItem("poksolActiveRestaurantId", restaurantId);
  return getRestaurant(restaurantId);
}

async function uploadRestaurantImage(restaurantId, file, kind) {
  if (!file) return "";
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
  const payload = {
    name: text(data, "name"),
    tradeName: text(data, "name"),
    logoUrl,
    coverUrl,
    description: text(data, "description"),
    cuisineType: text(data, "cuisineType"),
    address: text(data, "address"),
    addressLine1: text(data, "address"),
    city: text(data, "city"),
    postalCode: text(data, "postalCode"),
    country: text(data, "country"),
    phone: text(data, "phone"),
    email: text(data, "email"),
    website: text(data, "website"),
    instagram: text(data, "instagram"),
    facebook: text(data, "facebook"),
    googleMapsUrl: text(data, "googleMapsUrl"),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(services.db, "restaurants", restaurantId), {
    ...payload,
    restaurantProfile: payload
  }, { merge: true });
}

async function saveOpeningHours(restaurantId, form) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const data = new FormData(form);
  const openingHours = {};
  DAYS.forEach(([key]) => {
    openingHours[key] = data.get(`${key}.closed`) === "on"
      ? []
      : [{ open: text(data, `${key}.open`) || "09:00", close: text(data, `${key}.close`) || "22:00" }];
  });
  await setDoc(doc(services.db, "restaurants", restaurantId), {
    openingHours,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function savePublicSettings(restaurantId, form) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const data = new FormData(form);
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
        primaryColor: text(data, "primaryColor") || "#0A2540",
        accentColor: text(data, "accentColor") || "#1976F3"
      },
      updatedAt: serverTimestamp()
    },
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function saveQrMenu(restaurantId, form) {
  const services = await getServices();
  const { doc, serverTimestamp, setDoc } = services.firestoreModule;
  const data = new FormData(form);
  const structuredItems = parseMenuItems(text(data, "structuredItems"));
  await setDoc(doc(services.db, "restaurants", restaurantId, "menus", "main"), {
    title: text(data, "title") || "Menu principal",
    type: text(data, "type") || "external_link",
    pdfUrl: text(data, "pdfUrl"),
    externalUrl: text(data, "externalUrl"),
    items: structuredItems,
    isActive: data.get("isActive") === "on",
    updatedAt: serverTimestamp()
  }, { merge: true });
  await setDoc(doc(services.db, "restaurants", restaurantId), {
    qrMenuEnabled: data.get("isActive") === "on",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function listReservations(restaurantId) {
  const services = await getServices();
  const { collection, getDocs, orderBy, query } = services.firestoreModule;
  const snaps = await getDocs(query(collection(services.db, "restaurants", restaurantId, "reservations"), orderBy("createdAt", "desc")));
  return snaps.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
}

async function getActiveMenu(restaurantId) {
  const services = await getServices();
  const { doc, getDoc } = services.firestoreModule;
  const snap = await getDoc(doc(services.db, "restaurants", restaurantId, "menus", "main"));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
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
  const snaps = await getDocs(collection(services.db, "restaurants", restaurantId, "members"));
  return snaps.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
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
  const payload = {
    restaurantId: restaurant.id,
    customerName: text(data, "name"),
    customerPhone: text(data, "phone"),
    customerEmail: text(data, "email"),
    date: text(data, "date"),
    time: text(data, "time"),
    guests: Number(text(data, "guests") || 1),
    message: text(data, "message"),
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (!payload.customerName || !payload.customerPhone || !payload.date || !payload.time) {
    throw new Error("Nom, telephone, date et heure sont obligatoires.");
  }
  if (!isReservationWithinOpeningHours(restaurant.openingHours, payload.date, payload.time)) {
    throw new Error("Ce créneau est en dehors des horaires d'ouverture. Choisissez une heure ouverte ou contactez le restaurant.");
  }
  await addDoc(collection(services.db, "restaurants", restaurant.id, "reservations"), payload);
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
      await renderDashboard(root, currentUser, restaurantId);
    } catch (error) {
      status.textContent = error.message || String(error);
    }
  });
  root.addEventListener("change", async (event) => {
    if (!event.target.matches("[data-reservation-status]")) return;
    const restaurantId = root.dataset.restaurantId;
    await updateReservationStatus(restaurantId, event.target.dataset.reservationStatus, event.target.value);
    await renderDashboard(root, currentUser, restaurantId);
  });
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

async function renderDashboard(root, user, restaurantId) {
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
  const services = await getServices();
  const { doc, getDoc } = services.firestoreModule;
  const memberSnap = await getDoc(doc(services.db, "restaurants", restaurant.id, "members", user.uid)).catch(() => null);
  const role = memberSnap?.exists() ? memberSnap.data().role : restaurant.ownerUid === user.uid ? "owner" : "staff";
  const [reservations, members, menu] = await Promise.all([
    listReservations(restaurant.id).catch(() => []),
    listMembers(restaurant.id).catch(() => []),
    getActiveMenu(restaurant.id).catch(() => null)
  ]);
  root.innerHTML = dashboardHtml(restaurant, role, reservations, members, menu);
}

function initPublicRestaurantPage() {
  const root = document.querySelector("[data-public-restaurant]");
  if (!root) return;
  const slug = root.dataset.restaurantSlug || new URLSearchParams(window.location.search).get("slug") || "chez-marwan";
  let loadedRestaurant = null;
  getRestaurantBySlug(slug).then(async (restaurant) => {
    loadedRestaurant = restaurant;
    if (restaurant && restaurant.publicPageEnabled !== false) {
      const menu = await getActiveMenu(restaurant.id).catch(() => null);
      hydratePublicRestaurant(root, restaurant, menu);
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
  const menuLink = document.querySelector("[data-public-menu-link]");
  if (menuLink) {
    const menuUrl = menu?.externalUrl || menu?.pdfUrl || "#menu";
    menuLink.href = menuUrl;
    if (menuUrl !== "#menu") menuLink.target = "_blank";
    menuLink.textContent = restaurant.qrMenuEnabled ? "Ouvrir le menu QR" : "Menu bientot disponible";
  }
  const menuContainer = document.querySelector("[data-public-menu-items]");
  if (menuContainer && menu?.items?.length) {
    menuContainer.innerHTML = menu.items.map((item) => `
      <article class="menu-item-card menu-item-card-live">
        <div>
          <span>${escapeHtml(item.category || "Menu")}</span>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.description || "")}</p>
          <strong>${escapeHtml(item.price || "")}</strong>
        </div>
      </article>
    `).join("");
  }
  if (restaurant.reservationEnabled === false) {
    const reservation = document.querySelector("[data-public-reservation-form]");
    if (reservation) reservation.innerHTML = `<p class="alert-note">Les reservations en ligne ne sont pas encore activees pour ce restaurant.</p>`;
  }
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

function dashboardHtml(restaurant, role, reservations, members, menu) {
  const canEditProfile = ["owner", "admin", "manager"].includes(role);
  const canManageTeam = ["owner", "admin"].includes(role);
  const publicUrl = `${window.location.origin}/restaurants/?slug=${encodeURIComponent(restaurant.slug || restaurant.id)}`;
  return `
    <div class="dashboard-shell">
      <div class="dashboard-topline">
        <div>
          <p class="eyebrow">${escapeHtml(ROLE_LABELS[role] || role)}</p>
          <h2>${escapeHtml(restaurant.name || restaurant.id)}</h2>
          <p data-dashboard-status>Dashboard connecte a Firestore.</p>
        </div>
      </div>
      <nav class="dashboard-tabs" aria-label="Sections dashboard">
        ${["overview", "profile", "hours", "public", "menu", "reservations", "team", "downloads"].map((tab, index) => `
          <button class="${index === 0 ? "is-active" : ""}" type="button" data-dashboard-tab="${tab}">${tabLabel(tab)}</button>
        `).join("")}
      </nav>
      <section class="dashboard-panel is-active" data-dashboard-panel="overview">${overviewHtml(restaurant, publicUrl)}</section>
      <section class="dashboard-panel" data-dashboard-panel="profile">${profileFormHtml(restaurant, canEditProfile)}</section>
      <section class="dashboard-panel" data-dashboard-panel="hours">${hoursFormHtml(restaurant, canEditProfile)}</section>
      <section class="dashboard-panel" data-dashboard-panel="public">${publicSettingsHtml(restaurant, publicUrl, canEditProfile)}</section>
      <section class="dashboard-panel" data-dashboard-panel="menu">${menuFormHtml(restaurant, menu, canEditProfile)}</section>
      <section class="dashboard-panel" data-dashboard-panel="reservations">${reservationsHtml(reservations, role)}</section>
      <section class="dashboard-panel" data-dashboard-panel="team">${teamHtml(members, canManageTeam)}</section>
      <section class="dashboard-panel" data-dashboard-panel="downloads">${downloadsHtml()}</section>
    </div>
  `;
}

function overviewHtml(restaurant, publicUrl) {
  return `
    <div class="dashboard-stats">
      ${statusCardHtml("Page publique", restaurant.publicPageEnabled !== false ? "Active" : "Desactivee")}
      ${statusCardHtml("QR menu", restaurant.qrMenuEnabled ? "Actif" : "A completer")}
      ${statusCardHtml("Reservations", restaurant.reservationEnabled !== false ? "Actives" : "Desactivees")}
    </div>
    <div class="quick-links">
      <a href="${publicUrl}" target="_blank" rel="noopener noreferrer">Voir page publique</a>
      <a href="${DOWNLOADS.web}" target="_blank" rel="noopener noreferrer">Ouvrir web app</a>
      <a href="#downloads" data-dashboard-tab-link="downloads">Telechargements</a>
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
        <label>Adresse<input name="address" value="${escapeAttr(restaurant.address || restaurant.addressLine1)}" ${disabled(canEdit)} /></label>
        <label>Ville<input name="city" value="${escapeAttr(restaurant.city)}" ${disabled(canEdit)} /></label>
        <label>Code postal<input name="postalCode" value="${escapeAttr(restaurant.postalCode)}" ${disabled(canEdit)} /></label>
        <label>Pays<input name="country" value="${escapeAttr(restaurant.country || "France")}" ${disabled(canEdit)} /></label>
        <label>Site web<input name="website" value="${escapeAttr(restaurant.website)}" ${disabled(canEdit)} /></label>
        <label>Instagram<input name="instagram" value="${escapeAttr(restaurant.instagram)}" ${disabled(canEdit)} /></label>
        <label>Facebook<input name="facebook" value="${escapeAttr(restaurant.facebook)}" ${disabled(canEdit)} /></label>
        <label>Google Maps URL<input name="googleMapsUrl" value="${escapeAttr(restaurant.googleMapsUrl)}" ${disabled(canEdit)} /></label>
        <input type="hidden" name="logoUrl" value="${escapeAttr(restaurant.logoUrl)}" />
        <input type="hidden" name="coverUrl" value="${escapeAttr(restaurant.coverUrl)}" />
        <label>Logo<input name="logoFile" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" ${disabled(canEdit)} /></label>
        <label>Image couverture<input name="coverFile" type="file" accept="image/png,image/jpeg,image/webp" ${disabled(canEdit)} /></label>
        <label class="wide-field">Description<textarea name="description" rows="4" ${disabled(canEdit)}>${escapeHtml(restaurant.description)}</textarea></label>
      </div>
      ${canEdit ? `<button class="primary-btn button-reset" type="submit">Enregistrer le profil</button>` : `<p class="alert-note">Votre role permet la lecture uniquement.</p>`}
      <small data-form-status></small>
    </form>
  `;
}

function hoursFormHtml(restaurant, canEdit) {
  const hours = normalizeHours(restaurant.openingHours);
  return `
    <form class="platform-form" data-dashboard-hours-form>
      <div class="weekly-hours">
        ${DAYS.map(([key, label]) => {
          const first = hours[key]?.[0] || {};
          const closed = !hours[key] || hours[key].length === 0;
          return `
            <div class="weekly-hour-row">
              <label class="day-toggle"><input type="checkbox" name="${key}.closed" ${closed ? "checked" : ""} ${disabled(canEdit)} /> ${label} ferme</label>
              <label>Ouverture<input type="time" name="${key}.open" value="${escapeAttr(first.open || "09:00")}" ${disabled(canEdit)} /></label>
              <label>Fermeture<input type="time" name="${key}.close" value="${escapeAttr(first.close || "22:00")}" ${disabled(canEdit)} /></label>
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
  return `
    <form class="platform-form" data-dashboard-public-form>
      <div class="toggle-grid">
        <label><input type="checkbox" name="publicPageEnabled" ${restaurant.publicPageEnabled !== false ? "checked" : ""} ${disabled(canEdit)} /> Page publique active</label>
        <label><input type="checkbox" name="reservationEnabled" ${restaurant.reservationEnabled !== false ? "checked" : ""} ${disabled(canEdit)} /> Reservations actives</label>
        <label><input type="checkbox" name="qrMenuEnabled" ${restaurant.qrMenuEnabled ? "checked" : ""} ${disabled(canEdit)} /> QR menu actif</label>
      </div>
      <div class="form-grid">
        <label>Couleur principale<input name="primaryColor" value="${escapeAttr(theme.primaryColor || "#0A2540")}" ${disabled(canEdit)} /></label>
        <label>Couleur accent<input name="accentColor" value="${escapeAttr(theme.accentColor || "#1976F3")}" ${disabled(canEdit)} /></label>
        <label class="wide-field">Message public<textarea name="customMessage" rows="3" ${disabled(canEdit)}>${escapeHtml(settings.customMessage || "")}</textarea></label>
      </div>
      <div class="quick-links">
        <a href="${publicUrl}" target="_blank" rel="noopener noreferrer">Previsualiser</a>
        <button class="ghost-action" type="button" data-copy="${escapeAttr(publicUrl)}">Copier l'URL</button>
      </div>
      ${canEdit ? `<button class="primary-btn button-reset" type="submit">Enregistrer la page publique</button>` : ""}
      <small data-form-status></small>
    </form>
  `;
}

function menuFormHtml(restaurant, menu, canEdit) {
  const qrUrl = `${window.location.origin}/restaurants/?slug=${encodeURIComponent(restaurant.slug || restaurant.id)}#menu`;
  const qrImage = `https://quickchart.io/qr?size=180&text=${encodeURIComponent(qrUrl)}`;
  const structuredText = Array.isArray(menu?.items)
    ? menu.items.map((item) => [item.category, item.name, item.description, item.price].filter(Boolean).join(" | ")).join("\n")
    : "";
  return `
    <form class="platform-form" data-dashboard-menu-form>
      <div class="qr-menu-preview">
        <div>
          <p class="alert-note">Destination QR : ${escapeHtml(qrUrl)}</p>
          <button class="ghost-action" type="button" data-copy="${escapeAttr(qrUrl)}">Copier le lien QR menu</button>
        </div>
        <img src="${qrImage}" alt="QR menu" loading="lazy" />
      </div>
      <div class="form-grid">
        <label>Titre<input name="title" value="${escapeAttr(menu?.title || "Menu principal")}" ${disabled(canEdit)} /></label>
        <label>Type
          <select name="type" ${disabled(canEdit)}>
            <option value="external_link" ${menu?.type === "external_link" ? "selected" : ""}>Lien externe</option>
            <option value="pdf" ${menu?.type === "pdf" ? "selected" : ""}>PDF</option>
            <option value="structured" ${menu?.type === "structured" ? "selected" : ""}>Structure Poksol</option>
          </select>
        </label>
        <label>URL externe<input name="externalUrl" value="${escapeAttr(menu?.externalUrl || "")}" placeholder="https://..." ${disabled(canEdit)} /></label>
        <label>PDF URL<input name="pdfUrl" value="${escapeAttr(menu?.pdfUrl || "")}" placeholder="https://..." ${disabled(canEdit)} /></label>
        <label><input type="checkbox" name="isActive" ${restaurant.qrMenuEnabled || menu?.isActive ? "checked" : ""} ${disabled(canEdit)} /> Menu actif</label>
        <label class="wide-field">Menu structure<textarea name="structuredItems" rows="7" placeholder="Categorie | Nom du plat | Description | Prix" ${disabled(canEdit)}>${escapeHtml(structuredText)}</textarea></label>
      </div>
      ${canEdit ? `<button class="primary-btn button-reset" type="submit">Enregistrer le menu</button>` : ""}
      <small data-form-status></small>
    </form>
  `;
}

function reservationsHtml(reservations, role) {
  const canUpdate = ["owner", "admin", "manager"].includes(role);
  return `
    <div class="responsive-table">
      <div class="table-row table-head"><span>Date</span><span>Client</span><span>Contact</span><span>Couverts</span><span>Statut</span></div>
      ${reservations.length ? reservations.map((reservation) => `
        <div class="table-row">
          <span>${escapeHtml(reservation.date || "")} ${escapeHtml(reservation.time || "")}</span>
          <span>${escapeHtml(reservation.customerName || "")}</span>
          <span>${escapeHtml(reservation.customerPhone || reservation.customerEmail || "")}</span>
          <span>${escapeHtml(reservation.guests || "")}</span>
          <span>${canUpdate ? statusSelectHtml(reservation) : escapeHtml(reservation.status || "pending")}</span>
        </div>
      `).join("") : `<div class="empty-state">Aucune reservation pour le moment.</div>`}
    </div>
  `;
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

function statusCardHtml(label, value) {
  return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function statusSelectHtml(reservation) {
  return `
    <select data-reservation-status="${escapeAttr(reservation.id)}">
      ${["pending", "confirmed", "refused", "cancelled"].map((status) => `
        <option value="${status}" ${reservation.status === status ? "selected" : ""}>${status}</option>
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
    team: "Equipe",
    downloads: "Downloads"
  }[tab] || tab;
}

function normalizeRestaurant(id, data) {
  const profile = data.restaurantProfile || {};
  return {
    id,
    ...data,
    name: data.name || profile.name || profile.tradeName || id,
    slug: data.slug || profile.slug || id,
    logoUrl: data.logoUrl || profile.logoUrl || "",
    description: data.description || profile.description || "",
    cuisineType: data.cuisineType || profile.cuisineType || data.businessType || profile.businessType || "",
    address: data.address || data.addressLine1 || profile.address || profile.addressLine1 || "",
    city: data.city || profile.city || "",
    postalCode: data.postalCode || profile.postalCode || "",
    country: data.country || profile.country || "France",
    phone: data.phone || profile.phone || "",
    email: data.email || profile.email || "",
    openingHours: resolveOpeningHours(data, profile)
  };
}

function readableFirebaseError(error) {
  const raw = error?.code || error?.message || String(error || "");
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
    populateReservationTimes(timeInput, slots);
    if (submitButton) submitButton.disabled = !slots.length;
    note.textContent = slots.length
      ? `Horaires disponibles : ${slots.map((slot) => `${slot.open} - ${slot.close}`).join(" / ")}.`
      : "Le restaurant est fermé ce jour-là. Choisissez une autre date.";
  };
  dateInput?.addEventListener("change", updateNote);
  timeInput?.addEventListener("change", updateNote);
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

function hasAnyOpeningSlot(hours) {
  return DAYS.some(([key]) => (hours[key] || []).length > 0);
}

function populateReservationTimes(input, slots, placeholder = "Aucun horaire disponible") {
  if (!input) return;
  const options = slots.flatMap((slot) => buildTimeOptions(slot.open, slot.close));
  input.innerHTML = [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...options.map((time) => `<option value="${escapeAttr(time)}">${escapeHtml(time)}</option>`)
  ].join("");
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

function normalizeCode(value) {
  return (value || "").toString().trim().replace(/[^a-zA-Z0-9_-]/g, "").toUpperCase();
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
initContactForms();
