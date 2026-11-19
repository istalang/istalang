/**
 * What a Definition must hold beyond its shape, checked as it is read, so a backend trusts every
 * index it follows (docs/arch/definition.md, "Validation").
 *
 * - Every index lands in its table: the tables' own references to each other (./references.ts),
 *   a code entry's operands (registers, labels, functions, constants) and the purpose's. Every
 *   part code steps into lands among its type's parts, and a struct or variant is built in a
 *   register of its entry's type (./parts.ts).
 * - The purpose's `main` names a start, and no two starts share a key: a host starts one by key.
 * - Every code entry ends where no path runs off its end, and one `wrapping` a function value
 *   captures it, as a start follows it there (§18).
 * - The call rule (foundation/language/call-rule.ts) over the entries the purpose names, which the
 *   runtime calls itself: a test's runner and suites as ista code, the job server as live code. Any
 *   other call is checked by the run, against the kind of code running it.
 * - Ownership (./ownership.ts): every register owning something is let go of once on every path.
 *
 * Issues name where they are, so a bad Definition is refused with the first thing wrong in it.
 */

import { mayCall } from '../../foundation/language/call-rule.ts';
import type { Mark } from '../../foundation/language/well-known/index.ts';
import { endsBlock, type Instruction, operandsOf } from '../instructions/instruction.ts';
import type { CodeFunction } from '../tables/functions.ts';
import type { Definition, Purpose } from '../tables/index.ts';
import { ownershipIssues } from './ownership.ts';
import { partIssues } from './parts.ts';
import { outsideIssue, referenceIssues } from './references.ts';

/** Every way `definition` breaks the rules above, each a message naming where. */
export function validationIssues(definition: Definition): readonly string[] {
  const issues: string[] = [
    ...referenceIssues(definition),
    ...startIssues(definition),
    ...keyIssues(definition),
  ];
  const { functions } = definition;
  for (const { function: called, caller, where } of purposeCalls(definition.purpose)) {
    const outside = outsideIssue('function', called, functions.length);
    if (outside !== undefined) {
      issues.push(`${where}: ${outside}`);
    }
    const entry = functions[called];
    if (entry !== undefined && !(entry.kind === 'code' && mayCall(caller, entry.mode))) {
      issues.push(`${where}: ${caller} code may not call ${entry.name}.`);
    }
  }
  functions.forEach((entry, index) => {
    if (entry.kind === 'code') {
      issues.push(...codeIssues(entry, `function ${String(index)} (${entry.name})`, definition));
      issues.push(...ownershipIssues(entry).map((issue) => `${entry.name}: ${issue}`));
    }
  });
  return issues;
}

function codeIssues(entry: CodeFunction, where: string, definition: Definition): readonly string[] {
  const issues: string[] = [];
  const { instructions, registers } = entry;
  instructions.forEach((each, pc) => {
    const operands = operandsOf(each);
    const within = (what: string, indices: readonly number[], size: number, of?: string) => {
      for (const index of indices) {
        const outside = outsideIssue(what, index, size, of);
        if (outside !== undefined) {
          issues.push(`${atInstruction(where, pc, each)}: ${outside}`);
        }
      }
    };
    within('register', [...operands.read, ...operands.written], registers.length, 'frame');
    within('label', operands.labels, instructions.length, 'code');
    within('function', operands.functions, definition.functions.length);
    within('constant', operands.constants, definition.constants.length);
  });
  issues.push(
    ...partIssues(entry, definition.types, (pc, instruction) =>
      atInstruction(where, pc, instruction),
    ),
  );
  const last = instructions.at(-1);
  if (last !== undefined && !endsBlock(last)) {
    issues.push(`${where}: its last instruction, ${last.kind}, runs off the end.`);
  }
  if (entry.wrapping === true && entry.captures === 0) {
    issues.push(`${where}: it wraps a function value, yet captures none.`);
  }
  return issues;
}

/** Where instruction `pc` of the entry at `where` is, for an issue. */
function atInstruction(where: string, pc: number, { kind }: Instruction): string {
  return `${where} at ${String(pc)} (${kind})`;
}

/** Starts a host can't tell apart by key, and a `main` naming none. */
function startIssues({ starts, purpose }: Definition): readonly string[] {
  const keys = starts.map(({ key }) => key);
  const repeated = keys.filter((key, at) => keys.indexOf(key) !== at);
  const main = purpose.kind === 'program' ? purpose.main : undefined;
  return [
    ...[...new Set(repeated)].map((key) => `start ${key}: another start has its key.`),
    ...(main === undefined || keys.includes(main) ? [] : [`main: no start has key ${main}.`]),
  ];
}

/** Whether each function has a key, the keys ascending, so a key finds its function's number. */
function keyIssues({ functions, functionKeys }: Definition): readonly string[] {
  const unordered = functionKeys.findIndex(
    (key, at) => at > 0 && key <= (functionKeys[at - 1] ?? key),
  );
  return [
    ...(functionKeys.length === functions.length
      ? []
      : [`keys: ${String(functionKeys.length)} keys for ${String(functions.length)} functions.`]),
    ...(unordered < 0 ? [] : [`keys: key ${String(unordered)} isn't above the one before.`]),
  ];
}

/** The entries `purpose` names, each with the mark of the code calling it and where it is named. */
function purposeCalls(
  purpose: Purpose,
): readonly { readonly function: number; readonly caller: Mark; readonly where: string }[] {
  if (purpose.kind === 'program') {
    const { jobServer } = purpose;
    return jobServer === undefined
      ? []
      : [{ function: jobServer, caller: 'live', where: 'job server' }];
  }
  return [
    { function: purpose.list, caller: 'ista', where: "tests' list" },
    { function: purpose.run, caller: 'ista', where: "tests' runner" },
    ...purpose.suites.map((suite) => ({
      function: suite.function,
      caller: 'ista' as const,
      where: `suite ${suite.title}`,
    })),
  ];
}
