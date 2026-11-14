/**
 * Transient variables as an instance runs them (spec §3.4): the outermost call of a function makes
 * a transient's cell, and every call nested in it shares it, in the same execution or another.
 *
 * - No table: a frame's transient register holds the cell, and an execution keeps the cells visible
 *   where it started (`transientsSeenFrom`): its caller execution's own and those the caller's
 *   frames hold. A call finds the cell however its execution began, an async one's after its caller
 *   has returned included, and a restore has nothing to rebuild.
 * - A call looks to the nearest frame of its execution running the same function whose register
 *   holds a cell, then to what its execution keeps. Every frame of one function in one execution
 *   shares one cell, so the nearest is as good as the outermost.
 */

import type { Register } from '../../../definition/operands.ts';
import { transientRegistersOf } from '../../../definition/tables/functions.ts';
import { handleTarget } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ActiveFrame } from '../../interpreter/frames.ts';
import { isReference, type TransientCell } from '../../snapshot/objects.ts';
import type { LiveExecution } from './heap.ts';

/**
 * The cell of the transient in `frame`'s `register` that a call `frame` is nested in shares, of the
 * same function; undefined where none has one, so `frame` makes it.
 */
export function sharedTransient(
  execution: LiveExecution,
  frame: ActiveFrame,
  register: Register,
): number | undefined {
  const position = execution.frames.lastIndexOf(frame);
  if (position === -1) {
    unreachable(`A frame of ${frame.code.name} shares a transient outside its execution.`);
  }
  const caller = execution.frames
    .slice(0, position)
    .findLast((each) => each.function === frame.function && each.registers[register] !== undefined);
  if (caller !== undefined) {
    return cellIn(caller, register);
  }
  const kept = execution.transients.find(
    (each) => each.function === frame.function && each.register === register,
  );
  return kept?.cell;
}

/**
 * The transients' cells an execution started from `caller` keeps: those `caller` keeps, and its
 * frames' own; none for one started from outside any execution.
 */
export function transientsSeenFrom(caller: LiveExecution | undefined): readonly TransientCell[] {
  if (caller === undefined) {
    return [];
  }
  const held = caller.frames.flatMap((frame) =>
    transientRegistersOf(frame.code).flatMap((register) =>
      frame.registers[register] === undefined
        ? []
        : [{ function: frame.function, register, cell: cellIn(frame, register) }],
    ),
  );
  if (held.length === 0) {
    return caller.transients;
  }
  const byTransient = new Map(
    [...caller.transients, ...held].map((each) => [`${each.function}:${each.register}`, each]),
  );
  return [...byTransient.values()];
}

/** The cell `frame`'s transient `register` holds a handle to. */
function cellIn(frame: ActiveFrame, register: Register): number {
  const contents = frame.registers[register];
  const cell = contents === undefined || isReference(contents) ? undefined : handleTarget(contents);
  return (
    cell ?? unreachable(`Register ${register} of ${frame.code.name} holds no transient's cell.`)
  );
}
