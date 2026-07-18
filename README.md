# Scan Tracker Web

Tracker de scanlation (traducción, limpieza, typeset, corrección, sube) sincronizado con Google Sheets — directo desde el browser, sin backend, sin instalación.

## Uso (para el equipo)

1. Abrí la app: https://jebsapple.github.io/scan-tracker-web/
2. Click **Conectar Google** e iniciá sesión — no hace falta pegar ningún ID ni configurar nada.
3. **+ Serie** para vincular un Sheet (elegí de "Compartidos conmigo" o pegá la URL directo).
4. Cargá tu(s) alias en **Mis nombres** para que "Mis tareas" te filtre lo tuyo.

Eso es todo. El resto de esta página es para quien mantiene el proyecto (Client ID, deploy, estructura interna) — no hace falta leerlo para usar la app.

## App Android (opcional)

La misma app, empaquetada con Capacitor, con una ventaja: **notificaciones aunque el teléfono esté bloqueado y la app cerrada** — un chequeo en background avisa cuando te asignan un capítulo (solo en Sheets públicos; los privados requieren la app abierta).

1. Descargá el APK desde [Releases](https://github.com/JebsApple/scan-tracker-web/releases) e instalalo (Android va a pedir permitir "orígenes desconocidos" — es normal para apps fuera de Play Store).
2. Abrila y logueate con **un toque** (selector de cuenta nativo de Google, sin pegar nada).
3. Aceptá el permiso de notificaciones cuando lo pida.
4. Todo lo demás funciona igual que la versión web, y ambas comparten tus series y alias vía la sincronización con tu cuenta de Google.

---

## Mantenimiento del proyecto

### Correr local

```bash
python3 -m http.server 8080
# abrir http://localhost:8080/index.html
```

Sin build step — HTML + ES modules servidos tal cual.

### Configurar Google (una vez, solo quien administra el Client ID)

El Client ID ya viene fijo en el código (`DEFAULT_CLIENT_ID` en `src/repositories/auth.js`) — por eso el equipo no configura nada. Para quien administre ese Client ID en Google Cloud Console:

1. [Google Cloud Console](https://console.cloud.google.com) → APIs y servicios → Biblioteca → habilitar **Google Sheets API** y **Google Drive API**.
2. Pantalla de consentimiento OAuth → Scopes → agregar `spreadsheets`, `userinfo.email` y `drive.metadata.readonly` (este último solo para listar "Compartidos conmigo" — nunca lee contenido de archivos, solo nombre/id).
3. Si la app no está verificada por Google, agregar como "test users" a cada persona del equipo en esa misma pantalla, o van a ver un aviso de "app no verificada" al loguearse.
4. Credenciales → Crear credenciales → ID de cliente de OAuth → tipo **Aplicación web**.
5. En "Orígenes de JavaScript autorizados" agregá `http://localhost:8080` (o tu dominio de deploy, ej. GitHub Pages).
6. No hace falta client_secret — los Client ID de tipo web son públicos por diseño (Google los autoriza por origen, no por secreto).
7. Pegar ese Client ID como `DEFAULT_CLIENT_ID` en `src/repositories/auth.js`.

### Estructura

```
index.html                       shell: HTML + <link> a styles/ + <script type="module" src="src/app.js">
src/
  app.js                          punto de entrada, wiring de eventos
  utils.js                        esc/uid/norm/isMyAlias/fmtDur/friendlyError/parseCSV
  state/
    store.js                      estado global S, load/save, migración
    history.js                    deshacer/rehacer + re-sync de series con Sheets tras undo/redo
  repositories/
    auth.js                       Google Identity Services (login/token/email)
    sheets-api.js                 Sheets API v4 REST (readSheet/writeCell/appendRow/deleteRow)
    drive-api.js                  Drive API (listar "Compartidos conmigo")
    sheets-repository.js          envoltorio fino sobre los anteriores + fallback público (gviz)
  services/
    etapas-service.js             detección de contrato de columnas por hoja + parseo CSV
    stats-service.js              progreso, pendientes, urgentes, cuellos de botella, carga por persona
    filters-service.js            filtrado/orden de capítulos
    sync-service.js                orquesta repository+stats: fetch, push, notificaciones
  ui/
    render.js                     render principal + eventos delegados de tabla/sidebar
    modals.js                     Dashboard, Historial, Mis pendientes, Google, Aliases, Serie, Log
    icons.js / toast.js
styles/
  tokens.css                      variables de color/tipografía/espaciado
  base.css                        reset y elementos genéricos
  components.css                  estilos específicos de esta app
```

### Contrato del sheet

Cada serie **autodetecta** sus propias etapas leyendo el encabezado real de esa hoja (fila que empieza con "Cap..."): cuenta pares `who`/`done` desde la columna C en adelante, cualquier cantidad de etapas con cualquier nombre. No hay un contrato fijo global — el mismo mecanismo funciona con hojas de 4 o 5 etapas, nombradas como sea (ver `services/etapas-service.js`).

### Build del APK (Android)

```bash
npm install               # una vez
npm run cap:sync          # arma www/ y sincroniza plugins de Capacitor
cd android && ./gradlew assembleDebug
# APK queda en android/app/build/outputs/apk/debug/app-debug.apk
```

El runner de background (`src/mobile/background.js`) corre en un motor JS aislado sin DOM ni localStorage — si se toca ese archivo hay que rebuildear el APK, no basta con el deploy web.

### Deploy

Estático — cualquier host sirve (GitHub Pages, Netlify, Vercel). Agregar el origen final a "Orígenes de JavaScript autorizados" en el Client ID de Google Cloud.
