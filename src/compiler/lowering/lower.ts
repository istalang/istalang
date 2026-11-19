/**
 * Lowering's entry: a checked program, compiled into a Definition (docs/arch/definition.md).
 *
 * Lowering starts from `main`, or from a test program's suites (§18), and compiles every entry it
 * reaches, through a worklist (tables/tables.ts), each by its kind's row of the kind table
 * (entry-kinds.ts), and the runtime's loop serving jobs once it reaches `delegate` (§14), as the
 * program's job server. Lowering runs only on a program the checker accepted, so it reports
 * nothing; anything it can't lower is a bug in an earlier phase and throws.
 *
 * An entry only the std decides is taken over from a program over the same std lowered before
 * (tables/std-lowering.ts), kept per process unless a caller passes the kept entries to read.
 * Which entry is lowered next is the caller's to choose too (`LoweringOptions.order`).
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
import { entryKeysOf } from './tables/entry-keys.ts';
import type { PendingOrder } from './tables/function-table.ts';
import { rootInstance } from './tables/instances.ts';
import { type StdLowering, stdLoweringOf } from './tables/std-lowering.ts';
import { DefinitionTables } from './tables/tables.ts';

/**
 * What a caller may choose of a lowering: the std lowering to take entries over from, the
 * process's by default; and the order entries are lowered in, which a Definition never shows.
 */
export interface LoweringOptions {
  readonly std?: StdLowering;
  readonly order?: PendingOrder;
}

/**
 * The tables of `checker`'s program, a test build's functions' slots `rebindable` (§18), taking over
 * the entries `std` kept for the build: what changes how the std's entries lower, which the std
 * functions its test modules mock do too, as they are never shared across types.
 */
function tablesOf(
  checker: Checker,
  rebindable: boolean,
  { std = stdLoweringOf(checker.program), order }: LoweringOptions,
): DefinitionTables {
  const keys = entryKeysOf(checker);
  const mocked = [...checker.mockedFunctions()]
    .filter((declaration) => checker.isStd(checker.moduleOf(declaration)))
    .map((declaration) => keys.declaration(declaration));
  const kept = std.of({ rebindable, mocked });
  return new DefinitionTables(checker, {
    rebindable,
    identities: entryKinds,
    kept,
    ...(order === undefined ? {} : { order }),
  });
}

/**
 * The Definition of everything `main` and the program's startable functions reach (§17.3): `main` is
 * started through its start entry, as a host starts any of the others.
 */
export function lower(
  checker: Checker,
  main: FunctionDeclaration,
  options: LoweringOptions = {},
): Definition {
  const tables = tablesOf(checker, false, options);
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

/** A `@Suite` function (§18), with the title its annotation gives. */
export interface Suite {
  readonly title: string;
  readonly declaration: FunctionDeclaration;
}

/**
 * The Definition of a program's tests (§18): everything its `suites` and the testing module's
 * listing and running of their tests reach, which every test's instance starts from.
 */
export function lowerTests(
  checker: Checker,
  suites: readonly Suite[],
  options: LoweringOptions = {},
): Definition {
  const tables = tablesOf(checker, true, options);
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
 * server, which lowering asks for as it reaches an instance of `delegate`.
 */
function lowerReached(checker: Checker, tables: DefinitionTables): FunctionId | undefined {
  const jobs = jobDeclarationsOf(checker);
  const server =
    jobs === undefined
      ? undefined
      : ({ kind: 'instance', instance: rootInstance(checker, jobs.server) } as const);
  tables.lowerReached((entry) => {
    const delegates = entry.kind === 'instance' && entry.instance.declaration === jobs?.delegate;
    if (delegates && server !== undefined) {
      tables.index(server);
    }
    return loweredEntry({ checker, tables }, entry);
  });
  return server === undefined ? undefined : tables.numbered(server);
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
