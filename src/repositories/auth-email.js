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
