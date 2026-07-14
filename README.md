# Scan Tracker Web

Tracker de scanlation (traducción, limpieza, typeset, corrección, sube) sincronizado con Google Sheets — directo desde el browser, sin backend, sin instalación.

Pivote de [`scan-tracker-desktop`](https://github.com/JebsApple/scan-tracker-desktop) (idea original en Java/JavaFX, jun 2026): mismo HTML/UI, pero el OAuth y el habla con Sheets ahora corren en el browser vía Google Identity Services en vez de un backend Java. Ver plan completo en `~/Vault/02-Projects/scan-tracker-web/`.

## Cómo correrlo local

```bash
python3 -m http.server 8080
# abrir http://localhost:8080/index.html
```

No hay build step — es HTML + ES modules servidos tal cual.

## Configurar Google (una vez, solo quien mantiene el proyecto)

El Client ID ya viene fijo en el código (`DEFAULT_CLIENT_ID` en `index.html`) — un usuario final solo hace click en **Conectar Google** e inicia sesión, sin pegar nada. Esto es para quien administre ese Client ID en Google Cloud Console:

1. [Google Cloud Console](https://console.cloud.google.com) → APIs y servicios → Biblioteca → habilitar **Google Sheets API** y **Google Drive API**.
2. Pantalla de consentimiento OAuth → Scopes → agregar `spreadsheets`, `userinfo.email` y `drive.metadata.readonly` (este último es para listar "Compartidos conmigo" al crear una serie — nunca lee contenido de archivos, solo nombre/id).
3. Si la app no está verificada por Google, agregar como "test users" a cada persona del equipo en esa misma pantalla, o van a ver un aviso de "app no verificada" al loguearse.
4. Credenciales → Crear credenciales → ID de cliente de OAuth → tipo **Aplicación web**.
5. En "Orígenes de JavaScript autorizados" agregá `http://localhost:8080` (o tu dominio de deploy, ej. GitHub Pages).
6. No hace falta client_secret — los Client ID de tipo web son públicos por diseño (Google los autoriza por origen, no por secreto).
7. Pegar ese Client ID como `DEFAULT_CLIENT_ID` en `index.html` (buscar la constante cerca del inicio del `<script type="module">`).

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
