/**
 * Patterns and targets as checked (§3.11, §3.15): the tests a value passes to match, and what each
 * name a target binds takes from the value. A model `check.ts` names; one walk produces both
 * (constructs/patterns/walk/index.ts).
 */

import type {
  Comprehension,
  Expression,
  FieldHeader,
  Parameter,
  SelectCase,
} from '../../syntax/expressions/index.ts';
import type { Relation } from '../../syntax/expressions/operators.ts';
import type {
  ArrayPattern,
  CompareFieldPattern,
  LiteralPattern,
  StructPattern,
  VariantCallPattern,
} from '../../syntax/patterns.ts';
import type { For, VariableDeclaration } from '../../syntax/statements/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { AnyType, Type } from '../types/type/index.ts';

/**
 * What binds targets (§3.15): a declaration, a `for` or comprehension for each item, a parameter's
 * pattern for its argument (§3.3), or a select case's `as` for the value of its future (§8).
 */
export type TargetOwner =
  | VariableDeclaration
  | For
  | FieldHeader
  | Comprehension
  | Parameter
  | SelectCase;

/**
 * A step from a value to one of its parts (§3.11, §3.15): a struct's field by its name
 * (`StructStep`), whose position each struct type, as an instantiation makes it, decides (§3.1
 * "Field order"); a tuple's element by position; the field at `index` of the variant a test before
 * it found, of `type`; the value of `member` a part of `union` holds, past a member test or where a
 * pattern's name narrows its part (`narrowedFrom`, to a member or a narrower union, from a union or
 * an `any` type), which an instantiation may leave as the part itself, where the union collapsed
 * into one type, or inside the `any` member that took it whole (§2, §3.5; lowering derives which); the value of type `to` a part of an `any` type holds, past a downcast
 * (§3.10); or
 * what an array pattern reads of an array, through the prelude calls the checker made at `site`:
 * its length, the item `offset` from its start, or from its end when negative, and the items
 * between the first `before` and the last `after`. A target never reads an array, since its length
 * can fail, nor tests a member, so its parts are positions and struct steps (`TargetStep`).
 */
export type PartStep =
  | number
  | { readonly kind: 'member'; readonly union: Type; readonly member: Type }
  | {
      readonly kind: 'variantField';
      readonly variant: string;
      readonly index: number;
      readonly type: Type;
    }
  | { readonly kind: 'downcast'; readonly to: Type }
  | ArrayStep
  | StructStep;

/**
 * A step into a struct: its field `name`, of the struct type `of`; or a rest (§3.11), the struct
 * `to` of the fields of `from` that the pattern doesn't name, built anew from them by name. A field
 * is named, never placed: where it lies is the concrete struct type's to say (§3.1 "Field order"),
 * which a struct whose fields aren't known yet (a type parameter with a struct constraint, §3.5)
 * only has once instantiated.
 */
export type StructStep =
  | FieldStep
  | { readonly kind: 'fieldRest'; readonly from: Type; readonly to: Type };

/** A step into a struct's field by its name (`StructStep`). */
export interface FieldStep {
  readonly kind: 'field';
  readonly of: Type;
  readonly name: string;
}

/** A step a target's part is reached by: a tuple element's position, or a struct step. */
export type TargetStep = number | StructStep;

/**
 * Where an array's items are matched, which its prelude calls are made at: an array pattern, or a
 * call pattern whose arguments past its variant's fixed fields match the rest field's (§3.11).
 */
export type ArraySite = ArrayPattern | VariantCallPattern;

/**
 * A pattern naming fields of what it takes apart: a struct pattern's items, a struct's or a shape's
 * fields, or a call pattern's arguments, its variant's.
 */
export type FieldsPattern = StructPattern | VariantCallPattern;

/** A step an array pattern takes through a prelude call (`PartStep`). */
export type ArrayStep =
  | { readonly kind: 'length'; readonly site: ArraySite }
  | { readonly kind: 'item'; readonly site: ArraySite; readonly offset: number }
  | {
      readonly kind: 'rest';
      readonly site: ArraySite;
      readonly before: number;
      readonly after: number;
    };

/** A name a target binds: its part's type, and the steps to it from the whole value (§3.15). */
export interface TargetBinding {
  readonly name: Identifier;
  readonly type: Type;
  /** Tuple element positions and struct steps from the whole value, outermost first. */
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
 * - A `TypeTest`: what the part holds.
 * - `equal`: the part `==` a value: a literal or comparison's expression, a top-level constant's
 *   name, or an array pattern's fixed item count; `negated` for `!=`.
 * - `compare`: `compare(part, value)`, the implicit call recorded at `site`, is in `relation`: a
 *   struct pattern's field ordering, a range pattern's bound, or an array pattern's rest length.
 * - `or`: one of the alternatives matches, the first that does deciding what the names bind. An
 *   alternative its part's type rules out is left out of it.
 * - `never`: the part's type can't hold what the pattern matches there (§3.11), so the pattern
 *   never matches (`cantMatch`): a case is ruled out, an `is` always false.
 */
export type PatternTest =
  | ({ readonly path: readonly PartStep[] } & TypeTest)
  | {
      readonly kind: 'equal';
      readonly path: readonly PartStep[];
      readonly value: PatternValue;
      readonly negated: boolean;
    }
  | {
      readonly kind: 'compare';
      readonly path: readonly PartStep[];
      readonly site: CompareFieldPattern | LiteralPattern | ArraySite;
      readonly value: PatternValue;
      readonly relation: Relation;
    }
  | { readonly kind: 'or'; readonly alternatives: readonly CheckedPattern[] }
  | { readonly kind: 'never' };

/**
 * What a value holds, tested by its type, as a pattern tests a part and `?` and a loop test a
 * `Result` and a cursor's step:
 *
 * - `variant`: the value is its enum's `variant`-th variant.
 * - `downcast`: the value, of the `any` type `from`, holds a value of the type `to` (§3.10), which
 *   a pattern's tests after it reach through a `downcast` step.
 * - `member`: the value, of the union `union`, holds a value of one of `members` (§3.11); a
 *   pattern's tests after it reach the value of the one member through a `member` step. An
 *   instantiation may collapse the union into one type (§3.5, wiring/body/facts/instantiation.ts):
 *   the value is then that type's value itself, which the test passes when a member is that type,
 *   compares with when a member is a literal of it, and fails otherwise.
 */
export type TypeTest =
  | { readonly kind: 'variant'; readonly variant: number }
  | { readonly kind: 'downcast'; readonly from: AnyType; readonly to: Type }
  | { readonly kind: 'member'; readonly union: Type; readonly members: readonly Type[] };

/** The test of a part whose type can't hold what the pattern matches there (§3.11). */
export const neverTest: PatternTest = { kind: 'never' };

/** Whether no value passes `tests`: one is `never`, or an `or` none of whose alternatives can. */
export function cantMatch(tests: readonly PatternTest[]): boolean {
  return tests.some(
    (each) =>
      each.kind === 'never' ||
      (each.kind === 'or' &&
        each.alternatives.every((alternative) => cantMatch(alternative.tests))),
  );
}

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
