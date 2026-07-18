// Login/Register screen — DOM overlay shown when no user is authenticated.
import { registerEmail, loginEmail, resetPassword, logoutEmail, onAuthChange } from "../repositories/auth-email.js";
import { TESTER_EMAILS } from "../repositories/firebase-config.js";
import { saveUserData, loadUserData } from "../repositories/user-data.js";
import { isSignedIn } from "../repositories/auth-facade.js";
import { toast } from "./toast.js";
import { esc } from "../utils.js";

const overlay = document.getElementById("authOverlay");

// ── Tab switching ──────────────────────────────────────────────────
let mode = "login"; // "login" | "register" | "verify"

function paint() {
  const tabs = overlay.querySelectorAll(".authTab");
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === mode));
  const submit = overlay.querySelector("#authSubmit");
  const passLabel = overlay.querySelector("#authPassLabel");
  if (mode === "register") {
    submit.textContent = "Crear cuenta";
    passLabel.textContent = "Contraseña (mínimo 6 caracteres)";
  } else {
    submit.textContent = "Iniciar sesión";
    passLabel.textContent = "Contraseña";
  }
}

// ── Form submit ────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const email = overlay.querySelector("#authEmail").value.trim();
  const pass  = overlay.querySelector("#authPass").value;
  const errEl = overlay.querySelector("#authError");
  const btn   = overlay.querySelector("#authSubmit");
  errEl.textContent = "";
  btn.disabled = true;

  try {
    if (mode === "register") {
      const user = await registerEmail(email, pass);
      // Subir datos locales a Firestore si existen
      const local = JSON.parse(localStorage.getItem("scantracker") || "{}");
      const hasData = (local.series && local.series.length) || (local.aliases && local.aliases.length);
      if (hasData) {
        await saveUserData(user.uid, {
          series: (local.series || []).map(s => ({ name: s.name, sheetUrl: s.sheetUrl })),
          aliases: local.aliases || [],
        });
      }
      showVerify(email);
    } else {
      const user = await loginEmail(email, pass);
      if (!user.emailVerified) {
        showVerify(email);
        return;
      }
      hide();
      toast("Sesión iniciada");
    }
  } catch (err) {
    errEl.textContent = friendlyAuthError(err.code);
  } finally {
    btn.disabled = false;
  }
}

// ── Verify screen ──────────────────────────────────────────────────
function showVerify(email) {
  mode = "verify";
  overlay.querySelector(".authBody").innerHTML = `
    <div class="authVerifyMsg">
      <div style="font-size:48px;margin-bottom:16px">📧</div>
      <h3>Verificá tu correo</h3>
      <p>Te enviamos un enlace de verificación a <strong>${esc(email)}</strong>. Hacé click en el enlace para activar tu cuenta.</p>
      <p style="font-size:12px;color:var(--mut)">Si no lo ves, revisá la carpeta de spam.</p>
      <div class="mrow" style="justify-content:center;margin-top:20px">
        <button class="btn" id="authResend">Reenviar correo</button>
        <button class="btn" id="authBackV">Volver</button>
      </div>
    </div>`;
  overlay.querySelector("#authResend").onclick = async () => {
    try {
      const user = (await import("./firebase-config.js")).then(m => m.auth.currentUser);
      // re-login to get user
      const u = await loginEmail(email, overlay.querySelector("#authPass")?.value || "");
      await u.sendEmailVerification();
      toast("Correo reenviado");
    } catch { toast("No se pudo reenviar"); }
  };
  overlay.querySelector("#authBackV").onclick = () => { renderForm(); };
}

function renderForm() {
  mode = "login";
  overlay.querySelector(".authBody").innerHTML = formHTML();
  wireForm();
  paint();
}

function formHTML() {
  return `
    <div class="authTabs">
      <button class="authTab active" data-tab="login">Iniciar sesión</button>
      <button class="authTab" data-tab="register">Registrarse</button>
    </div>
    <form id="authForm">
      <div class="fld">
        <label>Correo electrónico</label>
        <input type="email" id="authEmail" required autocomplete="email" placeholder="tu@correo.com">
      </div>
      <div class="fld">
        <label id="authPassLabel">Contraseña</label>
        <input type="password" id="authPass" required autocomplete="current-password" minlength="6">
      </div>
      <div id="authError" class="authError"></div>
      <button type="submit" class="btn red" id="authSubmit" style="width:100%">Iniciar sesión</button>
    </form>
    <div class="authForgot" id="authForgot">¿Olvidaste tu contraseña?</div>
    <div class="authDivider"><span>o</span></div>
    <button class="btn authGoogle" id="authGoogle">
      Iniciar sesión con Google <span class="authTesterBadge">testers</span>
    </button>`;
}

function wireForm() {
  overlay.querySelector("#authForm").addEventListener("submit", handleSubmit);
  overlay.querySelectorAll(".authTab").forEach((t) =>
    t.addEventListener("click", () => { mode = t.dataset.tab; paint(); })
  );
  overlay.querySelector("#authForgot").onclick = async () => {
    const email = overlay.querySelector("#authEmail").value.trim();
    if (!email) { overlay.querySelector("#authError").textContent = "Ingresá tu correo primero"; return; }
    try { await resetPassword(email); toast("Correo de restablecimiento enviado"); }
    catch (err) { overlay.querySelector("#authError").textContent = friendlyAuthError(err.code); }
  };
}

// ── Google tester button ───────────────────────────────────────────
// Delega al flujo GIS existente (connectGoogle en modals.js).
// Se importa dinámicamente para no crear un ciclo de imports.
async function handleGoogleLogin() {
  const { connectGoogle } = await import("./modals.js");
  const ok = await connectGoogle();
  if (ok) hideLoginScreen();
}

// ── Show / Hide ────────────────────────────────────────────────────
export function showLoginScreen() {
  overlay.innerHTML = `
    <div class="authCard">
      <div id="authLogo">
        <span class="logo-s">S</span><span class="logo-can">CAN</span><span class="logo-tracker">TRACKER</span>
      </div>
      <div class="authBody">${formHTML()}</div>
    </div>`;
  wireForm();
  overlay.querySelector("#authGoogle").onclick = handleGoogleLogin;
  overlay.classList.add("show");
}

export function hideLoginScreen() {
  overlay.classList.remove("show");
}

// ── Helpers ────────────────────────────────────────────────────────
function friendlyAuthError(code) {
  const map = {
    "auth/email-already-in-use":     "Este correo ya está registrado",
    "auth/invalid-email":            "Correo inválido",
    "auth/user-not-found":           "No existe una cuenta con este correo",
    "auth/wrong-password":           "Contraseña incorrecta",
    "auth/weak-password":            "La contraseña debe tener al menos 6 caracteres",
    "auth/too-many-requests":        "Demasiados intentos. Esperá un momento",
    "auth/invalid-credential":       "Correo o contraseña incorrectos",
  };
  return map[code] || "Error: " + code;
}
