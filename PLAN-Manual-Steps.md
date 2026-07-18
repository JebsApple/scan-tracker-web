# Plan: Pasos manuales para activar auth email/password

## 1. Crear proyecto en Firebase Console

1. Ir a [Firebase Console](https://console.firebase.google.com/)
2. Click **"Agregar proyecto"**
3. Nombre: `scan-tracker` (o el que prefieras)
4. Desactivar Google Analytics (no hace falta para esto)
5. Click **"Crear proyecto"**

## 2. Habilitar Authentication

1. En el menú lateral: **Build → Authentication**
2. Click **"Comenzar"**
3. Pestaña **"Sign-in method"**:
   - Habilitar **"Email/Password"** → Guardar
4. Pestaña **"Settings"** → **"Authorized domains"**:
   - Agregar tu dominio de GitHub Pages (ej: `tu-usuario.github.io`)
   - Agregar `localhost` para testing local

## 3. Crear Firestore Database

1. Menú lateral: **Build → Firestore Database**
2. Click **"Crear base de datos"**
3. Seleccionar ubicación más cercana (us-east1 o southamerica-east1)
4. Empezar en **modo de prueba** (reglas abiertas para testing)
5. **Después de verificar que funciona**, actualizar reglas:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 4. Obtener configuración web

1. Menú lateral: **Project Settings** (icono engranaje)
2. Pestaña **"General"** → sección **"Tus apps"**:
   - Si no hay app web, click icono `</>` para agregar una
   - Nombre: `Scan Tracker Web`
   - **NO** habilitar Firebase Hosting
   - Click **"Registrar app"**
3. Copiar el objeto de configuración que se muestra

## 5. Actualizar firebase-config.js

Reemplazar el contenido de `src/repositories/firebase-config.js` con la configuración real:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",            // ← de Firebase Console
  authDomain: "scan-tracker.firebaseapp.com",
  projectId: "scan-tracker",
  storageBucket: "scan-tracker.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123",
  measurementId: "G-XXXXXXXXXX"    // opcional
};
```

## 6. Habilitar proveedores de email (verificación)

En **Firebase Console → Authentication → Settings**:
- **User actions**: Verificar que "Email verification" esté habilitado
- **Custom email template** (opcional): personalizar el mail de verificación

## 7. Configurar usuario tester para Google OAuth

Si ya tenés Google Sign-In funcionando con otro proyecto:
1. En **Google Cloud Console** → **APIs & Services → Credentials**
2. OAuth 2.0 Client ID existente → agregar dominio del proyecto Firebase como Authorized Domain

Si es nuevo:
1. En **Google Cloud Console** → **APIs & Services → Credentials**
2. **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Authorized redirect URIs: agregar `https://<project-id>.firebaseapp.com/__/auth/handler`
5. Copiar Client ID → reemplazar en `auth-facade.js`

## 8. Testing local

```bash
cd /home/apuru/proyectos/scan-tracker-web
npx serve .
```

1. Abrir `http://localhost:3000`
2. Verificar que aparece la pantalla de login
3. Probar registro con email ficticio
4. Verificar que llega email de verificación
5. Verificar que después de verificar, se carga el contenido del Sheet vinculado

## 9. Deploy a GitHub Pages

```bash
git add .
git commit -m "feat: email/password auth + Firestore sync"
git push origin main
```

Verificar que en GitHub Pages funciona el flujo completo.

## 10. Reglas de seguridad Firestore (producción)

Una vez verificado que funciona, cambiar Firestore a modo production:

```bash
firebase deploy --only firestore:rules
```

O actualizar manualmente en consola con las reglas del paso 3.
