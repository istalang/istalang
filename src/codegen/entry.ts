/**
 * One code entry as one JavaScript function (docs/arch/codegen.md).
 *
 * - **Which run on frame records** is this module's one predicate, `runsOnFrames` (ir-first
 *   design, decision 3): an async entry today. Such an entry is `f<i>(frame)`: it loads its
 *   registers from the record, runs from `frame.pc`, and at a `park` saves every register back and
 *   returns, so a suspended frame is data the run keeps, spills and restores. Any other entry is a
 *   plain function, `f<i>(...parameters, closure)`, its registers locals, nesting on the JS stack.
 * - **Control** goes through `pc` and a `switch` only where the entry jumps; a parked frame resumes
 *   at a case of its own past every instruction's, which takes the decision and falls into the
 *   instruction after the `park`.
 * - **One instruction per line**, so a frame on the JS stack names its instruction by its line
 *   (`lines`), which traces read.
 * - **A panic unwinding** through an entry holding counted values has it let go of them, which
 *   the run does only where it passes the panic over (`unwound`, a termination's disposal).
 */

import { endsBlock, operandsOf } from '../definition/instructions/instruction.ts';
import type { CodeFunction } from '../definition/tables/functions.ts';
import {
  countedRegisters,
  type EntryScope,
  emitInstruction,
  parkResumeOf,
  register,
  resumed,
} from './instructions.ts';

/** Whether `entry` runs on a frame record the run keeps, not on the JS stack. */
export function runsOnFrames(entry: CodeFunction): boolean {
  return entry.mode !== 'simple';
}

/** An entry's function text, its lines, and the instruction each line is, by its position. */
interface EmittedEntry {
  readonly lines: readonly string[];
  /** The instruction each line runs, by the line's position in `lines`; -1 for no instruction. */
  readonly instructions: readonly number[];
}

/** The function of the entry `scope` describes. */
export function emitEntry(scope: Omit<EntryScope, 'jumps'>): EmittedEntry {
  const { entry, index, onFrames } = scope;
  const targets = jumpTargets(entry);
  const jumps = targets.size > 0 || onFrames;
  const full: EntryScope = { ...scope, jumps };
  const lines: string[] = [];
  const instructions: number[] = [];
  const line = (text: string, at = -1) => {
    lines.push(text);
    instructions.push(at);
  };
  const registers = entry.registers.map((_, each) => register(each));
  const parameters = entry.parameters.length;
  if (onFrames) {
    line(`function f${index}(frame) {`);
    line('  const cl = frame.closure;');
    if (registers.length > 0) {
      line(`  let [${registers.join(', ')}] = frame.registers;`);
    }
  } else {
    const arguments_ = registers.slice(0, parameters);
    line(`function f${index}(${[...arguments_, 'cl'].join(', ')}) {`);
    const captured = Array.from(
      { length: entry.captures },
      (_, at) => `${register(parameters + at)} = cl.captures[${at}]`,
    );
    const rest = registers.slice(parameters + entry.captures);
    const declared = [...captured, ...rest];
    if (declared.length > 0) {
      line(`  let ${declared.join(', ')};`);
    }
  }
  const counted = countedRegisters(scope);
  if (counted.length > 0) {
    line('  try {');
  }
  if (jumps) {
    line(onFrames ? '  let pc = frame.pc;' : '  let pc = 0;');
    line('  for (;;) switch (pc) {');
    line('  case 0:');
  }
  entry.instructions.forEach((instruction, pc) => {
    if (jumps && pc > 0 && targets.has(pc)) {
      line(`  case ${pc}:`);
    }
    line(`    ${emitInstruction(full, instruction)}`, pc);
    if (instruction.kind === 'park') {
      line(`  case ${parkResumeOf(full, instruction)}:`);
      line(`    ${resumed(instruction)}`, pc);
    }
  });
  if (jumps) {
    line('  }');
  } else if (!endsBlock(entry.instructions.at(-1) ?? ({ kind: 'return' } as never))) {
    line('  throw unreachableHere();');
  }
  if (counted.length > 0) {
    line(`  } catch (error) { unwound(error, ${counted.join(', ')}); throw error; }`);
  }
  line('}');
  return { lines, instructions };
}

/** The instructions some instruction of `entry` jumps to. */
function jumpTargets(entry: CodeFunction): Set<number> {
  return new Set(entry.instructions.flatMap((instruction) => operandsOf(instruction).labels));
}
