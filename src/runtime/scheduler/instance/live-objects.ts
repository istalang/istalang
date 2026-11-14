/**
 * The two forms of a heap object: as a snapshot stores it, and as a running instance holds it. Only
 * an execution differs: its frames are live (interpreter/frames.ts), their registers a dense array
 * and their code resolved, and its call future is optional rather than absent.
 *
 * A restored frame's registers are filled as any register is written (interpreter/registers.ts),
 * reporting what they hold, once every object of the heap is in it (`restoreRegisters`): a register
 * may hold an object made after its execution.
 */

import type { Definition } from '../../../definition/definition.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ActiveFrame, FrameHeap } from '../../interpreter/frames.ts';
import { newFrame } from '../../interpreter/machine.ts';
import { placeContents } from '../../interpreter/registers.ts';
import type { Frame, HeapObject, RegisterContents } from '../../snapshot/objects.ts';
import type { LiveObject } from './heap.ts';

/**
 * A snapshot's object as the running instance holds it: an execution's frames made live, their
 * registers empty until `restoreRegisters` fills them.
 */
export function liveObject(
  definition: Definition,
  object: HeapObject,
  heap: FrameHeap,
): LiveObject {
  if (object.kind !== 'execution') {
    return object;
  }
  return {
    ...object,
    resolves: object.resolves,
    frames: object.frames.map((frame) => liveFrame(definition, frame, heap)),
    transients: object.transients ?? [],
  };
}

function liveFrame(definition: Definition, frame: Frame, heap: FrameHeap): ActiveFrame {
  const code = definition.functions[frame.function];
  if (code?.kind !== 'code') {
    unreachable(`Frame function ${frame.function} is not code; loading checks this.`);
  }
  const live = newFrame(
    { function: frame.function, code, ...(frame.arrives ? { arrives: frame.arrives } : {}) },
    [],
    heap,
  );
  live.pc = frame.pc;
  return live;
}

/** Fills the registers of `live`, made by `liveObject` from `stored`, with what `stored`'s hold. */
export function restoreRegisters(stored: HeapObject, live: LiveObject): void {
  if (stored.kind !== 'execution' || live.kind !== 'execution') {
    return;
  }
  stored.frames.forEach((frame, position) => {
    const restored = live.frames[position];
    if (restored === undefined) {
      unreachable(`Execution ${live.id} has no frame ${position} to restore.`);
    }
    for (const [register, contents] of frame.registers) {
      placeContents(restored, register, contents);
    }
  });
}

export function storedObject(object: LiveObject): HeapObject {
  if (object.kind !== 'execution') {
    return object;
  }
  const { resolves, transients, ...rest } = object;
  return {
    ...rest,
    ...(resolves === undefined ? {} : { resolves }),
    ...(transients.length === 0 ? {} : { transients: [...transients] }),
    frames: object.frames.map((frame) => ({
      function: frame.function,
      pc: frame.pc,
      registers: frame.registers.flatMap((contents, register) =>
        contents === undefined ? [] : [[register, contents] as [number, RegisterContents]],
      ),
      ...(frame.arrives ? { arrives: frame.arrives } : {}),
    })),
  };
}
