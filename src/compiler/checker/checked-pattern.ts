/**
 * Patterns and targets as checked (§3.11, §3.15): the tests a value passes to match, and what each
 * name a target binds takes from the value. A model `check.ts` names; one walk produces both
 * (patterns/walk.ts).
 */

import type {
  Comprehension,
  Expression,
  FieldHeader,
  SelectCase,
} from '../syntax/expressions/index.ts';
import type { Identifier } from '../syntax/node.ts';
import type { Relation } from '../syntax/operators.ts';
import type { ArrayPattern, CompareFieldPattern, LiteralPattern } from '../syntax/patterns.ts';
import type { For, VariableDeclaration } from '../syntax/statements.ts';
import type { AnyType, Type } from './types/type.ts';

/**
 * What binds targets (§3.15): a declaration, a `for` or comprehension for each item, or a select
 * case's `as` for the value of its future (§8).
 */
export type TargetOwner = VariableDeclaration | For | FieldHeader | Comprehension | SelectCase;

/**
 * A step from a value to one of its parts (§3.11, §3.15): a field or tuple element by position;
 * the value of `member` a part of `union` holds, past a member test, which an instantiation may
 * leave as the part itself, where the union collapsed into one type, or inside the `any` member
 * that took it whole (§2, §3.5; lowering derives which); the value a part of an `any`
 * type holds, past a downcast (§3.10); or what an array pattern reads of an array, through the
 * prelude calls the checker made at `site`: its length, the item `offset` from its start, or from
 * its end when negative, and the items between the first `before` and the last `after`. A target
 * never reads an array, since its length can fail, nor tests a member, so its parts are positions
 * and the struct steps below (`TargetBinding`).
 */
export type PartStep =
  | number
  | { readonly kind: 'member'; readonly union: Type; readonly member: Type }
  | { readonly kind: 'downcast' }
  | ArrayStep
  | StructStep;

/**
 * A step into a struct that names its field rather than its position: a field of `of`, a struct
 * whose fields aren't known yet (a type parameter with a struct constraint, §3.5), whose position
 * each instantiation decides; or a rest (§3.11), the struct `to` of the fields of `from` that the
 * pattern doesn't name, built anew from them by name. A struct whose fields are known is read by
 * position, the layout its fields are in (name order, §3.1), which no instantiation changes.
 */
export type StructStep =
  | { readonly kind: 'field'; readonly of: Type; readonly name: string }
  | { readonly kind: 'fieldRest'; readonly from: Type; readonly to: Type };

/** A step a target's part is reached by: a field's or an element's position, or a struct step. */
export type TargetStep = number | StructStep;

/** A step an array pattern takes through a prelude call (`PartStep`). */
export type ArrayStep =
  | { readonly kind: 'length'; readonly site: ArrayPattern }
  | { readonly kind: 'item'; readonly site: ArrayPattern; readonly offset: number }
  | {
      readonly kind: 'rest';
      readonly site: ArrayPattern;
      readonly before: number;
      readonly after: number;
    };

/** A name a target binds: its part's type, and the steps to it from the whole value (§3.15). */
export interface TargetBinding {
  readonly name: Identifier;
  readonly type: Type;
  /** Field or tuple element positions, or struct steps, from the whole value, outermost first. */
  readonly path: readonly TargetStep[];
}

/** A name a pattern binds: its part's type, and the steps to it from the whole value (§3.11). */
export interface PartBinding {
  readonly name: Identifier;
  readonly type: Type;
  /** The steps from the whole value to the part, outermost first. */
  readonly path: readonly PartStep[];
  /**
   * The type the part's value is of, when `type` holds only some of its values (§3.11): a union
   * as checked, or what an instantiation collapsed it into (§3.5), whose literals `type` may be.
   */
  readonly narrowedFrom?: Type | undefined;
}

/**
 * One test a value must pass to match a pattern (§3.11), on its part at `path` (the steps from the
 * whole value, as for a binding). A pattern's tests run in order, so a variant's fields are read
 * only after its variant was tested, and an array's items after its length.
 *
 * - `variant`: the part is its enum's `variant`-th variant.
 * - `downcast`: the part, of the `any` type `from`, holds a value of the type `to` (§3.10), which
 *   the tests after it reach through a `downcast` step.
 * - `member`: the part, of the union `union`, holds a value of one of `members` (§3.11); the tests
 *   after it reach the value of the one member through a `member` step. An instantiation may
 *   collapse the union into one type (§3.5, types/instantiation.ts): the part is then that type's
 *   value itself, which the test passes when a member is that type, compares with when a member is
 *   a literal of it, and fails otherwise.
 * - `equal`: the part `==` a value: a literal or comparison's expression, a top-level constant's
 *   name, or an array pattern's fixed item count; `negated` for `!=`.
 * - `compare`: `compare(part, value)`, the implicit call recorded at `site`, is in `relation`: a
 *   struct pattern's field ordering, a range pattern's bound, or an array pattern's rest length.
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
      readonly kind: 'member';
      readonly path: readonly PartStep[];
      readonly union: Type;
      readonly members: readonly Type[];
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
      readonly site: CompareFieldPattern | LiteralPattern | ArrayPattern;
      readonly value: PatternValue;
      readonly relation: Relation;
    }
  | { readonly kind: 'or'; readonly alternatives: readonly CheckedPattern[] };

/** What an `equal` or `compare` test compares the part with. */
export type PatternValue =
  | { readonly kind: 'expression'; readonly node: Expression }
  | { readonly kind: 'constant'; readonly name: Identifier }
  | { readonly kind: 'int'; readonly value: bigint };

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
