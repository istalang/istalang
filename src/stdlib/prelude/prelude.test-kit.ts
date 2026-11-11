/** Running a program's `main` for what the prelude's functions give it. */

import { compiledText } from '../../compiler/compile.test-kit.ts';
import { decodeJson } from '../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../../runtime/runtime.test-kit.ts';

/**
 * What `main` finishes with, read from JSON, the ended state when it doesn't finish, where a live
 * `main` runs in a context (§9) an ista `_main` giving a `result` with `block` beside
 * `declarations`. `block` is `_main`'s body as written under its head: its lines past the first
 * indented already.
 */
export async function mainOutcome(
  result: string,
  block: string,
  declarations: string,
): Promise<unknown> {
  const program = `${declarations}\nimport * as runtime from 'runtime'
live async fn main() -> ${result}: await runtime.run(runtime.id()) _main()
ista async fn _main() -> ${result}:\n  ${block}`;
  const state = await startToEnd(testRuntime(), compiledText(program));
  return state.kind === 'finished' ? decodeJson(String(state.outcome)) : state;
}

/**
 * `mainOutcome` of a `body` of one line or several, each indented under `_main` here, so a caller
 * writes them as at a module's top level.
 */
export async function mainGives(result: string, body: string, declarations = ''): Promise<unknown> {
  return await mainOutcome(result, body.trimEnd().split('\n').join('\n  '), declarations);
}
