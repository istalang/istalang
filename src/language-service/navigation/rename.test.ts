import { describe, expect, it } from 'vitest';
import type { Program } from '../../compiler/program/program.ts';
import type { NamePlace } from './declarations.ts';
import { spanOfUse } from './declarations.ts';
import { edited, navigable } from './navigation.test-kit.ts';
import { renameEdits, renamingAt } from './rename.ts';

const pair = 'struct Pair:\n  first: int\n  second: int\n';

/** The texts renaming `use` to `newName` makes, or why it is refused. */
function renamed(program: Program, use: NamePlace, newName: string) {
  const renaming = renameEdits(program, use.module, spanOfUse(program, use).start, newName);
  return renaming?.kind === 'renamed' ? edited(program, renaming.edits) : renaming;
}

function refusalOf(program: Program, use: NamePlace): string | undefined {
  const renaming = renamingAt(program, use.module, spanOfUse(program, use).start);
  return renaming?.kind === 'refused' ? renaming.reason : undefined;
}

describe('renaming', () => {
  it('spells every name of a declaration anew, in every module', () => {
    const { program, named } = navigable({
      main: "import tally from 'lib'\nfn main() -> int: tally(1)\n",
      lib: 'fn tally(x: int) -> int: x\n',
    });
    expect(renamed(program, named('main', 'tally', 1), 'count')).toEqual({
      main: "import count from 'lib'\nfn main() -> int: count(1)\n",
      lib: 'fn count(x: int) -> int: x\n',
    });
  });

  it("spells a literal's shorthand out, for its field or its variable", () => {
    const { program, named } = navigable({
      main: `${pair}fn f(first: int) -> Pair: Pair{first, second: 2}\n`,
    });
    expect(renamed(program, named('main', 'first'), 'head')).toEqual({
      main: 'struct Pair:\n  head: int\n  second: int\nfn f(first: int) -> Pair: Pair{head: first, second: 2}\n',
    });
    expect(renamed(program, named('main', 'first', 2), 'head')).toEqual({
      main: `${pair}fn f(head: int) -> Pair: Pair{first: head, second: 2}\n`,
    });
  });

  it("spells a pattern's shorthand out, for its field or its variable", () => {
    const { program, named } = navigable({
      main: `${pair}fn f(p: Pair) -> int:\n  match p:\n    case Pair{first}: first\n`,
    });
    expect(renamed(program, named('main', 'first'), 'head')).toEqual({
      main: 'struct Pair:\n  head: int\n  second: int\nfn f(p: Pair) -> int:\n  match p:\n    case Pair{head as first}: first\n',
    });
    expect(renamed(program, named('main', 'first', 1), 'head')).toEqual({
      main: `${pair}fn f(p: Pair) -> int:\n  match p:\n    case Pair{first as head}: head\n`,
    });
  });

  it('refuses what std declares', () => {
    const { program, named } = navigable({ main: 'fn f() -> int?: Some{value: 1}\n' });
    expect(refusalOf(program, named('main', 'Some'))).toContain('std:prelude');
  });

  it('refuses a name a type may meet a trait by, or the language calls', () => {
    const { program, named } = navigable({
      main: 'trait Shows:\n  label: string\n  fn show(self: Self) -> string\nstruct Point:\n  label: string\nfn show(self: Point) -> string: self.label\nfn main(): 0\n',
    });
    for (const use of [
      named('main', 'show'),
      named('main', 'show', 1),
      named('main', 'label', 1),
      named('main', 'main'),
    ]) {
      expect(refusalOf(program, use)).toContain('trait');
    }
  });

  it("refuses renaming a method's receiver, or to a name the language reads", () => {
    const { program, named } = navigable({
      main: 'struct Box:\n  value: int\nfn get(self: Box) -> int: self.value\nfn put(box: Box) -> int: box.value\n',
    });
    expect(refusalOf(program, named('main', 'self'))).toContain('method');
    for (const newName of ['toString', 'main', 'iterate']) {
      expect(renamed(program, named('main', 'get'), newName)).toMatchObject({ kind: 'refused' });
    }
    expect(renamed(program, named('main', 'box'), 'self')).toMatchObject({ kind: 'refused' });
    expect(renamed(program, named('main', 'box'), 'toString')).toEqual({
      main: 'struct Box:\n  value: int\nfn get(self: Box) -> int: self.value\nfn put(toString: Box) -> int: toString.value\n',
    });
  });

  it('refuses a new name that is none, or changes privacy or case', () => {
    const { program, named } = navigable({ main: 'fn tally(x: int) -> int: x\n' });
    const tally = named('main', 'tally');
    for (const newName of ['', 'a b', 'if', '_', '1x', '_tally', 'Tally', 'tal-ly']) {
      expect(renamed(program, tally, newName)).toMatchObject({ kind: 'refused' });
    }
    expect(renamed(program, tally, 'count')).toEqual({ main: 'fn count(x: int) -> int: x\n' });
  });

  it('has nothing to rename where no name stands', () => {
    const { program, named } = navigable({ main: 'fn tally(x: int) -> int: x\n' });
    expect(renamingAt(program, named('main', 'tally').module, 0)).toBeUndefined();
  });
});

describe('renaming what is named together with another declaration', () => {
  it('refuses one overload of a name imported or called with another', () => {
    const { program, named } = navigable({
      main: "import scale from 'lib'\nfn main() -> int: scale(1) + int(scale(2.0))\n",
      lib: 'fn scale(x: int) -> int: x\nfn scale(x: float) -> float: x\n',
    });
    expect(renamed(program, named('lib', 'scale'), 'scaleInt')).toMatchObject({ kind: 'refused' });
    expect(renamed(program, named('main', 'scale', 1), 'scaleInt')).toMatchObject({
      kind: 'refused',
    });
  });

  it("judges an async function's own call as the function it names", () => {
    const { program, named } = navigable({
      main: 'trait Runner:\n  async fn run(self: Self)\nstruct Worker:\n  n: int\nasync fn run(self: Worker):\n  await run.disposing()\nasync fn work():\n  await work.disposing()\nfn main(): 0\n',
    });
    expect(refusalOf(program, named('main', 'run', 2))).toContain('trait');
    expect(renamed(program, named('main', 'work', 1), 'toJson')).toMatchObject({
      kind: 'refused',
    });
  });

  it('renames the function a shorthand reads, spelling the shorthand out', () => {
    const { program, named } = navigable({
      main: 'struct Handler:\n  run: fn(int) -> int\nfn run(x: int) -> int: x\nfn handler() -> Handler: Handler{run}\n',
    });
    expect(renamed(program, named('main', 'run', 2), 'step')).toEqual({
      main: 'struct Handler:\n  run: fn(int) -> int\nfn step(x: int) -> int: x\nfn handler() -> Handler: Handler{run: step}\n',
    });
  });
});
