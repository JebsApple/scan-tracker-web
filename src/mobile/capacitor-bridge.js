// Puente hacia los plugins nativos de Capacitor. Solo existe `window.Capacitor`
// cuando la app corre empaquetada (Android) — en el browser normal, todo acá
// queda en no-op sin romper nada. No se importa el paquete npm de Capacitor
// directamente (el proyecto no tiene bundler): el runtime nativo inyecta
// `window.Capacitor.Plugins.*` antes de cargar esta página.
const LABEL = "cl.jebsapple.scantracker.check";

const runner = () => window.Capacitor?.Plugins?.BackgroundRunner;

export const isNative = () => !!window.Capacitor?.isNativePlatform?.();

export async function requestBackgroundPermissions() {
  const r = runner();
  if (!r) return false;
  const status = await r.requestPermissions({ apis: ["notifications"] });
  return status.notifications === "granted";
}

/** Manda la config actual (Sheets vinculados + alias) al runner en background
 * — el runner no tiene acceso al estado S de la app, solo a lo que se le
 * dispatchea explícitamente. Se llama cada vez que cambian series o alias. */
export async function pushMobileConfig(sheetUrls, aliases) {
  const r = runner();
  if (!r) return;
  await r.dispatchEvent({ label: LABEL, event: "updateConfig", details: { sheets: sheetUrls, aliases } });
}
