/**
 * Line breaks between items of every bracketed list (proposal 5 §6): when a line break separates
 * two items vs continues the current item, postfix brackets staying on their operand's line,
 * glued vs spaced '-', '*', '&', '..' and '..=', mixed separators, comments and blank lines,
 * '${…}' ignoring breaks, and fast-check properties over generated lists and hostile token runs.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { soupOf } from '../../../../test/soup.ts';
import { createSourceText } from '../../../text/source-text.ts';
import { scan } from '../../scanner/scan.ts';
import { errorNodes, spanViolations, strayBodies } from '../../syntax/tree.test-kit.ts';
import { type Category, dumpClean, lines, reported } from '../parse.test-kit.ts';
import { parse } from '../parse.ts';

describe('every bracketed list kind separated by line breaks (§6)', () => {
  it.each([
    [
      'struct literal with named, shorthand, spread and comprehension items',
      'expression' as const,
      'P{\n  ...base\n  id: "x"\n  qty\n  for k, v in ...rest: [k]: v\n}',
      'P{...base, id: "x", qty, for k, v in ...rest: [k]: v}',
    ],
    [
      'new shared struct literal and anonymous struct literal',
      'expression' as const,
      'new Box<Int>{\n  first: 1\n  second: struct{\n    a: 2\n    b\n  }\n}',
      'new Box<Int>{first: 1, second: struct{a: 2, b}}',
    ],
    [
      'array literal with elements and spreads',
      'expression' as const,
      '[\n  1\n  2\n  ...more\n  (3, "a")\n]',
      '[1, 2, ...more, (3, "a")]',
    ],
    [
      'map literal with entries and spreads',
      'expression' as const,
      '[\n  "a": 1\n  "b": 2\n  ...other\n]',
      '["a": 1, "b": 2, ...other]',
    ],
    [
      'tuple literal and call arguments (positional, spread, named)',
      'expression' as const,
      'retry(\n  (\n    1\n    "a"\n  )\n  ...extra\n  times: 3\n  backoff: 2s\n)',
      'retry((1, "a"), ...extra, times: 3, backoff: 2s)',
    ],
    [
      'lambda parameters',
      'expression' as const,
      'fn(\n  a: Int\n  b: String\n): a',
      'fn(a: Int, b: String): a',
    ],
    [
      'struct, array and tuple patterns',
      'pattern' as const,
      'Pair{\n  first: [\n    a\n    ...mid\n    b\n  ]\n  second: (\n    x\n    y\n  )\n  ...rest\n}',
      'Pair{first: [a, ...mid, b], second: (x, y), ...rest}',
    ],
    [
      'type arguments, tuple types and function type parameters',
      'type' as const,
      'Map<\n  String\n  fn(\n    Int\n    (\n      Bool\n      Float\n    )\n  ) -> Unit\n>',
      'Map<String, fn(Int, (Bool, Float)) -> Unit>',
    ],
    [
      'anonymous struct type and mapped struct type in braces',
      'type' as const,
      '{\n  sku: String\n  [F in keyof S]: S[F]\n  qty: Int\n}',
      '{ sku: String, [F in keyof S]: S[F], qty: Int }',
    ],
    [
      'function parameters, type parameters, struct/enum/trait braces and struct constraints',
      'module' as const,
      lines(
        'struct R<',
        '  A is struct {',
        '    title: String',
        '    [_] is Sendable',
        '  }',
        '  B = Int',
        '> {',
        '  id: A',
        '  value: B = 1',
        '  type Out = A',
        '}',
        'enum Color {',
        '  Red',
        '  RGB {',
        '    r: Int',
        '    g: Int',
        '  }',
        '}',
        'trait Shape {',
        '  fn area(',
        '    self: Self',
        '    scale: Float = 1.0',
        '  ) -> Float',
        '  type Unit',
        '}',
      ),
      lines(
        'struct R<A is struct { title: String, [_] is Sendable }, B = Int> { id: A, value: B = 1, type Out = A }',
        'enum Color { Red, RGB { r: Int, g: Int } }',
        'trait Shape { fn area(self: Self, scale: Float = 1.0) -> Float, type Unit }',
      ),
    ],
  ])('parses %s identically to its comma-separated form', (_name, category, broken, inline) => {
    expect(dumpClean(category, broken)).toBe(dumpClean(category, inline));
  });

  it('keeps a single item in parentheses without a comma as grouped, not a 1-tuple', () => {
    expect(dumpClean('expression', '(\n  1 + 2\n)')).toBe(dumpClean('expression', '(1 + 2)'));
    expect(dumpClean('expression', '(\n  1 + 2,\n)')).toBe(dumpClean('expression', '(1 + 2,)'));
  });
});

describe('what starts an item vs what continues an item (§6)', () => {
  it.each([
    [
      'names, literals and templates (a template on the next line never tags the previous item)',
      '[\n  tag\n  `hello`\n  1\n  3.14\n  5d\n  "s"\n  true\n  false\n  none\n]',
      '[tag, `hello`, 1, 3.14, 5d, "s", true, false, none]',
    ],
    [
      'opening brackets start an item: (1, "a") followed by (2, "b")',
      '[\n  (1, "a")\n  (2, "b")\n]',
      '[(1, "a"), (2, "b")]',
    ],
    [
      'keywords that start an item: fn, async, if, struct, new, not, await, spawn, ...',
      '[\n  fn(x): x\n  async fn(): 1\n  if c: 1 else: 2\n  struct{a: 1}\n  new Box{v: 1}\n  not flag\n  await fut\n  spawn work()\n  ...rest\n]',
      '[fn(x): x, async fn(): 1, if c: 1 else: 2, struct{a: 1}, new Box{v: 1}, not flag, await fut, spawn work(), ...rest]',
    ],
    [
      'glued "-", "*", "&", ".." and "..=" start a new item',
      'f(\n  a\n  -1\n  *ptr\n  &place\n  ..10\n  ..=10\n)',
      'f(a, -1, *ptr, &place, ..10, ..=10)',
    ],
  ])('separates items when the next line starts with %s', (_name, broken, inline) => {
    expect(dumpClean('expression', broken)).toBe(dumpClean('expression', inline));
  });

  it.each([
    [
      'postfix "(" on the next line starts an item instead of calling',
      '[\n  g\n  (1)\n]',
      '[g, (1)]',
    ],
    [
      'postfix "[" on the next line starts an item instead of indexing',
      '[\n  xs\n  [0]\n]',
      '[xs, [0]]',
    ],
    [
      'postfix "{" on the next line starts a block item instead of a struct literal',
      '[\n  P\n  { const a = 1; a }\n]',
      '[P, { const a = 1; a }]',
    ],
    [
      '"<" on the next line continues as comparison instead of type arguments',
      '[\n  f\n  < Int\n]',
      '[f < Int]',
    ],
  ])('keeps postfix brackets on their operand line: %s', (_name, broken, inline) => {
    expect(dumpClean('expression', broken)).toBe(dumpClean('expression', inline));
  });

  it.each([
    [
      'binary operators (+, /, //, %, **, ==, !=, <, <=, >, >=, and, or, ??, |, ^, <<, >>)',
      '[\n  a\n    + b\n    / c\n    // d\n    % e\n    ** f\n    == g\n    and h\n    or i\n    ?? j\n]',
      '[a + b / c // d % e ** f == g and h or i ?? j]',
    ],
    [
      'spaced "- 1", "* 2", "& mask", ".. 5" and "..= 5" continue the item',
      '[\n  a\n    - 1\n  b\n    * 2\n  c\n    & mask\n  0\n    .. 5\n  0\n    ..= 5\n]',
      '[a - 1, b * 2, c & mask, 0..5, 0..=5]',
    ],
    [
      'member and postfix chains (., ?., ->, ?->, !, ?) continue the item',
      '[\n  user\n    .profile\n    ?.address\n    ->city\n    ?->name\n    !\n    ?\n]',
      '[user.profile?.address->city?->name!?]',
    ],
    [
      'clauses (else, elif, in, not in, is, as, by, =, :) continue the item',
      '[\n  if a: 1\n  elif b: 2\n  else: 3\n  x\n    in xs\n  y\n    not in ys\n  z\n    is Int as n\n  0..10\n    by 2\n]',
      '[if a: 1 elif b: 2 else: 3, x in xs, y not in ys, z is Int as n, 0..10 by 2]',
    ],
    [
      'a line ending after an operator, ".", ":", "=", "->" or prefix continues on the next line',
      'retry(\n  times:\n    3 +\n    1\n  backoff: base.\n    value *\n    -1\n)',
      'retry(times: 3 + 1, backoff: base.value * -1)',
    ],
    [
      'a multi-line field entry in braces continues across "|", "->" and "."',
      '{\n  handler: fn(Int)\n    -> String\n    | None\n  count: Int\n}',
      '{ handler: fn(Int) -> String | None, count: Int }',
    ],
  ])('continues the item when %s', (_name, broken, inline) => {
    const category: Category = broken.startsWith('{') ? 'type' : 'expression';
    expect(dumpClean(category, broken)).toBe(dumpClean(category, inline));
  });
});

describe('mixed separators, comments, blank lines and templates (§6)', () => {
  it('allows trailing commas, leading commas, and multiple comma-separated items per line', () => {
    expect(dumpClean('expression', '[\n  1, 2\n  3, 4\n]')).toBe(
      dumpClean('expression', '[1, 2, 3, 4]'),
    );
    expect(dumpClean('expression', '[\n  1,\n  2,\n]')).toBe(dumpClean('expression', '[1, 2]'));
    expect(dumpClean('expression', '[\n  1\n  , 2\n  , 3\n]')).toBe(
      dumpClean('expression', '[1, 2, 3]'),
    );
  });

  it('ignores blank lines and comments between items when deciding whether a break separates', () => {
    const broken = lines(
      '[',
      '  # leading comment',
      '',
      '  a',
      '  # comment before glued negative',
      '',
      '  -1',
      '  # comment before spaced subtraction',
      '',
      '  - 2',
      ']',
    );
    expect(dumpClean('expression', broken)).toBe(dumpClean('expression', '[a, -1 - 2]'));
  });

  it('ignores line breaks inside template ${…} interpolations', () => {
    const broken = '[\n  `sum: ${a\n    + b\n    - 1}`\n  `call: ${g\n    (1)}`\n]';
    expect(dumpClean('expression', broken)).toBe(
      dumpClean('expression', '[`sum: ${a + b - 1}`, `call: ${g(1)}`]'),
    );
  });
});

describe('properties and hostile inputs (§6, note 11)', () => {
  const simpleItems = fc.constantFrom(
    '1',
    '"s"',
    'true',
    'none',
    'a',
    'a + b',
    'f(1, 2)',
    'Pair{x: 1, y: 2}',
    '[1, 2]',
    '(1, "x")',
  );

  it('gives the same tree when any comma in a generated list is replaced with a line break', () => {
    fc.assert(
      fc.property(
        fc.array(simpleItems, { minLength: 2, maxLength: 6 }),
        fc.array(fc.constantFrom(', ', '\n  ', ',\n  ', '\n  # note\n  '), {
          minLength: 5,
          maxLength: 5,
        }),
        (items, joins) => {
          const inline = `[${items.join(', ')}]`;
          const broken = `[\n  ${items
            .map((item, index) =>
              index === 0 ? item : `${joins[(index - 1) % joins.length]}${item}`,
            )
            .join('')}\n]`;
          expect(dumpClean('expression', broken)).toBe(dumpClean('expression', inline));
        },
      ),
      { numRuns: 60 },
    );
  });

  it('gives the same tree when an item is broken at any continuing operator or clause', () => {
    const continuations: (readonly [string, string])[] = [
      ['a + b', 'a\n    + b'],
      ['a - 1', 'a\n    - 1'],
      ['a * 2', 'a\n    * 2'],
      ['a & b', 'a\n    & b'],
      ['0..10 by 2', '0\n    .. 10\n    by 2'],
      ['x.y?.z->w!', 'x\n    .y\n    ?.z\n    ->w\n    !'],
      ['if c: 1 elif d: 2 else: 3', 'if c: 1\n    elif d: 2\n    else: 3'],
      ['x is Int as n', 'x\n    is Int\n    as n'],
      ['x in xs and y not in ys', 'x\n    in xs\n    and y\n    not in ys'],
    ];
    fc.assert(
      fc.property(fc.subarray(continuations, { minLength: 2, maxLength: 5 }), (chosen) => {
        const inline = `[${chosen.map(([oneLine]) => oneLine).join(', ')}]`;
        const broken = `[\n  ${chosen.map(([, multiLine]) => multiLine).join('\n  ')}\n]`;
        expect(dumpClean('expression', broken)).toBe(dumpClean('expression', inline));
      }),
      { numRuns: 50 },
    );
  });

  it('stays total and well-nested on hostile bracketed inputs with glued and spaced operators', () => {
    const hostileFragments = [
      'a',
      '1',
      '-1',
      '- 1',
      '*x',
      '* x',
      '&x',
      '& x',
      '..5',
      '.. 5',
      '..=5',
      '..= 5',
      '(1)',
      '[0]',
      '{a: 1}',
      '<Int>',
      ',',
      ';',
      ':',
      '# c',
    ];
    const hostileSoup = soupOf(hostileFragments, [' ', '\n  ', '\n    ', '\n'], 20);
    fc.assert(
      fc.property(hostileSoup, (inner) => {
        const source = createSourceText('hostile.ista', `fn f(): [\n  ${inner}\n]\n`);
        const tree = parse(source, scan(source));
        const unexplained = errorNodes(tree, tree.root).length > 0 && tree.diagnostics.length === 0;
        expect(spanViolations(tree, tree.root)).toEqual([]);
        expect(strayBodies(tree)).toEqual([]);
        expect(unexplained).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe('lists the rule reaches beyond brackets', () => {
  it('lets type arguments and parameters span lines at the top level, as any list', () => {
    const broken = lines(
      'const m: Map<',
      '  String',
      '  Int',
      '> = []',
      'fn f<',
      '  A',
      '  B',
      '>(a: A, b: B): a',
    );
    const inline = lines('const m: Map<String, Int> = []', 'fn f<A, B>(a: A, b: B): a');
    expect(dumpClean('module', broken)).toBe(dumpClean('module', inline));
  });

  it("ends a '<' left open where indentation says, so the next declaration still parses", () => {
    const { codes } = reported('module', lines('const a: Array<', 'const b = 1', 'const c = 2'));
    expect(codes).toEqual([2002, 2001]);
    expect(dumpClean('module', lines('fn f(x: Map<', '  String', '  Int', '>) -> Int: 1'))).toBe(
      dumpClean('module', 'fn f(x: Map<String, Int>) -> Int: 1'),
    );
  });

  it("gives an annotation on its own line to the entry below it, and one on an entry's line to that entry", () => {
    const broken = lines(
      'struct R {',
      '  @Json{name: "x"}',
      '  a: Int',
      '  b: Int @JsonSkip',
      '  @JsonSkip',
      '  c: Int',
      '}',
    );
    const inline = 'struct R { @Json{name: "x"} a: Int, b: Int @JsonSkip, @JsonSkip c: Int }';
    expect(dumpClean('module', broken)).toBe(dumpClean('module', inline));
  });

  it("starts an item with 'not' on a new line, but continues one with 'not in'", () => {
    expect(dumpClean('expression', '[\n  a\n  not b\n]')).toBe(
      dumpClean('expression', '[a, not b]'),
    );
    expect(dumpClean('expression', '[\n  a\n    not in b\n]')).toBe(
      dumpClean('expression', '[a not in b]'),
    );
  });
});
