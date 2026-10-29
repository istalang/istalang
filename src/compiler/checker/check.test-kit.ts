/**
 * Checking a module as tests write it: `main.ista` beside the std modules, its diagnostics read
 * as codes over the text they explain, and a statement placed in a function with a few parameters
 * to use.
 */

import { reportedIn } from '../../diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { diagnosedAt } from '../compile.test-kit.ts';
import type { Program } from '../program/program.ts';
import type { CheckerContext } from './context.ts';
import { ProgramChecker } from './program-checker.ts';

/** Everything reported for `text` as module `main.ista`, beside the std modules and `others`. */
export function reported(text: string, others: Readonly<Record<string, string>> = {}) {
  const { source, diagnostics } = diagnosedAt(
    stdProgramOf({ 'main.ista': text, ...others }),
    'main.ista',
  );
  return reportedIn(source, diagnostics);
}

/** `body` as the body of a function taking `c: bool`, `n: int` and `s: string`, after `Point`. */
export function inFunction(body: string): string {
  return `struct Point { x: int; y: int }\n\nfn subject(c: bool, n: int, s: string):\n${body
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')}\n`;
}

/**
 * A checker of `program` made apart from `checkProgram`'s, which keeps the first checker of each
 * program: tests compare two of them, each asked its own way.
 */
export function checkedApart(program: Program): CheckerContext {
  return new ProgramChecker(program);
}
