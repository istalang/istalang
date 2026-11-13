/**
 * A call through an `any` value, a union or a computed type (design.md §5.4): what each witness
 * it may run does, over the required function's parameters, joined and applied as one call's.
 * The joined summary is kept per call and joined again only once a witness's summary is another:
 * a call runs at every pass over its loop and every round of its group, and joining up to a
 * hundred witnesses' summaries each time cost more than applying them.
 */

import { sameItems } from '../../../../../foundation/structures/equality.ts';
import type { FunctionCall, RequirementCall } from '../../../surface/resolved-call.ts';
import type { Operation } from '../../flow/flow-ir.ts';
import { boundBy, joinedSummaries } from '../composition.ts';
import type { Summary } from '../summary.ts';
import { type At, functionBindings } from './bindings.ts';
import { applySummary } from './calls.ts';
import { withDefaults } from './given.ts';

/**
 * A call through an `any` value (design.md §5.4): what each of the witnesses it may run does,
 * over the required function's parameters, joined, applied as one call's.
 */
export function dispatchedCall(
  at: At,
  operation: Extract<Operation, { op: 'call' }>,
  call: RequirementCall,
  witnesses: readonly FunctionCall[],
): void {
  const { into, site, arguments: args } = operation;
  const isAsync = witnesses.some((witness) => witness.function.qualifiers.async !== undefined);
  const made = { site, into, callee: undefined, call: undefined, isAsync };
  const bindings = withDefaults(at, operation, functionBindings(at, call, args));
  applySummary(at, made, dispatchedSummary(at, call, witnesses), bindings);
}

/** The last summary each call through `any` was given, and the witnesses' it was joined from. */
const dispatched = new WeakMap<
  RequirementCall,
  {
    readonly witnesses: readonly FunctionCall[];
    readonly summaries: readonly (Summary | undefined)[];
    readonly joined: Summary;
  }
>();

/**
 * What `call`'s witnesses do, joined over its parameters: joined again only once a witness's
 * summary is another, since a call runs at every pass over its loop, and a group's every round.
 */
function dispatchedSummary(
  { analysis: { context } }: At,
  call: RequirementCall,
  witnesses: readonly FunctionCall[],
): Summary {
  const summaries = witnesses.map((witness) => context.calleeSummary(witness));
  const last = dispatched.get(call);
  if (
    last !== undefined &&
    sameItems<FunctionCall>()(last.witnesses, witnesses) &&
    sameItems<Summary | undefined>()(last.summaries, summaries)
  ) {
    return last.joined;
  }
  const joined = joinedSummaries(
    witnesses.flatMap((witness, index) => {
      const summary = summaries[index];
      return summary === undefined
        ? []
        : [boundBy(summary, witness.binding, (type) => context.substitute(type, witness))];
    }),
  );
  dispatched.set(call, { witnesses, summaries, joined });
  return joined;
}
