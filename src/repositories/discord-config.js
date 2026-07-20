// Configuración de la Discord Application. Ver README (sección "Discord")
// para cómo obtener estos dos valores.
//
// Ambos son públicos por diseño: el client_id se manda en la URL de
// autorización y el guild_id es visible para cualquiera del servidor. NO hay
// client_secret acá — el flujo implícito no lo usa, y ponerlo en una página
// estática sería filtrarlo.

// developers.discord.com → tu aplicación → OAuth2 → Client ID
export const DISCORD_CLIENT_ID = "";

// ID del servidor del scan (Discord → Ajustes avanzados → Modo desarrollador,
// después click derecho sobre el servidor → Copiar ID del servidor)
export const DISCORD_GUILD_ID = "";

// Mientras falte cualquiera de los dos, la app esconde todo lo de Discord y
// sigue funcionando como antes (series pegadas a mano).
export const discordConfigurado = () => !!(DISCORD_CLIENT_ID && DISCORD_GUILD_ID);
