export interface Env {
  ALLOWED_ORIGINS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const REFRESH_COOKIE = 'scantracker_google_rt';
// Google no expira el refresh_token por tiempo si se sigue usando; 180 días
// cubre cualquier pausa razonable de uso sin pedir login de nuevo.
const REFRESH_COOKIE_MAX_AGE_S = 180 * 24 * 60 * 60;

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  const matched = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': matched,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: HeadersInit, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers, ...extraHeaders },
  });
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/**
 * Partitioned es lo que hace que esta cookie sobreviva al bloqueo de
 * cookies de terceros de Chrome (CHIPS) — sin site que la consume (scantracker.rweb.site)
 * queda con su propio jar aislado para este dominio del Worker, en vez de
 * que el navegador la rechace o la borre por venir de un sitio distinto.
 * Firefox hace algo equivalente (Total Cookie Protection) sin necesitar el
 * atributo. SameSite=None + Secure son obligatorios para que viaje cross-site.
 */
function setRefreshCookie(refreshToken: string): string {
  return `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${REFRESH_COOKIE_MAX_AGE_S}; Path=/`;
}

function clearRefreshCookie(): string {
  return `${REFRESH_COOKIE}=; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0; Path=/`;
}

function requireSecret(env: Env): void {
  if (!env.GOOGLE_CLIENT_SECRET) {
    throw new Error('El Worker no tiene GOOGLE_CLIENT_SECRET configurado (ver worker/README.md).');
  }
}

async function exchangeCode(env: Env, code: string): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  requireSecret(env);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: 'postmessage',
      grant_type: 'authorization_code',
    }),
  });
  const body = await res.json<any>();
  if (!res.ok) throw new Error(body.error_description || body.error || 'Google rechazó el código de autorización.');
  return body;
}

async function refreshToken(env: Env, refresh_token: string): Promise<{ access_token: string; expires_in: number }> {
  requireSecret(env);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json<any>();
  // invalid_grant acá casi siempre significa refresh_token revocado o vencido.
  if (!res.ok) throw new Error('La sesión con Google expiró o fue revocada.');
  return body;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Método no soportado.' }, 405, cors);
    }

    const url = new URL(request.url);

    if (url.pathname === '/token') {
      try {
        const { code } = await request.json<{ code?: string }>();
        if (!code) return json({ error: 'Falta el código de autorización.' }, 400, cors);

        const tokens = await exchangeCode(env, code);
        if (!tokens.refresh_token) {
          // Pasa si el usuario ya había autorizado antes sin revocar acceso:
          // Google solo manda refresh_token la primera vez. Igual devolvemos
          // el access_token para que el login funcione esta sesión.
          return json({ access_token: tokens.access_token, expires_in: tokens.expires_in }, 200, cors);
        }
        return json(
          { access_token: tokens.access_token, expires_in: tokens.expires_in },
          200,
          cors,
          { 'Set-Cookie': setRefreshCookie(tokens.refresh_token) },
        );
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Error al procesar el login.' }, 401, cors);
      }
    }

    if (url.pathname === '/refresh') {
      const rt = readCookie(request, REFRESH_COOKIE);
      if (!rt) return json({ error: 'No hay sesión de Google activa.' }, 401, cors);
      try {
        const tokens = await refreshToken(env, rt);
        return json({ access_token: tokens.access_token, expires_in: tokens.expires_in }, 200, cors);
      } catch (err) {
        return json(
          { error: err instanceof Error ? err.message : 'Error al renovar la sesión.' },
          401,
          cors,
          { 'Set-Cookie': clearRefreshCookie() },
        );
      }
    }

    if (url.pathname === '/logout') {
      const rt = readCookie(request, REFRESH_COOKIE);
      if (rt) {
        await fetch(REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: rt }),
        }).catch(() => {});
      }
      return json({ ok: true }, 200, cors, { 'Set-Cookie': clearRefreshCookie() });
    }

    return json({ error: 'No encontrado.' }, 404, cors);
  },
};
