/**
 * What the walk asks of whoever checks a pattern that may fail (§3.11): each construct that could
 * fail to match, checked into the tests lowering runs and a shape for exhaustiveness. A `match`
 * case or `is` provides them (../matching.ts); a target has none, so the walk refuses those
 * constructs there (walk/index.ts).
 */

import type { VariantNaming } from '../../../../binder/entities.ts';
import type {
  ArrayPattern,
  CompareFieldPattern,
  LiteralPattern,
  NamePattern,
  RangePattern,
  StructPattern,
} from '../../../../syntax/patterns.ts';
import { neverTest, type PatternTest } from '../../../surface/checked-pattern.ts';
import type { AnyType, FieldMember, Type } from '../../../types/type/index.ts';
import { neverType } from '../../../types/type/primitives.ts';
import { nothingShape, type Shape } from '../exhaustiveness/exhaustiveness.ts';
import type { Downcast } from './kinds/downcasts.ts';
import type { ValuePart } from './parts.ts';

/** What a refutable construct gives the walk: its tests, and its shape (undefined: a guard). */
export interface Leaf {
  readonly tests: readonly PatternTest[];
  readonly shape: Shape | undefined;
}

/** Nothing to test, after a report; a guard for exhaustiveness. */
export const failed: Leaf = { tests: [], shape: undefined };

/** A construct its part's type rules out (§3.11): it never matches, so it covers nothing. */
export const ruledOutLeaf: Leaf = { tests: [neverTest], shape: nothingShape };

/** What an array pattern tests of its part, an array: its length, and the type of its items. */
export interface ArrayPart {
  readonly test: PatternTest;
  readonly items: Type;
}

/** The variant a struct pattern names: the test for it, its key among shapes, and its fields. */
export interface VariantPart {
  readonly test: PatternTest;
  readonly key: string;
  readonly fields: readonly FieldMember[];
}

/**
 * What a pattern selects of its part before taking it apart (selections.ts): its test, the part the
 * rest of the pattern takes, whether the selection says all there is to match, and the pattern's
 * shape given the rest's.
 */
export interface Selection {
  readonly test: PatternTest;
  readonly part: ValuePart;
  readonly decided: boolean;
  readonly shapeOf: (inside: Shape | undefined) => Shape | undefined;
}

/**
 * A selection its part's type rules out (§3.11): the pattern never matches there, so nothing past
 * it is taken apart, and what it binds has no value.
 */
export function ruledOutSelection(part: ValuePart): Selection {
  return {
    test: neverTest,
    part: { type: neverType, path: part.path },
    decided: true,
    shapeOf: () => nothingShape,
  };
}

/** How the constructs that could fail to match are checked, where a pattern may fail. */
export interface PatternTests {
  /** `case 0:`, `case "cfo":`, `case none:`. */
  readonly literal: (node: LiteralPattern, part: ValuePart) => Leaf;
  /** `amount > 1000`, `ok == false`, on the part of the field. */
  readonly comparison: (item: CompareFieldPattern, part: ValuePart) => Leaf;
  /** A name that refers: a variant, a type, or a constant. */
  readonly reference: (node: NamePattern, part: ValuePart) => Leaf;
  /** The variant `naming` names in a struct pattern; undefined after a report. */
  readonly variant: (
    node: StructPattern,
    naming: VariantNaming,
    part: ValuePart,
  ) => VariantPart | undefined;
  /** The length test and item type of an array pattern on the part; undefined after a report. */
  readonly array: (node: ArrayPattern, part: ValuePart) => ArrayPart | undefined;
  /** `1..=5`, `..0` on an int part. */
  readonly range: (node: RangePattern, part: ValuePart) => Leaf;
  /**
   * The downcast a struct pattern or referring name makes of an `any` part: `ruledOut` for a type
   * never inside it; undefined for none.
   */
  readonly downcast: (
    node: StructPattern | NamePattern,
    part: ValuePart & { readonly type: AnyType },
  ) => Downcast | 'ruledOut' | undefined;
}
