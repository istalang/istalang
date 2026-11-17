/**
 * The names visible at an offset are what a name written there resolves to (§3.4, §3.11, §3.13):
 * at every name the binder resolved through its scopes, the prelude or a bare variant, over the
 * whole corpus and every std module; and, at offsets no name stands at, what each scope rule says.
 */

import { describe, expect, it } from 'vitest';
import { wholeProgramTimeout } from '../../compile.test-kit.ts';
import { idOf, moduleAt, textSpanOf } from '../../program/program.test-kit.ts';
import { type ModuleId, type Program, programModule } from '../../program/program.ts';
import type { Block } from '../../syntax/statements/index.ts';
import { nodesUnder } from '../../syntax/tree/index.ts';
import {
  boundCorpus,
  type CorpusProgram,
  entityOfName,
  isLookedUp,
  resolvedNames,
  stdProgramOf,
} from '../bind.test-kit.ts';
import { bindProgram } from '../bind.ts';
import type { Entity } from '../entities.ts';

/** A program of the std modules and `main`, which must bind without a diagnostic. */
function cleanProgram(files: Readonly<Record<string, string>>): Program {
  const program = stdProgramOf(files);
  const diagnostics = Object.keys(files).flatMap((key) => [
    ...moduleAt(program, key).tree.diagnostics,
    ...bindProgram(program).diagnosticsOf(idOf(key)),
  ]);
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map(({ message }) => message).join('\n'));
  }
  return program;
}

/** What `visibleAt` gives in main where `marker` first starts. */
function visibleAtMarker(program: Program, marker: string): ReadonlyMap<string, Entity> {
  const { text } = moduleAt(program, 'main').tree.source;
  return bindProgram(program).visibleAt(idOf('main'), text.indexOf(marker));
}

/**
 * The blocks of `modules` whose first statement sees a name the spot just before it doesn't, but
 * for a local function's own, visible in its declaration (§3.14).
 */
function blocksSeeingMoreThanBefore({ program, modules }: CorpusProgram): readonly string[] {
  const bindings = bindProgram(program);
  const seesMore = (module: ModuleId, block: Block) => {
    const { start } = textSpanOf(program, module, block);
    const before = bindings.visibleAt(module, start - 1);
    const declaredByFirst = (entity: Entity) =>
      entity.kind === 'variable' && entity.owner === block.statements[0];
    return [...bindings.visibleAt(module, start)].some(
      ([name, entity]) => before.get(name) !== entity && !declaredByFirst(entity),
    );
  };
  return modules.flatMap((module) => {
    const { tree } = programModule(program, module);
    return nodesUnder(tree, tree.root)
      .filter((node): node is Block => node.kind === 'Block' && node.span.from < node.span.to)
      .filter((block) => seesMore(module, block))
      .map((block) => `${module}:${textSpanOf(program, module, block).start}`);
  });
}

const cursor = '‸';

/** What `visibleAt` gives in main where `‸` stands, the mark taken out; main may be broken. */
function visibleAtCursor(main: string): ReadonlyMap<string, Entity> {
  const program = stdProgramOf({ main: main.replace(cursor, '') });
  return bindProgram(program).visibleAt(idOf('main'), main.indexOf(cursor));
}

