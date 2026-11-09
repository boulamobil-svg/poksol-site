/* La page publique d'une société VTC HERO (vtc/?s=<adresse>). Tout le monde la lit par la fonction vtcPublicPage. L'administrateur de la
   société, connecté avec son compte Google Poksol, la modifie sur place : un crayon par bloc, les changements partent à poksolAction et la
   page se recharge. Rien n'est public tant que la page est désactivée ; l'administrateur la voit quand même, avec un bandeau. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

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
const SERVICES = { transfer: "Trajets de A à B", airport: "Aéroports", station: "Gares", disposal: "Mise à disposition", event: "Événements, mariages", business: "Déplacements professionnels", tourism: "Excursions, tourisme", night: "Service de nuit", luggage: "Bagages volumineux", child_seat: "Siège enfant", pmr: "Accès PMR", pets: "Animaux acceptés" };
const DAYS = [["mon", "Lundi"], ["tue", "Mardi"], ["wed", "Mercredi"], ["thu", "Jeudi"], ["fri", "Vendredi"], ["sat", "Samedi"], ["sun", "Dimanche"]];

const slug = (new URLSearchParams(location.search).get("s") || "").trim().toLowerCase();
const main = document.querySelector("[data-vtc-page]");
const bar = document.querySelector("[data-vtc-admin-bar]");
const auth = getAuth(initializeApp(firebaseConfig));
const state = { page: null, admin: null, editing: false, user: null };

const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hours = (v) => (v === "closed" ? "Fermé" : v === "24h" ? "24 h / 24" : v.replace("-", " – "));
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const date = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { dateStyle: "long" }) : "");

async function loadPublic() {
  const r = await fetch(`${FUNCTIONS}/vtcPublicPage?s=${encodeURIComponent(slug)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Erreur ${r.status}`);
  return (await r.json()).page;
}
async function api(path, { method = "GET", query = {}, body } = {}) {
  const token = await state.user.getIdToken();
  const url = new URL(`${FUNCTIONS}/${path}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Erreur ${r.status}`), { reason: data.reason, status: r.status });
  return data;
}
/* L'administrateur de CETTE société, si la personne connectée l'est : sa page telle qu'il la voit (même désactivée). */
async function loadAdmin() {
  if (!state.user) return null;
  try {
    const { data } = await api("poksolDashboard", { query: { view: "page" } });
    return data.slug === slug ? data : null;
  } catch { return null; }
}
const act = (body) => api("poksolAction", { method: "POST", body }).then((r) => r.result);

/* La page vue par l'administrateur, même désactivée, a la forme de la page publique. */
function adminAsPublic(a) {
  return { slug: a.slug, name: a.name, brand: { color: a.brand.color, logoUrl: a.brand.logoUrl }, ...a.page, phone: a.page.showPhone ? "(votre téléphone)" : "", email: a.page.showEmail ? "(votre e-mail)" : "", rating: a.rating, posts: a.posts, reservePath: `/reserve/${a.slug}`, hidden: !a.page.enabled };
}

