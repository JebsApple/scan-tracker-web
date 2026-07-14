// Único punto de entrada de auth para el resto de la app — elige el flujo
// nativo (Android empaquetado, Credential Manager) o el de GIS (browser
// normal) según dónde corre. Nadie más debe importar auth.js/auth-native.js
// directamente, para no repetir esta rama de decisión en cada archivo.
import * as web from "./auth.js";
import * as native from "./auth-native.js";

const isNative = () => !!window.Capacitor?.isNativePlatform?.();
const impl = () => (isNative() ? native : web);

export const DEFAULT_CLIENT_ID = web.DEFAULT_CLIENT_ID;
export const initAuth = (clientId) => impl().initAuth(clientId);
export const requestToken = (opts) => impl().requestToken(opts);
export const trySilentLogin = () => impl().trySilentLogin();
export const getAccessToken = () => impl().getAccessToken();
export const isSignedIn = () => impl().isSignedIn();
export const signOut = () => impl().signOut();
export const fetchEmail = () => impl().fetchEmail();
