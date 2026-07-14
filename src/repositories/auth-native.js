// Login nativo de Google en la app Android (Capacitor), vía Credential
// Manager (@capawesome/capacitor-google-sign-in) — selector de cuenta nativo
// del sistema, no un navegador ni el WebView (Google bloquea OAuth dentro de
// WebViews embebidos, ver commit del fix de "google is not defined").
//
// Mismo Client ID WEB que usa el flujo de escritorio — el plugin lo exige así
// aunque corra en Android (lo pasa como "server client ID" al Credential
// Manager), no hace falta un Client ID de tipo Android ni tocar Google Cloud
// Console de nuevo.
// Sin bundler en este proyecto: no se puede `import` el paquete npm del
// plugin directo (el browser/WebView no resuelve specifiers bare como
// "@capawesome/..."). El runtime nativo inyecta window.Capacitor.Plugins.*
// antes de cargar esta página, igual que en mobile/capacitor-bridge.js.
import { DEFAULT_CLIENT_ID } from "./auth.js";

const GoogleSignIn = () => window.Capacitor.Plugins.GoogleSignIn;

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
];

let initialized = false;
let session = null; // { accessToken, email, obtainedAt }

export { DEFAULT_CLIENT_ID };

export async function initAuth(clientId) {
  if (!clientId) throw new Error("falta Client ID");
  if (initialized) return;
  await GoogleSignIn().initialize({ clientId, scopes: SCOPES });
  initialized = true;
}

export async function requestToken() {
  const result = await GoogleSignIn().signIn();
  if (!result.accessToken) throw new Error("Google no devolvió access token — revisá los scopes");
  session = { accessToken: result.accessToken, email: result.email || "", obtainedAt: Date.now() };
  return session.accessToken;
}

// Credential Manager no expone un modo "silencioso" distinto de signIn() en
// este plugin — a diferencia del flujo web (GIS), acá no hay forma de
// reintentar sesión sin mostrar el selector nativo. Se rechaza siempre; el
// caller (app.js) ya trata el rechazo como "seguir sin sesión", no como error.
export function trySilentLogin() {
  return Promise.reject(new Error("sin soporte de reintento silencioso en Android nativo"));
}

export async function getAccessToken() {
  // Los access token de Google duran ~1h — se pide uno nuevo pasados 55min
  // por margen, igual que el flujo web.
  if (session && Date.now() - session.obtainedAt < 55 * 60 * 1000) return session.accessToken;
  return requestToken();
}

export function isSignedIn() {
  return !!session;
}

export async function signOut() {
  await GoogleSignIn().signOut();
  session = null;
}

// El resultado de signIn() ya trae el email — no hace falta un fetch aparte
// a userinfo como en el flujo web.
export async function fetchEmail() {
  if (!session) await requestToken();
  return session.email;
}
