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
  /**
   * Notes that a frame no longer holds `contents`, which may have held something's last handle. A
   * reference never does: it borrows a cell its caller holds for the whole call.
   */
  readonly released: (contents: RegisterContents) => void;
}

/** A code entry a frame runs: its index, its code, and whether its result arrives from a mock. */
export interface FrameEntry {
  readonly function: FunctionId;
  readonly code: CodeFunction;
  readonly arrives?: true;
}

export interface ActiveFrame {
  readonly function: FunctionId;
  readonly code: CodeFunction;
  pc: number;
  readonly registers: (RegisterContents | undefined)[];
  readonly heap: FrameHeap;
  /** Set when the frame runs a mock's replacement in its own instance, so its result arrives. */
  readonly arrives?: true;
}
