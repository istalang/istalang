/**
 * The language's built-in types (§2): part of the language itself, declared in no module, and
 * spelled the same way by the compiler, by the Definition it produces and by extern keys.
 */

export const primitiveNames = ['Int', 'Float', 'Bool', 'String', 'Unit', 'Never'] as const;

export type PrimitiveName = (typeof primitiveNames)[number];

/**
 * The primitive `name` spelled before type names were all PascalCase (`int`), so a name left over
 * from then is reported with the one it became; undefined for any other name.
 */
export function primitiveOnceSpelled(name: string): PrimitiveName | undefined {
  return primitiveNames.find((primitive) => primitive.toLowerCase() === name);
}
