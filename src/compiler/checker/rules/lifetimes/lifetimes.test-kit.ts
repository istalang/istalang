/**
 * What the lifetime rule's tests share: what it finds in a program written as a test's source, by
 * the line and kind of each finding.
 */

import { isError } from '../../../../foundation/diagnostics/diagnostic.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { spanIn } from '../../../syntax/tree/positions.ts';
import { cycleTemplates } from '../../diagnostics/lifetimes.ts';
import { ProgramChecker } from '../../wiring/program/program-checker.ts';

const cycleCodes: ReadonlySet<number> = new Set(
  Object.values(cycleTemplates).map(({ code }) => code),
);

/** Whether `diagnostic` reports a cycle static lifetimes rejects (design.md §7). */
export function isCycle({ code }: { readonly code: number }): boolean {
  return cycleCodes.has(code);
}

/** Each finding in `main`, as `line:kind`, the line counted from 1. */
export function findingsIn(main: string): readonly string[] {
  const program = stdProgramOf({ main });
  const checker = new ProgramChecker(program);
  const module = idOf('main');
  const tree = program.modules.get(module)?.tree;
  if (tree === undefined) {
    throw new Error('The program has no main module.');
  }
  const errors = checker
    .diagnosticsOf(module)
    .filter((diagnostic) => isError(diagnostic) && !isCycle(diagnostic));
  if (errors.length > 0) {
    throw new Error(
      `The program doesn't check: ${errors.map(({ message }) => message).join('; ')}`,
    );
  }
  return checker.lifetimes.findingsOf(module).map(({ site, kind }) => {
    const { start } = spanIn(tree, site.span);
    const line = main.slice(0, start).split('\n').length;
    return `${line}:${kind}`;
  });
}
