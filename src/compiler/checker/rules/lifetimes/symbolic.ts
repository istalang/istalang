/**
 * What a function's summary leaves to each instantiation (design.md §5.4): calls through its type
 * parameters' requirements, which closing (surface/witness-closing.ts) turns into the witnesses an
 * instantiation gives, and what it checks against the declaration graph once types are known.
 *
 * - **A symbolic call** keeps, for each ordered pair of its arguments, what a witness writing the
 *   second into the first would meet in the body: a cycle it closes there (`closes` for a write,
 *   `shares` for a separation), and the pairs of the body's own inputs that write would require
 *   apart (`reach`, `share`). A witness's requirements are read off those pairs, never off its
 *   parameters' types, so a generic call commutes with its instantiated copy.
 * - **By types:** a value of a type not known yet put into an `any` is a bundle of its type's
 *   witnesses escaping, and a requirement called in code nobody sees calls (a closure) is called
 *   with values nobody sees: each is checked against the declaration graph once an instantiation
 *   makes it known (escaping.ts).
 */

import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { RequirementCall } from '../../surface/resolved-call.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import type { AnyType, Type } from '../../types/type/index.ts';
import { type Input, inputKey } from './input.ts';

/** Two inputs a write would require apart: `value` not to reach (or share with) `holder`. */
export interface InputPair {
  readonly holder: Input;
  readonly value: Input;
}

/** What a witness writing argument `value` into argument `holder` meets (the header). */
export interface ArgumentPair {
  readonly holder: number;
  readonly value: number;
  readonly closes: boolean;
  readonly shares: boolean;
  readonly reach: readonly InputPair[];
  readonly share: readonly InputPair[];
}

/** A call through a type parameter's requirement, its arguments as the body had them. */
export interface SymbolicCall {
  readonly call: RequirementCall;
  readonly pairs: readonly ArgumentPair[];
}

/** What an instantiation checks against the declaration graph (the header). */
export type ByTypes =
  | { readonly kind: 'conversion'; readonly member: Type; readonly to: AnyType }
  | { readonly kind: 'call'; readonly call: RequirementCall };

/** `call`, its pairs' inputs each mapped by `mapped`; a pair naming one bound to none goes. */
export function mappedSymbolic(
  call: SymbolicCall,
  mapped: (input: Input) => Input | undefined,
): SymbolicCall {
  const inputPairs = (pairs: readonly InputPair[]) =>
    pairs.flatMap((pair) => {
      const holder = mapped(pair.holder);
      const value = mapped(pair.value);
      return holder === undefined || value === undefined ? [] : [{ holder, value }];
    });
  return {
    call: call.call,
    pairs: call.pairs.map((pair) => ({
      ...pair,
      reach: inputPairs(pair.reach),
      share: inputPairs(pair.share),
    })),
  };
}

/** `checked`, its types mapped by `map`. */
export function mappedByTypes(checked: ByTypes, map: (type: Type) => Type): ByTypes {
  return checked.kind === 'conversion'
    ? { kind: 'conversion', member: map(checked.member), to: map(checked.to) as AnyType }
    : checked;
}

/** `pairs`, each once. */
export function uniquePairs(pairs: readonly InputPair[]): readonly InputPair[] {
  const seen = new Map<string, InputPair>();
  for (const pair of pairs) {
    seen.set(`${inputKey(pair.holder)}>${inputKey(pair.value)}`, pair);
  }
  return [...seen.values()];
}

/** One symbolic call made of `first` and `second`, calls of one requirement: what either meets. */
export function mergedSymbolic(first: SymbolicCall, second: SymbolicCall): SymbolicCall {
  const pairs = new Map<string, ArgumentPair>();
  for (const pair of [...first.pairs, ...second.pairs]) {
    const key = `${pair.holder}>${pair.value}`;
    const known = pairs.get(key);
    pairs.set(
      key,
      known === undefined
        ? pair
        : {
            ...pair,
            closes: known.closes || pair.closes,
            shares: known.shares || pair.shares,
            reach: uniquePairs([...known.reach, ...pair.reach]),
            share: uniquePairs([...known.share, ...pair.share]),
          },
    );
  }
  return { call: first.call, pairs: [...pairs.values()] };
}

/** A key naming the requirement `call` calls, alike for every closing of one call. */
export function symbolicKey(keyOf: (type: Type) => string, call: RequirementCall): string {
  const { requirement } = call;
  const { on } = requirement;
  // A type parameter is named by itself: its key would name its position.
  const called = on.kind === 'TypeParameter' ? on.name.text : keyOf(on);
  return [
    call.function.name.text,
    requirement.kind,
    requirement.member,
    called,
    ...call.typeArguments.map(keyOf),
  ].join('|');
}

const sameInputPairs = sameItems<InputPair>(
  (first, second) =>
    inputKey(first.holder) === inputKey(second.holder) &&
    inputKey(first.value) === inputKey(second.value),
);

/** Whether two requirement calls name one requirement of one function, as spelled. */
function sameRequirementCall(first: RequirementCall, second: RequirementCall): boolean {
  const [one, other] = [first.requirement, second.requirement];
  return (
    first.function === second.function &&
    one.kind === other.kind &&
    one.member === other.member &&
    sameItems(sameTypeSpelled)(first.typeArguments, second.typeArguments) &&
    (one.kind === 'constraint' && other.kind === 'constraint'
      ? one.constraint === other.constraint &&
        (one.on.kind === 'any' ? sameTypeSpelled(one.on, other.on as Type) : one.on === other.on)
      : one.kind !== 'constraint' &&
        other.kind !== 'constraint' &&
        sameTypeSpelled(one.on, other.on) &&
        sameTypeSpelled(one.through, other.through))
  );
}

export const sameSymbolicCalls = sameItems<SymbolicCall>(
  (first, second) =>
    sameRequirementCall(first.call, second.call) &&
    sameItems<ArgumentPair>(
      (one, other) =>
        one.holder === other.holder &&
        one.value === other.value &&
        one.closes === other.closes &&
        one.shares === other.shares &&
        sameInputPairs(one.reach, other.reach) &&
        sameInputPairs(one.share, other.share),
    )(first.pairs, second.pairs),
);

export const sameByTypes = sameItems<ByTypes>((first, second) => {
  if (first.kind === 'conversion') {
    return (
      second.kind === 'conversion' &&
      sameTypeSpelled(first.member, second.member) &&
      sameTypeSpelled(first.to, second.to)
    );
  }
  return second.kind === 'call' && sameRequirementCall(first.call, second.call);
});
