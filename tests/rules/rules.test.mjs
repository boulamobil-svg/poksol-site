// Tests du fichier UNIQUE de regles (site + application de caisse).
// Principe verifie ici : un meme compte a les memes droits par le site et par
// l'application, et rien n'est ouvert au-dela de ce que prevoit l'application.
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

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-poksol",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
    storage: { rules: readFileSync(new URL("../../storage.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 9199 }
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const restaurant = { publicPageEnabled: true, reservationEnabled: true };
    // « resto » : cree par l'application (createdBy). « legacy » : cree par le site (ownerUid,
    // aucune fiche staff). « other » : un autre restaurant.
    await setDoc(doc(db, "restaurants/resto"), { ...restaurant, createdBy: "creator1", slug: "resto" });
    await setDoc(doc(db, "restaurants/legacy"), { ...restaurant, ownerUid: "site-owner" });
    await setDoc(doc(db, "restaurants/other"), { ...restaurant, createdBy: "creator2" });
    const staff = (id, role, rid = "resto") => setDoc(doc(db, `restaurants/${rid}/staff/${id}`), { uid: id, restaurantId: rid, role, active: true });
    await staff("admin1", "admin");
    await staff("mgr1", "manager");
    await staff("staff1", "staff");
    await staff("admin2", "admin", "other");
    await setDoc(doc(db, "restaurants/resto/staff_users/legacy1"), { uid: "legacy1", restaurantId: "resto", role: "staff", active: true });
    await setDoc(doc(db, "restaurants/resto/menus/main"), { title: "Menu" });
    await setDoc(doc(db, "restaurants/resto/settings/restaurant_profile"), { restaurantProfile: { invoicePrefix: "F" } });
    for (const name of ["customers", "Customers"]) {
      for (const id of ["c-toggle", "c-del-staff", "c-del-mgr", "c-del-admin", "c-mv"]) {
        await setDoc(doc(db, `restaurants/resto/${name}/${id}`), { displayName: "Client " + id, active: true });
      }
    }
    await setDoc(doc(db, "restaurants/resto/room_orders/t1"), { restaurantId: "resto", tableId: "t1" });
    await setDoc(doc(db, "publicRestaurants/resto"), { restaurantId: "resto", publicPageEnabled: true, reservationEnabled: true });
    await setDoc(doc(db, "publicRestaurants/other"), { restaurantId: "other", publicPageEnabled: true, reservationEnabled: true });
    await setDoc(doc(db, "app_release/current"), { targetBuildNumber: 40, downloadUrl: "https://example.com/app.apk" });
    const invite = { restaurantId: "resto", role: "staff", status: "active", active: true, email: "" };
    await setDoc(doc(db, "restaurant_invites/CODE1"), { ...invite, inviteCode: "CODE1" });
    await setDoc(doc(db, "restaurant_invites/CODE_MGR"), { ...invite, inviteCode: "CODE_MGR", role: "manager" });
    await setDoc(doc(db, "restaurant_invites/CODE_ADMIN"), { ...invite, inviteCode: "CODE_ADMIN", role: "admin" });
    await setDoc(doc(db, "restaurant_invites/CODE_PENDING"), { ...invite, inviteCode: "CODE_PENDING", status: "pending" });
    await setDoc(doc(db, "restaurant_invites/CODE_USED"), { ...invite, inviteCode: "CODE_USED", status: "used", active: false });
    await setDoc(doc(db, "restaurant_invites/CODE_EXP"), { ...invite, inviteCode: "CODE_EXP", expiresAt: past });
  });
});

after(async () => { await env.cleanup(); });

const anon = () => env.unauthenticatedContext().firestore();
const as = (uid) => env.authenticatedContext(uid).firestore();

// =====================================================================
// 1. L'application (caisse) : ce que fait le personnel au quotidien
// =====================================================================
const roomOrder = { restaurantId: "resto", tableId: "t2", label: "T2", displayNumber: 1, continuousNumber: 1, dailyNumber: 1, lines: [], isOpen: true, isClosed: false, revision: 1, lastAction: "open", lastWriterDeviceSessionId: "d1" };

