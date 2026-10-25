/**
 * Calling a native (architecture: the Natives seam) from a running segment: the context each call
 * gets, built here once for both kinds of caller, a `call` instruction and a disposal's call.
 *
 * A native receives values, never references: an argument passed by `&` is read through its
 * reference, and the native writes a changed value back through the context's `write`, which
 * writes the place the reference names. It reaches the instance's cells through `Shared<T>`
 * handles (§3.8), and the futures it returns through the instance's futures and slots.
 */

import type { FunctionId } from '../../definition/operands.ts';
import { handleTarget, type Value } from '../../definition/values.ts';
import {
  type FrameHeap,
  type RegisterContents,
  readThrough,
  writeReference,
} from '../interpreter/machine.ts';
import type { Native, NativeCells, NativeContext } from '../natives.ts';
import { isReference, type Reference } from '../snapshot/objects.ts';
import type { Instance } from './instance.ts';

export class NativeCalls {
  readonly #instance: Instance;
  readonly #startedAt: bigint;
  readonly #trace: () => string;
  readonly #cells: NativeCells;

  /** Calls within a segment of `instance` started at `startedAt`; `trace` says where it runs. */
  constructor(instance: Instance, startedAt: bigint, trace: () => string) {
    this.#instance = instance;
    this.#startedAt = startedAt;
    this.#trace = trace;
    this.#cells = nativeCellsOf(instance.frameHeap);
  }

  /** Calls `native`, entry `callee`, with what its arguments hold; what it returns. */
  call(callee: FunctionId, native: Native, contents: readonly RegisterContents[]): Value {
    const heap = this.#instance.frameHeap;
    const values = contents.map((each) => (isReference(each) ? readThrough(heap, each) : each));
    return native(values, {
      ...this.#context(callee),
      write: (position, value) => {
        writeReference(heap, referenceAt(contents, position), value);
      },
    });
  }

  #context(callee: FunctionId): Omit<NativeContext, 'write'> {
    const { definition } = this.#instance.loaded;
    const entry = definition.functions[callee];
    if (entry === undefined) {
      throw new RangeError(`No function ${callee}; loading checks every index.`);
    }
    const { futures, slots } = this.#instance;
    return {
      entry,
      types: definition.types,
      segmentStartedAt: this.#startedAt,
      timer: (at) => futures.createHandle({ kind: 'timer', at }),
      resolved: (value) => futures.createHandle({ kind: 'resolved', value }),
      first: (handles) => futures.first(handles),
      slots: {
        create: () => slots.create(),
        operate: (slot, operation, value) => slots.operate(slot, operation, value),
      },
      trace: this.#trace,
      cells: this.#cells,
    };
  }
}

/** The reference a native's argument `position` was passed by `&`. */
function referenceAt(contents: readonly RegisterContents[], position: number): Reference {
  const argument = contents[position];
  if (argument === undefined || !isReference(argument)) {
    throw new Error(`A native wrote argument ${position}, which isn't passed by '&'.`);
  }
  return argument;
}

/** The instance's cells as natives reach them: through `Shared<T>` handles (§3.8). */
function nativeCellsOf(cells: FrameHeap): NativeCells {
  return {
    create: (type, value) => ({ kind: 'handle', object: cells.create(type, value) }),
    read: (cell) => cells.read(cellIdOf(cell)),
    write: (cell, value) => {
      cells.write(cellIdOf(cell), value);
    },
  };
}

function cellIdOf(cell: Value): number {
  const id = handleTarget(cell);
  if (id === undefined) {
    throw new TypeError('A Shared value holds no cell.');
  }
  return id;
}
