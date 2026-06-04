(function () {
  const PoksolApp = {
    config: {
      product: "poket-restaurants",
      version: "1.0.0",
      features: {
        authEnabled: false,
        adminEnabled: false
      }
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
})();
