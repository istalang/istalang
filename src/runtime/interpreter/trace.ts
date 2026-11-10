/**
 * Where frames are, as people read it: one line per frame, innermost first, naming the function
 * and the source location of the instruction it is at (§3.12). The runtime has no source text, so
 * a location comes from the span and its module's line starts (docs/arch/definition.md, "Types and
 * locations"); lines and columns count from 1, as editors show them.
 */

import type { Definition } from '../../definition/definition.ts';
import { bodyStart } from '../../definition/tables/functions.ts';
import { positionIn } from '../../foundation/text/line-map.ts';
import type { ActiveFrame } from './frames.ts';

/** What a trace reads of a frame: its entry, and the instruction it is at. */
type TracedFrame = Pick<ActiveFrame, 'code' | 'pc'>;

/** The trace of `frames`, innermost first. */
export function traceOf(definition: Definition, frames: readonly TracedFrame[]): string {
  return frames
    .map((frame) => {
      const offset = frame.code.instructions[frame.pc]?.span.start ?? frame.code.span.start;
      return `at ${frame.code.name} (${locationOf(definition, frame.code.module, offset)})`;
    })
    .join('\n');
}

/**
 * The trace of the code a default gives its value to (§3.1, §3.12): `frames` without the innermost
 * while it computes a default in its prologue, before its body begins (§3.3), so the call or
 * literal leaving the default out is the trace's first frame; any other innermost frame is kept.
 */
export function callerTraceOf(definition: Definition, frames: readonly TracedFrame[]): string {
  const [innermost, ...callers] = frames;
  const inPrologue = innermost !== undefined && innermost.pc < bodyStart(innermost.code);
  return traceOf(definition, inPrologue ? callers : frames);
}

/** `module:line:column` of an offset in a module's source. */
export function locationOf(definition: Definition, module: number, offset: number): string {
  const { id, lineStarts } = definition.modules[module] ?? { id: '?', lineStarts: [0] };
  const { line, column } = positionIn(lineStarts, offset);
  return `${id}:${line + 1}:${column + 1}`;
}
