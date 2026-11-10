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
 * A closure's `Send` follows what it captures (`capturedSend`): a sendability variable passes
 * through a captured function of it, so a wrapper keeps the sendability of what it wraps.
 *
 * Code is sendable only to another instance of the same program; whether a value can go to the host
 * is whether it has a codec (rules/boundary/json-forms.ts), which no function type has. A host type
 * a `dispose` makes disposable has one, yet isn't sendable: its values have an identity.
 */

import type { CheckerContext } from '../../contexts/context.ts';
import { sameType } from '../identity/identity.ts';
import { isConfined } from '../properties/handles.ts';
import { heldType, heldTypes } from '../properties/held.ts';
import { isSendableFunction, plainSend, sendableSend } from '../type/function-types.ts';
import type { Type } from '../type/index.ts';
import { impliesSendable } from './constraint-implication.ts';
import { knownConstraints } from './known-constraints.ts';

/** Whether values of `type` may leave an instance for another. */
export function isSendable(checker: CheckerContext, type: Type): boolean {
  return heldType(checker, type, (part) => keepsInInstance(checker, part)) === undefined;
}

/**
 * The `Send` of a function whose values capture values of `types` (§3.14, proposal 8, Rule 4):
 * `sendable` where each may leave its instance; a sendability variable where all that keeps one
 * in it is function values of that `S`, so `logged(f)`'s closure is sendable exactly when `f` is;
 * else `plain`.
 */
export function capturedSend(checker: CheckerContext, types: readonly Type[]): Type {
  const keeping = types.flatMap((type) =>
    heldTypes(checker, type).filter((part) => keepsInInstance(checker, part)),
  );
  const [first] = keeping;
  if (first === undefined) {
    return sendableSend;
  }
  const variable = first.kind === 'function' ? first.send : undefined;
  const sharesVariable = (part: Type) =>
    part.kind === 'function' && variable !== undefined && sameType(part.send, variable);
  return variable?.kind === 'parameter' && keeping.every(sharesVariable) ? variable : plainSend;
}

/**
 * Whether `part`, held in a value, keeps it in its instance whatever else it holds: a function
 * not declared `sendable`, a handle whose identity stays in its instance or process, or a type
 * parameter not known to be Sendable.
 */
function keepsInInstance(checker: CheckerContext, part: Type): boolean {
  switch (part.kind) {
    case 'function':
      return !isSendableFunction(part);
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
