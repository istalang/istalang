/**
 * What a trace reads of an interpreter frame (definition/traces.ts): its entry's name and module,
 * the span of the instruction it is at, and whether that is still in its prologue.
 */

import { bodyStart } from '../../definition/tables/functions.ts';
import type { TracedFrame } from '../../definition/traces.ts';
import type { ActiveFrame } from './frames.ts';

/** `frame` as a trace reads it. */
export function tracedFrame({ code, pc }: Pick<ActiveFrame, 'code' | 'pc'>): TracedFrame {
  return {
    name: code.name,
    module: code.module,
    offset: code.instructions[pc]?.span.start ?? code.span.start,
    inPrologue: pc < bodyStart(code),
  };
}
