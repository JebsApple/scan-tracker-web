// Catálogo compartido de series en Firestore: la vinculación entre una hoja de
// Google y el rol de Discord de la gente que trabaja esa serie.
//
// Documento: series/{id} — { name, sheetUrl, discordRoleId, roleName,
//                            createdBy, createdAt }
//
// El catálogo NO otorga permisos: solo dice qué hoja corresponde a qué rol,
// para que nadie tenga que ir a buscar URLs a Drive. Quién puede leer o
// escribir cada hoja lo sigue decidiendo Google.
import { db } from "./firebase-config.js";

const col = () => db.collection("series");

/** Todas las series registradas. El catálogo es chico (decenas), así que se
 *  trae entero y se filtra por rol en el cliente — evita el tope de 30 valores
 *  que tiene el operador `in` de Firestore. */
export async function listSeriesCatalog() {
  const snap = await col().get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function registrarSerie({ name, sheetUrl, discordRoleId, roleName, uid }) {
  const ref = await col().add({
    name,
    sheetUrl,
    discordRoleId,
    roleName: roleName || "",
    createdBy: uid,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function actualizarSerie(id, campos) {
  await col().doc(id).set(campos, { merge: true });
}

export async function borrarSerieCatalog(id) {
  await col().doc(id).delete();
}
