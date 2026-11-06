/**
 * Where frames are, as people read it: one line per frame, innermost first, naming the function
 * and the source location of the instruction it is at (§3.12). The runtime has no source text, so
 * a location comes from the span and its module's line starts (docs/arch/definition.md, "Types and
 * locations"); lines and columns count from 1, as editors show them.
 */

import type { Definition } from '../../definition/definition.ts';
import { positionIn } from '../../text/line-map.ts';
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
 * The trace of the code a default gives its value to (§3.1, §3.12): `frames` without the
 * innermost when its entry gives a default, so a default inlined into its caller leaves none out.
 */
export function callerTraceOf(definition: Definition, frames: readonly TracedFrame[]): string {
  const [innermost, ...callers] = frames;
  return traceOf(definition, innermost?.code.givesDefault === true ? callers : frames);
}

/** `module:line:column` of an offset in a module's source. */
export function locationOf(definition: Definition, module: number, offset: number): string {
  const { id, lineStarts } = definition.modules[module] ?? { id: '?', lineStarts: [0] };
  const { line, column } = positionIn(lineStarts, offset);
  return `${id}:${line + 1}:${column + 1}`;
}
