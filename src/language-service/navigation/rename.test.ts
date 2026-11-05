/**
 * Renaming declarations in single programs: every name spelled anew, shorthands spelled out, keys
 * naming a field renamed with it, and each refusal with its reason.
 */

import { describe, expect, it } from 'vitest';
import type { Program } from '../../compiler/program/program.ts';
import type { NamePlace } from './declarations.ts';
import { spanOfUse } from './declarations.ts';
import { edited, navigable } from './navigation.test-kit.ts';
import { renameEdits, renamingAt } from './rename.ts';

const pair = 'struct Pair:\n  first: Int\n  second: Int\n';

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
      main: "import tally from 'lib'\nfn main() -> Int: tally(1)\n",
      lib: 'fn tally(x: Int) -> Int: x\n',
    });
    expect(renamed(program, named('main', 'tally', 1), 'count')).toEqual({
      main: "import count from 'lib'\nfn main() -> Int: count(1)\n",
      lib: 'fn count(x: Int) -> Int: x\n',
    });
  });

  it("spells a literal's shorthand out, for its field or its variable", () => {
    const { program, named } = navigable({
      main: `${pair}fn f(first: Int) -> Pair: Pair{first, second: 2}\n`,
    });
    expect(renamed(program, named('main', 'first'), 'head')).toEqual({
      main: 'struct Pair:\n  head: Int\n  second: Int\nfn f(first: Int) -> Pair: Pair{head: first, second: 2}\n',
    });
    expect(renamed(program, named('main', 'first', 2), 'head')).toEqual({
      main: `${pair}fn f(head: Int) -> Pair: Pair{first: head, second: 2}\n`,
    });
  });

  it("spells a pattern's shorthand out, for its field or its variable", () => {
    const { program, named } = navigable({
      main: `${pair}fn f(p: Pair) -> Int:\n  match p:\n    case Pair{first}: first\n`,
    });
    expect(renamed(program, named('main', 'first'), 'head')).toEqual({
      main: 'struct Pair:\n  head: Int\n  second: Int\nfn f(p: Pair) -> Int:\n  match p:\n    case Pair{head as first}: first\n',
    });
    expect(renamed(program, named('main', 'first', 1), 'head')).toEqual({
      main: `${pair}fn f(p: Pair) -> Int:\n  match p:\n    case Pair{first as head}: head\n`,
    });
  });

  it("refuses a shape's field, and a struct's whose field names a shape has (§3.1)", () => {
    const { program, named } = navigable({
      main: 'type Point = { x: Int; y: Int }\nstruct Pixel { y: Int; x: Int }\nshared struct Lease { name: String }\nfn f(v: { name: String }) -> String: v.name\nstruct Size { width: Int }\n',
    });
    for (const use of [named('main', 'x'), named('main', 'x', 1), named('main', 'name')]) {
      expect(refusalOf(program, use)).toContain('shape');
    }
    expect(refusalOf(program, named('main', 'width'))).toBeUndefined();
  });

  it('renames the String literals that name a field as its key, and only those (§3.1)', () => {
    const { program, named } = navigable({
      main: [
        'struct Settings { retries: Int; region: String; zone: String }',
        'type Retries = Settings["retries"]',
        'struct Entry<S is struct, K in keyof S> { key: K; value: S[K] }',
        'type AnyEntry<S is struct> = { [K in keyof S]: Entry<S, K> }[keyof S]',
        'fn pick<S is struct, K in keyof S>(s: S, k: K) -> S[K]: s[k]',
        'fn read(s: Settings) -> String:',
        '  const which: keyof Settings = "region"',
        '  const label = "zone"',
        '  const e: AnyEntry<Settings> = Entry{key: "region", value: "eu"}',
        '  `${s[which]}${s["zone"]}${label}${e.key}${pick(s, "region")}`',
        '',
      ].join('\n'),
    });
    expect(renamed(program, named('main', 'retries'), 'tries')).toEqual({
      main: expect.stringContaining('type Retries = Settings["tries"]'),
    });
    const regionRenamed = renamed(program, named('main', 'region'), 'area');
    for (const renamedUse of ['keyof Settings = "area"', 'Entry{key: "area"', 'pick(s, "area")']) {
      expect(regionRenamed).toEqual({ main: expect.stringContaining(renamedUse) });
    }
    const zoneRenamed = renamed(program, named('main', 'zone'), 'place');
    for (const spelled of ['s["place"]', 'const label = "zone"']) {
      expect(zoneRenamed).toEqual({ main: expect.stringContaining(spelled) });
    }
  });

  it('renames a key given as a type argument, and one a literal pattern matches (§3.1, §4)', () => {
    const { program, named } = navigable({
      main: [
        'struct Settings { retries: Int; region: String }',
        'struct Entry<S is struct, K in keyof S> { key: K; value: S[K] }',
        'fn kinds(s: Settings) -> String:',
        '  const e: Entry<Settings, "region"> = Entry{key: "region", value: "eu"}',
        '  let out = e.value',
        '  for k, _ in ...s:',
        '    match k:',
        '      case "region": out = `${out}!`',
        '      case _: out = out',
        '  out',
        '',
      ].join('\n'),
    });
    const regionRenamed = renamed(program, named('main', 'region'), 'area');
    for (const renamedUse of ['Entry<Settings, "area">', 'case "area"']) {
      expect(regionRenamed).toEqual({ main: expect.stringContaining(renamedUse) });
    }
  });

  it('refuses an associated type a trait requires by its name', () => {
    const { program, named } = navigable({
      main: [
        'trait Keyed:',
        '  type Key',
        'struct User:',
        '  id: Int',
        '  type Key = Int',
        '  type Other = String',
        '',
      ].join('\n'),
    });
    expect(refusalOf(program, named('main', 'Key', 1))).toContain('trait');
    expect(refusalOf(program, named('main', 'Other'))).toBeUndefined();
  });

  it('refuses a field a struct constraint names, in a bound or a type `match` case (§3.5)', () => {
    const { program, named } = navigable({
      main: [
        'struct Page:',
        '  title: String',
        '  body: String',
        '  id: Int',
        'fn show<S is struct { title: String; [_] is Stringable }>(s: S) -> String: s.title',
        'type IdOf<D> = match D:',
        '  case struct { id: infer K }: K',
        '',
      ].join('\n'),
    });
    expect(refusalOf(program, named('main', 'title'))).toContain('struct constraint');
    expect(refusalOf(program, named('main', 'id'))).toContain('struct constraint');
    expect(refusalOf(program, named('main', 'body'))).toBeUndefined();
  });

  it('refuses a field a shared struct and a struct share, the one spreading into the other (§3.18)', () => {
    const { program, named } = navigable({
      main: 'shared struct Lease { name: String }\nstruct Plain { name: String }\nstruct Other { size: Int }\nshared struct Cell { size: Int }\nshared struct Lone { count: Int }\n',
    });
    for (const use of [named('main', 'name'), named('main', 'name', 1), named('main', 'size')]) {
      expect(refusalOf(program, use)).toContain('shape');
    }
    expect(refusalOf(program, named('main', 'count'))).toBeUndefined();
  });

  it('refuses what std declares', () => {
    const { program, named } = navigable({ main: 'fn f() -> Result<Int>: Ok{value: 1}\n' });
    expect(refusalOf(program, named('main', 'Ok'))).toContain('std:prelude');
  });

  it('refuses a name a type may meet a trait by, or the language calls', () => {
    const { program, named } = navigable({
      main: 'trait Shows:\n  label: String\n  fn show(self: Self) -> String\nstruct Point:\n  label: String\nfn show(self: Point) -> String: self.label\nfn main(): 0\n',
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
      main: 'struct Box:\n  value: Int\nfn get(self: Box) -> Int: self.value\nfn put(box: Box) -> Int: box.value\n',
    });
    expect(refusalOf(program, named('main', 'self'))).toContain('method');
    for (const newName of ['toString', 'main', 'iterate']) {
      expect(renamed(program, named('main', 'get'), newName)).toMatchObject({ kind: 'refused' });
    }
    expect(renamed(program, named('main', 'box'), 'self')).toMatchObject({ kind: 'refused' });
    expect(renamed(program, named('main', 'box'), 'toString')).toEqual({
      main: 'struct Box:\n  value: Int\nfn get(self: Box) -> Int: self.value\nfn put(toString: Box) -> Int: toString.value\n',
    });
  });

  it('refuses a new name that is none, or changes privacy or case', () => {
    const { program, named } = navigable({ main: 'fn tally(x: Int) -> Int: x\n' });
    const tally = named('main', 'tally');
    for (const newName of ['', 'a b', 'if', '_', '1x', '_tally', 'Tally', 'tal-ly']) {
      expect(renamed(program, tally, newName)).toMatchObject({ kind: 'refused' });
    }
    expect(renamed(program, tally, 'count')).toEqual({ main: 'fn count(x: Int) -> Int: x\n' });
  });

  it("refuses a built-in type's name for a type or a variant", () => {
    const { program, named } = navigable({ main: 'struct Foo {}\nenum Shade { Dark; Light }\n' });
    for (const newName of ['Int', 'Never', 'Self']) {
      expect(renamed(program, named('main', 'Foo'), newName)).toMatchObject({ kind: 'refused' });
    }
    expect(renamed(program, named('main', 'Dark'), 'Bool')).toMatchObject({ kind: 'refused' });
    expect(renamed(program, named('main', 'Foo'), 'Bar')).toEqual({
      main: 'struct Bar {}\nenum Shade { Dark; Light }\n',
    });
  });

  it('has nothing to rename where no name stands', () => {
    const { program, named } = navigable({ main: 'fn tally(x: Int) -> Int: x\n' });
    expect(renamingAt(program, named('main', 'tally').module, 0)).toBeUndefined();
  });
});

