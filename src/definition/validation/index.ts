/**
 * What a Definition must hold beyond its shape, checked as it is read, so a backend trusts every
 * index it follows (docs/arch/definition.md, "Validation").
 *
 * - Every index lands in its table: types, functions, constants, a code entry's registers and
 *   labels, a start's entry and the purpose's.
 * - Every code entry ends where no path runs off its end, and one `wrapping` a function value
 *   captures it, as a start follows it there (§10).
 * - The call rule (foundation/language/call-rule.ts) over the entries the purpose names, which the
 *   runtime calls itself: a test's runner and suites as ista code, the job server as live code. Any
 *   other call is checked by the run, against the kind of code running it.
 * - Ownership (./ownership.ts): every register owning something is let go of once on every path.
 *
 * Issues name where they are, so a bad Definition is refused with the first thing wrong in it.
 */

import { mayCall } from '../../foundation/language/call-rule.ts';
import type { Mark } from '../../foundation/language/well-known/index.ts';
import { endsBlock, operandsOf } from '../instructions/instruction.ts';
import type { CodeFunction } from '../tables/functions.ts';
import type { Purpose, Tables } from '../tables/index.ts';
import { typesIn } from '../tables/types.ts';
import { ownershipIssues } from './ownership.ts';

/** Every way `definition` breaks the rules above, each a message naming where. */
export function validationIssues(definition: Tables): readonly string[] {
  const issues: string[] = [];
  const within = (what: string, index: number, size: number, where: string) => {
    if (index < 0 || index >= size) {
      issues.push(`${where}: ${what} ${String(index)} is outside the table's ${String(size)}.`);
    }
  };
  const { types, functions } = definition;
  types.forEach((entry, type) => {
    for (const named of entry.arguments.flatMap(typesIn)) {
      within('type', named, types.length, `type ${String(type)}`);
    }
  });
  for (const start of definition.starts) {
    within('function', start.function, functions.length, `start ${start.key}`);
    within('function', start.encode, functions.length, `start ${start.key}'s encoding`);
  }
  for (const { function: called, caller, where } of purposeCalls(definition.purpose)) {
    within('function', called, functions.length, where);
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

function codeIssues(entry: CodeFunction, where: string, definition: Tables): readonly string[] {
  const issues: string[] = [];
  const { instructions, registers } = entry;
  instructions.forEach((each, pc) => {
    const operands = operandsOf(each);
    const past = (what: string, indices: readonly number[], size: number, of: string) => {
      for (const index of indices.filter((at) => at >= size)) {
        issues.push(
          `${where} at ${String(pc)} (${each.kind}): ${what} ${String(index)} is past ${of}.`,
        );
      }
    };
    past('register', [...operands.read, ...operands.written], registers.length, 'the frame');
    past('label', operands.labels, instructions.length, 'the code');
    past('function', operands.functions, definition.functions.length, 'the table');
    past('type', operands.types, definition.types.length, 'the table');
    past('constant', operands.constants, definition.constants.length, 'the table');
  });
  const last = instructions.at(-1);
  if (last !== undefined && !endsBlock(last)) {
    issues.push(`${where}: its last instruction, ${last.kind}, runs off the end.`);
  }
  if (entry.wrapping === true && entry.captures === 0) {
    issues.push(`${where}: it wraps a function value, yet captures none.`);
  }
  return issues;
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
