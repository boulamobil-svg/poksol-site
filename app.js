(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyCRhBXuuJhbSDo9e4kQEEvc1x28HfxAi_E",
    authDomain: "restaurantpos-7a4f0d11.firebaseapp.com",
    projectId: "restaurantpos-7a4f0d11",
    storageBucket: "restaurantpos-7a4f0d11.firebasestorage.app",
    messagingSenderId: "486823214144",
    appId: "1:486823214144:web:a6253af9f0821929e8f3a5"
  };

  let accountAuth = null;
  let accountAuthModule = null;
  let accountDb = null;
  let accountFirestoreModule = null;

  const PoksolApp = {
    config: {
      product: "poket-restaurants",
      version: "future-prep-1",
      features: {
        authEnabled: true,
        adminEnabled: false,
        deviceLimitEnabled: false,
        qrInviteEnabled: false,
        accountPortalEnabled: false,
        publicRestaurantPagesEnabled: true,
        reservationsBackendEnabled: false
      },
      roadmap: [
        "user-authentication",
        "single-device-per-standard-user",
        "owner-admin-console",
        "physical-qr-user-invite",
        "public-restaurant-pages",
        "online-reservations"
      ]
    },

    auth: {
      isAuthenticated: false,
      login: function () {
        return signInToAccount();
      },
      logout: function () {
        return signOutFromAccount();
      }
    },

    admin: {
      hasAccess: function () {
        return false;
      },
      openDashboard: function () {
        return {
          ok: false,
          reason: "Admin area is not implemented yet"
        };
      }
    },

    devices: {
      getPolicy: function () {
        return {
          enabled: false,
          standardUserLimit: 1,
          reason: "Device control will be enabled with the future backend phase"
        };
      }
    },

    portal: {
      status: function () {
        return {
          ok: true,
          mode: "static-preview",
          message: "Poksol account and admin portal are prepared on the front end"
        };
      }
    },

    restaurants: {
      getPublicPageModel: function () {
        return {
          enabled: true,
          source: "static-preview",
          futureDataSource: "Firestore",
          features: [
            "opening-hours",
            "menu-with-photos",
            "reservation-form",
            "google-business-link",
            "shareable-qr-code"
          ]
        };
      }
    }
  };

  window.PoksolApp = PoksolApp;

  function showPreparedNotice(anchor, message) {
    const target = anchor.closest(".portal-panel") || anchor.closest(".portal-hero-content") || document.body;
    let notice = target.querySelector("[data-prepared-notice]");

    if (!notice) {
      notice = document.createElement("div");
      notice.className = "prepared-notice";
      notice.setAttribute("data-prepared-notice", "");
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      target.appendChild(notice);
    }

    notice.textContent = message;
    notice.classList.add("is-visible");
  }

  const accountLoginButton = document.querySelector("[data-account-login]");
  const accountLogoutButton = document.querySelector("[data-account-logout]");
  const accountState = document.querySelector("[data-account-state]");
  const accountAvatar = document.querySelector("[data-account-avatar]");
  const accountName = document.querySelector("[data-account-name]");
  const accountEmail = document.querySelector("[data-account-email]");
  const accountRestaurant = document.querySelector("[data-account-restaurant]");
  const deviceTitle = document.querySelector("[data-device-title]");
  const deviceStatus = document.querySelector("[data-device-status]");

  if (accountLoginButton) {
    initializeAccountAuth();
    accountLoginButton.addEventListener("click", signInToAccount);
  }

  if (accountLogoutButton) {
    accountLogoutButton.addEventListener("click", signOutFromAccount);
  }

  async function initializeAccountAuth() {
    try {
      const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js")
      ]);
      const app = initializeApp(firebaseConfig);
      accountAuthModule = authModule;
      accountFirestoreModule = firestoreModule;
      accountAuth = authModule.getAuth(app);
      accountDb = firestoreModule.getFirestore(app);
      authModule.onAuthStateChanged(accountAuth, updateAccountUi);
    } catch (error) {
      updateAccountMessage("Connexion indisponible : Firebase n'a pas pu etre charge.");
    }
  }

  async function signInToAccount() {
    if (!accountAuth || !accountAuthModule) {
      updateAccountMessage("Connexion en cours de chargement. Reessayez dans quelques secondes.");
      return { ok: false };
    }

    try {
      const provider = new accountAuthModule.GoogleAuthProvider();
      await accountAuthModule.signInWithPopup(accountAuth, provider);
      return { ok: true };
    } catch (error) {
      updateAccountMessage("Connexion impossible : " + readableAuthError(error));
      return { ok: false, reason: error.code || error.message || String(error) };
    }
  }

  async function signOutFromAccount() {
    if (!accountAuth || !accountAuthModule) return { ok: false };
    await accountAuthModule.signOut(accountAuth);
    return { ok: true };
  }

  async function updateAccountUi(user) {
    PoksolApp.auth.isAuthenticated = Boolean(user);

    if (!accountState) return;

    if (!user) {
      accountState.textContent = "Connectez-vous avec Google pour acceder au portail Poksol.";
      setText(accountAvatar, "PK");
      setText(accountName, "Utilisateur Poksol");
      setText(accountEmail, "En attente de connexion securisee");
      setText(accountRestaurant, "Aucun restaurant charge");
      accountLoginButton?.classList.remove("is-hidden");
      accountLogoutButton?.classList.add("is-hidden");
      setText(deviceTitle, "Limite prevue");
      setText(deviceStatus, "1 appareil par utilisateur standard");
      return;
    }

    const displayName = user.displayName || "Utilisateur Poksol";
    accountState.textContent = "Connexion active.";
    setText(accountAvatar, initials(displayName, user.email));
    setText(accountName, displayName);
    setText(accountEmail, user.email || "Compte Google connecte");
    accountLoginButton?.classList.add("is-hidden");
    accountLogoutButton?.classList.remove("is-hidden");
    setText(deviceTitle, "Session active");
    setText(deviceStatus, "Controle appareil pret pour la phase owner/admin.");

    const attachedRestaurant = await loadAttachedRestaurant(user.uid);
    if (attachedRestaurant) {
      setText(accountRestaurant, attachedRestaurant.name || attachedRestaurant.id);
      accountState.textContent = `Connexion active. Restaurant attache : ${attachedRestaurant.name || attachedRestaurant.id}.`;
    } else {
      setText(accountRestaurant, "Aucun restaurant attache");
      accountState.textContent = "Connexion active. Aucun restaurant attache pour le moment.";
    }
  }

  function updateAccountMessage(message) {
    if (accountState) accountState.textContent = message;
  }

  function readableAuthError(error) {
    if (error?.code === "auth/unauthorized-domain") {
      return "le domaine poksol.com doit etre ajoute dans Firebase Authentication > Authorized domains.";
    }
    if (error?.code === "auth/popup-closed-by-user") {
      return "la fenetre Google a ete fermee avant la fin.";
    }
    return error?.message || String(error);
  }

  function initials(name, email) {
    const source = (name || email || "Poksol").trim();
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  async function loadAttachedRestaurant(uid) {
    if (!accountDb || !accountFirestoreModule || !uid) return null;
    try {
      const { doc, getDoc } = accountFirestoreModule;
      const userSnapshot = await getDoc(doc(accountDb, "users", uid));
      const userData = userSnapshot.exists() ? userSnapshot.data() : null;
      const restaurantId = (
        userData?.activeRestaurantId ||
        (Array.isArray(userData?.restaurantIds) ? userData.restaurantIds[0] : "")
      )?.toString().trim();
      if (!restaurantId) return null;

      const restaurantSnapshot = await getDoc(doc(accountDb, "restaurants", restaurantId));
      if (!restaurantSnapshot.exists()) {
        return { id: restaurantId, name: restaurantId };
      }
      const restaurantData = restaurantSnapshot.data();
      const profile = restaurantData.restaurantProfile || {};
      return {
        id: restaurantId,
        name: profile.tradeName || profile.name || restaurantData.tradeName || restaurantData.name || restaurantId
      };
    } catch (_) {
      return null;
    }
  }

  function setText(element, value) {
    if (element) element.textContent = value;
  }

  document.querySelectorAll("[data-carousel]").forEach(function (carousel) {
    const track = carousel.querySelector("[data-carousel-track]");
    const slides = Array.from(carousel.querySelectorAll("[data-carousel-slide]"));
    const dots = Array.from(carousel.querySelectorAll("[data-carousel-dot]"));
    const previous = carousel.querySelector("[data-carousel-prev]");
    const next = carousel.querySelector("[data-carousel-next]");
    let activeIndex = 0;
    let autoplayId;

    function showSlide(index) {
      activeIndex = (index + slides.length) % slides.length;
      track.style.transform = "translateX(-" + activeIndex * 100 + "%)";

      slides.forEach(function (slide, slideIndex) {
        slide.classList.toggle("is-active", slideIndex === activeIndex);
      });

      dots.forEach(function (dot, dotIndex) {
        const isActive = dotIndex === activeIndex;
        dot.classList.toggle("is-active", isActive);
        dot.setAttribute("aria-current", isActive ? "true" : "false");
      });
    }

    function startAutoplay() {
      window.clearInterval(autoplayId);
      autoplayId = window.setInterval(function () {
        showSlide(activeIndex + 1);
      }, 5000);
    }

    previous.addEventListener("click", function () {
      showSlide(activeIndex - 1);
      startAutoplay();
    });

    next.addEventListener("click", function () {
      showSlide(activeIndex + 1);
      startAutoplay();
    });

    dots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        showSlide(Number(dot.dataset.carouselDot));
        startAutoplay();
      });
    });

    carousel.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") {
        showSlide(activeIndex - 1);
      }
      if (event.key === "ArrowRight") {
        showSlide(activeIndex + 1);
      }
    });

    carousel.addEventListener("mouseenter", function () {
      window.clearInterval(autoplayId);
    });
    carousel.addEventListener("mouseleave", startAutoplay);

    showSlide(0);
    startAutoplay();
  });

  document.querySelectorAll("[data-future-action]").forEach(function (button) {
    button.addEventListener("click", function () {
      const action = button.dataset.futureAction;
      const messages = {
        login: "Connexion utilisateur prevue en Phase 3B. Aucun backend actif pour le moment.",
        "device-reset": "La demande de reinitialisation appareil sera reservee aux comptes connectes.",
        "invite-user": "L'invitation par QR physique sera activee avec l'espace owner/admin.",
        "admin-action": "Action admin preparee mais non activee sans backend securise."
      };
      showPreparedNotice(
        button,
        messages[action] || "Fonction preparee pour une prochaine phase Poksol."
      );
    });
  });

  document.querySelectorAll("[data-reservation-preview]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      window.alert(
        "Reservation preparee cote site. La prochaine phase branchera ce formulaire a Poket Restaurants."
      );
      form.reset();
    });
  });
})();
