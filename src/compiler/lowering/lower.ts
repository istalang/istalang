/**
 * Lowering's entry: a checked program, compiled into a Definition (docs/arch/definition.md).
 *
 * Lowering starts from `main`, or from a test program's suites (§10), and compiles every entry it
 * reaches, through a worklist (tables/tables.ts), each by its kind's row of the kind table
 * (entry-kinds.ts), and the runtime's loop serving jobs once it reaches `delegate` (§5), as the
 * program's job server. Lowering runs only on a program the checker accepted, so it reports
 * nothing; anything it can't lower is a bug in an earlier phase and throws.
 */

import type { FunctionId } from '../../definition/operands.ts';
import type { Definition } from '../../definition/tables/index.ts';
import { languageModules, runtimeModule } from '../../foundation/language/well-known/index.ts';
import { jobFunctions } from '../../foundation/language/well-known/jobs.ts';
import { testingFunctions } from '../../foundation/language/well-known/testing.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Checker } from '../checker/check.ts';
import { stdModuleIdOf } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations/index.ts';
import { entryKinds, loweredEntry } from './entry-kinds.ts';
import { listStart, startableOf, startables } from './synthesized/boundary/starts.ts';
import { rootInstance } from './tables/instances.ts';
import { DefinitionTables } from './tables/tables.ts';

/**
 * The Definition of everything `main` and the program's startable functions reach (§9): `main` is
 * started through its start entry, as a host starts any of the others.
 */
export function lower(checker: Checker, main: FunctionDeclaration): Definition {
  const tables = new DefinitionTables(checker, { mocking: false, identities: entryKinds });
  const started = startableOf(checker, main);
  if (started === undefined) {
    unreachable("'main' can't be started; the checker should have said why.");
  }
  const lowering = { checker, tables };
  const mainKey = listStart(lowering, started);
  for (const startable of startables(checker)) {
    listStart(lowering, startable);
  }
  const jobServer = lowerReached(checker, tables);
  return tables.finish({
    kind: 'program',
    main: mainKey,
    ...(jobServer === undefined ? {} : { jobServer }),
  });
}

/** A `@Suite` function (§10), with the title its annotation gives. */
interface Suite {
  readonly title: string;
  readonly declaration: FunctionDeclaration;
}

/**
 * The Definition of a program's tests (§10): everything its `suites` and the testing module's
 * listing and running of their tests reach, which every test's instance starts from.
 */
export function lowerTests(checker: Checker, suites: readonly Suite[]): Definition {
  const tables = new DefinitionTables(checker, { mocking: true, identities: entryKinds });
  const indexOf = (declaration: FunctionDeclaration) =>
    tables.index({ kind: 'instance', instance: rootInstance(checker, declaration) });
  const runner = (name: string) =>
    checker.languageFunctions(languageModules.testing, name)[0] ??
    unreachable(`The testing module declares no '${name}'.`);
  const purpose = {
    kind: 'tests',
    list: indexOf(runner(testingFunctions.list)),
    run: indexOf(runner(testingFunctions.run)),
    suites: suites.map(({ title, declaration }) => ({ title, function: indexOf(declaration) })),
  } as const;
  lowerReached(checker, tables);
  return tables.finish(purpose);
}

/**
 * Lowers every entry referenced so far, and every entry those reference; the index of the job
 * server, lowered with them once one is an instance of `delegate`.
 */
function lowerReached(checker: Checker, tables: DefinitionTables): FunctionId | undefined {
  const jobs = jobDeclarationsOf(checker);
  let jobServer: FunctionId | undefined;
  for (let next = tables.nextPending(); next !== undefined; next = tables.nextPending()) {
    const delegates = next.kind === 'instance' && next.instance.declaration === jobs?.delegate;
    if (delegates && jobs !== undefined && jobServer === undefined) {
      jobServer = tables.index({ kind: 'instance', instance: rootInstance(checker, jobs.server) });
    }
    tables.define(next.index, loweredEntry({ checker, tables }, next));
  }
  return jobServer;
}

/** The runtime module's `delegate` and the job server serving what it queues; none without it. */
function jobDeclarationsOf(
  checker: Checker,
): { readonly delegate: FunctionDeclaration; readonly server: FunctionDeclaration } | undefined {
  const runtime = stdModuleIdOf(runtimeModule);
  if (!checker.program.modules.has(runtime)) {
    return undefined;
  }
  const declared = (name: string): FunctionDeclaration =>
    checker.topLevelFunctions(runtime, name)[0] ??
    unreachable(`The runtime module declares no '${name}'.`);
  return { delegate: declared(jobFunctions.delegate), server: declared(jobFunctions.server) };
}
