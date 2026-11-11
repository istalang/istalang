/**
 * Completion where a statement or an operand starts offers the words the grammar takes there, and
 * only those: over the corpus's statements and declared values, each word offered, written at the
 * cursor, is read by the parser without an error at it, and each keyword the parser reads there so
 * is offered. A contextual word is a name wherever a keyword isn't, so the parser reads any; those
 * the parser starts something with are offered by type, as its tables and completion share one list
 * of them (syntax/tokens/grammar-words.ts). What a word needs around it (a loop, an async body, a
 * function's body, an open `if`) and what a name must be (a function, a variable, a label) are
 * cases of their own.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../../../../test/corpus/programs.ts';
import { parserDiagnostics } from '../../../../../compiler/parser/diagnostics.ts';
import { parse } from '../../../../../compiler/parser/parse.ts';
import { scan } from '../../../../../compiler/scanner/scan.ts';
import { keywords } from '../../../../../compiler/syntax/tokens/index.ts';
import { nodesUnder } from '../../../../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../../../../compiler/syntax/tree/positions.ts';
import { createSourceText } from '../../../../../foundation/text/source-text.ts';
import { type MainProgram, mainProgram, programAt } from '../../../language-service.test-kit.ts';
import { completionsAt } from '../../index.ts';
import { ifClauseWords, wordNeeds } from './words.ts';

/** A position in a program's text where a statement or an operand starts. */
interface Site {
  readonly text: string;
  readonly offset: number;
  /** Text written after an offered word, so the line holds what followed the cursor. */
  readonly after: string;
}

/** A corpus program's text and tree. */
type Parsed = Pick<MainProgram, 'tree'> & { readonly text: string };

/** A line of its own before each statement standing first on its line, indented alike. */
function statementSites({ text, tree }: Parsed): readonly Site[] {
  return nodesUnder(tree, tree.root).flatMap((node) => {
    if (node.kind !== 'Block') {
      return [];
    }
    return node.statements.flatMap((statement) => {
      const { start } = spanIn(tree, statement.span);
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const indent = text.slice(lineStart, start);
      return indent.trim() === ''
        ? [
            {
              text: `${text.slice(0, start)}\n${indent}${text.slice(start)}`,
              offset: start,
              after: '',
            },
          ]
        : [];
    });
  });
}

/** The start of each declared value, the word written before the value already there. */
function operandSites({ text, tree }: Parsed): readonly Site[] {
  return nodesUnder(tree, tree.root).flatMap((node) =>
    node.kind === 'VariableDeclaration'
      ? [{ text, offset: spanIn(tree, node.initializer.span).start, after: ' ' }]
      : [],
  );
}

/**
 * The errors a parser reports where a token can't stand: the one it found, an item or a modifier
 * misplaced.
 */
const refusals = new Set(
  [
    parserDiagnostics.expected,
    parserDiagnostics.topLevelStatement,
    parserDiagnostics.declarationInBlock,
    parserDiagnostics.misplacedModifier,
  ].map(({ code }) => code),
);

/** Whether the parser reads `word` written at `site` with no error where it stands. */
function takes({ text, offset, after }: Site, word: string): boolean {
  const source = createSourceText(
    'main.ista',
    text.slice(0, offset) + word + after + text.slice(offset),
  );
  return !parse(source, scan(source)).diagnostics.some(
    ({ code, span }) => refusals.has(code) && span.start === offset,
  );
}

/** The words completion offers only where the code around gives them meaning. */
const situational: ReadonlySet<string> = new Set([...Object.keys(wordNeeds), ...ifClauseWords]);

/**
 * What `site` gets wrong either way: a word offered there that the parser refuses, and a keyword
 * the parser takes there that isn't offered, but for one offered by its surroundings.
 */
function misofferedWords(site: Site): readonly string[] {
  const { program, module } = mainProgram(site.text);
  const offered = completionsAt(program, module, site.offset)
    .filter(({ kind }) => kind === 'keyword')
    .map(({ name }) => name);
  const missing = keywords.filter(
    (word) => !(offered.includes(word) || situational.has(word)) && takes(site, word),
  );
  return [
    ...offered.filter((word) => !takes(site, word)).map((word) => `${word} refused`),
    ...missing.map((word) => `${word} not offered`),
  ];
}

