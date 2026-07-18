// Firebase initialization — compat SDK loaded via CDN in index.html.
// Reemplená los placeholders con los valores de tu proyecto Firebase
// (ver PLAN-Manual-Steps.md para instrucciones paso a paso).

const firebaseConfig = {
  apiKey:            "TU_API_KEY",
  authDomain:        "TU_PROJECT.firebaseapp.com",
  projectId:         "TU_PROJECT_ID",
  storageBucket:     "TU_PROJECT.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId:             "TU_APP_ID",
};

// Inicializa solo una vez (module scope)
const app = firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db   = firebase.firestore();

// Emails de testers que pueden loguearse con Google.
// Agregá/quitá emails acá — solo estos usuarios pueden usar el botón de Google.
export const TESTER_EMAILS = [
  // "tu@email.com",
];
