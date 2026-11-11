/**
 * A frame is data, as a snapshot stores it (docs/arch/definition.md, "Frames"): a function, a pc
 * and registers. The pc of a frame that has called another stays on its `call` until the callee
 * returns, so a frame's pc always says where it is. A live frame also carries the instance's heap,
 * which its cell and reference registers reach (registers.ts); it isn't part of what a snapshot
 * stores.
 */

import type { FunctionId, TypeId } from '../../definition/operands.ts';
import type { CodeFunction } from '../../definition/tables/functions.ts';
import type { Value } from '../../definition/values/values.ts';
import type { RegisterContents } from '../snapshot/objects.ts';

/** The instance's heap as frames reach it: the cells their registers name, and what they let go. */
export interface FrameHeap {
  readonly read: (cell: number) => Value;
  readonly write: (cell: number, value: Value) => void;
  /**
   * A new cell of type entry `type` (a shared struct's or a `_Cell<T>`) holding `value`; its id.
   */
  readonly create: (type: TypeId, value: Value) => number;
  /** The instance's value of the context constant `name`, once made (spec §3.4). */
  readonly contextConstant: (name: string) => Value | undefined;
  /** Makes `value` the instance's value of the context constant `name`, kept from now on. */
  readonly makeContextConstant: (name: string, value: Value) => void;
  /**
   * Notes that a frame no longer holds `contents`, which may have held something's last handle. A
   * reference never does: it borrows a cell its caller holds for the whole call.
   */
  readonly released: (contents: RegisterContents) => void;
}

/**
 * A code entry a frame runs: its index, its code, whether its result arrives from a mock, and
 * whether it runs only its prologue, computing what a call left out, to hand the call over to the
 * mock replacing it where its body begins (§10, scheduler/segment/calls.ts).
 */
export interface FrameEntry {
  readonly function: FunctionId;
  readonly code: CodeFunction;
  readonly arrives?: true;
  readonly handsOver?: true;
}

export interface ActiveFrame {
  readonly function: FunctionId;
  readonly code: CodeFunction;
  pc: number;
  readonly registers: (RegisterContents | undefined)[];
  readonly heap: FrameHeap;
  /** Set when the frame runs a mock's replacement in its own instance, so its result arrives. */
  readonly arrives?: true;
  /** Set when the frame runs its prologue for a mock, which takes the call over at its body. */
  readonly handsOver?: true;
}
