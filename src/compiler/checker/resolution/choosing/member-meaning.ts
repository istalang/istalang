/**
 * What a member's name means through a receiver (§3.1, §3.7): one answer for a read (`x.f`), a call
 * (`x.f(…)`) and what tools list (lookup/members.ts). The functions are those candidates.ts finds
 * through the receiver, a call on a union through a trait only where the union meets it
 * (conformance/trait-calls.ts), each kept where its `self` takes the receiver: with the type
 * parameters that decides meeting their constraints (`met`), or not (`unmet`), which a use finding
 * nothing else reports as their call would (receivers.ts `selfTaking`). Beside them, the keyed
 * indexes taking the receiver (keyed-indexes.ts), which serve the names their keys are (§3.9). A
 * read or a call looks up one name, a listing every one, from the same sources.
 */

import type { ModuleId } from '../../../program/program.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { FoundField } from '../../surface/checked-field.ts';
import { fieldOf } from '../../types/traits/known-fields.ts';
import type { Type } from '../../types/type/index.ts';
import { metThroughTraits } from '../conformance/trait-calls.ts';
import {
  type Candidate,
  receiverCandidates,
  receiverMembers,
  topLevelCandidates,
} from './candidates.ts';
import { type KeyedIndex, keyedIndexes, servesName } from './keyed-indexes.ts';
import { selfTaking } from './receivers.ts';

/** The functions taking a receiver as `self`, by whether their constraints hold for it. */
export interface Taking {
  readonly met: readonly Candidate[];
  readonly unmet: readonly Candidate[];
}

/**
 * The methods, called `x.f(…)`, and the getters, read `x.f`, taking a receiver as `self`, and the
 * keyed indexes, read `x.k` for a key `k` (§3.9).
 */
export interface TakingMembers {
  readonly methods: Taking;
  readonly getters: Taking;
  readonly keyed: readonly KeyedIndex[];
}

/**
 * What `x.name` may mean on a receiver: its field of the name, its methods and getters, and the
 * keyed indexes taking the name as a key.
 */
export interface NamedMembers extends TakingMembers {
  readonly field: FoundField | undefined;
}

/** What `x.name` may mean on a receiver of type `receiver`, written in `module`. */
export function membersNamed(
  checker: CheckerContext,
  module: ModuleId,
  name: string,
  receiver: Type,
): NamedMembers {
  return {
    field: fieldOf(checker, receiver, name),
    ...calledTaking(checker, topLevelCandidates(checker, module, name, [receiver]), receiver),
    keyed: keyedIndexes(checker, module, receiver).filter((each) =>
      servesName(checker, each, name),
    ),
  };
}

/**
 * The methods of `name` a call `x.name(…)` written in `module` may choose, its receiver's type the
 * first of `argumentTypes`: those the other arguments' types find too (§3.13).
 */
export function methodsNamed(
  checker: CheckerContext,
  module: ModuleId,
  name: string,
  argumentTypes: readonly [Type, ...(Type | undefined)[]],
): Taking {
  const [receiver] = argumentTypes;
  const candidates = topLevelCandidates(checker, module, name, argumentTypes);
  return calledTaking(checker, candidates, receiver).methods;
}

/** Every method and getter of a receiver of type `receiver` seen from `module`, whatever its name. */
export function everyMember(
  checker: CheckerContext,
  module: ModuleId,
  receiver: Type,
): TakingMembers {
  return {
    ...calledTaking(checker, receiverCandidates(checker, module, receiver), receiver),
    keyed: keyedIndexes(checker, module, receiver),
  };
}

/** The methods and getters among `candidates` taking a receiver of type `receiver`. */
function calledTaking(
  checker: CheckerContext,
  candidates: readonly Candidate[],
  receiver: Type,
): Omit<TakingMembers, 'keyed'> {
  const { methods, getters } = receiverMembers(metThroughTraits(checker, candidates));
  return {
    methods: taking(checker, methods, receiver),
    getters: taking(checker, getters, receiver),
  };
}

function taking(checker: CheckerContext, candidates: readonly Candidate[], receiver: Type): Taking {
  const byTaking = Map.groupBy(
    candidates,
    (candidate) => selfTaking(checker, candidate, receiver) ?? 'none',
  );
  return { met: byTaking.get('met') ?? [], unmet: byTaking.get('unmet') ?? [] };
}
