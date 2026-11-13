/**
 * A call on a union's trait, or on a computed type an instantiation made known (design.md §5.4):
 * what each member's witness does, over the required function's parameters, joined and applied as
 * one call's. A union names few members, so the join is made where the call runs.
 */

import type { Operation } from '../../../surface/flow-ir.ts';
import type { FunctionCall, RequirementCall } from '../../../surface/resolved-call.ts';
import { boundBy, joinedSummaries } from '../composition.ts';
import { type At, functionBindings } from './bindings.ts';
import { applySummary } from './calls.ts';
import { withDefaults } from './given.ts';

/** `operation`, a call through `call`'s requirement, as a call of each of `witnesses`. */
export function dispatchedCall(
  at: At,
  operation: Extract<Operation, { op: 'call' }>,
  call: RequirementCall,
  witnesses: readonly FunctionCall[],
): void {
  const { into, site, arguments: args } = operation;
  const { context } = at.analysis;
  const isAsync = witnesses.some((witness) => witness.function.qualifiers.async !== undefined);
  const made = { site, into, callee: undefined, call: undefined, isAsync };
  const bindings = withDefaults(at, operation, functionBindings(at, call, args));
  const joined = joinedSummaries(
    witnesses.flatMap((witness) => {
      const summary = context.calleeSummary(witness);
      return summary === undefined
        ? []
        : [boundBy(summary, witness.binding, (type) => context.substitute(type, witness))];
    }),
  );
  applySummary(at, made, joined, bindings);
}
