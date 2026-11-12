/**
 * What a function does to what reaches what, over its inputs (design.md §5.3): the summary a call
 * site applies instead of the callee's body, so the analysis never clones heaps per instantiation.
 *
 * - **Inputs** are what the call gives the body: its parameters, a closure's captures and the
 *   cells of the captured `let`s, its own closure, and the globals it names. Positions only, never
 *   nodes or spans, so an edit that keeps a function's effects keeps its summary (design.md §8).
 * - **Effects** are the pairs the call may add among its inputs: `from` comes to reach `to`, or
 *   with `inside` only what `to` reaches. **Result** is how what it gives relates to its inputs,
 *   and **gives** how what a future it gives settles with does: an async call's future holds its
 *   frames, and settles with its result.
 * - **Requirements** are the pairs that must not hold when it is called: `value` may not reach
 *   `holder`, since the body writes the one into the other. Each carries the holder's type, read
 *   where the call instantiates it, so a requirement on a type reaching no disposable lapses.
 *   **Always** holds the holders' types of writes that close a cycle in any case, for an
 *   instantiation to decide whether a disposable is on it.
 * - **Call reach** is what an async call's future may come to reach: what its frames hold at any
 *   `await` and its result (§3). **Leaks** are the inputs it hands code nobody sees, **unseen**
 *   says it runs such code before it returns, and **calls** which function values it was given it
 *   calls, which the caller may know.
 * - Every pair carries a field label, always `anyField` until C4 (design.md §5.7).
 * - A native's summary comes from its declaration (`nativeSummary`): `@Keeps` gives its effects and
 *   requirements; its result is a new handle holding its arguments, or a value made of their
 *   parts, and of what the cells of those that are handles hold, and any
 *   value of a type its handles watch (design.md §6.3, §6.4). A future it gives settles with what an
 *   argument's handle holds of the future's type, as a slot's `take` does; with no such argument,
 *   with anything its arguments are or hold.
 */

import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { VariableEntity } from '../../../binder/entities.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { typeChildren } from '../../types/parts/type-children.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import { isHandleType } from '../../types/properties/handles.ts';
import type { Type } from '../../types/type/index.ts';
import { awaitedOf } from '../../types/type/well-known.ts';

/** What a call gives a body, by position. */
export type Input =
  | { readonly kind: 'parameter' | 'capture' | 'cell'; readonly index: number }
  | { readonly kind: 'self' }
  | { readonly kind: 'global'; readonly entity: VariableEntity; readonly type: Type };

/** The fields a pair's path leaves its source through; any field until C4. */
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

export interface Requirement {
  readonly holder: Input;
  readonly value: Input;
  readonly holderType: Type;
  readonly label: Label;
}

export interface Summary {
  readonly effects: readonly Effect[];
  readonly result: readonly ResultRelation[];
  /** What the future the call gives settles with, related to its inputs. */
  readonly gives: readonly ResultRelation[];
  /** Whether the result may be any value of a type an argument's handle watches. */
  readonly watched: boolean;
  readonly requirements: readonly Requirement[];
  readonly always: readonly Type[];
  readonly callReach: readonly Input[];
  readonly leaks: readonly Input[];
  readonly unseen: boolean;
  /**
   * The function values among its inputs it calls: a caller giving one it made knows that code,
   * so calling those is no unseen code of its own (design.md §5.4).
   */
  readonly calls: readonly Input[];
}

/** What a function summed up so far, before anything is known: it does nothing. */
export const emptySummary: Summary = {
  effects: [],
  result: [],
  gives: [],
  watched: false,
  requirements: [],
  always: [],
  callReach: [],
  leaks: [],
  unseen: false,
  calls: [],
};

function sameInput(first: Input, second: Input): boolean {
  switch (first.kind) {
    case 'self':
      return second.kind === 'self';
    case 'global':
      return second.kind === 'global' && first.entity === second.entity;
    default:
      return second.kind === first.kind && 'index' in second && second.index === first.index;
  }
}

/** A key naming `input`, for sets of inputs. */
export function inputKey(input: Input): string {
  switch (input.kind) {
    case 'self':
      return 'self';
    case 'global':
      return `global:${entityKey(input.entity)}`;
    default:
      return `${input.kind}:${input.index}`;
  }
}

const entityKeys = new WeakMap<VariableEntity, number>();
let entityCount = 0;

/** A number naming `entity` among the globals of every summary. */
function entityKey(entity: VariableEntity): number {
  const known = entityKeys.get(entity);
  if (known !== undefined) {
    return known;
  }
  const key = entityCount;
  entityCount += 1;
  entityKeys.set(entity, key);
  return key;
}

const sameEffects = sameItems<Effect>(
  (first, second) =>
    sameInput(first.from, second.from) &&
    sameInput(first.to, second.to) &&
    first.inside === second.inside,
);
const sameResults = sameItems<ResultRelation>(
  (first, second) => sameInput(first.input, second.input) && first.relation === second.relation,
);
const sameRequirements = sameItems<Requirement>(
  (first, second) =>
    sameInput(first.holder, second.holder) &&
    sameInput(first.value, second.value) &&
    sameTypeSpelled(first.holderType, second.holderType),
);
const sameInputs = sameItems<Input>(sameInput);

/** Whether two summaries say alike, so a caller's analysis may stop at an edit keeping it. */
export function sameSummary(first: Summary, second: Summary): boolean {
  return (
    first.watched === second.watched &&
    first.unseen === second.unseen &&
    sameInputs(first.calls, second.calls) &&
    sameEffects(first.effects, second.effects) &&
    sameResults(first.result, second.result) &&
    sameResults(first.gives, second.gives) &&
    sameRequirements(first.requirements, second.requirements) &&
    sameItems(sameTypeSpelled)(first.always, second.always) &&
    sameInputs(first.callReach, second.callReach) &&
    sameInputs(first.leaks, second.leaks)
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
            holder: parameter(holder),
            value: parameter(value),
            holderType,
            label: anyField,
          }));
    }),
    result: isHandleType(checker.resultOf(native))
      ? anyOf(['reaches'])
      : parameters.flatMap(({ type }, index) =>
          (isValueType(type) ? (['aliases'] as const) : (['aliases', 'reachedBy'] as const)).map(
            (relation) => ({ input: parameter(index), relation }),
          ),
        ),
    gives: awaited === undefined ? [] : givesOf(holding, anyOf(['aliases', 'reachedBy'])),
    watched: parameters.some(({ type }) => watchesIn(checker, type, checker.resultOf(native))),
  };
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
    result: checker.parametersOf(fields).map((_, index) => ({
      input: { kind: 'parameter', index },
      relation: 'aliases',
    })),
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
