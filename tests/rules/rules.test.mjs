import { readFileSync } from "node:fs";
import { test, before, after } from "node:test";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, getDocs, collection, query, where,
  serverTimestamp, Timestamp
} from "firebase/firestore";

let env;
const past = Timestamp.fromDate(new Date(Date.now() - 86400000));
const future = Timestamp.fromDate(new Date(Date.now() + 86400000));

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-poksol",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
    storage: { rules: readFileSync(new URL("../../storage.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 9199 }
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const restaurant = { ownerUid: "owner1", publicPageEnabled: true, reservationEnabled: true, slug: "resto", secret: "internal" };
    await setDoc(doc(db, "restaurants/resto"), restaurant);
    await setDoc(doc(db, "restaurants/other"), { ...restaurant, ownerUid: "owner2", slug: "other" });
    await setDoc(doc(db, "restaurants/resto/members/owner1"), { status: "active", role: "owner" });
    await setDoc(doc(db, "restaurants/resto/members/mgr1"), { status: "active", role: "manager" });
    await setDoc(doc(db, "restaurants/resto/members/staff1"), { status: "active", role: "staff" });
    await setDoc(doc(db, "restaurants/resto/members/admin1"), { status: "active", role: "admin" });
    for (const name of ["customers", "Customers"]) {
      for (const id of ["del-owner", "del-admin", "del-manager", "del-staff", "toggle"]) {
        await setDoc(doc(db, `restaurants/resto/${name}/${id}`), { displayName: "Client " + id, active: true });
      }
    }
    await setDoc(doc(db, "restaurants/other/members/owner2"), { status: "active", role: "owner" });
    await setDoc(doc(db, "restaurants/resto/settings/restaurant_profile"), { restaurantProfile: { invoicePrefix: "F" } });
    await setDoc(doc(db, "restaurants/resto/menus/main"), { title: "Menu" });
    await setDoc(doc(db, "publicRestaurants/resto"), { restaurantId: "resto", publicPageEnabled: true, reservationEnabled: true });
    await setDoc(doc(db, "publicRestaurants/other"), { restaurantId: "other", publicPageEnabled: true, reservationEnabled: true });
    const invite = { restaurantId: "resto", role: "staff", active: true, status: "pending" };
    await setDoc(doc(db, "restaurant_invites/CODE1"), invite);
    await setDoc(doc(db, "restaurant_invites/CODE_EMAIL"), { ...invite, email: "a@x.com" });
    await setDoc(doc(db, "restaurant_invites/CODE_INVITED"), { ...invite, invitedEmail: "a@x.com" });
    await setDoc(doc(db, "restaurant_invites/CODE_EXP"), { ...invite, expiresAt: past });
    await setDoc(doc(db, "restaurant_invites/CODE_FUTURE"), { ...invite, expiresAt: future });
    await setDoc(doc(db, "restaurant_invites/CODE_REVOKED"), { ...invite, status: "revoked" });
    await setDoc(doc(db, "invitations/CODE1"), invite);
  });
});

after(async () => { await env.cleanup(); });

const anon = () => env.unauthenticatedContext().firestore();
const user = (uid, token = {}) => env.authenticatedContext(uid, token).firestore();

// ---------- 4. restaurants ----------
test("restaurants: lecture du document complet fermee au public", async () => {
  await assertFails(getDoc(doc(anon(), "restaurants/resto")));
  await assertFails(getDoc(doc(user("rando"), "restaurants/resto")));
});
test("restaurants: proprietaire et equipe peuvent lire", async () => {
  await assertSucceeds(getDoc(doc(user("owner1"), "restaurants/resto")));
  await assertSucceeds(getDoc(doc(user("staff1"), "restaurants/resto")));
});
test("restaurants: listing public ferme, listing par ownerUid ok", async () => {
  await assertFails(getDocs(query(collection(user("rando"), "restaurants"), where("publicPageEnabled", "==", true))));
  await assertFails(getDocs(query(collection(user("rando"), "restaurants"), where("slug", "==", "resto"))));
  await assertSucceeds(getDocs(query(collection(user("owner1"), "restaurants"), where("ownerUid", "==", "owner1"))));
});
test("restaurants: settings prives, menus toujours publics", async () => {
  await assertFails(getDoc(doc(anon(), "restaurants/resto/settings/restaurant_profile")));
  await assertSucceeds(getDoc(doc(user("staff1"), "restaurants/resto/settings/restaurant_profile")));
  await assertSucceeds(getDoc(doc(anon(), "restaurants/resto/menus/main")));
});
test("publicRestaurants: lecture publique ok", async () => {
  await assertSucceeds(getDoc(doc(anon(), "publicRestaurants/resto")));
});

