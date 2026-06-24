(function () {
  const sessionKey = "poksolAccessSession";
  const profileKey = "poksolRestaurantProfile";
  const accessUrl = "/poket-access.html";

  function hasAccess() {
    try {
      const session = JSON.parse(window.localStorage.getItem(sessionKey) || "null");
      const profile = JSON.parse(window.localStorage.getItem(profileKey) || "null");
      return Boolean(
        session &&
        session.active === true &&
        session.profileComplete === true &&
        profile &&
        profile.name &&
        profile.addressLine1 &&
        profile.postalCode &&
        profile.city &&
        profile.country &&
        profile.paymentTerms &&
        profile.invoicePrefix &&
        Number(profile.nextInvoiceNumber) >= 1 &&
        (profile.phone || profile.email)
      );
    } catch (_) {
      return false;
    }
  }

  if (!hasAccess()) {
    const next = encodeURIComponent("/apps/poket-restaurants/");
    window.location.replace(accessUrl + "?next=" + next);
  }
})();
