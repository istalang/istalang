/**
 * What an instruction handler sees of the running execution, as an interface, so the instruction
 * table depends on it and not on the class that runs the loop (scheduler/segment/); and a frame's
 * life (frames.ts): made at its entry with its parameters, moved past what it stood at, and
 * letting go of what it held as it ends. A handler reads and writes the frame's registers directly
 * (registers.ts).
 */

import type { Definition } from '../../definition/definition.ts';
import type { Argument } from '../../definition/instructions/places.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { isReference, type RegisterContents } from '../snapshot/objects.ts';
import type { ActiveFrame, FrameEntry, FrameHeap } from './frames.ts';
import {
  capturedContents,
  clearRegister,
  givesEvery,
  type Passed,
  placeContents,
  writeRegister,
} from './registers.ts';
import type { Decision } from './suspension.ts';

export interface Machine {
  readonly definition: Definition;
  /**
   * Calls entry `callee` from `frame`'s current `call`, whose `dst` receives the result; a
   * closure's call passes the values it captured.
   */
  readonly call: (
    frame: ActiveFrame,
    callee: FunctionId,
    argumentList: readonly Argument[],
    captures?: readonly Value[],
  ) => void;
  /** Returns `value` from `frame`, the top frame. */
  readonly return: (frame: ActiveFrame, value: Value) => void;
  /** A handle to a new wait of the running execution (proposal 8, Rule 5). */
  readonly openWait: () => Value;
  /** A handle to a new resolver of the wait `wait` names, for its case `position`. */
  readonly resolver: (wait: Value, position: number) => Value;
  /**
   * Waits at the top frame's `await` or blocking `select` on the wait its register holds. The
   * frame stays there until it is decided; resuming moves it on (suspension.ts).
   */
  readonly wait: () => void;
  /**
   * Ends the wait of the non-blocking `select` the top frame stands at, deciding nothing more; its
   * decision, once it was decided.
   */
  readonly endWait: () => Decision | undefined;
  /** A handle to the weak reference to the running async call, for `worker.disposing()` (§7). */
  readonly currentCall: () => Value;
  /**
   * Hands the call `frame` runs over to the mock replacing it, `frame` having run its prologue to
   * compute what the call left out (frames.ts `FrameEntry`): the replacement takes its place.
   */
  readonly handOver: (frame: ActiveFrame) => void;
}

/**
 * A frame about to run entry `function` from its start, its parameters holding `contents`: values,
 * and references for reference parameters. A parameter the call left out, or passed nothing for,
 * as a function value's call of a shorter type doesn't, stays empty for the prologue to compute
 * (§3.3). A closure's captures follow the parameters as the closure carries them: a captured cell
 * stays the closure's cell, shared with where it came from.
 */
export function newFrame(
  entry: FrameEntry,
  contents: readonly Passed[],
  heap: FrameHeap,
  captures: readonly Value[] = [],
): ActiveFrame {
  const { code, arrives, handsOver } = entry;
  const frame: ActiveFrame = {
    function: entry.function,
    code,
    pc: 0,
    registers: Array.from({ length: code.registers }),
    heap,
    ...(arrives ? { arrives } : {}),
    ...(handsOver ? { handsOver } : {}),
  };
  contents.forEach((each, index) => {
    if (each !== undefined && isReference(each)) {
      placeContents(frame, index, each);
    } else if (each !== undefined) {
      writeRegister(frame, index, each);
    }
  });
  const first = code.parameters.length;
  captures.forEach((each, index) => {
    placeContents(frame, first + index, each);
  });
  return frame;
}

/** What `frame`'s parameters hold, every one given once its prologue has run. */
export function parameterContents(frame: ActiveFrame): readonly RegisterContents[] {
  const contents = frame.registers.slice(0, frame.code.parameters.length);
  if (!givesEvery(contents)) {
    unreachable(
      `${frame.code.name} reached its body with a parameter its prologue never computed.`,
    );
  }
  return contents;
}

/** The closure `frame` runs: its function, with its captures as the closure carried them. */
export function currentClosure(frame: ActiveFrame): Value {
  return { kind: 'closure', function: frame.function, captures: capturesOf(frame) };
}

/** The captures of the closure `frame` runs, after its parameters, as the closure carried them. */
export function capturesOf(frame: ActiveFrame): Value[] {
  const first = frame.code.parameters.length;
  return Array.from({ length: frame.code.captures }, (_, index) =>
    capturedContents(frame, first + index),
  );
}

/** Moves `frame` past the instruction it stood at, which gave `value` to `dst`, if it has one. */
export function resumeAt(frame: ActiveFrame, dst: Register | undefined, value: Value): void {
  if (dst !== undefined) {
    writeRegister(frame, dst, value);
  }
  frame.pc += 1;
}

/** Writes a call's result into the `call` that `frame` stopped at, and moves past it. */
export function resumeAfterCall(frame: ActiveFrame, value: Value): void {
  const instruction = frame.code.instructions[frame.pc];
  if (instruction?.kind !== 'call') {
    unreachable(`Resumed at a ${instruction?.kind ?? 'missing'} instruction, not a call.`);
  }
  resumeAt(frame, instruction.dst, value);
}

/** Lets go of everything `frame`'s registers hold, as it ends. */
export function releaseFrame(frame: ActiveFrame): void {
  for (const register of frame.registers.keys()) {
    clearRegister(frame, register);
  }
}
