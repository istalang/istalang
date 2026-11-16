/**
 * Every golden program shows the same with its contexts crashing at every await (§10): each segment
 * runs again from the instance as it last committed, read back from its snapshot into a fresh run,
 * so what a program shows then is what committing and restoring keep, its suspended frames spilled
 * and restored included (docs/work/ir-first/design.md, "Verification"). It stands for the
 * cross-check of two backends, gone with the interpreter (docs/work/ir-first/coverage.md).
 */

import { describe, expect, it } from 'vitest';
import { observeProgram } from './pipeline.ts';
import { type ProgramSubject, subjectGroups } from './subjects.ts';

/** A subject run past a unit test's time: the supplier demo compiles for seconds. */
const subjectTimeout = 120_000;

const programs = [...subjectGroups.values()]
  .flat()
  .filter((subject): subject is ProgramSubject => subject.kind === 'program');

describe('a golden program crashing at every await', () => {
  it.each(programs.map((program) => [program.name, program] as const))(
    '%s shows the same',
    async (_, program) => {
      const crashing = await observeProgram(program, { crashEveryAwait: true });
      expect(crashing).toEqual(await observeProgram(program));
    },
    subjectTimeout,
  );
});
