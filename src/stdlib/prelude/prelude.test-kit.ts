/** Running a program's `main` for what the prelude's functions give it. */

import { compiledText } from '../../compiler/compile.test-kit.ts';
import { decodeJson } from '../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../../runtime/runtime.test-kit.ts';

/**
 * What `main`, giving a `result` with `body` beside `declarations`, finishes with, read from JSON;
 * the ended state when it doesn't finish. `body` is one line or several, each indented under
 * `main` here, so a caller writes them as at a module's top level.
 */
export async function mainGives(result: string, body: string, declarations = ''): Promise<unknown> {
  const lines = body.trimEnd().split('\n').join('\n  ');
  const program = `${declarations}\nasync fn main() -> Future<${result}>:\n  ${lines}`;
  const state = await startToEnd(testRuntime(), compiledText(program));
  return state.kind === 'finished' ? decodeJson(String(state.outcome)) : state;
}
