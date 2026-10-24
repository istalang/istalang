/**
 * What names resolve to (§3.3, §3.4, §3.5, §3.10, §3.11, §3.13, §3.14): each case names a use and
 * the declaration it must reach, both by their text and occurrence, so the case reads as its source.
 */

import { describe, expect, it } from 'vitest';
import { type Files, idOf } from '../program/program.test-kit.ts';
import { declaringName, entityOfName, namesIn, preludeProgramOf } from './bind.test-kit.ts';
import { bindProgram } from './bind.ts';
import type { Entity } from './entities.ts';

const lib = 'struct Shape { radius: int }\nfn helper(): 1\nenum Color { Red; Green }';

interface Case {
  readonly source: string;
  readonly name: string;
  /** Which occurrence of `name` in main is the use. */
  readonly use: number;
  /** Which occurrence of `name` declares it, and in which module (default: main). */
  readonly declaredAt: number;
  readonly module?: string;
}

const cases: Readonly<Record<string, Case>> = {
  'a parameter default sees an earlier parameter': {
    source: 'fn window(start: int, end: int = start + 10): end',
    name: 'start',
    use: 1,
    declaredAt: 0,
  },
  'an inner block shadows from its declaration on': {
    source: 'fn f() -> int:\n  const x = 1\n  if true:\n    const x = 2\n    drop x\n  x',
    name: 'x',
    use: 2,
    declaredAt: 1,
  },
  'the outer name returns once the inner block ends': {
    source: 'fn f() -> int:\n  const x = 1\n  if true:\n    const x = 2\n    drop x\n  x',
    name: 'x',
    use: 3,
    declaredAt: 0,
  },
  'before an inner declaration, the outer name is seen': {
    source: 'fn f():\n  const x = 1\n  if true:\n    drop x\n    const x = 2',
    name: 'x',
    use: 1,
    declaredAt: 0,
  },
  'an is binding flows into the if body': {
    source: 'fn f(r: Result<int>) -> int:\n  if r is Ok{value as v}:\n    v\n  else:\n    0',
    name: 'v',
    use: 1,
    declaredAt: 0,
  },
  'an is binding flows across and': {
    source: 'fn f(r: Result<int>) -> bool: r is Ok{value} and value > 0',
    name: 'value',
    use: 1,
    declaredAt: 0,
  },
  'a comprehension condition flows into its body': {
    source: 'fn f(rs: Array<Result<int>>) -> Array<int>: [for r in rs if r is Ok{value}: value]',
    name: 'value',
    use: 1,
    declaredAt: 0,
  },
  'a guard sees its case bindings': {
    source: 'fn f(p: (int, int)) -> int:\n  match p:\n    case (a, b) if a > b: a\n    case _: 0',
    name: 'a',
    use: 1,
    declaredAt: 0,
  },
  'a select case binds its value': {
    source: 'async fn f(g: Future<int>) -> Future<int>:\n  await select:\n    case g as got: got',
    name: 'got',
    use: 1,
    declaredAt: 0,
  },
  'a named lambda calls itself': {
    source:
      'fn f() -> int:\n  const fact = fn self(n: int) -> int: if n < 2: 1 else: n * self(n - 1)\n  fact(3)',
    name: 'self',
    use: 1,
    declaredAt: 0,
  },
  'a local function calls itself': {
    source: 'fn f() -> int:\n  fn loop(n: int) -> int: if n > 0: loop(n - 1) else: 0\n  loop(3)',
    name: 'loop',
    use: 1,
    declaredAt: 0,
  },
  'a struct shorthand reads the variable': {
    source: 'struct P { first: int }\nfn f(first: int) -> P: P{first}',
    name: 'first',
    use: 2,
    declaredAt: 1,
  },
  'a top-level function is found before its declaration': {
    source: 'fn f() -> int: g()\nfn g() -> int: 1',
    name: 'g',
    use: 0,
    declaredAt: 1,
  },
  'a type parameter in a field': {
    source: 'struct Box<T> { value: T }',
    name: 'T',
    use: 1,
    declaredAt: 0,
  },
  'Self inside a trait': {
    source: 'trait Zero:\n  fn Self.zero() -> Self',
    name: 'Zero',
    use: 0,
    declaredAt: 0,
  },
  'a static function owner': {
    source: 'struct Money { cents: int }\nfn Money.zero() -> Money: Money{cents: 0}',
    name: 'Money',
    use: 1,
    declaredAt: 0,
  },
  'a qualified variant': {
    source: 'enum Light { Red; Amber }\nfn f() -> Light: Light.Amber',
    name: 'Amber',
    use: 1,
    declaredAt: 0,
  },
  'an imported function': {
    source: "import helper from 'lib'\nfn f() -> int: helper()",
    name: 'helper',
    use: 1,
    declaredAt: 0,
    module: 'lib',
  },
  'a namespace member': {
    source: "import * as m from 'lib'\nfn f(s: m.Shape) -> int: s.radius",
    name: 'Shape',
    use: 0,
    declaredAt: 0,
    module: 'lib',
  },
  'a variant through a namespace': {
    source: "import * as m from 'lib'\nfn f() -> m.Color: m.Color.Green",
    name: 'Green',
    use: 0,
    declaredAt: 0,
    module: 'lib',
  },
};

