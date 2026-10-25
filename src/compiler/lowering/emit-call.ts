/**
 * The one place lowering writes a `call` instruction (docs/arch/definition.md, "Calls"): to a
 * function-table entry, with each argument a value or a place passed by `&`. Which entry a call
 * targets is decided by its caller: a call site's resolved function (expressions/calls.ts), or an
 * element step's `index` (places.ts).
 */

import type { Argument } from '../../definition/instructions/places.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Span } from '../../text/span.ts';
import type { CodeContext } from './context.ts';

/** A call to write: where it is written, the entry it calls, and its arguments. */
export interface CallToEmit {
  readonly span: Span;
  readonly callee: FunctionId;
  /** Each argument: a register, passed by value, or an argument as the Definition writes it. */
  readonly arguments: readonly (Register | Argument)[];
}

/** Writes `call`; `dst` holds its result. */
export function emitCall(
  context: CodeContext,
  call: CallToEmit,
  dst: Register = context.code.allocate(),
): Register {
  context.code.emit({
    kind: 'call',
    span: call.span,
    dst,
    callee: { kind: 'function', function: call.callee },
    arguments: call.arguments.map((each) =>
      typeof each === 'number' ? { kind: 'value', register: each } : each,
    ),
  });
  return dst;
}
