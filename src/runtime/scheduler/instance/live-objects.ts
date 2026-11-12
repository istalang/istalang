/**
 * The two forms of a heap object: as a snapshot stores it, and as a running instance holds it. Only
 * an execution differs: its frames are live (interpreter/frames.ts), their registers a dense array
 * and their code resolved, and its call future is optional rather than absent.
 */

import type { Definition } from '../../../definition/definition.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ActiveFrame, FrameHeap } from '../../interpreter/frames.ts';
import { newFrame } from '../../interpreter/machine.ts';
import { placeContents } from '../../interpreter/registers.ts';
import type { Frame, HeapObject, RegisterContents } from '../../snapshot/objects.ts';
import type { LiveObject } from './heap.ts';

/** A snapshot's object as the running instance holds it: an execution's frames made live. */
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
  for (const [register, contents] of frame.registers) {
    placeContents(live, register, contents);
  }
  live.pc = frame.pc;
  return live;
}

export function storedObject(object: LiveObject): HeapObject {
  if (object.kind !== 'execution') {
    return object;
  }
  const { resolves, ...rest } = object;
  return {
    ...rest,
    ...(resolves === undefined ? {} : { resolves }),
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
