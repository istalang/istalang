/**
 * Where each annotation the toolchain reads means something (§5.5): which they are, and the place
 * each may stand at, as an annotation's check reads its place (index.ts).
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import {
  type WellKnownDeclaration,
  wellKnown,
} from '../../../../foundation/language/well-known/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { AnnotationPlace } from '../../surface/checked-annotation.ts';
import type { Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';

/** The annotations the toolchain itself reads. */
export const known = {
  jsonName: wellKnown.jsonName,
  jsonSkip: wellKnown.jsonSkip,
  jsonBigInt: wellKnown.jsonBigInt,
  waypoint: wellKnown.waypoint,
  suite: wellKnown.suite,
  holds: wellKnown.holds,
  keeps: wellKnown.keeps,
  parametric: wellKnown.parametric,
} as const satisfies Record<string, WellKnownDeclaration>;

export type Known = keyof typeof known;

/** A place as its annotations' check reads it: a field's with the type it is declared with. */
export type Placed =
  | Exclude<AnnotationPlace, { readonly kind: 'field' }>
  | { readonly kind: 'field'; readonly type: Type };

/** What a placement reads beyond the place: whether a type has a default, and where it stands. */
export interface PlaceFacts {
  readonly isDefault: (type: Type) => boolean;
  /** Whether the item is the std's. */
  readonly isStd: boolean;
}

/**
 * Where each annotation means something: `'elsewhere'` when `place` is no place for it, a
 * diagnostic at its span when the place is right but the item can't take it, else nothing.
 * Annotations the toolchain doesn't read (`any`) mean something to tools on fields, functions and
 * struct declarations.
 */
export const placements: Record<
  Known | 'any',
  (
    place: Placed,
    facts: PlaceFacts,
  ) => 'elsewhere' | ((at: AnchoredSpan) => Diagnostic<AnchoredSpan>) | undefined
> = {
  jsonName: (place) => (place.kind === 'field' ? undefined : 'elsewhere'),
  jsonSkip: (place, { isDefault }) => {
    if (place.kind !== 'field') {
      return 'elsewhere';
    }
    return isDefault(place.type)
      ? undefined
      : (at) => checkerDiagnostics.skippedWithoutDefault(at, typeText(place.type));
  },
  jsonBigInt: (place) => {
    if (place.kind !== 'field') {
      return 'elsewhere';
    }
    return place.type.kind === 'primitive' && place.type.name === 'Int'
      ? undefined
      : (at) => checkerDiagnostics.bigIntNotInt(at, typeText(place.type));
  },
  waypoint: (place) => {
    if (place.kind !== 'statement') {
      return 'elsewhere';
    }
    return place.waits ? undefined : (at) => checkerDiagnostics.waypointWithoutWait(at);
  },
  suite: (place) => (place.kind === 'function' ? undefined : 'elsewhere'),
  holds: (place, { isStd }) => {
    if (place.kind !== 'struct') {
      return 'elsewhere';
    }
    return place.isExtern && isStd ? undefined : (at) => checkerDiagnostics.holdsOutsideStd(at);
  },
  keeps: (place, { isStd }) => {
    if (place.kind !== 'function') {
      return 'elsewhere';
    }
    return isStd ? undefined : (at) => checkerDiagnostics.keepsOutsideStd(at);
  },
  parametric: (place) => (place.kind === 'function' && place.isExtern ? undefined : 'elsewhere'),
  any: (place) =>
    place.kind === 'field' || place.kind === 'function' || place.kind === 'struct'
      ? undefined
      : 'elsewhere',
};

/** How a diagnostic names `place`. */
export function placeText(place: Placed): string {
  switch (place.kind) {
    case 'field':
      return 'a field';
    case 'function':
      return 'a function';
    case 'struct':
      return place.isExtern ? 'an extern struct' : 'a struct declaration';
    case 'statement':
      return 'a statement';
    case 'other':
      return place.description;
    default: {
      const unhandled: never = place;
      return unhandled;
    }
  }
}