// ---------- 1. invitations ----------
test("invitations: lecture par code ok, listing ferme aux non-admins", async () => {
  await assertSucceeds(getDoc(doc(user("rando"), "restaurant_invites/CODE1")));
  await assertSucceeds(getDoc(doc(user("rando"), "invitations/CODE1")));
  await assertFails(getDocs(collection(user("rando"), "restaurant_invites")));
  await assertFails(getDocs(collection(user("rando"), "invitations")));
  await assertFails(getDocs(query(collection(user("rando"), "restaurant_invites"), where("restaurantId", "==", "resto"))));
  await assertFails(getDocs(query(collection(user("rando"), "invitations"), where("code", "==", "CODE1"))));
  await assertFails(getDoc(doc(anon(), "restaurant_invites/CODE1")));
});
test("invitations: owner/admin peut lister les invitations de son restaurant", async () => {
  await assertSucceeds(getDocs(query(collection(user("owner1"), "restaurant_invites"), where("restaurantId", "==", "resto"))));
  await assertFails(getDocs(query(collection(user("owner2"), "restaurant_invites"), where("restaurantId", "==", "resto"))));
});
const member = (code, role = "staff", uid = "joiner") => ({ uid, status: "active", role, inviteCode: code });
test("rejoindre: invitation valide", async () => {
  await assertSucceeds(setDoc(doc(user("joiner"), "restaurants/resto/members/joiner"), member("CODE1")));
});
test("rejoindre: role different de l'invitation refuse", async () => {
  await assertFails(setDoc(doc(user("joiner2"), "restaurants/resto/members/joiner2"), member("CODE1", "owner", "joiner2")));
});
test("rejoindre: invitation expiree / revoquee refusee, non expiree ok", async () => {
  await assertFails(setDoc(doc(user("j3"), "restaurants/resto/members/j3"), member("CODE_EXP", "staff", "j3")));
  await assertFails(setDoc(doc(user("j4"), "restaurants/resto/members/j4"), member("CODE_REVOKED", "staff", "j4")));
  await assertSucceeds(setDoc(doc(user("j5"), "restaurants/resto/members/j5"), member("CODE_FUTURE", "staff", "j5")));
});
test("rejoindre: invitation reservee a un email", async () => {
  await assertFails(setDoc(doc(user("j6", { email: "b@x.com" }), "restaurants/resto/members/j6"), member("CODE_EMAIL", "staff", "j6")));
  await assertFails(setDoc(doc(user("j7"), "restaurants/resto/members/j7"), member("CODE_EMAIL", "staff", "j7")));
  await assertSucceeds(setDoc(doc(user("j8", { email: "A@X.com" }), "restaurants/resto/members/j8"), member("CODE_EMAIL", "staff", "j8")));
  await assertFails(setDoc(doc(user("j9", { email: "b@x.com" }), "restaurants/resto/members/j9"), member("CODE_INVITED", "staff", "j9")));
  await assertSucceeds(setDoc(doc(user("j10", { email: "a@x.com" }), "restaurants/resto/members/j10"), member("CODE_INVITED", "staff", "j10")));
});
test("invitations: creation par owner ok, par un inconnu refusee", async () => {
  const payload = { restaurantId: "resto", role: "staff", code: "NEW1", status: "pending", active: true };
  await assertSucceeds(setDoc(doc(user("owner1"), "restaurant_invites/NEW1"), payload));
  await assertFails(setDoc(doc(user("rando"), "restaurant_invites/NEW2"), payload));
});

