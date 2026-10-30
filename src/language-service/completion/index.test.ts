import { describe, expect, it } from 'vitest';
import { programAt } from '../language-service.test-kit.ts';
import { completionsAt } from './index.ts';

function names(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset).map(({ name }) => name);
}

/** The fields offered, leaving out what else a literal's item may start with. */
function fields(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset)
    .filter(({ kind }) => kind === 'field')
    .map(({ name }) => name);
}

const time = "import * as time from 'time'";

const pair = [
  'struct Pair:',
  '  first: int',
  '  second: int',
  '',
  'fn sum(self: Pair) -> int: self.first + self.second',
  'fn Pair.zero() -> Pair: Pair{first: 0, second: 0}',
  '',
];

describe('completion', () => {
  it("offers a value's fields and methods after a `.`, while the member is still missing", () => {
    expect(names(...pair, 'fn f(p: Pair) -> int:', '  p.‸', '  1')).toEqual(
      expect.arrayContaining(['first', 'second', 'sum']),
    );
  });

  it('offers the value inside an optional after `?.`', () => {
    expect(names(...pair, 'fn f(p: Pair?) -> int?: p?.fi‸rst')).toEqual(
      expect.arrayContaining(['first', 'second']),
    );
  });

  it("offers a type's statics, and an enum's variants", () => {
    expect(names(...pair, 'fn f() -> Pair: Pair.ze‸ro()')).toContain('zero');
    expect(names('enum Color:', '  Red', '  Green', 'fn f() -> Color: Color.R‸ed')).toEqual([
      'Red',
      'Green',
    ]);
  });

  it('offers what a shared struct holds after `->` and `?->`, before a member is written', () => {
    const counter = ['shared struct Counter:', '  count: int', ''];
    expect(names(...counter, 'fn f(c: Counter) -> int:', '  c->‸', '  1')).toEqual(['count']);
    expect(names(...counter, 'fn f(c: Counter?) -> int:', '  c?->‸', '  1')).toEqual(['count']);
  });

  it("offers a qualified name's later segment in a pattern and in a type", () => {
    const color = ['enum Color:', '  Red', '  Green', ''];
    const matching = [
      'fn f(c: Color) -> int:',
      '  match c:',
      '    case Color.R‸ed: 1',
      '    case _: 2',
    ];
    expect(names(...color, ...matching)).toEqual(['Red', 'Green']);
    const unwritten = [
      'fn f(c: Color) -> int:',
      '  match c:',
      '    case Color.‸:',
      '      1',
      '    case _: 2',
    ];
    expect(names(...color, ...unwritten)).toEqual(['Red', 'Green']);
    const json = "import * as json from 'json'";
    expect(names(json, 'fn f(j: json.Js‸on) -> int: 1')).toContain('Json');
    expect(names(json, 'fn f(j: json.‸) -> int: 1')).toContain('Json');
    expect(names(json, 'fn f() -> int:', '  let j: json.‸ = 1', '  1')).toContain('Json');
  });

  it("offers a namespace's type's statics and variants after its `.`", () => {
    expect(names(time, 'fn f():', '  const d = time.Duration.‸', '  1')).toContain('parse');
    const json = "import * as json from 'json'";
    expect(names(json, 'fn f():', '  const j = json.Json.‸', '  1')).toContain('Null');
  });

  it("offers a namespace's types after its `.` in a pattern, and their variants after theirs", () => {
    const json = "import * as json from 'json'";
    const matching = (path: string) => [
      json,
      'fn f(j: json.Json) -> int:',
      '  match j:',
      `    case ${path}‸:`,
      '      1',
      '    case _: 2',
    ];
    expect(names(...matching('json.'))).toContain('Json');
    expect(names(...matching('json.'))).not.toContain('parse');
    expect(names(...matching('json.Json.'))).toContain('Null');
  });

  it('offers no variant after a type `new` builds', () => {
    const decision = ['enum Decision:', '  Approved', '  Expired', ''];
    expect(names(...decision, 'fn f():', '  const d = new Decision.Ap‸{}', '  1')).toEqual([]);
  });

  it('offers a method taking `&self` only through a place', () => {
    expect(names('fn f() -> int:', '  let xs = [1]', '  xs.‸', '  1')).toContain('push');
    expect(names('fn f() -> int:', '  [1].‸', '  1')).not.toContain('push');
  });

  it("offers an async function's own call's members after its name, but none for main", () => {
    expect(names('async fn worker() -> Future<int>:', '  worker.‸', '  1')).toContain('disposing');
    expect(names('async fn main() -> Future<int>:', '  main.‸', '  1')).toEqual([]);
  });

  it("offers the fields a struct literal doesn't give yet, where an item's name stands", () => {
    const literal = (items: string) => fields(...pair, `fn f() -> Pair: Pair{${items}}`);
    expect(literal('‸')).toEqual(['first', 'second']);
    expect(literal('first: 1, ‸')).toEqual(['second']);
    expect(literal('first: 1, se‸')).toEqual(['second']);
    expect(literal('fi‸rst: 1, second: 2')).toEqual(['first']);
    expect(fields(time, 'fn f() -> int:', '  const d = time.DateTime{‸}', '  1')).toEqual([
      'year',
      'month',
      'day',
      'hour',
      'minute',
      'second',
      'millisecond',
    ]);
  });

  it("offers each literal its own fields when nested, and a shorthand's name counts as given", () => {
    const outer = ['struct Wrap:', '  inner: Pair', '  tag: int', ''];
    const nested = (items: string) => fields(...pair, ...outer, `fn f() -> Wrap: Wrap{${items}}`);
    expect(nested('inner: Pair{‸}, tag: 1')).toEqual(['first', 'second']);
    expect(nested('inner: Pair{first: 1}, ‸')).toEqual(['tag']);
    expect(fields(...pair, 'fn f(first: int) -> Pair: Pair{first, ‸}')).toEqual(['second']);
    expect(fields(...pair, 'fn f() -> Pair: Pair{second: 2, fir‸st}')).toEqual(['first']);
  });

  it('offers the fields of a literal not closed yet, at the end of the text', () => {
    const typed = (line: string) => fields(...pair, 'fn f() -> Pair:', line);
    expect(typed('  Pair{‸')).toEqual(['first', 'second']);
    expect(typed('  Pair{first: 1,‸')).toEqual(['second']);
    expect(typed('  Pair{first: 1, ‸')).toEqual(['second']);
    expect(typed('  Pair{fi‸')).toEqual(['first', 'second']);
  });

  it("offers a field's name on a line of its own, or spelled as a keyword so far", () => {
    const multiline = ['fn f() -> Pair:', '  Pair{', '    first: 1,', '    se‸', '  }'];
    expect(fields(...pair, ...multiline)).toEqual(['second']);
    const before = ['fn f() -> Pair:', '  Pair{', '    fi‸', '    second: 2', '  }'];
    expect(fields(...pair, ...before)).toContain('first');
    const slot = ['struct Slot:', '  index: int', '  inbox: string', ''];
    expect(fields(...slot, 'fn f() -> Slot: Slot{in‸}')).toEqual(['index', 'inbox']);
  });

  it('offers the leading spread where the first item stands, and a variable as its field shorthand', () => {
    expect(names(...pair, 'fn f() -> Pair: Pair{‸}')).toContain('...');
    expect(names(...pair, 'fn f(p: Pair) -> Pair: Pair{...p, ‸}')).not.toContain('...');
    const { program, module, offset } = programAt(...pair, 'fn f(first: int) -> Pair: Pair{‸}');
    const firsts = completionsAt(program, module, offset).filter(({ name }) => name === 'first');
    expect(firsts.map(({ kind, insert }) => ({ kind, insert }))).toEqual([
      { kind: 'variable', insert: undefined },
      { kind: 'field', insert: { kind: 'text', text: 'first: ' } },
    ]);
  });

  it('offers nothing where a field of a literal with no known fields would stand', () => {
    expect(names('fn f() -> int:', '  const n = Nope{‸}', '  1')).toEqual([]);
  });

  it("details each field with its type as the literal's type arguments make it", () => {
    const box = ['struct Box<T>:', '  value: T', '  count: int', ''];
    const { program, module, offset } = programAt(...box, 'fn f() -> Box<int>: Box<int>{‸}');
    const offered = completionsAt(program, module, offset);
    expect(offered.map(({ name, detail }) => ({ name, detail }))).toEqual([
      { name: 'value', detail: 'int' },
      { name: 'count', detail: 'int' },
      { name: '...', detail: undefined },
    ]);
  });

  it("offers a one-field literal's field, and the visible names for its value, after its `{`", () => {
    const one = ['struct One:', '  value: int', ''];
    expect(names(...one, 'fn f(count: int) -> One: One{‸}')).toEqual(
      expect.arrayContaining(['value', 'count']),
    );
  });

  it("offers a variant literal's and a shared struct literal's fields", () => {
    const decision = [
      'enum Decision:',
      '  Approved { by: string }',
      '  Rejected { by: string; reason: string }',
      '',
    ];
    expect(fields(...decision, 'fn f() -> Decision: Rejected{by: "x", ‸}')).toEqual(['reason']);
    const counter = ['shared struct Counter:', '  count: int', '  label: string = "counted"', ''];
    expect(fields(...counter, 'fn f() -> Counter: new Counter{‸}')).toEqual(['count', 'label']);
  });

  it("offers the visible names in a field's value, written or not yet", () => {
    const valued = (items: string) => names(...pair, `fn f(count: int) -> Pair: Pair{${items}}`);
    expect(valued('first: co‸unt, second: 1')).toContain('count');
    expect(valued('first: ‸')).toEqual(expect.arrayContaining(['count', 'if']));
    expect(valued('first: ‸')).not.toContain('while');
    expect(valued('first: ‸')).not.toContain('second');
    expect(valued('first: count + ‸, second: 2')).toContain('count');
  });

  it('offers the names visible where the name starts, then keywords', () => {
    const offered = names('fn f(count: int) -> int:', '  let total = 1', '  to‸tal + count');
    expect(offered).toEqual(expect.arrayContaining(['total', 'count', 'f', 'fn', 'while']));
  });

  it("documents an item with its declaration's docstring", () => {
    const documented = [
      'fn twice(n: int) -> int:',
      '  """Doubles `n`."""',
      '  n * 2',
      '',
      'struct Marker:',
      '  """Marks a spot."""',
      '  at: int',
      '',
    ];
    const { program, module, offset } = programAt(...documented, 'fn f() -> int:', '  ‸', '  1');
    const docs = completionsAt(program, module, offset)
      .filter(({ name }) => ['twice', 'Marker', 'f'].includes(name))
      .map(({ name, documentation }) => ({ name, documentation }));
    expect(docs).toEqual([
      { name: 'twice', documentation: 'Doubles `n`.' },
      { name: 'Marker', documentation: 'Marks a spot.' },
      { name: 'f', documentation: undefined },
    ]);
  });

  it("writes a call's parentheses or a variant's braces only where none follow", () => {
    const decision = ['enum Decision:', '  Approved { by: string }', '  Expired', ''];
    const inserted = (...lines: readonly string[]) => {
      const { program, module, offset } = programAt(...decision, ...lines);
      return new Map(
        completionsAt(program, module, offset).map(({ name, insert }) => [name, insert]),
      );
    };
    const bare = inserted('fn f() -> Decision:', '  Decision.‸', '  Decision.Expired');
    expect(bare.get('Approved')).toEqual({ kind: 'snippet', snippet: 'Approved{$0}' });
    expect(bare.get('Expired')).toBeUndefined();
    const braced = inserted('fn f() -> Decision:', '  Decision.Appr‸{by: "x"}');
    expect(braced.get('Approved')).toBeUndefined();
    const call = { kind: 'snippet', snippet: 'f($0)' };
    expect(inserted('fn f() -> int:', '  f‸', '  1').get('f')).toEqual(call);
    expect(inserted('fn f() -> int:', '  f‸()', '  1').get('f')).toBeUndefined();
  });

  it("answers a typed `>` only where it writes a member's `->`", () => {
    const { program, module, offset } = programAt('fn f(a: int) -> bool: a >‸ 1');
    expect(completionsAt(program, module, offset, { trigger: '>' })).toEqual([]);
  });

  it("doesn't offer a block's name before its declaration", () => {
    expect(names('fn f() -> int:', '  ‸', '  let later = 1', '  later')).not.toContain('later');
  });

  it('offers nothing after a `.` where no member can stand, a keyword spelling included', () => {
    expect(names(time, 'time.‸', 'fn f() -> int: 1')).toEqual([]);
    expect(names(time, 'time.if‸')).toEqual([]);
    expect(names(time, 'time?.‸')).toEqual([]);
    expect(names('1.‸')).toEqual([]);
    expect(names('enum Color.‸:', '  Red')).toEqual([]);
    expect(names(time, 'const t = time.‸')).toContain('now');
  });

  it('offers nothing after a value that has no members', () => {
    expect(names('fn main() -> int:', '  main.‸', '  1')).toEqual([]);
    expect(names('fn g() -> int: 1', 'fn f() -> int:', '  g.‸', '  1')).toEqual([]);
    expect(names('fn f() -> int:', '  nope.‸', '  1')).toEqual([]);
    expect(names('fn f() -> int:', '  let x = nope', '  x.‸', '  1')).toEqual([]);
    expect(names('fn f(o: int?) -> int:', '  o.‸', '  1')).toEqual([]);
    expect(names('fn f(o: int) -> int:', '  o?.‸', '  1')).toEqual([]);
  });

  it("offers neither a namespace's nor a type's members after `?.`", () => {
    expect(names(time, 'fn f() -> int:', '  time?.‸', '  1')).toEqual([]);
    expect(names(...pair, 'fn f() -> int:', '  Pair?.‸', '  1')).toEqual([]);
  });

  it('offers a member whose name so far spells a keyword', () => {
    const xs = ['fn f(xs: Array<int>, maybe: Array<int>?) -> int:', '  let ys = xs'];
    expect(names(...xs, '  ys.in‸', '  1')).toContain('includes');
    expect(names(...xs, '  maybe?.in‸', '  1')).toContain('includes');
  });

  it('offers the visible names after a `.` that ends the line before', () => {
    expect(names(time, 'time.', 'f‸')).toContain('fn');
    expect(names(time, 'const t: time.', 'fn‸')).toContain('fn');
    expect(names('fn f() -> i‸nt: 1')).toContain('int');
  });
});
