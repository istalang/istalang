/**
 * What a function does to what reaches what, over its inputs (design.md §5.3): the summary a call
 * site applies instead of the callee's body, so the analysis never clones heaps per instantiation.
 *
 * - **Inputs** (input.ts) are what the call gives the body, by position only, never nodes or spans,
 *   so an edit that keeps a function's effects keeps its summary (design.md §8).
 * - **Effects** are the pairs the call may add among its inputs and the parts of them it read:
 *   `from` comes to reach `to`, or with `inside` only what `to` reaches; `from` reaching itself
 *   has its parts come to reach each other. **Result** is what it gives, and **gives** what a
 *   future it gives settles with, each a value related to its inputs (`GivenValue`): an async
 *   call's future holds its frames, and settles with its result.
 * - **Requirements** are the pairs that must not hold when it is called: `value` may not reach
 *   `holder`, since the body writes the one into the other. Each carries the holder's type, read
 *   where the call instantiates it, so a requirement on a type reaching no disposable lapses.
 *   **Always** holds the holders' types of writes that close a cycle in any case, for an
 *   instantiation to decide whether a disposable is on it.
 * - **Call reach** is what an async call's future may come to reach: what its frames hold at any
 *   `await` and its result (§3). **Leaks** are the inputs it hands code nobody sees, **unseen**
 *   says it runs such code before it returns, and **calls** which function values it was given it
 *   calls, which the caller may know.
 * - Every pair carries a field label, always `anyField`: labels aren't built (design.md §5.7).
 * - A native's summary comes from its declaration (`nativeSummary`): `@Keeps` gives its effects and
 *   requirements; its result is a new handle holding its arguments, or a value made of their
 *   parts, and of what the cells of those that are handles hold, and, where its handles watch a
 *   type, what any watching handle may give (`watched`, design.md §6.3, §6.4). A future it gives
 *   settles with what an argument's handle holds of the future's type, as a slot's `take` does;
 *   with no such argument, with anything its arguments are or hold.
 */

import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { typeChildren } from '../../types/parts/type-children.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import { isHandleType } from '../../types/properties/handles.ts';
import type { Type } from '../../types/type/index.ts';
import { awaitedOf } from '../../types/type/well-known.ts';
import { type Input, sameInput } from './input.ts';

/** The fields a pair's path leaves its source through; any field, labels not being built. */
export interface Label {
  readonly kind: 'any';
}

export const anyField: Label = { kind: 'any' };

export interface Effect {
  readonly from: Input;
  readonly to: Input;
  readonly inside: boolean;
  readonly label: Label;
}

/** How a call's result relates to one of its inputs. */
export interface ResultRelation {
  readonly input: Input;
  readonly relation: 'reaches' | 'reachedBy' | 'aliases' | 'shares';
}

/**
 * A value a call gives, its result or what a future it gives settles with: how it relates to each
 * of the call's inputs, what any watching handle may give among them, and whether its parts may
 * reach each other (a tuple of a handle and what it holds).
 */
export interface GivenValue {
  readonly relations: readonly ResultRelation[];
  readonly reachesItself: boolean;
}

/** A value related to no input: a call's fresh, or one that gives nothing a disposable. */
export const unrelatedValue: GivenValue = { relations: [], reachesItself: false };

/**
 * A pair that must not hold when the function is called: `value` may not reach or be what
 * `holder` holds (`reach`), since the body writes it there; or the two may share nothing
 * (`share`), since code the body runs unseen reaches one and the body relies on its not reaching
 * the other (unseen.ts).
 */
export interface Requirement {
  readonly kind: 'reach' | 'share';
  readonly holder: Input;
  readonly value: Input;
  readonly holderType: Type;
  /**
   * The type of what is written, which may be narrower than `value`'s: a pair its types can't
   * close is no cycle. Undefined where it has no recorded type: any value.
   */
  readonly valueType: Type | undefined;
  /**
   * Where the write lands when `holder` is a parameter taken by `&`: in the caller's place itself
   * (`r = v`, `xs.push(v)`), or behind a handle the value there holds (`r->next = v`). Any other
   * holder is a value whose handles the write lands behind.
   */
  readonly lands: 'place' | 'behind';
  readonly label: Label;
}

/**
 * A cycle a function's writes close whatever values its inputs are, for each instantiation to
 * decide (design.md §5.3): one only where a value of a type of `through` may reach or be a
 * `holder` (`reach`), or share with one (`share`), and a value of each of `sources`, what the
 * value written came from, may too; holding a disposable where `deciding` may reach one.
 */
