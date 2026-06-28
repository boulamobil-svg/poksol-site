const ACCESS_SESSION_KEY = "poksolAccessSession";
const RESTAURANT_PROFILE_KEY = "poksolRestaurantProfile";
const RESTAURANT_CONTEXT_KEY = "poksolRestaurantContext";
const APP_URL = "/apps/poket-restaurants/";
const INVITE_COLLECTION = "restaurant_invites";
const DAYS = [
  ["monday", "Lundi"],
  ["tuesday", "Mardi"],
  ["wednesday", "Mercredi"],
  ["thursday", "Jeudi"],
  ["friday", "Vendredi"],
  ["saturday", "Samedi"],
  ["sunday", "Dimanche"]
];

const firebaseConfig = {
  apiKey: "AIzaSyCRhBXuuJhbSDo9e4kQEEvc1x28HfxAi_E",
  authDomain: "restaurantpos-7a4f0d11.firebaseapp.com",
  projectId: "restaurantpos-7a4f0d11",
  storageBucket: "restaurantpos-7a4f0d11.firebasestorage.app",
  messagingSenderId: "486823214144",
  appId: "1:486823214144:web:a6253af9f0821929e8f3a5"
};
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
const LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

let activeStep = 0;
let firebaseServices = null;
let currentUser = null;
let previewMode = false;
let restaurantContext = loadRestaurantContext();
let pendingInviteCode = readInviteCodeFromUrl();
const accessParams = new URLSearchParams(window.location.search);
const accessMode = (accessParams.get("mode") || "").toLowerCase();
const accessSection = (accessParams.get("section") || "").toLowerCase();
const forceNewRestaurant = accessMode === "new" || accessMode === "create";
const stayOnAccessPage = accessMode === "edit" || accessMode === "public-page";

if (forceNewRestaurant) {
  restaurantContext = {
    mode: "new",
    source: "new-request"
  };
  localStorage.removeItem(RESTAURANT_CONTEXT_KEY);
  localStorage.removeItem(RESTAURANT_PROFILE_KEY);
}

const form = document.querySelector("[data-restaurant-profile-form]");
const statusBox = document.querySelector("[data-access-status]");
const authState = document.querySelector("[data-auth-state]");
const loginButton = document.querySelector("[data-auth-login]");
const demoButton = document.querySelector("[data-auth-demo]");
const logoutButton = document.querySelector("[data-auth-logout]");
const inviteCodeInput = document.querySelector("[data-invite-code]");
const inviteAcceptButton = document.querySelector("[data-invite-accept]");
const inviteStatus = document.querySelector("[data-invite-status]");
const stepButtons = Array.from(document.querySelectorAll("[data-access-step-button]"));
const steps = Array.from(document.querySelectorAll("[data-access-step]"));
const previousButton = document.querySelector("[data-access-prev]");
const nextButton = document.querySelector("[data-access-next]");
const saveLaterButton = document.querySelector("[data-save-later]");
const saveFinalButton = document.querySelector("[data-save-final]");
const summaryBox = document.querySelector("[data-profile-summary]");
const logoPreview = document.querySelector("[data-logo-preview]");
const logoUploadInput = document.querySelector("[data-logo-upload]");
const logoUploadButton = document.querySelector("[data-logo-upload-button]");
const logoUploadStatus = document.querySelector("[data-logo-upload-status]");
const hoursEditor = document.querySelector("[data-opening-hours]");
const accessTitle = document.querySelector("[data-access-title]");
const restaurantMode = document.querySelector("[data-restaurant-mode]");

renderOpeningHours();
hydrateForm(loadLocalProfile());
hydrateInviteFromUrl();
bindEvents();
initializeFirebase();
updateUi();

function bindEvents() {
  loginButton.addEventListener("click", signIn);
  demoButton.addEventListener("click", enablePreviewMode);
  logoutButton.addEventListener("click", signOut);
  inviteAcceptButton.addEventListener("click", acceptInviteFromInput);
  inviteCodeInput.addEventListener("input", () => {
    pendingInviteCode = normalizeInviteCode(inviteCodeInput.value);
    updateInviteStatus();
  });
  previousButton.addEventListener("click", () => setStep(activeStep - 1));
  nextButton.addEventListener("click", () => {
    if (activeStep < steps.length - 1) setStep(activeStep + 1);
  });
  saveLaterButton.addEventListener("click", () => saveProfile({ final: false }));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveProfile({ final: true });
  });
  form.addEventListener("input", () => {
    updateLogoPreview();
    updateSummary();
    updateUi();
  });
  logoUploadInput.addEventListener("change", updateLogoUploadStatus);
  logoUploadButton.addEventListener("click", uploadRestaurantLogo);
  stepButtons.forEach((button) => {
    button.addEventListener("click", () => setStep(Number(button.dataset.accessStepButton)));
  });
}

