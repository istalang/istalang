/**
 * Emitting calls: the ones checking resolved at a site, and the ones the language makes for a
 * construct with no call written (`ImplicitRole`, resolution/applying/implicit.ts), where the
 * construct makes them, with the arguments lowering passes them (lowering/calls/emit-call.ts
 * `emitImplicitCall`). One checking resolved no function for runs its arguments, a place passed
 * by `&` read where it stands (`valueAt`), and gives what is unknown.
 */

import type { Expression } from '../../../../syntax/expressions/index.ts';
import { placePath } from '../../../../syntax/expressions/places.ts';
import type { NodeOf } from '../../../../syntax/tree/node.ts';
import type { Argument, Place, ValueId } from '../../../surface/flow-ir.ts';
import type { ImplicitRole, ResolvedCall } from '../../../surface/resolved-call.ts';
import { callSubstitution } from '../../../surface/witness-closing.ts';
import { substitute } from '../../../types/parts/substitution.ts';
import type { Type } from '../../../types/type/index.ts';
import type { FlowBuilder } from './flow-builder.ts';

/** Where a call is made, what it passes, and the value its result goes into, if not a new one. */
interface CallSite {
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
  { site, passed, into = builder.temporary(site, call && resultOf(builder, call)) }: CallSite,
): ValueId {
  const arguments_ = passed.map(asArgument);
  if (call === undefined) {
    const operands = arguments_.map((each) =>
      each.kind === 'value' ? each.value : valueAt(builder, each.place),
    );
    builder.emit({ op: 'unknown', site, into, operands });
  } else {
    builder.emit({ op: 'call', site, into, call, role, arguments: arguments_ });
  }
  return into;
}

/** What calling `call` gives, its function's result as the call instantiates it. */
function resultOf({ inputs: { checker } }: FlowBuilder, call: ResolvedCall): Type {
  return substitute(checker.resultOf(call.function), callSubstitution(call), checker.typeRules);
}

function asArgument(passed: ValueId | Argument): Argument {
  return typeof passed === 'number' ? { kind: 'value', value: passed } : passed;
}

/**
 * The value `place` holds now, read: a variable read at its name, then the part its path reaches,
 * each read of the type of the expression it ends at, its place's last parts being the last levels
 * of the place its site names.
 */
export function valueAt(builder: FlowBuilder, place: Place): ValueId {
  let value = place.root;
  if (builder.valueOf(value).kind === 'variable') {
    value = builder.read(place.root, place.name ?? place.site, builder.valueOf(place.root).type);
  }
  const { root, steps } = placePath(place.site);
  const levels = [root, ...steps].slice(-place.path.length);
  for (const [index, part] of place.path.entries()) {
    const read = builder.temporary(place.site, builder.body.typeOf(levels[index] as Expression));
    builder.emit({ op: 'read', site: place.site, into: read, from: value, part });
    value = read;
  }
  return value;
}