export interface TypedCycle {
  readonly holder: Type;
  readonly through: readonly Type[];
  readonly sources: readonly Type[];
  readonly kind: Requirement['kind'];
  readonly deciding: Type;
}

/** `cycle`, each of its types mapped by `map`. */
export function mappedCycle(cycle: TypedCycle, map: (type: Type) => Type): TypedCycle {
  return {
    holder: map(cycle.holder),
    through: cycle.through.map(map),
    sources: cycle.sources.map(map),
    kind: cycle.kind,
    deciding: map(cycle.deciding),
  };
}

export interface Summary {
  readonly effects: readonly Effect[];
  readonly result: GivenValue;
  /** What the future the call gives settles with. */
  readonly gives: GivenValue;
  readonly requirements: readonly Requirement[];
  readonly always: readonly TypedCycle[];
  readonly callReach: readonly Input[];
  readonly leaks: readonly Input[];
  readonly unseen: boolean;
  /**
   * The function values among its inputs it calls: a caller giving one it made knows that code,
   * so calling those is no unseen code of its own (design.md §5.4).
   */
  readonly calls: readonly Input[];
  /** The inputs the unseen code it runs may reach. */
  readonly access: readonly Input[];
}

/** What a function summed up so far, before anything is known: it does nothing. */
export const emptySummary: Summary = {
  effects: [],
  result: unrelatedValue,
  gives: unrelatedValue,
  requirements: [],
  always: [],
  callReach: [],
  leaks: [],
  unseen: false,
  calls: [],
  access: [],
};

const sameEffects = sameItems<Effect>(
  (first, second) =>
    sameInput(first.from, second.from) &&
    sameInput(first.to, second.to) &&
    first.inside === second.inside,
);
const sameRelations = sameItems<ResultRelation>(
  (first, second) => sameInput(first.input, second.input) && first.relation === second.relation,
);

/** Whether two values a call gives say alike. */
export function sameValue(first: GivenValue, second: GivenValue): boolean {
  return (
    first.reachesItself === second.reachesItself && sameRelations(first.relations, second.relations)
  );
}
const sameCycles = sameItems<TypedCycle>(
  (first, second) =>
    first.kind === second.kind &&
    sameTypeSpelled(first.holder, second.holder) &&
    sameTypeSpelled(first.deciding, second.deciding) &&
    sameItems(sameTypeSpelled)(first.through, second.through) &&
    sameItems(sameTypeSpelled)(first.sources, second.sources),
);
const sameRequirements = sameItems<Requirement>(
  (first, second) =>
    first.kind === second.kind &&
    first.lands === second.lands &&
    sameInput(first.holder, second.holder) &&
    sameInput(first.value, second.value) &&
    sameTypeSpelled(first.holderType, second.holderType) &&
    (first.valueType === undefined
      ? second.valueType === undefined
      : second.valueType !== undefined && sameTypeSpelled(first.valueType, second.valueType)),
);
const sameInputs = sameItems<Input>(sameInput);

/** Whether two summaries say alike, so a caller's analysis may stop at an edit keeping it. */
export function sameSummary(first: Summary, second: Summary): boolean {
  return (
    first === second ||
    (first.unseen === second.unseen &&
      sameInputs(first.calls, second.calls) &&
      sameInputs(first.access, second.access) &&
      sameEffects(first.effects, second.effects) &&
      sameValue(first.result, second.result) &&
      sameValue(first.gives, second.gives) &&
      sameRequirements(first.requirements, second.requirements) &&
      sameCycles(first.always, second.always) &&
      sameInputs(first.callReach, second.callReach) &&
      sameInputs(first.leaks, second.leaks))
  );
}