/** Spots no node holds, where a name written would still resolve: what it sees, what it doesn't. */
const spots: readonly (readonly [string, string, readonly string[], readonly string[]])[] = [
  [
    "a blank line before a function body's first statement",
    'fn f<T>(x: T) -> Int:\n  ‸\n  let a = 1\n  a\n',
    ['f', 'T', 'x'],
    ['a'],
  ],
  ['a missing lambda body', 'const g = fn loop(x: Int) -> Int: ‸\n', ['g', 'loop', 'x'], []],
  ['a missing parameter default', 'fn f(start: Int, end: Int = ‸): 1\n', ['start'], ['end']],
  [
    'a missing field default',
    'struct Box<T>:\n  x: Int = 1\n  y: Int = ‸\n  z: Int = 3\n',
    ['T', 'x'],
    ['y', 'z'],
  ],
  ['a blank line in a trait', 'trait Boxed<T>:\n  ‸\n  fn get(self) -> T\n', ['Self', 'T'], []],
  ["a trait function's name not written yet", 'trait Boxed<T>:\n  fn ‸', ['Self', 'T'], []],
  [
    "a line below a trait's last member",
    'trait Boxed<T>:\n  fn get(self) -> T\n  ‸',
    ['Self', 'T'],
    [],
  ],
  ['a line past a trait', 'trait Boxed<T>:\n  fn get(self) -> T\n‸', [], ['Self', 'T']],
  [
    "a line below a trait's default method",
    'trait Boxed<T>:\n  fn get(self) -> Int:\n    1\n  ‸',
    ['Self', 'T'],
    [],
  ],
  ['a trait with no member yet', 'trait Boxed<T>:\n  ‸', ['Self', 'T'], []],
  [
    "a blank line before an `if` body's first statement",
    'fn f(o: Int?) -> Int:\n  if o is Int as value:\n    ‸\n    value\n  else:\n    0\n',
    ['o', 'value'],
    [],
  ],
  [
    'an `else` body, which no `is` binding reaches',
    'fn f(o: Int?) -> Int:\n  if o is Int as value:\n    value\n  else:\n    ‸\n    0\n',
    ['o'],
    ['value'],
  ],
  [
    'a missing right side of `and`',
    'fn f(o: Int?) -> Bool: o is Int as value and ‸\n',
    ['value'],
    [],
  ],
  [
    'a missing guard',
    'fn f(o: Int?) -> Int:\n  match o:\n    case Int as value if ‸:\n      value\n    case _: 0\n',
    ['value'],
    [],
  ],
  [
    "a blank line before a loop body's first statement",
    'fn f(xs: Array<Int>) -> Int:\n  for x in xs:\n    ‸\n    x\n  0\n',
    ['x', 'xs'],
    [],
  ],
  [
    "a blank line before a `while` body's first statement",
    'fn f(o: Int?) -> Int:\n  while o is Int as value:\n    ‸\n    value\n  0\n',
    ['value'],
    [],
  ],
  [
    'a missing loop iterable, which sees no loop variable',
    'fn f(xs: Array<Int>) -> Int:\n  for x in ‸\n  0\n',
    ['xs'],
    ['x'],
  ],
  [
    'a loop body not written yet, on the line below its header',
    'fn f(xs: Array<Int>) -> Int:\n  for x in xs:\n    ‸\n  0\n',
    ['x', 'xs'],
    [],
  ],
  [
    'an `if` body not written yet, on the line below its header',
    'fn f(o: Int?) -> Int:\n  if o is Int as value:\n    ‸\n  0\n',
    ['o', 'value'],
    [],
  ],
  ['a function body not written yet, at the end of the file', 'fn f(a: Int):\n  ‸', ['a'], []],
  [
    'the line after a body not written yet, at its header’s column',
    'fn f(xs: Array<Int>) -> Int:\n  for x in xs:\n  ‸\n  0\n',
    ['xs'],
    ['x'],
  ],
  [
    "a blank line after a body's last statement, at the end of the file",
    'fn f(a: Int):\n  let b = 1\n  ‸',
    ['a', 'b'],
    [],
  ],
  [
    "a blank line after a nested body's last statement, at its column",
    'fn f(a: Int) -> Int:\n  if a > 0:\n    let b = 1\n    ‸\n  0\n',
    ['a', 'b'],
    [],
  ],
  [
    "a blank line after a nested body, at its header's column",
    'fn f(a: Int) -> Int:\n  if a > 0:\n    let b = 1\n  ‸\n  0\n',
    ['a'],
    ['b'],
  ],
  ['a body below a header over two lines', 'fn f(a: Int,\n     b: Int):\n  ‸', ['a', 'b'], []],
  ['a body below a header a comment ends', 'fn f(a: Int):  # to do\n  ‸', ['a'], []],
  ['a body below a comment', 'fn f(a: Int):\n  # to do\n  ‸', ['a'], []],
  ['a missing comprehension condition', 'fn f(xs: Array<Int>): [for x in xs if ‸: x]\n', ['x'], []],
  [
    "a blank line before a `select` case's body",
    'ista async fn f(box: Mailbox<Int>) -> Int:\n  await select:\n    case box.receive() as message:\n      ‸\n      message\n',
    ['box', 'message'],
    [],
  ],
];

