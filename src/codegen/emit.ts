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

import type { Definition } from '../definition/tables/index.ts';
import { closureCallHelper, directCallArities, runsOnFrames } from './calling-convention.ts';
import { emitEntry } from './entry.ts';

/**
 * The helpers the body takes into locals, by the part of the run (runtime/run/run.ts) holding them;
 * `key: local` names a local apart from its key.
 */
const helpers = [
  [
    'rt',
    [
      'equal',
      'mapOf',
      'contextConstant',
      'makeContextConstant',
      'callValue',
      'start',
      'unreachableHere',
    ],
  ],
  [
    'rt.closureCalls',
    Array.from({ length: directCallArities + 1 }, (_, count) => closureCallHelper(count)),
  ],
  ['rt.lifetimes', ['hold', 'share', 'letGo', 'unwound']],
  ['rt.builders', ['items', 'entries', 'cell', 'append', 'appendEntry']],
  [
    'rt.primitives',
    [
      'floorDivide',
      'remainder',
      'intPower',
      'shiftLeft',
      'shiftRight',
      'floatCompare',
      'intFromFloat',
    ],
  ],
  ['rt.places', ['load', 'storeRegister', 'storeCell', 'storeReference', 'reference']],
  ['rt.transients', ['sharedTransient', 'shareTransient', 'unshareTransient']],
  ['rt.executions', ['current: currentExecution']],
  ['rt.slots', ['rebound', 'startsHere']],
  ['rt.signals', ['parked: PARKED', 'stopped: STOPPED', 'stop: STOP', 'notRebound: NOT_REBOUND']],
] as const;

/** A program's code: the body of a function of the run, and the instruction each line runs. */
export interface EmittedProgram {
  readonly body: string;
  /** For each line of `body`, the entry and instruction it runs, or undefined. */
  readonly lines: readonly (readonly [entry: number, instruction: number] | undefined)[];
}

/**
 * The code of `definition`, its functions emitted in `order`, each index once: a test's second
 * build of one Definition takes another (docs/work/done/ir-first/contracts.md), meaning the same.
 */
export function emitProgram(
  definition: Definition,
  order: readonly number[] = [...definition.functions.keys()],
): EmittedProgram {
  const { functions, types, constants } = definition;
  const body: string[] = [];
  const lines: (readonly [number, number] | undefined)[] = [];
  const line = (text: string, at?: readonly [number, number]) => {
    body.push(text);
    lines.push(at);
  };
  line('"use strict";');
  line('const site = new Error();');
  for (const [owner, names] of helpers) {
    line(`const { ${names.join(', ')} } = ${owner};`);
  }
  line('const K = rt.constants;');
  for (const index of order) {
    if (functions[index]?.kind === 'extern') {
      line(`const x${index} = rt.native(${index});`);
    }
  }
  const code = order.flatMap((index) => {
    const entry = functions[index];
    return entry?.kind === 'code' ? [{ index, entry }] : [];
  });
  for (const { index, entry } of code) {
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
  }
  const entries = functions.map((entry, index) =>
    entry.kind === 'code' ? `f${index}` : `x${index}`,
  );
  line(`return { site, entries: [${entries.join(', ')}] };`);
  return { body: body.join('\n'), lines };
}

/**
 * The module of a built program: the runtime library's `program` over its Definition, as the text
 * definition/definition.ts embeds it, and its code.
 */
export function builtModule(definition: string, code: EmittedProgram): string {
  const made = `program(${JSON.stringify(definition)}, ${JSON.stringify(code)})`;
  return `import { program } from "istalang/live";\n\nexport default ${made};\n`;
}
