/** Old catalogue rows sometimes contain a comma-separated synonym dump. */
/** `| null` accepté au même titre : ces noms viennent de colonnes nullables,
 *  et `?.` traite déjà les deux formes pareil. */
export function conciseCommonName(name: string | null | undefined): string | undefined {
  return name?.split(/\s*[,;/]\s*/, 1)[0]?.replace(/\s*\((?:le|la)\)$/i, '').trim() || undefined;
}