/** The summary of the extern function `native`, read off its declaration (design.md §6.4). */
export function nativeSummary(
  checker: Pick<
    CheckerContext,
    'parametersOf' | 'keepsOf' | 'resultOf' | 'externHeldOf' | 'wellKnownType'
  >,
  native: FunctionDeclaration,
): Summary {
  const parameters = checker.parametersOf(native);
  const parameter = (index: number): Input => ({ kind: 'parameter', index });
  const kept = checker.keepsOf(native);
  const awaited = awaitedOf(checker, checker.resultOf(native))?.value;
  const holding =
    awaited === undefined
      ? []
      : parameters.flatMap(({ type }, index) =>
          holdsDirectly(checker, type, awaited) ? [parameter(index)] : [],
        );
  const anyOf = (relations: readonly ResultRelation['relation'][]) =>
    parameters.flatMap((_, index) =>
      relations.map((relation) => ({ input: parameter(index), relation })),
    );
  return {
    ...emptySummary,
    effects: kept.flatMap(({ holder, kept: values }) =>
      values.map((value) => ({
        from: parameter(holder),
        to: parameter(value),
        inside: false,
        label: anyField,
      })),
    ),
    requirements: kept.flatMap(({ holder, kept: values }) => {
      const holderType = parameters[holder]?.type;
      return holderType === undefined
        ? []
        : values.map((value) => ({
            kind: 'reach' as const,
            holder: parameter(holder),
            value: parameter(value),
            holderType,
            valueType: parameters[value]?.type,
            lands:
              parameters[holder]?.reference === true ? ('place' as const) : ('behind' as const),
            label: anyField,
          }));
    }),
    result: { relations: nativeResult(checker, native), reachesItself: false },
    gives: {
      relations: awaited === undefined ? [] : givesOf(holding, anyOf(['aliases', 'reachedBy'])),
      reachesItself: false,
    },
  };
}

/**
 * How a native's result relates to its arguments: a new handle holding them, or a value made of
 * their parts and of what their cells hold; and what any watching handle may give, where its
 * handles watch a type it gives.
 */
function nativeResult(
  checker: Pick<CheckerContext, 'parametersOf' | 'resultOf' | 'externHeldOf'>,
  native: FunctionDeclaration,
): readonly ResultRelation[] {
  const parameters = checker.parametersOf(native);
  const result = checker.resultOf(native);
  const relations = (index: number, kinds: readonly ResultRelation['relation'][]) =>
    kinds.map((relation) => ({ input: { kind: 'parameter', index } as const, relation }));
  return [
    ...parameters.flatMap(({ type }, index) => {
      if (isHandleType(result)) {
        return relations(index, ['reaches']);
      }
      return relations(index, isValueType(type) ? ['aliases'] : ['aliases', 'reachedBy']);
    }),
    ...(parameters.some(({ type }) => watchesIn(checker, type, result))
      ? [{ input: { kind: 'watched' } as const, relation: 'aliases' as const }]
      : []),
  ];
}

/** What a native's future settles with: what the handles `holding` hold, else anything. */
function givesOf(
  holding: readonly Input[],
  anything: readonly ResultRelation[],
): readonly ResultRelation[] {
  return holding.length > 0
    ? holding.map((input) => ({ input, relation: 'reachedBy' as const }))
    : anything;
}

/** Whether values of `type` are values of a nominal type, never handles: a collection, a struct. */
function isValueType(type: Type): boolean {
  return type.kind === 'nominal' && !isHandleType(type);
}

/** Whether a handle of `type` holds values of `value` directly, by its `@Holds` or arguments. */
function holdsDirectly(
  checker: Pick<CheckerContext, 'externHeldOf'>,
  type: Type,
  value: Type,
): boolean {
  return (
    type.kind === 'nominal' &&
    type.entity.declaration.kind === 'ExternStructDeclaration' &&
    checker.externHeldOf(type).some((held) => sameTypeSpelled(held, value))
  );
}

/**
 * The summary of a fields function with no body of its own (§3.1, §3.11): the value it gives holds
 * every field it is given, directly.
 */
export function constructorSummary(
  checker: Pick<CheckerContext, 'parametersOf'>,
  fields: FunctionDeclaration,
): Summary {
  return {
    ...emptySummary,
    result: {
      relations: checker.parametersOf(fields).map((_, index) => ({
        input: { kind: 'parameter', index },
        relation: 'aliases',
      })),
      reachesItself: false,
    },
  };
}

/**
 * Whether a handle of `type` watches a type argument `result` names: an argument its `@Holds`
 * leaves out, which a native given the handle may give back any value of (`deref`).
 */
function watchesIn(
  checker: Pick<CheckerContext, 'externHeldOf'>,
  type: Type,
  result: Type,
): boolean {
  if (type.kind !== 'nominal' || type.entity.declaration.kind !== 'ExternStructDeclaration') {
    return false;
  }
  const held = checker.externHeldOf(type);
  return type.arguments.some(
    (argument) => !held.some((each) => mentions(each, argument)) && mentions(result, argument),
  );
}

/** Whether `type` is `part` or holds it among its parts, as spelled. */
function mentions(type: Type, part: Type): boolean {
  return sameTypeSpelled(type, part) || typeChildren(type).some((child) => mentions(child, part));
}
