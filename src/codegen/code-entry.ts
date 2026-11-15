/**
 * One code entry as JavaScript (docs/work/js-codegen/design.md, "Functions"): a simple entry is a
 * function returning its value; a live async one is a function giving a new future, whose body, a
 * generator the run drives, runs eagerly until its first wait and settles that future as it
 * returns.
 *
 * - Parameters are the function's own, after the closure it runs; a parameter left out arrives
 *   `undefined`. Captures follow, read off the closure, then the locals.
 * - Jumps become a `for (;;) switch (pc)` with one case per label; an entry with no label is
 *   straight-line code. Every instruction is one line, the cases' labels written on theirs, so a
 *   line of the module names one instruction: `firstInstruction` is the line of the first.
 * - An async body that throws fails the run, a panic or a bug in the toolchain (live/run.ts).
 * - Which execution runs is tracked (`run.at`), for its waits and transients: the run sets it as an
 *   async body begins and resumes, and a simple function sharing transients restores the execution
 *   it entered in.
 */

import type { Instruction } from '../definition/instructions/instruction.ts';
import { operandsOf } from '../definition/instructions/instruction.ts';
import { type Handlers, handlerOf } from '../foundation/structures/kind-table.ts';
import type { EntryScope } from './entry-scope.ts';
import { callEmitters } from './instructions/calls.ts';
import { controlEmitters, prologueEmitters } from './instructions/control.ts';
import { dataEmitters } from './instructions/data.ts';
import { lifetimeEmitters } from './instructions/lifetimes.ts';
import { suspensionEmitters } from './instructions/suspension.ts';

const emitters: Handlers<EntryScope, Instruction, [], string> = {
  ...dataEmitters,
  ...controlEmitters,
  ...prologueEmitters,
  ...callEmitters,
  ...suspensionEmitters,
  ...lifetimeEmitters,
};

/** An entry's lines, and which of them holds its first instruction. */
export interface EmittedEntry {
  readonly lines: readonly string[];
  readonly firstInstruction: number;
}

/** The code entry `scope` emits, as the lines of its function declarations. */
export function emitCodeEntry(scope: EntryScope): EmittedEntry {
  const { entry, index } = scope;
  const parameters = ['cl', ...entry.parameters.map((_, register) => `r${register}`)].join(', ');
  const lines = scope.async
    ? [asyncHead(scope, parameters), `function* b${index}(fut, ${parameters}) {`]
    : [`function f${index}(${parameters}) {`];
  lines.push(...locals(scope));
  const labels = new Set(
    entry.instructions.flatMap((instruction) => operandsOf(instruction).labels),
  );
  const branches = labels.size > 0;
  if (branches) {
    lines.push('for (;;) switch (pc) {');
  }
  const firstInstruction = lines.length;
  for (const [at, instruction] of entry.instructions.entries()) {
    const line = handlerOf(emitters, instruction)(scope, instruction);
    lines.push(branches && (at === 0 || labels.has(at)) ? `case ${at}: ${line}` : line);
  }
  if (branches) {
    lines.push('default: throw noInstruction(pc);', '}');
  }
  lines.push('}');
  return { lines, firstInstruction };
}

/** The function an async entry is called as: it gives a new future, its body settling it. */
function asyncHead(scope: EntryScope, parameters: string): string {
  const { index } = scope;
  return `function f${index}(${parameters}) { const fut = newFuture(); run.call(fut, b${index}(fut, ${parameters})); return fut; }`;
}

/** The statements declaring an entry's registers beyond its parameters, and its working locals. */
function locals(scope: EntryScope): string[] {
  const { entry } = scope;
  const declared: string[] = [];
  for (const [register, parameter] of entry.parameters.entries()) {
    if (!parameter.reference && scope.holding(register) !== 'value') {
      declared.push(`if (r${register} !== undefined) r${register} = cellOf(r${register});`);
    }
  }
  const first = entry.parameters.length;
  for (let capture = 0; capture < entry.captures; capture += 1) {
    declared.push(`let r${first + capture} = cl.captures[${capture}];`);
  }
  const rest = Array.from(
    { length: entry.registers - first - entry.captures },
    (_, offset) => `r${first + entry.captures + offset}`,
  );
  const working = ['pc = 0', 't'];
  declared.push(`let ${[...rest, ...working].join(', ')};`);
  if (scope.restoresExecution) {
    declared.push('const entered = run.at;');
  }
  return declared;
}