function render() {
  const p = state.page;
  const edit = state.editing && state.admin;
  if (!p) {
    main.innerHTML = `<p class="vtc-empty"><strong>Cette société n'a pas encore de page.</strong><br>${slug ? `Vous pouvez réserver directement : <a href="${VTC}/reserve/${encodeURIComponent(slug)}">formulaire de réservation</a>.` : "Aucune société indiquée."}</p>`;
    return;
  }
  document.title = `${p.name} | Poksol`;
  document.documentElement.style.setProperty("--vtc-accent", p.brand?.color || "#1976f3");
  const pencil = (what, label) => (edit ? `<button class="vtc-pencil" type="button" data-edit="${what}" aria-label="${esc(label)}" title="${esc(label)}">✎</button>` : "");
  main.innerHTML = `
    <header class="vtc-cover" style="${p.coverUrl ? `background-image:url('${esc(p.coverUrl)}')` : ""}">${edit ? `<button class="vtc-inline-btn vtc-edit-cover" type="button" data-edit="cover">📷 Photo de couverture</button>` : ""}</header>
    <div class="vtc-head">
      ${p.brand?.logoUrl ? `<img class="vtc-logo" src="${esc(p.brand.logoUrl)}" alt="" />` : `<div class="vtc-logo">${esc(initials(p.name))}</div>`}
      <div><h1>${esc(p.name)}</h1><p class="vtc-headline">${esc(p.headline || (edit ? "Ajoutez une accroche" : ""))} ${pencil("headline", "Modifier l'accroche")}</p>${p.rating ? `<span class="vtc-rating">★ ${p.rating.average} <span class="vtc-muted">· ${p.rating.count} avis</span></span>` : ""}</div>
      <div class="vtc-head-actions"><a class="vtc-reserve" href="${VTC}${esc(p.reservePath)}">Réserver</a></div>
    </div>
    <div class="vtc-grid">
      <div>
        <section class="vtc-card">${pencil("description", "Modifier la présentation")}<h2>Présentation</h2><p>${esc(p.description || (edit ? "Présentez votre société : depuis quand, vos véhicules, ce qui vous distingue." : "—"))}</p></section>
        <section class="vtc-posts">
          <div class="reservations-head" style="margin:0"><h2 style="margin:0">Actualités</h2>${edit ? `<button class="vtc-inline-btn" type="button" data-edit="new-post">+ Publier</button>` : ""}</div>
          ${(p.posts || []).map((post) => `<article class="vtc-card vtc-post">${edit ? `<div class="vtc-row-actions" style="position:absolute;top:14px;right:14px"><button type="button" data-edit="post" data-id="${esc(post.id)}">Modifier</button><button type="button" class="is-danger" data-edit="delete-post" data-id="${esc(post.id)}">Supprimer</button></div>` : ""}<time>${esc(date(post.createdAt))}</time>${post.title ? `<h3>${esc(post.title)}</h3>` : ""}${post.text ? `<p>${esc(post.text)}</p>` : ""}${post.photoUrl ? `<img src="${esc(post.photoUrl)}" alt="" loading="lazy" />` : ""}</article>`).join("") || `<p class="vtc-muted">${edit ? "Aucune actualité : publiez la première." : "Pas encore d'actualité."}</p>`}
        </section>
      </div>
      <aside>
        <section class="vtc-card">${pencil("services", "Modifier les services")}<h2>Services</h2>${(p.services || []).length ? `<div class="vtc-chips">${p.services.map((s) => `<span class="vtc-chip">${esc(SERVICES[s] || s)}</span>`).join("")}</div>` : `<p class="vtc-muted">${edit ? "Cochez vos services." : "—"}</p>`}</section>
        <section class="vtc-card" style="margin-top:16px">${pencil("zone", "Modifier la zone")}<h2>Zone desservie</h2><p>${esc(p.zone || (edit ? "Ex. : Nice, Monaco, aéroport de Nice Côte d'Azur" : "—"))}</p></section>
        <section class="vtc-card" style="margin-top:16px">${pencil("hours", "Modifier les horaires")}<h2>Horaires</h2>${Object.keys(p.hours || {}).length ? `<dl class="vtc-hours">${DAYS.filter(([d]) => p.hours[d]).map(([d, l]) => `<dt>${l}</dt><dd>${esc(hours(p.hours[d]))}</dd>`).join("")}</dl>` : `<p class="vtc-muted">${edit ? "Indiquez vos horaires." : "Sur réservation."}</p>`}</section>
        <section class="vtc-card" style="margin-top:16px">${pencil("contact", "Choisir les coordonnées affichées")}<h2>Contact</h2>${p.phone ? `<p>📞 <a href="tel:${esc(p.phone.replace(/\s+/g, ""))}">${esc(p.phone)}</a></p>` : ""}${p.email ? `<p>✉️ <a href="mailto:${esc(p.email)}">${esc(p.email)}</a></p>` : ""}${p.address ? `<p class="vtc-muted">${esc(p.address)}</p>` : ""}${!p.phone && !p.email ? `<p class="vtc-muted">${edit ? "Choisissez ce qui s'affiche." : "Par le formulaire de réservation."}</p>` : ""}</section>
      </aside>
    </div>`;
  bar.innerHTML = state.admin ? `<div class="vtc-admin-bar"><strong>${p.hidden ? "Votre page est désactivée : vous seul la voyez." : "Votre page est en ligne."}</strong>
      ${state.editing ? `<button type="button" data-bar="view">Voir comme un visiteur</button>` : `<button type="button" class="is-primary" data-bar="edit">Modifier la page</button>`}
      <button type="button" data-bar="toggle">${p.hidden ? "Mettre en ligne" : "Désactiver"}</button><a href="../vtc-dashboard.html" style="color:#fff;font-weight:700">Dashboard</a></div>` : "";
}

