// Google Identity Services (GIS) token client — reemplaza el OAuth desktop
// de scan-tracker-desktop (GoogleService.java). Corre 100% en el browser,
// sin backend y sin client_secret: el Client ID de tipo "Aplicación web"
// es público por diseño (autorizado por "Authorized JavaScript origins" en
// Google Cloud Console, no por secreto).

const SCOPES =
  "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email";

let tokenClient = null;
let currentToken = null; // { access_token: string, expires_at: number }

export function initAuth(clientId) {
  if (!clientId) throw new Error("falta Client ID");
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: () => {}, // se sobreescribe por cada requestToken()
  });
}

export function requestToken() {
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
      resolve(currentToken.access_token);
    };
    tokenClient.requestAccessToken({ prompt: currentToken ? "" : "consent" });
  });
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