async function initializeFirebase() {
  try {
    const [{ initializeApp }, authModule, firestoreModule, storageModule] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js"),
      import("https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js")
    ]);
    const app = initializeApp(firebaseConfig);
    const auth = authModule.getAuth(app);
    const db = firestoreModule.getFirestore(app);
    const storage = storageModule.getStorage(app);
    firebaseServices = { auth, db, storage, authModule, firestoreModule, storageModule };
    authModule.onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      if (user) {
        if (pendingInviteCode) {
          const accepted = await acceptInviteCode(pendingInviteCode);
          if (!accepted) {
            await loadRemoteProfile(user.uid);
          }
        } else {
          await loadRemoteProfile(user.uid);
        }
        const profile = loadLocalProfile();
        if (profile && validateProfile(profile).minimumOk) {
          saveSession(true);
          if (!stayOnAccessPage) {
            window.location.href = APP_URL;
            return;
          }
        }
      }
      updateAuthState();
      applyAccessModeStep();
      updateUi();
    });
  } catch (error) {
    statusBox.textContent = "Firebase indisponible pour le moment. Le mode preview local reste disponible.";
  }
}

async function signIn() {
  if (!firebaseServices) {
    statusBox.textContent = "Firebase n'est pas charge. Utilisez le mode preview pour tester le parcours.";
    return;
  }
  try {
    const provider = new firebaseServices.authModule.GoogleAuthProvider();
    const result = await firebaseServices.authModule.signInWithPopup(firebaseServices.auth, provider);
    currentUser = result.user;
    previewMode = false;
    updateAuthState();
  } catch (error) {
    statusBox.textContent = "Connexion impossible : " + (error.message || error);
  }
}

function enablePreviewMode() {
  previewMode = true;
  currentUser = {
    uid: "preview-user",
    displayName: "Utilisateur preview",
    email: "preview@poksol.local"
  };
  if (!restaurantContext.restaurantId) {
    restaurantContext = {
      restaurantId: "preview-restaurant",
      mode: loadLocalProfile() ? "existing" : "new",
      source: "preview"
    };
    saveRestaurantContext(restaurantContext);
  }
  saveSession(false);
  updateAuthState();
  updateUi();
}

async function signOut() {
  previewMode = false;
  currentUser = null;
  localStorage.removeItem(ACCESS_SESSION_KEY);
  restaurantContext = {};
  localStorage.removeItem(RESTAURANT_CONTEXT_KEY);
  if (firebaseServices) {
    await firebaseServices.authModule.signOut(firebaseServices.auth);
  }
  updateAuthState();
  updateUi();
}

async function loadRemoteProfile(uid) {
  if (!firebaseServices) return;
  try {
    const { doc, getDoc } = firebaseServices.firestoreModule;
    const userSnapshot = await getDoc(doc(firebaseServices.db, "users", uid));
    const userData = userSnapshot.exists() ? userSnapshot.data() : null;
    const existingRestaurantId = forceNewRestaurant
      ? ""
      : normalizeRestaurantId(
          userData?.activeRestaurantId ||
          (Array.isArray(userData?.restaurantIds) ? userData.restaurantIds[0] : "")
        );

    if (existingRestaurantId) {
      const restaurantSnapshot = await getDoc(doc(firebaseServices.db, "restaurants", existingRestaurantId));
      const restaurantData = restaurantSnapshot.exists() ? restaurantSnapshot.data() : null;
      const profile = normalizeProfileFromRestaurant(restaurantData, userData?.restaurantProfile);
      restaurantContext = {
        restaurantId: existingRestaurantId,
        mode: "existing",
        source: "firestore"
      };
      saveRestaurantContext(restaurantContext);
      if (profile) {
        saveLocalProfile(profile);
        hydrateForm(profile);
      }
      statusBox.textContent = `Restaurant trouve : ${profile?.name || existingRestaurantId}. Completez les informations manquantes.`;
      return;
    }

    const legacyProfile = userData?.restaurantProfile;
    restaurantContext = {
      restaurantId: buildRestaurantId(uid),
      mode: legacyProfile ? "existing" : "new",
      source: legacyProfile ? "user-profile" : "new"
    };
    saveRestaurantContext(restaurantContext);
    if (legacyProfile) {
      saveLocalProfile(legacyProfile);
      hydrateForm(legacyProfile);
    }
  } catch (error) {
    statusBox.textContent = "Profil distant non charge. Vous pouvez continuer localement.";
  }
}

