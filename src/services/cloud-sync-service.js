// Sincroniza QUÉ series/alias tenés registrados (no los capítulos — esos
// siguen viniendo del Sheet real en cada sync normal). Al loguearte en un
// dispositivo nuevo, aparecen las series que agregaste en otro. Se activa
// solo en eventos concretos (agregar/borrar serie, agregar/borrar alias),
// no en cada save() — evita spamear la API de Drive por cada click.
import { S, save, logEvent } from "../state/store.js";
import { downloadSyncData, uploadSyncData } from "../repositories/drive-appdata.js";
import { friendlyError, uid } from "../utils.js";
import { getCurrentUser } from "../repositories/auth-email.js";
import { saveUserData as saveFS, loadUserData as loadFS } from "../repositories/user-data.js";
import { isSignedIn } from "../repositories/auth-facade.js";

function syncableSeries() {
  return S.series.filter((s) => s.sheetUrl).map((s) => ({ name: s.name, sheetUrl: s.sheetUrl }));
}

export async function pushCloudState() {
  try {
    await uploadSyncData({ series: syncableSeries(), aliases: S.aliases, updatedAt: new Date().toISOString() });
  } catch (e) {
    logEvent("Sync a la nube fallido", friendlyError(e));
  }
}

/** Se llama una vez al conectar sesión. Trae series/alias de otros
 * dispositivos y los agrega SIN duplicar lo que ya está local (por
 * sheetUrl para series, sin distinguir mayúsculas para alias). */
export async function pullCloudState() {
  let remote;
  try {
    remote = await downloadSyncData();
  } catch (e) {
    logEvent("Sync desde la nube fallido", friendlyError(e));
    return;
  }
  if (!remote) return;

  const localUrls = new Set(S.series.filter((s) => s.sheetUrl).map((s) => s.sheetUrl));
  let added = 0;
  (remote.series || []).forEach((rs) => {
    if (!rs.sheetUrl || localUrls.has(rs.sheetUrl)) return;
    S.series.push({ id: uid(), name: rs.name, sheetUrl: rs.sheetUrl, chapters: [], ocultos: {} });
    localUrls.add(rs.sheetUrl);
    added++;
  });

  const localAliasesNorm = new Set(S.aliases.map((a) => a.trim().toLowerCase()));
  (remote.aliases || []).forEach((a) => {
    const norm = a.trim().toLowerCase();
    if (norm && !localAliasesNorm.has(norm)) {
      S.aliases.push(a);
      localAliasesNorm.add(norm);
    }
  });

  if (added) save();
  return added;
}

// ── Firestore sync (usuarios con cuenta email/password) ────────────

function isEmailUser() {
  const u = getCurrentUser();
  return !!u && !!u.emailVerified;
}

function fbUid() {
  const u = getCurrentUser();
  return u ? u.uid : null;
}

export async function pushFirestoreState() {
  const id = fbUid();
  if (!id) return;
  try {
    await saveFS(id, { series: syncableSeries(), aliases: S.aliases });
  } catch (e) {
    logEvent("Sync Firestore fallido", friendlyError(e));
  }
}

/** Pull desde Firestore. Misma lógica merge que pullCloudState. */
export async function pullFirestoreState() {
  const id = fbUid();
  if (!id) return 0;
  let remote;
  try {
    remote = await loadFS(id);
  } catch (e) {
    logEvent("Sync Firestore fallido", friendlyError(e));
    return 0;
  }
  if (!remote) return 0;

  const localUrls = new Set(S.series.filter((s) => s.sheetUrl).map((s) => s.sheetUrl));
  let added = 0;
  (remote.series || []).forEach((rs) => {
    if (!rs.sheetUrl || localUrls.has(rs.sheetUrl)) return;
    S.series.push({ id: uid(), name: rs.name, sheetUrl: rs.sheetUrl, chapters: [], ocultos: {} });
    localUrls.add(rs.sheetUrl);
    added++;
  });

  const localAN = new Set(S.aliases.map((a) => a.trim().toLowerCase()));
  (remote.aliases || []).forEach((a) => {
    const norm = a.trim().toLowerCase();
    if (norm && !localAN.has(norm)) {
      S.aliases.push(a);
      localAN.add(norm);
    }
  });

  if (added) save();
  return added;
}

/** Helper: empuja datos al backend correcto (Drive o Firestore)
 *  según el tipo de usuario activo. Llamar en vez de pushCloudState()
 *  desde UI para que funcione para todos los usuarios. */
export function pushUserData() {
  if (isSignedIn()) pushCloudState();
  pushFirestoreState();
}
