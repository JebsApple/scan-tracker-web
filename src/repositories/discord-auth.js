// Login con Discord — flujo implícito (response_type=token), sin servidor.
//
// Solo pedimos dos scopes de lectura:
//   identify            → quién eres (id, nombre)
//   guilds.members.read → tus roles DENTRO del servidor del scan
//
// Límite conocido y asumido: como el canje ocurre en el browser, el rol que
// esta app reporta es lo que el cliente dice tener. Alguien puede falsificarlo.
// No es un agujero grave porque el permiso real sobre cada hoja lo sigue dando
// Google: mentir sobre un rol te muestra la URL de una hoja que igual no vas a
// poder abrir. Para roles verificados de verdad haría falta canjear el código
// server-side (ver README, sección "Discord").

import { DISCORD_CLIENT_ID, DISCORD_GUILD_ID } from "./discord-config.js";

const API = "https://discord.com/api/v10";
const KEY = "scantracker_discord";

const redirectUri = () => location.origin + location.pathname;

/** Sesión guardada: { accessToken, expiresAt, user, roles } o null si no hay
 *  o si ya venció. */
export function getDiscordSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.accessToken || Date.now() >= s.expiresAt) {
      localStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function isDiscordSignedIn() {
  return !!getDiscordSession();
}

export function discordLogout() {
  try { localStorage.removeItem(KEY); } catch {}
}

function saveSession(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

/** Manda al usuario a Discord a autorizar. Vuelve a esta misma página con el
 *  token en el fragmento de la URL. */
export function discordLogin() {
  const p = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    response_type: "token",
    redirect_uri: redirectUri(),
    scope: "identify guilds.members.read",
  });
  location.href = `https://discord.com/oauth2/authorize?${p}`;
}

async function api(path, token) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = new Error(`Discord HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Lee quién es y qué roles tiene en el servidor del scan.
 *  Devuelve { user, roles }. roles es un array de IDs (strings). */
async function fetchIdentity(token) {
  const user = await api("/users/@me", token);
  let roles = [];
  try {
    const member = await api(`/users/@me/guilds/${DISCORD_GUILD_ID}/member`, token);
    roles = member.roles || [];
  } catch (e) {
    // 404 = el usuario no está en el servidor del scan. No es un error fatal:
    // entra igual, solo que sin series asignadas.
    if (e.status !== 404) throw e;
  }
  return { user: { id: user.id, name: user.global_name || user.username }, roles };
}

/** Se llama una vez al arrancar. Si volvimos del redirect de Discord, guarda la
 *  sesión y limpia el fragmento de la URL. Devuelve true si acaba de loguearse. */
export async function consumeDiscordRedirect() {
  if (!location.hash.includes("access_token=")) return false;
  const p = new URLSearchParams(location.hash.slice(1));
  const accessToken = p.get("access_token");
  const expiresIn = Number(p.get("expires_in") || 0);
  history.replaceState(null, "", redirectUri());
  if (!accessToken) return false;

  const { user, roles } = await fetchIdentity(accessToken);
  saveSession({
    accessToken,
    expiresAt: Date.now() + (expiresIn || 3600) * 1000,
    user,
    roles,
  });
  return true;
}

/** Vuelve a consultar los roles de la sesión activa (por si cambiaron en
 *  Discord desde el último login). Silencioso: si falla, deja los que había. */
export async function refreshDiscordRoles() {
  const s = getDiscordSession();
  if (!s) return null;
  try {
    const { user, roles } = await fetchIdentity(s.accessToken);
    saveSession({ ...s, user, roles });
    return roles;
  } catch (e) {
    if (e.status === 401) discordLogout(); // token vencido o revocado
    return s.roles;
  }
}

/** Roles del usuario en el servidor del scan (array de IDs, vacío si no hay
 *  sesión). */
export function misRolesDiscord() {
  return getDiscordSession()?.roles || [];
}