async function saveProfile({ final }) {
  const profile = collectProfile();
  const validation = validateProfile(profile);
  if (!validation.minimumOk) {
    statusBox.textContent = validation.message;
    return;
  }
  if (final && !validation.strictOk) {
    statusBox.textContent = validation.message;
    return;
  }

  profile.updatedAt = new Date().toISOString();
  profile.profileComplete = validation.minimumOk;
  const restaurantId = await ensureRestaurantId(profile);
  profile.restaurantId = restaurantId;
  saveLocalProfile(profile);
  saveSession(profile.profileComplete);

  if (firebaseServices && currentUser && !previewMode) {
    try {
      const { doc, setDoc, serverTimestamp, arrayUnion } = firebaseServices.firestoreModule;
      const isExisting = restaurantContext.mode === "existing";
      const restaurantPayload = {
        id: restaurantId,
        restaurantId,
        slug: normalizeSlug(profile.name) || restaurantId,
        restaurantProfile: {
          ...profile,
          restaurantId,
          slug: normalizeSlug(profile.name) || restaurantId,
          updatedAt: serverTimestamp()
        },
        name: profile.name,
        tradeName: profile.tradeName,
        legalName: profile.legalName,
        logoUrl: profile.logoUrl,
        phone: profile.phone,
        email: profile.email,
        address: profile.address,
        addressLine1: profile.addressLine1,
        postalCode: profile.postalCode,
        city: profile.city,
        country: profile.country,
        openingHours: profile.openingHours,
        timezone: profile.timezone,
        currency: profile.currency,
        locale: profile.locale,
        businessType: profile.businessType,
        enabledSalesModes: profile.enabledSalesModes,
        publicPageEnabled: true,
        qrMenuEnabled: false,
        reservationEnabled: true,
        updatedAt: serverTimestamp()
      };
      if (!isExisting) {
        restaurantPayload.ownerUid = currentUser.uid;
        restaurantPayload.createdAt = serverTimestamp();
        restaurantPayload.status = "active";
      }

      await setDoc(
        doc(firebaseServices.db, "restaurants", restaurantId),
        restaurantPayload,
        { merge: true }
      );

      await setDoc(
        doc(firebaseServices.db, "users", currentUser.uid),
        {
          uid: currentUser.uid,
          email: currentUser.email || "",
          displayName: currentUser.displayName || "",
          photoURL: currentUser.photoURL || "",
          activeRestaurantId: restaurantId,
          restaurantIds: arrayUnion(restaurantId),
          restaurantProfile: {
            ...profile,
            restaurantId,
            updatedAt: serverTimestamp()
          },
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      const memberPayload = {
        uid: currentUser.uid,
        email: currentUser.email || "",
        displayName: currentUser.displayName || "",
        status: "active",
        updatedAt: serverTimestamp()
      };
      if (!isExisting) {
        memberPayload.role = "owner";
        memberPayload.createdAt = serverTimestamp();
      }
      await setDoc(
        doc(firebaseServices.db, "restaurants", restaurantId, "members", currentUser.uid),
        memberPayload,
        { merge: true }
      );
      restaurantContext = {
        restaurantId,
        mode: "existing",
        source: "firestore"
      };
      saveRestaurantContext(restaurantContext);
    } catch (error) {
      statusBox.textContent = "Sauvegarde locale OK. Firestore a refuse ou bloque la sauvegarde : " + formatFirebaseError(error);
      return;
    }
  }

  if (stayOnAccessPage) {
    statusBox.textContent = "Profil restaurant enregistre. Les informations sont pretes pour le web et Poket Restaurants.";
    updateUi();
    return;
  }

  statusBox.textContent = "Profil restaurant enregistre. Ouverture de Poket Restaurants...";
  window.setTimeout(() => {
    window.location.href = APP_URL;
  }, 700);
}

function setStep(index) {
  activeStep = Math.max(0, Math.min(index, steps.length - 1));
  steps.forEach((step, stepIndex) => step.classList.toggle("is-active", stepIndex === activeStep));
  stepButtons.forEach((button, buttonIndex) => {
    button.classList.toggle("is-active", buttonIndex === activeStep);
  });
  updateSummary();
  updateUi();
}

function updateUi() {
  const isAuthenticated = Boolean(currentUser);
  const profile = collectProfile();
  const validation = validateProfile(profile);
  previousButton.disabled = activeStep === 0;
  nextButton.classList.toggle("is-hidden", activeStep === steps.length - 1);
  saveFinalButton.classList.toggle("is-hidden", activeStep !== steps.length - 1);
  saveLaterButton.disabled = !isAuthenticated || !validation.minimumOk;
  form.classList.toggle("is-disabled", !isAuthenticated);
  if (!isAuthenticated) {
    statusBox.textContent = "Connectez-vous pour configurer le restaurant.";
  } else if (validation.minimumOk) {
    if (accessMode === "edit") {
      statusBox.textContent = "Restaurant charge. Modifiez l'adresse, les horaires ou les informations utiles, puis enregistrez.";
    } else if (accessMode === "public-page") {
      statusBox.textContent = "Preparez la page publique : logo, adresse, horaires, contact et informations visibles.";
    } else {
      statusBox.textContent = restaurantContext.mode === "existing"
        ? "Restaurant existant charge. Vous pouvez enregistrer les informations manquantes."
        : "Champs minimum remplis. Vous pouvez creer le restaurant ou completer plus tard.";
    }
  } else {
    statusBox.textContent = validation.message;
  }
  updateRestaurantModeCard();
}

function updateAuthState() {
  if (currentUser) {
    authState.textContent = (previewMode ? "Mode preview : " : "Connecte : ") +
      (currentUser.email || currentUser.displayName || currentUser.uid);
    loginButton.classList.add("is-hidden");
    demoButton.classList.add("is-hidden");
    logoutButton.classList.remove("is-hidden");
  } else {
    authState.textContent = "Session non connectee.";
    loginButton.classList.remove("is-hidden");
    demoButton.classList.remove("is-hidden");
    logoutButton.classList.add("is-hidden");
  }
}

function validateProfile(profile) {
  const hasContact = Boolean(profile.phone || profile.email);
  const minimumOk = Boolean(
    profile.name &&
    profile.addressLine1 &&
    profile.postalCode &&
    profile.city &&
    profile.country &&
    hasContact &&
    profile.paymentTerms &&
    profile.invoicePrefix &&
    Number(profile.nextInvoiceNumber) >= 1
  );
  if (!minimumOk) {
    return {
      minimumOk: false,
      strictOk: false,
      message: "Completez les champs obligatoires : nom, adresse, ville, pays, contact, paiement et numerotation."
    };
  }
  if (profile.email && !isValidEmail(profile.email)) {
    return { minimumOk: true, strictOk: false, message: "Email principal invalide." };
  }
  if (profile.billingEmail && !isValidEmail(profile.billingEmail)) {
    return { minimumOk: true, strictOk: false, message: "Email de facturation invalide." };
  }
  if (profile.logoUrl && !isValidUrl(profile.logoUrl)) {
    return { minimumOk: true, strictOk: false, message: "L'adresse du logo doit etre une URL valide." };
  }
  if (Number(profile.nextInvoiceNumber) < 1) {
    return { minimumOk: true, strictOk: false, message: "Le prochain numero de facture doit etre superieur ou egal a 1." };
  }
  return { minimumOk: true, strictOk: true, message: "" };
}

function collectProfile() {
  const data = new FormData(form);
  const enabledSalesModes = data.getAll("enabledSalesModes");
  const openingHoursByDay = collectOpeningHours(data);
  const profile = {
    name: value(data, "name"),
    restaurantId: restaurantContext.restaurantId || "",
    tradeName: value(data, "tradeName"),
    legalName: value(data, "legalName"),
    logoUrl: value(data, "logoUrl"),
    address: [value(data, "addressLine1"), value(data, "postalCode"), value(data, "city"), value(data, "country")]
      .filter(Boolean)
      .join(", "),
    addressLine1: value(data, "addressLine1"),
    addressLine2: value(data, "addressLine2"),
    postalCode: value(data, "postalCode"),
    city: value(data, "city"),
    country: value(data, "country"),
    phone: value(data, "phone"),
    email: value(data, "email"),
    billingPhone: value(data, "billingPhone"),
    billingEmail: value(data, "billingEmail"),
    siren: value(data, "siren"),
    siret: value(data, "siret"),
    vatNumber: value(data, "vatNumber"),
    legalForm: value(data, "legalForm"),
    shareCapital: value(data, "shareCapital"),
    rcsCity: value(data, "rcsCity"),
    apeCode: value(data, "apeCode"),
    iban: value(data, "iban"),
    bic: value(data, "bic"),
    paymentTerms: value(data, "paymentTerms"),
    latePenaltyTerms: value(data, "latePenaltyTerms"),
    recoveryIndemnity: value(data, "recoveryIndemnity"),
    invoicePrefix: value(data, "invoicePrefix"),
    nextInvoiceNumber: Number(value(data, "nextInvoiceNumber") || 1),
    invoiceLegalNotice: value(data, "invoiceLegalNotice"),
    openingHours: openingHoursToList(openingHoursByDay),
    openingHoursByDay,
    timezone: value(data, "timezone"),
    currency: value(data, "currency"),
    locale: value(data, "locale"),
    businessType: value(data, "businessType"),
    enabledSalesModes,
    defaultVatOnSite: Number(value(data, "defaultVatOnSite") || 0),
    defaultVatTakeaway: Number(value(data, "defaultVatTakeaway") || 0),
    capacity: Number(value(data, "capacity") || 0),
    managerContactName: value(data, "managerContactName"),
    updatedAt: new Date().toISOString()
  };
  return profile;
}

function hydrateForm(profile) {
  if (!profile) return;
  Object.entries(profile).forEach(([key, val]) => {
    if (key === "openingHours" || key === "openingHoursByDay" || key === "enabledSalesModes") return;
    const field = form.elements[key];
    if (field) field.value = val ?? "";
  });
  if (Array.isArray(profile.enabledSalesModes)) {
    form.querySelectorAll('input[name="enabledSalesModes"]').forEach((input) => {
      input.checked = profile.enabledSalesModes.includes(input.value);
    });
  }
  const normalizedHours = normalizeOpeningHoursForForm(profile);
  if (normalizedHours) {
    DAYS.forEach(([key]) => {
      const day = normalizedHours[key] || {};
      setField(`openingHours.${key}.open`, day.open !== false && day.isOpen !== false);
      setField(`openingHours.${key}.lunchStart`, day.lunchStart || "");
      setField(`openingHours.${key}.lunchEnd`, day.lunchEnd || "");
      setField(`openingHours.${key}.dinnerStart`, day.dinnerStart || "");
      setField(`openingHours.${key}.dinnerEnd`, day.dinnerEnd || "");
    });
  }
  updateLogoPreview();
  updateSummary();
}

function renderOpeningHours() {
  hoursEditor.innerHTML = DAYS.map(([key, label]) => `
    <div class="hours-row">
      <label class="day-toggle">
        <input type="checkbox" name="openingHours.${key}.open" checked />
        ${label}
      </label>
      <label>Debut midi<input type="time" name="openingHours.${key}.lunchStart" value="12:00" /></label>
      <label>Fin midi<input type="time" name="openingHours.${key}.lunchEnd" value="14:30" /></label>
      <label>Debut soir<input type="time" name="openingHours.${key}.dinnerStart" value="19:00" /></label>
      <label>Fin soir<input type="time" name="openingHours.${key}.dinnerEnd" value="22:30" /></label>
    </div>
  `).join("");
}

function collectOpeningHours(data) {
  return DAYS.reduce((hours, [key]) => {
    hours[key] = {
      open: data.get(`openingHours.${key}.open`) === "on",
      lunchStart: value(data, `openingHours.${key}.lunchStart`),
      lunchEnd: value(data, `openingHours.${key}.lunchEnd`),
      dinnerStart: value(data, `openingHours.${key}.dinnerStart`),
      dinnerEnd: value(data, `openingHours.${key}.dinnerEnd`)
    };
    return hours;
  }, {});
}

function validateInvite(invite, user) {
  if (!invite || invite.active === false || invite.status === "revoked" || invite.status === "expired") {
    return { ok: false, message: "Invitation inactive ou expiree." };
  }
  if (!normalizeRestaurantId(invite.restaurantId)) {
    return { ok: false, message: "Invitation incomplete : restaurant manquant." };
  }
  const reservedEmail = invite.invitedEmail || invite.email || "";
  if (reservedEmail && user.email) {
    const invitedEmail = reservedEmail.toString().trim().toLowerCase();
    const userEmail = user.email.toString().trim().toLowerCase();
    if (invitedEmail && invitedEmail !== userEmail) {
      return { ok: false, message: "Cette invitation est reservee a une autre adresse email." };
    }
  }
  if (invite.expiresAt && typeof invite.expiresAt.toDate === "function" && invite.expiresAt.toDate() < new Date()) {
    return { ok: false, message: "Cette invitation a expire." };
  }
  return { ok: true, message: "" };
}

async function acceptInviteFromInput() {
  pendingInviteCode = normalizeInviteCode(inviteCodeInput.value);
  if (!pendingInviteCode) {
    inviteStatus.textContent = "Saisissez un code d'invitation.";
    return;
  }
  if (!currentUser || previewMode) {
    inviteStatus.textContent = "Connectez-vous avec Google pour rejoindre un restaurant existant.";
    return;
  }
  await acceptInviteCode(pendingInviteCode);
}

async function acceptInviteCode(inviteCode) {
  if (!firebaseServices || !currentUser || previewMode) {
    return false;
  }

  const code = normalizeInviteCode(inviteCode);
  if (!code) return false;

  try {
    inviteAcceptButton.disabled = true;
    inviteStatus.textContent = "Verification de l'invitation...";

    const {
      doc,
      getDoc,
      setDoc,
      updateDoc,
      serverTimestamp,
      arrayUnion
    } = firebaseServices.firestoreModule;

    const inviteRef = doc(firebaseServices.db, INVITE_COLLECTION, code);
    const inviteSnapshot = await getDoc(inviteRef);
    if (!inviteSnapshot.exists()) {
      inviteStatus.textContent = "Invitation introuvable ou expiree.";
      return false;
    }

    const invite = inviteSnapshot.data();
    const validation = validateInvite(invite, currentUser);
    if (!validation.ok) {
      inviteStatus.textContent = validation.message;
      return false;
    }

    const role = invite.role || "staff";
    const restaurantId = normalizeRestaurantId(invite.restaurantId);

    const staffPayload = {
      uid: currentUser.uid,
      userId: currentUser.uid,
      restaurantId,
      email: currentUser.email || "",
      displayName: currentUser.displayName || invite.displayName || "",
      phone: invite.phone || "",
      jobTitle: invite.jobTitle || "",
      role,
      active: true,
      status: "active",
      inviteCode: code,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(
      doc(firebaseServices.db, "restaurants", restaurantId, "staff", currentUser.uid),
      staffPayload,
      { merge: true }
    );
    await setDoc(
      doc(firebaseServices.db, "restaurants", restaurantId, "members", currentUser.uid),
      {
        uid: currentUser.uid,
        email: currentUser.email || "",
        displayName: currentUser.displayName || invite.displayName || "",
        role,
        status: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    if (role === "staff") {
      await setDoc(
        doc(firebaseServices.db, "restaurants", restaurantId, "staff_users", currentUser.uid),
        {
          ...staffPayload,
          updatedAt: new Date().toISOString()
        },
        { merge: true }
      );
    }

    const restaurantSnapshot = await getDoc(doc(firebaseServices.db, "restaurants", restaurantId));
    if (!restaurantSnapshot.exists()) {
      inviteStatus.textContent = "Restaurant associe, mais profil restaurant introuvable.";
      return false;
    }

    const restaurantData = restaurantSnapshot.data();
    const profile = normalizeProfileFromRestaurant(restaurantData, null);

    await setDoc(
      doc(firebaseServices.db, "users", currentUser.uid),
      {
        uid: currentUser.uid,
        email: currentUser.email || "",
        displayName: currentUser.displayName || "",
        activeRestaurantId: restaurantId,
        restaurantIds: arrayUnion(restaurantId),
        joinedInviteCode: code,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    try {
      await updateDoc(inviteRef, {
        acceptedBy: arrayUnion(currentUser.uid),
        lastAcceptedBy: currentUser.uid,
        lastAcceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (_) {
      // L'association utilisateur/restaurant reste valide meme si l'historique
      // de l'invitation est bloque par des regles Firestore plus strictes.
    }

    restaurantContext = {
      restaurantId,
      mode: "existing",
      source: "invite",
      inviteCode: code,
      role
    };
    saveRestaurantContext(restaurantContext);
    if (profile) {
      saveLocalProfile(profile);
      hydrateForm(profile);
    }
    saveSession(Boolean(profile && validateProfile(profile).minimumOk));
    inviteStatus.textContent = `Restaurant rejoint : ${profile?.name || invite.restaurantName || restaurantId}.`;
    if (stayOnAccessPage) {
      statusBox.textContent = "Restaurant existant associe a votre compte. Vous pouvez maintenant verifier ou modifier ses informations.";
      updateUi();
    } else {
      statusBox.textContent = "Restaurant existant associe a votre compte. Ouverture de Poket Restaurants...";
      window.setTimeout(() => {
        window.location.href = APP_URL;
      }, 900);
    }
    return true;
  } catch (error) {
    inviteStatus.textContent = "Impossible de rejoindre le restaurant : " + (error.message || error);
    return false;
  } finally {
    inviteAcceptButton.disabled = false;
  }
}

async function uploadRestaurantLogo() {
  const file = logoUploadInput.files?.[0];
  if (!file) {
    logoUploadStatus.textContent = "Selectionnez d'abord un fichier image.";
    return;
  }
  if (!firebaseServices) {
    logoUploadStatus.textContent = "Firebase Storage n'est pas charge pour le moment.";
    return;
  }
  if (!currentUser || previewMode) {
    logoUploadStatus.textContent = "Connectez-vous avec Google pour heberger le logo sur Poksol.";
    return;
  }
  if (!LOGO_CONTENT_TYPES.includes(file.type)) {
    logoUploadStatus.textContent = "Format non accepte. Utilisez PNG, JPG, WEBP ou SVG.";
    return;
  }
  if (file.size > MAX_LOGO_SIZE_BYTES) {
    logoUploadStatus.textContent = "Logo trop lourd. Limite : 2 Mo.";
    return;
  }

  try {
    const restaurantId = await ensureRestaurantId(collectProfile());
    const extension = logoExtension(file);
    const storagePath = `restaurants/${restaurantId}/branding/logo.${extension}`;
    const { ref, uploadBytes, getDownloadURL } = firebaseServices.storageModule;
    const logoRef = ref(firebaseServices.storage, storagePath);

    logoUploadButton.disabled = true;
    logoUploadStatus.textContent = "Import du logo en cours...";

    await uploadBytes(logoRef, file, {
      contentType: file.type,
      customMetadata: {
        restaurantId,
        ownerUid: currentUser.uid
      }
    });

    const downloadUrl = await getDownloadURL(logoRef);
    form.elements.logoUrl.value = downloadUrl;
    updateLogoPreview();
    updateSummary();
    saveLocalProfile(collectProfile());
    logoUploadStatus.textContent = "Logo importe. L'URL a ete ajoutee au profil restaurant.";
  } catch (error) {
    logoUploadStatus.textContent = "Import impossible : " + (error.message || error);
  } finally {
    logoUploadButton.disabled = false;
  }
}

function updateLogoUploadStatus() {
  const file = logoUploadInput.files?.[0];
  if (!file) {
    logoUploadStatus.textContent = "Aucun logo importe pour le moment.";
    return;
  }
  logoUploadStatus.textContent = `${file.name} selectionne (${formatBytes(file.size)}).`;
}

function openingHoursToList(hoursByDay) {
  return DAYS.map(([key], index) => {
    const day = hoursByDay[key] || {};
    return {
      day: index + 1,
      isOpen: day.open !== false,
      lunchStart: day.lunchStart || "",
      lunchEnd: day.lunchEnd || "",
      dinnerStart: day.dinnerStart || "",
      dinnerEnd: day.dinnerEnd || ""
    };
  });
}

function normalizeOpeningHoursForForm(profile) {
  if (profile.openingHoursByDay && !Array.isArray(profile.openingHoursByDay)) {
    return profile.openingHoursByDay;
  }

  if (Array.isArray(profile.openingHours)) {
    return profile.openingHours.reduce((hours, item) => {
      const dayNumber = Number(item.day || 0);
      const dayKey = DAYS[dayNumber - 1]?.[0];
      if (!dayKey) return hours;
      hours[dayKey] = {
        open: item.isOpen !== false && item.open !== false,
        lunchStart: item.lunchStart || "",
        lunchEnd: item.lunchEnd || "",
        dinnerStart: item.dinnerStart || "",
        dinnerEnd: item.dinnerEnd || ""
      };
      return hours;
    }, {});
  }

  if (profile.openingHours && typeof profile.openingHours === "object") {
    return profile.openingHours;
  }

  return null;
}

function updateLogoPreview() {
  const logoUrl = form.elements.logoUrl.value.trim();
  if (logoUrl && isValidUrl(logoUrl)) {
    logoPreview.innerHTML = `<img src="${escapeHtml(logoUrl)}" alt="Apercu du logo" />`;
  } else {
    logoPreview.innerHTML = "<span>Apercu logo</span>";
  }
}

function updateSummary() {
  const profile = collectProfile();
  const modeLabel = restaurantContext.mode === "existing" ? "Mise a jour" : "Creation";
  summaryBox.innerHTML = `
    <dl>
      <div><dt>Mode</dt><dd>${escapeHtml(modeLabel)}</dd></div>
      <div><dt>Restaurant ID</dt><dd>${escapeHtml(restaurantContext.restaurantId || "Sera genere a la sauvegarde")}</dd></div>
      <div><dt>Restaurant</dt><dd>${escapeHtml(profile.name || "A completer")}</dd></div>
      <div><dt>Adresse</dt><dd>${escapeHtml(profile.address || "A completer")}</dd></div>
      <div><dt>Contact</dt><dd>${escapeHtml(profile.phone || profile.email || "A completer")}</dd></div>
      <div><dt>Factures</dt><dd>${escapeHtml(profile.invoicePrefix || "FAC")}-${String(profile.nextInvoiceNumber || 1).padStart(4, "0")}</dd></div>
      <div><dt>Modes de vente</dt><dd>${escapeHtml(profile.enabledSalesModes.join(", ") || "Aucun")}</dd></div>
    </dl>
    <p class="soft-warning">SIREN, TVA et RCS pourront etre completes plus tard, mais seront necessaires pour des factures completes.</p>
  `;
}

function saveSession(profileComplete) {
  localStorage.setItem(ACCESS_SESSION_KEY, JSON.stringify({
    active: true,
    userId: currentUser?.uid || "preview-user",
    email: currentUser?.email || "",
    restaurantId: restaurantContext.restaurantId || "",
    profileComplete,
    updatedAt: new Date().toISOString()
  }));
}

function saveLocalProfile(profile) {
  localStorage.setItem(RESTAURANT_PROFILE_KEY, JSON.stringify(profile));
}

function loadLocalProfile() {
  try {
    return JSON.parse(localStorage.getItem(RESTAURANT_PROFILE_KEY) || "null");
  } catch (_) {
    return null;
  }
}

async function ensureRestaurantId(profile = null) {
  if (restaurantContext.restaurantId && restaurantContext.mode !== "new") {
    return restaurantContext.restaurantId;
  }
  if (profile?.name) {
    const slug = normalizeSlug(profile.name) || buildRestaurantId(currentUser?.uid || "preview-user");
    const uniqueSlug = previewMode || !firebaseServices
      ? slug
      : await buildUniqueRestaurantId(slug);
    restaurantContext = {
      restaurantId: uniqueSlug,
      mode: "new",
      source: previewMode ? "preview" : "generated-from-name"
    };
    saveRestaurantContext(restaurantContext);
    return restaurantContext.restaurantId;
  }
  const userId = currentUser?.uid || "preview-user";
  restaurantContext = {
    restaurantId: buildRestaurantId(userId),
    mode: "new",
    source: previewMode ? "preview" : "generated"
  };
  saveRestaurantContext(restaurantContext);
  return restaurantContext.restaurantId;
}

async function buildUniqueRestaurantId(baseSlug) {
  const { doc, getDoc } = firebaseServices.firestoreModule;
  let candidate = baseSlug;
  let suffix = 2;
  while ((await getDoc(doc(firebaseServices.db, "restaurants", candidate))).exists()) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function buildRestaurantId(userId) {
  return "restaurant_" + String(userId || "preview-user").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeRestaurantId(value) {
  return (value || "").toString().trim();
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

function hydrateInviteFromUrl() {
  if (!pendingInviteCode) {
    updateInviteStatus();
    return;
  }
  inviteCodeInput.value = pendingInviteCode;
  inviteStatus.textContent = `Invitation detectee : ${pendingInviteCode}. Connectez-vous pour rejoindre le restaurant.`;
}

function updateInviteStatus() {
  if (!inviteStatus) return;
  if (pendingInviteCode) {
    inviteStatus.textContent = `Code pret : ${pendingInviteCode}.`;
  } else {
    inviteStatus.textContent = "Aucune invitation detectee.";
  }
}

function readInviteCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeInviteCode(
    params.get("invite") ||
    params.get("inviteCode") ||
    params.get("code") ||
    ""
  );
}

function normalizeInviteCode(value) {
  let raw = (value || "").toString().trim();
  raw = raw.replace(/^POKET-RESTAURANTS-INVITE:/i, "");
  if (raw.startsWith("{")) {
    try {
      const payload = JSON.parse(raw);
      raw = payload.inviteCode || payload.code || raw;
    } catch (_) {
      // If a QR payload is malformed, fall back to the sanitized text.
    }
  }
  return raw
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .toUpperCase();
}

function normalizeProfileFromRestaurant(restaurantData, fallbackProfile) {
  if (!restaurantData && !fallbackProfile) return null;
  const nestedProfile = restaurantData?.restaurantProfile || {};
  const mergedProfile = {
    ...(fallbackProfile || {}),
    ...(restaurantData || {}),
    ...nestedProfile
  };
  const normalizedHours = normalizeOpeningHoursForForm(mergedProfile);
  return {
    ...mergedProfile,
    restaurantId: restaurantData?.restaurantId || fallbackProfile?.restaurantId || restaurantContext.restaurantId || "",
    name: mergedProfile.name || "",
    tradeName: mergedProfile.tradeName || mergedProfile.name || "",
    legalName: mergedProfile.legalName || "",
    phone: mergedProfile.phone || "",
    email: mergedProfile.email || "",
    openingHours: Array.isArray(mergedProfile.openingHours)
      ? mergedProfile.openingHours
      : normalizedHours
        ? openingHoursToList(normalizedHours)
        : undefined,
    openingHoursByDay: normalizedHours || undefined
  };
}

function saveRestaurantContext(context) {
  localStorage.setItem(RESTAURANT_CONTEXT_KEY, JSON.stringify(context));
}

function formatFirebaseError(error) {
  const code = error?.code ? String(error.code) : "";
  const message = error?.message ? String(error.message) : "";
  if (code === "permission-denied") {
    return "permission-denied. Verifiez les regles Firestore et l'association utilisateur/restaurant.";
  }
  return [code, message].filter(Boolean).join(" - ") || "erreur inconnue";
}

function loadRestaurantContext() {
  try {
    return JSON.parse(localStorage.getItem(RESTAURANT_CONTEXT_KEY) || "{}");
  } catch (_) {
    return {};
  }
}

function updateRestaurantModeCard() {
  const isExisting = restaurantContext.mode === "existing";
  const localProfile = loadLocalProfile();
  let title = isExisting ? "Completer votre restaurant" : "Creer votre restaurant";
  let description = isExisting
    ? `Restaurant trouve${localProfile?.name ? " : " + localProfile.name : ""}. Les informations seront mises a jour sans recreer l'etablissement.`
    : "Aucun restaurant existant n'a ete trouve pour cette session. Poksol creera un nouvel etablissement.";
  if (accessMode === "edit") {
    title = "Modifier votre restaurant";
    description = isExisting
      ? `Restaurant charge${localProfile?.name ? " : " + localProfile.name : ""}. Adresse, horaires, logo et contacts restent communs entre le web et Poket Restaurants.`
      : "Connectez-vous ou rejoignez un restaurant pour modifier ses informations communes.";
  }
  if (accessMode === "public-page") {
    title = "Editer la page restaurant";
    description = isExisting
      ? "Completez les informations visibles publiquement : logo, adresse, horaires, contact et presentation client."
      : "Connectez-vous ou rejoignez un restaurant pour preparer sa page publique.";
  }
  accessTitle.textContent = title;
  restaurantMode.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(description)}</span>
  `;
  restaurantMode.classList.toggle("is-existing", isExisting);
}

function applyAccessModeStep() {
  if (!stayOnAccessPage) return;
  const stepBySection = {
    identity: 0,
    identite: 0,
    address: 1,
    adresse: 1,
    billing: 2,
    facturation: 2,
    payment: 3,
    paiement: 3,
    hours: 4,
    horaires: 4,
    operations: 5,
    public: 0,
    resume: 6
  };
  if (Object.prototype.hasOwnProperty.call(stepBySection, accessSection)) {
    setStep(stepBySection[accessSection]);
  } else if (accessMode === "public-page") {
    setStep(0);
  }
}

function value(data, key) {
  return (data.get(key) || "").toString().trim();
}

function setField(name, val) {
  const field = form.elements[name];
  if (!field) return;
  if (field.type === "checkbox") field.checked = Boolean(val);
  else field.value = val;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function logoExtension(file) {
  const byType = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg"
  };
  if (byType[file.type]) return byType[file.type];
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]+$/.test(extension) ? extension : "png";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
