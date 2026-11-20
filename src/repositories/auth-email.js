// Auth por email/password usando Firebase Auth (compat SDK).
// Flujo: register → sendEmailVerification → login → check emailVerified.
import { auth } from "./firebase-config.js";

export async function registerEmail(email, password) {
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  await cred.user.sendEmailVerification();
  return cred.user;
}

export async function loginEmail(email, password) {
  const cred = await auth.signInWithEmailAndPassword(email, password);
  return cred.user;
}

export async function resetPassword(email) {
  await auth.sendPasswordResetEmail(email);
}

export async function logoutEmail() {
  await auth.signOut();
}

/** Llama a cb(user) cada vez que cambia el estado de auth.
 *  user es null cuando no hay sesión. */
export function onAuthChange(cb) {
  return auth.onAuthStateChanged(cb);
}

export function getCurrentUser() {
  return auth.currentUser;
}

/** Convierte el token de Google (GIS) en una sesión de Firebase.
 *
 *  Sin esto la app tiene dos identidades paralelas: conectar Google da acceso
 *  a las hojas pero deja request.auth vacío en Firestore, así que las reglas
 *  bloquean todo. Con esto, un solo login de Google sirve para las dos cosas y
 *  todo cuelga del uid de Firebase.
 *
 *  Si ya hay sesión de Firebase (misma cuenta), no hace nada. Falla en
 *  silencio: quedarse sin sesión de Firebase degrada la sincronización, pero
 *  no debe impedir trabajar con las hojas. */
export async function linkGoogleToFirebase(accessToken) {
  if (!accessToken || auth.currentUser) return auth.currentUser;
  try {
    const cred = firebase.auth.GoogleAuthProvider.credential(null, accessToken);
    const res = await auth.signInWithCredential(cred);
    return res.user;
  } catch (e) {
    console.warn("No se pudo abrir sesión de Firebase con Google:", e?.message || e);
    return null;
  }
}