// ---------- 3. ecritures publiques ----------
const reservation = (over = {}) => ({
  restaurantId: "resto",
  customerName: "Jean",
  customerPhone: "0102030405",
  customerEmail: "",
  customer: { name: "Jean", phone: "0102030405", email: "" },
  date: "2026-10-01",
  time: "19:30",
  phone: "0102030405",
  email: "",
  guests: 2,
  notes: "",
  status: "planned",
  reservedAt: Timestamp.fromDate(new Date("2026-10-01T19:30:00")),
  source: "poksol_public_page",
  sourceLabel: "Page publique Poksol",
  reservationSource: "poksol_public_page",
  channel: "web",
  createdBy: "poksol_public_page",
  createdByName: "Page publique Poksol",
  createdByType: "public_page",
  sourceHost: "poksol.com",
  referrer: "",
  origin: "https://poksol.com/restaurants/chez-marwan.html",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...over
});
test("reservations: creation anonyme conforme (payload de platform.js)", async () => {
  await assertSucceeds(addDoc(collection(anon(), "restaurants/resto/reservations"), reservation()));
});
test("reservations: statut, taille et champs invalides refuses", async () => {
  const col = () => collection(anon(), "restaurants/resto/reservations");
  await assertFails(addDoc(col(), reservation({ status: "confirmed" })));
  await assertFails(addDoc(col(), reservation({ guests: 500 })));
  await assertFails(addDoc(col(), reservation({ customerName: "" })));
  await assertFails(addDoc(col(), reservation({ customerName: "x".repeat(500) })));
  await assertFails(addDoc(col(), reservation({ notes: "x".repeat(5000) })));
  await assertFails(addDoc(col(), reservation({ restaurantId: "other" })));
});
test("reservations: lecture anonyme refusee, equipe ok", async () => {
  await assertFails(getDocs(collection(anon(), "restaurants/resto/reservations")));
  await assertSucceeds(getDocs(collection(user("staff1"), "restaurants/resto/reservations")));
});
test("reservations: membre peut creer sans contrainte publique", async () => {
  await assertSucceeds(addDoc(collection(user("staff1"), "restaurants/resto/reservations"), { status: "confirmed", customerName: "Sur place" }));
});
test("contactMessages: message conforme accepte", async () => {
  await assertSucceeds(addDoc(collection(anon(), "contactMessages"), {
    name: "Jean", email: "jean@x.com", company: "", message: "Bonjour", status: "new", createdAt: serverTimestamp()
  }));
});
test("contactMessages: champs invalides refuses, lecture fermee", async () => {
  const col = () => collection(anon(), "contactMessages");
  const ok = { name: "Jean", email: "jean@x.com", company: "", message: "Bonjour", status: "new", createdAt: serverTimestamp() };
  await assertFails(addDoc(col(), { ...ok, extra: "x" }));
  await assertFails(addDoc(col(), { ...ok, message: "" }));
  await assertFails(addDoc(col(), { ...ok, message: "x".repeat(5000) }));
  await assertFails(addDoc(col(), { ...ok, email: "pas-un-email" }));
  await assertFails(addDoc(col(), { ...ok, status: "done" }));
  await assertFails(getDocs(col()));
});
test("publicRestaurants: pas de detournement d'un document existant", async () => {
  await assertSucceeds(setDoc(doc(user("mgr1"), "publicRestaurants/resto"), { restaurantId: "resto", name: "Nouveau" }, { merge: true }));
  await assertFails(setDoc(doc(user("mgr1"), "publicRestaurants/other"), { restaurantId: "resto", name: "Pirate" }, { merge: true }));
  await assertFails(setDoc(doc(user("rando"), "publicRestaurants/resto"), { restaurantId: "resto" }, { merge: true }));
  // alias de slug cree par le dashboard (nouvel identifiant, meme restaurantId)
  await assertSucceeds(setDoc(doc(user("mgr1"), "publicRestaurants/resto-alias"), { restaurantId: "resto", name: "Alias" }, { merge: true }));
});

// ---------- comptes clients (dashboard : desactiver / supprimer / creer) ----------
for (const name of ["customers", "Customers"]) {
  test(`${name}: lecture reservee a l'equipe`, async () => {
    await assertSucceeds(getDocs(collection(user("staff1"), `restaurants/resto/${name}`)));
    await assertFails(getDocs(collection(anon(), `restaurants/resto/${name}`)));
    await assertFails(getDocs(collection(user("rando"), `restaurants/resto/${name}`)));
  });
  test(`${name}: desactivation et creation pour owner, admin et manager`, async () => {
    for (const uid of ["owner1", "admin1", "mgr1"]) {
      await assertSucceeds(updateDoc(doc(user(uid), `restaurants/resto/${name}/toggle`), { active: false }));
      await assertSucceeds(addDoc(collection(user(uid), `restaurants/resto/${name}`), { displayName: "Nouveau" }));
    }
    await assertFails(updateDoc(doc(user("staff1"), `restaurants/resto/${name}/toggle`), { active: false }));
    await assertFails(addDoc(collection(user("staff1"), `restaurants/resto/${name}`), { displayName: "Nouveau" }));
    await assertFails(updateDoc(doc(user("owner2"), `restaurants/resto/${name}/toggle`), { active: false }));
  });
  test(`${name}: suppression reservee a owner et admin`, async () => {
    await assertFails(deleteDoc(doc(user("staff1"), `restaurants/resto/${name}/del-staff`)));
    await assertFails(deleteDoc(doc(user("mgr1"), `restaurants/resto/${name}/del-manager`)));
    await assertFails(deleteDoc(doc(user("rando"), `restaurants/resto/${name}/del-owner`)));
    await assertSucceeds(deleteDoc(doc(user("admin1"), `restaurants/resto/${name}/del-admin`)));
    await assertSucceeds(deleteDoc(doc(user("owner1"), `restaurants/resto/${name}/del-owner`)));
  });
}

