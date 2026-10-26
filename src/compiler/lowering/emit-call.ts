/**
 * The one place lowering writes a `call` instruction (docs/arch/definition.md, "Calls"): to a
 * function-table entry or a function value, with each argument a value or a place passed by `&`.
 * What a call targets is decided by its caller: a call site's resolved function or the value it
 * calls (expressions/calls.ts), an element step's `index` (places.ts), a defaults entry's full
 * function (function-lowering/).
 */

import type { Callee } from '../../definition/instructions/calls.ts';
import type { Argument } from '../../definition/instructions/places.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Span } from '../../text/span.ts';
import type { CodeContext } from './context.ts';

/** A call to write: where it is written, what it calls, and its arguments. */
export interface CallToEmit {
  readonly span: Span;
  /** A function-table entry, or a callee as the Definition writes it. */
  readonly callee: FunctionId | Callee;
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
    callee:
      typeof call.callee === 'number' ? { kind: 'function', function: call.callee } : call.callee,
    arguments: call.arguments.map((each) =>
      typeof each === 'number' ? { kind: 'value', register: each } : each,
    ),
  });
  return dst;
}

/** A register's whole value passed by `&`. */
export function referenceTo(register: Register): Argument {
  return { kind: 'reference', place: { register, path: [] } };
}