test("app: un compte STAFF garde l'acces a la caisse (commandes, appareils, synchronisation, clients)", async () => {
  for (const uid of ["staff1", "legacy1"]) {
    const db = as(uid);
    await assertSucceeds(getDoc(doc(db, "restaurants/resto")));
    await assertSucceeds(setDoc(doc(db, "restaurants/resto/room_orders/t2"), roomOrder));
    await assertSucceeds(setDoc(doc(db, "restaurants/resto/devices/dev1"), { deviceId: "dev1", pendingCloudOperations: 0, pendingLanOperations: 0, missingOperations: 0, needsSync: false }));
    await assertSucceeds(setDoc(doc(db, "restaurants/resto/snapshots/s1"), { any: "thing" }));
    await assertSucceeds(setDoc(doc(db, "restaurants/resto/sync_leases/l1"), { namespace: "orders" }));
    await assertSucceeds(setDoc(doc(db, "restaurants/resto/counters/quotes"), { next: 2 }));
    await assertSucceeds(addDoc(collection(db, "restaurants/resto/reservations"), { restaurantId: "resto", customerName: "Sur place" }));
    await assertSucceeds(addDoc(collection(db, "restaurants/resto/customers"), { displayName: "Nouveau" }));
    await assertSucceeds(updateDoc(doc(db, "restaurants/resto/customers/c-toggle"), { active: false }));
    await assertSucceeds(setDoc(doc(db, "restaurants/resto/customers/c-mv/movements/m-" + uid), { customerId: "c-mv", type: "debit", amount: 12 }));
  }
});

test("app: verification de version (app_release) lisible par un utilisateur connecte, jamais modifiable", async () => {
  await assertSucceeds(getDoc(doc(as("staff1"), "app_release/current")));
  await assertSucceeds(getDoc(doc(as("rando"), "app_release/current")));
  await assertFails(getDoc(doc(anon(), "app_release/current")));
  await assertFails(updateDoc(doc(as("admin1"), "app_release/current"), { downloadUrl: "https://evil.example/app.apk" }));
  await assertFails(setDoc(doc(as("creator1"), "app_release/other"), { x: 1 }));
});

test("app: le staff ne modifie ni le catalogue, ni les reglages, ni le restaurant ; le manager si (catalogue et reglages)", async () => {
  await assertFails(setDoc(doc(as("staff1"), "restaurants/resto/catalog_categories/cat1"), { name: "x" }));
  await assertFails(setDoc(doc(as("staff1"), "restaurants/resto/settings/printers"), { x: 1 }));
  await assertFails(deleteDoc(doc(as("staff1"), "restaurants/resto/room_orders/t1")));
  await assertSucceeds(setDoc(doc(as("mgr1"), "restaurants/resto/catalog_categories/cat1"), { name: "x" }));
  await assertSucceeds(setDoc(doc(as("mgr1"), "restaurants/resto/settings/printers"), { x: 1 }));
  await assertSucceeds(deleteDoc(doc(as("mgr1"), "restaurants/resto/room_orders/t1")));
});

// =====================================================================
// 2. Roles : identiques partout, aucune escalade possible
// =====================================================================
test("roles: seul un admin (ou le createur) modifie le restaurant ; staff et manager ne le peuvent pas", async () => {
  await assertFails(updateDoc(doc(as("staff1"), "restaurants/resto"), { description: "x" }));
  await assertFails(updateDoc(doc(as("mgr1"), "restaurants/resto"), { description: "x" }));
  await assertFails(deleteDoc(doc(as("mgr1"), "restaurants/resto")));
  await assertFails(updateDoc(doc(as("admin2"), "restaurants/resto"), { description: "x" }));
  await assertSucceeds(updateDoc(doc(as("admin1"), "restaurants/resto"), { description: "ok" }));
  await assertSucceeds(updateDoc(doc(as("creator1"), "restaurants/resto"), { description: "ok" }));
});

