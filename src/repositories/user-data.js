// Persistencia de datos de usuario en Firestore (reemplaza Drive
// appDataFolder para usuarios con cuenta email/password).
// Documento: users/{uid}  —  { series: [...], aliases: [...] }
import { db } from "./firebase-config.js";

export async function saveUserData(uid, data) {
  await db.collection("users").doc(uid).set(data, { merge: true });
}

export async function loadUserData(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

/** Escucha cambios en tiempo real del documento del usuario.
 *  Retorna una función para unsubscribe(). */
export function onUserData(uid, cb) {
  return db.collection("users").doc(uid).onSnapshot((snap) => {
    cb(snap.exists ? snap.data() : null);
  });
}
