/**
 * How the language names a static function: `Owner.name` (§3.10). The checker's resolution and
 * messages, lowering's function-table names and the natives' keys all spell it here, so a static
 * call the checker resolves and the entry and native it binds to can never disagree on the name.
 */

/** Static function `name` of type `owner`: `Time.parse`. */
export function staticName(owner: string, name: string): string {
  return `${owner}.${name}`;
}
