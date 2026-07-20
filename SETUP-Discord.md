# Configuración: Discord + Firebase

Pasos de consola (nada de código). Al final hay dos valores que pegar en
`src/repositories/discord-config.js`.

Mientras esos dos valores estén vacíos, la app funciona como antes: el botón de
Discord no aparece y las series se agregan pegando la URL a mano.

---

## 1. Crear la aplicación de Discord

1. Entrar a <https://discord.com/developers/applications> con tu cuenta.
2. **New Application** → nombre `ScanTracker` → aceptar → **Create**.
3. Menú izquierdo → **OAuth2**.
4. Copiar el **Client ID** (número largo). → **este es el primer valor**.
5. En esa misma pantalla, sección **Redirects** → **Add Redirect**, y agregar
   estas dos URLs, una por línea:
   - `https://scantracker.rweb.site/`
   - `http://localhost:8080/`
6. **Save Changes** abajo.

> La barra final importa. `https://scantracker.rweb.site` sin barra no sirve.

No hace falta crear un bot ni invitar nada al servidor. Cada persona autoriza
por su cuenta al entrar.

## 2. Obtener el ID del servidor del scan

1. En Discord (la app normal): **Ajustes de usuario** → **Avanzado** → activar
   **Modo desarrollador**.
2. Volver al servidor del scan → click derecho sobre su nombre (arriba a la
   izquierda) → **Copiar ID del servidor**. → **este es el segundo valor**.

## 3. Obtener el ID de un rol (esto se repite por cada serie)

Con el modo desarrollador ya activo:

1. **Ajustes del servidor** → **Roles**.
2. Click derecho sobre el rol de la serie → **Copiar ID del rol**.

Ese ID se pega en el campo "Rol de Discord" al crear la serie en ScanTracker.
Es lo que hace que a toda esa gente le aparezca la serie sola.

## 4. Habilitar el login de Google en Firebase

Sin esto, conectar Google no abre sesión de Firebase y el catálogo de series
queda bloqueado por las reglas.

1. <https://console.firebase.google.com> → proyecto **scan-tracker-5ef75**.
2. **Authentication** → pestaña **Sign-in method**.
3. **Add new provider** → **Google** → activar el interruptor.
4. Elegir un correo de soporte → **Save**.

## 5. Publicar las reglas de seguridad

**Esto es lo más urgente de toda la lista.** Hasta que se haga, la base de datos
está en modo de prueba: cualquiera que vea el código de la página (que es
público) puede leer y borrar los datos de todos.

Opción rápida, por consola web:

1. <https://console.firebase.google.com> → proyecto **scan-tracker-5ef75**.
2. **Firestore Database** → pestaña **Reglas**.
3. Borrar todo lo que haya y pegar el contenido del archivo `firestore.rules`
   de este repositorio.
4. **Publicar**.

## 6. Pegar los dos valores

En `src/repositories/discord-config.js`, entre las comillas:

```js
export const DISCORD_CLIENT_ID = "el valor del paso 1";
export const DISCORD_GUILD_ID  = "el valor del paso 2";
```

Guardar, `git commit`, `git push`. Listo.
