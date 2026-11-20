// Cruza los roles de Discord del usuario contra el catálogo compartido de
// series, y agrega a su lista local las que le corresponden.
//
// Es solo descubrimiento: reemplaza tener que ir a Drive a buscar la URL de la
// hoja y pegarla a mano. No otorga ni quita permisos — si Google no le dio
// acceso a esa hoja, la serie aparece pero el sync va a fallar con un mensaje
// que le dice a quién pedirle acceso.
import { S, save } from "../state/store.js";
import { uid } from "../utils.js";
import { listSeriesCatalog } from "../repositories/series-repository.js";
import { misRolesDiscord, isDiscordSignedIn } from "../repositories/discord-auth.js";

/** Trae el catálogo y agrega las series de mis roles que todavía no tengo.
 *  Devuelve cuántas se agregaron. */
export async function sincronizarSeriesDeDiscord() {
  if (!isDiscordSignedIn()) return 0;
  const misRoles = new Set(misRolesDiscord());
  if (!misRoles.size) return 0;

  const catalogo = await listSeriesCatalog();
  const yaTengo = new Set(S.series.filter((s) => s.sheetUrl).map((s) => s.sheetUrl));

  let agregadas = 0;
  for (const c of catalogo) {
    if (!c.sheetUrl || !misRoles.has(c.discordRoleId) || yaTengo.has(c.sheetUrl)) continue;
    S.series.push({
      id: uid(),
      name: c.name,
      sheetUrl: c.sheetUrl,
      chapters: [],
      ocultos: {},
      catalogId: c.id, // marca de procedencia: vino del catálogo, no se pegó a mano
    });
    yaTengo.add(c.sheetUrl);
    agregadas++;
  }
  if (agregadas) save();
  return agregadas;
}
