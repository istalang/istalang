/**
 * What a value lets a function capturing it be (§3.14), and so which types are Sendable (§3.1):
 * derived, never declared, save that an extern type says which handle it is (§3.6). One level per
 * part a value holds, a `Sendability` member or a variable of it, joined by `Sendability`'s order
 * (type/mark-orders.ts), is the one answer every reader takes, so none classifies parts again.
 *
 * - A part's own level (`ownSendability`), apart from what it holds: a disposable's is `plain`; a
 *   function's is its `Send`; a handle's whose identity stays in its instance or process is
 *   `plain` (§3.18, properties/handles.ts); a type known by its constraints is `sendable` where
 *   they imply it (`Encodable`, `Decodable`), else `plain`; anything else's is `sendable`.
 * - A type's level joins its held parts' (properties/held.ts): a struct, enum, tuple or extern
 *   value by its parts (an extern value's type arguments, since it crosses as JSON), a `sendable`
 *   handle by its type arguments. A recursive type is sendable unless something in its cycle isn't.
 * - A closure's `Send` joins its captures' (`capturedSend`), a captured `let` as the cell it lives
 *   in. A sendability variable passes through a captured function of it, so a wrapper keeps the
 *   sendability of what it wraps; any other level beside it joins to `plain`.
 *
 * Code is sendable only to another instance of the same program; whether a value can go to the host
 * is whether it has a codec (rules/boundary/json-forms.ts), which no function type has. A host type
 * a `dispose` makes disposable has one, yet isn't sendable: its values have an identity.
 */

import type { CheckerContext } from '../../contexts/context.ts';
import { sameType } from '../identity/identity.ts';
import { isConfined } from '../properties/handles.ts';
import { heldType, heldTypes } from '../properties/held.ts';
import { plainSend, sendableSend } from '../type/function-types.ts';
import type { Type } from '../type/index.ts';
import { sendabilityOrder } from '../type/mark-orders.ts';
import { impliesSendable } from './constraint-implication.ts';
import { isDisposable } from './disposable.ts';
import { knownConstraints } from './known-constraints.ts';

/** Whether values of `type` may leave an instance for another. */
export function isSendable(checker: CheckerContext, type: Type): boolean {
  return isAtMost(checker, type, sendableSend);
}

/** The least `Send` of a function whose values capture values of `types` (the banner). */
export function capturedSend(checker: CheckerContext, types: readonly Type[]): Type {
  const levels = types.flatMap((type) =>
    heldTypes(checker, type).map((part) => ownSendability(checker, part)),
  );
  return sendabilityOrder.join(levels, sameType) ?? plainSend;
}

/** Whether `type`'s level is at or below `level`: no part it holds is above, the first ending it. */
function isAtMost(checker: CheckerContext, type: Type, level: Type): boolean {
  const above = (part: Type) =>
    !sendabilityOrder.below(ownSendability(checker, part), level, sameType);
  return heldType(checker, type, above) === undefined;
}

/** The least `Send` a value of `part` lets a function capturing it be, apart from what it holds. */
function ownSendability(checker: CheckerContext, part: Type): Type {
  if (isDisposable(checker, part)) {
    return plainSend;
  }
  switch (part.kind) {
    case 'function':
      return part.send;
    case 'parameter':
    case 'associated':
    case 'field':
    case 'match':
    case 'any':
      return impliesSendable(checker, knownConstraints(checker, part)) ? sendableSend : plainSend;
    case 'nominal':
      return isConfined(part.entity.declaration) ? plainSend : sendableSend;
    default:
      return sendableSend;
  }
}
