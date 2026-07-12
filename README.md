# Scan Tracker Web

Tracker de scanlation (traducción, limpieza, typeset, corrección, sube) sincronizado con Google Sheets — directo desde el browser, sin backend, sin instalación.

Pivote de [`scan-tracker-desktop`](https://github.com/JebsApple/scan-tracker-desktop) (idea original en Java/JavaFX, jun 2026): mismo HTML/UI, pero el OAuth y el habla con Sheets ahora corren en el browser vía Google Identity Services en vez de un backend Java. Ver plan completo en `~/Vault/02-Projects/scan-tracker-web/`.

## Cómo correrlo local

```bash
python3 -m http.server 8080
# abrir http://localhost:8080/index.html
```

No hay build step — es HTML + ES modules servidos tal cual.

## Configurar Google (una vez)

1. En [Google Cloud Console](https://console.cloud.google.com) → APIs y servicios → Biblioteca → habilitar **Google Sheets API**.
2. Credenciales → Crear credenciales → ID de cliente de OAuth → tipo **Aplicación web**.
3. En "Orígenes de JavaScript autorizados" agregá `http://localhost:8080` (o tu dominio de deploy, ej. GitHub Pages).
4. No hace falta client_secret — los Client ID de tipo web son públicos por diseño (Google los autoriza por origen, no por secreto).
5. En la app: botón **Conectar Google** → pegar el Client ID → **Iniciar sesión con Google**.

El Client ID queda guardado en `localStorage` del browser (por dispositivo, no se comparte con nadie más).

## Estructura

```
index.html          UI completa (portada de scan-tracker.html original) + lógica de dominio
src/auth.js          Google Identity Services — login/token/email, sin backend
src/sheets-api.js     Sheets API v4 REST — readSheet/writeCell/appendRow/deleteRow (fetch directo)
```

## Contrato del sheet

Mismas columnas que el [plugin de Obsidian](https://github.com/JebsApple/scan-tracker-obsidian-plugin) (no público aún) — así ambas herramientas leen/escriben el mismo spreadsheet sin pisarse:

```
Capítulo | Prioridad | TRAD who | TRAD done | LIMP who | LIMP done | TYP who | TYP done | CORR who | CORR done | SUBE who | SUBE done
```

## Deploy

Estático — cualquier host sirve (GitHub Pages, Netlify, Vercel). Solo hay que agregar el origen final a "Orígenes de JavaScript autorizados" en el Client ID de Google Cloud.
