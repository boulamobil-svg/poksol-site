const ACCESS_SESSION_KEY = "poksolAccessSession";
const RESTAURANT_PROFILE_KEY = "poksolRestaurantProfile";
const APP_URL = "/apps/poket-restaurants/";
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

let activeStep = 0;
let firebaseServices = null;
let currentUser = null;
let previewMode = false;

const form = document.querySelector("[data-restaurant-profile-form]");
const statusBox = document.querySelector("[data-access-status]");
const authState = document.querySelector("[data-auth-state]");
const loginButton = document.querySelector("[data-auth-login]");
const demoButton = document.querySelector("[data-auth-demo]");
const logoutButton = document.querySelector("[data-auth-logout]");
const stepButtons = Array.from(document.querySelectorAll("[data-access-step-button]"));
const steps = Array.from(document.querySelectorAll("[data-access-step]"));
const previousButton = document.querySelector("[data-access-prev]");
const nextButton = document.querySelector("[data-access-next]");
const saveLaterButton = document.querySelector("[data-save-later]");
const saveFinalButton = document.querySelector("[data-save-final]");
const summaryBox = document.querySelector("[data-profile-summary]");
const logoPreview = document.querySelector("[data-logo-preview]");
const hoursEditor = document.querySelector("[data-opening-hours]");

renderOpeningHours();
hydrateForm(loadLocalProfile());
bindEvents();
initializeFirebase();
updateUi();

function bindEvents() {
  loginButton.addEventListener("click", signIn);
  demoButton.addEventListener("click", enablePreviewMode);
  logoutButton.addEventListener("click", signOut);
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
  stepButtons.forEach((button) => {
    button.addEventListener("click", () => setStep(Number(button.dataset.accessStepButton)));
  });
}

async function initializeFirebase() {
  try {
    const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js")
    ]);
    const app = initializeApp(firebaseConfig);
    const auth = authModule.getAuth(app);
    const db = firestoreModule.getFirestore(app);
    firebaseServices = { auth, db, authModule, firestoreModule };
    authModule.onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      if (user) {
        await loadRemoteProfile(user.uid);
        const profile = loadLocalProfile();
        if (profile && validateProfile(profile).minimumOk) {
          saveSession(true);
          window.location.href = APP_URL;
          return;
        }
      }
      updateAuthState();
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
  saveSession(false);
  updateAuthState();
  updateUi();
}

async function signOut() {
  previewMode = false;
  currentUser = null;
  localStorage.removeItem(ACCESS_SESSION_KEY);
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
    const snapshot = await getDoc(doc(firebaseServices.db, "users", uid));
    const data = snapshot.exists() ? snapshot.data() : null;
    const profile = data?.restaurantProfile;
    if (profile) {
      saveLocalProfile(profile);
      hydrateForm(profile);
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
  saveLocalProfile(profile);
  saveSession(profile.profileComplete);

  if (firebaseServices && currentUser && !previewMode) {
    try {
      const { doc, setDoc, serverTimestamp } = firebaseServices.firestoreModule;
      await setDoc(
        doc(firebaseServices.db, "users", currentUser.uid),
        {
          uid: currentUser.uid,
          email: currentUser.email || "",
          displayName: currentUser.displayName || "",
          restaurantProfile: {
            ...profile,
            updatedAt: serverTimestamp()
          },
          activeRestaurantId: currentUser.uid,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch (error) {
      statusBox.textContent = "Sauvegarde locale OK. Firestore a refuse ou bloque la sauvegarde.";
      return;
    }
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
    statusBox.textContent = "Champs minimum remplis. Vous pouvez enregistrer ou completer plus tard.";
  } else {
    statusBox.textContent = validation.message;
  }
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
    return { minimumOk: true, strictOk: false, message: "Logo URL doit etre une URL valide." };
  }
  if (Number(profile.nextInvoiceNumber) < 1) {
    return { minimumOk: true, strictOk: false, message: "Le prochain numero de facture doit etre superieur ou egal a 1." };
  }
  return { minimumOk: true, strictOk: true, message: "" };
}

function collectProfile() {
  const data = new FormData(form);
  const enabledSalesModes = data.getAll("enabledSalesModes");
  const profile = {
    name: value(data, "name"),
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
    openingHours: collectOpeningHours(data),
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
    if (key === "openingHours" || key === "enabledSalesModes") return;
    const field = form.elements[key];
    if (field) field.value = val ?? "";
  });
  if (Array.isArray(profile.enabledSalesModes)) {
    form.querySelectorAll('input[name="enabledSalesModes"]').forEach((input) => {
      input.checked = profile.enabledSalesModes.includes(input.value);
    });
  }
  if (profile.openingHours) {
    DAYS.forEach(([key]) => {
      const day = profile.openingHours[key] || {};
      setField(`openingHours.${key}.open`, day.open !== false);
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
  summaryBox.innerHTML = `
    <dl>
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

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
