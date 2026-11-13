/**
 * What the lifetime rule's tests share: what it finds in a program written as a test's source, by
 * the line and kind of each finding.
 */

import { isError } from '../../../../foundation/diagnostics/diagnostic.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { cycleTemplates } from '../../diagnostics/lifetimes.ts';
import { ProgramChecker } from '../../wiring/program/program-checker.ts';

/** The kind a test names each cycle by, by the template reporting it. */
const cycleKinds = {
  cycleWrite: 'write',
  cycleCall: 'call',
  cycleEscaping: 'closure',
  cycleWitness: 'witness',
  cycleInstance: 'instance',
} as const satisfies Record<keyof typeof cycleTemplates, string>;

const kindByCode: ReadonlyMap<number, string> = new Map(
  Object.entries(cycleKinds).map(([template, kind]) => [
    cycleTemplates[template as keyof typeof cycleKinds].code,
    kind,
  ]),
);

/** Whether `diagnostic` reports a cycle static lifetimes rejects (design.md §7). */
export function isCycle({ code }: { readonly code: number }): boolean {
  return kindByCode.has(code);
}

/** Each cycle reported in `main`, as `line:kind`, the line counted from 1. */
export function findingsIn(main: string): readonly string[] {
  const program = stdProgramOf({ main });
  const checker = new ProgramChecker(program);
  const diagnostics = checker.diagnosticsOf(idOf('main'));
  const errors = diagnostics.filter((diagnostic) => isError(diagnostic) && !isCycle(diagnostic));
  if (errors.length > 0) {
    throw new Error(
      `The program doesn't check: ${errors.map(({ message }) => message).join('; ')}`,
    );
  }
  return diagnostics.flatMap(({ code, span }) => {
    const kind = kindByCode.get(code);
    if (kind === undefined) {
      return [];
    }
    const line = main.slice(0, span.start).split('\n').length;
    return [`${line}:${kind}`];
  });
}
