/**
 * The rule that several producers of one value agree on its type (§4): the branches of an `if`,
 * or a body's tail and its `return`s. The expected type decides when there is one; otherwise the
 * first producer with a value does, and `never` (a branch that leaves) fits anything. Callers
 * choose how to report the producers that don't fit.
 */

import type { Span } from '../../../text/span.ts';
import { isAssignable, isPrimitive, type Type } from '../types/type.ts';

/** A type some part of a construct produced, and where. */
export interface Produced {
  readonly type: Type;
  readonly span: Span;
}

export interface Agreement {
  /** The agreed type; undefined when no producer has a value, as when every one leaves. */
  readonly decided: Type | undefined;
  /** The producers whose type doesn't fit the agreed one. */
  readonly disagreeing: readonly Produced[];
}

export function agreedType(produced: readonly Produced[], expected?: Type): Agreement {
  const decided = expected ?? produced.find(({ type }) => !isPrimitive(type, 'never'))?.type;
  return {
    decided,
    disagreeing:
      decided === undefined ? [] : produced.filter(({ type }) => !isAssignable(type, decided)),
  };
}