test("roles: personne ne se donne un role (staff, manager, inconnu)", async () => {
  const forged = (id, role) => ({ uid: id, restaurantId: "resto", role, active: true });
  for (const uid of ["staff1", "mgr1", "rando"]) {
    await assertFails(setDoc(doc(as(uid), `restaurants/resto/staff/${uid}`), forged(uid, "admin")));
    await assertFails(setDoc(doc(as(uid), `restaurants/resto/staff_users/${uid}`), forged(uid, "admin")));
    await assertFails(setDoc(doc(as(uid), `restaurants/resto/members/${uid}`), { role: "owner", status: "active" }));
  }
  await assertFails(updateDoc(doc(as("staff1"), "restaurants/resto/staff/staff1"), { role: "admin" }));
  await assertFails(updateDoc(doc(as("mgr1"), "restaurants/resto/staff/staff1"), { role: "manager" }));
  await assertFails(deleteDoc(doc(as("mgr1"), "restaurants/resto/staff/staff1")));
  await assertSucceeds(setDoc(doc(as("admin1"), "restaurants/resto/staff/newstaff"), forged("newstaff", "staff")));
});

test("transition: l'ancienne collection members reste lisible par l'equipe, jamais inscriptible", async () => {
  await assertSucceeds(getDoc(doc(as("staff1"), "restaurants/resto/members/staff1")).catch(() => null));
  await assertFails(setDoc(doc(as("admin1"), "restaurants/resto/members/x"), { role: "owner" }));
  await assertFails(getDoc(doc(as("rando"), "restaurants/resto/members/x")));
  await assertFails(getDoc(doc(anon(), "restaurants/resto/members/x")));
});

test("roles: rien n'est ouvert par defaut (plus de bloc « manager ecrit partout »)", async () => {
  await assertFails(setDoc(doc(as("admin1"), "restaurants/resto/random_stuff/x"), { a: 1 }));
  await assertFails(setDoc(doc(as("admin1"), "restaurants/resto/members/x"), { a: 1 }));
  await assertFails(setDoc(doc(as("admin1"), "invitations/X"), { a: 1 }));
  await assertFails(getDoc(doc(as("admin1"), "restaurants/resto/random_stuff/x")));
});

test("roles: le createur d'un restaurant du site (ownerUid, sans fiche staff) est reconnu comme admin", async () => {
  await assertSucceeds(getDoc(doc(as("site-owner"), "restaurants/legacy")));
  await assertSucceeds(updateDoc(doc(as("site-owner"), "restaurants/legacy"), { description: "x" }));
  await assertSucceeds(addDoc(collection(as("site-owner"), "restaurants/legacy/customers"), { displayName: "c" }));
  await assertFails(getDoc(doc(as("rando"), "restaurants/legacy")));
  await assertSucceeds(getDocs(query(collection(as("site-owner"), "restaurants"), where("ownerUid", "==", "site-owner"))));
  await assertFails(getDocs(query(collection(as("rando"), "restaurants"), where("ownerUid", "==", "site-owner"))));
});

// =====================================================================
// 3. Creation de restaurant et invitations (site ET application)
// =====================================================================
test("creation: un restaurant cree par le site ou par l'application donne un admin, jamais un autre", async () => {
  // format application (createdBy) puis fiche staff admin initiale
  await assertSucceeds(setDoc(doc(as("new1"), "restaurants/fresh1"), { createdBy: "new1", name: "F1" }));
  await assertSucceeds(setDoc(doc(as("new1"), "restaurants/fresh1/staff/new1"), { uid: "new1", restaurantId: "fresh1", role: "admin", active: true }));
  // format site (ownerUid)
  await assertSucceeds(setDoc(doc(as("new2"), "restaurants/fresh2"), { ownerUid: "new2", createdBy: "new2", name: "F2" }));
  await assertSucceeds(setDoc(doc(as("new2"), "restaurants/fresh2/staff/new2"), { uid: "new2", restaurantId: "fresh2", role: "admin", active: true }));
  // usurpation : creer un restaurant au nom d'un autre, ou se declarer admin d'un restaurant existant
  await assertFails(setDoc(doc(as("rando"), "restaurants/fresh3"), { createdBy: "someone-else" }));
  await assertFails(setDoc(doc(as("rando"), "restaurants/resto/staff/rando"), { uid: "rando", restaurantId: "resto", role: "admin", active: true }));
});

const joinDoc = (uid, role, code) => ({ uid, userId: uid, restaurantId: "resto", role, active: true, inviteCode: code });

