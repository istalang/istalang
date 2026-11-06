/**
 * The naming conventions (§2, §3.1): PascalCase for types, camelCase for values, functions and
 * fields. A leading `_` (a private top-level name, §3.13) is not part of the case, and a lone `_`
 * is the unnamed variable. The built-in types' names are taken: every scope sees them, so a
 * declaration shadowing one would change what `Int` means in a module unnoticed.
 *
 * Case also decides what a bare name in a pattern does (§3.11): a camelCase name binds a new
 * variable, a PascalCase one refers to a variant or a type. Both questions read
 * the same first letter, so they share this module.
 */

import { primitiveNames } from './primitives.ts';
import { selfType } from './well-known/index.ts';

export type Convention = 'type' | 'value';

const shapes: Readonly<Record<Convention, RegExp>> = {
  type: /^[A-Z][A-Za-z0-9]*$/u,
  value: /^[a-z][A-Za-z0-9]*$/u,
};

/** Whether `name` follows `convention`, its privacy aside; the unnamed `_` follows every one. */
export function followsConvention(name: string, convention: Convention): boolean {
  return isUnnamed(name) || shapes[convention].test(withoutPrivacy(name));
}

const builtInTypeNames: ReadonlySet<string> = new Set([...primitiveNames, selfType]);

/**
 * Whether `name` is a built-in type's, which no declaration takes (§2): a primitive's or `Self`.
 */
export function isBuiltInTypeName(name: string): boolean {
  return builtInTypeNames.has(name);
}

/** Whether `name` is the unnamed variable, which names nothing. */
export function isUnnamed(name: string): boolean {
  return name === '_';
}

/**
 * Whether a bare name in a pattern binds a new variable rather than naming a variant: every name
 * binds but one whose first letter is a type's.
 */
export function bindsInPattern(name: string): boolean {
  return !shapes.type.test(withoutPrivacy(name).charAt(0));
}

/** Whether a top-level name is private to its module, which never exports it (§3.13). */
export function isPrivate(name: string): boolean {
  return name.startsWith('_');
}

function withoutPrivacy(name: string): string {
  return isPrivate(name) ? name.slice(1) : name;
}
