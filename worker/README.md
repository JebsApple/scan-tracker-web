# scantracker-google-auth (Cloudflare Worker)

Backend mínimo para que la sesión de Google de scan-tracker-web sobreviva a
recargas y cierres de pestaña sin volver a mostrar el login cada vez. El
`refresh_token` de Google vive en una cookie `httpOnly` que pone este
Worker — el JS de la app nunca la toca, solo le pide al Worker que renueve.

## Por qué un Worker y no un servidor propio

scan-tracker-web es 100% estático (GitHub Pages). Cloudflare Workers da un
runtime gratis (100k requests/día, sin tarjeta) para las tres rutas que
necesita este flujo, sin tocar el hosting del resto de la app.

## Deploy (una sola vez)

```bash
cd worker
npm install
npx wrangler login          # abre el navegador, autoriza tu cuenta de Cloudflare
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Pega el Client Secret del MISMO OAuth Client "Web" que usa DEFAULT_CLIENT_ID
# en src/repositories/auth.js — pestaña "Client secret" en
# https://console.cloud.google.com/apis/credentials
npx wrangler deploy
```

El último comando imprime la URL del Worker (algo como
`https://scantracker-google-auth.<tu-subdominio>.workers.dev`). Copiá esa
URL en `AUTH_WORKER_URL` de `src/repositories/auth.js` (raíz del repo, no
acá) y hacé commit + deploy de la app como siempre.

## Actualizar orígenes permitidos

Si agregás un dominio nuevo (otro entorno de preview, otro custom domain),
sumalo a `ALLOWED_ORIGINS` en `wrangler.toml` y corré `npx wrangler deploy`
de nuevo — sin esto el navegador bloquea la respuesta por CORS.

## Rotar o revocar el Client Secret

Si el secreto se filtra: generá uno nuevo en Google Cloud Console y corré
`npx wrangler secret put GOOGLE_CLIENT_SECRET` de nuevo con el valor nuevo.
No hace falta re-deployar la app, solo el Worker.
