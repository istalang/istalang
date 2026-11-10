/**
 * Which types are Sendable (§3.1): derived, never declared, save that an extern type says which
 * handle it is (§3.6).
 *
 * Primitives are; a struct, an enum, a tuple or an extern value is when everything in it is (an
 * extern value's type arguments, since it crosses as JSON); a `sendable` handle is when its type
 * arguments are, its identity being every instance's; any other handle never is, since its identity
 * stays in its instance or process (§3.18, properties/handles.ts); a function type is when it is
 * declared `sendable` (§3.14); a type parameter is when constrained `is Sendable`, or by a trait
 * that implies it (`Encodable`, `Decodable`). The rule walks what a value holds
 * (properties/held.ts), so a recursive type is sendable unless something in its cycle isn't.
 * Conformance meets Sendable by this rule (resolution/conformance/derived-traits.ts).
 *
 * Code is sendable only to another instance of the same program; whether a value can go to the host
 * is whether it has a codec (rules/boundary/json-forms.ts), which no function type has. A host type
 * a `dispose` makes disposable has one, yet isn't sendable: its values have an identity.
 */

import type { CheckerContext } from '../../contexts/context.ts';
import { isConfined } from '../properties/handles.ts';
import { heldType } from '../properties/held.ts';
import type { Type } from '../type/index.ts';
import { impliesSendable } from './constraint-implication.ts';
import { knownConstraints } from './known-constraints.ts';

/** Whether values of `type` may leave an instance for another. */
export function isSendable(checker: CheckerContext, type: Type): boolean {
  return heldType(checker, type, (part) => keepsInInstance(checker, part)) === undefined;
}

/**
 * Whether `part`, held in a value, keeps it in its instance whatever else it holds: a function
 * not declared `sendable`, a handle whose identity stays in its instance or process, or a type
 * parameter not known to be Sendable.
 */
function keepsInInstance(checker: CheckerContext, part: Type): boolean {
  switch (part.kind) {
    case 'function':
      return part.reach !== 'sendable';
    case 'parameter':
    case 'associated':
    case 'field':
    case 'match':
    case 'any':
      return !impliesSendable(checker, knownConstraints(checker, part));
    case 'nominal':
      return isConfined(part.entity.declaration);
    default:
      return false;
  }
}
