/**
 * The naming conventions (§2, §3.1): PascalCase for types, camelCase for values, functions and
 * fields. A leading `_` (a private top-level name, §3.13) is not part of the case, and a lone `_`
 * is the unnamed variable.
 *
 * Case also decides what a bare name in a pattern does (§3.11): a camelCase name binds a new
 * variable, a PascalCase one refers to a variant or constant. Both questions read the same first
 * letter, so they share this module.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { type Identifier, isMissingName } from '../syntax/node.ts';
import { binderDiagnostics } from './diagnostics.ts';

export type Convention = 'type' | 'value';

const shapes: Readonly<Record<Convention, RegExp>> = {
  type: /^[A-Z][A-Za-z0-9]*$/u,
  value: /^[a-z][A-Za-z0-9]*$/u,
};

/** The diagnostic for a declared name that breaks its convention, if it does. */
export function conventionViolation(
  name: Identifier,
  convention: Convention,
): Diagnostic | undefined {
  const cased = withoutPrivacy(name.text);
  if (isMissingName(name) || name.text === '_' || shapes[convention].test(cased)) {
    return;
  }
  return convention === 'type'
    ? binderDiagnostics.typeNameConvention(name.span, name.text)
    : binderDiagnostics.valueNameConvention(name.span, name.text);
}

/** Whether a bare name in a pattern binds a new variable rather than naming a variant. */
export function bindsInPattern(name: string): boolean {
  const first = withoutPrivacy(name).charAt(0);
  return first !== first.toUpperCase();
}

/** Whether a top-level name is private to its module, which never exports it (§3.13). */
export function isPrivate(name: string): boolean {
  return name.startsWith('_');
}

function withoutPrivacy(name: string): string {
  return isPrivate(name) ? name.slice(1) : name;
}
