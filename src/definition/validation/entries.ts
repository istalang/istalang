/**
 * The entries a Definition's body names, which a host starts or the runtime calls itself: `main`,
 * the job server, the starts with their encoders, and a test Definition's runner and suites, each
 * the code its caller may call (../../foundation/language/call-rule.ts), taking what it is given.
 */

import { mayCall } from '../../foundation/language/call-rule.ts';
import { isMainShaped, isStartable, type StartShape } from '../../foundation/language/starts.ts';
import { type Mark, marks } from '../../foundation/language/well-known/index.ts';
import { type CodeFunction, encoderProblem } from '../tables/functions.ts';
import { runnerArity } from '../tables/test-runner.ts';
import { type Context, inRange, type Path } from './ranges.ts';

/** Checks every entry `context`'s tables name. */
export function checkEntries(context: Context): void {
  checkMain(context);
  checkJobServer(context);
  checkStarts(context);
  checkTests(context);
}

/**
 * The Definition's `main` field (the paths below name it), which must point at code running as an
 * execution.
 */
function checkMain(context: Context): void {
  const { main } = context.tables;
  if (main === undefined || !inRange(context, { functions: [main] }, ['main'])) {
    return;
  }
  const entry = context.tables.functions[main];
  if (entry?.kind !== 'code' || !isMainShaped(startShapeOf(entry))) {
    context.report(['main'], 'main must be live code running as an execution, with no parameters.');
  }
}

/** The Definition's `jobServer`, which `Runtime.open`, live code, calls with its runtime. */
function checkJobServer(context: Context): void {
  const { jobServer } = context.tables;
  if (jobServer !== undefined) {
    checkCalledEntry(context, ['jobServer'], jobServer, { modes: ['live'], parameters: 1 });
  }
}

/**
 * What the runtime calls an entry as, a closure capturing nothing: code of one of `modes` taking
 * `parameters` arguments by value.
 */
interface CalledEntry {
  readonly modes: readonly Mark[];
  readonly parameters: number;
}

/** The entry `function_` names at `path`, which the runtime calls as `called` says. */
function checkCalledEntry(
  context: Context,
  path: Path,
  function_: number,
  { modes, parameters }: CalledEntry,
): void {
  if (!inRange(context, { functions: [function_] }, path)) {
    return;
  }
  const entry = context.tables.functions[function_];
  const fits =
    entry?.kind === 'code' &&
    modes.includes(entry.mode) &&
    entry.captures === 0 &&
    entry.parameters.length === parameters &&
    entry.parameters.every(({ reference }) => !reference);
  if (!fits) {
    const taking = `${parameters} ${parameters === 1 ? 'argument' : 'arguments'}`;
    const code = `${modes.join(' or ')} code`;
    context.report(path, `This names no ${code} capturing nothing and taking ${taking} by value.`);
  }
}

/**
 * The entries a host may start: code taking every argument by value, each key named once, each with
 * an entry that can encode its outcome.
 */
function checkStarts(context: Context): void {
  const keys = new Set<string>();
  context.tables.starts.forEach((start, index) => {
    const path = ['starts', index];
    if (keys.has(start.key)) {
      context.report(path, `The key '${start.key}' names two entries a host may start.`);
    }
    keys.add(start.key);
    const entry = context.tables.functions[start.function];
    if (
      inRange(context, { functions: [start.function] }, [...path, 'function']) &&
      (entry?.kind !== 'code' || !isStartable(startShapeOf(entry)))
    ) {
      context.report(path, 'A host starts live or simple code that takes every argument by value.');
    }
    checkEncoder(context, start.encoder, [...path, 'encoder']);
  });
}

/** An entry encoding an instance's outcome for its host (§9): one that can. */
export function checkEncoder(context: Context, encoder: number, path: Path): void {
  const entry = context.tables.functions[encoder];
  const problem = entry === undefined ? undefined : encoderProblem(entry);
  if (inRange(context, { functions: [encoder] }, path) && problem !== undefined) {
    context.report(path, `${problem}.`);
  }
}

/**
 * A test Definition's suites and runner (§10): code a test's instance, ista code, may call, a
 * suite's taking nothing.
 */
function checkTests(context: Context): void {
  const { tests } = context.tables;
  if (tests === undefined) {
    return;
  }
  const { list, run, suites } = tests;
  const modes = marks.filter((mark) => mayCall('ista', mark));
  const called = (path: Path, function_: number, parameters: number) =>
    checkCalledEntry(context, path, function_, { modes, parameters });
  called(['tests', 'list'], list, runnerArity.list);
  called(['tests', 'run'], run, runnerArity.run);
  suites.forEach((suite, index) => {
    called(['tests', 'suites', index, 'function'], suite.function, 0);
  });
}

/** What the rule of what a host may start reads of a code entry: concrete code with its body. */
function startShapeOf(entry: CodeFunction): StartShape {
  return {
    hasBody: true,
    isStatic: false,
    isGeneric: false,
    parameters: entry.parameters,
    awaits: entry.mode !== 'simple',
    isIsta: entry.mode === 'ista',
  };
}