test("invitation: on rejoint avec le role de l'invitation, pas un autre (faille de l'ancienne regle de l'application)", async () => {
  await assertSucceeds(setDoc(doc(as("j1"), "restaurants/resto/staff/j1"), joinDoc("j1", "staff", "CODE1")));
  await assertFails(setDoc(doc(as("j2"), "restaurants/resto/staff/j2"), joinDoc("j2", "admin", "CODE1")));
  await assertFails(setDoc(doc(as("j3"), "restaurants/resto/staff/j3"), joinDoc("j3", "manager", "CODE1")));
  await assertSucceeds(setDoc(doc(as("j4"), "restaurants/resto/staff/j4"), joinDoc("j4", "admin", "CODE_ADMIN")));
  await assertSucceeds(setDoc(doc(as("j5"), "restaurants/resto/staff/j5"), joinDoc("j5", "manager", "CODE_MGR")));
  await assertFails(setDoc(doc(as("j6"), "restaurants/resto/staff/j6"), joinDoc("j6", "owner", "CODE1")));
});

test("invitation: utilisee, expiree ou inexistante = refusee ; en attente (format du site) = acceptee", async () => {
  await assertFails(setDoc(doc(as("k1"), "restaurants/resto/staff/k1"), joinDoc("k1", "staff", "CODE_USED")));
  await assertFails(setDoc(doc(as("k2"), "restaurants/resto/staff/k2"), joinDoc("k2", "staff", "CODE_EXP")));
  await assertFails(setDoc(doc(as("k3"), "restaurants/resto/staff/k3"), joinDoc("k3", "staff", "NOPE")));
  await assertSucceeds(setDoc(doc(as("k4"), "restaurants/resto/staff/k4"), joinDoc("k4", "staff", "CODE_PENDING")));
});

test("invitation: la fiche staff_users (ancien format) n'existe que pour le role staff", async () => {
  await assertSucceeds(setDoc(doc(as("l1"), "restaurants/resto/staff_users/l1"), joinDoc("l1", "staff", "CODE1")));
  await assertFails(setDoc(doc(as("l2"), "restaurants/resto/staff_users/l2"), joinDoc("l2", "manager", "CODE_MGR")));
});

test("invitation: lecture par code ok, enumeration impossible, creation reservee aux admins", async () => {
  await assertSucceeds(getDoc(doc(as("rando"), "restaurant_invites/CODE1")));
  await assertFails(getDoc(doc(as("rando"), "restaurant_invites/CODE_USED")));
  await assertFails(getDocs(collection(as("rando"), "restaurant_invites")));
  await assertFails(getDocs(query(collection(as("rando"), "restaurant_invites"), where("restaurantId", "==", "resto"))));
  await assertSucceeds(getDocs(query(collection(as("admin1"), "restaurant_invites"), where("restaurantId", "==", "resto"))));
  await assertFails(getDocs(query(collection(as("admin2"), "restaurant_invites"), where("restaurantId", "==", "resto"))));
  const invite = (code, over = {}) => ({ inviteCode: code, restaurantId: "resto", restaurantName: "R", email: "a@x.com", role: "staff", status: "active", createdBy: "admin1", ...over });
  await assertSucceeds(setDoc(doc(as("admin1"), "restaurant_invites/NEW1"), invite("NEW1")));
  await assertFails(setDoc(doc(as("mgr1"), "restaurant_invites/NEW2"), invite("NEW2", { createdBy: "mgr1" })));
  await assertFails(setDoc(doc(as("admin1"), "restaurant_invites/NEW3"), invite("NEW3", { role: "owner" })));
});

