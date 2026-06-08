(function () {
  const PoksolApp = {
    config: {
      product: "poket-restaurants",
      version: "future-prep-1",
      features: {
        authEnabled: false,
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
        return Promise.resolve({
          ok: false,
          reason: "Auth backend not enabled yet"
        });
      },
      logout: function () {
        this.isAuthenticated = false;
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
      window.alert(messages[action] || "Fonction preparee pour une prochaine phase Poksol.");
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
