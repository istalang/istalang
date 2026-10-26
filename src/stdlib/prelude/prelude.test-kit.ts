/** Running a program's `main` for what the prelude's functions give it. */

import { compiledText } from '../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../../runtime/runtime.test-kit.ts';

/**
 * What `main`, giving a `result` with `body` beside `declarations`, finishes with, read from JSON;
 * the ended state when it doesn't finish.
 */
export function mainGives(result: string, body: string, declarations = ''): unknown {
  const program = `${declarations}\nasync fn main() -> Future<${result}>:\n  ${body}`;
  const state = startToEnd(testRuntime(), compiledText(program));
  return state.kind === 'finished' ? JSON.parse(String(state.outcome)) : state;
}
