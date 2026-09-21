// Garde-fou d'organisation du fichier unique firebase/firestore.rules :
// chaque fonction et chaque collection doit se trouver dans la section qui lui
// correspond ([COMMUN] / [APPLI] / [SITE]), et aucun bloc « joker » ne doit
// rouvrir tout un restaurant (c'est ce qui laissait un manager tout ecrire).
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const rules = readFileSync(new URL("../../firebase/firestore.rules", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// Ce qui est propre a l'application de caisse ou au site. Tout le reste est [COMMUN].
const APPLI = new Set(`isValidStaffDeviceWrite isOwnStaffDevice isValidRoomOrderOpWrite isValidCanonicalRoomOrderWrite
keepsSameRoomOrderStableIdentity keepsSameRoomOrderOpIdentity isValidDistributedOperationWrite
keepsSameDistributedOperationIdentity isValidDeviceSyncStateWrite isValidUserDeviceSessionWrite licensePath
isValidRestaurantLicenseWrite isDefaultFreeLicenseCreate keepsSameCommercialLicenseTerms licenseDeviceSlotsIncremented
licenseDeviceSlotsDecremented isValidLicensedDeviceWrite isOwnLicensedDeviceClaim keepsSameLicensedDeviceOwner
licenseAllowsNewDeviceClaim licenseAllowsDeviceRemoval isValidOperationAckWrite isValidSyncCounterCreate
isValidSyncCounterUpdate isValidCanonicalPrintJobWrite keepsSamePrintJobBusinessIdentity
keepsSamePrintJobBusinessIdentityExceptSchedule payloadOnlyClearsScheduledAt isPrintJobMakeDueNowTransition
isPrintJobCancelTransition isValidPrintJobCreate isPrintJobClaimTransition isPrintJobClaimedResultTransition
isPrintJobPendingFailureTransition isPrintJobRetryResetTransition isValidPrintJobUpdate
app_release staff_devices quotes counters room_orders room_order_bootstrap room_order_ops operations devices acks
snapshots sync_leases sync_counters device_presence_v1 license licensed_devices user_device_sessions
printer_relay_jobs_v1 print_jobs`.split(/\s+/));
const SITE = new Set(`publicReservationsOpen validPublicReservation menus {legacyCustomers} members contactMessages
publicRestaurants`.split(/\s+/));

function declarations() {
  let tag = null;
  const found = [];
  rules.split("\n").forEach((line, index) => {
    const banner = line.match(/^\s*\/\/ \[(COMMUN|APPLI|SITE)\] /);
    if (banner) tag = banner[1];
    const fn = line.match(/^ {4}function (\w+)\(/);
    const match = line.match(/^ {4,6}match \/(\{\w+\}|[^/ {]+)\//);
    const name = fn?.[1] ?? match?.[1];
    // le conteneur « databases » et le bloc restaurants sont [COMMUN] par construction
    if (name && !["databases"].includes(name)) found.push({ name, tag, line: index + 1 });
  });
  return found;
}

test("chaque fonction et chaque collection est dans sa section [COMMUN] / [APPLI] / [SITE]", () => {
  assert.ok(declarations().length > 80, "le controle ne lit plus les blocs du fichier");
  const wrong = declarations()
    .map((d) => ({ ...d, expected: APPLI.has(d.name) ? "APPLI" : SITE.has(d.name) ? "SITE" : "COMMUN" }))
    .filter((d) => d.tag !== d.expected);
  assert.deepEqual(
    wrong.map((d) => `${d.name} (ligne ${d.line}) : dans [${d.tag}], attendu [${d.expected}]`),
    [],
    "Deplacer le bloc dans la bonne section, ou l'ajouter aux listes APPLI / SITE de ce test si c'est une nouvelle regle propre a l'un des deux."
  );
});

test("les trois sections existent et le fichier annonce sa regle d'or", () => {
  for (const tag of ["COMMUN", "APPLI", "SITE"]) assert.ok(rules.includes("// [" + tag + "] "), "section [" + tag + "] absente");
  assert.ok(rules.includes("FICHIER UNIQUE"), "l'en-tete du fichier unique a disparu");
});

test("aucun bloc joker n'ouvre tout un restaurant", () => {
  assert.equal(/\{\w+=\*\*\}/.test(rules), false, "un match {x=**} rouvrirait des chemins que d'autres regles restreignent");
});
