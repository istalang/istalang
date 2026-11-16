/**
 * What a Definition must hold beyond its shape, checked as it is read, so a backend trusts every
 * index it follows (docs/arch/definition.md, "Validation").
 *
 * - Every index lands in its table: types, functions, constants, a code entry's registers and
 *   labels, a start's entry and the purpose's.
 * - Every code entry ends where no path runs off its end.
 * - Ownership (./ownership.ts): every register owning something is let go of once on every path.
 *
 * Issues name where they are, so a bad Definition is refused with the first thing wrong in it.
 */

import type { z } from 'zod';
import { endsBlock, operandsOf } from '../instructions/instruction.ts';
import type { CodeFunction } from '../tables/functions.ts';
import type { Tables } from '../tables/index.ts';
import { typesIn } from '../tables/types.ts';
import { ownershipIssues } from './ownership.ts';

/** Reports every way `definition` breaks the rules above to `context`. */
export function validate(definition: Tables, context: z.RefinementCtx): void {
  for (const issue of issuesOf(definition)) {
    context.addIssue({ code: 'custom', message: issue });
  }
}

/** Every way `definition` breaks the rules above, each a message naming where. */
export function issuesOf(definition: Tables): readonly string[] {
  const issues: string[] = [];
  const within = (what: string, index: number, size: number, where: string) => {
    if (index >= size) {
      issues.push(`${where}: ${what} ${String(index)} is past the table's ${String(size)}.`);
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
  return issues;
}