/* ---- les éditeurs en place */
function editor(section, bodyHtml, onSave) {
  // les crayons du bloc disparaissent le temps de l'édition (leur display CSS l'emporterait sur `hidden`)
  section.querySelectorAll(".vtc-pencil, [data-edit]").forEach((b) => (b.style.display = "none"));
  const form = document.createElement("form");
  form.className = "vtc-editor";
  form.innerHTML = `${bodyHtml}<div class="vtc-form-actions"><button class="primary-btn button-reset" type="submit">Enregistrer</button><button type="button" class="vtc-inline-btn" data-cancel>Annuler</button></div><div data-msg></div>`;
  section.appendChild(form);
  form.querySelector("[data-cancel]").onclick = () => render();
  form.onsubmit = async (e) => {
    e.preventDefault();
    form.querySelector("[data-msg]").innerHTML = `<p class="vtc-note">Enregistrement…</p>`;
    try { await onSave(form); await refresh(); } catch (error) { form.querySelector("[data-msg]").innerHTML = `<p class="vtc-error">${esc(error.message)}</p>`; }
  };
  form.querySelector("input, textarea, select")?.focus();
}
const setPage = (page) => act({ action: "setPublicPage", page });
async function pickImage(kind) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      /* redimensionnée dans le navigateur (1600 px au plus, JPEG), puis envoyée à la fonction qui la range dans le Storage de la société */
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(await act({ action: "uploadImage", kind, contentType: "image/jpeg", data: dataUrl.split(",")[1] }));
    };
    input.click();
  });
}
const EDIT = {
  cover: async () => { const img = await pickImage("cover"); if (img) { await setPage({ coverUrl: img.url }); await refresh(); } },
  headline: (el) => editor(el.closest(".vtc-head > div"), `<label>Accroche (une ligne)<input name="v" maxlength="120" value="${esc(state.admin.page.headline)}" /></label>`, (f) => setPage({ headline: f.v.value })),
  description: (el) => editor(el.closest(".vtc-card"), `<label>Présentation<textarea name="v" maxlength="2000">${esc(state.admin.page.description)}</textarea></label>`, (f) => setPage({ description: f.v.value })),
  zone: (el) => editor(el.closest(".vtc-card"), `<label>Zone desservie<input name="v" maxlength="200" value="${esc(state.admin.page.zone)}" /></label>`, (f) => setPage({ zone: f.v.value })),
  services: (el) => editor(el.closest(".vtc-card"), Object.entries(SERVICES).map(([k, v]) => `<label class="vtc-check"><input type="checkbox" name="s" value="${k}" ${state.admin.page.services.includes(k) ? "checked" : ""} /> ${v}</label>`).join(""), (f) => setPage({ services: [...f.querySelectorAll('[name="s"]:checked')].map((i) => i.value) })),
  hours: (el) => editor(el.closest(".vtc-card"), DAYS.map(([d, l]) => `<label>${l}<select name="${d}">${[["", "Non précisé"], ["24h", "24 h / 24"], ["closed", "Fermé"], ["06:00-22:00", "06:00 – 22:00"], ["07:00-20:00", "07:00 – 20:00"], ["08:00-20:00", "08:00 – 20:00"], ["08:00-00:00", "08:00 – 00:00"]].map(([v, t]) => `<option value="${v}" ${(state.admin.page.hours[d] || "") === v ? "selected" : ""}>${t}</option>`).join("")}<option value="custom">Autre…</option></select></label>`).join("") + `<p class="vtc-note">« Autre » : saisissez ensuite HH:MM-HH:MM dans la case qui apparaît.</p>`, (f) => setPage({ hours: Object.fromEntries(DAYS.map(([d]) => [d, f[d].value === "custom" ? (f[`${d}_c`]?.value || "") : f[d].value])) })),
  contact: (el) => editor(el.closest(".vtc-card"), `<label class="vtc-check"><input type="checkbox" name="phone" ${state.admin.page.showPhone ? "checked" : ""} /> Afficher le téléphone de la société</label><label class="vtc-check"><input type="checkbox" name="email" ${state.admin.page.showEmail ? "checked" : ""} /> Afficher l'adresse e-mail</label><p class="vtc-note">L'adresse postale vient de votre fiche société ; les visiteurs peuvent toujours réserver par le formulaire.</p>`, (f) => setPage({ showPhone: f.phone.checked, showEmail: f.email.checked })),
  "new-post": (el) => postEditor(el.closest(".vtc-posts"), null),
  post: (el) => postEditor(el.closest(".vtc-post"), state.admin.posts.find((p) => p.id === el.dataset.id)),
  "delete-post": async (el) => { if (confirm("Supprimer cette actualité ?")) { await act({ action: "deletePost", postId: el.dataset.id }); await refresh(); } },
};
function postEditor(section, post) {
  let photoUrl = post?.photoUrl || "";
  editor(section, `<label>Titre<input name="title" maxlength="120" value="${esc(post?.title || "")}" /></label><label>Texte<textarea name="text" maxlength="3000">${esc(post?.text || "")}</textarea></label><div class="vtc-row-actions"><button type="button" class="vtc-inline-btn" data-photo>📷 ${photoUrl ? "Changer la photo" : "Ajouter une photo"}</button>${photoUrl ? `<button type="button" class="vtc-inline-btn" data-nophoto>Retirer la photo</button>` : ""}</div><div data-photo-preview>${photoUrl ? `<img src="${esc(photoUrl)}" alt="" style="max-height:160px;border-radius:12px;margin-top:8px" />` : ""}</div>`, async (f) => {
    const body = { title: f.title.value, text: f.text.value, photoUrl };
    await act(post ? { action: "updatePost", postId: post.id, post: body } : { action: "addPost", post: body });
  });
  const form = section.querySelector("form");
  form.querySelector("[data-photo]").onclick = async () => { const img = await pickImage("post"); if (img) { photoUrl = img.url; form.querySelector("[data-photo-preview]").innerHTML = `<img src="${esc(photoUrl)}" alt="" style="max-height:160px;border-radius:12px;margin-top:8px" />`; } };
  form.querySelector("[data-nophoto]")?.addEventListener("click", () => { photoUrl = ""; form.querySelector("[data-photo-preview]").innerHTML = ""; });
}
main.addEventListener("change", (e) => {
  /* horaires « Autre » : une case libre apparaît sous le jour */
  if (e.target.tagName === "SELECT" && e.target.value === "custom" && !e.target.parentElement.querySelector(`[name="${e.target.name}_c"]`)) {
    e.target.insertAdjacentHTML("afterend", `<input name="${e.target.name}_c" placeholder="HH:MM-HH:MM" pattern="\\d{2}:\\d{2}-\\d{2}:\\d{2}" style="margin-top:6px" />`);
  }
});
main.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-edit]");
  if (!btn || !state.admin) return;
  e.preventDefault();
  try { await EDIT[btn.dataset.edit]?.(btn); } catch (error) { alert(error.message); }
});
bar.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-bar]");
  if (!b) return;
  if (b.dataset.bar === "edit") { state.editing = true; render(); }
  if (b.dataset.bar === "view") { state.editing = false; render(); }
  if (b.dataset.bar === "toggle") { try { await setPage({ enabled: Boolean(state.page.hidden) }); await refresh(); } catch (error) { alert(error.message); } }
});

async function refresh() {
  state.admin = await loadAdmin();
  state.page = state.admin ? adminAsPublic(state.admin) : await loadPublic();
  if (state.admin && !state.page.hidden) {
    /* l'administrateur voit la vraie page publique (coordonnées réelles), avec ses outils */
    const pub = await loadPublic();
    if (pub) state.page = { ...pub, hidden: false };
  }
  render();
}
const started = (user) => (async () => {
  state.user = user;
  try { await refresh(); } catch (error) { main.innerHTML = `<p class="vtc-empty">${esc(error.message)}</p>`; }
  /* un lien « se connecter » discret pour l'administrateur qui arrive sur sa page sans être connecté */
  if (!user && state.page) main.insertAdjacentHTML("beforeend", `<p class="vtc-empty" style="padding-top:24px"><small><a href="#" data-admin-login>Vous êtes cette société ? Connectez-vous pour modifier la page.</a></small></p>`);
})();
if (window.__vtcPreviewUser) started(window.__vtcPreviewUser); else onAuthStateChanged(auth, started);
main.addEventListener("click", (e) => { if (e.target.closest("[data-admin-login]")) { e.preventDefault(); signInWithPopup(auth, new GoogleAuthProvider()).catch((error) => alert(error.message)); } });