describe('visibleAt', () => {
  it('holds, at every name a lookup resolved, that name as it resolved', {
    timeout: wholeProgramTimeout,
  }, () => {
    const unseen = boundCorpus().flatMap(({ program, modules }) => {
      const bindings = bindProgram(program);
      return modules.flatMap((module) =>
        resolvedNames(program, module)
          .filter((resolved) => isLookedUp(program, resolved))
          .filter(
            ({ name, entity }) =>
              bindings.visibleAt(module, textSpanOf(program, module, name).start).get(name.text) !==
              entity,
          )
          .map(({ name }) => `${module}:${name.span.from} ${name.text}`),
      );
    });
    expect(unseen).toEqual([]);
  });

  it("holds a block's names only after the statement declaring them, blank lines included", () => {
    const main = 'fn main() -> Int:\n  let a = 1\n  \n  let b = a\n  b\n';
    const program = cleanProgram({ main });
    const visible = visibleAtMarker(program, '  \n');
    expect(visible.get('a')).toBe(entityOfName(program, 'main', 'a', 0));
    expect(visible.has('b')).toBe(false);
  });

  it('holds an `is` binding where the match is known to hold, and not past it', () => {
    const main = [
      'fn pick(o: Int?) -> Int:',
      '  if o is Int as value and value > 0:',
      '    value + 1',
      '  else:',
      '    0 + 2',
      '',
    ].join('\n');
    const program = cleanProgram({ main });
    const value = entityOfName(program, 'main', 'value', 0);
    expect(value?.kind).toBe('variable');
    expect(visibleAtMarker(program, 'value > 0').get('value')).toBe(value);
    expect(visibleAtMarker(program, '1\n').get('value')).toBe(value);
    expect(visibleAtMarker(program, '2\n').has('value')).toBe(false);
    expect(visibleAtMarker(program, 'o is').has('value')).toBe(false);
  });

  it('holds imports, the prelude and bare variants at the top level', () => {
    const program = cleanProgram({
      main: "import Shade from 'lib'\n\nfn main(): 1\n",
      lib: 'enum Shade:\n  Light\n  Dark\n',
    });
    const visible = visibleAtMarker(program, '\nfn');
    expect(visible.get('Shade')).toBe(entityOfName(program, 'lib', 'Shade', 0));
    expect(visible.get('main')?.kind).toBe('functions');
    expect(visible.get('Dark')).toEqual({ kind: 'variants', name: 'Dark' });
    const prelude = bindProgram(program).topLevelNamed(idOf('main'), 'take');
    expect(prelude?.kind).toBe('functions');
    expect(visible.get('take')).toBe(prelude);
  });

  it('holds what a parameter default sees: the parameters before it', () => {
    const main = 'fn window(start: Int, end: Int = start + 10, step: Int = 1): end\n';
    const visible = visibleAtMarker(cleanProgram({ main }), 'start + 10');
    expect(['start', 'end', 'step'].map((name) => visible.has(name))).toEqual([true, false, false]);
  });

  it.each(spots)('holds at %s what a name written there would see', (_, main, sees, misses) => {
    const visible = visibleAtCursor(main);
    expect([...sees, ...misses].map((name) => visible.has(name))).toEqual([
      ...sees.map(() => true),
      ...misses.map(() => false),
    ]);
  });

  it("holds before a block's first statement what its first statement sees", {
    timeout: wholeProgramTimeout,
  }, () => {
    expect(boundCorpus().flatMap(blocksSeeingMoreThanBefore)).toEqual([]);
  });

  it("holds the module's top level past every node", () => {
    const main = 'fn main(): 1\n';
    const program = cleanProgram({ main });
    const visible = bindProgram(program).visibleAt(idOf('main'), main.length + 5);
    expect(visible.get('main')?.kind).toBe('functions');
  });
});