describe('completion offers the words the grammar takes where it stands', () => {
  const programs = runPrograms.map(({ text }) => ({ text, tree: mainProgram(text).tree }));
  const statements = programs.flatMap(statementSites);
  const operands = programs.flatMap(operandSites);

  it('at the statements of the corpus', () => {
    fc.assert(
      fc.property(fc.constantFrom(...statements), (site) => {
        expect(misofferedWords(site)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  }, 60_000);

  it('at the declared values of the corpus', () => {
    fc.assert(
      fc.property(fc.constantFrom(...operands), (site) => {
        expect(misofferedWords(site)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  }, 60_000);

  it("at a declared value a select opens, whose word and `:` read as an indented value's type", () => {
    const text = [
      'ista fn tryTake(s: Slot<Int>) -> Int:',
      '  const got: Int? = select:',
      '    case s.read() as value:',
      '      value',
      '    else:',
      '      none',
      '  got ?? 0',
      '',
    ].join('\n');
    expect(misofferedWords({ text, offset: text.indexOf('select'), after: ' ' })).toEqual([]);
  });
});

function names(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset).map(({ name }) => name);
}

describe('completion asks what encloses a position', () => {
  it.each([
    [
      'a loop in the function',
      ['fn f():', '  for i in [1]:', '    if i == 1:', '      ‸', '  1'],
      ['break', 'continue'],
      [],
    ],
    [
      'a loop around a lambda',
      ['fn f():', '  while true:', '    const g = fn(): { ‸ }', '  1'],
      [],
      ['break', 'continue'],
    ],
    ['an async lambda', ['fn f():', '  const g = async fn(): ‸', '  1'], ['await'], []],
    [
      'a lambda in an async body',
      ['ista async fn f() -> Int:', '  const g = fn(): ‸', '  1'],
      [],
      ['await'],
    ],
    ['a default', ['fn g(a = ‸'], ['true', 'not'], ['await', 'select', 'new', 'let']],
    ["a function's body", ['fn f():', '  let x = ‸', '  1'], ['select', 'new'], ['await']],
    [
      'a statement an annotation above opens',
      ['ista async fn f():', '  @Waypoint{"step"}', '  ‸', '  1'],
      ['let', 'const', 'return'],
      [],
    ],
  ])('%s', (_title, lines, offered, notOffered) => {
    const offers = names(...lines);
    expect(offers).toEqual(expect.arrayContaining(offered));
    expect(offers.filter((name) => notOffered.includes(name))).toEqual([]);
  });

  it.each([
    [
      'a loop around a lambda',
      ['fn f():', '  outer: for i in [1]:', '    const g = fn(): { break ‸ }', '  1'],
      [],
    ],
    ['a labelled block, to hold', ['fn f():', '  batch:', '    hold(‸', '  1'], ['batch']],
    [
      'a labelled block, to break',
      ['fn f():', '  batch:', '    while true:', '      break ‸', '  1'],
      [],
    ],
  ])('labels through %s', (_title, lines, labels) => {
    expect(names(...lines)).toEqual(labels);
  });
});

const infix = ['or', 'and', 'in', 'not', 'is'];
const pair = ['struct Pair:', '  first: Int', ''];

describe('completion offers the words that go on after what is written', () => {
  it.each([
    ['a header before its `:`', ['fn f(n: Bool):', '  if 1 ‸:', '    1']],
    ['a loop header before its `:`', ['fn f(n: Bool):', '  while 1 ‸:', '    1']],
    ["a match's subject before its `:`", ['fn f(n: Int):', '  match 1 ‸:', '    case _: 1']],
    ['a guard', ['fn f(n: Int, a: Bool):', '  match n:', '    case x if 1 ‸: 1']],
    [
      "a comprehension's condition",
      ['fn f(xs: Array<Int>):', '  const e = [for x in xs if 1 ‸: x]'],
    ],
    ["a comprehension's value", ['fn f(xs: Array<Int>):', '  const e = [for x in xs: 1 ‸]']],
    ["a template's value", ['fn f(n: Int):', '  const s = `id ${1 ‸}`']],
    ["a call's argument", ['fn plus(a: Int) -> Int: a', 'fn f(n: Int):', '  plus(1 ‸)']],
    ["a call's named argument", ['fn plus(a: Int) -> Int: a', 'fn f(n: Int):', '  plus(a: 1 ‸)']],
    ["a broken item's later word spelled `shared`", ['x( shared ‸']],
  ])('after an operand in %s', (_title, lines) => {
    expect(names(...lines)).toEqual(infix);
  });

  it.each([
    ['a header before its `:`', ['fn f(n: Bool):', '  if n ‸:', '    1']],
    ['a guard', ['fn f(n: Int, a: Bool):', '  match n:', '    case x if a ‸: 1']],
    ["a template's value", ['fn f(n: Int):', '  const s = `id ${n ‸}`']],
    ["a call's argument", ['fn f(n: Int):', '  plus(n ‸)']],
    ['a name that is no modifier', ['fn f(sendable: Int):', '  let x = sendable ‸', '  1']],
    ['a block, a name spelled `shared`', ['fn f(shared: Int) -> Int:', '  shared ‸', '  0']],
    ['a taker written with arguments', ['fn f(n: Int):', '  _ = retry(times: 5) ‸']],
    ["a method's taker", ['fn f(n: Int):', '  _ = n.submit ‸']],
  ])(
    "after a deferred call's taker in %s, the names starting its call too (§3.14)",
    (_title, lines) => {
      const declared = [
        'fn plus(a: Int) -> Int: a',
        'fn retry(f: fn() -> Int, times: Int) -> Int: f()',
      ];
      const offered = names(...declared, ...lines);
      expect(offered).toEqual(expect.arrayContaining([...infix, 'plus', 'retry']));
      expect(offered.filter((name) => (keywords as readonly string[]).includes(name))).toEqual(
        infix,
      );
    },
  );

  it("offers nothing right against a deferred call's taker, which a name would join", () => {
    expect(names('fn plus(a: Int) -> Int: a', 'fn f():', '  _ = plus(1)‸')).toEqual([]);
  });

  it.each([
    ['`hold` starting a line', ['fn f():', '  hold ‸', '  1'], ['let', 'const']],
    ['`hold` after a `;`', ['fn f():', '  const a = 1; hold ‸', '  1'], ['let', 'const']],
    ['`hold` in a block', ['fn f():', '  const a = { hold ‸ }', '  1'], ['let', 'const']],
    ['`hold` and its label', ['fn f():', '  batch:', '    hold(batch) ‸', '  1'], ['let', 'const']],
    ['`not` after an operand', ['fn f(n: Int):', '  let x = n not ‸', '  1'], ['in']],
    ['`sendable` in a type', ['type F = sendable ‸'], ['fn', 'live', 'ista', 'async']],
    ["`sendable` in a parameter's type", ['fn f(cb: sendable ‸'], ['fn', 'live', 'ista', 'async']],
    ['`shared` below an annotation', ['@Ann', 'shared ‸'], ['struct']],
    ['`sendable` with `fn` begun', ['type F = sendable fn‸'], ['fn', 'live', 'ista', 'async']],
    [
      '`sendable` with `async` begun',
      ['type F = sendable async‸'],
      ['fn', 'live', 'ista', 'async'],
    ],
    ["a comprehension's target", ['fn f(xs: Array<Int>):', '  const e = [for x ‸]'], ['in']],
    ['`extern sendable`', ['extern sendable ‸'], ['struct']],
    ['`extern shared`', ['extern shared ‸'], ['struct']],
    ['`extern live`', ['extern live ‸'], ['fn', 'async', 'struct']],
    ['`extern ista`', ['extern ista ‸'], ['fn', 'async']],
    ['`ista` starting a top-level item', ['ista ‸'], ['fn', 'async', 'const']],
    ['`live` in a type', ['type F = live ‸'], ['fn', 'async']],
    ['`ista` in a trait', ['trait T:', '  ista ‸'], ['fn', 'async']],
    ['a range', ['fn f():', '  let r = 0..10 ‸', '  1'], ['or', 'and', 'in', 'not', 'is', 'by']],
    [
      'a range with its step',
      ['fn f():', '  let r = 0..10 by 2 ‸', '  1'],
      ['or', 'and', 'in', 'not', 'is'],
    ],
  ])('after %s', (_title, lines, words) => {
    expect(names(...lines)).toEqual(words);
  });
});

describe('completion where a name is declared', () => {
  it.each([
    ['a local function', ['fn f():', '  fn ‸', '  1'], []],
    ["a function's later parameter", ['fn g(a: Int, ‸'], []],
    ["a lambda's first parameter", ['fn f():', '  const g = fn(‸'], []],
    ["a function's first parameter", ['fn g(‸'], ['self']],
    ["a trait's function's first parameter", ['trait T:', '  fn g(‸'], ['self']],
    ["a local function's first parameter", ['fn f():', '  fn local(‸'], []],
    ["a static function's first parameter", [...pair, 'fn Pair.zero(‸'], []],
    ["a static function's name, its type written", [...pair, 'fn Pair. ‸'], []],
    ["a trait's function's name", ['trait T:', '  fn ‸'], ['Self']],
  ])('%s', (_title, lines, offered) => {
    expect(names(...lines)).toEqual(offered);
  });
});

it("completion offers types, not traits, in a bound's type arguments", () => {
  const offers = names('trait Shape:', '  fn area(self: Self) -> Float', 'fn g<T is Array<‸');
  expect(offers).toEqual(expect.arrayContaining(['Int', 'Array']));
  expect(offers).not.toContain('Shape');
});

it("completion offers a static's types where its type is written before its name", () => {
  const offers = names(...pair, 'fn first(p: Pair) -> Int: p.first', 'fn Pa‸ir.zero() -> Int: 1');
  expect(offers).toEqual(expect.arrayContaining(['Pair', 'Int']));
  expect(offers).not.toContain('first');
});

it("completion offers an operand after a comprehension's `in` inside a template's value", () => {
  const offers = names('fn f(xs: Array<Int>):', '  const s = `${[for x in ‸: x]}`', '  1');
  expect(offers).toEqual(expect.arrayContaining(['xs', 'not']));
  expect(offers).not.toContain('in');
});

it.each([
  ["another template's value", ['fn f(b: Bool):', '  const s = `${b}:${not ‸}`', '  1']],
  ['a line', ['fn f(b: Bool):', '  const t = b', '  const s = `${not ‸}`', '  1']],
])(
  "completion offers an operand after `not` opening a template's value, past %s",
  (_title, lines) => {
    const offers = names(...lines);
    expect(offers).toEqual(expect.arrayContaining(['b', 'not']));
    expect(offers).not.toContain('in');
  },
);

describe('completion offers `elif` and `else` after an `if` chain still open', () => {
  it.each([
    ['a declared value', ['fn f(n: Bool) -> Int:', '  const x = if n:', '    1', '  ‸', '  0']],
    ['a returned value', ['fn f(n: Bool) -> Int:', '  return if n:', '    1', '  ‸', '  0']],
    [
      'an assigned value',
      ['fn f(n: Bool) -> Int:', '  let x = 0', '  x = if n:', '    1', '  ‸', '  0'],
    ],
  ])('ending %s', (_title, lines) => {
    expect(names(...lines)).toEqual(expect.arrayContaining(['elif', 'else']));
  });

  it("but not after one inside a block's last statement", () => {
    const nested = ['fn f(n: Bool) -> Int:', '  if n:', '    1', '  else:', '    if n:', '      2'];
    expect(names(...nested, '  ‸', '  0')).not.toContain('else');
  });
});

describe('completion after `&` offers what may be referenced', () => {
  it('a reference parameter, its `&` written in parentheses too', () => {
    const offered = names('fn bump(n: &Int):', '  n += 1', 'fn f(m: (&Int)):', '  bump(&‸');
    expect(offered).toContain('m');
  });
});
