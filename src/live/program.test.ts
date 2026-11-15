/**
 * A host starts a compiled program as it starts one on the interpreter: what doesn't fit refuses the
 * start before anything runs, with the interpreter's reasons (runtime/refusal.ts), an outcome JSON
 * can't hold rejects it, and a value given again unchanged reaches the host as the same object.
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

/** `text`, the program above by default, compiled to JavaScript. */
async function compiled(text = source): Promise<LiveProgram> {
  const root = project({ 'main.ista': text });
  const definition = compiledAt(root, 'main.ista', text);
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

  it("rejects a start whose outcome JSON can't hold, as the interpreter does", async () => {
    const program = await compiled(
      [
        "import Json from 'json'",
        'live async fn main() -> Json:',
        '  let nested: Json = 1',
        '  for _ in 0..300: nested = [nested]',
        '  nested',
      ].join('\n'),
    );
    await expect(program.start()).rejects.toThrow('JSON nests deeper than 256 levels.');
  });

  it('gives a host the same object for a value given again unchanged, its codec run once', async () => {
    const program = await compiled(
      [
        "import Json from 'json'",
        'struct Item:',
        '  name: String',
        'extern fn noted()',
        'fn toJson(self: Item) -> Json:',
        '  noted()',
        '  ["name": self.name]',
        'extern fn show(items: Array<Item>)',
        'live async fn main():',
        '  const items = [Item{name: "a"}]',
        '  show(items)',
        '  show(items)',
      ].join('\n'),
    );
    const shown: unknown[] = [];
    let noted = 0;
    await program.start({
      externs: {
        'main.noted()': () => {
          noted += 1;
          return null;
        },
        'main.show(prelude.Array<main.Item>)': ([items]) => {
          shown.push(items);
          return null;
        },
      },
    });
    expect({ same: shown[0] === shown[1], noted }).toEqual({ same: true, noted: 1 });
  });
});
