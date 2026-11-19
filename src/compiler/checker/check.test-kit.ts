/**
 * Checking a module as tests write it: `main.ista`, or another of several, beside the std modules,
 * its diagnostics read as codes over the text they explain, and a statement placed in a function
 * with a few parameters to use. The std modules are checked once per test file (compile.test-kit.ts `checkedAfterStd`),
 * since checking a module reads the bodies of the std functions it calls (static lifetimes'
 * summaries).
 */

import { reportedIn } from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import type { Persistence } from '../../foundation/language/well-known/index.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { checkedAfterStd, diagnosedAt } from '../compile.test-kit.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type { Checker } from './check.ts';
import { type CheckerOptions, ProgramChecker } from './wiring/program/program-checker.ts';

/** Everything reported for `text` as module `main.ista`, beside the std modules and `others`. */
export function reported(text: string, others: Readonly<Record<string, string>> = {}) {
  return reportedAt('main.ista', { 'main.ista': text, ...others });
}

/** Everything reported for module `key` of `files`, beside the std modules. */
export function reportedAt(key: string, files: Readonly<Record<string, string>>) {
  const program = stdProgramOf(files);
  checkedAfterStd(program);
  const { source, diagnostics } = diagnosedAt(program, key);
  return reportedIn(source, diagnostics);
}

/**
 * `body` as the body of a function taking `c: Bool`, `n: Int` and `s: String`, after `Point`: one of
 * `kind` where given, else unmarked (§9.1).
 */
export function inFunction(body: string, kind?: Persistence): string {
  const head = kind === undefined ? 'fn' : `${kind} fn`;
  return `struct Point { x: Int, y: Int }\n\n${head} subject(c: Bool, n: Int, s: String):\n${body
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')}\n`;
}

/**
 * A checker of `program` made apart from `checkProgram`'s, which keeps the first checker of each
 * program: tests compare two of them, each asked its own way. With `options`, it takes over the
 * entries of a previous one, and tells `observe` what it computes itself.
 */
export function checkedApart(program: Program, options?: CheckerOptions): ProgramChecker {
  return new ProgramChecker(program, options);
}

/** The diagnostics of each of `modules`, asked of `checker` in their order. */
export function diagnosticsOf(checker: Checker, modules: readonly ModuleId[]) {
  return new Map(modules.map((module) => [module, checker.diagnosticsOf(module)]));
}
