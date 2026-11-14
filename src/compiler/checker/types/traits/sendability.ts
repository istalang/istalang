/**
 * What a value lets a function capturing it be (§3.14), and so which types are Sendable (§3.1) and
 * which are Inert, reaching no disposable at any depth (§3.10, §7): derived, never declared, save
 * that an extern type says which handle it is (§3.6). One level per part a value holds, a
 * `Sendability` member or a variable of it, joined by `Sendability`'s order (type/mark-orders.ts),
 * is the one answer every reader takes, the lifetime rule's relevance included, so none classifies
 * parts again.
 *
 * - A part's own level (`ownSendability`), apart from what it holds: a disposable's is `plain`; a
 *   function's is its `Send`; a handle's whose identity stays in its instance or process is
 *   `inert` (§3.18, properties/handles.ts); a type known by its constraints is what they imply
 *   (constraint-implication.ts); anything else's is `sendable`.
 * - A type's level joins its held parts' (properties/held.ts): a struct, enum, tuple or extern
 *   value by its parts (an extern value's type arguments, since it crosses as JSON), a `sendable`
 *   handle by its type arguments. A recursive type is sendable unless something in its cycle isn't.
 * - A closure's `Send` joins its captures' (`capturedSend`), a captured `let` as the cell it lives
 *   in. A sendability variable passes through a captured function of it, so a wrapper keeps the
 *   sendability of what it wraps; any other level beside it joins to `plain`.
 * - **Relevance** (static lifetimes, docs/work/static-lifetimes/design.md §5.1) is whether a value
 *   may reach a disposable, the most any part it holds says: a part inert itself says no; one
 *   known only per instantiation, a type parameter or a computed type its constraints don't make
 *   disposable, says it depends; any other says yes. A function whose `Send` is a variable says
 *   yes, whatever instantiations make it: conservative, as the rule is.
 *
 * Code is sendable only to another instance of the same program; whether a value can go to the host
 * is whether it has a codec (rules/boundary/json-forms.ts), which no function type has. A host type
 * a `dispose` makes disposable has one, yet isn't sendable: its values have an identity.
 */

import type { CheckerContext } from '../../contexts/context.ts';
import { sameType } from '../identity/identity.ts';
import { isConfined } from '../properties/handles.ts';
import { heldType, heldTypes } from '../properties/held.ts';
import { isOpaque } from '../type/computed-types.ts';
import { inertSend, plainSend, sendableSend } from '../type/function-types.ts';
import type { Type } from '../type/index.ts';
import { sendabilityOrder } from '../type/mark-orders.ts';
import { impliedSendability } from './constraint-implication.ts';
import { isDisposable } from './disposable.ts';
import { knownConstraints } from './known-constraints.ts';

/** Whether values of `type` may leave an instance for another. */
export function isSendable(checker: CheckerContext, type: Type): boolean {
  return isCapturableBy(checker, type, sendableSend);
}

/** Whether values of `type` reach no disposable, at any depth. */
export function isInert(checker: CheckerContext, type: Type): boolean {
  return isCapturableBy(checker, type, inertSend);
}

/** Whether a function of `Send` `send` may capture values of `type`: no part it holds needs more. */
export function isCapturableBy(checker: CheckerContext, type: Type, send: Type): boolean {
  return heldType(checker, type, (part) => !isAtMostItself(checker, part, send)) === undefined;
}

/** The least `Send` of a function whose values capture values of `types` (the banner). */
export function capturedSend(checker: CheckerContext, types: readonly Type[]): Type {
  const levels = types.flatMap((type) =>
    heldTypes(checker, type).map((part) => ownSendability(checker, part)),
  );
  return sendabilityOrder.join(levels, sameType) ?? plainSend;
}

/** Whether values of a type may reach a disposable: never, always, or as instantiation decides. */
export type Relevance = 'no' | 'depends' | 'yes';

const relevanceOrder: Readonly<Record<Relevance, number>> = { no: 0, depends: 1, yes: 2 };

/** Whether `first` says less than `second`. */
export function lessRelevant(first: Relevance, second: Relevance): boolean {
  return relevanceOrder[first] < relevanceOrder[second];
}

/** The more of two relevances. */
export function moreRelevant(first: Relevance, second: Relevance): Relevance {
  return relevanceOrder[first] >= relevanceOrder[second] ? first : second;
}

/** Whether values of `type` may reach a disposable, at any depth. */
export function relevanceOf(checker: CheckerContext, type: Type): Relevance {
  return heldTypes(checker, type).reduce<Relevance>(
    (most, part) => (most === 'yes' ? most : moreRelevant(most, ownRelevance(checker, part))),
    'no',
  );
}

/** What `part` itself says of reaching a disposable, apart from what it holds (the banner). */
export function ownRelevance(checker: CheckerContext, part: Type): Relevance {
  if (isAtMostItself(checker, part, inertSend)) {
    return 'no';
  }
  return isOpaque(part) && !isDisposable(checker, part) ? 'depends' : 'yes';
}

function isAtMostItself(checker: CheckerContext, part: Type, level: Type): boolean {
  return sendabilityOrder.below(ownSendability(checker, part), level, sameType);
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
      return impliedSendability(checker, knownConstraints(checker, part));
    case 'nominal':
      return isConfined(part.entity.declaration) ? inertSend : sendableSend;
    default:
      return sendableSend;
  }
}
