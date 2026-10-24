/**
 * The language's built-in types (§2): part of the language itself, declared in no module, and
 * spelled the same way by the compiler and by the Definition it produces.
 */

export const primitiveNames = ['int', 'float', 'bool', 'string', 'unit', 'never'] as const;

export type PrimitiveName = (typeof primitiveNames)[number];
