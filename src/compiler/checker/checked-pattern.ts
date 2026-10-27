/**
 * Patterns and targets as checked (§3.11, §3.15): the tests a value passes to match, and what each
 * name a target binds takes from the value. A model `check.ts` names; one walk produces both
 * (patterns/walk.ts).
 */

import type { Comprehension, Expression, SelectCase } from '../syntax/expressions/index.ts';
import type { Identifier } from '../syntax/node.ts';
import type { CompareFieldPattern } from '../syntax/patterns.ts';
import type { For, VariableDeclaration } from '../syntax/statements.ts';
import type { AnyType, Type } from './types/type.ts';

/**
 * What binds targets (§3.15): a declaration, a `for` or comprehension for each item, or a select
 * case's `as` for the value of its future (§8).
 */
export type TargetOwner = VariableDeclaration | For | Comprehension | SelectCase;

/** A name a target binds: its part's type, and the positions leading to it (§3.15). */
export interface TargetBinding {
  readonly name: Identifier;
  readonly type: Type;
  /** Field or tuple element positions from the whole value to the part, outermost first. */
  readonly path: readonly number[];
}

/**
 * One test a value must pass to match a pattern (§3.11), on its part at `path` (field or tuple
 * element positions from the whole value, as for a binding). A pattern's tests run in order, so a
 * variant's fields are read only after its variant was tested.
 *
 * - `variant`: the part is its enum's `variant`-th variant.
 * - `downcast`: the part, of the `any` type `from`, holds a value of the type `to` (§3.10), which
 *   the tests after it reach at the part's field 0.
 * - `equal`: the part `==` a value: a literal or comparison's expression, or a top-level
 *   constant's name; `negated` for `!=`.
 * - `compare`: `compare(part, value)` called at `site`, in the relation its operator names.
 */
export type PatternTest =
  | {
      readonly kind: 'variant';
      readonly path: readonly number[];
      readonly variant: number;
    }
  | {
      readonly kind: 'downcast';
      readonly path: readonly number[];
      readonly from: AnyType;
      readonly to: Type;
    }
  | {
      readonly kind: 'equal';
      readonly path: readonly number[];
      readonly value: PatternValue;
      readonly negated: boolean;
    }
  | {
      readonly kind: 'compare';
      readonly path: readonly number[];
      readonly site: CompareFieldPattern;
    };

/** What an `equal` test compares with: an expression, or the constant a pattern names. */
export type PatternValue =
  | { readonly kind: 'expression'; readonly node: Expression }
  | { readonly kind: 'constant'; readonly name: Identifier };

/** A `match` case's or `is`'s pattern as checked: its tests, then the names it binds. */
export interface CheckedPattern {
  readonly tests: readonly PatternTest[];
  readonly bindings: readonly TargetBinding[];
}