// ---------- escalade de privileges ----------
test("un manager ne peut pas s'attribuer un role via members / staff / staff_users", async () => {
  await assertFails(setDoc(doc(user("mgr1"), "restaurants/resto/members/mgr1"), { uid: "mgr1", status: "active", role: "owner" }));
  await assertFails(setDoc(doc(user("mgr1"), "restaurants/resto/members/evil"), { uid: "evil", status: "active", role: "owner" }));
  await assertFails(setDoc(doc(user("mgr1"), "restaurants/resto/staff/mgr1"), { uid: "mgr1", active: true, role: "owner" }));
  await assertFails(setDoc(doc(user("mgr1"), "restaurants/resto/staff_users/mgr1"), { uid: "mgr1", active: true, role: "owner" }));
  await assertFails(deleteDoc(doc(user("mgr1"), "restaurants/resto/members/staff1")));
  await assertSucceeds(setDoc(doc(user("admin1"), "restaurants/resto/staff/newstaff"), { uid: "newstaff", active: true, role: "staff" }));
  await assertFails(updateDoc(doc(user("mgr1"), "restaurants/resto/staff/newstaff"), { role: "owner" }));
  await assertSucceeds(updateDoc(doc(user("mgr1"), "restaurants/resto/staff/newstaff"), { displayName: "Nom" }));
});
test("un manager ne peut pas se declarer proprietaire du restaurant", async () => {
  await assertFails(updateDoc(doc(user("mgr1"), "restaurants/resto"), { ownerUid: "mgr1" }));
  await assertSucceeds(updateDoc(doc(user("mgr1"), "restaurants/resto"), { description: "Nouvelle description" }));
  await assertSucceeds(updateDoc(doc(user("owner1"), "restaurants/resto"), { ownerUid: "owner1", description: "ok" }));
});
test("un manager ne peut ni supprimer ni reprendre le document restaurant", async () => {
  await assertFails(deleteDoc(doc(user("mgr1"), "restaurants/other")));
  await assertFails(deleteDoc(doc(user("admin1"), "restaurants/resto")));
});
test("les sous-collections internes restent ecrivables par l'equipe de gestion (mouvements clients, commandes)", async () => {
  await assertSucceeds(setDoc(doc(user("mgr1"), "restaurants/resto/customers/toggle/movements/m1"), { amount: 12 }));
  await assertSucceeds(setDoc(doc(user("mgr1"), "restaurants/resto/orders/o1"), { total: 30 }));
  await assertFails(setDoc(doc(user("staff1"), "restaurants/resto/orders/o2"), { total: 30 }));
  await assertSucceeds(getDoc(doc(user("staff1"), "restaurants/resto/orders/o1")));
  await assertFails(getDoc(doc(anon(), "restaurants/resto/orders/o1")));
});
test("les invitations internes d'un restaurant restent reservees aux owners/admins", async () => {
  await assertFails(getDocs(collection(user("staff1"), "restaurants/resto/invitations")));
  await assertFails(setDoc(doc(user("mgr1"), "restaurants/resto/invitations/i1"), { role: "owner" }));
  await assertSucceeds(setDoc(doc(user("admin1"), "restaurants/resto/invitations/i1"), { role: "staff" }));
});

// ---------- 2. storage ----------
const png = new Uint8Array([137, 80, 78, 71]);
const put = (uid, path) => {
  const ctx = uid ? env.authenticatedContext(uid) : env.unauthenticatedContext();
  return ctx.storage().ref(path).put(png, { contentType: "image/png" });
};
test("storage: un inconnu ne peut pas ecrire sur un restaurant existant", async () => {
  await assertFails(put("rando", "restaurants/resto/branding/logo.png"));
  await assertFails(put("rando", "restaurants/resto/catalog/cat1/item.png"));
  await assertFails(put("staff1", "restaurants/resto/branding/logo.png"));
  await assertFails(put(null, "restaurants/resto/branding/logo.png"));
});
test("storage: owner, manager et proprietaire legacy peuvent ecrire", async () => {
  await assertSucceeds(put("owner1", "restaurants/resto/branding/logo.png"));
  await assertSucceeds(put("mgr1", "restaurants/resto/catalog/cat1/item.png"));
  await assertSucceeds(put("owner2", "restaurants/other/branding/logo.png"));
});
test("storage: creation d'un nouveau restaurant (logo avant le document)", async () => {
  await assertSucceeds(put("newbie", "restaurants/brand-new/branding/logo.png"));
  await assertFails(put(null, "restaurants/brand-new/branding/logo.png"));
});
test("storage: type et taille toujours controles, lecture publique", async () => {
  const ctx = env.authenticatedContext("owner1");
  await assertFails(ctx.storage().ref("restaurants/resto/branding/x.txt").put(png, { contentType: "text/plain" }));
  await assertSucceeds(env.unauthenticatedContext().storage().ref("restaurants/resto/branding/logo.png").getDownloadURL());
});
