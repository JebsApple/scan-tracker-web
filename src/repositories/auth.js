// Google Identity Services (GIS) code client — reemplaza el OAuth desktop
// de scan-tracker-desktop (GoogleService.java). Corre en el browser, pero a
// diferencia de la versión anterior (implicit token flow) el authorization
// code se manda a un Worker de Cloudflare propio (ver /worker) que lo
// cambia por access_token + refresh_token con el client_secret — el
// refresh_token queda en una cookie httpOnly del Worker, nunca llega a este
// JS. Eso es lo que permite reconectar sin popup ni depender del reintento
// "silencioso" de GIS, que muchos navegadores rompen al bloquear cookies de
// terceros hacia accounts.google.com.

// drive.metadata.readonly: solo para listar "Compartidos conmigo" (nombre +
// id de archivo), nunca lee contenido — eso sigue yendo por el scope de
// spreadsheets. drive.appdata: carpeta privada de la app en el Drive del
// usuario, para sincronizar qué series/alias tiene registrados entre
// dispositivos (ver services/cloud-sync-service.js) — no accede a archivos
// normales del usuario. Son scopes "sensibles" en Google Cloud Console: hay
// que habilitar Google Drive API y agregarlos en la pantalla de
// consentimiento OAuth (y agregar test users si la app no está verificada).
const SCOPES =
  "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/drive.appdata";

// URL del Worker después de `wrangler deploy` (ver worker/README.md).
// Reemplazar por la URL real (o el dominio custom que le pongas al Worker).
const AUTH_WORKER_URL = "https://scantracker-google-auth.WORKER_SUBDOMAIN.workers.dev";

let codeClient = null;
let currentToken = null; // { access_token: string, expires_at: number }

async function postAuth(path, body) {
  const res = await fetch(`${AUTH_WORKER_URL}${path}`, {
    method: "POST",
    credentials: "include", // manda/recibe la cookie httpOnly del refresh_token
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error al hablar con el servidor de autenticación.");
  return data;
}

function storeToken({ access_token, expires_in }) {
  currentToken = {
    access_token,
    expires_at: Date.now() + (Number(expires_in) || 3600) * 1000,
  };
  return currentToken.access_token;
}

export function initAuth(clientId) {
  if (!clientId) throw new Error("falta Client ID");
  codeClient = google.accounts.oauth2.initCodeClient({
    client_id: clientId,
    scope: SCOPES,
    ux_mode: "popup",
    callback: () => {}, // se sobreescribe por cada requestToken()
  });
}

export function requestToken() {
  return new Promise((resolve, reject) => {
    if (!codeClient) {
      reject(new Error("auth no inicializado — configurá el Client ID primero"));
      return;
    }
    codeClient.callback = async (resp) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      try {
        const tokens = await postAuth("/token", { code: resp.code });
        resolve(storeToken(tokens));
      } catch (err) {
        reject(err);
      }
    };
    codeClient.requestCode();
  });
}

/** Reintenta la sesión pidiéndole al Worker que use la cookie del
 * refresh_token — sin popup, sin depender del iframe "silencioso" de GIS.
 * Falla en silencio (rechaza la promise) si no hay cookie o el
 * refresh_token fue revocado; el caller debe tratarlo como "seguir sin
 * sesión", no como error visible. */
export async function trySilentLogin() {
  const tokens = await postAuth("/refresh");
  return storeToken(tokens);
}

export async function getAccessToken() {
  if (currentToken && Date.now() < currentToken.expires_at - 60_000) {
    return currentToken.access_token;
  }
  // El access_token vivo se venció: intenta renovar con el refresh_token del
  // Worker antes de pedirle al usuario que vuelva a hacer clic.
  try {
    return await trySilentLogin();
  } catch {
    return requestToken();
  }
}

export function isSignedIn() {
  return !!currentToken;
}

export function signOut() {
  const token = currentToken?.access_token;
  currentToken = null;
  postAuth("/logout").catch(() => {});
  if (token) google.accounts.oauth2.revoke(token, () => {});
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
