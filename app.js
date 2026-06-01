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
})();
