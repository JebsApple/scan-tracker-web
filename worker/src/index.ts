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

/**
 * CORS estricto: devuelve ok=false (y sin Access-Control-Allow-Origin) si el
 * Origin de la petición no está en ALLOWED_ORIGINS o si no viene. El caller
 * responde 403 en ese caso en TODAS las rutas (incluido OPTIONS y 404) — sin
 * la cabecera ACAO el navegador ni siquiera puede leer el cuerpo del error.
 * Cuando el Origin coincide, ACAO = el origin exacto de la petición (nunca
 * un fallback a allowed[0]), Allow-Credentials true y Vary: Origin.
 */
function corsResult(request: Request, env: Env): { ok: boolean; headers: HeadersInit } {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  if (!origin || !allowed.includes(origin)) {
    return { ok: false, headers: {} };
  }
  return {
    ok: true,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    },
  };
}

// Rate limit simple en memoria: un Map a nivel de módulo (por isolate del
// Worker — suficiente para esta escala, no se usa KV). Ventana deslizante de
// 60 s; el límite aplica a /token y /refresh juntos, por IP. La limpieza es
// perezosa: cada lectura descarta las marcas que ya quedaron fuera de la
// ventana, así que el Map no retiene timestamps viejos.
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateHits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (rateHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    rateHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateHits.set(ip, hits);
  return false;
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
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    // Cookie malformada (%xx inválido) — se trata como "sin cookie", nunca
    // como un 500.
    return null;
  }
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
    const cors = corsResult(request, env);
    if (!cors.ok) {
      return json({ error: 'Origen no permitido.' }, 403, {});
    }
    const corsHeaders = cors.headers;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Método no soportado.' }, 405, corsHeaders);
    }

    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

    if (url.pathname === '/token') {
      if (rateLimited(ip)) return json({ error: 'Demasiados intentos.' }, 429, corsHeaders);
      try {
        const { code } = await request.json<{ code?: string }>();
        if (!code) return json({ error: 'Falta el código de autorización.' }, 400, corsHeaders);

        const tokens = await exchangeCode(env, code);
        if (!tokens.refresh_token) {
          // Pasa si el usuario ya había autorizado antes sin revocar acceso:
          // Google solo manda refresh_token la primera vez. Igual devolvemos
          // el access_token para que el login funcione esta sesión.
          return json({ access_token: tokens.access_token, expires_in: tokens.expires_in }, 200, corsHeaders);
        }
        return json(
          { access_token: tokens.access_token, expires_in: tokens.expires_in },
          200,
          corsHeaders,
          { 'Set-Cookie': setRefreshCookie(tokens.refresh_token) },
        );
      } catch (err) {
        // No filtrar el detalle al cliente: err.message puede contener el
        // error_description de Google. El detalle queda en los logs del Worker.
        console.error('Error al intercambiar el código de Google:', err);
        return json({ error: 'Error al procesar el login.' }, 401, corsHeaders);
      }
    }

    if (url.pathname === '/refresh') {
      if (rateLimited(ip)) return json({ error: 'Demasiados intentos.' }, 429, corsHeaders);
      const rt = readCookie(request, REFRESH_COOKIE);
      if (!rt) return json({ error: 'No hay sesión de Google activa.' }, 401, corsHeaders);
      try {
        const tokens = await refreshToken(env, rt);
        return json({ access_token: tokens.access_token, expires_in: tokens.expires_in }, 200, corsHeaders);
      } catch (err) {
        return json(
          { error: err instanceof Error ? err.message : 'Error al renovar la sesión.' },
          401,
          corsHeaders,
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
      return json({ ok: true }, 200, corsHeaders, { 'Set-Cookie': clearRefreshCookie() });
    }

    return json({ error: 'No encontrado.' }, 404, corsHeaders);
  },
};