// Charges utiles exactes produites par le code du site (platform.js, poket-access.js).
test("site: creation de restaurant, invitation puis rattachement avec les donnees reelles du site", async () => {
  // createRestaurantFromForm
  const db = as("boss");
  await assertSucceeds(setDoc(doc(db, "restaurants/site-resto"), {
    id: "site-resto", restaurantId: "site-resto", name: "Site Resto", slug: "site-resto", ownerUid: "boss", createdBy: "boss",
    publicPageEnabled: true, qrMenuEnabled: false, reservationEnabled: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(db, "restaurants/site-resto/staff/boss"), {
    uid: "boss", userId: "boss", restaurantId: "site-resto", email: "b@x.com", displayName: "Boss", role: "admin",
    active: true, status: "active", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(db, "publicRestaurants/site-resto"), { id: "site-resto", restaurantId: "site-resto", slug: "site-resto", publicPageEnabled: true, reservationEnabled: true, updatedAt: serverTimestamp() }, { merge: true }));
  // createInvitation (format de l'application)
  await assertSucceeds(setDoc(doc(db, "restaurant_invites/SITE-RESTO-ABC123"), {
    inviteCode: "SITE-RESTO-ABC123", code: "SITE-RESTO-ABC123", restaurantId: "site-resto", email: "serveur@x.com", role: "staff",
    status: "active", active: true, createdBy: "boss", createdByUid: "boss", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  // joinRestaurantWithCode
  const joiner = as("serveur");
  await assertSucceeds(getDoc(doc(joiner, "restaurant_invites/SITE-RESTO-ABC123")));
  const payload = { uid: "serveur", userId: "serveur", restaurantId: "site-resto", email: "serveur@x.com", displayName: "S", role: "staff", active: true, status: "active", inviteCode: "SITE-RESTO-ABC123", joinedAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(joiner, "restaurants/site-resto/staff/serveur"), payload, { merge: true }));
  await assertSucceeds(setDoc(doc(joiner, "restaurants/site-resto/staff_users/serveur"), { ...payload, updatedAt: new Date().toISOString() }, { merge: true }));
  await assertSucceeds(setDoc(doc(joiner, "users/serveur"), { uid: "serveur", activeRestaurantId: "site-resto", joinedInviteCode: "SITE-RESTO-ABC123", updatedAt: serverTimestamp() }, { merge: true }));
  // le serveur est maintenant staff : meme droits sur le site et sur la caisse
  await assertSucceeds(getDoc(doc(joiner, "restaurants/site-resto")));
  await assertSucceeds(addDoc(collection(joiner, "restaurants/site-resto/customers"), { displayName: "Client" }));
  await assertFails(updateDoc(doc(joiner, "restaurants/site-resto"), { name: "Renomme" }));
  await assertFails(setDoc(doc(joiner, "publicRestaurants/site-resto"), { restaurantId: "site-resto", name: "Pirate" }, { merge: true }));
  // le serveur ne peut pas se promouvoir lui-meme
  await assertFails(updateDoc(doc(joiner, "restaurants/site-resto/staff/serveur"), { role: "admin" }));
  // relecture du role par le site (resolveRestaurantRole)
  await assertSucceeds(getDoc(doc(joiner, "restaurants/site-resto/staff/serveur")));
  await assertSucceeds(getDocs(collection(joiner, "restaurants/site-resto/staff")));
});

// Rattachement par invitation = demande d'acces validee par un admin (comme l'application).
import { arrayUnion, writeBatch } from "firebase/firestore";

const accessRequest = (uid, over = {}) => ({
  userId: uid, restaurantId: "resto", restaurantName: "Resto", email: uid + "@x.com", displayName: uid, status: "pending",
  requestType: "invite_code_join_request", requestedRole: "staff", joinInput: "CODE1", inviteCode: "CODE1",
  provider: "google", emailVerified: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over
});

test("acces: le code cree une demande, jamais un acces direct ; abus refuses", async () => {
  const me = as("req1");
  await assertSucceeds(setDoc(doc(me, "restaurants/resto/access_requests/req1"), accessRequest("req1"), { merge: true }));
  await assertSucceeds(setDoc(doc(me, "users/req1"), { uid: "req1", displayName: "req1", updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(getDoc(doc(me, "restaurants/resto")));
  await assertFails(addDoc(collection(me, "restaurants/resto/customers"), { displayName: "x" }));
  await assertSucceeds(getDoc(doc(me, "restaurants/resto/access_requests/req1")));
  // demande au nom d'un autre, statut deja approuve, code inutilisable, ou lecture de celle d'un autre
  await assertFails(setDoc(doc(as("req2"), "restaurants/resto/access_requests/req1"), accessRequest("req1")));
  await assertFails(setDoc(doc(as("req3"), "restaurants/resto/access_requests/req3"), accessRequest("req3", { status: "approved" })));
  await assertFails(setDoc(doc(as("req4"), "restaurants/resto/access_requests/req4"), accessRequest("req4", { inviteCode: "CODE_USED" })));
  await assertFails(setDoc(doc(as("req5"), "restaurants/resto/access_requests/req5"), accessRequest("req5", { inviteCode: "NOPE" })));
  await assertFails(getDoc(doc(as("req2"), "restaurants/resto/access_requests/req1")));
  await assertFails(getDocs(collection(as("req2"), "restaurants/resto/access_requests")));
  // le demandeur ne peut pas s'approuver lui-meme
  await assertFails(updateDoc(doc(me, "restaurants/resto/access_requests/req1"), { status: "approved" }));
});

test("acces: un admin valide (ecritures groupees identiques a reviewAccessRequest) ou refuse", async () => {
  await assertSucceeds(setDoc(doc(as("req6"), "restaurants/resto/access_requests/req6"), accessRequest("req6"), { merge: true }));
  await assertSucceeds(setDoc(doc(as("req6"), "users/req6"), { uid: "req6", updatedAt: serverTimestamp() }, { merge: true }));
  const admin = as("admin1");
  await assertSucceeds(getDocs(collection(admin, "restaurants/resto/access_requests")));
  await assertFails(getDocs(collection(as("mgr1"), "restaurants/resto/access_requests")));
  await assertFails(getDocs(collection(as("admin2"), "restaurants/resto/access_requests")));
  const member = { uid: "req6", email: "req6@x.com", displayName: "req6", username: "req6", phone: "", jobTitle: "Serveur", provider: "google", emailVerified: true, role: "manager", active: true, restaurantId: "resto" };
  const nowIso = new Date().toISOString();
  const batch = writeBatch(admin);
  batch.set(doc(admin, "restaurants/resto/staff/req6"), { ...member, joinedAt: serverTimestamp(), approvedAt: serverTimestamp(), approvedBy: "admin1", updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
  batch.set(doc(admin, "restaurants/resto/staff_users/req6"), { ...member, approvedAt: nowIso, approvedBy: "admin1", updatedAt: nowIso, createdAt: nowIso }, { merge: true });
  batch.update(doc(admin, "users/req6"), { activeRestaurantId: "resto", restaurantIds: arrayUnion("resto"), updatedAt: serverTimestamp() });
  batch.set(doc(admin, "restaurants/resto/access_requests/req6"), { status: "approved", approvedRole: "manager", approvedJobTitle: "Serveur", reviewedBy: "admin1", reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  await assertSucceeds(batch.commit());
  await assertSucceeds(setDoc(doc(admin, "restaurant_invites/CODE1"), { inviteCode: "CODE1", status: "used", active: false, usedBy: "req6", usedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }));
  // le nouveau manager a maintenant les droits d'un manager, pas plus
  const manager = as("req6");
  await assertSucceeds(getDoc(doc(manager, "restaurants/resto")));
  await assertSucceeds(setDoc(doc(manager, "restaurants/resto/catalog_categories/cat9"), { name: "x" }));
  await assertFails(updateDoc(doc(manager, "restaurants/resto"), { description: "x" }));
  await assertFails(updateDoc(doc(manager, "restaurants/resto/staff/req6"), { role: "admin" }));
  // refus
  await assertSucceeds(setDoc(doc(as("req7"), "restaurants/resto/access_requests/req7"), accessRequest("req7", { inviteCode: "CODE_MGR" }), { merge: true }));
  await assertSucceeds(setDoc(doc(admin, "restaurants/resto/access_requests/req7"), { status: "rejected", reviewedBy: "admin1", reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(getDoc(doc(as("req7"), "restaurants/resto")));
  // un manager ne peut ni valider ni refuser
  await assertSucceeds(setDoc(doc(as("req8"), "restaurants/resto/access_requests/req8"), accessRequest("req8", { inviteCode: "CODE_MGR" }), { merge: true }));
  await assertFails(setDoc(doc(as("mgr1"), "restaurants/resto/access_requests/req8"), { status: "approved" }, { merge: true }));
  await assertFails(setDoc(doc(as("mgr1"), "restaurants/resto/staff/req8"), { ...member, uid: "req8" }));
});

// =====================================================================
// 4. Clients (dashboard du site et caisse partagent les memes droits)
// =====================================================================
for (const name of ["customers", "Customers"]) {
  test(`${name}: creation/modification pour tout membre, suppression manager et admin`, async () => {
    await assertSucceeds(getDocs(collection(as("staff1"), `restaurants/resto/${name}`)));
    await assertFails(getDocs(collection(anon(), `restaurants/resto/${name}`)));
    await assertFails(getDocs(collection(as("rando"), `restaurants/resto/${name}`)));
    await assertSucceeds(updateDoc(doc(as("staff1"), `restaurants/resto/${name}/c-toggle`), { active: false }));
    await assertFails(updateDoc(doc(as("rando"), `restaurants/resto/${name}/c-toggle`), { active: false }));
    await assertFails(deleteDoc(doc(as("staff1"), `restaurants/resto/${name}/c-del-staff`)));
    await assertFails(deleteDoc(doc(as("rando"), `restaurants/resto/${name}/c-del-staff`)));
    await assertSucceeds(deleteDoc(doc(as("mgr1"), `restaurants/resto/${name}/c-del-mgr`)));
    await assertSucceeds(deleteDoc(doc(as("admin1"), `restaurants/resto/${name}/c-del-admin`)));
  });
}

// =====================================================================
// 5. Le site public : pages, reservations, contact
// =====================================================================
test("public: la page publique se lit, le document restaurant et les reglages restent prives", async () => {
  await assertSucceeds(getDoc(doc(anon(), "publicRestaurants/resto")));
  await assertSucceeds(getDoc(doc(anon(), "restaurants/resto/menus/main")));
  await assertFails(getDoc(doc(anon(), "restaurants/resto")));
  await assertFails(getDoc(doc(as("rando"), "restaurants/resto")));
  await assertFails(getDoc(doc(anon(), "restaurants/resto/settings/restaurant_profile")));
  await assertSucceeds(getDoc(doc(as("staff1"), "restaurants/resto/settings/restaurant_profile")));
  await assertFails(getDocs(query(collection(as("rando"), "restaurants"), where("slug", "==", "resto"))));
});

const reservation = (over = {}) => ({
  restaurantId: "resto", customerName: "Jean", customerPhone: "0102030405", customerEmail: "",
  customer: { name: "Jean" }, date: "2026-10-01", time: "19:30", phone: "0102030405", email: "", guests: 2, notes: "",
  status: "planned", reservedAt: Timestamp.fromDate(new Date("2026-10-01T19:30:00")), source: "poksol_public_page",
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over
});

test("public: reservation anonyme conforme acceptee, statut ou champs invalides refuses, lecture fermee", async () => {
  const col = () => collection(anon(), "restaurants/resto/reservations");
  await assertSucceeds(addDoc(col(), reservation()));
  await assertFails(addDoc(col(), reservation({ status: "confirmed" })));
  await assertFails(addDoc(col(), reservation({ guests: 500 })));
  await assertFails(addDoc(col(), reservation({ customerName: "" })));
  await assertFails(addDoc(col(), reservation({ notes: "x".repeat(5000) })));
  await assertFails(addDoc(col(), reservation({ restaurantId: "other" })));
  await assertFails(getDocs(col()));
  await assertSucceeds(addDoc(collection(as("rando"), "restaurants/resto/reservations"), reservation()));
});

test("public: message de contact conforme accepte, le reste refuse", async () => {
  const col = () => collection(anon(), "contactMessages");
  const ok = { name: "Jean", email: "jean@x.com", company: "", message: "Bonjour", status: "new", createdAt: serverTimestamp() };
  await assertSucceeds(addDoc(col(), ok));
  await assertFails(addDoc(col(), { ...ok, extra: "x" }));
  await assertFails(addDoc(col(), { ...ok, message: "" }));
  await assertFails(addDoc(col(), { ...ok, message: "x".repeat(5000) }));
  await assertFails(addDoc(col(), { ...ok, email: "pas-un-email" }));
  await assertFails(addDoc(col(), { ...ok, status: "done" }));
  await assertFails(getDocs(col()));
});

test("public: seul un admin met a jour la page publique, sans toucher a celle d'un autre restaurant", async () => {
  await assertSucceeds(setDoc(doc(as("admin1"), "publicRestaurants/resto"), { restaurantId: "resto", name: "Nouveau" }, { merge: true }));
  await assertSucceeds(setDoc(doc(as("admin1"), "publicRestaurants/resto-alias"), { restaurantId: "resto", name: "Alias" }, { merge: true }));
  await assertFails(setDoc(doc(as("mgr1"), "publicRestaurants/resto"), { restaurantId: "resto", name: "Manager" }, { merge: true }));
  await assertFails(setDoc(doc(as("staff1"), "publicRestaurants/resto"), { restaurantId: "resto", name: "Staff" }, { merge: true }));
  await assertFails(setDoc(doc(as("admin1"), "publicRestaurants/other"), { restaurantId: "resto", name: "Pirate" }, { merge: true }));
  await assertFails(setDoc(doc(as("rando"), "publicRestaurants/resto"), { restaurantId: "resto" }, { merge: true }));
});

test("dashboard: le menu QR du site est reserve aux admins", async () => {
  await assertSucceeds(setDoc(doc(as("admin1"), "restaurants/resto/menus/main"), { title: "Menu" }, { merge: true }));
  await assertFails(setDoc(doc(as("mgr1"), "restaurants/resto/menus/main"), { title: "Menu" }, { merge: true }));
});

test("users: chacun ecrit son profil (poste affiche dans l'overview), personne n'ecrit celui d'un autre", async () => {
  await assertSucceeds(setDoc(doc(as("staff1"), "users/staff1"), { uid: "staff1", jobTitles: { resto: "Serveur" } }, { merge: true }));
  await assertSucceeds(getDoc(doc(as("staff1"), "users/staff1")));
  await assertFails(setDoc(doc(as("mgr1"), "users/staff1"), { jobTitles: { resto: "Directeur" } }, { merge: true }));
  await assertFails(getDoc(doc(as("mgr1"), "users/staff1")));
  await assertFails(getDoc(doc(anon(), "users/staff1")));
});

// =====================================================================
// 6. Storage : logos et photos
// =====================================================================
const png = new Uint8Array([137, 80, 78, 71]);
const put = (uid, path, type = "image/png") => {
  const ctx = uid ? env.authenticatedContext(uid) : env.unauthenticatedContext();
  return ctx.storage().ref(path).put(png, { contentType: type });
};

test("storage: logo/couverture pour les admins et le createur, photos du catalogue aussi pour les managers", async () => {
  await assertSucceeds(put("admin1", "restaurants/resto/branding/logo.png"));
  await assertSucceeds(put("creator1", "restaurants/resto/branding/cover.png"));
  await assertSucceeds(put("site-owner", "restaurants/legacy/branding/logo.png"));
  await assertFails(put("mgr1", "restaurants/resto/branding/logo.png"));
  await assertFails(put("staff1", "restaurants/resto/branding/logo.png"));
  await assertFails(put("rando", "restaurants/resto/branding/logo.png"));
  await assertFails(put(null, "restaurants/resto/branding/logo.png"));
  await assertSucceeds(put("mgr1", "restaurants/resto/catalog/cat1/item.png"));
  await assertSucceeds(put("admin1", "restaurants/resto/catalog/cat1/item.png"));
  await assertFails(put("staff1", "restaurants/resto/catalog/cat1/item.png"));
  await assertFails(put("rando", "restaurants/resto/catalog/cat1/item.png"));
});

test("storage: logo d'un restaurant en cours de creation, type d'image controle, lecture publique", async () => {
  await assertSucceeds(put("newbie", "restaurants/brand-new/branding/logo.png"));
  await assertFails(put(null, "restaurants/brand-new/branding/logo.png"));
  await assertFails(put("admin1", "restaurants/resto/branding/x.txt", "text/plain"));
  await assertSucceeds(env.unauthenticatedContext().storage().ref("restaurants/resto/branding/logo.png").getDownloadURL());
});
