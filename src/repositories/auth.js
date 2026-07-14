// Google Identity Services (GIS) token client — reemplaza el OAuth desktop
// de scan-tracker-desktop (GoogleService.java). Corre 100% en el browser,
// sin backend y sin client_secret: el Client ID de tipo "Aplicación web"
// es público por diseño (autorizado por "Authorized JavaScript origins" en
// Google Cloud Console, no por secreto).

// drive.metadata.readonly: solo para listar "Compartidos conmigo" (nombre +
// id de archivo), nunca lee contenido — eso sigue yendo por el scope de
// spreadsheets. Es un scope "sensible" en Google Cloud Console: hay que
// habilitar Google Drive API y agregar este scope en la pantalla de
// consentimiento OAuth (y agregar test users si la app no está verificada).
const SCOPES =
  "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.metadata.readonly";

let tokenClient = null;
let currentToken = null; // { access_token: string, expires_at: number }

// GIS (implicit token flow) no da refresh_token por diseño de seguridad de
// Google — el access_token vive en memoria y se pierde al recargar. Lo único
// persistible es SI el usuario dio consentimiento antes, para poder
// reintentar un login silencioso (sin popup) al volver a abrir la app.
const CONSENT_KEY = "scantracker_google_consent";
function markConsented() {
  try { localStorage.setItem(CONSENT_KEY, "1"); } catch {}
}
export function hasConsented() {
  try { return localStorage.getItem(CONSENT_KEY) === "1"; } catch { return false; }
}

export function initAuth(clientId) {
  if (!clientId) throw new Error("falta Client ID");
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: () => {}, // se sobreescribe por cada requestToken()
  });
}

export function requestToken(opts = {}) {
  const silent = !!opts.silent;
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error("auth no inicializado — configurá el Client ID primero"));
      return;
    }
    tokenClient.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      currentToken = {
        access_token: resp.access_token,
        expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
      };
      markConsented();
      resolve(currentToken.access_token);
    };
    tokenClient.requestAccessToken({ prompt: silent ? "" : (currentToken ? "" : "consent") });
  });
}

/** Reintenta sesión sin popup si ya hubo consentimiento antes. Falla en
 * silencio (rechaza la promise) si el navegador bloquea el intento o el
 * usuario ya no tiene sesión activa en Google — el caller debe manejarlo
 * como "seguir sin sesión", no como error visible. */
export function trySilentLogin() {
  if (!hasConsented()) return Promise.reject(new Error("sin consentimiento previo"));
  return requestToken({ silent: true });
}

export async function getAccessToken() {
  if (currentToken && Date.now() < currentToken.expires_at - 60_000) {
    return currentToken.access_token;
  }
  return requestToken();
}

export function isSignedIn() {
  return !!currentToken;
}

export function signOut() {
  if (currentToken) {
    google.accounts.oauth2.revoke(currentToken.access_token, () => {});
  }
  currentToken = null;
}

export async function fetchEmail() {
  const token = await getAccessToken();
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`userinfo HTTP ${res.status}`);
  const data = await res.json();
  return data.email || "";
}

// Client ID fijo en el código — no hay opción de configurarlo desde la UI,
// es un solo login normal de Google, sin nada que pegar/perder.
export const DEFAULT_CLIENT_ID = "50665049250-07f71ktrd7a8gd8fhg63l3jhv4hdnu6k.apps.googleusercontent.com";
