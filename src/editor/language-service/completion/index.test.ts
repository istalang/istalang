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
  '  first: Int',
  '  second: Int',
  '',
  'fn sum(self: Pair) -> Int: self.first + self.second',
  'fn Pair.zero() -> Pair: Pair{first: 0, second: 0}',
  '',
];

describe('completion', () => {
  it("offers a value's fields and methods after a `.`, while the member is still missing", () => {
    expect(names(...pair, 'fn f(p: Pair) -> Int:', '  p.‸', '  1')).toEqual(
      expect.arrayContaining(['first', 'second', 'sum']),
    );
  });

  it('offers the value inside an optional after `?.`', () => {
    expect(names(...pair, 'fn f(p: Pair?) -> Int?: p?.fi‸rst')).toEqual(
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

  it("offers an alias's statics and variants, and an alias of a shape as a static's owner (§3.17)", () => {
    const point = ['type Point = { x: Int, y: Int }', 'type Spot = { y: Int, x: Int }', ''];
    const origin = 'fn Point.origin() -> Point: Point{x: 0, y: 0}';
    expect(names(...point, origin, 'fn f() -> Spot: Spot.or‸igin()')).toContain('origin');
    const color = ['enum Color:', '  Red', '  Green', 'type Hue = Color', ''];
    expect(names(...color, 'fn f() -> Color: Hue.R‸ed')).toEqual(['Red', 'Green']);
    expect(
      names(
        ...color,
        'fn f(c: Hue) -> Int:',
        '  match c:',
        '    case Hue.‸:',
        '      1',
        '    case _: 2',
      ),
    ).toEqual(['Red', 'Green']);
    expect(names(...point, 'fn Poi‸')).toContain('Point');
  });

  it('offers what a shared struct holds after `->` and `?->`, before a member is written', () => {
    const counter = ['shared struct Counter:', '  count: Int', ''];
    expect(names(...counter, 'fn f(c: Counter) -> Int:', '  c->‸', '  1')).toEqual(['count']);
    expect(names(...counter, 'fn f(c: Counter?) -> Int:', '  c?->‸', '  1')).toEqual(['count']);
  });

  it("offers a qualified name's later segment in a pattern and in a type", () => {
    const color = ['enum Color:', '  Red', '  Green', ''];
    const matching = [
      'fn f(c: Color) -> Int:',
      '  match c:',
      '    case Color.R‸ed: 1',
      '    case _: 2',
    ];
    expect(names(...color, ...matching)).toEqual(['Red', 'Green']);
    const unwritten = [
      'fn f(c: Color) -> Int:',
      '  match c:',
      '    case Color.‸:',
      '      1',
      '    case _: 2',
    ];
    expect(names(...color, ...unwritten)).toEqual(['Red', 'Green']);
    const json = "import * as json from 'json'";
    expect(names(json, 'fn f(j: json.Js‸on) -> Int: 1')).toContain('Json');
    expect(names(json, 'fn f(j: json.‸) -> Int: 1')).toContain('Json');
    expect(names(json, 'fn f() -> Int:', '  let j: json.‸ = 1', '  1')).toContain('Json');
  });

  it("offers a namespace's type's statics after its `.`, an alias's too", () => {
    expect(names(time, 'fn f():', '  const d = time.Duration.‸', '  1')).toContain('parse');
    const json = "import * as json from 'json'";
    expect(names(json, 'fn f():', '  const j = json.Json.‸', '  1')).toContain('fromJson');
  });

  it("offers a namespace's types after its `.` in a pattern, and a type's variants after its own", () => {
    const json = "import * as json from 'json'";
    const matching = (path: string) => [
      json,
      'fn f(j: json.Json) -> Int:',
      '  match j:',
      `    case ${path}‸:`,
      '      1',
      '    case _: 2',
    ];
    expect(names(...matching('json.'))).toContain('Json');
    expect(names(...matching('json.'))).not.toContain('parse');
    const level = [
      "import * as log from 'log'",
      'fn f(l: log.Level) -> Int:',
      '  match l:',
      '    case log.Level.‸:',
      '      1',
      '    case _: 2',
    ];
    expect(names(...level)).toContain('Debug');
  });

  it('offers no variant after a type `new` builds', () => {
    const decision = ['enum Decision:', '  Approved', '  Expired', ''];
    expect(names(...decision, 'fn f():', '  const d = new Decision.Ap‸{}', '  1')).toEqual([]);
  });

  it('offers a method taking `&self` only through a place', () => {
    expect(names('fn f() -> Int:', '  let xs = [1]', '  xs.‸', '  1')).toContain('push');
    expect(names('fn f() -> Int:', '  [1].‸', '  1')).not.toContain('push');
  });

  it("offers an async function's own call's members after its name, but none for main", () => {
    expect(names('async fn worker() -> Future<Int>:', '  worker.‸', '  1')).toContain('disposing');
    expect(names('async fn main() -> Future<Int>:', '  main.‸', '  1')).toEqual([]);
  });

  it("offers the fields a struct literal doesn't give yet, where an item's name stands", () => {
    const literal = (items: string) => fields(...pair, `fn f() -> Pair: Pair{${items}}`);
    expect(literal('‸')).toEqual(['first', 'second']);
    expect(literal('first: 1, ‸')).toEqual(['second']);
    expect(literal('first: 1, se‸')).toEqual(['second']);
    expect(literal('fi‸rst: 1, second: 2')).toEqual(['first']);
    expect(fields(time, 'fn f() -> Int:', '  const d = time.DateTime{‸}', '  1')).toEqual([
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
    const outer = ['struct Wrap:', '  inner: Pair', '  tag: Int', ''];
    const nested = (items: string) => fields(...pair, ...outer, `fn f() -> Wrap: Wrap{${items}}`);
    expect(nested('inner: Pair{‸}, tag: 1')).toEqual(['first', 'second']);
    expect(nested('inner: Pair{first: 1}, ‸')).toEqual(['tag']);
    expect(fields(...pair, 'fn f(first: Int) -> Pair: Pair{first, ‸}')).toEqual(['second']);
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
    const separated = ['fn f() -> Pair:', '  Pair{', '    first: 1', '    ‸', '  }'];
    expect(fields(...pair, ...separated)).toEqual(['second']);
    const written = ['fn f() -> Pair:', '  Pair{', '    first: 1', '    se‸', '  }'];
    expect(fields(...pair, ...written)).toEqual(['second']);
    const slot = ['struct Slot:', '  index: Int', '  inbox: String', ''];
    expect(fields(...slot, 'fn f() -> Slot: Slot{in‸}')).toEqual(['index', 'inbox']);
  });

  it('offers the leading spread where the first item stands, and a variable as its field shorthand', () => {
    expect(names(...pair, 'fn f() -> Pair: Pair{‸}')).toContain('...');
    expect(names(...pair, 'fn f(p: Pair) -> Pair: Pair{...p, ‸}')).not.toContain('...');
    const { program, module, offset } = programAt(...pair, 'fn f(first: Int) -> Pair: Pair{‸}');
    const firsts = completionsAt(program, module, offset).filter(({ name }) => name === 'first');
    expect(firsts.map(({ kind, insert }) => ({ kind, insert }))).toEqual([
      { kind: 'variable', insert: undefined },
      { kind: 'field', insert: { kind: 'text', text: 'first: ' } },
    ]);
  });

  it('offers nothing where a field of a literal with no known fields would stand', () => {
    expect(names('fn f() -> Int:', '  const n = Nope{‸}', '  1')).toEqual([]);
  });

  it("details each field with its type as the literal's type arguments make it", () => {
    const box = ['struct Box<T>:', '  value: T', '  count: Int', ''];
    const { program, module, offset } = programAt(...box, 'fn f() -> Box<Int>: Box<Int>{‸}');
    const offered = completionsAt(program, module, offset);
    expect(offered.map(({ name, detail }) => ({ name, detail }))).toEqual([
      { name: 'value', detail: 'Int' },
      { name: 'count', detail: 'Int' },
      { name: '...', detail: undefined },
    ]);
  });

  it("offers a one-field literal's field, and the visible names for its value, after its `{`", () => {
    const one = ['struct One:', '  value: Int', ''];
    expect(names(...one, 'fn f(count: Int) -> One: One{‸}')).toEqual(
      expect.arrayContaining(['value', 'count']),
    );
  });

  it("offers a shared struct literal's fields, and none in braces after a variant's name", () => {
    const decision = [
      'enum Decision:',
      '  Approved(by: String)',
      '  Rejected(by: String, reason: String)',
      '',
    ];
    expect(fields(...decision, 'fn f() -> Decision: Rejected{by: "x", ‸}')).toEqual([]);
    const counter = ['shared struct Counter:', '  count: Int', '  label: String = "counted"', ''];
    expect(fields(...counter, 'fn f() -> Counter: new Counter{‸}')).toEqual(['count', 'label']);
  });

  it("offers the visible names in a field's value, written or not yet", () => {
    const valued = (items: string) => names(...pair, `fn f(count: Int) -> Pair: Pair{${items}}`);
    expect(valued('first: co‸unt, second: 1')).toContain('count');
    expect(valued('first: ‸')).toEqual(expect.arrayContaining(['count', 'if']));
    expect(valued('first: ‸')).not.toContain('while');
    expect(valued('first: ‸')).not.toContain('second');
    expect(valued('first: count + ‸, second: 2')).toContain('count');
  });

  it('offers the names visible where the name starts, then keywords', () => {
    const offered = names('fn f(count: Int) -> Int:', '  let total = 1', '  to‸tal + count');
    expect(offered).toEqual(expect.arrayContaining(['total', 'count', 'f', 'fn', 'while']));
  });

  it("documents an item with its declaration's docstring", () => {
    const documented = [
      'fn twice(n: Int) -> Int:',
      '  """Doubles `n`."""',
      '  n * 2',
      '',
      'struct Marker:',
      '  """Marks a spot."""',
      '  at: Int',
      '',
    ];
    const { program, module, offset } = programAt(...documented, 'fn f() -> Int:', '  ‸', '  1');
    const docs = completionsAt(program, module, offset)
      .filter(({ name }) => ['twice', 'Marker', 'f'].includes(name))
      .map(({ name, documentation }) => ({ name, documentation }));
    expect(docs).toEqual([
      { name: 'twice', documentation: 'Doubles `n`.' },
      { name: 'Marker', documentation: 'Marks a spot.' },
      { name: 'f', documentation: undefined },
    ]);
  });

  it("writes a call's parentheses only where none follow, and offers no variant before braces", () => {
    const decision = ['enum Decision:', '  Approved(by: String)', '  Expired', ''];
    const inserted = (...lines: readonly string[]) => {
      const { program, module, offset } = programAt(...decision, ...lines);
      return new Map(
        completionsAt(program, module, offset).map(({ name, insert }) => [name, insert]),
      );
    };
    const bare = inserted('fn f() -> Decision:', '  Decision.‸', '  Decision.Expired');
    expect(bare.get('Approved')).toEqual({ kind: 'snippet', snippet: 'Approved($0)' });
    expect(bare.get('Expired')).toBeUndefined();
    const braced = inserted('fn f() -> Decision:', '  Decision.Appr‸{by: "x"}');
    expect(braced.has('Approved')).toBe(false);
    const called = inserted('fn f() -> Decision:', '  Decision.Appr‸(by: "x")');
    expect(called.get('Approved')).toBeUndefined();
    const call = { kind: 'snippet', snippet: 'f($0)' };
    expect(inserted('fn f() -> Int:', '  f‸', '  1').get('f')).toEqual(call);
    expect(inserted('fn f() -> Int:', '  f‸()', '  1').get('f')).toBeUndefined();
  });

  it("answers a typed `>` only where it writes a member's `->`", () => {
    const { program, module, offset } = programAt('fn f(a: Int) -> Bool: a >‸ 1');
    expect(completionsAt(program, module, offset, { trigger: '>' })).toEqual([]);
  });

  it("doesn't offer a block's name before its declaration", () => {
    expect(names('fn f() -> Int:', '  ‸', '  let later = 1', '  later')).not.toContain('later');
  });

  it('offers nothing after a `.` where no member can stand, a keyword spelling included', () => {
    expect(names(time, 'time.‸', 'fn f() -> Int: 1')).toEqual([]);
    expect(names(time, 'time.if‸')).toEqual([]);
    expect(names(time, 'time?.‸')).toEqual([]);
    expect(names('1.‸')).toEqual([]);
    expect(names('enum Color.‸:', '  Red')).toEqual([]);
    expect(names(time, 'const t = time.‸')).toContain('now');
  });

  it('offers nothing after a value that has no members', () => {
    expect(names('fn main() -> Int:', '  main.‸', '  1')).toEqual([]);
    expect(names('fn g() -> Int: 1', 'fn f() -> Int:', '  g.‸', '  1')).toEqual([]);
    expect(names('fn f() -> Int:', '  nope.‸', '  1')).toEqual([]);
    expect(names('fn f() -> Int:', '  let x = nope', '  x.‸', '  1')).toEqual([]);
    expect(names('fn f(o: Int?) -> Int:', '  o.‸', '  1')).toEqual([]);
    expect(names('fn f(o: Int) -> Int:', '  o?.‸', '  1')).toEqual([]);
  });

  it("offers neither a namespace's nor a type's members after `?.`", () => {
    expect(names(time, 'fn f() -> Int:', '  time?.‸', '  1')).toEqual([]);
    expect(names(...pair, 'fn f() -> Int:', '  Pair?.‸', '  1')).toEqual([]);
  });

  it('offers a member whose name so far spells a keyword', () => {
    const xs = ['fn f(xs: Array<Int>, maybe: Array<Int>?) -> Int:', '  let ys = xs'];
    expect(names(...xs, '  ys.in‸', '  1')).toContain('includes');
    expect(names(...xs, '  maybe?.in‸', '  1')).toContain('includes');
  });

  it('offers the visible names after a `.` that ends the line before', () => {
    expect(names(time, 'time.', 'f‸')).toContain('fn');
    expect(names(time, 'const t: time.', 'fn‸')).toContain('fn');
    expect(names('fn f() -> I‸nt: 1')).toContain('Int');
  });
});
