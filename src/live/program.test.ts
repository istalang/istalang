/**
 * A host starts a compiled program as it starts one on the interpreter: what doesn't fit refuses the
 * start before anything runs, with the interpreter's reasons (runtime/refusal.ts).
 */

import { describe, expect, it } from 'vitest';
import { compiledAt, compiledToJavaScript } from '../codegen/differential.test-kit.ts';
import { tempProject as project } from '../project/project.test-kit.ts';
import { Refusal } from '../runtime/refusal.ts';
import type { LiveProgram, LiveStart } from './program.ts';

const source = [
  'extern live async fn ask(question: String) -> Int',
  'live async fn main() -> Int: await ask("how many?")',
  'live async fn twice(n: Int) -> Int: n * 2',
].join('\n');

/** The program above, compiled to JavaScript. */
async function compiled(): Promise<LiveProgram> {
  const root = project({ 'main.ista': source });
  const definition = compiledAt(root, 'main.ista', source);
  if ('problem' in definition) {
    throw new Error(definition.problem);
  }
  const program = await compiledToJavaScript(definition.definition);
  if (typeof program === 'string') {
    throw new Error(program);
  }
  return program;
}

/** The reason `start` refuses with. */
function refusedWith(program: LiveProgram, start: LiveStart): string | undefined {
  try {
    program.start(start).catch(() => undefined);
  } catch (error) {
    return error instanceof Refusal ? error.reason : undefined;
  }
  return undefined;
}

const ask = { 'main.ask(String)': () => Promise.resolve(21n) };

describe('starting a compiled program', () => {
  it('starts main, or a function by key, with its arguments as JSON', async () => {
    const program = await compiled();
    expect(await program.start({ externs: ask })).toMatchObject({ kind: 'finished', outcome: 21n });
    const key = program.starts.find((each) => each.startsWith('main.twice')) ?? '';
    expect(await program.start({ function: key, arguments: [4n], externs: ask })).toMatchObject({
      kind: 'finished',
      outcome: 8n,
    });
  });

  it.each([
    ['an unknown key', { function: 'main.nothing()', externs: ask }, 'notStartable'],
    ['the wrong number of arguments', { arguments: [1n], externs: ask }, 'notStartable'],
    ['an extern no native implements', {}, 'missingNatives'],
    [
      'a host extern the std implements',
      { externs: { ...ask, 'time.now()': () => 0n } },
      'reservedName',
    ],
  ])('refuses %s before anything runs', async (_, start: LiveStart, reason) => {
    expect(refusedWith(await compiled(), start)).toBe(reason);
  });

  it('refuses arguments that do not fit as JSON', async () => {
    const program = await compiled();
    const key = program.starts.find((each) => each.startsWith('main.twice')) ?? '';
    expect(refusedWith(program, { function: key, arguments: [Symbol('no')], externs: ask })).toBe(
      'unfitJson',
    );
  });
});
