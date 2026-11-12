/**
 * Emitting calls: the ones checking resolved at a site, and the ones the language makes for a
 * construct with no call written (`ImplicitRole`, resolution/applying/implicit.ts), where the
 * construct makes them, with the arguments lowering passes them (lowering/calls/emit-call.ts
 * `emitImplicitCall`). One checking resolved no function for runs its arguments, a place passed
 * by `&` read where it stands, and gives what is unknown.
 */

import type { NodeOf } from '../../../../syntax/tree/node.ts';
import type { ImplicitRole, ResolvedCall } from '../../../surface/resolved-call.ts';
import type { Argument, ValueId } from '../flow-ir.ts';
import type { FlowBuilder } from './flow-builder.ts';

/** Where a call is made, what it passes, and the value its result goes into, if not a new one. */
export interface CallSite {
  readonly site: NodeOf<string>;
  readonly passed: readonly (ValueId | Argument)[];
  readonly into?: ValueId | undefined;
}

/** The call `at.site` makes in `role`; the value its result is in. */
export function implicitCall(builder: FlowBuilder, role: ImplicitRole, at: CallSite): ValueId {
  return emitCall(builder, builder.body.implicitCallOf(at.site, role), role, at);
}

/** `call`, which checking resolved at `at.site`; the value its result is in. */
export function resolvedCall(
  builder: FlowBuilder,
  call: ResolvedCall | undefined,
  at: CallSite,
): ValueId {
  return emitCall(builder, call, undefined, at);
}

function emitCall(
  builder: FlowBuilder,
  call: ResolvedCall | undefined,
  role: ImplicitRole | undefined,
  { site, passed, into = builder.temporary(site, undefined) }: CallSite,
): ValueId {
  const arguments_ = passed.map(asArgument);
  if (call === undefined) {
    const operands = arguments_.map((each) =>
      each.kind === 'value' ? each.value : builder.valueAt(each.place),
    );
    builder.emit({ op: 'unknown', site, into, operands });
  } else {
    builder.emit({ op: 'call', site, into, call, role, arguments: arguments_ });
  }
  return into;
}

function asArgument(passed: ValueId | Argument): Argument {
  return typeof passed === 'number' ? { kind: 'value', value: passed } : passed;
}
