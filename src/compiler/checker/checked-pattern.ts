/**
 * Patterns and targets as checked (§3.11, §3.15): the tests a value passes to match, and what each
 * name a target binds takes from the value. A model `check.ts` names; one walk produces both
 * (patterns/walk.ts).
 */

import type { Comprehension, Expression, SelectCase } from '../syntax/expressions/index.ts';
import type { Identifier } from '../syntax/node.ts';
import type { Relation } from '../syntax/operators.ts';
import type { ArrayPattern, CompareFieldPattern, LiteralPattern } from '../syntax/patterns.ts';
import type { For, VariableDeclaration } from '../syntax/statements.ts';
import type { AnyType, Type } from './types/type.ts';

/**
 * What binds targets (§3.15): a declaration, a `for` or comprehension for each item, or a select
 * case's `as` for the value of its future (§8).
 */
export type TargetOwner = VariableDeclaration | For | Comprehension | SelectCase;

/**
 * A step from a value to one of its parts (§3.11, §3.15): a field or tuple element by position, or
 * what an array pattern reads of an array, through the prelude calls the checker made at `site`:
 * the item `offset` from its start, or from its end when negative, and the items between the
 * first `before` and the last `after`. A target never reads an array, since its length can fail,
 * so its parts are positions (`TargetBinding`).
 */
export type PartStep =
  | number
  | { readonly kind: 'item'; readonly site: ArrayPattern; readonly offset: number }
  | {
      readonly kind: 'rest';
      readonly site: ArrayPattern;
      readonly before: number;
      readonly after: number;
    };

/** A name a target binds: its part's type, and the field and tuple element positions to it (§3.15). */
export interface TargetBinding {
  readonly name: Identifier;
  readonly type: Type;
  /** Field or tuple element positions from the whole value to the part, outermost first. */
  readonly path: readonly number[];
}

/** A name a pattern binds: its part's type, and the steps to it from the whole value (§3.11). */
export interface PartBinding {
  readonly name: Identifier;
  readonly type: Type;
  /** The steps from the whole value to the part, outermost first. */
  readonly path: readonly PartStep[];
}

/**
 * One test a value must pass to match a pattern (§3.11), on its part at `path` (the steps from the
 * whole value, as for a binding). A pattern's tests run in order, so a variant's fields are read
 * only after its variant was tested, and an array's items after its length.
 *
 * - `variant`: the part is its enum's `variant`-th variant.
 * - `downcast`: the part, of the `any` type `from`, holds a value of the type `to` (§3.10), which
 *   the tests after it reach at the part's field 0.
 * - `equal`: the part `==` a value: a literal or comparison's expression, or a top-level
 *   constant's name; `negated` for `!=`.
 * - `compare`: `compare(part, value)` called at `site`, in the relation its operator names.
 * - `length`: the part, an array, has `count` items, or more when `orMore`; the calls are `site`'s.
 * - `bound`: `compare(part, bound)`, the call made at the bound, is in `relation`: one end of a
 *   range pattern.
 * - `or`: one of the alternatives matches, the first that does deciding what the names bind.
 */
export type PatternTest =
  | {
      readonly kind: 'variant';
      readonly path: readonly PartStep[];
      readonly variant: number;
    }
  | {
      readonly kind: 'downcast';
      readonly path: readonly PartStep[];
      readonly from: AnyType;
      readonly to: Type;
    }
  | {
      readonly kind: 'equal';
      readonly path: readonly PartStep[];
      readonly value: PatternValue;
      readonly negated: boolean;
    }
  | {
      readonly kind: 'compare';
      readonly path: readonly PartStep[];
      readonly site: CompareFieldPattern;
    }
  | {
      readonly kind: 'length';
      readonly path: readonly PartStep[];
      readonly site: ArrayPattern;
      readonly count: number;
      readonly orMore: boolean;
    }
  | {
      readonly kind: 'bound';
      readonly path: readonly PartStep[];
      readonly bound: LiteralPattern;
      readonly relation: Relation;
    }
  | { readonly kind: 'or'; readonly alternatives: readonly CheckedPattern[] };

/** What an `equal` test compares with: an expression, or the constant a pattern names. */
export type PatternValue =
  | { readonly kind: 'expression'; readonly node: Expression }
  | { readonly kind: 'constant'; readonly name: Identifier };

/**
 * A `match` case's or `is`'s pattern as checked: its tests, then the names it binds outside its
 * or-patterns, whose alternatives bind their own.
 */
export interface CheckedPattern {
  readonly tests: readonly PatternTest[];
  readonly bindings: readonly PartBinding[];
}

/** Every name `pattern` binds, each once: an or-pattern's by its first alternative's. */
export function namesBound(pattern: CheckedPattern): readonly PartBinding[] {
  return [
    ...pattern.bindings,
    ...pattern.tests.flatMap((test) => {
      const [first] = test.kind === 'or' ? test.alternatives : [];
      return first === undefined ? [] : namesBound(first);
    }),
  ];
}