describe('a use resolves to its declaration', () => {
  it.each(Object.entries(cases))('%s', (_, { source, name, use, declaredAt, module = 'main' }) => {
    const program = preludeProgramOf({ main: source, lib } satisfies Files);
    const resolved = declaringName(entityOfName(program, 'main', name, use));
    expect(resolved).toBeDefined();
    expect(resolved).toBe(namesIn(program, module, name)[declaredAt]);
  });
});

describe('what a name denotes', () => {
  const kindOf = (source: string, name: string, use = 0) =>
    entityOfName(preludeProgramOf({ main: source, lib }), 'main', name, use)?.kind;

  it.each([
    ['a primitive type', 'fn f(x: int): x', 'int', 'primitive'],
    ['a prelude type', 'fn f(r: Result<int>): r', 'Result', 'type'],
    ['Self in a trait', 'trait Zero:\n  fn Self.zero() -> Self', 'Self', 'self'],
    ['a namespace', "import * as m from 'lib'\nfn f(): m.helper()", 'm', 'namespace'],
    [
      'a bare variant, by expected type',
      "import Color from 'lib'\nfn f() -> Color: Red",
      'Red',
      'variants',
    ],
    [
      'a PascalCase name in a pattern',
      'fn f(o: int?) -> int:\n  match o:\n    case None: 0\n    case _: 1',
      'None',
      'variants',
    ],
    [
      'a camelCase name in a pattern',
      'fn f(p: (int, int)) -> int:\n  match p:\n    case (a, _): a',
      'a',
      'variable',
    ],
  ])('%s', (_, source, name, kind) => {
    expect(kindOf(source, name)).toBe(kind);
  });

  it('a module function named like a prelude one overloads it, seen the same way everywhere', () => {
    const book = 'struct Book { title: string }\nfn read(self: Book) -> string: self.title';
    const main = "import * as books from 'books'\nfn f(b: books.Book) -> string: books.read(b)";
    const program = preludeProgramOf({ main, books: book });
    const inBooks = entityOfName(program, 'books', 'read', 0);
    const throughNamespace = entityOfName(program, 'main', 'read', 0);
    const overloads = (entity: Entity | undefined) =>
      entity?.kind === 'functions' ? bindProgram(program).overloadsOf(entity) : [];
    expect(throughNamespace).toBe(inBooks);
    const imported = preludeProgramOf({ main: "import read from 'books'", books: book });
    expect(bindProgram(imported).diagnosticsOf(idOf('main'))).toEqual([]);
    expect(entityOfName(imported, 'main', 'read', 0)).toBe(
      entityOfName(imported, 'books', 'read', 0),
    );
    expect(bindProgram(program).exportsOf(idOf('books')).get('read')).toBe(inBooks);
    expect(overloads(inBooks)).toHaveLength(2);
  });

  it('keeps every entity of an unchanged module across snapshots', () => {
    const files = {
      main: 'struct Book { title: string }\nfn read(self: Book) -> string: self.title\nenum V { A; B }\nfn g() -> V: A',
      other: 'fn x() -> int: 1',
    };
    const before = preludeProgramOf(files);
    const after = preludeProgramOf({ ...files, other: 'fn x() -> int: 2' }, before);
    for (const [name, use] of [
      ['read', 0],
      ['A', 1],
      ['Book', 1],
      ['self', 1],
    ] as const) {
      expect(entityOfName(after, 'main', name, use)).toBe(entityOfName(before, 'main', name, use));
    }
  });

  it('a member of a value is left to the checker', () => {
    const source = 'struct P { x: int }\nfn f(p: P) -> int: p.x';
    expect(kindOf(source, 'x', 1)).toBeUndefined();
  });
});
