/**
 * Checkers made revision after revision of an edited program, each from the checker before it
 * (docs/work/done/m6-m7/incremental-checking.md, 7A.4, 7A.7), for the properties holding them to
 * checkers made afresh, and to what they check themselves.
 *
 * Every run of a property starts from one first revision, checked once: a checker made from an
 * earlier one only reads that one's entries, so each finds it as it was made. The fresh checkers
 * stay fresh.
 */

import { addToGroup } from '../../foundation/structures/groups.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { applied, type Edit } from '../parser/edits.test-kit.ts';
import { type Files, ownModules } from '../program/program.test-kit.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations/index.ts';
import { checkedApart, diagnosticsOf } from './check.test-kit.ts';
import type { Checker } from './check.ts';
import { spelledAnswers } from './lookup/lookup.test-kit.ts';
import type { ProgramChecker } from './wiring/program/program-checker.ts';

/** An edit sequence: `edits` of module `edited` of `files`. */
export interface Edited {
  readonly files: Files;
  readonly edited: string;
  readonly edits: readonly Edit[];
}

/** The programs an edit sequence makes from `first`, its files' program, each built from the last. */
export function revisionsOf(first: Program, { files, edited, edits }: Edited): readonly Program[] {
  const programs = [first];
  let text = files[edited] ?? '';
  for (const edit of edits) {
    text = applied(text, edit);
    programs.push(stdProgramOf({ ...files, [edited]: text }, programs.at(-1)));
  }
  return programs;
}

/** Which modules' diagnostics a test asks of each revision. */
type Asked = (program: Program) => readonly ModuleId[];

export const everyModule: Asked = (program) => [...program.modules.keys()];

/** Hears each body the `revision`-th revision checks. */
type Observe = (revision: number, checked: FunctionDeclaration) => void;

/** How a revision is checked: from the checker before it, if any, and heard by `observe`. */
interface Revising {
  readonly previous?: ProgramChecker | undefined;
  readonly revision?: number;
  readonly observe?: Observe | undefined;
}

/** A checker of `program`, the `revision`-th, with the `asked` modules' diagnostics asked. */
export function checkedRevision(
  program: Program,
  asked: Asked,
  { previous, revision = 0, observe }: Revising = {},
): ProgramChecker {
  const checker = checkedApart(program, {
    previous,
    observe:
      observe &&
      ((table, key) => {
        if (table === 'bodies') {
          observe(revision, key as FunctionDeclaration);
        }
      }),
  });
  diagnosticsOf(checker, asked(program));
  return checker;
}

/**
 * `first` and each revision of an edit sequence after it, checked by a checker made from the last
 * one's, with the `asked` modules' diagnostics asked.
 */
function checkedRevisions(
  first: ProgramChecker,
  sequence: Edited,
  asked: Asked,
  observe?: Observe,
): readonly ProgramChecker[] {
  const checkers = [first];
  for (const [revision, program] of revisionsOf(first.program, sequence).entries()) {
    if (revision > 0) {
      checkers.push(
        checkedRevision(program, asked, { previous: checkers.at(-1), revision, observe }),
      );
    }
  }
  return checkers;
}

/** Of the modules of `checker`'s program the test owns, the diagnostics and every node's answers. */
export function answered(checker: Checker) {
  const own = ownModules(checker.program);
  return {
    diagnostics: diagnosticsOf(checker, own),
    answers: own.map((each) => spelledAnswers(checker, each)),
  };
}

/**
 * What every revision of an edit sequence after `first` answers, beside what a checker of its
 * program made afresh answers.
 */
export function answeredBothWays(first: ProgramChecker, sequence: Edited) {
  const revisions = checkedRevisions(first, sequence, ownModules).slice(1);
  return {
    incremental: revisions.map(answered),
    fresh: revisions.map((revision) => answered(checkedApart(revision.program))),
  };
}

/**
 * The bodies each revision of an edit sequence checked, by revision, every module's diagnostics
 * asked: after `first`, a property's first revision, else from a first revision checked here.
 */
export function bodiesChecked(sequence: Edited, first?: ProgramChecker) {
  const checked = new Map<number, FunctionDeclaration[]>();
  const observe: Observe = (revision, body) => addToGroup(checked, revision, body);
  const checkers = checkedRevisions(
    first ?? checkedRevision(stdProgramOf(sequence.files), everyModule, { observe }),
    sequence,
    everyModule,
    observe,
  );
  return { checkers, checked };
}
