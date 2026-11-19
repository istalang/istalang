/**
 * Where frames are, as people read it (§12): one line per frame, innermost first, naming the
 * function and the source location it stands at. Traces are printed here alone, whatever keeps the
 * frames, so a trace reads the same wherever it is printed.
 *
 * A runtime has no source text, so a location comes from an offset and its module's line starts
 * (docs/arch/definition.md, "Types and locations"); lines and columns count from 1, as editors show
 * them.
 */

import { positionIn } from '../foundation/text/line-map.ts';
import type { Definition } from './tables/index.ts';

/** What a trace reads of a frame: its function, where it stands, and whether in its prologue. */
export interface TracedFrame {
  readonly name: string;
  readonly module: number;
  /** The offset in its module's source of the instruction it is at. */
  readonly offset: number;
  /** Whether it is computing a default, before its body begins (§6.1). */
  readonly inPrologue: boolean;
}

/** What locating an offset reads of a program: its modules' line starts. */
type Located = Pick<Definition, 'modules'>;

/** The trace of `frames`, innermost first. */
export function traceText(program: Located, frames: readonly TracedFrame[]): string {
  return frames
    .map((frame) => `at ${frame.name} (${locationOf(program, frame.module, frame.offset)})`)
    .join('\n');
}

/**
 * The trace of the code a default gives its value to (§5.2, §12): `frames` without the innermost
 * while it computes a default in its prologue, so the call or literal leaving the default out is
 * the trace's first frame; any other innermost frame is kept.
 */
export function callerTraceText(program: Located, frames: readonly TracedFrame[]): string {
  const [innermost, ...callers] = frames;
  return traceText(program, innermost?.inPrologue === true ? callers : frames);
}

/** `module:line:column` of an offset in a module's source. */
export function locationOf(program: Located, module: number, offset: number): string {
  const { id, lineStarts } = program.modules[module] ?? { id: '?', lineStarts: [0] };
  const { line, column } = positionIn(lineStarts, offset);
  return `${id}:${line + 1}:${column + 1}`;
}