describe('renaming what is named together with another declaration', () => {
  it('refuses one overload of a name imported or called with another', () => {
    const { program, named } = navigable({
      main: "import scale from 'lib'\nfn main() -> Int: scale(1) + Int(scale(2.0))\n",
      lib: 'fn scale(x: Int) -> Int: x\nfn scale(x: Float) -> Float: x\n',
    });
    expect(renamed(program, named('lib', 'scale'), 'scaleInt')).toMatchObject({ kind: 'refused' });
    expect(renamed(program, named('main', 'scale', 1), 'scaleInt')).toMatchObject({
      kind: 'refused',
    });
  });

  it("judges an async function's own call as the function it names", () => {
    const { program, named } = navigable({
      main: 'trait Runner:\n  async fn run(self: Self)\nstruct Worker:\n  n: Int\nasync fn run(self: Worker):\n  await run.disposing()\nasync fn work():\n  await work.disposing()\nfn main(): 0\n',
    });
    expect(refusalOf(program, named('main', 'run', 2))).toContain('trait');
    expect(renamed(program, named('main', 'work', 1), 'toJson')).toMatchObject({
      kind: 'refused',
    });
  });

  it('renames the function a shorthand reads, spelling the shorthand out', () => {
    const { program, named } = navigable({
      main: 'struct Handler:\n  run: fn(Int) -> Int\nfn run(x: Int) -> Int: x\nfn handler() -> Handler: Handler{run}\n',
    });
    expect(renamed(program, named('main', 'run', 2), 'step')).toEqual({
      main: 'struct Handler:\n  run: fn(Int) -> Int\nfn step(x: Int) -> Int: x\nfn handler() -> Handler: Handler{run: step}\n',
    });
  });
});
