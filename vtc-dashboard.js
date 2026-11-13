/* Dashboard VTC HERO (vtc-dashboard.html) : la vue du dirigeant sur son compte, dans la coque de Poket. La connexion est celle de Poksol
   (Google) ; les données viennent des fonctions de VTC HERO, qui vérifient le jeton et retrouvent l'administrateur par son adresse.
   L'application reste l'outil de travail (courses, agenda) ; ici : vue d'ensemble, société, clients, devis et factures de prestation
   (sans course), page publique, équipe, téléchargements. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRhBXuuJhbSDo9e4kQEEvc1x28HfxAi_E",
  authDomain: "restaurantpos-7a4f0d11.firebaseapp.com",
  projectId: "restaurantpos-7a4f0d11",
  storageBucket: "restaurantpos-7a4f0d11.firebasestorage.app",
  messagingSenderId: "486823214144",
  appId: "1:486823214144:web:a6253af9f0821929e8f3a5"
};

const FUNCTIONS = "https://europe-west9-vtc-hero-prod.cloudfunctions.net";
const VTC = "https://vtc.poksol.com";
const TABS = [["overview", "Vue d'ensemble"], ["company", "Société"], ["clients", "Clients"], ["quotes", "Devis"], ["invoices", "Factures"], ["page", "Page publique"], ["team", "Équipe"], ["downloads", "Téléchargements"]];
const NAV_GROUPS = [["overview", "company", "page"], ["clients", "quotes", "invoices"], ["team", "downloads"]];
const VAT_RATES = [20, 10, 5.5, 2.1, 0];
const STATUS = {
  DEVIS_EN_PREPARATION: ["En préparation", "is-warn"], DEVIS_ENVOYE: ["Envoyé", ""], DEVIS_ACCEPTE: ["Accepté", "is-live"], DEVIS_REFUSE: ["Refusé", "is-bad"],
  FACTURE: ["Facturé", "is-live"], PAYEE: ["Payée", "is-live"], EMISE: ["Émise", ""], ANNULEE: ["Annulée", "is-bad"], EN_ATTENTE: ["En attente", "is-warn"],
  CONFIRMEE: ["Confirmée", "is-live"], TERMINEE: ["Terminée", ""], FACTUREE: ["Facturée", ""], CLIENT_ABSENT: ["Client absent", "is-bad"],
  CHAUFFEUR_EN_ROUTE: ["En route", "is-live"], CHAUFFEUR_ARRIVE: ["Arrivé", "is-live"], CLIENT_A_BORD: ["Client à bord", "is-live"], EN_COURS: ["En cours", "is-live"],
};
const ROLE = { admin: "Administrateur", admin_driver: "Administrateur et chauffeur", driver: "Chauffeur" };
const SERVICE = { ride: "Course", disposal: "Mise à disposition", service: "Prestation" };
const PLAN = { basic: "Essentiel", pro: "Pro", enterprise: "Flotte" };
const PAY = { carte: "Carte", especes: "Espèces", virement: "Virement", cheque: "Chèque", autre: "Autre" };

const root = document.querySelector("[data-vtc-dashboard]");
const auth = getAuth(initializeApp(firebaseConfig));
const state = { user: null, admin: null, tab: "overview", cache: {}, company: "" };

const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { dateStyle: "medium" }) : "—");
const when = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—");
const state_ = (code) => { const [label, cls] = STATUS[code] || [code || "—", ""]; return `<span class="vtc-state ${cls}">${esc(label)}</span>`; };
const round2 = (n) => Math.round(Number((n * 100).toFixed(6))) / 100;

/* ---- l'accès aux fonctions */
async function api(path, { method = "GET", query = {}, body } = {}) {
  const token = await state.user.getIdToken();
  const url = new URL(`${FUNCTIONS}/${path}`);
  Object.entries({ ...query, ...(state.company ? { company: state.company } : {}) }).forEach(([k, v]) => v !== undefined && v !== "" && url.searchParams.set(k, v));
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify({ ...body, company: state.company || undefined }) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Erreur ${response.status}`), { reason: data.reason, status: response.status });
  return data;
}
const view = async (name, params = {}, fresh = false) => {
  const key = `${name}:${JSON.stringify(params)}`;
  if (!fresh && state.cache[key]) return state.cache[key];
  const { admin, data } = await api("poksolDashboard", { query: { view: name, ...params } });
  state.admin = admin;
  state.cache[key] = data;
  return data;
};
const act = (body) => api("poksolAction", { method: "POST", body }).then((r) => { state.cache = {}; return r.result; });

/* ---- la coque */
function shell(active) {
  return `
    <div class="dashboard-shell">
      <button class="dashboard-nav-toggle button-reset" type="button" aria-label="Ouvrir les sections" data-nav-toggle><span></span><span></span><span></span></button>
      <button class="dashboard-nav-backdrop button-reset" type="button" aria-label="Fermer les sections" data-nav-backdrop></button>
      <nav class="dashboard-tabs" aria-label="Sections du dashboard">
        ${NAV_GROUPS.map((group) => `<div class="dashboard-tab-group">${group.map((tab) => `<button class="${tab === active ? "is-active" : ""}" type="button" data-tab="${tab}">${esc(TABS.find(([t]) => t === tab)[1])}</button>`).join("")}</div>`).join("")}
        <div class="dashboard-tab-group"><a class="dashboard-logout-button" href="account.html">Mon compte</a><button class="dashboard-logout-button" type="button" data-logout>Se déconnecter</button></div>
      </nav>
      <section class="dashboard-panel is-active" data-panel>${alert("Chargement…")}</section>
    </div>`;
}
const alert = (text) => `<section class="platform-card"><p class="alert-note">${esc(text)}</p></section>`;
const card = (title, body, eyebrow = "") => `<section class="platform-card">${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ""}${title ? `<h2>${esc(title)}</h2>` : ""}${body}</section>`;
const stat = (label, value) => `<article><span>${esc(label)}</span><strong>${value}</strong></article>`;
const info = (rows) => `<dl class="overview-info-grid">${rows.filter(([, v]) => String(v ?? "").trim()).map(([l, v]) => `<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join("") || "<div><dt>—</dt><dd>Rien de renseigné.</dd></div>"}</dl>`;

function closedBanner() {
  if (!state.admin || state.admin.open) return "";
  const words = { suspended: "Le compte de votre société est suspendu.", trial_ended: "La période d'essai de votre société est terminée.", deleted: "Ce compte est fermé." }[state.admin.state] || "Ce compte est fermé.";
  return `<section class="platform-card"><p class="alert-note">${esc(words)} Vous pouvez consulter vos données ; les actions sont désactivées. Écrivez à <a href="mailto:contact@poksol.com">contact@poksol.com</a>.</p></section>`;
}

/* ---- les onglets */
const PANELS = {
  async overview() {
    const d = await view("overview");
    const c = d.company;
    const sub = c.state === "trial" ? `Essai jusqu'au ${day(c.currentPeriodEnd)}` : c.state === "active" ? `Formule ${esc(d.plan.name)}` : state_(c.state.toUpperCase());
    return `
      ${closedBanner()}
      <div class="dashboard-stats">
        ${stat("Société", esc(c.name))}
        ${stat("Abonnement", sub)}
        ${stat("Clients · courses faites", `${d.counts.invoices} fact. · ${d.counts.ridesDone} courses`)}
      </div>
      ${card("À traiter", `<div class="dashboard-stats">
        ${stat("Demandes à vérifier", d.todo.toVerify)}${stat("Devis à préparer", d.todo.quotesToPrepare)}${stat("Demandes actives", d.todo.activeRequests)}
      </div><div class="quick-links"><a href="${VTC}/bookings" target="_blank" rel="noopener">Traiter dans l'application</a><a href="#" data-tab-link="quotes">Nouveau devis de prestation</a></div>`, "Aujourd'hui")}
      ${card("Le mois en cours", `<div class="dashboard-stats">
        ${stat("Facturé", money(d.month.invoicedTotal))}${stat("Encaissé", money(d.month.paidTotal))}${stat("Impayés", `${money(d.month.outstandingTotal)} <small class="vtc-muted">(${d.month.outstandingCount})</small>`)}
        ${stat("Devis envoyés", d.month.quotesSent)}${stat("Devis acceptés", d.month.quotesAccepted)}${stat("Taux d'acceptation", d.month.quotesSent ? `${Math.round((d.month.quotesAccepted / d.month.quotesSent) * 100)} %` : "—")}
      </div><p class="vtc-note">Les factures du client de test ne comptent pas. Les mêmes règles que l'application.</p>`, "Chiffres")}
      ${card("Prochaines courses", d.upcoming.length ? `<div class="responsive-table vtc-table">${d.upcoming.map((r) => `<div class="table-row"><span>${esc(when(r.at))}</span><span>${esc(r.clientName)}</span><span>${esc(r.pickupAddress)}</span><span>${esc(r.driverName || "Non attribuée")}</span><span>${state_(r.status)}</span></div>`).join("")}</div>` : `<p class="vtc-muted">Aucune course à venir.</p>`, "Agenda")}
      <div class="quick-links"><a href="${VTC}/dashboard" target="_blank" rel="noopener">Ouvrir l'application</a><a href="#" data-tab-link="page">Ma page publique</a><a href="#" data-tab-link="clients">Mes clients</a></div>`;
  },

  async company() {
    const d = await view("company");
    const p = d.profile;
    return `
      ${closedBanner()}
      ${card("Informations légales", info([["Nom commercial", p.name], ["Raison sociale", p.legalName], ["Forme", p.legalForm], ["SIRET", p.siret], ["N° REVTC", p.revtcNumber], ["N° TVA", p.vatNumber], ["Capital", p.shareCapital], ["RCS", p.rcsCity], ["TVA par défaut", `${p.defaultVatRate} %`]]), "Société")}
      ${card("Coordonnées", info([["Adresse", p.address], ["Téléphone", p.phone], ["E-mail", p.email], ["Site", p.website]]))}
      ${card("Règlement", info([["Titulaire du compte", d.bank.holder], ["IBAN", d.bank.ibanEnd], ["Lien de paiement", d.bank.hasPaymentLink ? "Oui" : "Non"]]) + `<p class="vtc-note">Ces informations figurent sur vos devis et factures. Elles se modifient dans l'application, protégées par votre mot de passe.</p><div class="quick-links"><a href="${VTC}/settings/company" target="_blank" rel="noopener">Modifier dans l'application</a>${d.publicSlug ? `<a href="${VTC}/reserve/${encodeURIComponent(d.publicSlug)}" target="_blank" rel="noopener">Mon formulaire de réservation</a>` : ""}</div>`)}
      ${card("Abonnement", info([["État", { active: "Actif", trial: "Essai", trial_ended: "Essai terminé", suspended: "Suspendu", deleted: "Fermé" }[d.state] || d.state], ["Formule", PLAN[d.rights.planId] || d.rights.planId], ["Fin de période", day(d.currentPeriodEnd)], ["Chauffeurs maximum", d.rights.maxDrivers], ["Demandes par mois", d.rights.maxRequestsPerMonth]]))}`;
  },

  async clients() {
    const rows = await view("clients");
    return `
      ${closedBanner()}
      <div class="reservations-head"><div><h2>Clients</h2><p>${rows.length} client${rows.length > 1 ? "s" : ""}. Les chiffres viennent des factures et des courses, hors client de test.</p></div>
        <input type="search" placeholder="Rechercher…" data-filter="clients" style="padding:10px 14px;border-radius:12px;border:1px solid #d3e5ff;font:inherit" /></div>
      <div class="responsive-table vtc-table vtc-clients" data-list="clients">
        <div class="table-row table-head"><span>Client</span><span>Contact</span><span>Courses</span><span>Facturé</span><span>Payé</span><span>Impayé</span></div>
        ${rows.map((c) => `<div class="table-row" data-search="${esc(`${c.name} ${c.email} ${c.phone}`.toLowerCase())}"><span><a href="#" data-client="${esc(c.clientId)}"><strong>${esc(c.name)}</strong></a>${c.business ? `<br><small class="vtc-muted">${esc(c.business.name)}</small>` : ""}</span><span>${esc(c.phone)}${c.phone && c.email ? "<br>" : ""}<small>${esc(c.email)}</small></span><span>${c.ridesDone}</span><span class="vtc-money">${money(c.invoicedTotal)}</span><span class="vtc-money">${money(c.paidTotal)}</span><span class="vtc-money ${c.dueTotal > 0 ? "is-bad" : ""}">${c.dueTotal > 0 ? money(c.dueTotal) : "—"}</span></div>`).join("") || `<p class="vtc-muted" style="padding:16px">Aucun client pour l'instant.</p>`}
      </div>`;
  },

  async quotes() {
    const rows = await view("quotes");
    return `
      ${closedBanner()}
      <div class="reservations-head"><div><h2>Devis</h2><p>${rows.length} devis. Un devis de prestation se fait sans course ; une course passe par l'application.</p></div>
        ${state.admin?.open ? `<button class="client-create-btn button-reset" type="button" data-open="new-quote"><strong>Nouveau devis de prestation</strong></button>` : ""}</div>
      <div class="responsive-table vtc-table">
        <div class="table-row table-head"><span>Date · n°</span><span>Client</span><span>Type</span><span>Montant TTC</span><span>État</span></div>
        ${rows.map((q) => `<details class="reservation-card"><summary class="table-row"><span>${esc(day(q.createdAt))}<br><small class="vtc-muted">${esc(q.number)}</small></span><span>${esc(q.clientName)}</span><span>${esc(SERVICE[q.serviceType] || q.serviceType)}</span><span class="vtc-money">${money(q.total)}</span><span>${state_(q.status)}</span></summary>
          <div class="reservation-details">${detail("Prestation / trajet", q.serviceType === "service" ? q.serviceNote || "Prestation" : [q.pickupAddress, q.dropoffAddress].filter(Boolean).join(" → "))}${detail("Date", q.tripDate || "—")}${detail("Envoyé le", when(q.sentAt))}${detail("Valable jusqu'au", day(q.validUntil))}${q.acceptedInternally ? detail("Accepté en interne", `${q.acceptedInternally.reason} (${when(q.acceptedInternally.at)})`, true) : ""}
            <div class="reservation-detail-item is-wide"><span>Actions</span><div class="vtc-row-actions">
              ${q.publicToken ? `<a class="vtc-inline-btn" href="${VTC}/quote/${encodeURIComponent(q.publicToken)}" target="_blank" rel="noopener">Page du client</a>` : ""}
              ${state.admin?.open && q.status === "DEVIS_EN_PREPARATION" ? `<button type="button" data-open="send-quote" data-id="${esc(q.id)}">Envoyer au client</button>` : ""}
              ${state.admin?.open && q.serviceType === "service" && ["DEVIS_EN_PREPARATION", "DEVIS_ENVOYE"].includes(q.status) ? `<button type="button" data-open="accept-quote" data-id="${esc(q.id)}">Accord reçu (téléphone, bon de commande…)</button>` : ""}
              ${state.admin?.open && q.status === "DEVIS_ACCEPTE" && !q.invoiceId ? `<button type="button" data-do="createInvoice" data-id="${esc(q.id)}">Facturer</button>` : ""}
              ${q.invoiceId ? `<a class="vtc-inline-btn" href="#" data-tab-link="invoices">Voir la facture</a>` : ""}
            </div></div></div></details>`).join("") || `<p class="vtc-muted" style="padding:16px">Aucun devis.</p>`}
      </div>`;
  },

  async invoices() {
    const rows = await view("invoices");
    return `
      ${closedBanner()}
      <div class="reservations-head"><div><h2>Factures</h2><p>${rows.filter((i) => !i.isTest).length} facture${rows.length > 1 ? "s" : ""}. Numérotées par l'application : même suite, même facture électronique.</p></div>
        ${state.admin?.open ? `<button class="client-create-btn button-reset" type="button" data-open="new-invoice"><strong>Nouvelle facture de prestation</strong></button>` : ""}</div>
      <div class="responsive-table vtc-table">
        <div class="table-row table-head"><span>Date · n°</span><span>Client</span><span>Type</span><span>TTC · reste dû</span><span>État</span></div>
        ${rows.map((i) => `<details class="reservation-card"><summary class="table-row"><span>${esc(day(i.createdAt))}<br><small class="vtc-muted">${esc(i.number)}</small></span><span>${esc(i.clientName)}</span><span>${esc(SERVICE[i.serviceType] || i.serviceType)}${i.isTest ? ` <span class="vtc-state is-test">test</span>` : ""}</span><span class="vtc-money">${money(i.total)}${i.amountDue > 0 && i.amountDue !== i.total ? `<br><small>reste ${money(i.amountDue)}</small>` : ""}</span><span>${state_(i.status === "ANNULEE" ? "ANNULEE" : i.paymentStatus)}</span></summary>
          <div class="reservation-details">${detail("HT", money(i.subtotal))}${detail("TVA", money(i.vatAmount))}${detail("Avoirs", i.creditedTotal ? money(i.creditedTotal) : "—")}${detail("Payée le", i.paidAt ? `${when(i.paidAt)} (${PAY[i.paymentMethod] || i.paymentMethod || ""})` : "—")}
            <div class="reservation-detail-item is-wide"><span>Actions</span><div class="vtc-row-actions">
              ${i.pdfUrl ? `<a class="vtc-inline-btn" href="${esc(i.pdfUrl)}" target="_blank" rel="noopener">PDF</a>` : `<a class="vtc-inline-btn" href="${VTC}/invoices" target="_blank" rel="noopener">PDF dans l'application</a>`}
              ${state.admin?.open && i.amountDue > 0 ? `<button type="button" data-open="pay" data-id="${esc(i.id)}" data-amount="${i.amountDue}">Encaisser ${money(i.amountDue)}</button>` : ""}
              ${state.admin?.open && i.status !== "ANNULEE" && i.total - i.creditedTotal > 0 ? `<button type="button" class="is-danger" data-open="credit" data-id="${esc(i.id)}" data-max="${round2(i.total - i.creditedTotal)}">Avoir</button>` : ""}
            </div></div></div></details>`).join("") || `<p class="vtc-muted" style="padding:16px">Aucune facture.</p>`}
      </div>`;
  },

  async page() {
    let d;
    try {
      d = await view("page");
    } catch (error) {
      if (error.reason !== "page_no_form") throw error;
      return `${closedBanner()}${card("Page publique", `<p>Votre société n'a pas encore de formulaire de réservation public : la page publique s'appuie dessus. Ouvrez-le dans l'application, puis revenez ici.</p><div class="quick-links"><a href="${VTC}/settings/public" target="_blank" rel="noopener">Ouvrir l'application</a></div>`)}`;
    }
    const url = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}vtc/?s=${encodeURIComponent(d.slug)}`;
    return `
      ${closedBanner()}
      <div class="dashboard-stats">${stat("Page publique", d.page.enabled ? '<span class="vtc-state is-live">En ligne</span>' : '<span class="vtc-state is-warn">Désactivée</span>')}${stat("Actualités", d.posts.length)}${stat("Note des clients", d.rating ? `★ ${d.rating.average} <small class="vtc-muted">(${d.rating.count})</small>` : "—")}</div>
      ${card("Votre page", `<p>Elle se modifie <strong>sur la page elle-même</strong> : ouvrez-la, vous y verrez des crayons sur chaque bloc (photo de couverture, présentation, services, horaires, coordonnées, actualités).</p>
        <div class="quick-links"><a href="${esc(url)}" target="_blank" rel="noopener">Ouvrir et modifier ma page</a>${state.admin?.open ? `<a href="#" data-do="togglePage" data-enabled="${d.page.enabled ? "1" : "0"}">${d.page.enabled ? "Désactiver la page" : "Mettre la page en ligne"}</a>` : ""}</div>
        <p class="vtc-note">Adresse à partager : <code>${esc(url)}</code>. Le bouton « Réserver » de la page mène à votre formulaire.</p>`, "poksol.com/vtc")}`;
  },

  async team() {
    const rows = await view("team");
    return `
      ${closedBanner()}
      <div class="reservations-head"><div><h2>Équipe</h2><p>${rows.length} personne${rows.length > 1 ? "s" : ""}. Inviter ou désactiver un chauffeur se fait dans l'application.</p></div></div>
      <div class="responsive-table vtc-table vtc-team">
        <div class="table-row table-head"><span>Nom</span><span>E-mail</span><span>Rôle</span><span>État</span></div>
        ${rows.map((u) => `<div class="table-row ${u.isActive ? "" : "is-inactive-row"}"><span><strong>${esc(u.name)}</strong></span><span>${esc(u.email)}</span><span>${esc(ROLE[u.role] || u.role)}</span><span>${u.isActive ? '<span class="vtc-state is-live">Actif</span>' : '<span class="vtc-state">Inactif</span>'}</span></div>`).join("")}
      </div>
      <div class="quick-links"><a href="${VTC}/drivers" target="_blank" rel="noopener">Gérer l'équipe dans l'application</a></div>`;
  },

  async downloads() {
    let release = null;
    try {
      release = await fetch(`${VTC}/downloads/version.json`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    } catch { /* le site de l'application ne répond pas : les liens restent */ }
    return `${card("VTC HERO sur vos appareils", `<ul class="rf-rows" style="list-style:none;padding:0;margin:0;display:grid;gap:10px">
        <li><a href="${VTC}/login" target="_blank" rel="noopener"><strong>Application navigateur</strong><span> — sur ordinateur, tablette ou téléphone, sans rien installer.</span></a></li>
        <li><a href="${VTC}/downloads/vtc-hero.apk"><strong>Android (APK)</strong><span> — ${release ? `version ${esc(release.versionName)} (${release.versionCode}), ${Math.round(release.size / 1048576)} Mo` : "la dernière version"} ; notifications avec son, même application fermée.</span></a></li>
        <li><a href="${VTC}/app" target="_blank" rel="noopener"><strong>Comment installer</strong><span> — la page d'installation de l'application.</span></a></li>
      </ul>`, "Téléchargements")}`;
  },
};
const detail = (label, value, wide = false) => `<div class="reservation-detail-item${wide ? " is-wide" : ""}"><span>${esc(label)}</span><strong>${esc(value || "—")}</strong></div>`;

/* ---- les fenêtres (formulaires) */
function modal(title, body, { wide = false } = {}) {
  document.querySelector("[data-vtc-modal]")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "client-modal-overlay";
  overlay.dataset.vtcModal = "";
  overlay.innerHTML = `<div class="client-modal${wide ? " is-wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h3>${esc(title)}</h3><button class="button-reset client-modal-close" type="button" data-close aria-label="Fermer">&times;</button></header><div class="client-modal-body">${body}</div></div>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest("[data-close]")) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}
const field = (label, name, attrs = "", type = "input") => `<label>${esc(label)}${type === "textarea" ? `<textarea name="${name}" ${attrs}></textarea>` : `<input name="${name}" ${attrs} />`}</label>`;
const lineRow = (l = { label: "", quantity: 1, unitPrice: "", vatRate: 20 }) => `<div class="vtc-line" data-line>
  <input name="label" placeholder="Libellé" value="${esc(l.label)}" required />
  <input name="quantity" type="number" min="0.01" step="0.01" value="${esc(l.quantity)}" required />
  <input name="unitPrice" type="number" min="0" step="0.01" placeholder="Prix HT" value="${esc(l.unitPrice)}" required />
  <select name="vatRate">${VAT_RATES.map((r) => `<option value="${r}" ${Number(l.vatRate) === r ? "selected" : ""}>TVA ${r} %</option>`).join("")}</select>
  <span class="vtc-line-total vtc-money" data-line-total>—</span>
  <button type="button" class="button-reset vtc-inline-btn" data-remove-line aria-label="Retirer">×</button></div>`;

async function documentForm(kind) {
  const clients = await view("clients").catch(() => []);
  const isInvoice = kind === "invoice";
  const body = `<form class="platform-form" data-doc-form data-kind="${kind}">
    <p class="vtc-note">${isInvoice ? "La facture est émise tout de suite, numérotée par l'application. Indiquez comment le client a donné son accord : c'est écrit au journal." : "Le devis est créé en préparation ; vous l'envoyez ensuite au client, qui l'accepte sur sa page (ou vous notez son accord)."}</p>
    <div class="form-grid">
      <label class="wide-field">Client existant<input list="vtc-clients" name="pick" placeholder="Tapez un nom pour pré-remplir…" /><datalist id="vtc-clients">${clients.map((c) => `<option value="${esc(c.name)}" data-id="${esc(c.clientId)}"></option>`).join("")}</datalist></label>
      ${field("Prénom", "firstName", 'autocomplete="off"')}${field("Nom", "lastName", "required")}${field("E-mail", "email", 'type="email"')}${field("Téléphone", "phone")}
      <label class="wide-field"><span class="vtc-check"><input type="checkbox" name="isBusiness" /> Le client est une entreprise (facturation avec SIREN)</span></label>
      <div class="wide-field" data-business hidden><div class="form-grid">${field("Raison sociale", "companyName")}${field("SIREN ou SIRET", "companySiret")}${field("N° TVA (facultatif)", "companyVat")}${field("Adresse de facturation", "billingAddress")}</div></div>
      ${field("Date de la prestation", "serviceDate", 'type="date"')}${field(isInvoice ? "Accord du client (obligatoire)" : "Note (facultatif)", isInvoice ? "reason" : "note", isInvoice ? 'required placeholder="Accord par téléphone le…, bon de commande n°…"' : 'placeholder="Ce qui apparaît sur le document"')}
    </div>
    <p class="vtc-lines-head" style="margin-top:14px">Lignes</p>
    <div class="vtc-lines" data-lines>${lineRow()}</div>
    <button type="button" class="vtc-inline-btn" data-add-line>+ Ajouter une ligne</button>
    <div class="vtc-totals"><span>HT <span class="vtc-money" data-sub>—</span></span><span>TVA <span class="vtc-money" data-vat>—</span></span><strong>TTC <span class="vtc-money" data-total>—</span></strong></div>
    <div class="vtc-form-actions"><button class="primary-btn button-reset" type="submit">${isInvoice ? "Émettre la facture" : "Créer le devis"}</button><button type="button" class="vtc-inline-btn" data-close>Annuler</button></div>
    <div data-form-msg></div></form>`;
  const overlay = modal(isInvoice ? "Nouvelle facture de prestation" : "Nouveau devis de prestation", body, { wide: true });
  const form = overlay.querySelector("form");
  const totals = () => {
    let sub = 0, vat = 0;
    form.querySelectorAll("[data-line]").forEach((row) => {
      const q = round2(Number(row.querySelector('[name="quantity"]').value)), p = round2(Number(row.querySelector('[name="unitPrice"]').value)), r = Number(row.querySelector('[name="vatRate"]').value);
      const t = round2(q * p); sub = round2(sub + t); vat = round2(vat + round2((t * r) / 100));
      row.querySelector("[data-line-total]").textContent = money(t);
    });
    form.querySelector("[data-sub]").textContent = money(sub); form.querySelector("[data-vat]").textContent = money(vat); form.querySelector("[data-total]").textContent = money(round2(sub + vat));
  };
  totals();
  form.addEventListener("input", (e) => {
    if (e.target.name === "pick") {
      const c = clients.find((x) => x.name === e.target.value);
      if (c) { form.firstName.value = c.firstName; form.lastName.value = c.lastName; form.email.value = c.email; form.phone.value = c.phone; if (c.business) { form.isBusiness.checked = true; form.companyName.value = c.business.name; form.companySiret.value = c.business.siret; form.companyVat.value = c.business.vat; form.billingAddress.value = c.business.address; } }
    }
    if (e.target.name === "isBusiness") form.querySelector("[data-business]").hidden = !e.target.checked;
    totals();
  });
  form.addEventListener("click", (e) => {
    if (e.target.closest("[data-add-line]")) { form.querySelector("[data-lines]").insertAdjacentHTML("beforeend", lineRow()); totals(); }
    const rm = e.target.closest("[data-remove-line]");
    if (rm && form.querySelectorAll("[data-line]").length > 1) { rm.closest("[data-line]").remove(); totals(); }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = form.querySelector("[data-form-msg]");
    const lines = [...form.querySelectorAll("[data-line]")].map((row) => ({ label: row.querySelector('[name="label"]').value, quantity: Number(row.querySelector('[name="quantity"]').value), unitPrice: Number(row.querySelector('[name="unitPrice"]').value), vatRate: Number(row.querySelector('[name="vatRate"]').value) }));
    const client = { firstName: form.firstName.value, lastName: form.lastName.value, email: form.email.value, phone: form.phone.value, ...(form.isBusiness.checked ? { billing: { isBusiness: true, companyName: form.companyName.value, companySiret: form.companySiret.value, companyVat: form.companyVat.value, billingAddress: form.billingAddress.value } } : {}) };
    msg.innerHTML = `<p class="vtc-note">Enregistrement…</p>`;
    try {
      const r = await act({ action: isInvoice ? "createServiceInvoice" : "createServiceQuote", client, lines, serviceDate: form.serviceDate.value, note: form.note?.value, reason: form.reason?.value });
      overlay.remove();
      toast(isInvoice ? `Facture ${r.invoiceNumber} émise.` : `Devis ${r.quoteNumber} créé. Envoyez-le au client quand il est prêt.`);
      await show(isInvoice ? "invoices" : "quotes");
    } catch (error) { msg.innerHTML = `<p class="vtc-error">${esc(error.message)}</p>`; }
  });
}

function smallForm(title, fields, onSubmit, submitLabel = "Valider") {
  const overlay = modal(title, `<form class="platform-form" data-small><div class="form-grid">${fields}</div><div class="vtc-form-actions"><button class="primary-btn button-reset" type="submit">${esc(submitLabel)}</button><button type="button" class="vtc-inline-btn" data-close>Annuler</button></div><div data-form-msg></div></form>`);
  const form = overlay.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = form.querySelector("[data-form-msg]");
    msg.innerHTML = `<p class="vtc-note">Enregistrement…</p>`;
    try { await onSubmit(form); overlay.remove(); } catch (error) { msg.innerHTML = `<p class="vtc-error">${esc(error.message)}</p>`; }
  });
}
const OPEN = {
  "new-quote": () => documentForm("quote"),
  "new-invoice": () => documentForm("invoice"),
  "send-quote": (id) => smallForm("Envoyer le devis au client", field("Valable (jours)", "validDays", 'type="number" min="1" max="90" value="15"') + `<p class="vtc-note wide-field">Le client reçoit un e-mail avec sa page de devis (s'il a une adresse) ; vous pouvez aussi lui copier le lien « Page du client ».</p>`, async (f) => { await act({ action: "sendQuote", quoteId: id, validDays: Number(f.validDays.value) }); toast("Devis envoyé."); await show("quotes"); }, "Envoyer"),
  "accept-quote": (id) => smallForm("Accord du client reçu", field("Comment le client a donné son accord", "reason", 'required placeholder="Téléphone le 9 nov., bon de commande n° 445…"') + `<p class="vtc-note wide-field">Le devis devient accepté sans passer par sa page ; le motif est écrit au journal. Vous pourrez ensuite facturer.</p>`, async (f) => { await act({ action: "acceptQuoteInternally", quoteId: id, reason: f.reason.value }); toast("Devis accepté."); await show("quotes"); }, "Enregistrer l'accord"),
  pay: (id, btn) => smallForm(`Encaisser ${money(btn.dataset.amount)}`, `<label class="wide-field">Moyen de paiement<select name="method">${Object.entries(PAY).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label><p class="vtc-note wide-field">Le paiement est enregistré comme dans l'application : la facture passe « Payée ».</p>`, async (f) => { await act({ action: "recordPayment", invoiceId: id, method: f.method.value }); toast("Paiement enregistré."); await show("invoices"); }, "Encaisser"),
  credit: (id, btn) => smallForm("Émettre un avoir", field("Montant TTC de l'avoir", "amountTtc", `type="number" min="0.01" step="0.01" max="${btn.dataset.max}" value="${btn.dataset.max}" required`) + field("Motif", "reason", 'required placeholder="Geste commercial, erreur de facturation…"') + `<p class="vtc-note wide-field">L'avoir est numéroté par l'application (AV-…). La facture est annulée si l'avoir couvre tout.</p>`, async (f) => { const r = await act({ action: "createCreditNote", invoiceId: id, amountTtc: Number(f.amountTtc.value), reason: f.reason.value }); toast(`Avoir ${r.creditNoteNumber} émis.`); await show("invoices"); }, "Émettre l'avoir"),
};
const DO = {
  createInvoice: async (id) => { const r = await act({ action: "createInvoice", quoteId: id }); toast(`Facture ${r.invoiceNumber} émise.`); await show("invoices"); },
  togglePage: async (_, el) => { await act({ action: "setPublicPage", page: { enabled: el.dataset.enabled !== "1" } }); toast(el.dataset.enabled === "1" ? "Page désactivée." : "Page en ligne."); await show("page"); },
};

function toast(text) {
  document.querySelector("[data-vtc-toast]")?.remove();
  const el = document.createElement("div");
  el.dataset.vtcToast = "";
  el.className = "vtc-ok";
  el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:50;box-shadow:0 8px 24px rgba(0,0,0,.15)";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function clientPanel(id) {
  const c = await view("client", { id });
  const docs = (rows, kind) => rows.length ? `<div class="responsive-table vtc-table">${rows.map((r) => `<div class="table-row"><span>${esc(day(r.createdAt))}<br><small class="vtc-muted">${esc(r.number)}</small></span><span>${esc(kind === "quote" ? SERVICE[r.serviceType] || r.serviceType : r.paymentStatus === "PAYEE" ? "Payée" : "À encaisser")}</span><span>${esc(kind === "quote" ? r.tripDate || "" : r.paidAt ? day(r.paidAt) : "")}</span><span class="vtc-money">${money(r.total)}${kind === "invoice" && r.amountDue > 0 ? `<br><small>reste ${money(r.amountDue)}</small>` : ""}</span><span>${state_(kind === "invoice" && r.status === "ANNULEE" ? "ANNULEE" : r.status)}</span></div>`).join("")}</div>` : `<p class="vtc-muted">Aucun.</p>`;
  return `
    <div class="reservations-head"><div><a href="#" class="button-reset client-back-btn" data-tab-link="clients">← Clients</a><h2>${esc(c.name)}</h2><p>${c.business ? `${esc(c.business.name)} · SIREN ${esc(c.business.siret)}` : "Particulier"}${c.anonymized ? " · données anonymisées" : ""}</p></div>
      ${state.admin?.open ? `<div class="vtc-row-actions"><button type="button" data-open="new-quote">Nouveau devis</button><button type="button" data-open="new-invoice">Nouvelle facture</button></div>` : ""}</div>
    <div class="dashboard-stats">${stat("Courses faites", `${c.ridesDone}${c.ridesMissed || c.ridesCancelled ? ` <small class="vtc-muted">(${c.ridesMissed} absent, ${c.ridesCancelled} annulée${c.ridesCancelled > 1 ? "s" : ""})</small>` : ""}`)}${stat("Facturé (net d'avoirs)", money(c.invoicedTotal))}${stat("Payé", money(c.paidTotal))}${stat("Impayé", `${money(c.dueTotal)} <small class="vtc-muted">(${c.dueCount})</small>`)}${stat("Première course", day(c.firstRideAt))}${stat("Dernière course", day(c.lastRideAt))}</div>
    ${card("Coordonnées", info([["Téléphone", c.phone], ["E-mail", c.email], ["Adresse", c.address], ["Langue", c.language], ["Client depuis", day(c.createdAt)]]))}
    ${card(`Devis (${c.quotes.length})`, docs(c.quotes, "quote"))}
    ${card(`Factures (${c.invoices.length})`, docs(c.invoices, "invoice"))}
    ${card(`Courses (${c.rides.length})`, c.rides.length ? `<div class="responsive-table vtc-table">${c.rides.map((r) => `<div class="table-row"><span>${esc(when(r.at))}</span><span>${esc(r.pickupAddress)}</span><span>${esc(r.dropoffAddress)}</span><span>${esc(r.driverName || "—")}</span><span>${state_(r.status)}</span></div>`).join("")}</div>` : `<p class="vtc-muted">Aucune course.</p>`)}
    <p class="vtc-note">Les notes internes et la fusion de doublons se font dans l'application.</p>`;
}

/* ---- la navigation */
async function show(tab, params) {
  state.tab = tab;
  const panel = root.querySelector("[data-panel]");
  root.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
  root.querySelector(".dashboard-shell")?.classList.remove("is-nav-open");
  panel.innerHTML = alert("Chargement…");
  try {
    panel.innerHTML = tab === "client" ? await clientPanel(params) : await PANELS[tab]();
  } catch (error) {
    panel.innerHTML = error.status === 403 ? notAdminHtml() : `<section class="platform-card"><p class="eyebrow">Indisponible</p><h2>Impossible de charger cette section</h2><p class="alert-note">${esc(error.message)}</p><div class="quick-links"><button class="ghost-action" type="button" onclick="location.reload()">Réessayer</button></div></section>`;
  }
}
const notAdminHtml = () => `<section class="platform-card"><p class="eyebrow">Dashboard VTC HERO</p><h2>Aucune société à administrer</h2><p>L'adresse <strong>${esc(state.user?.email || "")}</strong> n'est l'administrateur d'aucune société VTC HERO. Connectez-vous avec l'adresse utilisée pour VTC HERO, ou demandez un accès.</p><div class="quick-links"><a href="${VTC}/inscription">Demander un accès</a><a href="account.html">Mon compte</a><button class="ghost-action" type="button" data-logout>Changer de compte</button></div></section>`;

root.addEventListener("click", async (e) => {
  if (e.target.closest("[data-login]")) { try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (error) { root.querySelector("[data-login-msg]")?.replaceChildren(Object.assign(document.createElement("p"), { className: "vtc-error", textContent: error.code === "auth/unauthorized-domain" ? "Ce domaine n'est pas encore autorisé pour la connexion Google." : error.message })); } return; }
  if (e.target.closest("[data-logout]")) { signOut(auth); return; }
  if (e.target.closest("[data-nav-toggle]")) root.querySelector(".dashboard-shell")?.classList.toggle("is-nav-open");
  if (e.target.closest("[data-nav-backdrop]")) root.querySelector(".dashboard-shell")?.classList.remove("is-nav-open");
  const tab = e.target.closest("[data-tab]");
  if (tab) return show(tab.dataset.tab);
  const link = e.target.closest("[data-tab-link]");
  if (link) { e.preventDefault(); return show(link.dataset.tabLink); }
  const client = e.target.closest("[data-client]");
  if (client) { e.preventDefault(); return show("client", client.dataset.client); }
  const open = e.target.closest("[data-open]");
  if (open) { e.preventDefault(); return OPEN[open.dataset.open]?.(open.dataset.id, open); }
  const doIt = e.target.closest("[data-do]");
  if (doIt) { e.preventDefault(); try { await DO[doIt.dataset.do]?.(doIt.dataset.id, doIt); } catch (error) { toast(error.message); } }
});
root.addEventListener("input", (e) => {
  if (e.target.dataset.filter === "clients") {
    const q = e.target.value.trim().toLowerCase();
    root.querySelectorAll('[data-list="clients"] [data-search]').forEach((row) => { row.hidden = q && !row.dataset.search.includes(q); });
  }
});

/* L'aperçu local (serveur de développement) fournit un faux utilisateur ; en production il n'existe pas et la connexion Google décide. */
const started = (user) => (async () => {
  state.user = user; state.admin = null; state.cache = {};
  if (!user) {
    root.innerHTML = `<section class="platform-card"><p class="eyebrow">Dashboard protégé</p><h2>Connexion nécessaire</h2><p>Connectez-vous avec le compte Google de votre adresse VTC HERO pour ouvrir le dashboard de votre société.</p><button class="primary-btn button-reset" type="button" data-login>Se connecter avec Google</button><div data-login-msg></div></section>`;
    return;
  }
  root.innerHTML = shell("overview");
  state.company = new URLSearchParams(location.search).get("company") || "";
  await show("overview");
})();
if (window.__vtcPreviewUser) started(window.__vtcPreviewUser); else onAuthStateChanged(auth, started);
