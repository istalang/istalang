/**
 * Where frames are, as people read it: one line per frame, innermost first, naming the function
 * and the source location of the instruction it is at (§3.12). The runtime has no source text, so
 * a location comes from the span and its module's line starts (docs/arch/definition.md, "Types and
 * locations"); lines and columns count from 1, as editors show them.
 */

import type { Definition } from '../../definition/definition.ts';
import type { ActiveFrame } from './machine.ts';

/** The trace of `frames`, innermost first. */
export function traceOf(definition: Definition, frames: readonly ActiveFrame[]): string {
  return frames
    .map((frame) => {
      const offset = frame.code.instructions[frame.pc]?.span.start ?? frame.code.span.start;
      return `at ${frame.code.name} (${locationOf(definition, frame.code.module, offset)})`;
    })
    .join('\n');
}

/** `module:line:column` of an offset in a module's source. */
export function locationOf(definition: Definition, module: number, offset: number): string {
  const { id, lineStarts } = definition.modules[module] ?? { id: '?', lineStarts: [0] };
  const line = lineStarts.findLastIndex((start) => start <= offset);
  const column = offset - (lineStarts[line] ?? 0);
  return `${id}:${line + 1}:${column + 1}`;
}
