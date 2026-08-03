// Tests del Worker de auth (worker/src/index.ts). No tocan la red real:
// globalThis.fetch se mockea con respuestas locales. El contrato de CORS
// exige 403 sin Access-Control-Allow-Origin cuando el Origin no está
// permitido (o falta), y ACAO = origin exacto cuando sí está.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index';

const ALLOWED = 'https://scantracker.rweb.site';
const BASE = 'https://scantracker-google-auth.example.workers.dev';
const REFRESH_COOKIE = 'scantracker_google_rt';

const env = {
  ALLOWED_ORIGINS: ALLOWED,
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
};

/** Mock de globalThis.fetch: intercambio de código de Google, refresh y
 * revoke responden con tokens falsos — nunca hay red real. */
function stubGoogleOk() {
  const fn = vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') {
      return new Response(
        JSON.stringify({ access_token: 'access-token', expires_in: 3600, refresh_token: 'refresh-token' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (u === 'https://oauth2.googleapis.com/revoke') {
      return new Response('{}', { status: 200 });
    }
    throw new Error('fetch inesperado: ' + u);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function post(path: string, { origin, body, cookie }: { origin?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (origin) headers['Origin'] = origin;
  if (cookie) headers['Cookie'] = cookie;
  let init: RequestInit = { method: 'POST', headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return new Request(BASE + path, init);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CORS', () => {
  it('OPTIONS con origin permitido → 204 con ACAO = origin exacto', async () => {
    const res = await worker.fetch(new Request(BASE + '/token', { method: 'OPTIONS', headers: { Origin: ALLOWED } }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('POST /token desde origin NO permitido → 403 y SIN Access-Control-Allow-Origin', async () => {
    const res = await worker.fetch(post('/token', { origin: 'https://evil.example', body: { code: 'x' } }), env);
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const body = await res.json();
    expect(body.error).toBe('Origen no permitido.');
  });

  it('POST /token sin Origin → 403 y SIN Access-Control-Allow-Origin', async () => {
    const res = await worker.fetch(post('/token', { body: { code: 'x' } }), env);
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('OPTIONS sin Origin → 403 (el preflight también se valida)', async () => {
    const res = await worker.fetch(new Request(BASE + '/token', { method: 'OPTIONS' }), env);
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('404 sin origin permitido también responde 403 sin ACAO', async () => {
    const res = await worker.fetch(post('/nope', { body: {} }), env);
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('token', () => {
  it('POST /token sin body code → 400', async () => {
    const res = await worker.fetch(post('/token', { origin: ALLOWED, body: {} }), env);
    expect(res.status).toBe(400);
  });

  it('POST /token con code → 200 con access_token y Set-Cookie del refresh', async () => {
    stubGoogleOk();
    const res = await worker.fetch(post('/token', { origin: ALLOWED, body: { code: 'auth-code' } }), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe('access-token');
    const sc = res.headers.get('Set-Cookie') || '';
    expect(sc).toContain(`${REFRESH_COOKIE}=`);
    expect(sc).toContain('HttpOnly');
  });

  it('POST /token sin refresh_token (usuario ya autorizado antes) → 200 sin Set-Cookie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: 'at2', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const res = await worker.fetch(post('/token', { origin: ALLOWED, body: { code: 'auth-code' } }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('POST /token cuando Google rechaza → 401 con mensaje genérico (no filtra error_description)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'secreto de google' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const res = await worker.fetch(post('/token', { origin: ALLOWED, body: { code: 'bad' } }), env);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Error al procesar el login.');
    expect(JSON.stringify(body)).not.toContain('secreto de google');
  });
});

describe('refresh', () => {
  it('POST /refresh sin cookie → 401', async () => {
    const res = await worker.fetch(post('/refresh', { origin: ALLOWED }), env);
    expect(res.status).toBe(401);
  });

  it('POST /refresh con cookie malformada (%zz) → 401, no 500', async () => {
    const res = await worker.fetch(
      post('/refresh', { origin: ALLOWED, cookie: `${REFRESH_COOKIE}=%zz-not-valid` }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('POST /refresh con cookie válida → 200 con access_token', async () => {
    stubGoogleOk();
    const res = await worker.fetch(
      post('/refresh', { origin: ALLOWED, cookie: `${REFRESH_COOKIE}=refresh-token` }),
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe('access-token');
  });
});

describe('logout', () => {
  it('POST /logout → 200 con Set-Cookie limpiada (Max-Age=0)', async () => {
    stubGoogleOk();
    const res = await worker.fetch(
      post('/logout', { origin: ALLOWED, cookie: `${REFRESH_COOKIE}=refresh-token` }),
      env,
    );
    expect(res.status).toBe(200);
    const sc = res.headers.get('Set-Cookie') || '';
    expect(sc).toContain(`${REFRESH_COOKIE}=`);
    expect(sc).toContain('Max-Age=0');
  });
});

describe('rate limit', () => {
  it('más de 60 POST a /token y /refresh en 60 s → 429', async () => {
    stubGoogleOk();
    // 4 hits ya consumidos por tests anteriores dentro de la misma ventana
    // (token sin code, refresh sin cookie, refresh malformada, refresh ok);
    // el loop es amplio para garantizar el tope sin importar el orden.
    let got429 = 0;
    let lastStatus = 0;
    for (let i = 0; i < 70; i++) {
      const res = await worker.fetch(
        i % 2 === 0
          ? post('/token', { origin: ALLOWED, body: { code: 'auth-code' } })
          : post('/refresh', { origin: ALLOWED, cookie: `${REFRESH_COOKIE}=refresh-token` }),
        env,
      );
      lastStatus = res.status;
      if (res.status === 429) got429++;
    }
    expect(got429).toBeGreaterThan(0);
    expect(lastStatus).toBe(429);
  });
});
