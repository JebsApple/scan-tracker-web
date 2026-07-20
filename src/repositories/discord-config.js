// Configuración de la Discord Application. Ver README (sección "Discord")
// para cómo obtener estos dos valores.
//
// Ambos son públicos por diseño: el client_id se manda en la URL de
// autorización y el guild_id es visible para cualquiera del servidor. NO hay
// client_secret acá — el flujo implícito no lo usa, y ponerlo en una página
// estática sería filtrarlo.

// developers.discord.com → aplicación "ScanTracker" → OAuth2 → Client ID
export const DISCORD_CLIENT_ID = "1528633787057967235";

// Servidor "Raven Campamento". Sale en la URL al abrirlo:
// discord.com/channels/<guild_id>/<channel_id>
export const DISCORD_GUILD_ID = "1437578818725351576";

// Mientras falte cualquiera de los dos, la app esconde todo lo de Discord y
// sigue funcionando como antes (series pegadas a mano).
export const discordConfigurado = () => !!(DISCORD_CLIENT_ID && DISCORD_GUILD_ID);
