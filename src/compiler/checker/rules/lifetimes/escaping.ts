/**
 * A function code nobody sees calls (design.md §5.5): an escaping closure, a function named as a
 * value, a witness called through `any` or by a generic callee, a `dispose` the runtime runs. Its
 * arguments are any values of its parameters' types, so each requirement is checked against the
 * declaration graph: one that values of those types could break closes a cycle where the function
 * escapes, decided as any cycle is by the less relevant of its holder's and value's types.
 */

import type { Type } from '../../types/type/index.ts';
import type { Input } from './input.ts';
import type { Requirement, Summary, TypedCycle } from './summary.ts';
import {
  type HandleReach,
  lessRelevant,
  mayAlias,
  mayReach,
  mayShare,
  type Relevance,
} from './type-reach.ts';

/** What the check reads of types. */
export interface EscapingFacts {
  readonly relevanceOf: (type: Type) => Relevance;
  readonly reachOf: (type: Type) => HandleReach;
  /** What values of a type surely hold and reach, whatever its type parameters become. */
  readonly knownReachOf: (type: Type) => HandleReach;
}

/**
 * Whether values of `holder`'s and `value`'s types may come to break a requirement of `kind` as
 * the declaration graph allows: the value reach or be the holder's, or the two share anything.
 */
export function typesBreak(
  facts: Pick<EscapingFacts, 'reachOf'>,
  { holder, value }: { readonly holder: Type; readonly value: Type },
  kind: Requirement['kind'],
): boolean {
  const holderReach = facts.reachOf(holder);
  const valueReach = facts.reachOf(value);
  return kind === 'share'
    ? mayShare(valueReach, holderReach)
    : mayReach(valueReach, holderReach) || mayAlias(valueReach, holderReach);
}

/**
 * Of a cycle's holder's and value's types, the one deciding whether it may hold a disposable: the
 * value reaches the holder on it, so it holds one only where both types may reach one.
 */
export function decidingType(facts: EscapingFacts, holder: Type, value: Type): Type {
  return lessRelevant(facts.relevanceOf(value), facts.relevanceOf(holder)) ? value : holder;
}

/**
 * How surely `cycle` holds a disposable: never where its types can't close it, and as each
 * instantiation decides where only what its type parameters become could close it.
 */
export function cycleRelevance(facts: EscapingFacts, cycle: TypedCycle): Relevance {
  const closes = (reachOf: (type: Type) => HandleReach) => {
    const breaks = (value: Type) =>
      typesBreak({ reachOf }, { holder: cycle.holder, value }, cycle.kind);
    return cycle.through.some(breaks) && cycle.sources.every(breaks);
  };
  if (!closes(facts.reachOf)) {
    return 'no';
  }
  const relevance = facts.relevanceOf(cycle.deciding);
  return closes(facts.knownReachOf) || lessRelevant(relevance, 'depends') ? relevance : 'depends';
}

/**
 * The cycles an escaping function's writes may close, its inputs any values of the types `typeOf`
 * gives: one for each requirement values of those types could break, and each always.
 */
export function escapingCycles(
  facts: EscapingFacts,
  summary: Pick<Summary, 'requirements' | 'always'>,
  typeOf: (input: Input) => Type | undefined,
): readonly TypedCycle[] {
  // A part of an input, and a global, name their types themselves.
  const typed = (input: Input) =>
    input.kind === 'path' || input.kind === 'global' ? input.type : typeOf(input);
  // A write closes a cycle only where what is written, and the input it comes from, both may.
  const breaking = summary.requirements.flatMap((requirement): readonly TypedCycle[] => {
    const holder = typed(requirement.holder);
    const source = typed(requirement.value);
    if (holder === undefined || source === undefined) {
      return [];
    }
    const cycle: TypedCycle = {
      holder,
      through: [requirement.valueType ?? source],
      sources: [source],
      kind: requirement.kind,
      deciding: decidingType(facts, requirement.holderType, requirement.valueType ?? source),
    };
    return cycleRelevance(facts, cycle) === 'no' ? [] : [cycle];
  });
  return [...breaking, ...summary.always];
}
