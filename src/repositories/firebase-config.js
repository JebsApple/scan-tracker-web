// Firebase initialization — compat SDK loaded via CDN in index.html.

const firebaseConfig = {
  apiKey:            "AIzaSyAWdR2SRdmYQ0wtMAV426MeZqzl_1gAQU0",
  authDomain:        "scan-tracker-5ef75.firebaseapp.com",
  projectId:         "scan-tracker-5ef75",
  storageBucket:     "scan-tracker-5ef75.firebasestorage.app",
  messagingSenderId: "287109091241",
  appId:             "1:287109091241:web:1c3cceffd94964fd8b3eb8",
};

// Inicializa solo una vez (module scope)
const app = firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db   = firebase.firestore();

// Emails de testers que pueden loguearse con Google.
// Agregá/quitá emails acá — solo estos usuarios pueden usar el botón de Google.
export const TESTER_EMAILS = [
  "mnznpremium756@gmail.com",
];
