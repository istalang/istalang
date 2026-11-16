/**
 * A Definition as JavaScript (docs/arch/codegen.md): every code entry a function, run by the run
 * (src/runtime) over its tables.
 *
 * - **One text, two wrappers.** `emitProgram` gives the body of a function of the run, `rt`,
 *   returning the program's entries; a host in process makes it with `new Function`, and `ista
 *   build` wraps it in an ES module importing the run. Nothing else differs.
 * - The body takes the run's helpers into locals once, and binds each extern to its native,
 *   `x<i>`, through the run, which knows the natives table and the host's externs.
 * - Constants that are primitives are written inline; any other is the run's shared table's,
 *   `K[i]`, built once and never changed in place.
 * - Emitting is one pass over the IR, cheap beside checking and lowering, so nothing is cached.
 */

import type { Definition } from '../definition/definition.ts';
import { emitEntry, runsOnFrames } from './entry.ts';

/** The helpers of the run the body reads, as locals. */
const helpers = [
  'hold',
  'share',
  'letGo',
  'equal',
  'mapOf',
  'items',
  'entries',
  'cell',
  'load',
  'store',
  'reference',
  'transient',
  'shareTransient',
  'unshareTransient',
  'contextConstant',
  'makeContextConstant',
  'callValue',
  'start',
  'mocked',
  'unreachableHere',
  'NOT_MOCKED',
  'PARKED',
  'STOPPED',
  'STOP',
] as const;

/** A program's code: the body of a function of the run, and the instruction each line runs. */
export interface EmittedProgram {
  readonly body: string;
  /** For each line of `body`, the entry and instruction it runs, or undefined. */
  readonly lines: readonly (readonly [entry: number, instruction: number] | undefined)[];
}

/** The code of `definition`. */
export function emitProgram(definition: Definition): EmittedProgram {
  const { functions, types, constants } = definition;
  const body: string[] = [];
  const lines: (readonly [number, number] | undefined)[] = [];
  const line = (text: string, at?: readonly [number, number]) => {
    body.push(text);
    lines.push(at);
  };
  line('"use strict";');
  line('const site = new Error();');
  line(`const { ${helpers.join(', ')} } = rt;`);
  line('const K = rt.constants;');
  functions.forEach((entry, index) => {
    if (entry.kind === 'extern') {
      line(`const x${index} = rt.native(${index});`);
    }
  });
  functions.forEach((entry, index) => {
    if (entry.kind !== 'code') {
      return;
    }
    const emitted = emitEntry({
      index,
      entry,
      functions,
      types,
      constants,
      onFrames: runsOnFrames(entry),
    });
    emitted.lines.forEach((text, at) => {
      const instruction = emitted.instructions[at] ?? -1;
      line(text, instruction < 0 ? undefined : [index, instruction]);
    });
  });
  const entries = functions.map((entry, index) =>
    entry.kind === 'code' ? `f${index}` : `x${index}`,
  );
  line(`return { site, entries: [${entries.join(', ')}] };`);
  return { body: body.join('\n'), lines };
}
